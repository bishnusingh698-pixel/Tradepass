import { catalogs } from "./catalog";
import { isRtl, matchLocale, SOURCE_LOCALE, type Locale } from "./locales";

/**
 * Pick the admin language: Shopify's `locale` URL param (sent on embedded
 * loads and kept on our nav links), then the browser's Accept-Language,
 * then the store's primary language, then English.
 */
export function adminLocale(request: Request, shopPrimary?: string | null): Locale {
  const url = new URL(request.url);
  const fromParam = matchLocale(url.searchParams.get("locale"));
  if (fromParam) return fromParam;
  const accept = request.headers.get("accept-language") ?? "";
  for (const part of accept.split(",")) {
    const m = matchLocale(part.split(";")[0]);
    if (m) return m;
  }
  return matchLocale(shopPrimary) ?? SOURCE_LOCALE;
}

/** Messages for one locale with English filled in for any missing key. */
export function messagesFor(locale: Locale): Record<string, string> {
  return { ...(catalogs[SOURCE_LOCALE] as Record<string, string>), ...(catalogs[locale] as Record<string, string>) };
}

export function i18nPayload(locale: Locale) {
  return { locale, dir: isRtl(locale) ? ("rtl" as const) : ("ltr" as const), messages: messagesFor(locale) };
}
