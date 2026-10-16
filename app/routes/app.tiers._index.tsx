import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import db from "../db.server";
import { adminContext } from "../lib/context.server";
import { requiredPlan } from "../lib/plans";
import {
  adminUrl, catalogBudget, catalogTitles, createBlockReason, paymentTermsOptions, pendingAssignments, readDefaults,
  repairTier, TierError, verifyAssignment,
} from "../lib/tiers.server";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const [tiers, counts, budget, terms, pending] = await Promise.all([
    db.tier.findMany({ where: { shop: ctx.shop }, orderBy: { position: "asc" } }),
    db.buyer.groupBy({ by: ["tierId"], where: { shop: ctx.shop, status: "active" }, _count: { _all: true } }),
    catalogBudget(ctx.admin, ctx.shop),
    paymentTermsOptions(ctx.admin),
    pendingAssignments(ctx.shop),
  ]);
  const linked = tiers.filter((x) => readDefaults(x.defaults).pricing === "existing" && x.catalogGid).map((x) => x.catalogGid!);
  const titles = await catalogTitles(ctx.admin, linked);
  const block = createBlockReason(ctx.plan, tiers.length, { b2bEnabled: Boolean(ctx.shopRow?.b2bEnabled), b2bMarketsEnabled: Boolean(ctx.shopRow?.b2bMarketsEnabled) }, budget);
  return {
    tiers: tiers.map((x) => {
      const d = readDefaults(x.defaults);
      return {
        id: x.id, name: x.name, syncState: x.syncState, mode: x.mode, discountPct: x.discountPct,
        catalogTitle: x.catalogGid ? titles[x.catalogGid] ?? null : null,
        pricing: d.pricing,
        buyers: counts.find((c) => c.tierId === x.id)?._count._all ?? 0,
        terms: terms.find((p) => p.id === d.paymentTermsTemplateId)?.name ?? null,
        marketUrl: x.marketGid ? adminUrl.market(x.marketGid) : null,
      };
    }),
    budget,
    block,
    requiredPlan: requiredPlan("multiple_tiers"),
    pending,
    assisted: ctx.settings.tiers.assignment === "assisted",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const tctx = { admin: ctx.admin, shop: ctx.shop, actor: ctx.actor };
  try {
    if (intent === "repair") {
      await repairTier(tctx, String(form.get("tierId")));
      return { ok: true as const, intent, message: ctx.t("tiers.repair.done") };
    }
    if (intent === "verify") {
      const ok = await verifyAssignment(tctx, String(form.get("jobId")));
      return { ok, intent, message: ctx.t(ok ? "tiers.assisted.verified" : "tiers.assisted.notYet") };
    }
  } catch (e) {
    const code = e instanceof TierError ? e.code : (e as { code?: string }).code ?? "shopify";
    return { ok: false as const, intent, message: ctx.t(`tiers.error.${code}`, { detail: (e as TierError).detail ?? "" }) };
  }
  return { ok: false as const, intent, message: ctx.t("errors.generic") };
};

export default function Tiers() {
  const data = useLoaderData<typeof loader>();
  const { t } = useI18n();
  const href = useLocaleHref();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.message) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const post = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    fetcher.submit(fd, { method: "POST" });
  };

  const { used, limit, direct } = data.budget;
  const blockText = data.block
    ? data.block === "plan_limit"
      ? `${t("tiers.block.plan_limit")} ${t("common.availableOn", { plan: t(`tiers.plan.${data.requiredPlan}`) })}`
      : t(`tiers.block.${data.block}`, { used: used ?? 0, limit: limit ?? 0 })
    : null;

  const createButton = (
    <s-button slot="primary-action" variant="primary" href={href("/app/tiers/new")} disabled={Boolean(data.block)}>
      {t("tiers.create")}
    </s-button>
  );

  return (
    <s-page heading={t("tiers.title")}>
      {createButton}

      {!direct && limit != null && used != null && (
        <s-banner tone={used >= limit ? "warning" : "info"}>
          <s-paragraph>{t("tiers.budget", { used, limit })}</s-paragraph>
        </s-banner>
      )}
      {blockText && data.tiers.length > 0 && (
        <s-banner tone="warning">
          <s-paragraph>{blockText}</s-paragraph>
        </s-banner>
      )}

      {data.pending.length > 0 && (
        <s-section heading={t("tiers.assisted.heading", { count: data.pending.length })}>
          <s-stack direction="block" gap="base">
            <s-paragraph>{t("tiers.assisted.body")}</s-paragraph>
            {data.pending.map((p) => (
              <s-stack key={p.id} direction="inline" gap="base" alignItems="center">
                <s-text>
                  {t(p.op === "add" ? "tiers.assisted.add" : "tiers.assisted.remove", { buyer: p.buyerName ?? t("tiers.assisted.unknownBuyer"), tier: p.tierName })}
                </s-text>
                <s-button href={p.marketUrl} target="_top">{t("tiers.assisted.openMarket")}</s-button>
                <s-button
                  variant="secondary"
                  loading={fetcher.state !== "idle" && fetcher.formData?.get("jobId") === p.id}
                  onClick={() => post({ intent: "verify", jobId: p.id })}
                >
                  {t("tiers.assisted.verify")}
                </s-button>
              </s-stack>
            ))}
          </s-stack>
        </s-section>
      )}

      {data.tiers.length === 0 ? (
        <s-section>
          <s-stack direction="block" gap="base" alignItems="center">
            <s-heading>{t("tiers.empty.heading")}</s-heading>
            <s-paragraph>{t("tiers.empty.body")}</s-paragraph>
            {blockText && <s-paragraph tone="caution">{blockText}</s-paragraph>}
            <s-button variant="primary" href={href("/app/tiers/new")} disabled={Boolean(data.block)}>
              {t("tiers.empty.action")}
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("tiers.col.name")}</s-table-header>
              <s-table-header listSlot="secondary">{t("tiers.col.pricing")}</s-table-header>
              <s-table-header format="numeric">{t("tiers.col.buyers")}</s-table-header>
              <s-table-header>{t("tiers.col.terms")}</s-table-header>
              <s-table-header listSlot="inline">{t("tiers.col.status")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.tiers.map((x) => (
                <s-table-row key={x.id}>
                  <s-table-cell>
                    <s-link href={href(`/app/tiers/${x.id}`)}>{x.name}</s-link>
                  </s-table-cell>
                  <s-table-cell>
                    {x.pricing === "percent" && x.discountPct != null
                      ? t("tiers.pricing.percent", { pct: x.discountPct })
                      : x.catalogTitle ?? t("tiers.pricing.catalog")}
                  </s-table-cell>
                  <s-table-cell>{x.buyers}</s-table-cell>
                  <s-table-cell>{x.terms ?? t("tiers.terms.none")}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-badge tone={x.syncState === "ok" ? "success" : x.syncState === "missing" ? "critical" : "warning"}>
                        {t(`tiers.status.${x.syncState}`)}
                      </s-badge>
                      {x.syncState !== "ok" && (
                        <s-button
                          variant="tertiary"
                          loading={fetcher.state !== "idle" && fetcher.formData?.get("tierId") === x.id}
                          onClick={() => post({ intent: "repair", tierId: x.id })}
                        >
                          {t("tiers.repair.action")}
                        </s-button>
                      )}
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
