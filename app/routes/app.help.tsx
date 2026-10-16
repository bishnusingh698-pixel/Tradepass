import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { adminContext } from "../lib/context.server";
import { refreshShopFacts } from "../lib/shop.server";
import { updateSettings } from "../lib/settings.server";
import { syncStorefrontConfig } from "../lib/storefront-sync.server";
import { logActivity } from "../lib/activity.server";
import { can } from "../lib/plans";
import { EMBED_HANDLE, FORM_BLOCK_HANDLE, THEME_EXTENSION_HANDLE } from "../lib/theme";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";
import pkg from "../../package.json";

const DEBUG_HOURS = 24;

const FAQ = [
  "plus", "threeTiers", "signIn", "documents", "hidePrices", "theme", "uninstall", "pos", "taxExemptions",
  "vatFails", "import", "languages", "emails", "approvalLimit", "markets", "privacy", "slowFirstLoad",
] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const facts = await refreshShopFacts(ctx.shop, ctx.admin);
  const until = ctx.settings.debug.storefrontUntil;
  return {
    supportEmail: process.env.SUPPORT_EMAIL ?? "",
    priority: can(ctx.plan, "priority_support"),
    debugUntil: until && new Date(until) > new Date() ? until : null,
    isDevStore: Boolean(ctx.shopRow?.isDevStore),
    diagnostics: {
      shop: ctx.shop,
      shopifyPlan: facts.planName,
      tradepassPlan: ctx.plan,
      b2b: facts.b2bEnabled,
      b2bMarkets: facts.b2bMarketsEnabled,
      catalogs: `${facts.catalogsUsed ?? 0}/${facts.isPlus ? "∞" : facts.catalogLimit ?? 0}`,
      plus: facts.isPlus,
      appVersion: pkg.version,
      languages: facts.publishedLocales.join(", "),
      tierAssignment: ctx.settings.tiers.assignment,
      accessMode: ctx.settings.storefront.accessMode,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "debug") {
    const on = form.get("on") === "1";
    const until = on ? new Date(Date.now() + DEBUG_HOURS * 3_600_000).toISOString() : null;
    await updateSettings(ctx.shop, { debug: { storefrontUntil: until } });
    await syncStorefrontConfig(ctx.admin, ctx.shop);
    await logActivity({ shop: ctx.shop, actor: ctx.actor, action: on ? "help.debug_on" : "help.debug_off", subject: null });
    return { ok: true };
  }
  if (intent === "welcome") {
    await updateSettings(ctx.shop, { welcome: { done: false } });
    const url = new URL(request.url);
    return redirect(`/app${url.search}`);
  }
  return { ok: false };
};

export default function Help() {
  const d = useLoaderData<typeof loader>();
  const { t, i18n } = useI18n();
  const href = useLocaleHref();
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const [theme, setTheme] = useState<{ embed: string; block: string; themeId: string }>({ embed: "?", block: "?", themeId: "?" });

  useEffect(() => {
    const app = (shopify as unknown as { app?: { extensions?: () => Promise<{ handle: string; activations?: { handle: string; status: string; activations?: { themeId?: string }[] }[] }[]> } }).app;
    app
      ?.extensions?.()
      .then((exts) => {
        const acts = exts.find((e) => e.handle === THEME_EXTENSION_HANDLE)?.activations ?? [];
        const find = (h: string) => acts.find((a) => a.handle === h);
        setTheme({
          embed: find(EMBED_HANDLE)?.status ?? "missing",
          block: find(FORM_BLOCK_HANDLE)?.status ?? "missing",
          themeId: find(EMBED_HANDLE)?.activations?.[0]?.themeId ?? "?",
        });
      })
      .catch(() => undefined);
  }, [shopify]);

  const diagText = () =>
    [
      ...Object.entries(d.diagnostics).map(([k, v]) => `${k}: ${v}`),
      `embed: ${theme.embed}`,
      `formBlock: ${theme.block}`,
      `themeId: ${theme.themeId}`,
      `browser: ${typeof navigator !== "undefined" ? navigator.userAgent : ""}`,
      `generated: ${new Date().toISOString()}`,
    ].join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(diagText());
      shopify.toast.show(t("help.diagnostics.copied"));
    } catch {
      shopify.toast.show(t("help.diagnostics.copyFailed"), { isError: true });
    }
  };

  return (
    <s-page heading={t("help.title")}>
      <s-section heading={t("help.setup.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("help.setup.intro")}</s-paragraph>
          <s-ordered-list>
            {["tier", "form", "embed", "page", "storefront", "test"].map((s) => (
              <s-list-item key={s}>
                <s-text type="strong">{t(`help.setup.${s}.title`)}</s-text> {t(`help.setup.${s}.body`)}
              </s-list-item>
            ))}
          </s-ordered-list>
          <s-button variant="tertiary" onClick={() => fetcher.submit({ intent: "welcome" }, { method: "POST" })}>
            {t("help.setup.reopenWelcome")}
          </s-button>
        </s-stack>
      </s-section>

      <div id="add-form">
        <s-section heading={t("help.addForm.heading")}>
          <s-stack direction="block" gap="base">
            <s-ordered-list>
              <s-list-item>{t("help.addForm.step1")}</s-list-item>
              <s-list-item>{t("help.addForm.step2")}</s-list-item>
              <s-list-item>{t("help.addForm.step3")}</s-list-item>
            </s-ordered-list>
            {/* Screenshot placeholder: replaced with real screenshots before App Store submission (see LISTING_DRAFT.md). */}
            <s-box padding="large" background="subdued" borderRadius="base">
              <s-text color="subdued">{t("help.screenshotPlaceholder")}</s-text>
            </s-box>
          </s-stack>
        </s-section>
      </div>

      <s-section heading={t("help.b2b.heading")}>
        <s-stack direction="block" gap="base">
          {["markets", "catalogs", "plus", "signIn"].map((k) => (
            <s-paragraph key={k}>{t(`help.b2b.${k}`)}</s-paragraph>
          ))}
        </s-stack>
      </s-section>

      <s-section heading={t("help.faq.heading")}>
        <s-stack direction="block" gap="small-200">
          {FAQ.map((q) => (
            <details key={q}>
              <summary>
                <s-text type="strong">{t(`help.faq.${q}.q`)}</s-text>
              </summary>
              <s-box paddingBlock="small-200">
                <s-paragraph>{t(`help.faq.${q}.a`)}</s-paragraph>
              </s-box>
            </details>
          ))}
        </s-stack>
      </s-section>

      <s-section heading={t("help.diagnostics.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("help.diagnostics.body")}</s-paragraph>
          <s-box padding="base" background="subdued" borderRadius="base">
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12 }}>{diagText()}</pre>
          </s-box>
          <s-button onClick={copy}>{t("help.diagnostics.copy")}</s-button>
        </s-stack>
      </s-section>

      <s-section heading={t("help.debug.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("help.debug.body", { hours: DEBUG_HOURS })}</s-paragraph>
          {d.debugUntil ? (
            <>
              <s-text>{t("help.debug.onUntil", { time: i18n.date(d.debugUntil, { dateStyle: "medium", timeStyle: "short" }) })}</s-text>
              <s-button onClick={() => fetcher.submit({ intent: "debug", on: "0" }, { method: "POST" })}>{t("help.debug.turnOff")}</s-button>
            </>
          ) : (
            <s-button onClick={() => fetcher.submit({ intent: "debug", on: "1" }, { method: "POST" })}>{t("help.debug.turnOn")}</s-button>
          )}
        </s-stack>
      </s-section>

      <s-section heading={t("help.contact.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{d.priority ? t("help.contact.priority") : t("help.contact.body")}</s-paragraph>
          {d.supportEmail ? (
            <s-link href={`mailto:${d.supportEmail}?subject=${encodeURIComponent(`Tradepass support: ${d.diagnostics.shop}`)}`}>
              {t("help.contact", { email: d.supportEmail })}
            </s-link>
          ) : null}
          <s-link href={href("/app/diagnostics")}>{t("spike.title")}</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
