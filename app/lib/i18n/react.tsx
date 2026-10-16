import { createContext, useContext, useMemo, type ReactNode } from "react";
import { IntlMessageFormat } from "intl-messageformat";
import type { MessageKey, Values } from "./index";

// Client side gets only the active locale's messages (sent by the app loader),
// so the admin bundle doesn't carry all 36 catalogs.
type Ctx = { locale: string; dir: "ltr" | "rtl"; messages: Record<string, string> };

const I18nContext = createContext<Ctx>({ locale: "en", dir: "ltr", messages: {} });

export function I18nProvider({ value, children }: { value: Ctx; children: ReactNode }) {
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const { locale, dir, messages } = useContext(I18nContext);
  return useMemo(() => {
    const cache = new Map<string, IntlMessageFormat>();
    const t = (key: MessageKey, values?: Values) => {
      const pattern = messages[key] ?? key;
      let f = cache.get(pattern);
      if (!f) cache.set(pattern, (f = new IntlMessageFormat(pattern, locale)));
      return String(f.format(values));
    };
    const i18n = {
      number: (n: number, o?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, o).format(n),
      money: (n: number, currency: string) => new Intl.NumberFormat(locale, { style: "currency", currency }).format(n),
      date: (d: Date | string, o: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) => new Intl.DateTimeFormat(locale, o).format(new Date(d)),
    };
    return { t, locale, dir, i18n };
  }, [locale, dir, messages]);
}
