import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { APP_URL } from "./config.js";
import { blockView } from "./view.js";

export default async () => {
  render(<ProfileBlock />, document.body);
};

function ProfileBlock() {
  const [view, setView] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const token = await shopify.sessionToken.get();
        const res = await fetch(`${APP_URL}/account/status`, { headers: { Authorization: `Bearer ${token}` } });
        const data = res.ok ? await res.json() : null;
        setView(blockView(data && data.application));
      } catch {
        setView(null);
      }
    })();
  }, []);
  if (!view) return null;
  const t = (key, vars = {}) => shopify.i18n.translate(key, vars);
  const date = (iso) => shopify.i18n.formatDate(new Date(`${iso}T00:00:00Z`), { dateStyle: "long" });
  return (
    <s-section heading={t("title")}>
      <s-stack direction="block" gap="base">
        <s-badge tone={view.tone}>{t(view.titleKey)}</s-badge>
        {view.submitted && <s-text>{t("submitted", { date: date(view.submitted) })}</s-text>}
        {view.reapplyFrom && <s-text>{t("reapply", { date: date(view.reapplyFrom) })}</s-text>}
        {view.url && <s-link href={view.url} target="_blank">{t("view")}</s-link>}
      </s-stack>
    </s-section>
  );
}
