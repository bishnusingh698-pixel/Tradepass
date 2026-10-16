import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { adminContext } from "../lib/context.server";
import { buyerDetail, moveBuyers, pauseBuyers, resumeBuyers, shopifyInfo, summarizeCertificates } from "../lib/buyers.server";
import { requestRenewalForBuyers } from "../lib/certificates.server";
import { adminUrl } from "../lib/tiers.server";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";
import { CertBadge } from "../components/CertBadge";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const d = await buyerDetail(ctx.shop, params.id!);
  if (!d) throw new Response("Not found", { status: 404 });
  const info = (await shopifyInfo(ctx.admin, [d.buyer.companyGid]))[d.buyer.companyGid] ?? null;
  const tierName = (id: string | null) => d.tiers.find((x) => x.id === id)?.name ?? null;
  return {
    buyer: {
      id: d.buyer.id, name: d.buyer.name, status: d.buyer.status, country: d.buyer.country, source: d.buyer.source,
      approvedAt: d.buyer.approvedAt.toISOString(), taxExemptions: d.buyer.taxExemptions, locations: d.buyer.locationGids.length,
      tierId: d.buyer.tierId ?? d.buyer.pausedTierId, tierName: tierName(d.buyer.tierId ?? d.buyer.pausedTierId),
      companyUrl: adminUrl.company(d.buyer.companyGid),
    },
    info,
    missingInShopify: info === null,
    tiers: d.tiers,
    certSummary: summarizeCertificates(d.certificates.filter((c) => c.status !== "rejected").map((c) => c.status)),
    certificates: d.certificates.map((c) => ({
      id: c.id, type: c.type, country: c.country, region: c.region, status: c.status,
      expiresOn: c.expiresOn?.toISOString() ?? null,
    })),
    history: d.history.map((a) => ({ id: a.id, at: a.createdAt.toISOString(), action: a.action, actor: a.actor, result: a.result, detail: a.detail as Record<string, unknown> | null })),
    activity: d.activity.map((a) => ({ id: a.id, at: a.createdAt.toISOString(), action: a.action, actor: a.actor, result: a.result })),
    renewals: d.renewals.map((a) => ({ id: a.id, at: a.createdAt.toISOString(), result: a.result })),
    applicationId: d.applicationId,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const tctx = { admin: ctx.admin, shop: ctx.shop, actor: ctx.actor };
  const id = params.id!;
  try {
    if (intent === "renewal") {
      const n = await requestRenewalForBuyers(ctx.shop, [id]);
      return { ok: true, message: ctx.t("buyers.bulk.renewalSent", { count: n }) };
    }
    const s =
      intent === "move" ? await moveBuyers(tctx, [id], String(form.get("tierId") ?? "") || null)
      : intent === "pause" ? await pauseBuyers(tctx, [id])
      : intent === "resume" ? await resumeBuyers(tctx, [id])
      : null;
    if (!s) return { ok: false, message: ctx.t("errors.generic") };
    if (s.failed.length) return { ok: false, message: ctx.t(`buyers.error.${s.failed[0].code}`) };
    if (s.pending.length) return { ok: true, message: ctx.t("buyers.detail.assistedPending") };
    return { ok: true, message: ctx.t(`buyers.detail.done.${intent}`) };
  } catch {
    return { ok: false, message: ctx.t("errors.generic") };
  }
};

export default function BuyerDetail() {
  const d = useLoaderData<typeof loader>();
  const { t, locale } = useI18n();
  const href = useLocaleHref();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [moveTo, setMoveTo] = useState(d.buyer.tierId ?? "");
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));
  const dateTime = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  const label = (action: string) => {
    const k = `buyers.activity.${action}`;
    const s = t(k);
    return s === k ? action : s;
  };
  const tierName = (id: unknown) => d.tiers.find((x) => x.id === id)?.name ?? t("buyers.tier.none");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
      for (const id of ["change-tier", "pause-buyer"]) (document.getElementById(id) as (HTMLElement & { hideOverlay?: () => void }) | null)?.hideOverlay?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const post = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    fetcher.submit(fd, { method: "POST" });
  };
  const paused = d.buyer.status === "paused";

  return (
    <s-page heading={d.buyer.name}>
      <s-link slot="breadcrumb-actions" href={href("/app/buyers")}>{t("buyers.title")}</s-link>
      <s-button slot="primary-action" variant="primary" commandFor="change-tier" command="--show">{t("buyers.detail.changeTier")}</s-button>
      <s-button slot="secondary-actions" href={d.buyer.companyUrl} target="_top">{t("buyers.detail.openInShopify")}</s-button>
      <s-button slot="secondary-actions" onClick={() => post({ intent: "renewal" })}>{t("buyers.bulk.renewal")}</s-button>
      {paused ? (
        <s-button slot="secondary-actions" onClick={() => post({ intent: "resume" })}>{t("buyers.detail.resume")}</s-button>
      ) : (
        <s-button slot="secondary-actions" commandFor="pause-buyer" command="--show">{t("buyers.detail.pause")}</s-button>
      )}

      {d.missingInShopify && (
        <s-banner tone="warning">
          <s-paragraph>{t("buyers.detail.missingInShopify")}</s-paragraph>
        </s-banner>
      )}

      <s-section heading={t("buyers.detail.summary")}>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
          <Fact label={t("buyers.col.tier")}>
            <s-stack direction="inline" gap="small-100">
              <s-text>{d.buyer.tierName ?? t("buyers.tier.none")}</s-text>
              <s-badge tone={paused ? "warning" : "success"}>{t(`buyers.status.${d.buyer.status}`)}</s-badge>
            </s-stack>
          </Fact>
          <Fact label={t("buyers.col.contact")}>{d.info?.contactName ?? "—"}</Fact>
          <Fact label={t("buyers.col.terms")}>{d.info?.terms ?? "—"}</Fact>
          <Fact label={t("buyers.col.tax")}>
            {d.info?.taxExempt == null ? "—" : t(d.info.taxExempt ? "buyers.tax.exempt" : "buyers.tax.charged")}
            {d.buyer.taxExemptions.length > 0 && ` (${d.buyer.taxExemptions.length})`}
          </Fact>
          <Fact label={t("buyers.col.certificates")}><CertBadge status={d.certSummary} /></Fact>
          <Fact label={t("buyers.col.orders")}>
            {d.info?.orders
              ? `${d.info.orders.count} · ${new Intl.NumberFormat(locale, { style: "currency", currency: d.info.orders.currency || "USD" }).format(Number(d.info.orders.total))}`
              : "—"}
          </Fact>
          <Fact label={t("buyers.col.approved")}>{date(d.buyer.approvedAt)}</Fact>
          <Fact label={t("buyers.col.source")}>
            {d.applicationId ? (
              <s-link href={href(`/app/applications/${d.applicationId}`)}>{t(`buyers.source.${d.buyer.source}`)}</s-link>
            ) : (
              t(`buyers.source.${d.buyer.source}`)
            )}
          </Fact>
          <Fact label={t("buyers.detail.locations")}>{d.buyer.locations}</Fact>
        </s-grid>
      </s-section>

      <s-section heading={t("buyers.detail.tierHistory")}>
        {d.history.length === 0 ? (
          <s-paragraph>{t("buyers.detail.noHistory")}</s-paragraph>
        ) : (
          <s-unordered-list>
            {d.history.map((h) => (
              <s-list-item key={h.id}>
                {dateTime(h.at)} · {label(h.action)}
                {h.detail && "to" in h.detail ? ` → ${tierName(h.detail.to)}` : ""}
                {h.detail && "tierId" in h.detail ? ` · ${tierName(h.detail.tierId)}` : ""}
                {h.result === "failed" ? ` · ${t("buyers.detail.failed")}` : ""} · {h.actor}
              </s-list-item>
            ))}
          </s-unordered-list>
        )}
      </s-section>

      <s-section heading={t("buyers.detail.certificates")}>
        {d.certificates.length === 0 ? (
          <s-paragraph>{t("buyers.detail.noCertificates")}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("buyers.detail.certType")}</s-table-header>
              <s-table-header>{t("buyers.detail.certJurisdiction")}</s-table-header>
              <s-table-header>{t("buyers.detail.certExpires")}</s-table-header>
              <s-table-header listSlot="inline">{t("buyers.detail.certStatus")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {d.certificates.map((c) => (
                <s-table-row key={c.id}>
                  <s-table-cell>{t(`buyers.certType.${c.type}`)}</s-table-cell>
                  <s-table-cell>{[c.country, c.region].filter(Boolean).join(" · ") || "—"}</s-table-cell>
                  <s-table-cell>{c.expiresOn ? date(c.expiresOn) : t("buyers.detail.noExpiry")}</s-table-cell>
                  <s-table-cell><CertBadge status={c.status} /></s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
        {d.renewals.length > 0 && (
          <s-paragraph>{t("buyers.detail.renewalsSent", { count: d.renewals.length, date: dateTime(d.renewals[0].at) })}</s-paragraph>
        )}
      </s-section>

      <s-section heading={t("buyers.detail.activity")}>
        {d.activity.length === 0 ? (
          <s-paragraph>{t("buyers.detail.noActivity")}</s-paragraph>
        ) : (
          <s-unordered-list>
            {d.activity.map((a) => (
              <s-list-item key={a.id}>
                {dateTime(a.at)} · {label(a.action)} · {a.actor}{a.result === "failed" ? ` · ${t("buyers.detail.failed")}` : ""}
              </s-list-item>
            ))}
          </s-unordered-list>
        )}
        <s-paragraph tone="neutral">{t("buyers.detail.neverDeletes")}</s-paragraph>
      </s-section>

      <s-modal id="change-tier" heading={t("buyers.detail.changeTierHeading", { company: d.buyer.name })}>
        <s-stack direction="block" gap="base">
          <s-select label={t("buyers.move.tier")} value={moveTo} onChange={(e) => setMoveTo(e.currentTarget.value)}>
            <s-option value="">{t("buyers.move.choose")}</s-option>
            {d.tiers.map((x) => <s-option key={x.id} value={x.id}>{x.name}</s-option>)}
          </s-select>
          {moveTo && moveTo !== d.buyer.tierId && (
            <s-paragraph>{t("buyers.move.consequence", { count: 1, tier: tierName(moveTo) })}</s-paragraph>
          )}
        </s-stack>
        <s-button slot="primary-action" variant="primary" disabled={!moveTo || moveTo === d.buyer.tierId} loading={fetcher.state !== "idle"}
          onClick={() => post({ intent: "move", tierId: moveTo })}>
          {t("buyers.move.confirm")}
        </s-button>
        <s-button slot="secondary-actions" commandFor="change-tier" command="--hide">{t("common.cancel")}</s-button>
      </s-modal>

      <s-modal id="pause-buyer" heading={t("buyers.pause.heading", { count: 1 })}>
        <s-paragraph>{t("buyers.pause.body", { count: 1 })}</s-paragraph>
        <s-button slot="primary-action" variant="primary" tone="critical" loading={fetcher.state !== "idle"} onClick={() => post({ intent: "pause" })}>
          {t("buyers.pause.confirm")}
        </s-button>
        <s-button slot="secondary-actions" commandFor="pause-buyer" command="--hide">{t("common.cancel")}</s-button>
      </s-modal>
    </s-page>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <s-stack direction="block" gap="small-100">
      <s-text color="subdued">{label}</s-text>
      <s-text>{children}</s-text>
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
