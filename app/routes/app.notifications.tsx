import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { adminContext } from "../lib/context.server";
import { gql } from "../lib/gql.server";
import { updateSettings } from "../lib/settings.server";
import type { EmailType, Settings } from "../lib/settings";
import { createT } from "../lib/i18n";
import { isRtl, LOCALES, matchLocale } from "../lib/i18n/locales";
import { useI18n } from "../lib/i18n/react";
import { emailQuotaToday, merchantAddress, sendTestEmail } from "../lib/email/index.server";
import { builtInPatterns, checkPattern, resolvePattern } from "../lib/email/templates.server";
import { renderEmail } from "../lib/email/render";
import { APPLICANT_EMAIL_TYPES, bodyKey, RELEVANT_PLACEHOLDERS, subjectKey } from "../lib/email/types";

// Notifications: applicant/buyer emails (on/off, subject + body per language,
// live preview, test send), merchant alerts, and today's email quota.

type ShopLocale = { locale: string; primary: boolean; published: boolean };

async function storeLocales(admin: Parameters<typeof gql>[0], primary: string): Promise<string[]> {
  try {
    const data = await gql<{ shopLocales: ShopLocale[] }>(admin, `#graphql
      query TradepassShopLocales { shopLocales { locale primary published } }`);
    const list = data.shopLocales.filter((l) => l.published || l.primary).sort((a, b) => Number(b.primary) - Number(a.primary));
    return list.length ? list.map((l) => l.locale) : [primary];
  } catch {
    return [primary];
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const addDaysIso = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const url = new URL(request.url);
  const primary = ctx.shopRow?.primaryLocale ?? "en";
  const [published, quota] = await Promise.all([storeLocales(ctx.admin, primary), emailQuotaToday(ctx.shop)]);
  const editLocale = url.searchParams.get("lang") || published[0] || primary;
  const overrides = ctx.settings.texts;
  const rc = { locale: editLocale, primary, overrides };
  const lt = createT(editLocale, { primary, overrides });
  const fmtDate = (iso: string) => new Intl.DateTimeFormat(lt.locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  const storeName = ctx.shopRow?.name ?? ctx.shop.replace(/\.myshopify\.com$/, "");

  const emails = APPLICANT_EMAIL_TYPES.map((type) => {
    const builtIn = builtInPatterns(type, editLocale, primary);
    return {
      type,
      enabled: ctx.settings.notifications.emails[type].enabled,
      subject: overrides[editLocale]?.[subjectKey(type)] ?? builtIn.subject,
      body: overrides[editLocale]?.[bodyKey(type)] ?? builtIn.body,
      builtIn,
      placeholders: RELEVANT_PLACEHOLDERS[type],
      extraLine:
        type === "rejected" ? resolvePattern("email.rejected.reasonLine", rc)
        : type === "needs_info" ? resolvePattern("email.needs_info.messageLine", rc)
        : type === "approved" ? resolvePattern("email.approved.termsLine", rc)
        : null,
    };
  });

  return {
    editLocale,
    published,
    builtInLocales: [...LOCALES],
    previewLocale: matchLocale(editLocale) ?? lt.locale,
    previewDir: isRtl(lt.locale) ? ("rtl" as const) : ("ltr" as const),
    footer: resolvePattern("email.footer.applicant", rc),
    storeName,
    logoUrl: ctx.settings.branding.logoUrl,
    sample: {
      company: lt.t("email.sample.company"),
      first_name: lt.t("email.sample.firstName"),
      store_name: storeName,
      tier_name: lt.t("email.sample.tierName"),
      login_url: `https://${ctx.shop}${ctx.settings.storefront.loginUrl}`,
      update_link: `https://${ctx.shop}/apps/tradepass/renew/example`,
      expiry_date: fmtDate(addDaysIso(30)),
      reason: lt.t("email.sample.reason"),
      message: lt.t("email.sample.message"),
      terms: lt.t("email.sample.terms"),
    },
    emails,
    useShopifyWelcome: ctx.settings.notifications.useShopifyWelcome,
    merchant: {
      mode: ctx.settings.notifications.merchant.mode,
      email: ctx.settings.notifications.merchant.email ?? "",
      fallbackEmail: ctx.shopRow?.email ?? "",
    },
    quota: { ...quota, day: today() },
  };
};

type FieldErrors = Record<string, string>;
type ActionData =
  | { intent: "save"; ok: true }
  | { intent: "save"; ok: false; errors: FieldErrors; problem?: Record<string, string> }
  | { intent: "test"; ok: boolean; to?: string; deferred?: boolean };

const MODES = ["instant", "digest", "off"] as const;
const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const editLocale = String(form.get("editLocale") || ctx.shopRow?.primaryLocale || "en");
  const primary = ctx.shopRow?.primaryLocale ?? "en";

  if (intent === "test") {
    const type = String(form.get("type")) as EmailType;
    if (!APPLICANT_EMAIL_TYPES.includes(type)) return { intent: "test", ok: false };
    const session = ctx.session as { onlineAccessInfo?: { associated_user?: { email?: string } } };
    const to = session.onlineAccessInfo?.associated_user?.email || merchantAddress(ctx.settings, ctx.shopRow?.email) || "";
    const lt = createT(editLocale, { primary });
    const res = await sendTestEmail(ctx.shop, type, editLocale, to, {
      subject: String(form.get("subject") ?? "") || undefined,
      body: String(form.get("body") ?? "") || undefined,
    }, {
      company: lt.t("email.sample.company"), first_name: lt.t("email.sample.firstName"), tier_name: lt.t("email.sample.tierName"),
      login_url: `https://${ctx.shop}${ctx.settings.storefront.loginUrl}`, update_link: `https://${ctx.shop}/apps/tradepass/renew/example`,
      expiry_date: addDaysIso(30), reason: lt.t("email.sample.reason"), message: lt.t("email.sample.message"), terms: lt.t("email.sample.terms"),
    });
    return { intent: "test", ok: res.queued, to: res.queued ? to : undefined, deferred: res.reason === "quota_deferred" };
  }

  // Save
  const errors: FieldErrors = {};
  const problem: Record<string, string> = {};
  const texts: Record<string, string | undefined> = {};
  const emails = {} as Settings["notifications"]["emails"];
  for (const type of APPLICANT_EMAIL_TYPES) {
    emails[type] = { enabled: form.get(`enabled_${type}`) === "on" };
    const builtIn = builtInPatterns(type, editLocale, primary);
    for (const [part, key, def] of [["subject", subjectKey(type), builtIn.subject], ["body", bodyKey(type), builtIn.body]] as const) {
      const value = String(form.get(`${part}_${type}`) ?? "").replace(/\r\n/g, "\n").trim();
      const field = `${part}_${type}`;
      if (!value) {
        texts[key] = undefined; // empty = back to the built-in text
        continue;
      }
      const p = checkPattern(type, value);
      if (p) {
        errors[field] = p.kind === "syntax" ? "notifications.error.syntax" : "notifications.error.placeholder";
        if (p.kind === "unknown_placeholder") problem[field] = p.name;
        continue;
      }
      texts[key] = value === def.trim() ? undefined : value;
    }
  }
  const mode = String(form.get("merchantMode"));
  const merchantEmail = String(form.get("merchantEmail") ?? "").trim();
  if (merchantEmail && !EMAIL_RE.test(merchantEmail)) errors.merchantEmail = "notifications.error.email";
  if (Object.keys(errors).length) return { intent: "save", ok: false, errors, problem };

  await updateSettings(ctx.shop, {
    notifications: {
      emails,
      useShopifyWelcome: form.get("useShopifyWelcome") === "on",
      merchant: { mode: (MODES as readonly string[]).includes(mode) ? (mode as (typeof MODES)[number]) : "digest", email: merchantEmail || null },
    },
    // Only this language's email keys change; undefined removes an override.
    texts: { [editLocale]: { ...(ctx.settings.texts[editLocale] ?? {}), ...texts } as Record<string, string> },
  });
  return { intent: "save", ok: true };
};

type Data = Awaited<ReturnType<typeof loader>>;
type EmailState = { enabled: boolean; subject: string; body: string };

function initialState(data: Data) {
  return {
    emails: Object.fromEntries(data.emails.map((e) => [e.type, { enabled: e.enabled, subject: e.subject, body: e.body }])) as Record<string, EmailState>,
    useShopifyWelcome: data.useShopifyWelcome,
    merchantMode: data.merchant.mode as string,
    merchantEmail: data.merchant.email,
  };
}

const val = (e: Event) => (e.currentTarget as unknown as HTMLInputElement).value;

export default function Notifications() {
  const data = useLoaderData<typeof loader>();
  const { t, locale } = useI18n();
  const shopify = useAppBridge();
  const [, setParams] = useSearchParams();
  const save = useFetcher<typeof action>();
  const test = useFetcher<typeof action>();
  const initial = useMemo(() => initialState(data), [data]);
  const [state, setState] = useState(initial);
  const [dirty, setDirty] = useState(false);
  // Fresh loader data (after save or a language switch) resets the editor.
  const [shown, setShown] = useState(initial);
  if (shown !== initial) {
    setShown(initial);
    setState(initial);
    setDirty(false);
  }

  const saveResult = save.data && save.data.intent === "save" ? save.data : null;
  const errors = saveResult && !saveResult.ok ? saveResult.errors : {};
  const problem = saveResult && !saveResult.ok ? saveResult.problem ?? {} : {};

  useEffect(() => {
    if (saveResult?.ok) shopify.toast.show(t("common.saved"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save.data]);
  useEffect(() => {
    const d = test.data;
    if (!d || d.intent !== "test") return;
    if (d.ok) shopify.toast.show(t(d.deferred ? "notifications.test.deferred" : "notifications.test.sent", { email: d.to ?? "" }));
    else shopify.toast.show(t("notifications.test.failed"), { isError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [test.data]);

  const patchEmail = (type: string, patch: Partial<EmailState>) => {
    setState((s) => ({ ...s, emails: { ...s.emails, [type]: { ...s.emails[type], ...patch } } }));
    setDirty(true);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set("editLocale", data.editLocale);
    for (const [type, s] of Object.entries(state.emails)) {
      if (s.enabled) fd.set(`enabled_${type}`, "on");
      fd.set(`subject_${type}`, s.subject);
      fd.set(`body_${type}`, s.body);
    }
    if (state.useShopifyWelcome) fd.set("useShopifyWelcome", "on");
    fd.set("merchantMode", state.merchantMode);
    fd.set("merchantEmail", state.merchantEmail);
    save.submit(fd, { method: "POST" });
  };
  const onReset = () => { setState(initial); setDirty(false); };

  const switchLanguage = async (next: string) => {
    if (dirty) await shopify.saveBar.leaveConfirmation();
    setParams((p) => { p.set("lang", next); return p; });
  };

  const langName = (code: string) => {
    try {
      return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  const others = data.builtInLocales.filter((l) => !data.published.includes(l));
  const q = data.quota;
  const errorFields = Object.keys(errors);

  return (
    <s-page heading={t("notifications.title")}>
      {q.deferred > 0 && (
        <s-banner tone="warning" heading={t("notifications.quota.deferredHeading", { count: q.deferred })}>
          <s-paragraph>{t("notifications.quota.deferredBody")}</s-paragraph>
        </s-banner>
      )}
      {errorFields.length > 0 && (
        <s-banner tone="critical" heading={t("notifications.error.summary", { count: errorFields.length })}>
          <s-unordered-list>
            {errorFields.map((f) => (
              <s-list-item key={f}><s-link href={`#${f}`}>{fieldLabel(t, f)}</s-link></s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      )}

      <s-section heading={t("notifications.quota.heading")}>
        <s-stack direction="block" gap="small-200">
          <s-text>{t("notifications.quota.store", { used: q.shopUsed, cap: q.shopCap, left: Math.max(0, q.shopCap - q.shopUsed) })}</s-text>
          <s-paragraph color="subdued">{t("notifications.quota.explain", { storeCap: q.shopCap, globalCap: q.globalCap })}</s-paragraph>
          <s-paragraph color="subdued">{t("notifications.quota.flow")}</s-paragraph>
        </s-stack>
      </s-section>

      <form data-save-bar data-discard-confirmation onSubmit={onSubmit} onReset={onReset}>
        <s-section heading={t("notifications.merchant.heading")}>
          <s-stack direction="block" gap="base">
            <s-select label={t("notifications.merchant.mode")} name="merchantMode" value={state.merchantMode}
              details={t(`notifications.merchant.mode.${state.merchantMode}.help`)}
              onChange={(e) => { setState((s) => ({ ...s, merchantMode: val(e as unknown as Event) })); setDirty(true); }}>
              {MODES.map((m) => <s-option key={m} value={m}>{t(`notifications.merchant.mode.${m}`)}</s-option>)}
            </s-select>
            <s-email-field id="merchantEmail" name="merchantEmail" label={t("notifications.merchant.email")}
              details={t("notifications.merchant.emailHelp", { email: data.merchant.fallbackEmail || "—" })}
              value={state.merchantEmail} error={errors.merchantEmail ? t(errors.merchantEmail) : undefined}
              onInput={(e) => { setState((s) => ({ ...s, merchantEmail: val(e as unknown as Event) })); setDirty(true); }} />
          </s-stack>
        </s-section>

        <s-section heading={t("notifications.emails.heading")}>
          <s-stack direction="block" gap="base">
            <s-paragraph>{t("notifications.emails.intro")}</s-paragraph>
            <s-select label={t("notifications.language.label")} value={data.editLocale}
              details={t("notifications.language.help")}
              onChange={(e) => void switchLanguage(val(e as unknown as Event))}>
              <s-option-group label={t("notifications.language.store")}>
                {data.published.map((l) => <s-option key={l} value={l}>{langName(l)}</s-option>)}
              </s-option-group>
              <s-option-group label={t("notifications.language.other")}>
                {others.map((l) => <s-option key={l} value={l}>{langName(l)}</s-option>)}
              </s-option-group>
            </s-select>
            <s-checkbox name="useShopifyWelcome" label={t("notifications.welcome.label")} details={t("notifications.welcome.help")}
              checked={state.useShopifyWelcome}
              onChange={() => { setState((s) => ({ ...s, useShopifyWelcome: !s.useShopifyWelcome })); setDirty(true); }} />
          </s-stack>
        </s-section>

        {data.emails.map((e) => (
          <EmailEditor
            key={`${data.editLocale}-${e.type}`}
            email={e}
            value={state.emails[e.type]}
            data={data}
            errors={errors}
            problem={problem}
            sending={test.state !== "idle"}
            onChange={(patch) => patchEmail(e.type, patch)}
            onTest={() => test.submit({ intent: "test", type: e.type, editLocale: data.editLocale, subject: state.emails[e.type].subject, body: state.emails[e.type].body }, { method: "POST" })}
          />
        ))}
      </form>
    </s-page>
  );
}

function fieldLabel(t: (k: string, v?: Record<string, string>) => string, field: string): string {
  if (field === "merchantEmail") return t("notifications.merchant.email");
  const [part, ...rest] = field.split("_");
  return t(`notifications.field.${part}`, { email: t(`notifications.type.${rest.join("_")}`) });
}

function EmailEditor(props: {
  email: Data["emails"][number];
  value: EmailState;
  data: Data;
  errors: FieldErrors;
  problem: Record<string, string>;
  sending: boolean;
  onChange: (p: Partial<EmailState>) => void;
  onTest: () => void;
}) {
  const { t } = useI18n();
  const { email, value, data, errors, problem } = props;
  const type = email.type;

  const preview = useMemo(() => {
    try {
      return renderEmail({
        locale: data.previewLocale,
        dir: data.previewDir,
        subject: value.subject || email.builtIn.subject,
        body: value.body || email.builtIn.body,
        extraLines: email.extraLine && !(value.body || "").match(/\{(reason|message|terms)\b/) ? [email.extraLine] : [],
        footer: data.footer,
        vars: data.sample,
        storeName: data.storeName,
        logoUrl: data.logoUrl,
      });
    } catch {
      return null; // half-typed placeholder: keep the editor usable, show a hint instead
    }
  }, [value.subject, value.body, email, data]);

  const err = (part: "subject" | "body") => {
    const key = errors[`${part}_${type}`];
    return key ? t(key, { name: problem[`${part}_${type}`] ?? "" }) : undefined;
  };

  return (
    <s-section heading={t(`notifications.type.${type}`)}>
      <s-stack direction="block" gap="base">
        <s-paragraph color="subdued">{t(`notifications.type.${type}.help`)}</s-paragraph>
        <s-switch name={`enabled_${type}`} label={t("notifications.email.enabled")} checked={value.enabled}
          onChange={() => props.onChange({ enabled: !value.enabled })} />
        <s-text-field id={`subject_${type}`} name={`subject_${type}`} label={t("notifications.email.subject")} value={value.subject}
          error={err("subject")} onInput={(e) => props.onChange({ subject: val(e as unknown as Event) })} />
        <s-text-area id={`body_${type}`} name={`body_${type}`} label={t("notifications.email.body")} rows={10} value={value.body}
          details={t("notifications.email.bodyHelp")}
          error={err("body")} onInput={(e) => props.onChange({ body: val(e as unknown as Event) })} />
        <s-stack direction="block" gap="small-200">
          <s-text>{t("notifications.email.placeholders")}</s-text>
          <s-stack direction="inline" gap="small-200">
            {email.placeholders.map((p) => (
              <s-badge key={p} tone="neutral">
                <span dir="ltr">{`{${p}}`}</span>
              </s-badge>
            ))}
          </s-stack>
          <s-text color="subdued">{t("notifications.email.placeholdersHelp")}</s-text>
        </s-stack>
        <s-stack direction="block" gap="small-200">
          <s-heading>{t("notifications.preview.heading")}</s-heading>
          {preview ? (
            <>
              <s-text>{t("notifications.preview.subject", { subject: preview.subject })}</s-text>
              <iframe
                title={t("notifications.preview.frameTitle", { email: t(`notifications.type.${type}`) })}
                srcDoc={preview.html}
                sandbox=""
                style={{ width: "100%", minHeight: 360, border: "1px solid #d4d4d4", borderRadius: 8, background: "#ffffff" }}
              />
            </>
          ) : (
            <s-text color="subdued">{t("notifications.preview.invalid")}</s-text>
          )}
        </s-stack>
        <s-stack direction="inline" gap="small-200">
          <s-button type="button" onClick={props.onTest} disabled={props.sending}>{t("notifications.test.button")}</s-button>
          <s-button type="button" variant="tertiary"
            onClick={() => props.onChange({ subject: email.builtIn.subject, body: email.builtIn.body })}>
            {t("notifications.email.reset")}
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
