import { afterAll, describe, expect, it } from "vitest";
import db from "../app/db.server";
import { buyerOrders, homeNumbers, median, serverAlerts } from "../app/lib/home.server";
import { defaultSettings } from "../app/lib/settings";
import type { ShopFacts } from "../app/lib/shop.server";

const shop = `test-home-${Math.random().toString(36).slice(2, 8)}.myshopify.com`;
const facts = (over: Partial<ShopFacts> = {}) =>
  ({ planName: "Grow", isPlus: false, isDevStore: false, b2bEnabled: true, b2bMarketsEnabled: true, catalogLimit: 3, catalogsUsed: 1, ...over }) as ShopFacts;

const fakeAdmin = (orders: unknown[]) => ({
  graphql: async () => new Response(JSON.stringify({ data: { orders: { nodes: orders, pageInfo: { hasNextPage: false, endCursor: null } } } })),
});

afterAll(async () => {
  await db.application.deleteMany({ where: { shop } });
  await db.buyer.deleteMany({ where: { shop } });
  await db.shop.deleteMany({ where: { shop } });
});

describe("home", () => {
  it("computes a median", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("raises the catalog alert only when the budget is full, and hides dismissed alerts until the condition changes", async () => {
    await db.shop.create({ data: { shop } });
    const s = defaultSettings();
    expect((await serverAlerts(shop, s, facts(), "pro")).map((a) => a.id)).not.toContain("catalog_limit");
    const full = await serverAlerts(shop, s, facts({ catalogsUsed: 3 }), "pro");
    const alert = full.find((a) => a.id === "catalog_limit")!;
    expect(alert).toBeTruthy();
    s.onboarding.dismissedAlerts = { catalog_limit: alert.key };
    expect((await serverAlerts(shop, s, facts({ catalogsUsed: 3 }), "pro")).map((a) => a.id)).not.toContain("catalog_limit");
    // A different limit is a new condition: shown again.
    expect((await serverAlerts(shop, s, facts({ catalogsUsed: 5, catalogLimit: 5 }), "pro")).map((a) => a.id)).toContain("catalog_limit");
  });

  it("warns at 80% of the free approval limit", async () => {
    const now = new Date();
    for (let i = 0; i < 8; i++) {
      await db.application.create({
        data: { shop, idempotencyKey: `k${i}`, companyName: `Co ${i}`, email: `a${i}@example.com`, answers: {}, status: "approved", submittedAt: new Date(now.getTime() - 3_600_000 * (i + 1)), decidedAt: now },
      });
    }
    const alerts = await serverAlerts(shop, defaultSettings(), facts(), "free");
    expect(alerts.find((a) => a.id === "plan_limit")?.values).toMatchObject({ used: 8, limit: 10, full: "no" });
    expect((await serverAlerts(shop, defaultSettings(), facts(), "starter")).map((a) => a.id)).not.toContain("plan_limit");
  });

  it("counts only orders from Tradepass buyers' companies", async () => {
    await db.buyer.create({ data: { shop, companyGid: "gid://shopify/Company/1", name: "Co", locationGids: [] } });
    const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "EUR" } });
    const res = await buyerOrders(
      fakeAdmin([
        { purchasingEntity: { company: { id: "gid://shopify/Company/1" } }, currentTotalPriceSet: money("10.50") },
        { purchasingEntity: { company: { id: "gid://shopify/Company/2" } }, currentTotalPriceSet: money("99") },
        { purchasingEntity: null, currentTotalPriceSet: money("5") },
        { purchasingEntity: { company: { id: "gid://shopify/Company/1" } }, currentTotalPriceSet: money("4.25") },
      ]),
      shop,
      new Date(),
    );
    expect(res).toEqual({ count: 2, total: 14.75, currency: "EUR", truncated: false });
  });

  it("computes 30-day numbers with approval rate and median time", async () => {
    const n = await homeNumbers(fakeAdmin([]), shop);
    expect(n.received[0]).toBe(8);
    expect(n.approved[0]).toBe(8);
    expect(n.approvalRate[0]).toBe(1);
    expect(n.medianHours[0]).toBeCloseTo(4.5, 1);
    expect(n.newBuyersByTier).toEqual([{ tier: "", count: 1 }]);
  });
});
