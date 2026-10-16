import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useBlocker, useFetcher, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { adminContext } from "../lib/context.server";
import db from "../db.server";
import { gql } from "../lib/gql.server";
import { getShopLocales } from "../lib/forms.server";
import { syncStorefrontConfig } from "../lib/storefront-sync.server";
import { logActivity } from "../lib/activity.server";
import { can } from "../lib/plans";
import type { AccessMode, ScopeType, Settings } from "../lib/settings";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";
import { CheckboxInput, Modal, RadioGroup, SelectInput, TextInput, flag, useWc } from "../components/form-builder/wc";
import { languageOptions, primaryLocale } from "../components/form-builder/languages";
import { loadStorefrontTexts } from "../components/form-builder/storefront-assets";
import { embedEditorUrl, useThemeExtension } from "../components/storefront/extension";
import { PreviewAs } from "../components/storefront/PreviewAs";
import {
  STOREFRONT_TEXTS, STOREFRONT_TEXT_KEYS, TEXT_MAX, describeChange, parseStorefrontInput, type StorefrontError,
} from "../components/storefront/model";
import { saveStorefrontSettings } from "../components/storefront/save.server";

type Picked = { id: string; title: string };

async function scopeTitles(admin: Parameters<typeof gql>[0], ids: string[]): Promise<Picked[]> {
  if (!ids.length) return [];
  try {
    const data = await gql<{ nodes: ({ id: string; title?: string } | null)[] }>(
      admin,
      `#graphql
      query TradepassScopeTitles($ids: [ID!]!) { nodes(ids: $ids) { id ... on Collection { title } ... on Product { title } } }`,
      { ids: ids.slice(0, 250) },
    );
    const byId = new Map(data.nodes.filter(Boolean).map((n) => [n!.id, n!.title ?? n!.id]));
    return ids.map((id) => ({ id, title: byId.get(id) ?? id }));
  } catch {
    return ids.map((id) => ({ id, title: id }));
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, admin, settings, plan, shopRow } = await adminContext(request);
  const [shopLocales, tiers, picked] = await Promise.all([
    getShopLocales(admin),
    db.tier.findMany({ where: { shop }, select: { id: true, name: true, discountPct: true }, orderBy: { position: "asc" } }),
    scopeTitles(admin, settings.storefront.scope.ids),
  ]);
  // Only the storefront keys this page edits, per language.
  const overrides: Record<string, Record<string, string>> = {};
  for (const [loc, map] of Object.entries(settings.texts ?? {})) {
    for (const key of STOREFRONT_TEXT_KEYS) if (map?.[key]) (overrides[loc] ??= {})[key] = map[key];
  }
  return {
    storefront: settings.storefront,
    overrides,
    shopLocales,
    tiers,
    picked,
    canWholesaleOnly: can(plan, "wholesale_only"),
    b2bEnabled: Boolean(shopRow?.b2bEnabled),
    currency: shopRow?.currency ?? "USD",
    shop,
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin, settings, plan, actor } = await adminContext(request);
  const parsed = parseStorefrontInput(await request.json(), settings, plan);
  if (!parsed.ok) return { ok: false as const, errors: parsed.errors };
  const { before, after } = await saveStorefrontSettings(shop, parsed.value);
  // syncStorefrontConfig also turns the checkout lock on/off (ensureCheckoutLock).
  let syncFailed = false;
  try {
    await syncStorefrontConfig(admin, shop);
  } catch {
    syncFailed = true;
  }
  await logActivity({
    shop,
    actor,
    action: "storefront.saved",
    result: syncFailed ? "failed" : "ok",
    detail: { ...describeChange(before.storefront, after.storefront), ...(syncFailed ? { step: "sync" } : {}) },
  });
  return { ok: true as const, syncFailed };
};

type Draft = { storefront: Settings["storefront"]; edits: Record<string, Record<string, string>> };
type Raw = { tags: string; hidePages: string; exempt: string };

/** Only show the texts visitors can actually see in the chosen mode. */
function textApplies(key: string, mode: AccessMode): boolean {
  if (key.startsWith("wall.") || key === "checkout.message") return mode === "wholesale_only";
  if (key.startsWith("gate.")) return mode !== "show";
  if (key.startsWith("banner.")) return mode === "show";
  return true;
}

const splitList = (s: string) => [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))];
const WAIT_FOR_TOUCH = new Set(["url", "scopeEmpty"]);

function ColorInput({ id, label, value, onChange, error, details }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; details?: string }) {
  const ref = useWc({ value }, { change: (e) => onChange(String((e.currentTarget as unknown as { value?: string }).value ?? "")) });
  return <s-color-field ref={ref} id={id} label={label} value={value} placeholder="#000000" details={details} error={error || undefined} />;
}

export default function Storefront() {
  const data = useLoaderData<typeof loader>();
  const { t, locale: adminLocale } = useI18n();
  const href = useLocaleHref();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const ext = useThemeExtension();

  const savedKey = JSON.stringify([data.storefront, data.overrides, data.picked]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- savedKey captures the loader values used
  const initial = useMemo<Draft>(() => ({ storefront: data.storefront, edits: {} }), [savedKey]);
  const rawFrom = (sf: Settings["storefront"]): Raw => ({ tags: sf.scope.tags.join(", "), hidePages: sf.hidePages.join(", "), exempt: sf.exemptCustomerTags.join(", ") });
  const [draft, setDraft] = useState<Draft>(initial);
  const [raw, setRaw] = useState<Raw>(() => rawFrom(data.storefront));
  const [picked, setPicked] = useState<Picked[]>(data.picked);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [confirm, setConfirm] = useState<AccessMode | null>(null);
  const [lang, setLang] = useState(() => primaryLocale(data.shopLocales));
  const [builtIn, setBuiltIn] = useState<Record<string, string>>({});

  // Fresh loader data (after a save) becomes the new starting point.
  const [loaded, setLoaded] = useState(initial);
  if (loaded !== initial) {
    setLoaded(initial);
    setDraft(initial);
    setRaw(rawFrom(initial.storefront));
    setPicked(data.picked);
    setTouched(new Set());
    setShowAll(false);
  }
  const serverErrors: StorefrontError[] = showAll && fetcher.state === "idle" && fetcher.data && !fetcher.data.ok ? fetcher.data.errors : [];

  useEffect(() => {
    let live = true;
    loadStorefrontTexts(lang).then((x) => live && setBuiltIn(x)).catch(() => live && setBuiltIn({}));
    return () => {
      live = false;
    };
  }, [lang]);

  // The comma-separated inputs keep their raw text while typing; arrays are derived from them.
  const storefront = useMemo<Settings["storefront"]>(
    () => ({
      ...draft.storefront,
      scope: { ...draft.storefront.scope, tags: splitList(raw.tags) },
      hidePages: splitList(raw.hidePages),
      exemptCustomerTags: splitList(raw.exempt),
    }),
    [draft.storefront, raw],
  );
  const sf = storefront;
  const setSf = (patch: Partial<Settings["storefront"]>) => setDraft((d) => ({ ...d, storefront: { ...d.storefront, ...patch } }));
  const dirty =
    JSON.stringify(storefront) !== JSON.stringify(data.storefront) ||
    Object.entries(draft.edits).some(([loc, map]) => Object.entries(map).some(([k, v]) => v !== (data.overrides[loc]?.[k] ?? "")));

  const payload = { storefront, texts: draft.edits };
  const clientErrors = useMemo(() => {
    const res = parseStorefrontInput(payload, { storefront: data.storefront } as Settings, data.canWholesaleOnly ? "starter" : "free");
    return res.ok ? [] : res.errors;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- payload is derived from these
  }, [storefront, draft.edits, data.storefront, data.canWholesaleOnly]);
  const visible = [
    ...clientErrors.filter((e) => showAll || !WAIT_FOR_TOUCH.has(e.code) || touched.has(e.anchor)),
    ...serverErrors.filter((s) => !clientErrors.some((e) => e.anchor === s.anchor)),
  ];
  const errText = (e: StorefrontError) => t(`storefront.error.${e.code}`, { ...(e.values ?? {}), plan: "Starter" });
  const errAt = (anchor: string) => {
    const e = visible.find((x) => x.anchor === anchor);
    return e ? errText(e) : undefined;
  };
  const touch = (anchor: string) => setTouched((s) => new Set(s).add(anchor));

  const busy = fetcher.state !== "idle";
  const onSave = () => {
    setShowAll(true);
    if (clientErrors.length) {
      document.getElementById("sf-error-summary")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    fetcher.submit(payload, { method: "post", encType: "application/json" });
  };
  const onDiscard = () => {
    setDraft(initial);
    setRaw(rawFrom(initial.storefront));
    setPicked(data.picked);
    setTouched(new Set());
    setShowAll(false);
  };

  const toasted = useRef<unknown>(null);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || toasted.current === fetcher.data) return;
    toasted.current = fetcher.data;
    if (fetcher.data.ok) shopify.toast.show(fetcher.data.syncFailed ? t("storefront.saved.syncLater") : t("common.saved"));
  }, [fetcher.state, fetcher.data, shopify, t]);

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

  const chooseMode = (mode: AccessMode) => {
    if (mode === sf.accessMode) return;
    // Both directions of wholesale-only change who can buy, so both are confirmed.
    if (mode === "wholesale_only" || sf.accessMode === "wholesale_only") setConfirm(mode);
    else setSf({ accessMode: mode });
  };

  const pick = async (type: "collection" | "product") => {
    const res = await shopify.resourcePicker({ type, multiple: true, action: "select", selectionIds: sf.scope.ids.map((id) => ({ id })) });
    if (!res) return;
    const items = res.map((r) => ({ id: r.id, title: (r as { title?: string }).title ?? r.id }));
    setPicked(items);
    setSf({ scope: { ...sf.scope, ids: items.map((x) => x.id) } });
    touch("sf-scope");
  };

  const textValue = (key: string) => draft.edits[lang]?.[key] ?? data.overrides[lang]?.[key] ?? "";
  const setText = (key: string, value: string) =>
    setDraft((d) => ({ ...d, edits: { ...d.edits, [lang]: { ...(d.edits[lang] ?? {}), [key]: value } } }));
  const textTexts = useMemo(() => {
    const merged: Record<string, string> = { ...builtIn };
    if (!merged["checkout.message"]) merged["checkout.message"] = t("storefront.texts.checkoutDefault");
    for (const key of STOREFRONT_TEXT_KEYS) {
      const v = draft.edits[lang]?.[key] ?? data.overrides[lang]?.[key];
      if (v) merged[key] = v;
    }
    return merged;
  }, [builtIn, draft.edits, data.overrides, lang, t]);

  const languages = useMemo(
    () => languageOptions(data.shopLocales, adminLocale, (n) => t("form.lang.primary", { language: n }), (n) => t("form.lang.published", { language: n })),
    [data.shopLocales, adminLocale, t],
  );
  const gating = sf.accessMode !== "show";
  const scopeType = sf.scope.type;

  return (
    <s-page heading={t("storefront.title")}>
      <SaveBar id="storefront-save-bar" open={dirty || busy} discardConfirmation>
        <button variant="primary" onClick={onSave} {...flag("loading", busy)} {...flag("disabled", busy)}>{t("common.save")}</button>
        <button onClick={onDiscard} {...flag("disabled", busy)}>{t("common.discard")}</button>
      </SaveBar>

      {showAll && visible.length > 0 && (
        <div id="sf-error-summary" tabIndex={-1}>
          <s-banner tone="critical" heading={t("storefront.errors.heading", { count: visible.length })}>
            <s-unordered-list>
              {visible.map((e, i) => (
                <s-list-item key={`${e.anchor}-${i}`}>
                  <s-link
                    href={`#${e.anchor}`}
                    onClick={(ev) => {
                      ev.preventDefault();
                      const el = document.getElementById(e.anchor);
                      el?.scrollIntoView({ behavior: "smooth", block: "center" });
                      el?.focus?.();
                    }}
                  >
                    {errText(e)}
                  </s-link>
                </s-list-item>
              ))}
            </s-unordered-list>
          </s-banner>
        </div>
      )}

      <s-section heading={t("storefront.embed.heading")}>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small" alignItems="center">
            {ext.status === "loading" ? (
              <s-spinner accessibilityLabel={t("storefront.embed.checking")} size="base" />
            ) : (
              <s-badge tone={ext.status === "active" ? "success" : "warning"} icon={ext.status === "active" ? "check" : "alert-triangle"}>
                {t(`storefront.embed.status.${ext.status}`)}
              </s-badge>
            )}
          </s-stack>
          <s-paragraph>{ext.status === "active" ? t("storefront.embed.activeBody") : t("storefront.embed.inactiveBody")}</s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button href={embedEditorUrl(data.shop, data.apiKey, ext.embedHandle)} target="_blank" {...(ext.status !== "active" ? { variant: "primary" as const } : {})}>
              {t("storefront.embed.open")}
            </s-button>
            <s-button variant="tertiary" icon="refresh" onClick={() => void ext.check()} {...flag("loading", ext.status === "loading")}>
              {t("storefront.embed.checkAgain")}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading={t("storefront.mode.heading")}>
        <s-stack direction="block" gap="base">
          <RadioGroup
            id="sf-mode"
            label={t("storefront.mode.label")}
            value={sf.accessMode}
            onChange={(v) => chooseMode(v as AccessMode)}
            choices={[
              { value: "show", label: t("storefront.mode.show"), details: t("storefront.mode.showDetails") },
              { value: "hide", label: t("storefront.mode.hide"), details: t("storefront.mode.hideDetails") },
              {
                value: "wholesale_only",
                label: t("storefront.mode.wholesaleOnly"),
                details: data.canWholesaleOnly || sf.accessMode === "wholesale_only" ? t("storefront.mode.wholesaleOnlyDetails") : t("common.availableOn", { plan: "Starter" }),
                disabled: !data.canWholesaleOnly && data.storefront.accessMode !== "wholesale_only",
              },
            ]}
          />
          {errAt("sf-mode") && <s-text tone="critical">{errAt("sf-mode")}</s-text>}
          <s-banner tone="info">{t("storefront.mode.visualNote")}</s-banner>
          {sf.accessMode === "wholesale_only" && !data.b2bEnabled && <s-banner tone="warning">{t("storefront.mode.noB2b")}</s-banner>}

          {gating && (
            <s-stack direction="block" gap="base" id="sf-scope">
              <SelectInput
                label={t("storefront.scope.label")}
                value={scopeType}
                options={(["all", "collections", "products", "tags"] as ScopeType[]).map((x) => ({ value: x, label: t(`storefront.scope.${x}`) }))}
                onChange={(v) => {
                  setSf({ scope: { type: v as ScopeType, ids: [], tags: sf.scope.tags } });
                  setPicked([]);
                }}
              />
              {(scopeType === "collections" || scopeType === "products") && (
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" gap="small">
                    <s-button icon={scopeType === "collections" ? "collection" : "product"} onClick={() => void pick(scopeType === "collections" ? "collection" : "product")}>
                      {scopeType === "collections" ? t("storefront.scope.pickCollections") : t("storefront.scope.pickProducts")}
                    </s-button>
                  </s-stack>
                  {picked.length === 0 ? (
                    <s-text tone="neutral">{t("storefront.scope.noneChosen")}</s-text>
                  ) : (
                    <s-unordered-list>
                      {picked.map((p) => (
                        <s-list-item key={p.id}>
                          <s-stack direction="inline" gap="small-200" alignItems="center">
                            <s-text>{p.title}</s-text>
                            <s-button
                              variant="tertiary"
                              icon="x"
                              accessibilityLabel={t("storefront.scope.remove", { title: p.title })}
                              onClick={() => {
                                setPicked(picked.filter((x) => x.id !== p.id));
                                setSf({ scope: { ...sf.scope, ids: sf.scope.ids.filter((id) => id !== p.id) } });
                              }}
                            />
                          </s-stack>
                        </s-list-item>
                      ))}
                    </s-unordered-list>
                  )}
                  {errAt("sf-scope") && <s-text tone="critical">{errAt("sf-scope")}</s-text>}
                </s-stack>
              )}
              {scopeType === "tags" && (
                <TextInput
                  id="sf-scope-tags"
                  label={t("storefront.scope.tagsLabel")}
                  details={t("storefront.scope.tagsHelp")}
                  value={raw.tags}
                  error={errAt("sf-scope-tags")}
                  onBlur={() => touch("sf-scope-tags")}
                  onChange={(tags) => setRaw((r) => ({ ...r, tags }))}
                />
              )}
            </s-stack>
          )}

          {sf.accessMode === "wholesale_only" && (
            <s-stack direction="block" gap="base">
              <TextInput
                id="sf-hide-pages"
                label={t("storefront.wall.pagesLabel")}
                details={t("storefront.wall.pagesHelp")}
                value={raw.hidePages}
                error={errAt("sf-hide-pages")}
                onBlur={() => touch("sf-hide-pages")}
                onChange={(hidePages) => setRaw((r) => ({ ...r, hidePages }))}
              />
              <TextInput
                id="sf-exempt-tags"
                label={t("storefront.wall.exemptLabel")}
                details={t("storefront.wall.exemptHelp")}
                value={raw.exempt}
                error={errAt("sf-exempt-tags")}
                onBlur={() => touch("sf-exempt-tags")}
                onChange={(exempt) => setRaw((r) => ({ ...r, exempt }))}
              />
            </s-stack>
          )}
          <s-paragraph tone="neutral">{t("storefront.mode.buyersNote")}</s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading={t("storefront.links.heading")}>
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
            <TextInput id="sf-apply-url" kind="url" label={t("storefront.links.apply")} details={t("storefront.links.applyHelp")} value={sf.applyUrl} error={errAt("sf-apply-url")} onBlur={() => touch("sf-apply-url")} onChange={(applyUrl) => setSf({ applyUrl })} />
            <TextInput id="sf-login-url" kind="url" label={t("storefront.links.login")} details={t("storefront.links.loginHelp")} value={sf.loginUrl} error={errAt("sf-login-url")} onBlur={() => touch("sf-login-url")} onChange={(loginUrl) => setSf({ loginUrl })} />
          </s-grid>
          {sf.accessMode === "show" && (
            <CheckboxInput id="sf-banner" label={t("storefront.links.banner")} details={t("storefront.links.bannerHelp")} checked={sf.showApplyBanner} onChange={(showApplyBanner) => setSf({ showApplyBanner })} />
          )}
          <CheckboxInput id="sf-hint" label={t("storefront.links.hint")} details={t("storefront.links.hintHelp")} checked={sf.showPriceHint} onChange={(showPriceHint) => setSf({ showPriceHint })} />
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
            <s-stack direction="block" gap="small-200">
              <ColorInput id="sf-color-button" label={t("storefront.colors.button")} details={t("storefront.colors.inherit")} value={sf.colors.button ?? ""} error={errAt("sf-color-button")} onChange={(v) => setSf({ colors: { ...sf.colors, button: v || null } })} />
              {sf.colors.button && <s-button variant="tertiary" onClick={() => setSf({ colors: { ...sf.colors, button: null } })}>{t("storefront.colors.useTheme")}</s-button>}
            </s-stack>
            <s-stack direction="block" gap="small-200">
              <ColorInput id="sf-color-text" label={t("storefront.colors.text")} details={t("storefront.colors.inherit")} value={sf.colors.text ?? ""} error={errAt("sf-color-text")} onChange={(v) => setSf({ colors: { ...sf.colors, text: v || null } })} />
              {sf.colors.text && <s-button variant="tertiary" onClick={() => setSf({ colors: { ...sf.colors, text: null } })}>{t("storefront.colors.useTheme")}</s-button>}
            </s-stack>
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading={t("storefront.texts.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("storefront.texts.body")}</s-paragraph>
          <s-box maxInlineSize="360px">
            <SelectInput id="sf-language" label={t("form.lang.label")} value={lang} options={languages.map((l) => ({ value: l.value, label: l.label }))} onChange={setLang} />
          </s-box>
          {STOREFRONT_TEXTS.filter((x) => textApplies(x.key, sf.accessMode)).map((x) => {
              const anchor = `sf-text-${x.key}`;
              const value = textValue(x.key);
              return (
                <s-stack key={x.key} direction="block" gap="small-200">
                  <TextInput
                    id={anchor}
                    label={t(`storefront.texts.${x.key.replace(".", "_")}`)}
                    value={value}
                    placeholder={x.key === "checkout.message" ? builtIn[x.key] ?? t("storefront.texts.checkoutDefault") : builtIn[x.key] ?? ""}
                    rows={"multiline" in x ? 2 : undefined}
                    maxLength={TEXT_MAX}
                    error={errAt(anchor)}
                    onChange={(v) => setText(x.key, v)}
                  />
                  {value && (
                    <s-stack direction="inline">
                      <s-button variant="tertiary" icon="reset" onClick={() => setText(x.key, "")}>{t("storefront.texts.reset")}</s-button>
                    </s-stack>
                  )}
                </s-stack>
              );
            })}
        </s-stack>
      </s-section>

      <s-section heading={t("storefront.preview.heading")}>
        <PreviewAs storefront={sf} texts={textTexts} locale={lang} tiers={data.tiers} currency={data.currency} />
      </s-section>

      <s-section heading={t("storefront.advanced.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("storefront.advanced.body")}</s-paragraph>
          <TextInput id="sf-sel-price" label={t("storefront.advanced.price")} placeholder=".price" value={sf.customSelectors.price} error={errAt("sf-sel-price")} onChange={(price) => setSf({ customSelectors: { ...sf.customSelectors, price } })} />
          <TextInput id="sf-sel-cart" label={t("storefront.advanced.addToCart")} placeholder=".product-form__submit" value={sf.customSelectors.addToCart} error={errAt("sf-sel-cart")} onChange={(addToCart) => setSf({ customSelectors: { ...sf.customSelectors, addToCart } })} />
          <TextInput id="sf-sel-card" label={t("storefront.advanced.productCard")} placeholder=".card-wrapper" value={sf.customSelectors.productCard} error={errAt("sf-sel-card")} onChange={(productCard) => setSf({ customSelectors: { ...sf.customSelectors, productCard } })} />
          <s-link href={href("/app/help")}>{t("storefront.advanced.help")}</s-link>
        </s-stack>
      </s-section>

      <s-section heading={t("storefront.uninstall.heading")}>
        <s-paragraph>{t("storefront.uninstall.body")}</s-paragraph>
      </s-section>

      <Modal
        id="sf-confirm-modal"
        heading={confirm === "wholesale_only" ? t("storefront.confirm.onHeading") : t("storefront.confirm.offHeading")}
        open={confirm !== null}
        onClose={() => setConfirm(null)}
      >
        <s-paragraph>{confirm === "wholesale_only" ? t("storefront.confirm.onBody") : t("storefront.confirm.offBody")}</s-paragraph>
        <s-paragraph tone="neutral">{t("storefront.confirm.saveNote")}</s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          {...(confirm !== "wholesale_only" ? { tone: "critical" as const } : {})}
          onClick={() => {
            if (confirm) setSf({ accessMode: confirm });
            setConfirm(null);
          }}
        >
          {confirm === "wholesale_only" ? t("storefront.confirm.onAction") : t("storefront.confirm.offAction")}
        </s-button>
        <s-button slot="secondary-actions" onClick={() => setConfirm(null)}>{t("common.cancel")}</s-button>
      </Modal>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
