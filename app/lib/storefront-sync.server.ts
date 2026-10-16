// Storefront config sync. Everything the theme app extension needs lives in
// app-data metafields on the app installation (namespace "tradepass", type
// json), so price gating, the Apply buttons and the form render while our
// server sleeps (hard constraint 2). Liquid reads them as
// `app.metafields.tradepass.<key>.value`.
//   config — access mode, scope, colours, selectors, URLs, hidden pages, debug
//   gated  — { h: product handles, more: bool } for collections/products/tags scope
//   texts  — merchant overrides of the extension's locale keys, per locale
//   forms  — { default, forms: { id: { name, tier, def } } } (spam answers removed)
// JSON metafields are capped at 128 KB each (Shopify metafield limits).
import db from "../db.server";
import { gql, mutate, type Admin } from "./gql.server";
import { readSettings, type Settings } from "./settings";
import { effectivePlan, can } from "./plans";
import { readDefinition } from "./forms.server";
import type { FormDefinition } from "./form-defaults";
import { ensureCheckoutLock } from "./checkout-lock.server";
import { logActivity } from "./activity.server";

export const NAMESPACE = "tradepass";
/** Handles listed for card/quick-add gating. Each costs ~30 bytes on every storefront page. */
export const GATED_HANDLE_CAP = 1000;
export const JSON_LIMIT_BYTES = 128 * 1024;
const NODES_BATCH = 100;

type Json = Record<string, unknown>;

// ------------------------------------------------------------ extension strings

const localeModules = import.meta.glob<Json>("/extensions/tradepass-theme/locales/*.json", { eager: true, import: "default" });

function flatten(obj: Json, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else if (v && typeof v === "object" && !Array.isArray(v)) flatten(v as Json, key, out);
  }
  return out;
}

function localeFile(locale: string): Json | null {
  const want = locale.toLowerCase();
  const entries = Object.entries(localeModules).filter(([p]) => !p.endsWith(".schema.json"));
  const name = (p: string) => p.split("/").pop()!.replace(/\.json$/, "").replace(/\.default$/, "").toLowerCase();
  return (entries.find(([p]) => name(p) === want) ?? entries.find(([p]) => name(p) === want.split("-")[0]))?.[1] ?? null;
}

/** Every key in the extension's English locale file (dotted). */
export function storefrontTextKeys(): string[] {
  return Object.keys(flatten(localeFile("en") ?? {}));
}

/** Built-in storefront strings for a language (English underneath), plus merchant overrides. Used by the hosted pages. */
export function storefrontTexts(locale: string, overrides?: Record<string, string>): Record<string, string> {
  const own = localeFile(locale);
  const out = { ...flatten(localeFile("en") ?? {}), ...(own ? flatten(own) : {}) };
  for (const [k, v] of Object.entries(overrides ?? {})) if (v && k in out) out[k] = v;
  return out;
}

// ------------------------------------------------------------ config

export type StorefrontConfig = {
  v: 1;
  mode: Settings["storefront"]["accessMode"];
  scope: Settings["storefront"]["scope"]["type"];
  tags: string[];
  collections: string[]; // handles, for direct Liquid checks on product pages
  banner: boolean;
  hint: boolean;
  applyUrl: string;
  loginUrl: string;
  colors: { button: string | null; text: string | null };
  sel: { price: string; addToCart: string; productCard: string };
  hidePages: string[];
  debugUntil: string | null;
  tiers: Record<string, Record<string, string>>; // tier id → buyer-facing names per locale
};

const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const HANDLE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,254}$/u;

/** Values end up inside <style> and HTML attributes in Liquid, so anything that could break out is removed. */
export function safeSelector(s: string): string {
  return s.replace(/[<>{}\\;@"`]/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
}

export function safeUrl(u: string, fallback: string): string {
  const v = (u ?? "").trim();
  if (v.startsWith("/") && !v.startsWith("//") && !/[\s<>"'`]/.test(v)) return v.slice(0, 500);
  try {
    const url = new URL(v);
    if (url.protocol === "https:") return url.toString().slice(0, 500);
  } catch {
    // fall through
  }
  return fallback;
}

/** Strip angle brackets from merchant text so nothing can close a <script> block in Liquid output. */
function cleanText(s: string): string {
  return s.replace(/[<>]/g, "");
}

function deepClean<T>(v: T): T {
  if (typeof v === "string") return cleanText(v) as T;
  if (Array.isArray(v)) return v.map(deepClean) as T;
  if (v && typeof v === "object") {
    const o: Json = {};
    for (const [k, x] of Object.entries(v)) o[k] = deepClean(x);
    return o as T;
  }
  return v;
}

export function buildConfig(settings: Settings, collectionHandles: string[], tiers: { id: string; buyerNames: unknown }[], now = new Date()): StorefrontConfig {
  const sf = settings.storefront;
  const until = settings.debug.storefrontUntil;
  const tierNames: StorefrontConfig["tiers"] = {};
  for (const t of tiers) {
    const names = (t.buyerNames ?? {}) as Record<string, string>;
    tierNames[t.id] = Object.fromEntries(Object.entries(names).filter(([, n]) => typeof n === "string" && n).map(([l, n]) => [l, cleanText(n).slice(0, 100)]));
  }
  return {
    v: 1,
    mode: sf.accessMode,
    scope: sf.scope.type,
    tags: sf.scope.type === "tags" ? sf.scope.tags.map((t) => t.trim()).filter(Boolean).slice(0, 50) : [],
    collections: sf.scope.type === "collections" ? collectionHandles : [],
    banner: sf.showApplyBanner,
    hint: sf.showPriceHint,
    applyUrl: safeUrl(sf.applyUrl, "/pages/wholesale"),
    loginUrl: safeUrl(sf.loginUrl, "/account/login"),
    colors: {
      button: sf.colors.button && COLOR.test(sf.colors.button) ? sf.colors.button : null,
      text: sf.colors.text && COLOR.test(sf.colors.text) ? sf.colors.text : null,
    },
    sel: {
      price: safeSelector(sf.customSelectors.price),
      addToCart: safeSelector(sf.customSelectors.addToCart),
      productCard: safeSelector(sf.customSelectors.productCard),
    },
    hidePages: sf.accessMode === "wholesale_only" ? sf.hidePages.map((h) => h.trim().toLowerCase()).filter((h) => HANDLE.test(h)).slice(0, 50) : [],
    debugUntil: until && new Date(until) > now ? until : null,
    tiers: tierNames,
  };
}

/** Storefront overrides only: keys that exist in the extension's locale file (plus nothing else). */
export function buildTexts(settings: Settings): Record<string, Record<string, string>> {
  const keys = new Set(storefrontTextKeys());
  const out: Record<string, Record<string, string>> = {};
  for (const [loc, map] of Object.entries(settings.texts ?? {})) {
    for (const [k, v] of Object.entries(map ?? {})) {
      if (keys.has(k) && typeof v === "string" && v.trim()) (out[loc] ??= {})[k] = cleanText(v).slice(0, 2000);
    }
  }
  return out;
}

/** The definition as the storefront sees it: spam answers removed, no markup. */
export function publicDefinition(def: FormDefinition): FormDefinition {
  const clean = deepClean(def);
  const qs: FormDefinition["spamQuestion"]["texts"] = {};
  for (const [loc, q] of Object.entries(clean.spamQuestion?.texts ?? {})) qs[loc] = { question: q.question, answer: "" };
  return { ...clean, spamQuestion: { enabled: Boolean(clean.spamQuestion?.enabled), texts: qs } };
}

export type FormsPayload = { default: string | null; forms: Record<string, { name: string; tier: string | null; def: FormDefinition }> };

export function buildForms(rows: { id: string; name: string; isDefault: boolean; suggestedTierId: string | null; definition: unknown }[], multiple: boolean): FormsPayload {
  const sorted = [...rows].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const def = sorted[0]?.id ?? null;
  const out: FormsPayload = { default: def, forms: {} };
  // Without the multiple-forms feature every block shows the default form.
  for (const r of multiple ? sorted : sorted.slice(0, 1)) {
    const candidate = { name: cleanText(r.name), tier: r.suggestedTierId, def: publicDefinition(readDefinition(r.definition)) };
    out.forms[r.id] = candidate;
    if (byteLength(out) > JSON_LIMIT_BYTES - 1024) {
      delete out.forms[r.id]; // over Shopify's 128 KB JSON limit: later forms fall back to the default
      break;
    }
  }
  return out;
}

function sameJson(stored: string, next: unknown): boolean {
  try {
    return JSON.stringify(JSON.parse(stored)) === JSON.stringify(next);
  } catch {
    return false;
  }
}

const byteLength = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");

// ------------------------------------------------------------ Shopify reads

const INSTALLATION = `#graphql
  query tpInstallation { currentAppInstallation { id gated: metafield(namespace: "tradepass", key: "gated") { value } } }`;

const NODE_HANDLES = `#graphql
  query tpNodeHandles($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Product { handle } ... on Collection { handle } }
  }`;

const COLLECTION_PRODUCTS = `#graphql
  query tpCollectionProducts($id: ID!, $after: String) {
    collection(id: $id) { products(first: 250, after: $after) { nodes { handle } pageInfo { hasNextPage endCursor } } }
  }`;

const TAGGED_PRODUCTS = `#graphql
  query tpTaggedProducts($query: String!, $after: String) {
    products(first: 250, after: $after, query: $query) { nodes { handle } pageInfo { hasNextPage endCursor } }
  }`;

const SET = `#graphql
  mutation tpMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { metafields { key } userErrors { field message code } }
  }`;

async function handlesOf(admin: Admin, ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += NODES_BATCH) {
    const d = await gql<{ nodes: ({ handle?: string } | null)[] }>(admin, NODE_HANDLES, { ids: ids.slice(i, i + NODES_BATCH) });
    for (const n of d.nodes) if (n?.handle) out.push(n.handle);
  }
  return out;
}

async function pagedHandles(admin: Admin, query: string, vars: Json, pick: (d: Json) => { nodes: { handle: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } | null, into: Set<string>): Promise<boolean> {
  let after: string | null = null;
  do {
    const conn = pick(await gql<Json>(admin, query, { ...vars, after }));
    if (!conn) return false;
    for (const n of conn.nodes) {
      if (into.size >= GATED_HANDLE_CAP) return true;
      into.add(n.handle);
    }
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after);
  return false;
}

/** Search syntax for "has any of these tags". Quotes and backslashes are escaped. */
export function tagQuery(tags: string[]): string {
  return tags.map((t) => `tag:"${t.replace(/["\\]/g, "\\$&")}"`).join(" OR ");
}

/** Resolve the gated product handles for the current scope (empty for "all"). */
export async function resolveGatedHandles(admin: Admin, settings: Settings): Promise<{ h: string[]; more: boolean }> {
  const scope = settings.storefront.scope;
  if (settings.storefront.accessMode === "show" || scope.type === "all") return { h: [], more: false };
  const set = new Set<string>();
  let more = false;
  if (scope.type === "products") {
    const handles = await handlesOf(admin, scope.ids.filter((id) => id.startsWith("gid://shopify/Product/")));
    for (const h of handles) if (set.size < GATED_HANDLE_CAP) set.add(h); else more = true;
  } else if (scope.type === "collections") {
    for (const id of scope.ids.filter((x) => x.startsWith("gid://shopify/Collection/"))) {
      more = await pagedHandles(admin, COLLECTION_PRODUCTS, { id }, (d) => (d.collection as { products: never } | null)?.products ?? null, set);
      if (more) break;
    }
  } else if (scope.type === "tags") {
    const tags = scope.tags.map((t) => t.trim()).filter(Boolean);
    if (tags.length) more = await pagedHandles(admin, TAGGED_PRODUCTS, { query: tagQuery(tags) }, (d) => d.products as never, set);
  }
  return { h: [...set], more };
}

async function writeMetafields(admin: Admin, ownerId: string, values: Record<string, unknown>) {
  const metafields = Object.entries(values).map(([key, v]) => {
    const value = JSON.stringify(v);
    if (Buffer.byteLength(value, "utf8") > JSON_LIMIT_BYTES) throw new Error(`metafield ${key} is over 128 KB`);
    return { ownerId, namespace: NAMESPACE, key, type: "json", value };
  });
  if (metafields.length) await mutate(admin, "metafieldsSet", SET, { metafields });
}

async function loadInputs(shop: string) {
  const [row, forms, tiers] = await Promise.all([
    db.shop.findUnique({ where: { shop }, select: { settings: true, billingPlan: true, isDevStore: true } }),
    db.form.findMany({ where: { shop }, select: { id: true, name: true, isDefault: true, suggestedTierId: true, definition: true }, orderBy: { createdAt: "asc" } }),
    db.tier.findMany({ where: { shop }, select: { id: true, buyerNames: true } }),
  ]);
  const settings = readSettings(row?.settings ?? {});
  const plan = effectivePlan(row?.billingPlan ?? "free", Boolean(row?.isDevStore));
  return { settings, plan, forms, tiers };
}

/**
 * Write everything the storefront needs into app-owned metafields (access mode,
 * scope, texts per language, form definition, Function config) so the theme
 * extension and the validation Function work while our server sleeps.
 * Call after any change to storefront settings, forms, texts or tiers.
 */
export async function syncStorefrontConfig(admin: Admin, shop: string): Promise<void> {
  const { settings, plan, forms, tiers } = await loadInputs(shop);
  const inst = await gql<{ currentAppInstallation: { id: string } }>(admin, INSTALLATION);
  const ownerId = inst.currentAppInstallation.id;
  const sf = settings.storefront;
  const collectionHandles = sf.scope.type === "collections" ? await handlesOf(admin, sf.scope.ids.filter((x) => x.startsWith("gid://shopify/Collection/"))) : [];
  const gated = await resolveGatedHandles(admin, settings);
  await writeMetafields(admin, ownerId, {
    config: buildConfig(settings, collectionHandles, tiers),
    gated,
    texts: buildTexts(settings),
    forms: buildForms(forms, can(plan, "multiple_forms")),
  });
  // The checkout lock has its own config and its own failure modes; the storefront config is already written.
  try {
    await ensureCheckoutLock(admin, shop, settings);
  } catch (e) {
    await logActivity({ shop, actor: "system", action: "storefront.checkout_lock", result: "failed", detail: { error: (e as Error).name } }).catch(() => undefined);
    throw e;
  }
}

/** Hourly: re-resolve gated handles when products may have joined or left a collection or tag. Writes only on change. */
export async function refreshGatedHandles(admin: Admin, shop: string): Promise<boolean> {
  const { settings } = await loadInputs(shop);
  const inst = await gql<{ currentAppInstallation: { id: string; gated: { value: string } | null } }>(admin, INSTALLATION);
  const next = await resolveGatedHandles(admin, settings);
  const current = inst.currentAppInstallation.gated?.value ?? null;
  if (current && sameJson(current, next)) return false;
  await writeMetafields(admin, inst.currentAppInstallation.id, { gated: next });
  return true;
}
