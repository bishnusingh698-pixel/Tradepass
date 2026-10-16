import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import db from "../app/db.server";
import { buildConfig, buildForms, buildTexts, publicDefinition, refreshGatedHandles, resolveGatedHandles, safeSelector, safeUrl, storefrontTexts, syncStorefrontConfig, tagQuery, GATED_HANDLE_CAP } from "../app/lib/storefront-sync.server";
import { defaultSettings, type Settings } from "../app/lib/settings";
import { defaultFormDefinition } from "../app/lib/form-defaults";

// The checkout lock has its own tests (automation area); here we only check it is called.
const ensureCheckoutLock = vi.fn(async () => ({ active: false }));
vi.mock("../app/lib/checkout-lock.server", () => ({ ensureCheckoutLock: (...a: unknown[]) => ensureCheckoutLock(...(a as [])) }));

const rnd = randomBytes(4).toString("hex");
const SHOP = `test-storefront-sync-${rnd}.myshopify.com`;

type Call = { op: string; vars: Record<string, unknown> };
function fakeAdmin(handlers: Record<string, (vars: Record<string, unknown>) => unknown>) {
  const calls: Call[] = [];
  const graphql = vi.fn(async (query: string, opts?: { variables?: Record<string, unknown> }) => {
    const op = /(?:query|mutation) (\w+)/.exec(query)![1];
    const vars = opts?.variables ?? {};
    calls.push({ op, vars });
    const h = handlers[op];
    if (!h) throw new Error(`unexpected ${op}`);
    return new Response(JSON.stringify({ data: h(vars) }));
  });
  return { admin: { graphql } as never, calls };
}

const settings = (patch: (s: Settings) => void) => {
  const s = defaultSettings();
  patch(s);
  return s;
};

beforeAll(async () => {
  const s = settings((x) => {
    x.storefront.accessMode = "hide";
    x.storefront.scope = { type: "tags", ids: [], tags: ["wholesale", 'b"2b'] };
    x.texts = { fr: { "gate.message": "Connectez-vous <b>", "email.received.subject": "not storefront" } };
  });
  await db.shop.create({ data: { shop: SHOP, settings: s as object, billingPlan: "free" } });
  const def = defaultFormDefinition();
  def.spamQuestion = { enabled: true, texts: { en: { question: "2+2?", answer: "4" } } };
  await db.form.create({ data: { shop: SHOP, name: "Main", isDefault: true, definition: def as object } });
  await db.form.create({ data: { shop: SHOP, name: "Second", definition: defaultFormDefinition() as object } });
});

afterAll(async () => {
  await db.activityLog.deleteMany({ where: { shop: SHOP } });
  await db.form.deleteMany({ where: { shop: SHOP } });
  await db.shop.deleteMany({ where: { shop: SHOP } });
});

describe("config building", () => {
  it("sanitises everything that ends up in Liquid <style> or attributes", () => {
    expect(safeSelector(".a{}</style><script>x;")).toBe(".a/stylescriptx");
    expect(safeUrl("javascript:alert(1)", "/pages/wholesale")).toBe("/pages/wholesale");
    expect(safeUrl("//evil.com", "/x")).toBe("/x");
    expect(safeUrl("/pages/trade", "/x")).toBe("/pages/trade");
    const cfg = buildConfig(settings((s) => {
      s.storefront.accessMode = "wholesale_only";
      s.storefront.colors = { button: "#123abc", text: "red;}" };
      s.storefront.hidePages = ["Trade-Prices", "../etc"];
      s.debug.storefrontUntil = new Date(Date.now() + 60_000).toISOString();
    }), [], [{ id: "t1", buyerNames: { en: "Retailer <x>" } }]);
    expect(cfg.colors).toEqual({ button: "#123abc", text: null });
    expect(cfg.hidePages).toEqual(["trade-prices"]);
    expect(cfg.debugUntil).not.toBeNull();
    expect(cfg.tiers).toEqual({ t1: { en: "Retailer x" } });
  });

  it("only syncs storefront text overrides, without markup", () => {
    const t = buildTexts(settings((s) => { s.texts = { de: { "gate.login": "Anmelden", "home.title": "x", "form.field.email.label": "E-Mail <" } }; }));
    expect(t).toEqual({ de: { "gate.login": "Anmelden", "form.field.email.label": "E-Mail " } });
  });

  it("never publishes the spam answer, and publishes one form without multiple forms", () => {
    const def = defaultFormDefinition();
    def.spamQuestion = { enabled: true, texts: { en: { question: "2+2?", answer: "4" } } };
    expect(publicDefinition(def).spamQuestion).toEqual({ enabled: true, texts: { en: { question: "2+2?", answer: "" } } });
    const rows = [
      { id: "b", name: "B", isDefault: false, suggestedTierId: null, definition: def },
      { id: "a", name: "A", isDefault: true, suggestedTierId: "t1", definition: def },
    ];
    expect(Object.keys(buildForms(rows, false).forms)).toEqual(["a"]);
    const all = buildForms(rows, true);
    expect(all.default).toBe("a");
    expect(Object.keys(all.forms)).toEqual(["a", "b"]);
    expect(all.forms.a.tier).toBe("t1");
  });

  it("builds tag search queries with escaping", () => {
    expect(tagQuery(["wholesale", 'b"2b'])).toBe('tag:"wholesale" OR tag:"b\\"2b"');
  });

  it("returns built-in storefront strings with overrides", () => {
    const t = storefrontTexts("fr", { "gate.login": "Se connecter", unknown: "x" });
    expect(t["gate.login"]).toBe("Se connecter");
    expect(t["form.submit"]).toBe("Send application"); // English underneath until translated
    expect(t.unknown).toBeUndefined();
  });
});

describe("gated handle resolution", () => {
  it("pages through collections and caps the list", async () => {
    let page = 0;
    const { admin } = fakeAdmin({
      tpCollectionProducts: () => {
        page++;
        return { collection: { products: { nodes: Array.from({ length: 250 }, (_, i) => ({ handle: `p-${page}-${i}` })), pageInfo: { hasNextPage: true, endCursor: `c${page}` } } } };
      },
    });
    const r = await resolveGatedHandles(admin, settings((s) => {
      s.storefront.accessMode = "hide";
      s.storefront.scope = { type: "collections", ids: ["gid://shopify/Collection/1"], tags: [] };
    }));
    expect(r.h).toHaveLength(GATED_HANDLE_CAP);
    expect(r.more).toBe(true);
  });

  it("resolves products by id and returns nothing for 'all' or 'show'", async () => {
    const { admin } = fakeAdmin({ tpNodeHandles: (v) => ({ nodes: (v.ids as string[]).map((id) => ({ handle: `h${id.split("/").pop()}` })) }) });
    const r = await resolveGatedHandles(admin, settings((s) => {
      s.storefront.accessMode = "hide";
      s.storefront.scope = { type: "products", ids: ["gid://shopify/Product/1", "gid://shopify/Product/2"], tags: [] };
    }));
    expect(r).toEqual({ h: ["h1", "h2"], more: false });
    expect(await resolveGatedHandles(admin, settings((s) => { s.storefront.accessMode = "hide"; }))).toEqual({ h: [], more: false });
  });
});

describe("syncStorefrontConfig", () => {
  it("writes four JSON app-data metafields on the installation", async () => {
    const { admin, calls } = fakeAdmin({
      tpInstallation: () => ({ currentAppInstallation: { id: "gid://shopify/AppInstallation/9", gated: null } }),
      tpTaggedProducts: () => ({ products: { nodes: [{ handle: "bulk-soap" }], pageInfo: { hasNextPage: false, endCursor: null } } }),
      tpMetafieldsSet: () => ({ metafieldsSet: { metafields: [], userErrors: [] } }),
    });
    await syncStorefrontConfig(admin, SHOP);
    const set = calls.find((c) => c.op === "tpMetafieldsSet")!;
    const mfs = set.vars.metafields as { ownerId: string; namespace: string; key: string; type: string; value: string }[];
    expect(mfs.map((m) => m.key)).toEqual(["config", "gated", "texts", "forms"]);
    for (const m of mfs) expect(m).toMatchObject({ ownerId: "gid://shopify/AppInstallation/9", namespace: "tradepass", type: "json" });
    const value = (k: string) => JSON.parse(mfs.find((m) => m.key === k)!.value);
    expect(value("config")).toMatchObject({ mode: "hide", scope: "tags", tags: ["wholesale", 'b"2b'] });
    expect(value("gated")).toEqual({ h: ["bulk-soap"], more: false });
    expect(value("texts")).toEqual({ fr: { "gate.message": "Connectez-vous b" } });
    const forms = value("forms");
    expect(Object.keys(forms.forms)).toHaveLength(1); // free plan: default form only
    expect(JSON.stringify(forms)).not.toContain('"answer":"4"');
    expect(ensureCheckoutLock).toHaveBeenCalledWith(admin, SHOP, expect.objectContaining({ storefront: expect.objectContaining({ accessMode: "hide" }) }));
    expect(calls.find((c) => c.op === "tpTaggedProducts")!.vars.query).toBe('tag:"wholesale" OR tag:"b\\"2b"');
  });

  it("hourly refresh writes only when the handles changed", async () => {
    const make = (stored: string | null) => fakeAdmin({
      tpInstallation: () => ({ currentAppInstallation: { id: "gid://shopify/AppInstallation/9", gated: stored ? { value: stored } : null } }),
      tpTaggedProducts: () => ({ products: { nodes: [{ handle: "bulk-soap" }], pageInfo: { hasNextPage: false, endCursor: null } } }),
      tpMetafieldsSet: () => ({ metafieldsSet: { metafields: [], userErrors: [] } }),
    });
    const same = make('{"h": ["bulk-soap"], "more": false}');
    expect(await refreshGatedHandles(same.admin, SHOP)).toBe(false);
    expect(same.calls.some((c) => c.op === "tpMetafieldsSet")).toBe(false);
    const changed = make('{"h":[],"more":false}');
    expect(await refreshGatedHandles(changed.admin, SHOP)).toBe(true);
  });
});
