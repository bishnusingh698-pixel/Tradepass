import { IntlMessageFormat } from "intl-messageformat";
import { LOCALES, SOURCE_LOCALE, isRtl, matchLocale, type Locale } from "./locales";
import type { Messages } from "./catalog";
import { catalogs } from "./catalog";

export { LOCALES, isRtl, matchLocale, type Locale };

export type MessageKey = string;
export type Values = Record<string, string | number | Date>;

/** Merchant text overrides: { locale: { key: text } }. Override beats built-in. */
export type Overrides = Partial<Record<string, Partial<Record<string, string>>>>;

const cache = new Map<string, IntlMessageFormat>();

function format(locale: string, pattern: string, values?: Values): string {
  const id = `${locale}\u0000${pattern}`;
  let fmt = cache.get(id);
  if (!fmt) {
    fmt = new IntlMessageFormat(pattern, locale);
    cache.set(id, fmt);
  }
  return String(fmt.format(values));
}

/**
 * Build a translator for one locale. Fallback order: merchant override for
 * the locale → built-in locale → merchant override for the store's primary
 * language → English. Unknown store languages (no built-in catalog) use the
 * store's primary language unless the merchant overrode the string.
 */
export function createT(
  requested: string | null | undefined,
  opts: { primary?: string; overrides?: Overrides } = {},
) {
  const locale: Locale = matchLocale(requested) ?? matchLocale(opts.primary) ?? SOURCE_LOCALE;
  const rawTag = requested ?? locale;
  const own = catalogs[locale] ?? {};
  const fallback = catalogs[SOURCE_LOCALE];
  const ov = opts.overrides ?? {};

  function t(key: MessageKey, values?: Values): string {
    const pattern =
      ov[rawTag]?.[key] ??
      ov[locale]?.[key] ??
      (own as Record<string, string>)[key] ??
      (opts.primary ? ov[opts.primary]?.[key] : undefined) ??
      (fallback as Record<string, string>)[key] ??
      key;
    return format(locale, pattern, values);
  }

  return {
    t,
    locale,
    dir: isRtl(locale) ? ("rtl" as const) : ("ltr" as const),
    date: (d: Date, o: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) =>
      new Intl.DateTimeFormat(locale, o).format(d),
    number: (n: number, o?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(locale, o).format(n),
    money: (n: number, currency: string) =>
      new Intl.NumberFormat(locale, { style: "currency", currency }).format(n),
    relative: (value: number, unit: Intl.RelativeTimeFormatUnit) =>
      new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(value, unit),
  };
}

export type Translator = ReturnType<typeof createT>;

export const supportedLocales = LOCALES;
