/* eslint-disable @typescript-eslint/no-explicit-any -- fake GraphQL payloads */
import { afterAll, describe, expect, it } from "vitest";
import {
  allowReason, cartValidationsGenerateRun, FALLBACK_MESSAGE, localeFromLanguageCode, pickMessage,
} from "../extensions/tradepass-checkout-lock/src/cart_validations_generate_run.js";
import { buildLockConfig, ensureCheckoutLock, exemptTags, FUNCTION_HANDLE } from "../app/lib/checkout-lock.server";
import { defaultSettings, patchSettings } from "../app/lib/settings";
import db from "../app/db.server";

const config = {
  enabled: true,
  defaultLocale: "fr",
  messages: { en: "Wholesale only.", fr: "Réservé aux professionnels.", "pt-BR": "Somente atacado.", de: "Nur Großhandel." },
};

function input(over: { company?: boolean; exempt?: boolean; lines?: any[]; step?: string | null; lang?: string; cfg?: any } = {}) {
  return {
    buyerJourney: { step: over.step === undefined ? "CHECKOUT_COMPLETION" : over.step },
    cart: {
      buyerIdentity: {
        customer: over.exempt === undefined ? null : { exempt: over.exempt },
        purchasingCompany: over.company ? { company: { id: "gid://shopify/Company/1" } } : null,
      },
      lines: over.lines ?? [{ merchandise: { __typename: "ProductVariant", product: { isGiftCard: false } } }],
    },
    localization: { language: { isoCode: over.lang ?? "EN" } },
    validation: { config: over.cfg === null ? null : { jsonValue: over.cfg ?? config } },
  };
}
const errorsOf = (i: any) => cartValidationsGenerateRun(i).operations[0].validationAdd.errors;

describe("checkout lock Function", () => {
  it("lets a B2B (company) buyer check out", () => {
    expect(allowReason(input({ company: true }))).toBe("company");
    expect(errorsOf(input({ company: true }))).toEqual([]);
  });

  it("blocks a retail buyer at checkout with the buyer's language", () => {
    expect(errorsOf(input({ exempt: false }))).toEqual([{ message: "Wholesale only.", target: "$.cart" }]);
    expect(errorsOf(input({ lang: "DE" }))[0].message).toBe("Nur Großhandel.");
    expect(errorsOf(input({ step: "CHECKOUT_INTERACTION" }))).toHaveLength(1);
  });

  it("treats an unknown step as checkout (never opens the store silently)", () => {
    expect(errorsOf(input({ step: null }))).toHaveLength(1);
  });

  it("allows cart interactions so theme cart forms keep working", () => {
    expect(errorsOf(input({ step: "CART_INTERACTION" }))).toEqual([]);
  });

  it("allows gift-card-only carts, but not mixed carts", () => {
    const gift = { merchandise: { __typename: "ProductVariant", product: { isGiftCard: true } } };
    const shirt = { merchandise: { __typename: "ProductVariant", product: { isGiftCard: false } } };
    expect(errorsOf(input({ lines: [gift, gift] }))).toEqual([]);
    expect(errorsOf(input({ lines: [gift, shirt] }))).toHaveLength(1);
    expect(errorsOf(input({ lines: [{ merchandise: { __typename: "CustomProduct" } }] }))).toHaveLength(1);
    expect(errorsOf(input({ lines: [] }))).toHaveLength(1);
  });

  it("lets customers with an exempt tag through (e.g. staff draft orders)", () => {
    expect(allowReason(input({ exempt: true }))).toBe("exempt");
    expect(errorsOf(input({ exempt: true }))).toEqual([]);
  });

  it("passes when the config says the lock is off", () => {
    expect(errorsOf(input({ cfg: { ...config, enabled: false } }))).toEqual([]);
  });

  it("falls back: region → language → store default → English → built-in", () => {
    expect(localeFromLanguageCode("PT_BR")).toBe("pt-BR");
    expect(localeFromLanguageCode("ZH_TW")).toBe("zh-TW");
    expect(localeFromLanguageCode("EN")).toBe("en");
    expect(pickMessage(config, "pt-BR")).toBe("Somente atacado.");
    expect(pickMessage(config, "pt-PT")).toBe("Somente atacado."); // other regional variant of the same language
    expect(pickMessage(config, "pt")).toBe("Somente atacado.");
    expect(pickMessage(config, "ja")).toBe("Réservé aux professionnels."); // store default
    expect(pickMessage({ messages: { en: "EN" } }, "ja")).toBe("EN");
    expect(pickMessage({ messages: { fr: "  " } }, "fr")).toBe(FALLBACK_MESSAGE);
    expect(errorsOf(input({ cfg: null }))[0].message).toBe(FALLBACK_MESSAGE);
  });
});

describe("checkout lock config", () => {
  it("builds messages per published language with merchant overrides first", () => {
    const s = patchSettings(defaultSettings(), { texts: { de: { "automation.checkoutLock.message": "Nur für Händler." } } });
    const cfg = buildLockConfig(s, ["de", "fr", "xx"], "fr", true);
    expect(cfg.defaultLocale).toBe("fr");
    expect(cfg.messages.de).toBe("Nur für Händler.");
    expect(Object.keys(cfg.messages).sort()).toEqual(["de", "en", "fr", "xx"]);
    expect(cfg.messages.en).toMatch(/approved wholesale customers only/);
    // Size stays far below the metafield budget even with every built-in language.
    const all = buildLockConfig(s, ["ar", "bg", "cs", "da", "de", "el", "es", "fi", "fr", "he", "hi", "hr", "hu", "id", "it", "ja", "ko", "lt", "ms", "nb", "nl", "pl", "pt-BR", "pt-PT", "ro", "ru", "sk", "sl", "sv", "th", "tr", "ur", "vi", "zh-CN", "zh-TW"], "en", true);
    expect(Buffer.byteLength(JSON.stringify(all))).toBeLessThan(10_000);
  });

  it("cleans exempt tags", () => {
    const s = patchSettings(defaultSettings(), { storefront: { exemptCustomerTags: [" staff ", "staff", "", "rep"] } });
    expect(exemptTags(s)).toEqual(["staff", "rep"]);
  });
});

function fakeAdmin(existing: { id: string; enabled: boolean } | null) {
  const calls: { op: string; variables: any }[] = [];
  const admin = {
    graphql: async (query: string, opts?: { variables?: any }) => {
      const op = /(?:query|mutation)\s+(\w+)/.exec(query)![1];
      const variables = opts?.variables ?? {};
      calls.push({ op, variables });
      const data: Record<string, () => any> = {
        TradepassValidations: () => ({
          validations: { nodes: existing ? [{ id: existing.id, enabled: existing.enabled, shopifyFunction: { handle: FUNCTION_HANDLE, appKey: process.env.SHOPIFY_API_KEY ?? "" } }] : [] },
        }),
        TradepassShopLocales: () => ({ shopLocales: [{ locale: "en", primary: true, published: true }, { locale: "de", primary: false, published: true }] }),
        TradepassLockCreate: () => ({ validationCreate: { validation: { id: "gid://shopify/Validation/1", enabled: true }, userErrors: [] } }),
        TradepassLockUpdate: () => ({ validationUpdate: { validation: { id: existing!.id, enabled: variables.validation.enable }, userErrors: [] } }),
      };
      return new Response(JSON.stringify({ data: data[op]() }));
    },
  };
  return { admin: admin as any, calls };
}

const shop = `test-automation-lock-${Math.random().toString(36).slice(2, 8)}.myshopify.com`;
afterAll(async () => {
  await db.activityLog.deleteMany({ where: { shop } });
});

describe("ensureCheckoutLock", () => {
  const wholesale = patchSettings(defaultSettings(), { storefront: { accessMode: "wholesale_only", exemptCustomerTags: ["staff"] } });

  it("creates the validation with config metafields when wholesale-only is turned on", async () => {
    const { admin, calls } = fakeAdmin(null);
    expect(await ensureCheckoutLock(admin, shop, wholesale)).toEqual({ active: true });
    const create = calls.find((c) => c.op === "TradepassLockCreate")!;
    expect(create.variables.validation).toMatchObject({ functionHandle: FUNCTION_HANDLE, enable: true, blockOnFailure: false });
    const mf = Object.fromEntries(create.variables.validation.metafields.map((m: any) => [m.key, m]));
    expect(mf.lock_vars).toMatchObject({ namespace: "$app:tradepass", type: "json" });
    expect(JSON.parse(mf.lock_vars.value)).toEqual({ exemptTags: ["staff"] });
    expect(JSON.parse(mf.lock_config.value)).toMatchObject({ enabled: true, defaultLocale: "en" });
    expect(Object.keys(JSON.parse(mf.lock_config.value).messages).sort()).toEqual(["de", "en"]);
  });

  it("disables an existing validation when the mode changes", async () => {
    const { admin, calls } = fakeAdmin({ id: "gid://shopify/Validation/9", enabled: true });
    expect(await ensureCheckoutLock(admin, shop, defaultSettings())).toEqual({ active: false });
    expect(calls.find((c) => c.op === "TradepassLockUpdate")!.variables).toMatchObject({ id: "gid://shopify/Validation/9", validation: { enable: false } });
  });

  it("does nothing when the lock is off and was never created", async () => {
    const { admin, calls } = fakeAdmin(null);
    expect(await ensureCheckoutLock(admin, shop, defaultSettings())).toEqual({ active: false });
    expect(calls.map((c) => c.op)).toEqual(["TradepassValidations"]);
  });
});
