import { useLocation } from "react-router";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "./useLocaleHref";

// Pages that belong to one navigation section share a row of tabs, so the
// left-hand nav stays short (9 items) while every page keeps its own URL.
export const SECTIONS = {
  buyers: [
    ["/app/buyers", "nav.buyers"],
    ["/app/certificates", "nav.certificates"],
    ["/app/import", "nav.import"],
  ],
} as const;

export function SectionTabs({ section }: { section: keyof typeof SECTIONS }) {
  const { t } = useI18n();
  const href = useLocaleHref();
  const { pathname } = useLocation();
  const tabs = SECTIONS[section];
  // Longest matching prefix wins (/app/import/123 belongs to Import).
  const active = [...tabs].sort((a, b) => b[0].length - a[0].length).find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[0];
  return (
    <s-stack direction="inline" gap="small-200">
      {tabs.map(([path, key]) => (
        <s-button key={path} href={href(path)} variant={path === active ? "primary" : "secondary"} accessibilityLabel={t(key)}>
          {t(key)}
        </s-button>
      ))}
    </s-stack>
  );
}
