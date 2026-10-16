// Plans (feature spec §N). Prices are USD per month, billed through the
// Shopify Billing API; paid plans have a 14-day trial; development stores get
// every feature free (no charge is created).

export type PlanId = "free" | "starter" | "pro";

export const PLANS: Record<PlanId, { price: number; trialDays: number }> = {
  free: { price: 0, trialDays: 0 },
  starter: { price: 9.99, trialDays: 14 },
  pro: { price: 19.99, trialDays: 14 },
};

/** Billing API plan names (shown on the Shopify charge page). */
export const BILLING_NAMES: Record<Exclude<PlanId, "free">, string> = {
  starter: "Tradepass Starter",
  pro: "Tradepass Pro",
};

export type Feature =
  | "unlimited_approvals" | "multiple_tiers" | "auto_tier_assignment" | "wholesale_only"
  | "certificate_vault" | "tax_checks" | "no_branding"
  | "auto_rules" | "multiple_forms" | "import" | "flow" | "activity_export" | "priority_support";

const STARTER: Feature[] = [
  "unlimited_approvals", "multiple_tiers", "auto_tier_assignment", "wholesale_only",
  "certificate_vault", "tax_checks", "no_branding",
];
const PRO: Feature[] = [...STARTER, "auto_rules", "multiple_forms", "import", "flow", "activity_export", "priority_support"];

export const FEATURES: Record<PlanId, ReadonlySet<Feature>> = {
  free: new Set(),
  starter: new Set(STARTER),
  pro: new Set(PRO),
};

export const FREE_APPROVALS_PER_MONTH = 10;
export const FREE_MAX_TIERS = 1;

/** Effective plan: dev stores get Pro for free. */
export function effectivePlan(billingPlan: string, isDevStore: boolean): PlanId {
  if (isDevStore) return "pro";
  return (["free", "starter", "pro"] as const).includes(billingPlan as PlanId) ? (billingPlan as PlanId) : "free";
}

export function can(plan: PlanId, feature: Feature): boolean {
  return FEATURES[plan].has(feature);
}

/** Lowest plan that unlocks a feature, for "Available on Starter" labels. */
export function requiredPlan(feature: Feature): PlanId {
  return FEATURES.starter.has(feature) ? "starter" : "pro";
}

export function maxTiers(plan: PlanId): number {
  return plan === "free" ? FREE_MAX_TIERS : Number.POSITIVE_INFINITY; // non-Plus cap comes from Shopify's catalog limit
}

export type ApprovalQuota = { used: number; limit: number | null; warn: boolean; blocked: boolean };

export function approvalQuota(plan: PlanId, usedThisMonth: number): ApprovalQuota {
  if (can(plan, "unlimited_approvals")) return { used: usedThisMonth, limit: null, warn: false, blocked: false };
  const limit = FREE_APPROVALS_PER_MONTH;
  return { used: usedThisMonth, limit, warn: usedThisMonth >= limit * 0.8, blocked: usedThisMonth >= limit };
}
