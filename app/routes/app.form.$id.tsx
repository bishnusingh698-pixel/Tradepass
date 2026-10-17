import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useBlocker, useFetcher, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { adminContext } from "../lib/context.server";
import db from "../db.server";
import { deleteForm, getForm, getShopLocales, saveForm, setDefaultForm, type FormError } from "../lib/forms.server";
import { syncStorefrontConfig } from "../lib/storefront-sync.server";
import { logActivity } from "../lib/activity.server";
import { updateSettings } from "../lib/settings.server";
import type { FormDefinition } from "../lib/form-defaults";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";
import { FormBuilder, useErrorText } from "../components/form-builder/Builder";
import { FormExtras } from "../components/form-builder/Extras";
import { FormPreview } from "../components/form-builder/Preview";
import { AddToPage } from "../components/form-builder/AddToPage";
import { LIMITS, validateDefinition } from "../components/form-builder/model";
import { languageOptions, primaryLocale } from "../components/form-builder/languages";
import { loadStorefrontTexts } from "../components/form-builder/storefront-assets";
import { Modal, SelectInput, TextInput, flag } from "../components/form-builder/wc";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop, admin, settings } = await adminContext(request);
  const form = await getForm(shop, params.id ?? "");
  if (!form) throw new Response("Not found", { status: 404 });
  const [tiers, formCount, shopLocales] = await Promise.all([
    db.tier.findMany({ where: { shop }, select: { id: true, name: true }, orderBy: { position: "asc" } }),
    db.form.count({ where: { shop } }),
    getShopLocales(admin),
  ]);
  return {
    form,
    tiers,
    formCount,
    shopLocales,
    textOverrides: settings.texts,
    shop,
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

type ActionResult =
  | { ok: true; intent: "save"; syncFailed: boolean }
  | { ok: true; intent: "default" }
  | { ok: false; intent: string; errors?: FormError[] };

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { shop, admin, actor, redirect } = await adminContext(request);
  const id = params.id ?? "";
  if (request.headers.get("content-type")?.includes("application/json")) {
    const body = (await request.json()) as { name?: unknown; suggestedTierId?: unknown; definition?: unknown };
    const res = await saveForm(shop, id, {
      name: typeof body.name === "string" ? body.name : "",
      suggestedTierId: typeof body.suggestedTierId === "string" && body.suggestedTierId ? body.suggestedTierId : null,
      definition: body.definition,
    });
    if (!res.ok) return { ok: false, intent: "save", errors: res.errors } satisfies ActionResult;
    // The storefront reads the form from metafields; a failed sync is retried by the hourly job.
    let syncFailed = false;
    try {
      await syncStorefrontConfig(admin, shop);
    } catch {
      syncFailed = true;
    }
    await updateSettings(shop, { onboarding: { formReviewed: true } });
    await logActivity({ shop, actor, action: "form.saved", subject: id, result: syncFailed ? "failed" : "ok", detail: syncFailed ? { step: "sync" } : undefined });
    return { ok: true, intent: "save", syncFailed } satisfies ActionResult;
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "delete") {
    if (!(await deleteForm(shop, id))) return { ok: false, intent } satisfies ActionResult;
    await logActivity({ shop, actor, action: "form.deleted", subject: id });
    await syncStorefrontConfig(admin, shop).catch(() => undefined);
    const loc = new URL(request.url).searchParams.get("locale");
    return redirect(`/app/form${loc ? `?${new URLSearchParams({ locale: loc })}` : ""}`);
  }
  if (intent === "default") {
    if (!(await setDefaultForm(shop, id))) return { ok: false, intent } satisfies ActionResult;
    await logActivity({ shop, actor, action: "form.defaultChanged", subject: id });
    await syncStorefrontConfig(admin, shop).catch(() => undefined);
    return { ok: true, intent } satisfies ActionResult;
  }
  return { ok: false, intent } satisfies ActionResult;
};

type Draft = { name: string; suggestedTierId: string; definition: FormDefinition };

// Errors for empty required inputs wait for a blur or a save attempt; the rest
// come from a deliberate choice (state, condition) and show right away.
const WAIT_FOR_TOUCH = new Set(["labelRequired", "nameRequired", "spamIncomplete", "optionsRequired"]);

export default function FormEditor() {
  const data = useLoaderData<typeof loader>();
  const { t, locale: adminLocale } = useI18n();
  const href = useLocaleHref();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const save = useFetcher<ActionResult>();
  const other = useFetcher<ActionResult>();

  // Only real content changes reset the editor (not e.g. "make default"), so unsaved edits survive revalidation.
  const formKey = JSON.stringify([data.form.id, data.form.name, data.form.suggestedTierId, data.form.definition]);
  const initial = useMemo<Draft>(
    () => ({ name: data.form.name, suggestedTierId: data.form.suggestedTierId ?? "", definition: data.form.definition }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- formKey captures the fields used
    [formKey],
  );
  const [loaded, setLoaded] = useState<Draft>(initial);
  const [draft, setDraft] = useState<Draft>(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  // New loader data (after a save, or another form) becomes the new baseline.
  if (loaded !== initial) {
    setLoaded(initial);
    setDraft(initial);
    setTouched(new Set());
    setShowAll(false);
  }
  const baseline = initial;
  const serverErrors = useMemo<FormError[]>(
    () => (showAll && save.state === "idle" && save.data && !save.data.ok ? (save.data.errors ?? []) : []),
    [showAll, save.state, save.data],
  );
  const [lang, setLang] = useState(() => primaryLocale(data.shopLocales));
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let live = true;
    loadStorefrontTexts(lang).then((x) => live && setDefaults(x)).catch(() => live && setDefaults({}));
    return () => {
      live = false;
    };
  }, [lang]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  const allErrors = useMemo(() => {
    const errs = validateDefinition(draft.definition);
    if (!draft.name.trim() || draft.name.length > LIMITS.formName) errs.push({ code: "nameRequired", anchor: "fb-form-name" });
    return errs;
  }, [draft]);
  const visible = useMemo(
    () => [
      ...allErrors.filter((e) => showAll || !WAIT_FOR_TOUCH.has(e.code) || touched.has(e.anchor)),
      ...serverErrors.filter((s) => !allErrors.some((e) => e.anchor === s.anchor && e.code === s.code)),
    ],
    [allErrors, serverErrors, showAll, touched],
  );
  const errorText = useErrorText(defaults, lang, draft.definition);
  const errAt = (anchor: string) => {
    const e = visible.find((x) => x.anchor === anchor);
    return e ? errorText(e) : undefined;
  };
  const touch = useCallback((anchor: string) => setTouched((s) => (s.has(anchor) ? s : new Set(s).add(anchor))), []);

  const onSave = () => {
    setShowAll(true);
    if (allErrors.length) {
      document.getElementById("fb-error-summary")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    save.submit(
      { name: draft.name, suggestedTierId: draft.suggestedTierId || null, definition: draft.definition },
      { method: "post", encType: "application/json" },
    );
  };
  const onDiscard = () => {
    setDraft(baseline);
    setTouched(new Set());
    setShowAll(false);
  };

  // Toast once per completed save (fetcher.data changes identity per submission).
  const toasted = useRef<unknown>(null);
  useEffect(() => {
    if (save.state !== "idle" || !save.data || toasted.current === save.data) return;
    toasted.current = save.data;
    if (save.data.ok && save.data.intent === "save") shopify.toast.show(save.data.syncFailed ? t("form.saved.syncLater") : t("common.saved"));
  }, [save.state, save.data, shopify, t]);

  useEffect(() => {
    if (other.state === "idle" && other.data?.ok && other.data.intent === "default") shopify.toast.show(t("form.settings.defaultSet"));
  }, [other.state, other.data, shopify, t]);

  // Block in-app navigation while unsaved; App Bridge asks the merchant to save or discard.
  const leaving = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const to = blocker.location;
    blocker.reset();
    void shopify.saveBar.leaveConfirmation().then(() => {
      leaving.current = true;
      navigate(to.pathname + to.search);
    });
  }, [blocker, navigate, shopify]);

  const languages = useMemo(
    () =>
      languageOptions(
        data.shopLocales,
        adminLocale,
        (name) => t("form.lang.primary", { language: name }),
        (name) => t("form.lang.published", { language: name }),
      ),
    [data.shopLocales, adminLocale, t],
  );
  const previewOverrides = useMemo(() => data.textOverrides[lang] ?? {}, [data.textOverrides, lang]);
  // Published store languages, named in the applicant's language, for "Preferred language".
  const previewLanguages = useMemo(() => {
    const codes = data.shopLocales.filter((l) => l.published).map((l) => l.locale);
    const names = (() => {
      try {
        return new Intl.DisplayNames([lang], { type: "language" });
      } catch {
        return null;
      }
    })();
    return (codes.length ? codes : [lang]).map((code) => ({ code, name: names?.of(code) ?? code }));
  }, [data.shopLocales, lang]);
  const setDefinition = useCallback((definition: FormDefinition) => setDraft((d) => ({ ...d, definition })), []);
  const busy = save.state !== "idle";

  return (
    <s-page heading={draft.name || data.form.name}>
      <s-link slot="breadcrumb-actions" href={href("/app/form")}>{t("nav.form")}</s-link>
      {!data.form.isDefault && (
        <>
          <s-button slot="secondary-actions" onClick={() => other.submit({ intent: "default" }, { method: "post" })}>
            {t("form.settings.makeDefault")}
          </s-button>
          <s-button slot="secondary-actions" tone="critical" onClick={() => setConfirmDelete(true)}>
            {t("form.settings.delete")}
          </s-button>
        </>
      )}

      <SaveBar id="form-save-bar" open={dirty || busy} discardConfirmation>
        <button variant="primary" onClick={onSave} {...flag("loading", busy)} {...flag("disabled", busy)}>
          {t("common.save")}
        </button>
        <button onClick={onDiscard} {...flag("disabled", busy)}>{t("common.discard")}</button>
      </SaveBar>

      {showAll && visible.length > 0 && (
        <div id="fb-error-summary" tabIndex={-1}>
          <s-banner tone="critical" heading={t("form.errors.heading", { count: visible.length })}>
            <s-unordered-list>
              {visible.map((e, i) => (
                <s-list-item key={`${e.anchor}-${e.code}-${i}`}>
                  <s-link
                    href={`#${e.anchor}`}
                    onClick={(ev) => {
                      ev.preventDefault();
                      const el = document.getElementById(e.anchor);
                      el?.scrollIntoView({ behavior: "smooth", block: "center" });
                      (el as HTMLElement | null)?.focus?.();
                    }}
                  >
                    {errorText(e)}
                  </s-link>
                </s-list-item>
              ))}
            </s-unordered-list>
          </s-banner>
        </div>
      )}

      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
          <TextInput
            id="fb-form-name"
            label={t("form.settings.name")}
            value={draft.name}
            maxLength={LIMITS.formName}
            details={t("form.settings.nameHelp")}
            error={errAt("fb-form-name")}
            onBlur={() => touch("fb-form-name")}
            onChange={(name) => setDraft((d) => ({ ...d, name }))}
          />
          <SelectInput
            id="fb-suggested-tier"
            label={t("form.settings.tier")}
            value={draft.suggestedTierId}
            details={data.tiers.length ? t("form.settings.tierHelp") : t("form.settings.noTiers")}
            disabled={data.tiers.length === 0}
            error={errAt("fb-suggested-tier")}
            options={[{ value: "", label: t("form.settings.tierNone") }, ...data.tiers.map((x) => ({ value: x.id, label: x.name }))]}
            onChange={(suggestedTierId) => setDraft((d) => ({ ...d, suggestedTierId }))}
          />
          <SelectInput
            id="fb-language"
            label={t("form.lang.label")}
            value={lang}
            details={t("form.lang.help")}
            options={languages.map((l) => ({ value: l.value, label: l.label }))}
            onChange={setLang}
          />
        </s-grid>
      </s-section>

      <s-query-container>
        <s-grid gridTemplateColumns="@container (inline-size > 900px) 3fr 2fr, 1fr" gap="base">
          <s-stack direction="block" gap="base">
            <FormBuilder definition={draft.definition} onChange={setDefinition} locale={lang} defaults={defaults} errors={visible} onTouch={touch} />
            <FormExtras definition={draft.definition} onChange={setDefinition} locale={lang} defaults={defaults} errAt={errAt} onTouch={touch} />
          </s-stack>
          <div style={{ position: "sticky", top: 16, alignSelf: "start" }}>
            <FormPreview definition={draft.definition} locale={lang} overrides={previewOverrides} languages={previewLanguages} />
          </div>
        </s-grid>
      </s-query-container>

      <AddToPage shop={data.shop} apiKey={data.apiKey} />

      <Modal id="form-delete-modal" heading={t("form.settings.deleteHeading", { name: data.form.name })} open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <s-paragraph>{t("form.settings.deleteBody", { name: data.form.name })}</s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          {...flag("loading", other.state !== "idle")}
          onClick={() => {
            leaving.current = true;
            other.submit({ intent: "delete" }, { method: "post" });
          }}
        >
          {t("form.settings.deleteConfirm")}
        </s-button>
        <s-button slot="secondary-actions" onClick={() => setConfirmDelete(false)}>
          {t("common.cancel")}
        </s-button>
      </Modal>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
