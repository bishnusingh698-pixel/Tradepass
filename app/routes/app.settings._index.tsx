import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { adminContext } from "../lib/context.server";
import { gql } from "../lib/gql.server";
import { updateSettings } from "../lib/settings.server";
import { resetShopData } from "../lib/privacy.server";
import { ACTIVITY_EXPORT_MAX_ROWS, exportActivityCsv, logActivity } from "../lib/activity.server";
import { ensureDefaults } from "../lib/defaults.server";
import { syncStorefrontConfig } from "../lib/storefront-sync.server";
import { LOCALES, matchLocale } from "../lib/i18n/locales";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";
import { can } from "../lib/plans";

const RETENTION_MONTHS = [3, 6, 12, 24, 36] as const;
const HEX = /^#[0-9a-f]{6}$/i;
const ASSIGNMENT_MODES = ["auto", "assisted"] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const data = await gql<{ shopLocales: { locale: string; primary: boolean; published: boolean }[] }>(
    ctx.admin,
    `#graphql
      query TradepassShopLocales { shopLocales { locale primary published } }`,
  );
  const languages = data.shopLocales
    .filter((l) => l.published)
    .map((l) => ({ locale: l.locale, primary: l.primary, supported: Boolean(matchLocale(l.locale)) }));
  const overrides = Object.fromEntries(Object.entries(ctx.settings.texts).map(([l, m]) => [l, Object.keys(m ?? {}).length]));
  return {
    languages,
    overrides,
    supportedCount: LOCALES.length,
    retention: ctx.settings.retention,
    branding: ctx.settings.branding,
    assignment: ctx.settings.tiers.assignment,
    canExportActivity: can(ctx.plan, "activity_export"),
    exportMax: ACTIVITY_EXPORT_MAX_ROWS,
    plan: ctx.plan,
    isDevStore: Boolean(ctx.shopRow?.isDevStore),
    shopName: ctx.shopRow?.name ?? ctx.shop.replace(".myshopify.com", ""),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "save") {
    const errors: Record<string, string> = {};
    const months = Number(form.get("months"));
    const logoUrl = String(form.get("logoUrl") ?? "").trim();
    const accent = String(form.get("accentColor") ?? "").trim();
    if (!(RETENTION_MONTHS as readonly number[]).includes(months)) errors.months = "settings.error.months";
    if (logoUrl && !/^https:\/\/\S+$/i.test(logoUrl)) errors.logoUrl = "settings.error.logoUrl";
    if (accent && !HEX.test(accent)) errors.accentColor = "settings.error.accentColor";
    const assignmentRaw = form.get("assignment");
    const assignment = assignmentRaw == null || assignmentRaw === "" ? ctx.settings.tiers.assignment : String(assignmentRaw);
    if (!(ASSIGNMENT_MODES as readonly string[]).includes(assignment)) errors.assignment = "settings.error.assignment";
    if (Object.keys(errors).length) return { ok: false as const, intent, errors };
    await updateSettings(ctx.shop, {
      retention: { months, deleteFiles: form.get("deleteFiles") === "on" },
      branding: { logoUrl: logoUrl || null, accentColor: accent || null },
      tiers: { assignment: assignment as (typeof ASSIGNMENT_MODES)[number] },
    });
    if (assignment !== ctx.settings.tiers.assignment) {
      await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "settings.tier_assignment", subject: null, detail: { to: assignment } });
    }
    return { ok: true as const, intent, savedAt: Date.now() };
  }

  if (intent === "export_activity") {
    // Pro: locked on lower plans, also on the server.
    if (!can(ctx.plan, "activity_export")) return { ok: false as const, intent, errors: { export: "settings.activity.locked" } };
    const out = await exportActivityCsv(ctx.shop);
    await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "activity.export", subject: null, detail: { rows: out.rows } });
    return { ok: true as const, intent, csv: out.csv, truncated: out.truncated };
  }

  if (intent === "delete_all") {
    // Must match exactly what the merchant typed in the confirmation box.
    const typed = String(form.get("confirm") ?? "").trim();
    const name = ctx.shopRow?.name ?? ctx.shop.replace(".myshopify.com", "");
    if (typed !== name && typed !== ctx.shop) return { ok: false as const, intent, errors: { confirm: "settings.danger.mismatch" } };
    await resetShopData(ctx.shop);
    await ensureDefaults(ctx.shop);
    // Push the default (open) storefront config so nothing stays gated by old settings.
    await syncStorefrontConfig(ctx.admin, ctx.shop).catch(() => undefined);
    await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "settings.delete_all", subject: null });
    return { ok: true as const, intent };
  }
  return { ok: false as const, intent: "unknown", errors: {} };
};

export default function SettingsPage() {
  const d = useLoaderData<typeof loader>();
  const { t } = useI18n();
  const href = useLocaleHref();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const errors = (fetcher.data && !fetcher.data.ok ? fetcher.data.errors : {}) as Record<string, string>;
  // Re-mount the form after a save so its new values become the save bar's baseline.
  const savedAt = fetcher.data?.ok && fetcher.data.intent === "save" ? (fetcher.data.savedAt ?? 0) : 0;

  useEffect(() => {
    const r = fetcher.data;
    if (r?.ok && r.intent === "save") {
      shopify.toast.show(t("common.saved"));
    }
    if (r?.ok && r.intent === "export_activity" && "csv" in r) {
      download(r.csv ?? "", "activity.csv");
      shopify.toast.show(r.truncated ? t("settings.activity.truncated", { max: d.exportMax }) : t("settings.activity.done"));
    }
    if (r?.ok && r.intent === "delete_all") {
      shopify.toast.show(t("settings.danger.done"));
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

  return (
    <s-page heading={t("settings.title")}>
      <s-section heading={t("settings.languages.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("settings.languages.body", { count: d.supportedCount })}</s-paragraph>
          <s-unordered-list>
            {d.languages.map((l) => (
              <s-list-item key={l.locale}>
                {langName(l.locale)}
                {l.primary ? ` · ${t("settings.languages.primary")}` : ""}
                {!l.supported ? ` · ${t("settings.languages.unsupported")}` : ""}
                {d.overrides[matchLocale(l.locale) ?? l.locale] ? ` · ${t("settings.languages.customized", { count: d.overrides[matchLocale(l.locale) ?? l.locale] })}` : ""}
              </s-list-item>
            ))}
          </s-unordered-list>
          <s-button href={href("/app/settings/texts")}>{t("settings.languages.editTexts")}</s-button>
        </s-stack>
      </s-section>

      <form
        key={savedAt}
        data-save-bar
        data-discard-confirmation
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          fd.set("intent", "save");
          fetcher.submit(fd, { method: "POST" });
        }}
      >
        <s-section heading={t("settings.retention.heading")}>
          <s-stack direction="block" gap="base">
            <s-select name="months" label={t("settings.retention.months")} value={String(d.retention.months)} error={errors.months ? t(errors.months) : undefined}>
              {RETENTION_MONTHS.map((m) => (
                <s-option key={m} value={String(m)}>{t("settings.retention.monthsOption", { count: m })}</s-option>
              ))}
            </s-select>
            <s-checkbox name="deleteFiles" label={t("settings.retention.deleteFiles")} details={t("settings.retention.deleteFilesHelp")} defaultChecked={d.retention.deleteFiles} />
            <s-paragraph color="subdued">{t("settings.retention.note")}</s-paragraph>
          </s-stack>
        </s-section>

        <s-section heading={t("settings.branding.heading")}>
          <s-stack direction="block" gap="base">
            <s-url-field
              name="logoUrl"
              label={t("settings.branding.logo")}
              details={t("settings.branding.logoHelp")}
              defaultValue={d.branding.logoUrl ?? ""}
              error={errors.logoUrl ? t(errors.logoUrl) : undefined}
            />
            <s-color-field
              name="accentColor"
              label={t("settings.branding.accent")}
              details={t("settings.branding.accentHelp")}
              defaultValue={d.branding.accentColor ?? ""}
              error={errors.accentColor ? t(errors.accentColor) : undefined}
            />
          </s-stack>
        </s-section>

        <s-section heading={t("settings.assignment.heading")}>
          <s-stack direction="block" gap="base">
            <s-choice-list name="assignment" label={t("settings.assignment.label")} error={errors.assignment ? t(errors.assignment) : undefined}>
              <s-choice value="auto" defaultSelected={d.assignment === "auto"}>
                {t("settings.assignment.auto")}
                <s-text slot="details">{t("settings.assignment.autoHelp")}</s-text>
              </s-choice>
              <s-choice value="assisted" defaultSelected={d.assignment === "assisted"}>
                {t("settings.assignment.assisted")}
                <s-text slot="details">{t("settings.assignment.assistedHelp")}</s-text>
              </s-choice>
            </s-choice-list>
            <s-paragraph color="subdued">{t("settings.assignment.note")}</s-paragraph>
          </s-stack>
        </s-section>
      </form>

      <s-section heading={t("settings.activity.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("settings.activity.body", { max: d.exportMax })}</s-paragraph>
          {!d.canExportActivity && <s-badge tone="info">{t("common.availableOn", { plan: "Pro" })}</s-badge>}
          {errors.export && <s-banner tone="critical"><s-paragraph>{t(errors.export)}</s-paragraph></s-banner>}
          <s-button
            disabled={!d.canExportActivity}
            loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "export_activity"}
            onClick={() => fetcher.submit({ intent: "export_activity" }, { method: "POST" })}
          >
            {t("settings.activity.button")}
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading={t("settings.plan.heading")}>
        <s-stack direction="block" gap="base">
          <s-text>{t("settings.plan.current", { plan: t(`plans.name.${d.plan}`) })}</s-text>
          {d.isDevStore && <s-paragraph color="subdued">{t("settings.plan.devStore")}</s-paragraph>}
          <s-button href={href("/app/plans")}>{t("settings.plan.manage")}</s-button>
        </s-stack>
      </s-section>

      <s-section heading={t("settings.danger.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("settings.danger.body")}</s-paragraph>
          <s-button tone="critical" commandFor="delete-all-modal" command="--show">{t("settings.danger.button")}</s-button>
        </s-stack>
      </s-section>

      <DeleteAllModal shopName={d.shopName} error={errors.confirm ? t(errors.confirm) : undefined} onConfirm={(confirm) => fetcher.submit({ intent: "delete_all", confirm }, { method: "POST" })} />
    </s-page>
  );
}

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DeleteAllModal({ shopName, error, onConfirm }: { shopName: string; error?: string; onConfirm: (typed: string) => void }) {
  const { t } = useI18n();
  const [typed, setTyped] = useState("");
  return (
    <s-modal id="delete-all-modal" heading={t("settings.danger.modalHeading")}>
      <s-stack direction="block" gap="base">
        <s-paragraph>{t("settings.danger.modalBody")}</s-paragraph>
        <s-paragraph>{t("settings.danger.modalKeeps")}</s-paragraph>
        <s-text-field
          label={t("settings.danger.typeName", { name: shopName })}
          value={typed}
          error={error}
          onInput={(e) => setTyped((e.currentTarget as unknown as HTMLInputElement).value)}
        />
      </s-stack>
      <s-button
        slot="primary-action"
        variant="primary"
        tone="critical"
        disabled={typed.trim() !== shopName}
        commandFor="delete-all-modal"
        command="--hide"
        onClick={() => onConfirm(typed.trim())}
      >
        {t("settings.danger.confirm")}
      </s-button>
      <s-button slot="secondary-actions" commandFor="delete-all-modal" command="--hide">{t("common.cancel")}</s-button>
    </s-modal>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
