import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { adminContext } from "../lib/context.server";
import { applyDowngrade, downgradeImpact, isTestBilling, remainingTrialDays, syncBilling } from "../lib/billing.server";
import { BILLING_NAMES, effectivePlan, FEATURES, PLANS, type Feature, type PlanId } from "../lib/plans";
import { approvalsThisMonth } from "../lib/applications.server";
import { logActivity } from "../lib/activity.server";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";

const ORDER: PlanId[] = ["free", "starter", "pro"];
const rank = (p: PlanId) => ORDER.indexOf(p);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const isDevStore = Boolean(ctx.shopRow?.isDevStore);
  // Dev stores are never charged, so there is nothing to read from Shopify.
  const billingPlan = isDevStore ? (ctx.shopRow?.billingPlan as PlanId) ?? "free" : await syncBilling(ctx);
  const current = effectivePlan(billingPlan, isDevStore);
  const impacts = Object.fromEntries(
    await Promise.all(
      ORDER.filter((p) => rank(p) < rank(current)).map(async (p) => [p, await downgradeImpact(ctx.shop, ctx.settings.storefront.accessMode, current, p)] as const),
    ),
  );
  const trialStartedAt = ctx.shopRow?.trialStartedAt ?? null;
  return {
    current,
    isDevStore,
    approvals: await approvalsThisMonth(ctx.shop),
    trial: { starter: remainingTrialDays("starter", trialStartedAt), pro: remainingTrialDays("pro", trialStartedAt) },
    impacts,
    features: Object.fromEntries(ORDER.map((p) => [p, [...FEATURES[p]]])) as Record<PlanId, Feature[]>,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const target = String(form.get("plan")) as PlanId;
  if (!ORDER.includes(target)) return { ok: false, error: "unknown_plan" };
  const isDevStore = Boolean(ctx.shopRow?.isDevStore);
  if (isDevStore) return { ok: false, error: "dev_store" };
  const isTest = isTestBilling(isDevStore);

  if (target === "free") {
    const res = await applyDowngrade(ctx, "free", form.get("confirmWholesaleOff") === "on");
    if (!res.ok) return { ok: false, error: res.reason };
    if (ctx.shopRow?.subscriptionGid) {
      await ctx.billing.cancel({ subscriptionId: ctx.shopRow.subscriptionGid, isTest, prorate: true });
    }
    await syncBilling(ctx);
    await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "billing.change", subject: null, detail: { to: "free" } });
    return { ok: true };
  }

  if (rank(target) < rank(ctx.plan)) {
    const res = await applyDowngrade(ctx, target, form.get("confirmWholesaleOff") === "on");
    if (!res.ok) return { ok: false, error: res.reason };
  }
  await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "billing.request", subject: null, detail: { to: target } });
  const handle = ctx.shop.replace(".myshopify.com", "");
  // billing.request throws a redirect to Shopify's approval page.
  return ctx.billing.request({
    plan: BILLING_NAMES[target],
    isTest,
    trialDays: remainingTrialDays(target, ctx.shopRow?.trialStartedAt ?? null),
    returnUrl: `https://admin.shopify.com/store/${handle}/apps/${process.env.SHOPIFY_API_KEY}/app/plans`,
  });
};

export default function Plans() {
  const d = useLoaderData<typeof loader>();
  const { t } = useI18n();
  const href = useLocaleHref();
  const fetcher = useFetcher<typeof action>();
  const [pending, setPending] = useState<PlanId | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const busy = fetcher.state !== "idle";
  const error = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;

  const choose = (p: PlanId) => {
    if (rank(p) < rank(d.current)) {
      setPending(p);
      setConfirmed(false);
      (document.getElementById("downgrade-modal") as HTMLElement & { showOverlay?: () => void })?.showOverlay?.();
      return;
    }
    fetcher.submit({ plan: p }, { method: "POST" });
  };
  const impact = pending ? d.impacts[pending] : null;

  return (
    <s-page heading={t("plans.title")}>
      <s-link slot="breadcrumb-actions" href={href("/app/settings")}>{t("nav.settings")}</s-link>
      {d.isDevStore && <s-banner tone="info" heading={t("plans.devStore.heading")}><s-paragraph>{t("plans.devStore.body")}</s-paragraph></s-banner>}
      {error === "confirm_wholesale" && <s-banner tone="critical" heading={t("plans.error.confirmWholesale")} />}

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
        {ORDER.map((p) => (
          <s-section key={p} heading={t(`plans.name.${p}`)}>
            <s-stack direction="block" gap="base">
              <s-heading>{p === "free" ? t("plans.price.free") : t("plans.price.monthly", { price: `$${PLANS[p].price}` })}</s-heading>
              {p !== "free" && d.current === "free" && d.trial[p] > 0 && <s-text color="subdued">{t("plans.trial", { count: d.trial[p] })}</s-text>}
              <s-unordered-list>
                {t(`plans.summary.${p}`)
                  .split("\n")
                  .map((line) => (
                    <s-list-item key={line}>{line}</s-list-item>
                  ))}
              </s-unordered-list>
              {p === d.current ? (
                <s-badge tone="success">{t("plans.current")}</s-badge>
              ) : (
                <s-button
                  variant={rank(p) > rank(d.current) ? "primary" : "secondary"}
                  disabled={d.isDevStore || busy}
                  onClick={() => choose(p)}
                  {...(busy && fetcher.formData?.get("plan") === p ? { loading: true } : {})}
                >
                  {rank(p) > rank(d.current) ? t("plans.upgrade", { plan: t(`plans.name.${p}`) }) : t("plans.downgrade", { plan: t(`plans.name.${p}`) })}
                </s-button>
              )}
            </s-stack>
          </s-section>
        ))}
      </s-grid>

      {d.current === "free" && (
        <s-section>
          <s-paragraph>{t("plans.freeUsage", { used: d.approvals, limit: 10 })}</s-paragraph>
        </s-section>
      )}
      <s-section>
        <s-paragraph color="subdued">{t("plans.footnote")}</s-paragraph>
      </s-section>

      <s-modal id="downgrade-modal" heading={pending ? t("plans.downgradeHeading", { plan: t(`plans.name.${pending}`) }) : ""}>
        {impact && (
          <s-stack direction="block" gap="base">
            <s-paragraph>{t("plans.downgradeIntro")}</s-paragraph>
            <s-unordered-list>
              {impact.lost.map((f) => (
                <s-list-item key={f}>{t(`plans.feature.${f}`)}</s-list-item>
              ))}
              {impact.extraTiers > 0 && <s-list-item>{t("plans.impact.tiers", { count: impact.extraTiers })}</s-list-item>}
              {impact.rules > 0 && <s-list-item>{t("plans.impact.rules", { count: impact.rules })}</s-list-item>}
            </s-unordered-list>
            {impact.wholesaleOnly && (
              <s-banner tone="warning" heading={t("plans.impact.wholesaleHeading")}>
                <s-paragraph>{t("plans.impact.wholesaleBody")}</s-paragraph>
                <s-checkbox label={t("plans.impact.wholesaleConfirm")} checked={confirmed} onChange={() => setConfirmed(!confirmed)} />
              </s-banner>
            )}
          </s-stack>
        )}
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          disabled={Boolean(impact?.wholesaleOnly && !confirmed)}
          commandFor="downgrade-modal"
          command="--hide"
          onClick={() => pending && fetcher.submit({ plan: pending, ...(confirmed ? { confirmWholesaleOff: "on" } : {}) }, { method: "POST" })}
        >
          {pending ? t("plans.downgrade", { plan: t(`plans.name.${pending}`) }) : ""}
        </s-button>
        <s-button slot="secondary-actions" commandFor="downgrade-modal" command="--hide">{t("common.cancel")}</s-button>
      </s-modal>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
