import db from "../db.server";
import type { AdminContext } from "./context.server";
import { BILLING_NAMES, can, FEATURES, PLANS, type Feature, type PlanId } from "./plans";
import { updateSettings } from "./settings.server";
import { ensureCheckoutLock } from "./checkout-lock.server";
import { syncStorefrontConfig } from "./storefront-sync.server";
import { logActivity } from "./activity.server";

// Shopify Billing API glue (feature spec §N). Shop.billingPlan is the source of
// truth for gating; it is refreshed from Shopify when the Plans page loads, after
// the merchant returns from the charge page, and by the app_subscriptions/update
// webhook. Development stores never get a charge: effectivePlan gives them Pro.

const DAY = 86_400_000;

export function planForSubscriptionName(name: string | null | undefined): PlanId {
  if (name === BILLING_NAMES.pro) return "pro";
  if (name === BILLING_NAMES.starter) return "starter";
  return "free";
}

/** Test charges on development stores and when BILLING_TEST=true (staging). */
export function isTestBilling(isDevStore: boolean): boolean {
  return isDevStore || process.env.BILLING_TEST === "true";
}

/** Remaining trial days: a trial is given once per store; switching plans keeps counting from the first start. */
export function remainingTrialDays(plan: Exclude<PlanId, "free">, trialStartedAt: Date | null, now = new Date()): number {
  const full = PLANS[plan].trialDays;
  if (!trialStartedAt) return full;
  const used = Math.floor((now.getTime() - trialStartedAt.getTime()) / DAY);
  return Math.max(0, full - used);
}

type BillingCtx = Pick<AdminContext, "billing" | "shop" | "shopRow"> & Partial<Pick<AdminContext, "admin">>;

/** Read the active subscription from Shopify and store it. */
export async function syncBilling(ctx: BillingCtx): Promise<PlanId> {
  const res = await ctx.billing.check({ isTest: isTestBilling(Boolean(ctx.shopRow?.isDevStore)) });
  const active = res.appSubscriptions.find((s) => s.status === "ACTIVE");
  const plan = planForSubscriptionName(active?.name);
  const trialStart = active && active.trialDays > 0 && !ctx.shopRow?.trialStartedAt ? new Date(active.createdAt) : undefined;
  await db.shop.update({
    where: { shop: ctx.shop },
    data: { billingPlan: plan, subscriptionGid: active?.id ?? null, ...(trialStart ? { trialStartedAt: trialStart } : {}) },
  });
  // The storefront config carries plan-dependent parts (the Free plan's "Powered by Tradepass" link).
  if (ctx.admin && plan !== (ctx.shopRow?.billingPlan ?? "free")) await syncStorefrontConfig(ctx.admin, ctx.shop).catch(() => undefined);
  return plan;
}

/** What stops working when moving from one plan to a lower one. Used for the downgrade confirmation. */
export function lostFeatures(from: PlanId, to: PlanId): Feature[] {
  return [...FEATURES[from]].filter((f) => !FEATURES[to].has(f));
}

export type DowngradeImpact = {
  lost: Feature[];
  wholesaleOnly: boolean; // wholesale-only mode is on and would have to be turned off
  extraTiers: number; // tiers above the new plan's limit (kept, but no new assignments)
  rules: number; // automation rules that stop running
};

export async function downgradeImpact(shop: string, accessMode: string, from: PlanId, to: PlanId): Promise<DowngradeImpact> {
  const lost = lostFeatures(from, to);
  const [tiers, rules] = await Promise.all([db.tier.count({ where: { shop } }), db.rule.count({ where: { shop, enabled: true } })]);
  return {
    lost,
    wholesaleOnly: accessMode === "wholesale_only" && !can(to, "wholesale_only"),
    extraTiers: can(to, "multiple_tiers") ? 0 : Math.max(0, tiers - 1),
    rules: can(to, "auto_rules") ? 0 : rules,
  };
}

/**
 * Apply a plan change on our side. Wholesale-only mode is never switched off
 * silently: the caller must pass `confirmWholesaleOff` (the merchant ticked the
 * box), and the store moves to "hide prices" rather than fully open.
 */
export async function applyDowngrade(
  ctx: Pick<AdminContext, "admin" | "shop" | "settings" | "actor">,
  to: PlanId,
  confirmWholesaleOff: boolean,
): Promise<{ ok: boolean; reason?: "confirm_wholesale" }> {
  if (ctx.settings.storefront.accessMode === "wholesale_only" && !can(to, "wholesale_only")) {
    if (!confirmWholesaleOff) return { ok: false, reason: "confirm_wholesale" };
    const next = await updateSettings(ctx.shop, { storefront: { accessMode: "hide" } });
    await ensureCheckoutLock(ctx.admin, ctx.shop, next);
    await syncStorefrontConfig(ctx.admin, ctx.shop);
    await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "billing.wholesale_only_off", subject: null, detail: { to } });
  }
  if (!can(to, "auto_rules")) {
    await db.rule.updateMany({ where: { shop: ctx.shop, enabled: true }, data: { enabled: false } });
  }
  return { ok: true };
}
