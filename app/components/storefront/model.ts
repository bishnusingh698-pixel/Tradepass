// Storefront page: what the merchant can edit, and how a posted form maps onto
// Settings. Pure so it can be unit-tested and reused for client-side checks.
import type { AccessMode, LocalizedTexts, ScopeType, Settings } from "../../lib/settings";
import { can, type PlanId } from "../../lib/plans";
import { isSafeUrl } from "../form-builder/model";

/**
 * Merchant-editable storefront texts. Keys are the theme extension's locale
 * keys (extensions/tradepass-theme/locales/*.json) and are stored as overrides
 * in Settings.texts[locale][key]. `checkout.message` is the wholesale-only
 * checkout-lock message (validation Function config).
 */
export const STOREFRONT_TEXTS = [
  { key: "gate.message", group: "gate", multiline: true },
  { key: "gate.login", group: "gate" },
  { key: "gate.apply", group: "gate" },
  { key: "gate.cart", group: "gate", multiline: true },
  { key: "banner.text", group: "banner" },
  { key: "banner.link", group: "banner" },
  { key: "hint.text", group: "banner" },
  { key: "wall.heading", group: "wall" },
  { key: "wall.message", group: "wall", multiline: true },
  { key: "checkout.message", group: "wall", multiline: true },
] as const;

export type StorefrontTextKey = (typeof STOREFRONT_TEXTS)[number]["key"];
export const STOREFRONT_TEXT_KEYS: readonly string[] = STOREFRONT_TEXTS.map((x) => x.key);
export const TEXT_MAX = 500;

export const ACCESS_MODES: AccessMode[] = ["show", "hide", "wholesale_only"];
export const SCOPE_TYPES: ScopeType[] = ["all", "collections", "products", "tags"];

export type StorefrontInput = {
  storefront: Settings["storefront"];
  /** Only languages the merchant touched: { locale: { key: text } }; "" means "reset to default". */
  texts: Record<string, Record<string, string>>;
};

export type StorefrontErrorCode =
  | "mode" | "plan" | "scopeEmpty" | "scopeIds" | "tag" | "url" | "color" | "selector" | "handle" | "text";
export type StorefrontError = { code: StorefrontErrorCode; anchor: string; values?: Record<string, string | number> };

const GID = { collections: /^gid:\/\/shopify\/Collection\/\d+$/, products: /^gid:\/\/shopify\/Product\/\d+$/ } as const;
const HEX = /^#[0-9a-fA-F]{6}$/;
const HANDLE = /^[a-z0-9][a-z0-9_-]{0,254}$/;
// Selectors end up in CSS rules and querySelector calls; block anything that could close a rule.
const SELECTOR_BAD = /[{}<>;@\\]/;
const LOCALE_KEY = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown, max = 250) =>
  Array.isArray(v) ? [...new Set(v.map((x) => str(x, 255)).filter(Boolean))].slice(0, max) : [];

/**
 * Validate a posted storefront form against the current settings and plan.
 * Wholesale-only needs Starter; a shop already in that mode may keep it after
 * a downgrade (turning it off is a separate, confirmed choice).
 */
export function parseStorefrontInput(
  body: unknown,
  current: Settings,
  plan: PlanId,
): { ok: true; value: StorefrontInput } | { ok: false; errors: StorefrontError[] } {
  const errors: StorefrontError[] = [];
  const b = isObj(body) ? body : {};
  const sf = isObj(b.storefront) ? b.storefront : {};
  const scope = isObj(sf.scope) ? sf.scope : {};
  const colors = isObj(sf.colors) ? sf.colors : {};
  const sel = isObj(sf.customSelectors) ? sf.customSelectors : {};

  const accessMode = ACCESS_MODES.includes(sf.accessMode as AccessMode) ? (sf.accessMode as AccessMode) : null;
  if (!accessMode) errors.push({ code: "mode", anchor: "sf-mode" });
  if (accessMode === "wholesale_only" && current.storefront.accessMode !== "wholesale_only" && !can(plan, "wholesale_only")) {
    errors.push({ code: "plan", anchor: "sf-mode" });
  }

  const scopeType = SCOPE_TYPES.includes(scope.type as ScopeType) ? (scope.type as ScopeType) : "all";
  const ids = list(scope.ids);
  const tags = list(scope.tags, 100);
  if (scopeType === "collections" || scopeType === "products") {
    if (ids.some((id) => !GID[scopeType].test(id))) errors.push({ code: "scopeIds", anchor: "sf-scope" });
  }
  if (tags.some((tag) => tag.length > 255 || /[,<>]/.test(tag))) errors.push({ code: "tag", anchor: "sf-scope-tags" });
  const gating = accessMode === "hide" || accessMode === "wholesale_only";
  const scopeList = scopeType === "tags" ? tags : ids;
  if (gating && scopeType !== "all" && scopeList.length === 0) {
    errors.push({ code: "scopeEmpty", anchor: scopeType === "tags" ? "sf-scope-tags" : "sf-scope" });
  }

  const applyUrl = str(sf.applyUrl);
  const loginUrl = str(sf.loginUrl);
  if (!isSafeUrl(applyUrl)) errors.push({ code: "url", anchor: "sf-apply-url" });
  if (!isSafeUrl(loginUrl)) errors.push({ code: "url", anchor: "sf-login-url" });

  const color = (v: unknown, anchor: string) => {
    const s = str(v, 20);
    if (!s) return null;
    if (!HEX.test(s)) errors.push({ code: "color", anchor });
    return s.toLowerCase();
  };
  const buttonColor = color(colors.button, "sf-color-button");
  const textColor = color(colors.text, "sf-color-text");

  const selector = (v: unknown, anchor: string) => {
    const s = str(v, 500);
    if (s && SELECTOR_BAD.test(s)) errors.push({ code: "selector", anchor });
    return s;
  };
  const customSelectors = {
    price: selector(sel.price, "sf-sel-price"),
    addToCart: selector(sel.addToCart, "sf-sel-cart"),
    productCard: selector(sel.productCard, "sf-sel-card"),
  };

  const hidePages = list(sf.hidePages, 100).map((h) => h.toLowerCase());
  if (hidePages.some((h) => !HANDLE.test(h))) errors.push({ code: "handle", anchor: "sf-hide-pages" });
  const exemptCustomerTags = list(sf.exemptCustomerTags, 50);
  if (exemptCustomerTags.some((tag) => /[,<>]/.test(tag))) errors.push({ code: "tag", anchor: "sf-exempt-tags" });

  const texts: Record<string, Record<string, string>> = {};
  if (isObj(b.texts)) {
    for (const [loc, map] of Object.entries(b.texts)) {
      if (!LOCALE_KEY.test(loc) || !isObj(map)) continue;
      for (const [key, value] of Object.entries(map)) {
        if (!STOREFRONT_TEXT_KEYS.includes(key) || typeof value !== "string") continue;
        if (value.trim().length > TEXT_MAX) errors.push({ code: "text", anchor: `sf-text-${key}`, values: { max: TEXT_MAX } });
        (texts[loc] ??= {})[key] = value.trim();
      }
    }
  }

  if (errors.length || !accessMode) return { ok: false, errors };
  return {
    ok: true,
    value: {
      storefront: {
        accessMode,
        scope: { type: scopeType, ids: scopeType === "collections" || scopeType === "products" ? ids : [], tags: scopeType === "tags" ? tags : [] },
        showApplyBanner: sf.showApplyBanner === true,
        applyUrl,
        loginUrl,
        showPriceHint: sf.showPriceHint === true,
        colors: { button: buttonColor, text: textColor },
        customSelectors,
        hidePages,
        exemptCustomerTags,
      },
      texts,
    },
  };
}

/**
 * Apply text edits to the stored overrides: a non-empty text sets the
 * override, an empty one removes it (back to the built-in translation).
 * Returns full replacement maps for the touched languages only.
 */
export function mergeTextEdits(current: LocalizedTexts, edits: Record<string, Record<string, string>>): LocalizedTexts {
  const out: LocalizedTexts = {};
  for (const [loc, map] of Object.entries(edits)) {
    const next = { ...(current[loc] ?? {}) };
    for (const [key, value] of Object.entries(map)) {
      if (value) next[key] = value;
      else delete next[key];
    }
    out[loc] = next;
  }
  return out;
}

/** Activity detail for a save: ids and codes only, never texts. */
export function describeChange(before: Settings["storefront"], after: Settings["storefront"]) {
  return {
    accessMode: before.accessMode === after.accessMode ? undefined : { from: before.accessMode, to: after.accessMode },
    scope: after.scope.type,
  };
}
