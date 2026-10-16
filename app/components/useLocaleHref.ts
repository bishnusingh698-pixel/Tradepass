import { useI18n } from "../lib/i18n/react";

/** Keep the admin language on in-app links (Shopify only sends `locale` on the first load). */
export function useLocaleHref() {
  const { locale } = useI18n();
  return (path: string) => {
    if (!path.startsWith("/")) return path;
    const [base, query = ""] = path.split("?");
    const params = new URLSearchParams(query);
    params.set("locale", locale);
    return `${base}?${params}`;
  };
}
