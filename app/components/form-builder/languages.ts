import { LOCALES, isRtl } from "../../lib/i18n/locales";

export type LanguageOption = { value: string; label: string; published: boolean; dir: "ltr" | "rtl" };

function displayName(code: string, inLocale: string): string {
  try {
    return new Intl.DisplayNames([inLocale], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Store languages first (primary, then published, then unpublished), followed
 * by every built-in language, so merchants can prepare texts before publishing
 * a language. Names are shown in the admin's language.
 */
export function languageOptions(
  shopLocales: { locale: string; primary: boolean; published: boolean }[],
  adminLocale: string,
  primaryLabel: (name: string) => string,
  publishedLabel: (name: string) => string,
): LanguageOption[] {
  const out: LanguageOption[] = [];
  const seen = new Set<string>();
  for (const l of shopLocales) {
    if (seen.has(l.locale.toLowerCase())) continue;
    seen.add(l.locale.toLowerCase());
    const name = displayName(l.locale, adminLocale);
    out.push({
      value: l.locale,
      label: l.primary ? primaryLabel(name) : l.published ? publishedLabel(name) : name,
      published: l.published,
      dir: isRtl(l.locale) ? "rtl" : "ltr",
    });
  }
  for (const code of LOCALES) {
    if (seen.has(code.toLowerCase())) continue;
    out.push({ value: code, label: displayName(code, adminLocale), published: false, dir: isRtl(code) ? "rtl" : "ltr" });
  }
  return out;
}

/** The store's primary language, or English when the store's languages couldn't be read. */
export function primaryLocale(shopLocales: { locale: string; primary: boolean }[]): string {
  return shopLocales.find((l) => l.primary)?.locale ?? "en";
}
