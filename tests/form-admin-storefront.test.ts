import { afterAll, describe, expect, it } from "vitest";
import db from "../app/db.server";
import { defaultSettings, readSettings, type Settings } from "../app/lib/settings";
import { getSettings } from "../app/lib/settings.server";
import { mergeTextEdits, parseStorefrontInput, describeChange } from "../app/components/storefront/model";
import { saveStorefrontSettings } from "../app/components/storefront/save.server";
import { blockEditorUrl, embedEditorUrl } from "../app/components/storefront/extension";

const shop = `test-form-admin-sf-${Math.random().toString(36).slice(2, 8)}.myshopify.com`;

afterAll(async () => {
  await db.shop.deleteMany({ where: { shop } });
});

const body = (patch: Partial<Settings["storefront"]> = {}, texts: Record<string, Record<string, string>> = {}) => ({
  storefront: { ...defaultSettings().storefront, ...patch },
  texts,
});

describe("storefront settings mapping", () => {
  it("maps a valid post onto settings and normalises lists", () => {
    const res = parseStorefrontInput(
      body({
        accessMode: "hide",
        scope: { type: "collections", ids: ["gid://shopify/Collection/1", "gid://shopify/Collection/1"], tags: ["ignored"] },
        colors: { button: "#AABBCC", text: null },
        hidePages: ["Price-List"],
      }),
      defaultSettings(),
      "free",
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.storefront.scope).toEqual({ type: "collections", ids: ["gid://shopify/Collection/1"], tags: [] });
    expect(res.value.storefront.colors).toEqual({ button: "#aabbcc", text: null });
    expect(res.value.storefront.hidePages).toEqual(["price-list"]);
  });

  it("gates wholesale-only to Starter, but lets a downgraded shop keep it", () => {
    const off = parseStorefrontInput(body({ accessMode: "wholesale_only" }), defaultSettings(), "free");
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.errors[0].code).toBe("plan");
    expect(parseStorefrontInput(body({ accessMode: "wholesale_only" }), defaultSettings(), "starter").ok).toBe(true);
    const already = defaultSettings();
    already.storefront.accessMode = "wholesale_only";
    expect(parseStorefrontInput(body({ accessMode: "wholesale_only" }), already, "free").ok).toBe(true);
  });

  it("rejects unsafe or incomplete input", () => {
    const res = parseStorefrontInput(
      body({
        accessMode: "hide",
        scope: { type: "products", ids: ["gid://shopify/Collection/1"], tags: [] },
        applyUrl: "javascript:alert(1)",
        loginUrl: "",
        colors: { button: "red", text: null },
        customSelectors: { price: ".price}body{display:none", addToCart: "", productCard: "" },
        hidePages: ["../etc"],
      }, { de: { "gate.message": "x".repeat(501), "not.a.key": "ignored" } }),
      defaultSettings(),
      "pro",
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.map((e) => `${e.code}:${e.anchor}`).sort()).toEqual(
        ["color:sf-color-button", "handle:sf-hide-pages", "scopeIds:sf-scope", "selector:sf-sel-price", "text:sf-text-gate.message", "url:sf-apply-url", "url:sf-login-url"].sort(),
      );
    }
    const empty = parseStorefrontInput(body({ accessMode: "hide", scope: { type: "tags", ids: [], tags: [] } }), defaultSettings(), "pro");
    expect(!empty.ok && empty.errors[0].code).toBe("scopeEmpty");
    // An empty scope list doesn't matter while prices are shown.
    expect(parseStorefrontInput(body({ accessMode: "show", scope: { type: "tags", ids: [], tags: [] } }), defaultSettings(), "pro").ok).toBe(true);
  });

  it("merges text edits: set, reset to default, untouched languages kept out", () => {
    const current = { de: { "gate.login": "Anmelden", "gate.apply": "Bewerben" }, fr: { "gate.login": "Connexion" } };
    const merged = mergeTextEdits(current, { de: { "gate.login": "", "gate.message": "Preise nur für Händler." }, ja: { "gate.apply": "申し込む" } });
    expect(merged).toEqual({ de: { "gate.apply": "Bewerben", "gate.message": "Preise nur für Händler." }, ja: { "gate.apply": "申し込む" } });
  });

  it("describes mode changes without personal data", () => {
    const a = defaultSettings().storefront;
    expect(describeChange(a, { ...a, accessMode: "hide" })).toEqual({ accessMode: { from: "show", to: "hide" }, scope: "all" });
  });

  it("saves to the shop row: settings, onboarding flag, new languages and resets", async () => {
    const start = defaultSettings();
    start.texts = { de: { "gate.login": "Anmelden", "form.title": "Formular" } };
    await db.shop.create({ data: { shop, settings: start as object } });
    const parsed = parseStorefrontInput(
      body({ accessMode: "hide", showPriceHint: true }, { de: { "gate.login": "" }, fr: { "gate.apply": "Demander un compte pro" } }),
      start,
      "starter",
    );
    if (!parsed.ok) throw new Error("invalid");
    await saveStorefrontSettings(shop, parsed.value);
    const saved = await getSettings(shop);
    expect(saved.storefront.accessMode).toBe("hide");
    expect(saved.storefront.showPriceHint).toBe(true);
    expect(saved.onboarding.storefrontReviewed).toBe(true);
    // Reset removed the German override, other German keys survive, French was added.
    expect(saved.texts).toEqual({ de: { "form.title": "Formular" }, fr: { "gate.apply": "Demander un compte pro" } });
    expect(readSettings(saved).storefront.colors).toEqual({ button: null, text: null });
  });
});

describe("theme editor deep links", () => {
  it("builds the documented embed and block URLs", () => {
    expect(embedEditorUrl("x.myshopify.com", "KEY", "tradepass-embed")).toBe(
      "https://x.myshopify.com/admin/themes/current/editor?context=apps&template=index&activateAppId=KEY/tradepass-embed",
    );
    expect(blockEditorUrl("x.myshopify.com", "KEY", "wholesale-form")).toBe(
      "https://x.myshopify.com/admin/themes/current/editor?template=page&addAppBlockId=KEY/wholesale-form&target=newAppsSection",
    );
  });
});
