import { useI18n } from "../lib/i18n/react";
import type { MessageKey } from "../lib/i18n";
import { useLocaleHref } from "./useLocaleHref";

export type Section =
  | "applications" | "buyers" | "tiers" | "form" | "storefront" | "certificates"
  | "notifications" | "automation" | "import" | "settings" | "help";

/** P1 placeholder: every nav page exists with a proper empty state (short explanation + one action). */
export function EmptyPage({ section, actionHref }: { section: Section; actionHref: string }) {
  const { t } = useI18n();
  const href = useLocaleHref();
  const k = (s: string) => `${section}.${s}` as MessageKey;
  return (
    <s-page heading={t(k("title"))}>
      <s-section>
        <s-stack direction="block" gap="base" alignItems="center">
          <s-heading>{t(k("empty.heading"))}</s-heading>
          <s-paragraph>{t(k("empty.body"))}</s-paragraph>
          <s-paragraph tone="neutral">{t("common.comingSoon")}</s-paragraph>
          <s-button variant="primary" href={href(actionHref)}>
            {t(k("empty.action"))}
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}
