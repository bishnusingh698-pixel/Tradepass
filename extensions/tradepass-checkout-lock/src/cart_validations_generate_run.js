// Wholesale-only checkout lock. Pure function of the input JSON (no imports),
// so the same file is compiled by Shopify CLI and unit-tested by Vitest
// (tests/automation-checkout-lock.test.ts).
//
// Rules:
// - B2B buyers (cart.buyerIdentity.purchasingCompany set) always pass.
// - Customers with one of the merchant's exempt tags pass (staff draft
//   orders for retail customers, sales reps, testing).
// - Carts that contain only gift cards pass.
// - Cart interactions (add to cart) pass; the error is raised at checkout so
//   storefront cart forms never break. Any other step, including an unknown
//   one, is treated as checkout: a wholesale-only store must never silently
//   open to the public.
// - Config disabled → pass (the Validation itself is also disabled by the app).

/** Built-in English text, used only if the config metafield is missing or has no usable message. */
export const FALLBACK_MESSAGE =
  "This store sells to approved wholesale customers only. Log in or apply for an account.";

/**
 * @typedef {{ enabled?: boolean, messages?: Record<string, string>, defaultLocale?: string }} LockConfig
 */

/**
 * Shopify LanguageCode enum (e.g. "EN", "PT_BR", "ZH_TW") → our locale tag ("en", "pt-BR", "zh-TW").
 * @param {string | null | undefined} isoCode
 */
export function localeFromLanguageCode(isoCode) {
  if (!isoCode) return null;
  const [lang, region] = String(isoCode).split(/[_-]/);
  return region ? `${lang.toLowerCase()}-${region.toUpperCase()}` : lang.toLowerCase();
}

/**
 * Pick the message for the buyer's language: exact tag → base language →
 * store default language → English → built-in English.
 * @param {LockConfig | null | undefined} config
 * @param {string | null} locale
 */
export function pickMessage(config, locale) {
  const messages = (config && config.messages) || {};
  const candidates = [];
  if (locale) {
    candidates.push(locale);
    const base = locale.split("-")[0];
    if (base !== locale) candidates.push(base);
    // "pt" alone → try any regional variant the store has (pt-BR / pt-PT).
    for (const key of Object.keys(messages)) if (key.split("-")[0] === base) candidates.push(key);
  }
  if (config && config.defaultLocale) candidates.push(config.defaultLocale);
  candidates.push("en");
  for (const c of candidates) {
    const m = messages[c];
    if (typeof m === "string" && m.trim()) return m;
  }
  return FALLBACK_MESSAGE;
}

/** @param {any} input */
function onlyGiftCards(input) {
  const lines = (input.cart && input.cart.lines) || [];
  if (!lines.length) return false;
  return lines.every(
    /** @param {any} l */ (l) =>
      l.merchandise && l.merchandise.__typename === "ProductVariant" && l.merchandise.product && l.merchandise.product.isGiftCard === true,
  );
}

/**
 * Decide whether to block. Returns the reason the cart may pass, or null to block.
 * @param {any} input
 * @returns {"disabled" | "company" | "exempt" | "gift_card" | "cart_step" | null}
 */
export function allowReason(input) {
  const config = input.validation && input.validation.config ? input.validation.config.jsonValue : null;
  if (config && config.enabled === false) return "disabled";
  const identity = (input.cart && input.cart.buyerIdentity) || null;
  if (identity && identity.purchasingCompany) return "company";
  if (identity && identity.customer && identity.customer.exempt === true) return "exempt";
  if (onlyGiftCards(input)) return "gift_card";
  if (input.buyerJourney && input.buyerJourney.step === "CART_INTERACTION") return "cart_step";
  return null;
}

/**
 * Function entry point (export "cart-validations-generate-run").
 * @param {any} input
 */
export function cartValidationsGenerateRun(input) {
  const errors = [];
  if (allowReason(input) === null) {
    const config = input.validation && input.validation.config ? input.validation.config.jsonValue : null;
    const locale = localeFromLanguageCode(input.localization && input.localization.language && input.localization.language.isoCode);
    errors.push({ message: pickMessage(config, locale), target: "$.cart" });
  }
  return { operations: [{ validationAdd: { errors } }] };
}
