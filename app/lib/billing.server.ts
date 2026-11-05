import db from "../db.server";
import type { AdminContext } from "./context.server";
import { can, effectivePlan, FEATURES, isTestBilling, PLANS, planForSubscriptionName, type Feature, type PlanId } from "./plans";
import { updateSettings } from "./settings.server";
import { syncStorefrontConfig } from "./storefront-sync.server";
import { logActivity } from "./activity.server";

// Shopify Billing API glue (feature spec §N). Shop.billingPlan is the source of
// truth for gating; it is refreshed from Shopify when the Plans page loads, after
// the merchant returns from the charge page, and by the app_subscriptions/update
// webhook. Development stores never get a charge: effectivePlan gives them Pro.

const DAY = 86_400_000;

export { isTestBilling, planForSubscriptionName };

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
  if (plan !== (ctx.shopRow?.billingPlan ?? "free")) {
    // Shopify confirmed the change: only now do features of the old plan stop.
    await enforcePlanLimits(ctx.shop, effectivePlan(plan, Boolean(ctx.shopRow?.isDevStore)));
    // The storefront config carries plan-dependent parts (the Free plan's "Powered by Tradepass" link).
    if (ctx.admin) await syncStorefrontConfig(ctx.admin, ctx.shop).catch(() => undefined);
  }
  return plan;
}

/**
 * Switch off what the current plan doesn't include. Called only once Shopify has
 * confirmed the plan (Plans page sync, subscription webhook), never before the
 * merchant approves a charge, so cancelling on Shopify's page changes nothing.
 * Wholesale-only mode is never switched off here (see applyDowngrade).
 */
export async function enforcePlanLimits(shop: string, plan: PlanId): Promise<void> {
  if (!can(plan, "auto_rules")) {
    const off = await db.rule.updateMany({ where: { shop, enabled: true }, data: { enabled: false } });
    if (off.count) await logActivity({ shop, actor: "system", action: "billing.rules_off", subject: null, detail: { plan, rules: off.count } });
  }
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

/** Wholesale-only mode can't stay on the target plan, so the merchant must confirm turning it off first. */
export function needsWholesaleConfirm(accessMode: string, to: PlanId): boolean {
  return accessMode === "wholesale_only" && !can(to, "wholesale_only");
}

/**
 * Apply a confirmed plan change on our side (call it after Shopify has accepted
 * the change, e.g. the subscription was cancelled). Wholesale-only mode is never
 * switched off silently: the caller must pass `confirmWholesaleOff` (the
 * merchant ticked the box), and the store moves to "hide prices" rather than
 * fully open. Other plan limits follow in enforcePlanLimits.
 */
export async function applyDowngrade(
  ctx: Pick<AdminContext, "admin" | "shop" | "settings" | "actor">,
  to: PlanId,
  confirmWholesaleOff: boolean,
): Promise<{ ok: boolean; reason?: "confirm_wholesale" }> {
  if (needsWholesaleConfirm(ctx.settings.storefront.accessMode, to)) {
    if (!confirmWholesaleOff) return { ok: false, reason: "confirm_wholesale" };
    await updateSettings(ctx.shop, { storefront: { accessMode: "hide" } });
    // Also turns the checkout lock off (ensureCheckoutLock); a failure is queued and retried.
    await syncStorefrontConfig(ctx.admin, ctx.shop).catch(() => undefined);
    await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "billing.wholesale_only_off", subject: null, detail: { to } });
  }
  await enforcePlanLimits(ctx.shop, to);
  return { ok: true };
}
