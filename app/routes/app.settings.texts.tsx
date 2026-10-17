import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { adminContext } from "../lib/context.server";
import { setTexts } from "../lib/settings.server";
import { messagesFor } from "../lib/i18n/server";
import { context as notes } from "../lib/i18n/catalog";
import { LOCALES, matchLocale, type Locale } from "../lib/i18n/locales";
import { IntlMessageFormat } from "intl-messageformat";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";

// Merchant text overrides per language (Settings → Languages): emails and the
// hosted pages (needs-info update, certificate renewal). Storefront messages are
// edited on the Storefront page, under the theme's own keys.
const AREAS = { email: ["email."], pages: ["hosted.", "renew."] } as const;
type Area = keyof typeof AREAS;

const MAX_OVERRIDE = 2000;

function parseArea(v: string | null): Area {
  return v === "pages" ? "pages" : "email";
}
const inArea = (area: Area, key: string) => AREAS[area].some((p) => key.startsWith(p));

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const url = new URL(request.url);
  const lang: Locale = matchLocale(url.searchParams.get("lang")) ?? matchLocale(ctx.shopRow?.primaryLocale) ?? "en";
  const area = parseArea(url.searchParams.get("area"));
  const defaults = messagesFor(lang);
  const current = ctx.settings.texts[lang] ?? {};
  const rows = Object.keys(defaults)
    .filter((k) => inArea(area, k))
    .sort()
    .map((key) => ({ key, text: defaults[key], override: current[key] ?? "", note: notes[key]?.note ?? "", placeholders: notes[key]?.placeholders ?? [] }));
  return { lang, area, rows, customized: Object.keys(current).length };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const lang = matchLocale(String(form.get("lang")));
  if (!lang) return { ok: false as const, errors: {} as Record<string, string>, savedAt: 0 };
  const intent = String(form.get("intent"));
  const next: Record<string, string> = { ...(ctx.settings.texts[lang] ?? {}) };

  if (intent === "reset_all") {
    const texts = { ...ctx.settings.texts };
    delete texts[lang];
    await setTexts(ctx.shop, texts);
  } else {
    const area = parseArea(String(form.get("area")));
    const errors: Record<string, string> = {};
    const defaults = messagesFor(lang);
    for (const [k, v] of form.entries()) {
      if (!k.startsWith("t:")) continue;
      const key = k.slice(2);
      if (!inArea(area, key) || !(key in defaults)) continue;
      const text = String(v).trim();
      if (!text) {
        delete next[key];
        continue;
      }
      if (text.length > MAX_OVERRIDE) errors[key] = "settings.texts.tooLong";
      else if (!validMessage(text, notes[key]?.placeholders ?? [], lang)) errors[key] = "settings.texts.invalid";
      else next[key] = text;
    }
    if (Object.keys(errors).length) return { ok: false as const, errors, savedAt: 0 };
    await setTexts(ctx.shop, { ...ctx.settings.texts, [lang]: next });
  }
  return { ok: true as const, errors: {} as Record<string, string>, savedAt: Date.now() };
};

/** The override must parse as ICU and may only use the placeholders the default text uses. */
function validMessage(text: string, placeholders: string[], locale: string): boolean {
  try {
    const sample = Object.fromEntries(placeholders.map((p) => [p, p === "count" ? 2 : "x"]));
    new IntlMessageFormat(text, locale).format(sample);
    const used = [...text.matchAll(/\{(\w+)(?=[,}])/g)].map((m) => m[1]);
    return used.every((u) => placeholders.includes(u));
  } catch {
    return false;
  }
}

export default function TextOverrides() {
  const d = useLoaderData<typeof loader>();
  const { t } = useI18n();
  const href = useLocaleHref();
  const shopify = useAppBridge();
  const [, setParams] = useSearchParams();
  const fetcher = useFetcher<typeof action>();
  const errors = fetcher.data?.errors ?? {};
  const version = fetcher.data?.ok ? fetcher.data.savedAt : 0;

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show(t("common.saved"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const langName = (code: string) => {
    try {
      return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  const setParam = (k: string, v: string) =>
    setParams((p) => {
      p.set(k, v);
      return p;
    });

  return (
    <s-page heading={t("settings.texts.title")}>
      <s-link slot="breadcrumb-actions" href={href("/app/settings")}>{t("nav.settings")}</s-link>
      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("settings.texts.body")}</s-paragraph>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
            <s-select label={t("settings.texts.language")} value={d.lang} onChange={(e) => setParam("lang", (e.currentTarget as unknown as HTMLSelectElement).value)}>
              {LOCALES.map((l) => (
                <s-option key={l} value={l}>{langName(l)}</s-option>
              ))}
            </s-select>
            <s-select label={t("settings.texts.area")} value={d.area} onChange={(e) => setParam("area", (e.currentTarget as unknown as HTMLSelectElement).value)}>
              <s-option value="email">{t("settings.texts.area.email")}</s-option>
              <s-option value="pages">{t("settings.texts.area.pages")}</s-option>
            </s-select>
          </s-grid>
          {d.customized > 0 && (
            <s-button variant="tertiary" tone="critical" commandFor="reset-texts-modal" command="--show">
              {t("settings.texts.resetAll", { count: d.customized })}
            </s-button>
          )}
        </s-stack>
      </s-section>

      <form
        key={`${d.lang}-${d.area}-${version}`}
        data-save-bar
        data-discard-confirmation
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          fd.set("intent", "save");
          fd.set("lang", d.lang);
          fd.set("area", d.area);
          fetcher.submit(fd, { method: "POST" });
        }}
      >
        <s-section>
          <s-stack direction="block" gap="base">
            {d.rows.map((r) => (
              <s-text-area
                key={r.key}
                name={`t:${r.key}`}
                label={r.note || r.key}
                placeholder={r.text}
                defaultValue={r.override}
                details={r.placeholders.length ? t("settings.texts.placeholders", { list: r.placeholders.map((p) => `{${p}}`).join(" ") }) : undefined}
                error={errors[r.key] ? t(errors[r.key]) : undefined}
                rows={2}
              />
            ))}
          </s-stack>
        </s-section>
      </form>

      <s-modal id="reset-texts-modal" heading={t("settings.texts.resetHeading", { language: langName(d.lang) })}>
        <s-paragraph>{t("settings.texts.resetBody", { count: d.customized })}</s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          commandFor="reset-texts-modal"
          command="--hide"
          onClick={() => fetcher.submit({ intent: "reset_all", lang: d.lang }, { method: "POST" })}
        >
          {t("settings.texts.resetConfirm")}
        </s-button>
        <s-button slot="secondary-actions" commandFor="reset-texts-modal" command="--hide">{t("common.cancel")}</s-button>
      </s-modal>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
