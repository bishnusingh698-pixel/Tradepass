import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { adminContext } from "../lib/context.server";
import {
  buyerFilterOptions, exportBuyersCsv, listBuyers, moveBuyers, parseBuyerFilters, pauseBuyers, resumeBuyers, shopifyInfo,
  type MoveSummary,
} from "../lib/buyers.server";
import { CERT_FILTERS } from "../lib/buyers";
import { requestRenewalForBuyers } from "../lib/certificates.server";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";
import { CertBadge } from "../components/CertBadge";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const url = new URL(request.url);
  const filters = parseBuyerFilters(url);
  if (url.searchParams.get("export") === "csv") {
    return new Response(await exportBuyersCsv(ctx.shop, null), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="buyers.csv"` },
    });
  }
  const [list, options] = await Promise.all([listBuyers(ctx.shop, filters), buyerFilterOptions(ctx.shop)]);
  const info = await shopifyInfo(ctx.admin, list.rows.map((r) => r.companyGid));
  return {
    filters,
    total: list.total,
    pages: list.pages,
    rows: list.rows.map((b) => ({
      id: b.id, name: b.name, status: b.status, country: b.country, source: b.source, cert: b.cert,
      tierId: b.tierId ?? b.pausedTierId, approvedAt: b.approvedAt.toISOString(), taxExemptions: b.taxExemptions.length,
      info: info[b.companyGid] ?? null,
    })),
    tiers: options.tiers.map((x) => ({ id: x.id, name: x.name })),
    countries: options.countries,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const ids = form.getAll("ids").map(String).slice(0, 100);
  if (!ids.length) return { ok: false as const, intent, message: ctx.t("buyers.bulk.noneSelected") };
  const tctx = { admin: ctx.admin, shop: ctx.shop, actor: ctx.actor };
  const summarize = (s: MoveSummary, doneKey: string) => ({
    ok: s.failed.length === 0,
    intent,
    message: s.failed.length
      ? ctx.t("buyers.bulk.partial", { done: s.moved.length, failed: s.failed.length })
      : ctx.t(doneKey, { count: s.moved.length }),
    failed: s.failed.map((f) => ({ ...f, reason: ctx.t(`buyers.error.${f.code}`) })),
    pending: s.pending.length,
  });
  try {
    if (intent === "move") {
      const tierId = String(form.get("tierId") ?? "") || null;
      return summarize(await moveBuyers(tctx, ids, tierId), "buyers.bulk.moved");
    }
    if (intent === "pause") return summarize(await pauseBuyers(tctx, ids), "buyers.bulk.paused");
    if (intent === "resume") return summarize(await resumeBuyers(tctx, ids), "buyers.bulk.resumed");
    if (intent === "renewal") {
      const n = await requestRenewalForBuyers(ctx.shop, ids);
      return { ok: true as const, intent, message: ctx.t("buyers.bulk.renewalSent", { count: n }) };
    }
    if (intent === "export") return { ok: true as const, intent, csv: await exportBuyersCsv(ctx.shop, ids) };
  } catch {
    return { ok: false as const, intent, message: ctx.t("errors.generic") };
  }
  return { ok: false as const, intent, message: ctx.t("errors.generic") };
};

export default function Buyers() {
  const data = useLoaderData<typeof loader>() as Exclude<ReturnType<typeof useLoaderData<typeof loader>>, Response>;
  const { t, locale } = useI18n();
  const href = useLocaleHref();
  const shopify = useAppBridge();
  const [params, setParams] = useSearchParams();
  const fetcher = useFetcher<typeof action>();
  const [selected, setSelected] = useState<string[]>([]);
  const [moveTo, setMoveTo] = useState("");
  const [search, setSearch] = useState(data.filters.q ?? "");

  const [prevRows, setPrevRows] = useState(data.rows);
  if (prevRows !== data.rows) {
    setPrevRows(data.rows);
    setSelected([]);
  }
  useEffect(() => {
    const d = fetcher.data;
    if (fetcher.state !== "idle" || !d) return;
    if ("csv" in d && d.csv) download(d.csv, "buyers.csv");
    if ("message" in d && d.message) shopify.toast.show(d.message, { isError: !d.ok });
    for (const id of ["move-buyers", "pause-buyers"]) (document.getElementById(id) as (HTMLElement & { hideOverlay?: () => void }) | null)?.hideOverlay?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  };
  const submit = (intent: string, extra: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.set("intent", intent);
    selected.forEach((id) => fd.append("ids", id));
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    fetcher.submit(fd, { method: "POST" });
  };
  const tierName = (id: string | null) => data.tiers.find((x) => x.id === id)?.name ?? null;
  const allChecked = data.rows.length > 0 && selected.length === data.rows.length;
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const failed = fetcher.data && "failed" in fetcher.data ? fetcher.data.failed : [];
  const pending = fetcher.data && "pending" in fetcher.data ? fetcher.data.pending : 0;
  const filtered = Boolean(data.filters.tier || data.filters.cert || data.filters.country || data.filters.source || data.filters.status || data.filters.q);
  const csvHref = (() => {
    const p = new URLSearchParams(params);
    p.set("export", "csv");
    return `?${p}`;
  })();

  return (
    <s-page heading={t("buyers.title")}>
      <s-button slot="secondary-actions" href={csvHref} target="_blank">{t("buyers.exportAll")}</s-button>

      <s-section padding="none">
        <s-stack direction="block" gap="base" padding="base">
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))" gap="small-200">
            <s-search-field
              label={t("buyers.search.label")}
              labelAccessibilityVisibility="exclusive"
              placeholder={t("buyers.search.placeholder")}
              value={search}
              onInput={(e) => setSearch(e.currentTarget.value)}
              onChange={() => setParam("q", search || null)}
            />
            <s-select label={t("buyers.filter.tier")} value={data.filters.tier ?? ""} onChange={(e) => setParam("tier", e.currentTarget.value || null)}>
              <s-option value="">{t("buyers.filter.any")}</s-option>
              {data.tiers.map((x) => <s-option key={x.id} value={x.id}>{x.name}</s-option>)}
              <s-option value="none">{t("buyers.filter.noTier")}</s-option>
            </s-select>
            <s-select label={t("buyers.filter.cert")} value={data.filters.cert ?? ""} onChange={(e) => setParam("cert", e.currentTarget.value || null)}>
              <s-option value="">{t("buyers.filter.any")}</s-option>
              {CERT_FILTERS.map((c) => <s-option key={c} value={c}>{t(`buyers.cert.${c}`)}</s-option>)}
            </s-select>
            <s-select label={t("buyers.filter.country")} value={data.filters.country ?? ""} onChange={(e) => setParam("country", e.currentTarget.value || null)}>
              <s-option value="">{t("buyers.filter.any")}</s-option>
              {data.countries.map((c) => <s-option key={c} value={c}>{countryName(c, locale)}</s-option>)}
            </s-select>
            <s-select label={t("buyers.filter.source")} value={data.filters.source ?? ""} onChange={(e) => setParam("source", e.currentTarget.value || null)}>
              <s-option value="">{t("buyers.filter.any")}</s-option>
              {["application", "import", "tag"].map((s) => <s-option key={s} value={s}>{t(`buyers.source.${s}`)}</s-option>)}
            </s-select>
            <s-select label={t("buyers.filter.status")} value={data.filters.status ?? ""} onChange={(e) => setParam("status", e.currentTarget.value || null)}>
              <s-option value="">{t("buyers.filter.any")}</s-option>
              <s-option value="active">{t("buyers.status.active")}</s-option>
              <s-option value="paused">{t("buyers.status.paused")}</s-option>
            </s-select>
          </s-grid>

          {selected.length > 0 && (
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text>{t("buyers.bulk.selected", { count: selected.length })}</s-text>
              <s-button commandFor="move-buyers" command="--show">{t("buyers.bulk.move")}</s-button>
              <s-button onClick={() => submit("renewal")}>{t("buyers.bulk.renewal")}</s-button>
              <s-button commandFor="pause-buyers" command="--show">{t("buyers.bulk.pause")}</s-button>
              <s-button onClick={() => submit("resume")}>{t("buyers.bulk.resume")}</s-button>
              <s-button variant="tertiary" onClick={() => submit("export")}>{t("buyers.bulk.export")}</s-button>
            </s-stack>
          )}

          {failed.length > 0 && (
            <s-banner tone="critical" heading={t("buyers.bulk.failedHeading", { count: failed.length })}>
              <s-unordered-list>
                {failed.map((f) => <s-list-item key={f.id}>{t("buyers.bulk.failedLine", { company: f.name, reason: f.reason })}</s-list-item>)}
              </s-unordered-list>
            </s-banner>
          )}
          {pending > 0 && (
            <s-banner tone="info">
              <s-paragraph>{t("buyers.bulk.assistedPending", { count: pending })}</s-paragraph>
              <s-button slot="secondary-actions" href={href("/app/tiers")}>{t("buyers.bulk.openChecklist")}</s-button>
            </s-banner>
          )}
        </s-stack>

        {data.rows.length === 0 ? (
          <s-stack direction="block" gap="base" alignItems="center" padding="large">
            <s-heading>{t(filtered ? "buyers.noResults.heading" : "buyers.empty.heading")}</s-heading>
            <s-paragraph>{t(filtered ? "buyers.noResults.body" : "buyers.empty.body")}</s-paragraph>
            {!filtered && <s-button variant="primary" href={href("/app/applications")}>{t("buyers.empty.action")}</s-button>}
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
              <s-table-header listSlot="inline">
                <s-checkbox
                  accessibilityLabel={t("buyers.selectAll")}
                  checked={allChecked}
                  onChange={() => setSelected(allChecked ? [] : data.rows.map((r) => r.id))}
                />
              </s-table-header>
              <s-table-header listSlot="primary">{t("buyers.col.company")}</s-table-header>
              <s-table-header listSlot="secondary">{t("buyers.col.contact")}</s-table-header>
              <s-table-header listSlot="kicker">{t("buyers.col.tier")}</s-table-header>
              <s-table-header>{t("buyers.col.terms")}</s-table-header>
              <s-table-header>{t("buyers.col.tax")}</s-table-header>
              <s-table-header>{t("buyers.col.certificates")}</s-table-header>
              <s-table-header format="numeric">{t("buyers.col.orders")}</s-table-header>
              <s-table-header>{t("buyers.col.approved")}</s-table-header>
              <s-table-header>{t("buyers.col.source")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.rows.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    <s-checkbox
                      accessibilityLabel={t("buyers.select", { company: r.name })}
                      checked={selected.includes(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </s-table-cell>
                  <s-table-cell><s-link href={href(`/app/buyers/${r.id}`)}>{r.name}</s-link></s-table-cell>
                  <s-table-cell>{r.info?.contactName ?? "—"}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-100">
                      <s-text>{tierName(r.tierId) ?? t("buyers.tier.none")}</s-text>
                      {r.status === "paused" && <s-badge tone="warning">{t("buyers.status.paused")}</s-badge>}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{r.info?.terms ?? "—"}</s-table-cell>
                  <s-table-cell>{r.info?.taxExempt == null ? "—" : t(r.info.taxExempt ? "buyers.tax.exempt" : "buyers.tax.charged")}</s-table-cell>
                  <s-table-cell><CertBadge status={r.cert} /></s-table-cell>
                  <s-table-cell>
                    {r.info?.orders ? `${r.info.orders.count} · ${money(r.info.orders.total, r.info.orders.currency, locale)}` : "—"}
                  </s-table-cell>
                  <s-table-cell>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(r.approvedAt))}</s-table-cell>
                  <s-table-cell>{t(`buyers.source.${r.source}`)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-modal id="move-buyers" heading={t("buyers.move.heading", { count: selected.length })}>
        <s-stack direction="block" gap="base">
          <s-select label={t("buyers.move.tier")} value={moveTo} onChange={(e) => setMoveTo(e.currentTarget.value)}>
            <s-option value="">{t("buyers.move.choose")}</s-option>
            {data.tiers.map((x) => <s-option key={x.id} value={x.id}>{x.name}</s-option>)}
          </s-select>
          {moveTo && (
            <s-paragraph>{t("buyers.move.consequence", { count: selected.length, tier: tierName(moveTo) ?? "" })}</s-paragraph>
          )}
        </s-stack>
        <s-button slot="primary-action" variant="primary" disabled={!moveTo} loading={fetcher.state !== "idle"} onClick={() => submit("move", { tierId: moveTo })}>
          {t("buyers.move.confirm")}
        </s-button>
        <s-button slot="secondary-actions" commandFor="move-buyers" command="--hide">{t("common.cancel")}</s-button>
      </s-modal>

      <s-modal id="pause-buyers" heading={t("buyers.pause.heading", { count: selected.length })}>
        <s-paragraph>{t("buyers.pause.body", { count: selected.length })}</s-paragraph>
        <s-button slot="primary-action" variant="primary" tone="critical" loading={fetcher.state !== "idle"} onClick={() => submit("pause")}>
          {t("buyers.pause.confirm")}
        </s-button>
        <s-button slot="secondary-actions" commandFor="pause-buyers" command="--hide">{t("common.cancel")}</s-button>
      </s-modal>
    </s-page>
  );
}

function countryName(code: string, locale: string) {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function money(amount: string, currency: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(amount));
  } catch {
    return amount;
  }
}

function download(csv: string, name: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
