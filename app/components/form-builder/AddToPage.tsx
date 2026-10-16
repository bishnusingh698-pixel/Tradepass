import { useI18n } from "../../lib/i18n/react";
import { blockEditorUrl, embedEditorUrl, useThemeExtension } from "../storefront/extension";

/** "Add the form to a page" in three steps, with deep links into the merchant's admin and theme editor. */
export function AddToPage({ shop, apiKey }: { shop: string; apiKey: string }) {
  const { t } = useI18n();
  const ext = useThemeExtension();
  return (
    <s-section heading={t("form.place.heading")}>
      <s-stack direction="block" gap="base">
        <s-ordered-list>
          <s-list-item>
            <s-stack direction="block" gap="small-200">
              <s-text>{t("form.place.step1")}</s-text>
              <s-link href={`https://${shop}/admin/pages/new`} target="_blank">{t("form.place.step1Action")}</s-link>
            </s-stack>
          </s-list-item>
          <s-list-item>
            <s-stack direction="block" gap="small-200">
              <s-text>{t("form.place.step2")}</s-text>
              <s-link href={blockEditorUrl(shop, apiKey, ext.formBlockHandle, "page")} target="_blank">{t("form.place.step2Action")}</s-link>
            </s-stack>
          </s-list-item>
          <s-list-item>
            <s-stack direction="block" gap="small-200">
              <s-text>{t("form.place.step3")}</s-text>
              <s-link href={embedEditorUrl(shop, apiKey, ext.embedHandle)} target="_blank">{t("form.place.step3Action")}</s-link>
            </s-stack>
          </s-list-item>
        </s-ordered-list>
        {ext.status === "active" && <s-badge tone="success" icon="check">{t("form.place.embedOn")}</s-badge>}
      </s-stack>
    </s-section>
  );
}
