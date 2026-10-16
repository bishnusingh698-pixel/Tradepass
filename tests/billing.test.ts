import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("../app/lib/checkout-lock.server", () => ({ ensureCheckoutLock: vi.fn(async () => ({ active: false })) }));
vi.mock("../app/lib/storefront-sync.server", () => ({ syncStorefrontConfig: vi.fn(async () => undefined) }));

import db from "../app/db.server";
import { applyDowngrade, downgradeImpact, lostFeatures, planForSubscriptionName, remainingTrialDays } from "../app/lib/billing.server";
import { getSettings, updateSettings } from "../app/lib/settings.server";
import { ensureCheckoutLock } from "../app/lib/checkout-lock.server";

const shop = `test-billing-${Math.random().toString(36).slice(2, 8)}.myshopify.com`;
afterAll(async () => {
  await db.rule.deleteMany({ where: { shop } });
  await db.tier.deleteMany({ where: { shop } });
  await db.activityLog.deleteMany({ where: { shop } });
  await db.shop.deleteMany({ where: { shop } });
});

describe("billing", () => {
  it("maps Shopify subscription names to plans", () => {
    expect(planForSubscriptionName("Tradepass Starter")).toBe("starter");
    expect(planForSubscriptionName("Tradepass Pro")).toBe("pro");
    expect(planForSubscriptionName(undefined)).toBe("free");
  });

  it("gives the 14-day trial once, counting from the first start", () => {
    const now = new Date("2026-10-16T00:00:00Z");
    expect(remainingTrialDays("pro", null, now)).toBe(14);
    expect(remainingTrialDays("pro", new Date("2026-10-06T00:00:00Z"), now)).toBe(4);
    expect(remainingTrialDays("starter", new Date("2026-09-01T00:00:00Z"), now)).toBe(0);
  });

  it("lists what a downgrade turns off", () => {
    expect(lostFeatures("pro", "starter")).toEqual(expect.arrayContaining(["auto_rules", "import", "flow"]));
    expect(lostFeatures("pro", "starter")).not.toContain("wholesale_only");
    expect(lostFeatures("starter", "free")).toContain("wholesale_only");
  });

  it("never turns wholesale-only off without explicit confirmation", async () => {
    await db.shop.create({ data: { shop } });
    await updateSettings(shop, { storefront: { accessMode: "wholesale_only" } });
    await db.tier.createMany({ data: [{ shop, name: "A" }, { shop, name: "B" }] });
    await db.rule.create({ data: { shop, kind: "approve", conditions: {}, action: {} } });

    const impact = await downgradeImpact(shop, "wholesale_only", "pro", "free");
    expect(impact).toMatchObject({ wholesaleOnly: true, extraTiers: 1, rules: 1 });

    const ctx = { admin: { graphql: vi.fn() }, shop, settings: await getSettings(shop), actor: "Test" };
    expect(await applyDowngrade(ctx, "free", false)).toEqual({ ok: false, reason: "confirm_wholesale" });
    expect((await getSettings(shop)).storefront.accessMode).toBe("wholesale_only");

    expect(await applyDowngrade(ctx, "free", true)).toEqual({ ok: true });
    expect((await getSettings(shop)).storefront.accessMode).toBe("hide");
    expect(ensureCheckoutLock).toHaveBeenCalled();
    expect(await db.rule.count({ where: { shop, enabled: true } })).toBe(0);
  });
});
