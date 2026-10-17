import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import db from "../db.server";
import { adminContext } from "../lib/context.server";
import { exportCsv, listApplications, parseFilters, rejectApplication } from "../lib/applications.server";
import { TABS, type Tab } from "../lib/applications";
import { approveMany } from "../lib/approval.server";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";
import { CountryName, TaxCheckBadge, StatusBadge, RelativeTime } from "../components/applications";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const url = new URL(request.url);
  const filters = parseFilters(url);
  if (url.searchParams.get("export") === "csv") {
    const csv = await exportCsv(ctx.shop, null, filters);
    return new Response(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="applications.csv"` },
    });
  }
  const [list, tiers, forms, countries, businessTypes] = await Promise.all([
    listApplications(ctx.shop, filters),
    db.tier.findMany({ where: { shop: ctx.shop }, select: { id: true, name: true }, orderBy: { position: "asc" } }),
    db.form.findMany({ where: { shop: ctx.shop }, select: { id: true, name: true } }),
    db.application.findMany({ where: { shop: ctx.shop, countryCode: { not: null } }, select: { countryCode: true }, distinct: ["countryCode"] }),
    db.application.findMany({ where: { shop: ctx.shop, businessType: { not: null } }, select: { businessType: true }, distinct: ["businessType"] }),
  ]);
  return {
    ...list,
    filters,
    tiers,
    forms,
    countries: countries.map((c) => c.countryCode!).sort(),
    businessTypes: businessTypes.map((b) => b.businessType!).sort(),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const ids = form.getAll("ids").map(String).slice(0, 100);
  if (!ids.length) return { ok: false as const, error: "none_selected" };
  const dctx = { admin: ctx.admin, shop: ctx.shop, actor: ctx.actor };

  if (intent === "bulk_approve") {
    const tierId = String(form.get("tierId") ?? "");
    if (!tierId) return { ok: false as const, error: "tier_required" };
    const summary = await approveMany(dctx, ids, tierId);
    return { ok: true as const, intent, summary };
  }
  if (intent === "bulk_reject") {
    const reason = String(form.get("reason") ?? "").trim() || null;
    const email = form.get("email") === "on";
    let rejected = 0;
    for (const id of ids) if (await rejectApplication(dctx, id, { reason, email })) rejected++;
    return { ok: true as const, intent, rejected, skipped: ids.length - rejected };
  }
  if (intent === "bulk_export") {
    const csv = await exportCsv(ctx.shop, ids);
    return { ok: true as const, intent, csv };
  }
  return { ok: false as const, error: "unknown_intent" };
};

type LoaderData = ReturnType<typeof useLoaderData<typeof loader>>;

export default function Applications() {
  const data = useLoaderData<typeof loader>() as Exclude<LoaderData, Response>;
  const { t, number } = useI18nNumber();
  const href = useLocaleHref();
  const [params, setParams] = useSearchParams();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState(data.filters.q ?? "");

  // Clear the selection when the page of rows changes (React's "adjust state during render" pattern).
  const [rowsSeen, setRowsSeen] = useState(data.rows);
  if (rowsSeen !== data.rows) {
    setRowsSeen(data.rows);
    setSelected([]);
  }

  useEffect(() => {
    const d = fetcher.data;
    if (!d || !d.ok) return;
    if (d.intent === "bulk_export" && "csv" in d) download(d.csv ?? "", "applications.csv");
    if (d.intent === "bulk_reject" && "rejected" in d) shopify.toast.show(t("applications.bulk.rejectedToast", { count: d.rejected ?? 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  };

  const allChecked = data.rows.length > 0 && selected.length === data.rows.length;
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const submitBulk = (intent: string, extra: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.set("intent", intent);
    selected.forEach((id) => fd.append("ids", id));
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    fetcher.submit(fd, { method: "POST" });
  };

  const summary = fetcher.data && fetcher.data.ok && fetcher.data.intent === "bulk_approve" && "summary" in fetcher.data ? fetcher.data.summary : null;
  const csvHref = useMemo(() => {
    const p = new URLSearchParams(params);
    p.set("export", "csv");
    return `?${p}`;
  }, [params]);

  return (
    <s-page heading={t("applications.title")}>
      <s-button slot="secondary-actions" href={csvHref} target="_blank">
        {t("applications.exportAll")}
      </s-button>

      <s-section padding="none">
        <s-stack direction="block" gap="base" padding="base">
          <s-stack direction="inline" gap="small-200" accessibilityRole="navigation" accessibilityLabel={t("applications.tabsLabel")}>
            {TABS.map((tab: Tab) => (
              <s-button
                key={tab}
                variant={data.filters.tab === tab ? "primary" : "secondary"}
                onClick={() => setParam("tab", tab)}
                accessibilityLabel={t(`applications.tab.${tab}`) + ` (${data.tabCounts[tab] ?? 0})`}
              >
                {t(`applications.tab.${tab}`)} ({number(data.tabCounts[tab] ?? 0)})
              </s-button>
            ))}
          </s-stack>

          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="small-200">
            <s-search-field
              label={t("applications.search.label")}
              labelAccessibilityVisibility="exclusive"
              placeholder={t("applications.search.placeholder")}
              value={search}
              onInput={(e) => setSearch((e.currentTarget as unknown as HTMLInputElement).value)}
              onChange={() => setParam("q", search || null)}
            />
            <s-select label={t("applications.filter.country")} value={data.filters.country ?? ""} onChange={(e) => setParam("country", (e.currentTarget as unknown as HTMLSelectElement).value || null)}>
              <s-option value="">{t("applications.filter.any")}</s-option>
              {data.countries.map((c) => (
                <s-option key={c} value={c}>{countryLabel(c)}</s-option>
              ))}
            </s-select>
            <s-select label={t("applications.filter.businessType")} value={data.filters.businessType ?? ""} onChange={(e) => setParam("businessType", (e.currentTarget as unknown as HTMLSelectElement).value || null)}>
              <s-option value="">{t("applications.filter.any")}</s-option>
              {data.businessTypes.map((b) => (
                <s-option key={b} value={b}>{t(`applications.businessType.${b}`) === `applications.businessType.${b}` ? b : t(`applications.businessType.${b}`)}</s-option>
              ))}
            </s-select>
            <s-select label={t("applications.filter.taxCheck")} value={data.filters.taxCheck ?? ""} onChange={(e) => setParam("taxCheck", (e.currentTarget as unknown as HTMLSelectElement).value || null)}>
              <s-option value="">{t("applications.filter.any")}</s-option>
              {["verified", "not_verified", "unavailable", "na"].map((v) => (
                <s-option key={v} value={v}>{t(`applications.taxCheck.${v}`)}</s-option>
              ))}
            </s-select>
            <s-select label={t("applications.filter.certificate")} value={data.filters.hasCertificate ?? ""} onChange={(e) => setParam("hasCertificate", (e.currentTarget as unknown as HTMLSelectElement).value || null)}>
              <s-option value="">{t("applications.filter.any")}</s-option>
              <s-option value="yes">{t("applications.certificate.uploaded")}</s-option>
              <s-option value="no">{t("applications.certificate.missing")}</s-option>
            </s-select>
            <s-select label={t("applications.filter.flags")} value={data.filters.flag ?? ""} onChange={(e) => setParam("flag", (e.currentTarget as unknown as HTMLSelectElement).value || null)}>
              <s-option value="">{t("applications.filter.any")}</s-option>
              <s-option value="duplicate">{t("applications.flag.duplicate")}</s-option>
              <s-option value="possible_spam">{t("applications.flag.possible_spam")}</s-option>
            </s-select>
            {data.forms.length > 1 && (
              <s-select label={t("applications.filter.form")} value={data.filters.formId ?? ""} onChange={(e) => setParam("formId", (e.currentTarget as unknown as HTMLSelectElement).value || null)}>
                <s-option value="">{t("applications.filter.any")}</s-option>
                {data.forms.map((f) => (
                  <s-option key={f.id} value={f.id}>{f.name}</s-option>
                ))}
              </s-select>
            )}
            <s-date-field label={t("applications.filter.from")} value={data.filters.from ?? ""} onChange={(e) => setParam("from", (e.currentTarget as unknown as HTMLInputElement).value || null)} />
            <s-date-field label={t("applications.filter.to")} value={data.filters.to ?? ""} onChange={(e) => setParam("to", (e.currentTarget as unknown as HTMLInputElement).value || null)} />
            <s-select label={t("applications.sort.label")} value={data.filters.sort ?? "newest"} onChange={(e) => setParam("sort", (e.currentTarget as unknown as HTMLSelectElement).value)}>
              <s-option value="newest">{t("applications.sort.newest")}</s-option>
              <s-option value="oldest">{t("applications.sort.oldest")}</s-option>
              <s-option value="company">{t("applications.sort.company")}</s-option>
            </s-select>
          </s-grid>

          {selected.length > 0 && (
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text>{t("applications.bulk.selected", { count: selected.length })}</s-text>
              <s-button commandFor="bulk-approve" command="--show">{t("applications.bulk.approve")}</s-button>
              <s-button commandFor="bulk-reject" command="--show">{t("applications.bulk.reject")}</s-button>
              <s-button variant="tertiary" onClick={() => submitBulk("bulk_export")}>{t("applications.bulk.export")}</s-button>
            </s-stack>
          )}

          {summary && (
            <s-banner tone={summary.skipped.length ? "warning" : "success"} heading={t("applications.bulk.approvedSummary", { count: summary.approved.length })}>
              {summary.skipped.length > 0 && (
                <s-unordered-list>
                  {summary.skipped.map((s: { id: string; company: string; reason: string }) => (
                    <s-list-item key={s.id}>{t("applications.bulk.skippedLine", { company: s.company, reason: s.reason })}</s-list-item>
                  ))}
                </s-unordered-list>
              )}
            </s-banner>
          )}
        </s-stack>

        {data.rows.length === 0 ? (
          <s-stack direction="block" gap="base" alignItems="center" padding="large">
            <s-heading>{t(data.filters.tab === "pending" && !data.filters.q ? "applications.empty.heading" : "applications.noResults.heading")}</s-heading>
            <s-paragraph>{t(data.filters.tab === "pending" && !data.filters.q ? "applications.empty.body" : "applications.noResults.body")}</s-paragraph>
            {data.filters.tab === "pending" && !data.filters.q && (
              <s-button href={href("/app/form")}>{t("applications.empty.action")}</s-button>
            )}
          </s-stack>
        ) : (
          <s-table
            paginate={data.pages > 1}
            hasNextPage={(data.filters.page ?? 1) < data.pages}
            hasPreviousPage={(data.filters.page ?? 1) > 1}
            onNextPage={() => setParam("page", String((data.filters.page ?? 1) + 1))}
            onPreviousPage={() => setParam("page", String((data.filters.page ?? 1) - 1))}
          >
            <s-table-header-row>
              <s-table-header listSlot="inline">
                <s-checkbox
                  accessibilityLabel={t("applications.selectAll")}
                  checked={allChecked}
                  onChange={() => setSelected(allChecked ? [] : data.rows.map((r) => r.id))}
                />
              </s-table-header>
              <s-table-header listSlot="primary">{t("applications.col.company")}</s-table-header>
              <s-table-header listSlot="secondary">{t("applications.col.contact")}</s-table-header>
              <s-table-header>{t("applications.col.country")}</s-table-header>
              <s-table-header>{t("applications.col.businessType")}</s-table-header>
              <s-table-header>{t("applications.col.submitted")}</s-table-header>
              <s-table-header>{t("applications.col.taxCheck")}</s-table-header>
              <s-table-header>{t("applications.col.certificate")}</s-table-header>
              <s-table-header>{t("applications.col.flags")}</s-table-header>
              <s-table-header listSlot="kicker">{t("applications.col.status")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.rows.map((r) => (
                <s-table-row key={r.id} clickDelegate={`open-${r.id}`}>
                  <s-table-cell>
                    <s-checkbox
                      accessibilityLabel={t("applications.selectRow", { company: r.companyName })}
                      checked={selected.includes(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </s-table-cell>
                  <s-table-cell>
                    <s-link id={`open-${r.id}`} href={href(`/app/applications/${r.id}?back=${encodeURIComponent(params.toString())}`)}>
                      {r.companyName}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="block">
                      <s-text>{r.contactName}</s-text>
                      <s-text color="subdued">{r.email}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{r.countryCode ? <CountryName code={r.countryCode} /> : "—"}</s-table-cell>
                  <s-table-cell>{r.businessType ? (t(`applications.businessType.${r.businessType}`) === `applications.businessType.${r.businessType}` ? r.businessType : t(`applications.businessType.${r.businessType}`)) : "—"}</s-table-cell>
                  <s-table-cell><RelativeTime iso={r.submittedAt} /></s-table-cell>
                  <s-table-cell><TaxCheckBadge value={r.taxCheck} /></s-table-cell>
                  <s-table-cell>{r.hasCertificate ? t("applications.certificate.uploaded") : t("applications.certificate.missing")}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-300">
                      {r.flags.map((f) => (
                        <s-badge key={f} tone="warning">{t(`applications.flag.${f}`)}</s-badge>
                      ))}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell><StatusBadge status={r.status} /></s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <BulkApproveModal tiers={data.tiers} count={selected.length} onConfirm={(tierId) => submitBulk("bulk_approve", { tierId })} />
      <BulkRejectModal count={selected.length} onConfirm={(reason, email) => submitBulk("bulk_reject", { reason, ...(email ? { email: "on" } : {}) })} />
    </s-page>
  );
}

function BulkApproveModal({ tiers, count, onConfirm }: { tiers: { id: string; name: string }[]; count: number; onConfirm: (tierId: string) => void }) {
  const { t } = useI18n();
  const href = useLocaleHref();
  const [tierId, setTierId] = useState(tiers[0]?.id ?? "");
  return (
    <s-modal id="bulk-approve" heading={t("applications.bulk.approveHeading", { count })}>
      {tiers.length === 0 ? (
        <s-paragraph>
          {t("applications.bulk.noTiers")} <s-link href={href("/app/tiers")}>{t("applications.bulk.createTier")}</s-link>
        </s-paragraph>
      ) : (
        <s-stack direction="block" gap="base">
          <s-select label={t("applications.bulk.tier")} value={tierId} onChange={(e) => setTierId((e.currentTarget as unknown as HTMLSelectElement).value)}>
            {tiers.map((tier) => (
              <s-option key={tier.id} value={tier.id}>{tier.name}</s-option>
            ))}
          </s-select>
          <s-paragraph>{t("applications.bulk.approveExplain")}</s-paragraph>
        </s-stack>
      )}
      <s-button slot="primary-action" variant="primary" disabled={!tierId} commandFor="bulk-approve" command="--hide" onClick={() => onConfirm(tierId)}>
        {t("applications.bulk.approveConfirm", { count })}
      </s-button>
      <s-button slot="secondary-actions" commandFor="bulk-approve" command="--hide">{t("common.cancel")}</s-button>
    </s-modal>
  );
}

function BulkRejectModal({ count, onConfirm }: { count: number; onConfirm: (reason: string, email: boolean) => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState(true);
  return (
    <s-modal id="bulk-reject" heading={t("applications.bulk.rejectHeading", { count })}>
      <s-stack direction="block" gap="base">
        <s-text-area label={t("applications.reject.reason")} details={t("applications.reject.reasonHelp")} value={reason} onInput={(e) => setReason((e.currentTarget as unknown as HTMLTextAreaElement).value)} />
        <s-checkbox label={t("applications.reject.email")} checked={email} onChange={() => setEmail(!email)} />
      </s-stack>
      <s-button slot="primary-action" variant="primary" tone="critical" commandFor="bulk-reject" command="--hide" onClick={() => onConfirm(reason, email)}>
        {t("applications.bulk.rejectConfirm", { count })}
      </s-button>
      <s-button slot="secondary-actions" commandFor="bulk-reject" command="--hide">{t("common.cancel")}</s-button>
    </s-modal>
  );
}

function useI18nNumber() {
  const { t, locale } = useI18n();
  return { t, number: (n: number) => new Intl.NumberFormat(locale).format(n) };
}

function countryLabel(code: string) {
  try {
    return new Intl.DisplayNames([document.documentElement.lang || "en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
