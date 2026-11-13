import db from "../db.server";
import { paginate, type Admin } from "./gql.server";
import type { Settings } from "./settings";
import type { ShopFacts } from "./shop.server";
import { approvalQuota, type PlanId } from "./plans";
import { pendingAssignmentCount } from "./tiers.server";
import { approvalsThisMonth, pendingSummary } from "./applications.server";
import { formForAudience } from "./form-defaults";

// Home page data (feature spec §B). The checklist, pending work and alerts are
// cheap DB reads; the 30-day numbers need a Shopify orders query, so they load
// separately (app.stats.tsx) and Home renders without waiting for them.

const DAY = 86_400_000;

export type ChecklistStep = { id: "tier" | "form" | "embed" | "block" | "storefront" | "test"; done: boolean | null };

/** Steps whose status needs App Bridge (`embed`, `block`) come back as null and are filled in on the client. */
export async function checklist(shop: string, settings: Settings): Promise<ChecklistStep[]> {
  const [tiers, apps] = await Promise.all([
    db.tier.count({ where: { shop } }),
    db.application.count({ where: { shop } }),
  ]);
  return [
    { id: "tier", done: tiers > 0 },
    { id: "form", done: settings.onboarding.formReviewed },
    { id: "embed", done: null },
    { id: "block", done: null },
    { id: "storefront", done: settings.onboarding.storefrontReviewed },
    { id: "test", done: apps > 0 },
  ];
}

export async function pendingWork(shop: string, settings: Settings) {
  const soon = new Date(Date.now() + settings.certificates.expiringDays * DAY);
  const staleBefore = new Date(Date.now() - settings.review.staleDays * DAY);
  const [apps, expiring, assignments, incomplete, stale] = await Promise.all([
    pendingSummary(shop),
    db.certificate.count({ where: { shop, buyerId: { not: null }, status: { in: ["valid", "expiring"] }, expiresOn: { lte: soon, gte: new Date() } } }),
    // Counted in both modes: tasks created in assisted mode stay open after switching back to automatic.
    pendingAssignmentCount(shop),
    // Approvals that stopped part-way (Shopify error, closed tab): the merchant should Retry or Undo.
    db.application.count({ where: { shop, approvalStatus: { in: ["failed", "running"] }, status: { in: ["pending", "needs_info", "approved"] } } }),
    // Waiting longer than the merchant's threshold (C12): slow answers send buyers elsewhere.
    db.application.count({ where: { shop, status: "pending", submittedAt: { lt: staleBefore } } }),
  ]);
  return { applications: apps.count, oldestAt: apps.oldestAt, expiring, assignments, incomplete, stale, staleDays: settings.review.staleDays };
}

export type AlertId = "catalog_limit" | "embed_off" | "tier_missing" | "plan_limit" | "first_buyer";
/** `key` encodes the condition; a dismissed alert comes back only when its key changes. */
export type HomeAlert = { id: AlertId; key: string; values?: Record<string, string | number> };

export async function serverAlerts(shop: string, settings: Settings, facts: ShopFacts, plan: PlanId): Promise<HomeAlert[]> {
  const out: HomeAlert[] = [];
  const limit = facts.catalogLimit ?? 0;
  if (!facts.isPlus && limit > 0 && (facts.catalogsUsed ?? 0) >= limit) out.push({ id: "catalog_limit", key: `${limit}`, values: { limit } });

  const [missing, approvals, buyers] = await Promise.all([
    db.tier.findMany({ where: { shop, syncState: "missing" }, select: { id: true, name: true } }),
    approvalsThisMonth(shop),
    db.buyer.count({ where: { shop } }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  if (missing.length) out.push({ id: "tier_missing", key: missing.map((m) => m.id).sort().join(","), values: { tier: missing[0].name, count: missing.length } });

  const q = approvalQuota(plan, approvals);
  if (q.warn && q.limit) {
    const month = today.slice(0, 7);
    out.push({ id: "plan_limit", key: `${month}:${q.blocked ? 100 : 80}`, values: { used: q.used, limit: q.limit, full: q.blocked ? "yes" : "no" } });
  }
  if (buyers > 0) out.push({ id: "first_buyer", key: "1" });

  const dismissed = settings.onboarding.dismissedAlerts;
  return out.filter((a) => dismissed[a.id] !== a.key);
}

/** Welcome answer: remember the audience and, if the merchant hasn't edited the default form yet, apply matching defaults. */
export async function applyWelcome(shop: string, audience: string): Promise<void> {
  const form = await db.form.findFirst({ where: { shop, isDefault: true } });
  if (form && form.updatedAt.getTime() - form.createdAt.getTime() < 1000) {
    await db.form.update({ where: { id: form.id }, data: { definition: formForAudience(audience) } });
  }
}

// ---------- 30-day numbers ----------

export type Numbers = {
  received: [number, number]; // [last 30 days, previous 30 days]
  approved: [number, number];
  approvalRate: [number | null, number | null]; // 0..1
  medianHours: [number | null, number | null];
  newBuyersByTier: { tier: string; count: number }[];
  orders: { count: number; total: number; currency: string | null; truncated: boolean } | null; // null: orders unavailable
  /** Last 6 calendar months (UTC), oldest first. */
  months: MonthRow[];
  /** Every current buyer by tier (paused buyers count under the tier they'll return to). */
  buyersByTier: { tier: string; active: number; paused: number }[];
  /** Window of the numbers above (30 or 90 days, C16). */
  days?: 30 | 90;
  /** Top sources in the window ("" = direct). */
  sources?: { source: string; count: number }[];
};

export type MonthRow = { month: string; received: number; approved: number; rejected: number; rate: number | null; avgDays: number | null };

/** Month keys "YYYY-MM" for the last `n` calendar months, oldest first. */
export function lastMonths(n: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** Applications per month, approvals, approval rate and average days to decide — two grouped queries, no row scans in Node. */
export async function monthlyReport(shop: string, now = new Date(), n = 6): Promise<MonthRow[]> {
  const keys = lastMonths(n, now);
  const from = new Date(`${keys[0]}-01T00:00:00Z`);
  const [received, decided] = await Promise.all([
    db.$queryRaw<{ m: string; c: bigint }[]>`
      SELECT to_char(date_trunc('month', "submittedAt"), 'YYYY-MM') AS m, count(*) AS c
      FROM "Application" WHERE "shop" = ${shop} AND "submittedAt" >= ${from} AND "status" <> 'draft' GROUP BY 1`,
    db.$queryRaw<{ m: string; approved: bigint; rejected: bigint; days: number | null }[]>`
      SELECT to_char(date_trunc('month', "decidedAt"), 'YYYY-MM') AS m,
        count(*) FILTER (WHERE "status" = 'approved') AS approved,
        count(*) FILTER (WHERE "status" = 'rejected') AS rejected,
        avg(extract(epoch FROM ("decidedAt" - "submittedAt")) / 86400)::float8 AS days
      FROM "Application" WHERE "shop" = ${shop} AND "decidedAt" >= ${from} AND "status" IN ('approved', 'rejected') GROUP BY 1`,
  ]);
  return keys.map((month) => {
    const r = received.find((x) => x.m === month);
    const d = decided.find((x) => x.m === month);
    const approved = Number(d?.approved ?? 0);
    const rejected = Number(d?.rejected ?? 0);
    return {
      month,
      received: Number(r?.c ?? 0),
      approved,
      rejected,
      rate: approved + rejected ? approved / (approved + rejected) : null,
      avgDays: d?.days == null ? null : Math.round(d.days * 10) / 10,
    };
  });
}

export async function buyersPerTier(shop: string): Promise<Numbers["buyersByTier"]> {
  const [groups, tiers] = await Promise.all([
    db.buyer.groupBy({ by: ["tierId", "pausedTierId", "status"], where: { shop }, _count: { _all: true } }),
    db.tier.findMany({ where: { shop }, select: { id: true, name: true }, orderBy: { position: "asc" } }),
  ]);
  const rows = tiers.map((t) => ({ tier: t.name, id: t.id, active: 0, paused: 0 }));
  const none = { tier: "", id: "", active: 0, paused: 0 };
  for (const g of groups) {
    const paused = g.status === "paused";
    const id = paused ? g.pausedTierId : g.tierId;
    const row = rows.find((r) => r.id === id) ?? none;
    if (paused) row.paused += g._count._all;
    else row.active += g._count._all;
  }
  return [...rows, ...(none.active + none.paused ? [none] : [])].map(({ tier, active, paused }) => ({ tier, active, paused }));
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function windowStats(shop: string, from: Date, to: Date) {
  const [received, decided] = await Promise.all([
    db.application.count({ where: { shop, status: { not: "draft" }, submittedAt: { gte: from, lt: to } } }),
    db.application.findMany({
      where: { shop, status: { in: ["approved", "rejected"] }, decidedAt: { gte: from, lt: to } },
      select: { status: true, submittedAt: true, decidedAt: true },
      take: 5000,
    }),
  ]);
  const approved = decided.filter((d) => d.status === "approved").length;
  const hours = decided.map((d) => (d.decidedAt!.getTime() - d.submittedAt.getTime()) / 3_600_000);
  return { received, approved, rate: decided.length ? approved / decided.length : null, median: median(hours) };
}

const ORDERS_QUERY = `#graphql
  query TradepassRecentOrders($query: String!, $after: String) {
    orders(first: 250, after: $after, query: $query, sortKey: CREATED_AT) {
      nodes {
        purchasingEntity { ... on PurchasingCompany { company { id } } }
        currentTotalPriceSet { shopMoney { amount currencyCode } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

type OrderNode = {
  purchasingEntity: { company?: { id: string } } | null;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
};

const MAX_ORDERS = 1000;

/** Orders placed by Tradepass buyers' companies in the window. The orders query has no company filter, so we read B2B orders and match company ids. */
export async function buyerOrders(admin: Admin, shop: string, from: Date) {
  const companies = new Set((await db.buyer.findMany({ where: { shop }, select: { companyGid: true } })).map((b) => b.companyGid));
  if (!companies.size) return { count: 0, total: 0, currency: null, truncated: false };
  const nodes = await paginate<OrderNode>(
    admin,
    ORDERS_QUERY,
    { query: `created_at:>='${from.toISOString()}'` },
    (d) => d.orders,
    MAX_ORDERS,
  );
  let count = 0;
  let total = 0;
  let currency: string | null = null;
  for (const o of nodes) {
    const id = o.purchasingEntity?.company?.id;
    if (!id || !companies.has(id)) continue;
    count++;
    total += Number(o.currentTotalPriceSet.shopMoney.amount);
    currency = o.currentTotalPriceSet.shopMoney.currencyCode;
  }
  return { count, total: Math.round(total * 100) / 100, currency, truncated: nodes.length >= MAX_ORDERS };
}

/**
 * Where applications came from in the window (C16): UTM source, else the referring site, else
 * "direct" (typed the address, bookmarks, apps that send no referrer). Database only.
 */
export async function topSources(shop: string, from: Date, to: Date, limit = 5): Promise<{ source: string; count: number }[]> {
  const rows = await db.application.findMany({ where: { shop, status: { not: "draft" }, submittedAt: { gte: from, lt: to } }, select: { attribution: true }, take: 10_000 });
  const counts = new Map<string, number>();
  for (const r of rows) {
    const a = (r.attribution ?? {}) as Record<string, string>;
    const key = a.utm_source || a.ref || "";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([source, count]) => ({ source, count })).sort((x, y) => y.count - x.count || x.source.localeCompare(y.source)).slice(0, limit);
}

export async function homeNumbers(admin: Admin, shop: string, now = new Date(), days: 30 | 90 = 30): Promise<Numbers> {
  const a = new Date(now.getTime() - days * DAY);
  const b = new Date(now.getTime() - 2 * days * DAY);
  const [cur, prev, buyers, tiers, months, byTier, sources] = await Promise.all([
    windowStats(shop, a, now),
    windowStats(shop, b, a),
    db.buyer.groupBy({ by: ["tierId"], where: { shop, approvedAt: { gte: a } }, _count: { _all: true } }),
    db.tier.findMany({ where: { shop }, select: { id: true, name: true } }),
    monthlyReport(shop, now),
    buyersPerTier(shop),
    topSources(shop, a, now),
  ]);
  let orders: Numbers["orders"] = null;
  try {
    orders = await buyerOrders(admin, shop, a);
  } catch {
    // Missing read_orders consent or a Shopify error: show the other numbers anyway.
  }
  return {
    received: [cur.received, prev.received],
    approved: [cur.approved, prev.approved],
    approvalRate: [cur.rate, prev.rate],
    medianHours: [cur.median, prev.median],
    newBuyersByTier: buyers
      .map((g) => ({ tier: tiers.find((t) => t.id === g.tierId)?.name ?? "", count: g._count._all }))
      .sort((x, y) => y.count - x.count),
    orders,
    months,
    buyersByTier: byTier,
    days,
    sources,
  };
}
