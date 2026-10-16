import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import db from "../app/db.server";
import { defaultSettings } from "../app/lib/settings";
import { AssignmentError, moveLocations, pendingAssignments, timing, verifyAssignment } from "../app/lib/tiers.server";
import { fakeShopify } from "./tiers-fake";

const rnd = randomBytes(4).toString("hex");
const SHOP = `test-tiers-${rnd}.myshopify.com`;
const ASSISTED = `test-tiers-assisted-${rnd}.myshopify.com`;
const shops = [SHOP, ASSISTED];

timing.sleep = async () => undefined; // no real backoff waits in tests

beforeAll(async () => {
  const assisted = defaultSettings();
  assisted.tiers.assignment = "assisted";
  await db.shop.create({ data: { shop: SHOP, settings: defaultSettings() as object, billingPlan: "pro" } });
  await db.shop.create({ data: { shop: ASSISTED, settings: assisted as object, billingPlan: "pro" } });
});

afterAll(async () => {
  for (const shop of shops) {
    await db.job.deleteMany({ where: { shop } });
    await db.tier.deleteMany({ where: { shop } });
    await db.activityLog.deleteMany({ where: { shop } });
    await db.shopLock.deleteMany({ where: { shop } });
    await db.shop.deleteMany({ where: { shop } });
  }
});

let fake: ReturnType<typeof fakeShopify>;
beforeEach(() => {
  fake = fakeShopify();
});

const tierFor = async (shop: string, marketGid: string) =>
  db.tier.create({ data: { shop, name: `T-${marketGid.slice(-3)}`, marketGid, catalogGid: null } });

describe("automatic tier assignment (lock + read-back + retry)", () => {
  it("retries MARKET_UPDATE_CONCURRENT_MODIFICATION with backoff, then verifies membership", async () => {
    const m = fake.addMarket(["gid://shopify/CompanyLocation/900"]);
    const tier = await tierFor(SHOP, m);
    let failures = 2;
    fake.hooks.TierMarketUpdate = () =>
      failures-- > 0
        ? { marketUpdate: { market: null, userErrors: [{ field: ["id"], message: "busy", code: "MARKET_UPDATE_CONCURRENT_MODIFICATION" }] } }
        : undefined;
    const res = await moveLocations({ admin: fake.admin, shop: SHOP, actor: "test" }, ["gid://shopify/CompanyLocation/1"], null, tier);
    expect(res).toMatchObject({ mode: "auto", verified: true });
    expect(fake.count("TierMarketUpdate")).toBe(3);
    expect(fake.markets.get(m)!.locs).toContain("gid://shopify/CompanyLocation/1");
  });

  it("gives up with a clear code when the concurrent modification never clears", async () => {
    const m = fake.addMarket(["gid://shopify/CompanyLocation/900"]);
    const tier = await tierFor(SHOP, m);
    fake.hooks.TierMarketUpdate = () => ({ marketUpdate: { market: null, userErrors: [{ field: null, message: "busy", code: "MARKET_UPDATE_CONCURRENT_MODIFICATION" }] } });
    await expect(moveLocations({ admin: fake.admin, shop: SHOP, actor: "test" }, ["gid://shopify/CompanyLocation/2"], null, tier))
      .rejects.toMatchObject({ code: "concurrent" });
  });

  it("serialises two approvals in the same shop, and both land in the market (acceptance 8)", async () => {
    const m = fake.addMarket(["gid://shopify/CompanyLocation/900"]);
    const tier = await tierFor(SHOP, m);
    // Simulate a slow, last-writer-wins Shopify: overlapping writes would lose one location.
    let inFlight = 0;
    let maxInFlight = 0;
    const raw = fake.admin.graphql;
    fake.admin.graphql = async (q: string, o?: { variables?: Record<string, unknown> }) => {
      if (!q.includes("TierMarketUpdate")) return raw(q, o);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      try {
        return await raw(q, o);
      } finally {
        inFlight--;
      }
    };
    const ctx = { admin: fake.admin, shop: SHOP, actor: "test" };
    await Promise.all([
      moveLocations(ctx, ["gid://shopify/CompanyLocation/11"], null, tier),
      moveLocations(ctx, ["gid://shopify/CompanyLocation/12"], null, tier),
    ]);
    expect(maxInFlight).toBe(1);
    expect(fake.markets.get(m)!.locs).toEqual(expect.arrayContaining(["gid://shopify/CompanyLocation/11", "gid://shopify/CompanyLocation/12"]));
  });

  it("fails verification when Shopify accepts but doesn't apply the change", async () => {
    const m = fake.addMarket(["gid://shopify/CompanyLocation/900"]);
    const tier = await tierFor(SHOP, m);
    fake.hooks.TierMarketUpdate = () => ({ marketUpdate: { market: { id: m }, userErrors: [] } });
    const err = await moveLocations({ admin: fake.admin, shop: SHOP, actor: "test" }, ["gid://shopify/CompanyLocation/3"], null, tier).catch((e) => e);
    expect(err).toBeInstanceOf(AssignmentError);
    expect(err.code).toBe("verify_failed");
    expect(fake.count("TierMarketUpdate")).toBe(2); // wrote once more before giving up
  });

  it("moves between tiers: removed from A, added to B", async () => {
    const loc = "gid://shopify/CompanyLocation/21";
    const a = await tierFor(SHOP, fake.addMarket(["gid://shopify/CompanyLocation/900", loc]));
    const b = await tierFor(SHOP, fake.addMarket(["gid://shopify/CompanyLocation/900"]));
    await moveLocations({ admin: fake.admin, shop: SHOP, actor: "test" }, [loc], a, b);
    expect(fake.markets.get(a.marketGid!)!.locs).not.toContain(loc);
    expect(fake.markets.get(b.marketGid!)!.locs).toContain(loc);
  });

  it("keeps a market alive with the placeholder location when the last buyer leaves (D-004)", async () => {
    const loc = "gid://shopify/CompanyLocation/31";
    const m = fake.addMarket([loc]);
    const tier = await tierFor(SHOP, m);
    await moveLocations({ admin: fake.admin, shop: SHOP, actor: "test" }, [loc], tier, null);
    const locs = fake.markets.get(m)!.locs;
    expect(locs).not.toContain(loc);
    expect(locs).toHaveLength(1);
    const row = await db.shop.findUnique({ where: { shop: SHOP } });
    expect(row?.placeholderCompanyGid).toBeTruthy();
    expect((await db.tier.findUnique({ where: { id: tier.id } }))?.placeholderLocationGid).toBe(locs[0]);
  });
});

describe("assisted tier assignment", () => {
  it("records a task, then verifies it by reading membership back", async () => {
    const loc = "gid://shopify/CompanyLocation/41";
    const m = fake.addMarket(["gid://shopify/CompanyLocation/900"]);
    const tier = await tierFor(ASSISTED, m);
    const ctx = { admin: fake.admin, shop: ASSISTED, actor: "test" };
    const res = await moveLocations(ctx, [loc], null, tier);
    expect(res).toMatchObject({ mode: "assisted", verified: false });
    expect(fake.count("TierMarketUpdate")).toBe(0);
    const pending = await pendingAssignments(ASSISTED);
    expect(pending).toHaveLength(1);
    expect(pending[0].marketUrl).toMatch(/^shopify:\/\/admin\/markets\//);
    expect(await verifyAssignment(ctx, pending[0].id)).toBe(false);
    fake.markets.get(m)!.locs.push(loc); // merchant does it in Shopify admin
    expect(await verifyAssignment(ctx, pending[0].id)).toBe(true);
    expect(await pendingAssignments(ASSISTED)).toHaveLength(0);
  });
});
