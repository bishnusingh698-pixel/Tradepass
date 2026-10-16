import { describe, expect, it } from "vitest";
import { UserErrorsError } from "../app/lib/gql.server";
import { createBlockReason, mapShopifyError, syncStateFor, validateTierInput, type TierInput } from "../app/lib/tiers.server";
import { addressFromAnswers, isSafeToRetry, TAX_EXEMPTIONS, emptySteps, type ApprovalState } from "../app/lib/approval.server";
import { summarizeCertificates } from "../app/lib/buyers.server";

const b2b = { b2bEnabled: true, b2bMarketsEnabled: true };
const budget = (used: number | null, limit: number | null, direct = false) => ({ used, limit, direct });

describe("tier creation budget (acceptance 3)", () => {
  it("allows a tier while catalog slots remain", () => {
    expect(createBlockReason("pro", 2, b2b, budget(2, 3))).toBeNull();
  });
  it("blocks the 4th catalog, counting catalogs made outside Tradepass", () => {
    expect(createBlockReason("pro", 1, b2b, budget(3, 3))).toBe("catalog_limit");
  });
  it("linking an existing B2B catalog needs no new slot", () => {
    expect(createBlockReason("pro", 3, b2b, budget(3, 3), "existing")).toBeNull();
  });
  it("Plus with direct catalog assignment is not capped by the catalog budget", () => {
    expect(createBlockReason("pro", 7, b2b, budget(null, 3, true))).toBeNull();
  });
  it("Free plan: one tier only", () => {
    expect(createBlockReason("free", 0, b2b, budget(0, 3))).toBeNull();
    expect(createBlockReason("free", 1, b2b, budget(1, 3))).toBe("plan_limit");
  });
  it("explains missing B2B or Markets first", () => {
    expect(createBlockReason("pro", 0, { b2bEnabled: false, b2bMarketsEnabled: false }, budget(0, 0))).toBe("no_b2b");
    expect(createBlockReason("pro", 0, { b2bEnabled: true, b2bMarketsEnabled: false }, budget(0, 3))).toBe("markets_unavailable");
  });
  it("maps Shopify's catalog-cap error to our code", () => {
    const e = new UserErrorsError("catalogCreate", [{ message: "limit", code: "B2B_CATALOG_LIMIT_REACHED" }]);
    expect(mapShopifyError(e).code).toBe("catalog_limit");
    expect(mapShopifyError(new UserErrorsError("marketCreate", [{ message: "x", code: "NOT_ENTITLED_TO_ACTIVATE_MARKET" }])).code).toBe("markets_unavailable");
  });
});

describe("tier editor validation", () => {
  const base: TierInput = {
    name: "Retailer", buyerNames: {}, pricing: { kind: "percent", pct: 20 }, products: { kind: "all" },
    paymentTermsTemplateId: null, checkoutToDraft: false, tax: "charge", direct: false,
  };
  it("accepts a valid tier", () => expect(validateTierInput(base)).toEqual({}));
  it("flags each bad field with its own message", () => {
    expect(validateTierInput({ ...base, name: " " }).name).toBe("tiers.editor.error.nameRequired");
    expect(validateTierInput({ ...base, pricing: { kind: "percent", pct: 95 } }).pct).toBe("tiers.editor.error.pctRange");
    expect(validateTierInput({ ...base, pricing: { kind: "percent", pct: 0 } }).pct).toBe("tiers.editor.error.pctRange");
    expect(validateTierInput({ ...base, pricing: { kind: "existing", catalogGid: "" } }).catalog).toBeDefined();
    expect(validateTierInput({ ...base, products: { kind: "collections", ids: [] } }).collections).toBeDefined();
  });
});

describe("sync with Shopify", () => {
  const tier = { mode: "market", marketGid: "m1", catalogGid: "c1", priceListGid: "p1", discountPct: 20 };
  const nodes = {
    m1: { status: "ACTIVE", catalogs: { nodes: [{ id: "c1" }] } },
    c1: { status: "ACTIVE", priceList: { id: "p1" } },
    p1: { parent: { adjustment: { type: "PERCENTAGE_DECREASE", value: 20 } } },
  };
  it("ok when everything matches", () => expect(syncStateFor(tier, nodes, false)).toBe("ok"));
  it("missing when the market or catalog was deleted", () => {
    expect(syncStateFor(tier, { ...nodes, m1: null }, false)).toBe("missing");
    expect(syncStateFor(tier, { ...nodes, c1: null }, false)).toBe("missing");
  });
  it("changed when the merchant edits the discount, unlinks the catalog or deactivates the market", () => {
    expect(syncStateFor(tier, { ...nodes, p1: { parent: { adjustment: { type: "PERCENTAGE_DECREASE", value: 25 } } } }, false)).toBe("changed_in_shopify");
    expect(syncStateFor(tier, { ...nodes, m1: { status: "ACTIVE", catalogs: { nodes: [] } } }, false)).toBe("changed_in_shopify");
    expect(syncStateFor(tier, { ...nodes, m1: { status: "DRAFT", catalogs: { nodes: [{ id: "c1" }] } } }, false)).toBe("changed_in_shopify");
  });
  it("flags a Plus-only tier after a downgrade from Plus", () => {
    expect(syncStateFor({ ...tier, mode: "direct", marketGid: null }, nodes, false)).toBe("changed_in_shopify");
  });
});

describe("approval helpers", () => {
  it("offers all 74 TaxExemption values", () => {
    expect(TAX_EXEMPTIONS).toHaveLength(74);
    expect(new Set(TAX_EXEMPTIONS).size).toBe(74);
    expect(TAX_EXEMPTIONS).toContain("US_TX_RESELLER_EXEMPTION");
    expect(TAX_EXEMPTIONS).toContain("CA_STATUS_CARD_EXEMPTION");
  });
  it("reads form addresses", () => {
    expect(addressFromAnswers({ address1: "1 Main", city: "Austin", province: "tx", zip: "78701", countryCode: "us" })).toMatchObject({ zoneCode: "tx", countryCode: "US" });
    expect(addressFromAnswers(null)).toBeNull();
  });
  it("auto-retries only transient failures, at most 3 times", () => {
    const st = (code: string, autoRetries = 0): ApprovalState => {
      const steps = emptySteps();
      steps.company.status = "done";
      steps.tier = { status: "failed", code };
      return { input: {} as ApprovalState["input"], steps, startedAt: new Date().toISOString(), autoRetries };
    };
    expect(isSafeToRetry(st("concurrent"))).toBe(true);
    expect(isSafeToRetry(st("tier_missing"))).toBe(false);
    expect(isSafeToRetry(st("busy", 3))).toBe(false);
  });
  it("summarises certificates by the worst status", () => {
    expect(summarizeCertificates(["valid", "expired"])).toBe("expired");
    expect(summarizeCertificates(["valid", "expiring"])).toBe("expiring");
    expect(summarizeCertificates([])).toBe("none");
  });
});
