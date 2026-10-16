import { describe, expect, it } from "vitest";
import { parseShopFacts } from "../app/lib/shop.server";

const base = (over: Record<string, unknown> = {}) => ({
  data: {
    shop: {
      plan: { publicDisplayName: "Grow", partnerDevelopment: false, shopifyPlus: false },
      features: { directConnectionCatalogAssignmentEnabled: false },
      entitlements: { b2b: { enabled: true }, markets: { b2b: { enabled: true, catalogs: { enabled: true, limit: 3 } } } },
      ...over,
    },
    shopLocales: [{ locale: "fr", primary: true, published: true }, { locale: "en", primary: false, published: true }],
    b2bMarkets: { nodes: [
      { id: "m1", catalogs: { nodes: [{ id: "c1" }] } },
      { id: "m2", catalogs: { nodes: [{ id: "c1" }, { id: "c2" }] } },
    ] },
  },
});

describe("plan / B2B detection", () => {
  it("reads a non-Plus B2B store and counts distinct B2B catalogs (incl. merchant-made)", () => {
    const f = parseShopFacts(base());
    expect(f).toMatchObject({ planName: "Grow", isPlus: false, b2bEnabled: true, catalogLimit: 3, catalogsUsed: 2, primaryLocale: "fr" });
  });
  it("reports no catalog budget when B2B catalogs are off", () => {
    const f = parseShopFacts(base({ entitlements: { b2b: { enabled: false }, markets: { b2b: { enabled: false, catalogs: { enabled: false, limit: 0 } } } } }));
    expect(f.b2bEnabled).toBe(false);
    expect(f.catalogLimit).toBe(0);
  });
});
