import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { Prisma } from "@prisma/client";
import db from "../db.server";
import { adminContext } from "../lib/context.server";
import { can, requiredPlan } from "../lib/plans";
import {
  approveCertificate, certificateFlags, certificateStatus, CERTIFICATE_TYPES, decideOnExpiry, exemptionForCertificate,
  maskedNumber, rejectCertificate, sendRenewalRequest, setCertificateExpiry, daysUntil,
} from "../lib/certificates.server";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";

const STATUS_FILTERS = ["all", "pending", "valid", "expiring", "expired", "rejected", "no_expiry"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const PAGE_SIZE = 50;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const url = new URL(request.url);
  const status = (STATUS_FILTERS as readonly string[]).includes(url.searchParams.get("status") ?? "") ? (url.searchParams.get("status") as StatusFilter) : "all";
  const type = (CERTIFICATE_TYPES as string[]).includes(url.searchParams.get("type") ?? "") ? url.searchParams.get("type")! : "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const where: Prisma.CertificateWhereInput = { shop: ctx.shop };
  if (status === "no_expiry") Object.assign(where, { expiresOn: null, status: { not: "rejected" } });
  else if (status !== "all") where.status = status;
  if (type) where.type = type;

  const [total, certs] = await Promise.all([
    db.certificate.count({ where }),
    db.certificate.findMany({ where, orderBy: [{ createdAt: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  const buyerIds = [...new Set(certs.map((c) => c.buyerId).filter(Boolean))] as string[];
  const appIds = [...new Set(certs.map((c) => c.applicationId).filter(Boolean))] as string[];
  const [buyers, apps] = await Promise.all([
    db.buyer.findMany({ where: { shop: ctx.shop, id: { in: buyerIds } }, select: { id: true, name: true } }),
    db.application.findMany({ where: { shop: ctx.shop, id: { in: appIds } }, select: { id: true, companyName: true } }),
  ]);
  const buyerName = new Map(buyers.map((b) => [b.id, b.name]));
  const appName = new Map(apps.map((a) => [a.id, a.companyName]));
  const days = ctx.settings.certificates.expiringDays;

  const rows = certs.map((c) => {
    const st = certificateStatus(c, days);
    return {
      id: c.id,
      name: (c.buyerId && buyerName.get(c.buyerId)) || (c.applicationId && appName.get(c.applicationId)) || "—",
      isBuyer: Boolean(c.buyerId),
      buyerId: c.buyerId,
      applicationId: c.applicationId,
      type: c.type,
      country: c.country,
      region: c.region,
      number: maskedNumber(c.numberEnc),
      expiresOn: c.expiresOn ? c.expiresOn.toISOString().slice(0, 10) : null,
      status: st,
      ...certificateFlags(c),
      hasFile: Boolean(c.fileGid),
      rejectReason: c.rejectReason,
      needsDecision: st === "expired" && Boolean(c.buyerId) && !c.decidedOnExpiry,
      decided: c.decidedOnExpiry,
      exemption: exemptionForCertificate(c),
    };
  });
  return {
    rows,
    filters: { status, type, page },
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
    gated: !can(ctx.plan, "certificate_vault"),
    requiredPlan: requiredPlan("certificate_vault"),
    expiringDays: days,
    autoRenewal: ctx.settings.certificates.autoRenewal,
  };
};

type ActionResult = { ok: boolean; intent: string; error?: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  if (!can(ctx.plan, "certificate_vault")) return { ok: false, intent, error: "plan" };
  const cert = await db.certificate.findFirst({ where: { shop: ctx.shop, id }, select: { id: true, expiresOn: true } });
  if (!cert) return { ok: false, intent, error: "not_found" };
  switch (intent) {
    case "approve":
      return { ok: await approveCertificate(ctx.shop, id, ctx.actor), intent };
    case "reject":
      return { ok: await rejectCertificate(ctx.shop, id, ctx.actor, String(form.get("reason") ?? "")), intent };
    case "set_expiry": {
      const date = String(form.get("expiresOn") ?? "").trim();
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, intent, error: "date" };
      return { ok: await setCertificateExpiry(ctx.shop, id, ctx.actor, date || null), intent };
    }
    case "request": {
      const expired = cert.expiresOn ? daysUntil(cert.expiresOn) < 0 : false;
      const ok = await sendRenewalRequest(ctx.shop, id, expired ? "expired" : "expiring", async () => ctx.admin);
      return { ok, intent, ...(ok ? {} : { error: "no_recipient" }) };
    }
    case "expiry_keep":
    case "expiry_remove": {
      const r = await decideOnExpiry(ctx.admin, ctx.shop, id, ctx.actor, intent === "expiry_keep" ? "keep" : "remove");
      return { ok: r.ok, intent, error: r.reason };
    }
  }
  return { ok: false, intent, error: "unknown_intent" };
};

type Row = Awaited<ReturnType<typeof loader>>["rows"][number];

const TONE: Record<string, "info" | "success" | "caution" | "warning" | "neutral"> = {
  pending: "info", valid: "success", expiring: "caution", expired: "warning", rejected: "neutral",
};

export default function Certificates() {
  const data = useLoaderData<typeof loader>();
  const { t, locale } = useI18n();
  const href = useLocaleHref();
  const shopify = useAppBridge();
  const [params, setParams] = useSearchParams();
  const fetcher = useFetcher<typeof action>();
  const [current, setCurrent] = useState<Row | null>(null);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    const d = fetcher.data;
    if (!d) return;
    if (d.ok) shopify.toast.show(t(`certificates.toast.${d.intent}`));
    else shopify.toast.show(t(`certificates.error.${d.error ?? "generic"}`), { isError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  };
  const submit = (intent: string, id: string, extra: Record<string, string> = {}) =>
    fetcher.submit({ intent, id, ...extra }, { method: "POST" });

  const regionName = (code: string | null) => {
    if (!code) return "";
    try {
      return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

  const openFile = async (id: string) => {
    // Opened before the fetch so the browser treats it as the click's popup.
    const win = window.open("", "_blank");
    try {
      const res = await fetch(`/app/files/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.replace(url);
      else window.open(url, "_blank");
    } catch {
      win?.close();
      shopify.toast.show(t("certificates.error.file"), { isError: true });
    }
  };

  const filtered = data.filters.status !== "all" || Boolean(data.filters.type);

  return (
    <s-page heading={t("certificates.title")}>
      {data.gated && (
        <s-banner tone="info" heading={t("common.availableOn", { plan: t(`certificates.plan.${data.requiredPlan}`) })}>
          <s-paragraph>{t("certificates.gated.body")}</s-paragraph>
          <s-button slot="secondary-actions" href={href("/app/settings")}>{t("certificates.gated.action")}</s-button>
        </s-banner>
      )}

      <s-section padding="none">
        <s-stack direction="block" gap="base" padding="base">
          <s-paragraph color="subdued">
            {data.autoRenewal
              ? t("certificates.rules.auto", { days: data.expiringDays })
              : t("certificates.rules.manual", { days: data.expiringDays })}{" "}
            <s-link href={href("/app/settings")}>{t("certificates.rules.change")}</s-link>
          </s-paragraph>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="small-200">
            <s-select label={t("certificates.filter.status")} value={data.filters.status} onChange={(e) => setParam("status", (e.currentTarget as unknown as HTMLSelectElement).value === "all" ? null : (e.currentTarget as unknown as HTMLSelectElement).value)}>
              {STATUS_FILTERS.map((s) => (
                <s-option key={s} value={s}>{t(`certificates.filter.status.${s}`)}</s-option>
              ))}
            </s-select>
            <s-select label={t("certificates.filter.type")} value={data.filters.type} onChange={(e) => setParam("type", (e.currentTarget as unknown as HTMLSelectElement).value || null)}>
              <s-option value="">{t("certificates.filter.anyType")}</s-option>
              {CERTIFICATE_TYPES.map((ty) => (
                <s-option key={ty} value={ty}>{t(`certificates.type.${ty}`)}</s-option>
              ))}
            </s-select>
          </s-grid>
        </s-stack>

        {data.rows.length === 0 ? (
          <s-stack direction="block" gap="base" alignItems="center" padding="large">
            <s-heading>{t(filtered ? "certificates.noResults.heading" : "certificates.empty.heading")}</s-heading>
            <s-paragraph>{t(filtered ? "certificates.noResults.body" : "certificates.empty.body")}</s-paragraph>
            {filtered ? (
              <s-button onClick={() => setParams(new URLSearchParams())}>{t("certificates.noResults.action")}</s-button>
            ) : (
              <s-button href={href("/app/applications")}>{t("certificates.empty.action")}</s-button>
            )}
          </s-stack>
        ) : (
          <s-table
            paginate={data.pages > 1}
            hasNextPage={data.filters.page < data.pages}
            hasPreviousPage={data.filters.page > 1}
            onNextPage={() => setParam("page", String(data.filters.page + 1))}
            onPreviousPage={() => setParam("page", String(data.filters.page - 1))}
          >
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("certificates.col.holder")}</s-table-header>
              <s-table-header listSlot="secondary">{t("certificates.col.type")}</s-table-header>
              <s-table-header>{t("certificates.col.jurisdiction")}</s-table-header>
              <s-table-header>{t("certificates.col.number")}</s-table-header>
              <s-table-header>{t("certificates.col.expiry")}</s-table-header>
              <s-table-header listSlot="kicker">{t("certificates.col.status")}</s-table-header>
              <s-table-header>{t("certificates.col.actions")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.rows.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    <s-stack direction="block">
                      {r.buyerId ? (
                        <s-link href={href(`/app/buyers/${r.buyerId}`)}>{r.name}</s-link>
                      ) : r.applicationId ? (
                        <s-link href={href(`/app/applications/${r.applicationId}`)}>{r.name}</s-link>
                      ) : (
                        <s-text>{r.name}</s-text>
                      )}
                      <s-text color="subdued">{t(r.isBuyer ? "certificates.holder.buyer" : "certificates.holder.applicant")}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{t(`certificates.type.${r.type}`)}</s-table-cell>
                  <s-table-cell>
                    {r.country
                      ? r.region
                        ? t("certificates.jurisdiction", { country: regionName(r.country), region: r.region })
                        : regionName(r.country)
                      : "—"}
                  </s-table-cell>
                  <s-table-cell>
                    <span dir="ltr">{r.number || "—"}</span>
                  </s-table-cell>
                  <s-table-cell>
                    {r.expiresOn ? (
                      <s-stack direction="block">
                        <s-text>{date(r.expiresOn)}</s-text>
                        {r.pastExpiry && <s-text color="subdued">{t("certificates.flag.pastExpiry")}</s-text>}
                      </s-stack>
                    ) : (
                      <s-badge tone="warning">{t("certificates.flag.noExpiry")}</s-badge>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-300">
                      <s-badge tone={TONE[r.status]}>{t(`certificates.status.${r.status}`)}</s-badge>
                      {r.needsDecision && <s-text>{t("certificates.decision.needed")}</s-text>}
                      {r.decided && <s-text color="subdued">{t(`certificates.decision.${r.decided}`)}</s-text>}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200">
                      {r.hasFile && (
                        <s-button variant="tertiary" onClick={() => openFile(r.id)} accessibilityLabel={t("certificates.action.viewFor", { name: r.name })}>
                          {t("certificates.action.view")}
                        </s-button>
                      )}
                      <s-button commandFor="cert-actions" command="--show" disabled={data.gated} onClick={() => setCurrent(r)} accessibilityLabel={t("certificates.action.manageFor", { name: r.name })}>
                        {t("certificates.action.manage")}
                      </s-button>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <ManageModal row={current} busy={busy} onSubmit={submit} />
      <RejectModal row={current} onSubmit={submit} />
      <ExpiryModal key={current?.id ?? "none"} row={current} onSubmit={submit} />
      <RemoveExemptionModal row={current} onSubmit={submit} />
    </s-page>
  );
}

type Submit = (intent: string, id: string, extra?: Record<string, string>) => void;

function ManageModal({ row, busy, onSubmit }: { row: Row | null; busy: boolean; onSubmit: Submit }) {
  const { t } = useI18n();
  return (
    <s-modal id="cert-actions" heading={row ? t("certificates.manage.heading", { name: row.name }) : t("certificates.title")}>
      {row && (
        <s-stack direction="block" gap="base">
          {row.rejectReason && row.status === "rejected" && <s-paragraph>{t("certificates.manage.rejectedBecause", { reason: row.rejectReason })}</s-paragraph>}
          <s-stack direction="inline" gap="small-200">
            {row.status !== "valid" && row.status !== "expiring" && (
              <s-button commandFor="cert-actions" command="--hide" disabled={busy} onClick={() => onSubmit("approve", row.id)}>
                {t("certificates.action.approve")}
              </s-button>
            )}
            {row.status !== "rejected" && (
              <s-button commandFor="cert-reject" command="--show">{t("certificates.action.reject")}</s-button>
            )}
            <s-button commandFor="cert-actions" command="--hide" disabled={busy} onClick={() => onSubmit("request", row.id)}>
              {t("certificates.action.request")}
            </s-button>
            <s-button commandFor="cert-expiry" command="--show">
              {t(row.expiresOn ? "certificates.action.editExpiry" : "certificates.action.setExpiry")}
            </s-button>
          </s-stack>
          {row.needsDecision && (
            <s-stack direction="block" gap="small-200">
              <s-heading>{t("certificates.decision.heading")}</s-heading>
              <s-paragraph>{t("certificates.decision.body")}</s-paragraph>
              <s-stack direction="inline" gap="small-200">
                <s-button commandFor="cert-actions" command="--hide" onClick={() => onSubmit("expiry_keep", row.id)}>
                  {t("certificates.decision.keep")}
                </s-button>
                <s-button tone="critical" commandFor="cert-remove" command="--show" disabled={!row.exemption}>
                  {t("certificates.decision.remove")}
                </s-button>
              </s-stack>
              {!row.exemption && <s-text color="subdued">{t("certificates.decision.unknownExemption")}</s-text>}
            </s-stack>
          )}
        </s-stack>
      )}
      <s-button slot="secondary-actions" commandFor="cert-actions" command="--hide">{t("common.cancel")}</s-button>
    </s-modal>
  );
}

function RejectModal({ row, onSubmit }: { row: Row | null; onSubmit: Submit }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  return (
    <s-modal id="cert-reject" heading={t("certificates.reject.heading", { name: row?.name ?? "" })}>
      <s-stack direction="block" gap="base">
        <s-paragraph>{t("certificates.reject.body")}</s-paragraph>
        <s-text-area label={t("certificates.reject.reason")} details={t("certificates.reject.reasonHelp")} value={reason} onInput={(e) => setReason((e.currentTarget as unknown as HTMLTextAreaElement).value)} />
      </s-stack>
      <s-button slot="primary-action" variant="primary" tone="critical" commandFor="cert-reject" command="--hide"
        onClick={() => { if (row) onSubmit("reject", row.id, { reason }); setReason(""); }}>
        {t("certificates.reject.confirm")}
      </s-button>
      <s-button slot="secondary-actions" commandFor="cert-reject" command="--hide">{t("common.cancel")}</s-button>
    </s-modal>
  );
}

function ExpiryModal({ row, onSubmit }: { row: Row | null; onSubmit: Submit }) {
  const { t } = useI18n();
  const [value, setValue] = useState(row?.expiresOn ?? "");
  return (
    <s-modal id="cert-expiry" heading={t("certificates.expiry.heading", { name: row?.name ?? "" })}>
      <s-stack direction="block" gap="base">
        <s-date-field label={t("certificates.expiry.label")} details={t("certificates.expiry.help")} value={value}
          onChange={(e) => setValue((e.currentTarget as unknown as HTMLInputElement).value)} />
      </s-stack>
      <s-button slot="primary-action" variant="primary" commandFor="cert-expiry" command="--hide" onClick={() => row && onSubmit("set_expiry", row.id, { expiresOn: value })}>
        {t("common.save")}
      </s-button>
      <s-button slot="secondary-actions" commandFor="cert-expiry" command="--hide">{t("common.cancel")}</s-button>
    </s-modal>
  );
}

function RemoveExemptionModal({ row, onSubmit }: { row: Row | null; onSubmit: Submit }) {
  const { t } = useI18n();
  return (
    <s-modal id="cert-remove" heading={t("certificates.remove.heading", { name: row?.name ?? "" })}>
      <s-paragraph>{t("certificates.remove.body", { name: row?.name ?? "", exemption: row?.exemption ?? "" })}</s-paragraph>
      <s-button slot="primary-action" variant="primary" tone="critical" commandFor="cert-remove" command="--hide" onClick={() => row && onSubmit("expiry_remove", row.id)}>
        {t("certificates.remove.confirm")}
      </s-button>
      <s-button slot="secondary-actions" commandFor="cert-remove" command="--hide">{t("common.cancel")}</s-button>
    </s-modal>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
