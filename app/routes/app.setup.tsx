import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import db from "../db.server";
import { adminContext } from "../lib/context.server";
import { shopFactsOrStored } from "../lib/shop.server";
import { updateSettings } from "../lib/settings.server";
import { syncStorefrontConfig } from "../lib/storefront-sync.server";
import { logActivity } from "../lib/activity.server";
import { applyTemplate, BUSINESS_TYPES, SUGGESTED_TIER_NAMES } from "../lib/form-defaults";
import { readDefinition } from "../lib/forms.server";
import { catalogBudget, createBlockReason, createTier, TierError } from "../lib/tiers.server";
import { validateTierInput, type TierInput } from "../lib/tiers";
import { effectivePlan, FREE_APPROVALS_PER_MONTH, maxTiers } from "../lib/plans";
import { EMBED_HANDLE, FORM_BLOCK_HANDLE, THEME_EXTENSION_HANDLE } from "../lib/theme";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";

// Setup wizard: five short steps that get a new store accepting wholesale
// applications in a few minutes. Every step can be skipped and redone later;
// nothing here does anything the regular pages can't (it calls the same code).

const STEPS = ["plan", "business", "tier", "access", "theme"] as const;
type Step = (typeof STEPS)[number];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const facts = await shopFactsOrStored(ctx.shop, ctx.admin);
  const plan = effectivePlan(facts.subscription?.plan ?? ctx.shopRow?.billingPlan ?? "free", facts.isDevStore);
  const [tiers, budget] = await Promise.all([
    db.tier.findMany({ where: { shop: ctx.shop }, select: { id: true, name: true, discountPct: true }, orderBy: { position: "asc" } }),
    catalogBudget(ctx.admin, ctx.shop),
  ]);
  const block = createBlockReason(plan, tiers.length, facts, budget);
  const audience = ctx.settings.welcome.audience ?? "";
  return {
    facts: {
      planName: facts.planName,
      isPlus: facts.isPlus,
      isDevStore: facts.isDevStore,
      b2bEnabled: facts.b2bEnabled,
      b2bMarketsEnabled: facts.b2bMarketsEnabled,
      catalogLimit: facts.catalogLimit,
      catalogsUsed: facts.catalogsUsed,
      directCatalogs: facts.directCatalogs,
    },
    plan,
    maxTiers: Number.isFinite(maxTiers(plan)) ? maxTiers(plan) : null,
    freeApprovals: FREE_APPROVALS_PER_MONTH,
    tiers,
    tierBlock: block,
    audience,
    suggestedTier: audience && SUGGESTED_TIER_NAMES[audience] ? SUGGESTED_TIER_NAMES[audience][0] : "Wholesale",
    accessMode: ctx.settings.storefront.accessMode,
    applyUrl: ctx.settings.storefront.applyUrl,
    domainUrl: ctx.shopRow?.domainUrl ?? `https://${ctx.shop}`,
  };
};

type Result = { ok: true; intent: string } | { ok: false; intent: string; error: string; detail?: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<Result> => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "business") {
    const audience = String(form.get("audience") ?? "");
    if (!(BUSINESS_TYPES as readonly string[]).includes(audience)) return { ok: false, intent, error: "setup.error.chooseBusiness" };
    // The template only changes which standard questions are asked; custom questions and texts stay.
    const def = await db.form.findFirst({ where: { shop: ctx.shop, isDefault: true } });
    if (def) await db.form.update({ where: { id: def.id }, data: { definition: applyTemplate(readDefinition(def.definition), audience) as object } });
    await updateSettings(ctx.shop, { welcome: { audience: audience as (typeof BUSINESS_TYPES)[number] } });
    await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "setup.business", subject: null, detail: { audience } });
    await syncStorefrontConfig(ctx.admin, ctx.shop).catch(() => undefined); // the form block reads the definition from metafields
    return { ok: true, intent };
  }

  if (intent === "tier") {
    const input: TierInput = {
      name: String(form.get("name") ?? "").trim(),
      buyerNames: {},
      pricing: { kind: "percent", pct: Number(form.get("pct")) },
      products: { kind: "all" },
      paymentTermsTemplateId: null,
      checkoutToDraft: false,
      tax: "charge",
      direct: Boolean(ctx.shopRow?.directCatalogs),
    };
    const errs = validateTierInput(input);
    const first = Object.values(errs)[0];
    if (first) return { ok: false, intent, error: first };
    try {
      await createTier(ctx, ctx.plan, input);
      await syncStorefrontConfig(ctx.admin, ctx.shop).catch(() => undefined);
      return { ok: true, intent };
    } catch (e) {
      const code = e instanceof TierError ? e.code : "shopify";
      return { ok: false, intent, error: `tiers.error.${code}`, detail: e instanceof TierError ? e.detail : undefined };
    }
  }

  if (intent === "access") {
    const mode = String(form.get("mode"));
    if (mode !== "show" && mode !== "hide") return { ok: false, intent, error: "setup.error.chooseAccess" };
    const before = ctx.settings.storefront.accessMode;
    if (before === "wholesale_only") return { ok: true, intent }; // never loosen a wholesale-only store from the wizard
    await updateSettings(ctx.shop, { storefront: { accessMode: mode }, onboarding: { storefrontReviewed: true } });
    try {
      await syncStorefrontConfig(ctx.admin, ctx.shop);
    } catch {
      await updateSettings(ctx.shop, { storefront: { accessMode: before } });
      return { ok: false, intent, error: "setup.error.syncFailed" };
    }
    await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "setup.access", subject: null, detail: { mode } });
    return { ok: true, intent };
  }

  if (intent === "finish") {
    await updateSettings(ctx.shop, { welcome: { done: true } });
    await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "setup.finish", subject: null });
    return { ok: true, intent };
  }
  return { ok: false, intent, error: "setup.error.unknown" };
};

type ExtensionInfo = { handle: string; activations?: { handle: string; status: string }[] };

export default function Setup() {
  const d = useLoaderData<typeof loader>();
  const { t } = useI18n();
  const href = useLocaleHref();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const [params, setParams] = useSearchParams();
  const fetcher = useFetcher<typeof action>();
  const stepIndex = Math.max(0, STEPS.indexOf((params.get("step") as Step) ?? "plan"));
  const step = STEPS[stepIndex];
  const busy = fetcher.state !== "idle";
  const go = (i: number) => {
    const p = new URLSearchParams(params);
    p.set("step", STEPS[Math.min(STEPS.length - 1, Math.max(0, i))]);
    setParams(p);
  };

  useEffect(() => {
    const r = fetcher.data;
    if (!r) return;
    if (!r.ok) {
      shopify.toast.show(t(r.error, { detail: r.detail ?? "" }), { isError: true });
      return;
    }
    if (r.intent === "finish") {
      shopify.toast.show(t("setup.done.toast"));
      navigate(href("/app"));
    } else go(stepIndex + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const submit = (data: Record<string, string>) => fetcher.submit(data, { method: "POST" });

  return (
    <s-page heading={t("setup.title")}>
      <s-link slot="breadcrumb-actions" href={href("/app")}>{t("nav.home")}</s-link>
      <s-section>
        <s-stack direction="block" gap="small-200">
          <s-text color="subdued">{t("setup.progress", { step: stepIndex + 1, total: STEPS.length })}</s-text>
          <s-stack direction="inline" gap="small-200">
            {STEPS.map((s, i) => (
              <s-button key={s} variant={i === stepIndex ? "primary" : "tertiary"} onClick={() => go(i)} accessibilityLabel={t(`setup.${s}.title`)}>
                {`${i + 1}. ${t(`setup.${s}.short`)}`}
              </s-button>
            ))}
          </s-stack>
        </s-stack>
      </s-section>

      {step === "plan" && <PlanStep d={d} onNext={() => go(1)} />}
      {step === "business" && <BusinessStep initial={d.audience} busy={busy} onBack={() => go(0)} onSubmit={(audience) => submit({ intent: "business", audience })} />}
      {step === "tier" && <TierStep d={d} busy={busy} onBack={() => go(1)} onSkip={() => go(3)} onSubmit={(name, pct) => submit({ intent: "tier", name, pct })} />}
      {step === "access" && <AccessStep initial={d.accessMode} busy={busy} onBack={() => go(2)} onSubmit={(mode) => submit({ intent: "access", mode })} />}
      {step === "theme" && <ThemeStep d={d} busy={busy} onBack={() => go(3)} onFinish={() => submit({ intent: "finish" })} />}
    </s-page>
  );
}

type Data = ReturnType<typeof useLoaderData<typeof loader>>;

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      <s-badge tone={ok ? "success" : "warning"} icon={ok ? "check" : "alert-triangle"}>
        <s-text accessibilityVisibility="exclusive">{t(ok ? "setup.plan.yes" : "setup.plan.no")}</s-text>
      </s-badge>
      <s-text>{children}</s-text>
    </s-stack>
  );
}

function PlanStep({ d, onNext }: { d: Data; onNext: () => void }) {
  const { t } = useI18n();
  const href = useLocaleHref();
  const f = d.facts;
  const free = f.catalogLimit != null && f.catalogsUsed != null ? Math.max(0, f.catalogLimit - f.catalogsUsed) : null;
  return (
    <s-section heading={t("setup.plan.title")}>
      <s-stack direction="block" gap="base">
        <s-paragraph>{t("setup.plan.intro")}</s-paragraph>
        <s-text type="strong">{t("home.readiness.plan", { plan: f.planName })}</s-text>
        <Check ok={f.b2bEnabled}>{t(f.b2bEnabled ? "setup.plan.b2bYes" : "setup.plan.b2bNo")}</Check>
        <Check ok={f.b2bMarketsEnabled || f.directCatalogs}>{t(f.b2bMarketsEnabled || f.directCatalogs ? "setup.plan.pricesYes" : "setup.plan.pricesNo")}</Check>
        <Check ok={f.directCatalogs || (free ?? 1) > 0}>
          {f.directCatalogs
            ? t("setup.plan.tiersPlus")
            : free == null
              ? t("setup.plan.tiersUnknown")
              : t("setup.plan.tiersLimit", { limit: f.catalogLimit ?? 0, free })}
        </Check>
        <s-paragraph color="subdued">
          {d.plan === "free" ? t("setup.plan.tradepassFree", { approvals: d.freeApprovals }) : t("setup.plan.tradepassPaid", { plan: t(`plans.name.${d.plan}`) })}
        </s-paragraph>
        {!f.b2bEnabled && (
          <s-banner tone="warning" heading={t("setup.plan.noB2bHeading")}>
            <s-paragraph>{t("setup.plan.noB2bBody")}</s-paragraph>
          </s-banner>
        )}
        {f.b2bEnabled && !f.b2bMarketsEnabled && !f.directCatalogs && (
          <s-banner tone="info" heading={t("setup.plan.marketsHeading")}>
            <s-paragraph>{t("setup.plan.marketsBody")}</s-paragraph>
          </s-banner>
        )}
        <s-stack direction="inline" gap="base">
          <s-button variant="primary" onClick={onNext}>{t("setup.next")}</s-button>
          {d.plan === "free" && <s-button href={href("/app/plans")}>{t("setup.plan.comparePlans")}</s-button>}
        </s-stack>
      </s-stack>
    </s-section>
  );
}

function BusinessStep({ initial, busy, onBack, onSubmit }: { initial: string; busy: boolean; onBack: () => void; onSubmit: (a: string) => void }) {
  const { t } = useI18n();
  const [audience, setAudience] = useState(initial || "retail");
  return (
    <s-section heading={t("setup.business.title")}>
      <s-stack direction="block" gap="base">
        <s-paragraph>{t("setup.business.intro")}</s-paragraph>
        <s-choice-list
          label={t("home.welcome.question")}
          values={[audience]}
          onChange={(e) => setAudience(((e.currentTarget as unknown as { values: string[] }).values ?? [])[0] ?? audience)}
        >
          {BUSINESS_TYPES.map((b) => (
            <s-choice key={b} value={b}>
              {t(`home.welcome.audience.${b}`)}
              <s-text slot="details">{t(`form.template.desc.${b}`)}</s-text>
            </s-choice>
          ))}
        </s-choice-list>
        <s-paragraph color="subdued">{t("setup.business.note")}</s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button variant="primary" loading={busy} onClick={() => onSubmit(audience)}>{t("setup.business.continue")}</s-button>
          <s-button variant="tertiary" onClick={onBack}>{t("setup.back")}</s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

function TierStep({ d, busy, onBack, onSkip, onSubmit }: { d: Data; busy: boolean; onBack: () => void; onSkip: () => void; onSubmit: (name: string, pct: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(d.suggestedTier);
  const [pct, setPct] = useState("20");
  if (d.tiers.length) {
    return (
      <s-section heading={t("setup.tier.title")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("setup.tier.existing", { count: d.tiers.length, names: d.tiers.map((x) => x.name).join(", ") })}</s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" onClick={onSkip}>{t("setup.next")}</s-button>
            <s-button variant="tertiary" onClick={onBack}>{t("setup.back")}</s-button>
          </s-stack>
        </s-stack>
      </s-section>
    );
  }
  return (
    <s-section heading={t("setup.tier.title")}>
      <s-stack direction="block" gap="base">
        <s-paragraph>{t("setup.tier.intro")}</s-paragraph>
        {d.tierBlock && (
          <s-banner tone="warning" heading={t("setup.tier.blockedHeading")}>
            <s-paragraph>{t(`tiers.error.${d.tierBlock}`, { detail: "" })}</s-paragraph>
          </s-banner>
        )}
        <s-text-field label={t("setup.tier.name")} details={t("setup.tier.nameHelp")} value={name} maxLength={60}
          onInput={(e) => setName((e.currentTarget as unknown as HTMLInputElement).value)} />
        <s-number-field label={t("setup.tier.discount")} details={t("setup.tier.discountHelp")} value={pct} min={1} max={90} suffix="%"
          onInput={(e) => setPct((e.currentTarget as unknown as HTMLInputElement).value)} />
        <s-paragraph color="subdued">{t("setup.tier.note")}</s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button variant="primary" loading={busy} disabled={Boolean(d.tierBlock)} onClick={() => onSubmit(name, pct)}>{t("setup.tier.create")}</s-button>
          <s-button onClick={onSkip}>{t("setup.skip")}</s-button>
          <s-button variant="tertiary" onClick={onBack}>{t("setup.back")}</s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

function AccessStep({ initial, busy, onBack, onSubmit }: { initial: string; busy: boolean; onBack: () => void; onSubmit: (m: string) => void }) {
  const { t } = useI18n();
  const href = useLocaleHref();
  const [mode, setMode] = useState(initial === "hide" ? "hide" : "show");
  if (initial === "wholesale_only") {
    return (
      <s-section heading={t("setup.access.title")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("setup.access.wholesaleOnly")}</s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" loading={busy} onClick={() => onSubmit("show")}>{t("setup.next")}</s-button>
            <s-button href={href("/app/storefront")}>{t("nav.storefrontAccess")}</s-button>
          </s-stack>
        </s-stack>
      </s-section>
    );
  }
  return (
    <s-section heading={t("setup.access.title")}>
      <s-stack direction="block" gap="base">
        <s-paragraph>{t("setup.access.intro")}</s-paragraph>
        <s-choice-list
          label={t("storefront.mode.label")}
          values={[mode]}
          onChange={(e) => setMode(((e.currentTarget as unknown as { values: string[] }).values ?? [])[0] ?? mode)}
        >
          <s-choice value="show">
            {t("storefront.mode.show")}
            <s-text slot="details">{t("storefront.mode.showDetails")}</s-text>
          </s-choice>
          <s-choice value="hide">
            {t("storefront.mode.hide")}
            <s-text slot="details">{t("storefront.mode.hideDetails")}</s-text>
          </s-choice>
        </s-choice-list>
        <s-paragraph color="subdued">{t("setup.access.wholesaleOnlyLater")}</s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button variant="primary" loading={busy} onClick={() => onSubmit(mode)}>{t("setup.next")}</s-button>
          <s-button variant="tertiary" onClick={onBack}>{t("setup.back")}</s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

function ThemeStep({ d, busy, onBack, onFinish }: { d: Data; busy: boolean; onBack: () => void; onFinish: () => void }) {
  const { t } = useI18n();
  const shopify = useAppBridge();
  const [status, setStatus] = useState<{ embed: boolean | null; block: boolean | null }>({ embed: null, block: null });
  const check = () => {
    const app = (shopify as unknown as { app?: { extensions?: () => Promise<ExtensionInfo[]> } }).app;
    app?.extensions?.()
      .then((exts) => {
        const theme = exts.find((e) => e.handle === THEME_EXTENSION_HANDLE);
        const active = (h: string) => Boolean(theme?.activations?.some((a) => a.handle === h && a.status === "active"));
        setStatus({ embed: active(EMBED_HANDLE), block: active(FORM_BLOCK_HANDLE) });
      })
      .catch(() => setStatus({ embed: null, block: null }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(check, []);
  const cfg = shopify as unknown as { config?: { apiKey?: string; shop?: string } };
  const editor = `https://${cfg.config?.shop ?? ""}/admin/themes/current/editor`;
  const embedLink = `${editor}?context=apps&activateAppId=${cfg.config?.apiKey ?? ""}/${EMBED_HANDLE}`;
  const blockLink = `${editor}?template=page&addAppBlockId=${cfg.config?.apiKey ?? ""}/${FORM_BLOCK_HANDLE}&target=newAppsSection`;
  const badge = (ok: boolean | null) => (
    <s-badge tone={ok ? "success" : ok === null ? "neutral" : "warning"}>{t(ok ? "setup.theme.on" : ok === null ? "setup.theme.checking" : "setup.theme.off")}</s-badge>
  );
  return (
    <s-section heading={t("setup.theme.title")}>
      <s-stack direction="block" gap="base">
        <s-paragraph>{t("setup.theme.intro")}</s-paragraph>
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="small-200">
            <s-stack direction="inline" gap="small-200" alignItems="center"><s-text type="strong">{t("setup.theme.embedTitle")}</s-text>{badge(status.embed)}</s-stack>
            <s-paragraph color="subdued">{t("setup.theme.embedBody")}</s-paragraph>
            <s-button href={embedLink} target="_blank">{t("setup.theme.embedAction")}</s-button>
          </s-stack>
        </s-box>
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="small-200">
            <s-stack direction="inline" gap="small-200" alignItems="center"><s-text type="strong">{t("setup.theme.blockTitle")}</s-text>{badge(status.block)}</s-stack>
            <s-paragraph color="subdued">{t("setup.theme.blockBody", { url: d.applyUrl })}</s-paragraph>
            <s-stack direction="inline" gap="small-200">
              <s-button href="shopify://admin/pages/new" target="_blank">{t("setup.theme.createPage")}</s-button>
              <s-button href={blockLink} target="_blank">{t("setup.theme.blockAction")}</s-button>
            </s-stack>
          </s-stack>
        </s-box>
        <s-stack direction="inline" gap="base">
          <s-button variant="primary" loading={busy} onClick={onFinish}>{t("setup.finish")}</s-button>
          <s-button onClick={check}>{t("home.readiness.refresh")}</s-button>
          <s-button href={`${d.domainUrl}${d.applyUrl}`} target="_blank">{t("setup.theme.viewForm")}</s-button>
          <s-button variant="tertiary" onClick={onBack}>{t("setup.back")}</s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
