import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { adminContext } from "../lib/context.server";
import { refreshShopFacts } from "../lib/shop.server";
import { updateSettings } from "../lib/settings.server";
import { applyWelcome, checklist, pendingWork, serverAlerts, type AlertId, type ChecklistStep, type Numbers } from "../lib/home.server";
import { BUSINESS_TYPES, SUGGESTED_TIER_NAMES } from "../lib/form-defaults";
import { EMBED_HANDLE, FORM_BLOCK_HANDLE, THEME_EXTENSION_HANDLE } from "../lib/theme";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";
import { RelativeTime } from "../components/applications";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  // Spec: detect plan and B2B entitlements on each Home load.
  const facts = await refreshShopFacts(ctx.shop, ctx.admin);
  const [steps, pending, alerts] = await Promise.all([
    checklist(ctx.shop, ctx.settings),
    pendingWork(ctx.shop, ctx.settings),
    serverAlerts(ctx.shop, ctx.settings, facts, ctx.plan),
  ]);
  return {
    facts,
    steps,
    pending,
    alerts,
    welcome: ctx.settings.welcome,
    checklistDismissed: ctx.settings.onboarding.checklistDismissed,
    dismissedEmbedKey: ctx.settings.onboarding.dismissedAlerts.embed_off ?? null,
    currency: ctx.shopRow?.currency ?? null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "welcome") {
    const audience = String(form.get("audience") ?? "");
    if ((BUSINESS_TYPES as readonly string[]).includes(audience)) {
      await applyWelcome(ctx.shop, audience);
      await updateSettings(ctx.shop, { welcome: { audience: audience as (typeof BUSINESS_TYPES)[number], done: true } });
    }
    return { ok: true };
  }
  if (intent === "welcome_skip") {
    await updateSettings(ctx.shop, { welcome: { done: true } });
    return { ok: true };
  }
  if (intent === "dismiss_alert") {
    const id = String(form.get("id"));
    await updateSettings(ctx.shop, { onboarding: { dismissedAlerts: { ...ctx.settings.onboarding.dismissedAlerts, [id]: String(form.get("key")) } } });
    return { ok: true };
  }
  if (intent === "checklist") {
    await updateSettings(ctx.shop, { onboarding: { checklistDismissed: form.get("dismissed") === "1" } });
    return { ok: true };
  }
  return { ok: false };
};

type ThemeStatus = { embed: boolean | null; block: boolean | null };

/** Reads embed/block activation from App Bridge. Only the published theme is reported. */
function useThemeStatus(): [ThemeStatus, () => void] {
  const shopify = useAppBridge();
  const [status, setStatus] = useState<ThemeStatus>({ embed: null, block: null });
  const check = () => {
    const app = (shopify as unknown as { app?: { extensions?: () => Promise<ExtensionInfo[]> } }).app;
    if (!app?.extensions) return;
    app
      .extensions()
      .then((exts) => {
        const theme = exts.find((e) => e.handle === THEME_EXTENSION_HANDLE);
        const active = (handle: string) => Boolean(theme?.activations?.some((a) => a.handle === handle && a.status === "active"));
        setStatus({ embed: active(EMBED_HANDLE), block: active(FORM_BLOCK_HANDLE) });
      })
      .catch(() => setStatus({ embed: null, block: null }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(check, []);
  return [status, check];
}

type ExtensionInfo = { handle: string; type: string; activations?: { handle: string; status: string }[] };

function Status({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      <s-badge tone={ok ? "success" : ok === null ? "neutral" : "warning"} icon={ok ? "check" : ok === null ? "clock" : "alert-triangle"} />
      <s-text>{children}</s-text>
    </s-stack>
  );
}

export default function Home() {
  const d = useLoaderData<typeof loader>();
  const { t } = useI18n();
  const revalidator = useRevalidator();
  const [theme, recheckTheme] = useThemeStatus();
  const shopify = useAppBridge();
  const fetcher = useFetcher();

  const steps: ChecklistStep[] = d.steps.map((s) => (s.id === "embed" ? { ...s, done: theme.embed } : s.id === "block" ? { ...s, done: theme.block } : s));
  const allDone = steps.every((s) => s.done);
  // The embed alert is computed here because only App Bridge knows its state.
  const embedAlert = theme.embed === false && d.steps.find((s) => s.id === "test")?.done && d.dismissedEmbedKey !== "off";
  const dismiss = (id: AlertId, key: string) => fetcher.submit({ intent: "dismiss_alert", id, key }, { method: "POST" });

  const apiKey = (shopify as unknown as { config?: { apiKey?: string } }).config?.apiKey ?? "";
  const shopDomain = (shopify as unknown as { config?: { shop?: string } }).config?.shop ?? "";
  const editor = `https://${shopDomain}/admin/themes/current/editor`;
  const embedLink = `${editor}?context=apps&activateAppId=${apiKey}/${EMBED_HANDLE}`;
  const blockLink = `${editor}?template=page&addAppBlockId=${apiKey}/${FORM_BLOCK_HANDLE}&target=newAppsSection`;

  return (
    <s-page heading={t("home.title")}>
      {!d.welcome.done && <Welcome />}

      {d.alerts.map((a) => (
        <s-banner
          key={a.id}
          tone={a.id === "first_buyer" ? "success" : a.id === "plan_limit" && a.values?.full === "yes" ? "warning" : "info"}
          heading={t(`home.alert.${a.id}.heading`, a.values)}
          dismissible
          onDismiss={() => dismiss(a.id, a.key)}
        >
          <s-paragraph>{t(`home.alert.${a.id}.body`, a.values)}</s-paragraph>
          <AlertAction id={a.id} />
        </s-banner>
      ))}
      {embedAlert && (
        <s-banner tone="warning" heading={t("home.alert.embed_off.heading")} dismissible onDismiss={() => dismiss("embed_off", "off")}>
          <s-paragraph>{t("home.alert.embed_off.body")}</s-paragraph>
          <s-button href={embedLink} target="_blank">{t("home.checklist.openEditor")}</s-button>
        </s-banner>
      )}

      {(!d.checklistDismissed || !allDone) && (
        <s-section heading={t("home.checklist.heading")}>
          <s-stack direction="block" gap="base">
            <s-paragraph color="subdued">
              {t("home.checklist.progress", { done: steps.filter((s) => s.done).length, total: steps.length })}
            </s-paragraph>
            {steps.map((s) => (
              <ChecklistRow key={s.id} step={s} embedLink={embedLink} blockLink={blockLink} onRecheck={recheckTheme} />
            ))}
            {allDone && (
              <s-button variant="tertiary" onClick={() => fetcher.submit({ intent: "checklist", dismissed: "1" }, { method: "POST" })}>
                {t("home.checklist.dismiss")}
              </s-button>
            )}
          </s-stack>
        </s-section>
      )}

      <PendingWork pending={d.pending} />

      <Numbers30 currency={d.currency} />

      <s-section heading={t("home.readiness.heading")}>
        <Readiness facts={d.facts} onRefresh={() => revalidator.revalidate()} loading={revalidator.state === "loading"} />
      </s-section>

      {d.checklistDismissed && allDone && (
        <s-button variant="tertiary" onClick={() => fetcher.submit({ intent: "checklist", dismissed: "0" }, { method: "POST" })}>
          {t("home.checklist.show")}
        </s-button>
      )}
    </s-page>
  );
}

function AlertAction({ id }: { id: AlertId }) {
  const { t } = useI18n();
  const href = useLocaleHref();
  const target: Partial<Record<AlertId, string>> = {
    catalog_limit: "/app/tiers",
    email_quota: "/app/notifications",
    tier_missing: "/app/tiers",
    plan_limit: "/app/plans",
  };
  const to = target[id];
  if (!to) return null;
  return <s-button href={href(to)}>{t(`home.alert.${id}.action`)}</s-button>;
}

function Welcome() {
  const { t } = useI18n();
  const fetcher = useFetcher();
  const [audience, setAudience] = useState<string>("");
  return (
    <s-section heading={t("home.welcome.heading")}>
      <s-stack direction="block" gap="base">
        <s-paragraph>{t("home.welcome.body")}</s-paragraph>
        <s-choice-list
          label={t("home.welcome.question")}
          values={audience ? [audience] : []}
          onChange={(e) => setAudience(((e.currentTarget as unknown as { values: string[] }).values ?? [])[0] ?? "")}
        >
          {BUSINESS_TYPES.map((b) => (
            <s-choice key={b} value={b}>{t(`home.welcome.audience.${b}`)}</s-choice>
          ))}
        </s-choice-list>
        {audience && (
          <s-paragraph color="subdued">
            {t("home.welcome.suggestedTiers", { names: SUGGESTED_TIER_NAMES[audience].join(", ") })}
          </s-paragraph>
        )}
        <s-stack direction="inline" gap="base">
          <s-button
            variant="primary"
            disabled={!audience}
            {...(fetcher.state !== "idle" ? { loading: true } : {})}
            onClick={() => fetcher.submit({ intent: "welcome", audience }, { method: "POST" })}
          >
            {t("home.welcome.continue")}
          </s-button>
          <s-button variant="tertiary" onClick={() => fetcher.submit({ intent: "welcome_skip" }, { method: "POST" })}>
            {t("home.welcome.skip")}
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

const STEP_LINK: Record<ChecklistStep["id"], string | null> = {
  tier: "/app/tiers/new",
  form: "/app/form",
  embed: null,
  block: null,
  storefront: "/app/storefront",
  test: null,
};

function ChecklistRow({ step, embedLink, blockLink, onRecheck }: { step: ChecklistStep; embedLink: string; blockLink: string; onRecheck: () => void }) {
  const { t } = useI18n();
  const href = useLocaleHref();
  const link = STEP_LINK[step.id];
  return (
    <s-box padding="small-200" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="small-200">
        <Status ok={step.done}>
          <s-text type="strong">{t(`home.checklist.${step.id}.title`)}</s-text>
        </Status>
        {!step.done && (
          <>
            <s-paragraph color="subdued">{t(`home.checklist.${step.id}.body`)}</s-paragraph>
            <s-stack direction="inline" gap="small-200">
              {link && <s-button href={href(link)}>{t(`home.checklist.${step.id}.action`)}</s-button>}
              {step.id === "embed" && <s-button href={embedLink} target="_blank">{t("home.checklist.openEditor")}</s-button>}
              {step.id === "block" && <s-button href={blockLink} target="_blank">{t("home.checklist.addBlock")}</s-button>}
              {step.id === "block" && <s-button variant="tertiary" href={href("/app/help#add-form")}>{t("home.checklist.block.help")}</s-button>}
              {step.id === "test" && <s-button href={href("/app/form")}>{t("home.checklist.test.action")}</s-button>}
              {(step.id === "embed" || step.id === "block") && (
                <s-button variant="tertiary" onClick={onRecheck}>{t("home.readiness.refresh")}</s-button>
              )}
            </s-stack>
          </>
        )}
      </s-stack>
    </s-box>
  );
}

function PendingWork({ pending }: { pending: { applications: number; oldestAt: string | null; expiring: number; assignments: number } }) {
  const { t } = useI18n();
  const href = useLocaleHref();
  const nothing = !pending.applications && !pending.expiring && !pending.assignments;
  return (
    <s-section heading={t("home.pending.heading")}>
      {nothing ? (
        <s-paragraph>{t("home.pending.none")}</s-paragraph>
      ) : (
        <s-stack direction="block" gap="small-200">
          {pending.applications > 0 && (
            <s-link href={href("/app/applications?tab=pending&sort=oldest")}>
              {t("home.pending.applications", { count: pending.applications })}
              {pending.oldestAt && (
                <>
                  {" · "}
                  {t("home.pending.oldest")} <RelativeTime iso={pending.oldestAt} />
                </>
              )}
            </s-link>
          )}
          {pending.expiring > 0 && <s-link href={href("/app/certificates?status=expiring")}>{t("home.pending.certificates", { count: pending.expiring })}</s-link>}
          {pending.assignments > 0 && <s-link href={href("/app/tiers?assist=1")}>{t("home.pending.assignments", { count: pending.assignments })}</s-link>}
        </s-stack>
      )}
    </s-section>
  );
}

function Numbers30({ currency }: { currency: string | null }) {
  const { t, i18n } = useI18n();
  const fetcher = useFetcher<Numbers>();
  useEffect(() => {
    if (fetcher.state === "idle" && !fetcher.data) fetcher.load("/app/stats");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const n = fetcher.data;
  const pct = (v: number | null) => (v == null ? "—" : i18n.number(v, { style: "percent", maximumFractionDigits: 0 }));
  const hrs = (v: number | null) => (v == null ? "—" : v < 48 ? t("home.numbers.hours", { count: Math.round(v) }) : t("home.numbers.days", { count: Math.round(v / 24) }));
  const tile = (label: string, value: string, prev: string) => (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="small-400">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
        <s-text color="subdued">{t("home.numbers.previous", { value: prev })}</s-text>
      </s-stack>
    </s-box>
  );
  return (
    <s-section heading={t("home.numbers.heading")}>
      {!n ? (
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-spinner accessibilityLabel={t("home.numbers.loading")} size="base" />
          <s-text color="subdued">{t("home.numbers.loading")}</s-text>
        </s-stack>
      ) : (
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
            {tile(t("home.numbers.received"), i18n.number(n.received[0]), i18n.number(n.received[1]))}
            {tile(t("home.numbers.approved"), i18n.number(n.approved[0]), i18n.number(n.approved[1]))}
            {tile(t("home.numbers.rate"), pct(n.approvalRate[0]), pct(n.approvalRate[1]))}
            {tile(t("home.numbers.median"), hrs(n.medianHours[0]), hrs(n.medianHours[1]))}
          </s-grid>
          {n.newBuyersByTier.length > 0 && (
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">{t("home.numbers.newBuyers")}</s-text>
              {n.newBuyersByTier.map((b) => (
                <s-text key={b.tier || "none"}>{t("home.numbers.tierLine", { tier: b.tier || t("home.numbers.noTier"), count: b.count })}</s-text>
              ))}
            </s-stack>
          )}
          {n.orders ? (
            <s-text>
              {t("home.numbers.orders", { count: n.orders.count, total: i18n.money(n.orders.total, n.orders.currency ?? currency ?? "USD") })}
              {n.orders.truncated ? ` ${t("home.numbers.ordersTruncated")}` : ""}
            </s-text>
          ) : (
            <s-text color="subdued">{t("home.numbers.ordersUnavailable")}</s-text>
          )}
        </s-stack>
      )}
    </s-section>
  );
}

type Facts = Awaited<ReturnType<typeof loader>>["facts"];

function Readiness({ facts, onRefresh, loading }: { facts: Facts; onRefresh: () => void; loading: boolean }) {
  const { t } = useI18n();
  const limit = facts.catalogLimit ?? 0;
  const used = facts.catalogsUsed ?? 0;
  const budgetOk = facts.isPlus || limit === 0 || used < limit;
  return (
    <s-stack direction="block" gap="base">
      <s-text>{t("home.readiness.plan", { plan: facts.planName })}</s-text>
      <Status ok={facts.b2bEnabled}>{facts.b2bEnabled ? t("home.readiness.b2bOn") : t("home.readiness.b2bOff")}</Status>
      {facts.b2bEnabled && !facts.isPlus && (
        <Status ok={facts.b2bMarketsEnabled}>
          {facts.b2bMarketsEnabled ? t("home.readiness.marketsOn") : t("home.readiness.marketsOff")}
        </Status>
      )}
      {facts.b2bEnabled && (
        <Status ok={budgetOk}>
          {facts.isPlus || limit === 0 ? t("home.readiness.catalogUnlimited", { used }) : t("home.readiness.catalogBudget", { used, limit })}
        </Status>
      )}
      <s-stack direction="inline" gap="base">
        {!facts.b2bEnabled && (
          <s-button href="https://www.shopify.com/pricing" target="_blank">{t("home.readiness.viewPlans")}</s-button>
        )}
        {facts.b2bEnabled && !facts.isPlus && !facts.b2bMarketsEnabled && (
          <s-button href="https://help.shopify.com/manual/markets" target="_blank">{t("home.readiness.marketsHelp")}</s-button>
        )}
        <s-button variant="tertiary" onClick={onRefresh} {...(loading ? { loading: true } : {})}>
          {t("home.readiness.refresh")}
        </s-button>
      </s-stack>
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
