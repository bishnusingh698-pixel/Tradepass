// The 36 languages the Shopify admin ships in (checked against Shopify's
// help centre language list; see API_NOTES.md). "uk" is deliberately absent:
// add it here only if Shopify adds Ukrainian to the admin.
export const LOCALES = [
  "ar", "bg", "cs", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi",
  "hr", "hu", "id", "it", "ja", "ko", "lt", "ms", "nb", "nl", "pl", "pt-BR",
  "pt-PT", "ro", "ru", "sk", "sl", "sv", "th", "tr", "ur", "vi", "zh-CN",
  "zh-TW",
] as const;

export type Locale = (typeof LOCALES)[number];

export const SOURCE_LOCALE: Locale = "en";

export const RTL_LOCALES: ReadonlySet<string> = new Set(["ar", "he", "ur"]);

export function isRtl(locale: string): boolean {
  return RTL_LOCALES.has(locale.split("-")[0]);
}

const byLower = new Map(LOCALES.map((l) => [l.toLowerCase(), l]));

/**
 * Map any incoming locale tag (Shopify admin `locale` param, storefront
 * `request.locale.iso_code`, Accept-Language entry) to a built-in locale.
 * Returns null when nothing matches, so callers can fall back explicitly.
 */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const t = tag.trim().replace("_", "-").toLowerCase();
  const exact = byLower.get(t);
  if (exact) return exact;
  const base = t.split("-")[0];
  if (base === "pt") return t === "pt-pt" ? "pt-PT" : "pt-BR";
  if (base === "zh") {
    return /(tw|hk|mo|hant)/.test(t) ? "zh-TW" : "zh-CN";
  }
  if (base === "no" || base === "nn") return "nb";
  return byLower.get(base) ?? null;
}
