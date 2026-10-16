import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import db from "../db.server";
import { adminContext } from "../lib/context.server";
import { gql } from "../lib/gql.server";
import {
  catalogBudget, createBlockReason, createTier, deleteTier, listB2bCatalogs, paymentTermsOptions, readDefaults,
  TierError, tierBuyerCount, updateTier, validateTierInput, type TierInput,
} from "../lib/tiers.server";
import { useI18n } from "../lib/i18n/react";
import { useLocaleHref } from "../components/useLocaleHref";

// Tier editor (spec §C). `/app/tiers/new` creates; `/app/tiers/<id>` edits.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const isNew = params.id === "new";
  const tier = isNew ? null : await db.tier.findFirst({ where: { id: params.id!, shop: ctx.shop } });
  if (!isNew && !tier) throw new Response("Not found", { status: 404 });
  const d = readDefaults(tier?.defaults);
  const direct = Boolean(ctx.shopRow?.directCatalogs);

  const [terms, locales, catalogs, budget, count, buyers, collections] = await Promise.all([
    paymentTermsOptions(ctx.admin),
    gql(ctx.admin, `#graphql query TierLocales { shopLocales(published: true) { locale primary } }`)
      .then((r) => (r.shopLocales as { locale: string; primary: boolean }[]))
      .catch(() => [] as { locale: string; primary: boolean }[]),
    isNew ? listB2bCatalogs(ctx.admin, direct).catch(() => []) : Promise.resolve([]),
    isNew ? catalogBudget(ctx.admin, ctx.shop) : Promise.resolve(null),
    db.tier.count({ where: { shop: ctx.shop } }),
    tier ? tierBuyerCount(ctx.shop, tier.id) : Promise.resolve(0),
    d.collectionIds.length
      ? gql(ctx.admin, `#graphql query TierCollections($ids: [ID!]!) { nodes(ids: $ids) { ... on Collection { id title } } }`, { ids: d.collectionIds })
          .then((r) => (r.nodes as ({ id: string; title: string } | null)[]).filter(Boolean) as { id: string; title: string }[])
          .catch(() => d.collectionIds.map((id) => ({ id, title: id })))
      : Promise.resolve([] as { id: string; title: string }[]),
  ]);
  const block = budget
    ? createBlockReason(ctx.plan, count, { b2bEnabled: Boolean(ctx.shopRow?.b2bEnabled), b2bMarketsEnabled: Boolean(ctx.shopRow?.b2bMarketsEnabled) }, budget)
    : null;

  return {
    isNew,
    tier: tier && {
      id: tier.id, name: tier.name, buyerNames: (tier.buyerNames ?? {}) as Record<string, string>, discountPct: tier.discountPct,
      mode: tier.mode, createdByUs: Boolean(d.created.market || d.created.catalog), syncState: tier.syncState,
    },
    defaults: d,
    terms: terms.map(({ id, name }) => ({ id, name })),
    locales: locales.map((l) => l.locale),
    catalogs,
    collections,
    budget,
    block,
    buyers,
    // Plus-only option, never shown to non-Plus stores (Built for Shopify 4.3.7).
    canDirect: direct && Boolean(ctx.shopRow?.isPlus),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const tctx = { admin: ctx.admin, shop: ctx.shop, actor: ctx.actor };
  const back = `/app/tiers?locale=${encodeURIComponent(ctx.i18n.locale)}`;
  try {
    if (intent === "delete") {
      await deleteTier(tctx, params.id!, { deleteShopifyObjects: form.get("deleteShopify") === "true" });
      return redirect(back);
    }
    if (intent === "save") {
      const input = JSON.parse(String(form.get("input"))) as TierInput;
      const fieldErrors = validateTierInput(input);
      if (Object.keys(fieldErrors).length) return { ok: false as const, fieldErrors, message: ctx.t("tiers.editor.fixErrors") };
      if (params.id === "new") {
        await createTier(tctx, ctx.plan, input);
        return redirect(back);
      }
      await updateTier(tctx, params.id!, input);
      return { ok: true as const, message: ctx.t("common.saved") };
    }
  } catch (e) {
    const code = e instanceof TierError ? e.code : "shopify";
    return { ok: false as const, message: ctx.t(`tiers.error.${code}`, { detail: (e as TierError).detail ?? "" }) };
  }
  return { ok: false as const, message: ctx.t("errors.generic") };
};

type Form = {
  name: string;
  buyerNames: Record<string, string>;
  pricing: "percent" | "existing";
  pct: string;
  catalogGid: string;
  products: "all" | "collections";
  collections: { id: string; title: string }[];
  paymentTermsTemplateId: string;
  checkoutToDraft: boolean;
  tax: "charge" | "exempt_on_file";
  direct: boolean;
};

export default function TierEditor() {
  const data = useLoaderData<typeof loader>();
  const { t } = useI18n();
  const href = useLocaleHref();
  const shopify = useAppBridge();
  const save = useFetcher<typeof action>();
  const del = useFetcher<typeof action>();

  const initial = useMemo<Form>(() => ({
    name: data.tier?.name ?? "",
    buyerNames: data.tier?.buyerNames ?? {},
    pricing: data.defaults.pricing,
    pct: data.tier?.discountPct != null ? String(data.tier.discountPct) : "20",
    catalogGid: "",
    products: data.defaults.products,
    collections: data.collections,
    paymentTermsTemplateId: data.defaults.paymentTermsTemplateId ?? "",
    checkoutToDraft: data.defaults.checkoutToDraft,
    tax: data.defaults.tax,
    direct: data.tier?.mode === "direct",
  }), [data]);
  const [f, setF] = useState<Form>(initial);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [deleteShopify, setDeleteShopify] = useState(false);
  // Reset the form when the loader returns new data (after save); adjusting state during render avoids an extra effect pass.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setF(initial);
  }

  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const toInput = (x: Form): TierInput => ({
    name: x.name,
    buyerNames: Object.fromEntries(Object.entries(x.buyerNames).filter(([, v]) => v.trim())),
    pricing: x.pricing === "percent" ? { kind: "percent", pct: Number(x.pct) } : { kind: "existing", catalogGid: x.catalogGid },
    products: x.products === "all" ? { kind: "all" } : { kind: "collections", ids: x.collections.map((c) => c.id) },
    paymentTermsTemplateId: x.paymentTermsTemplateId || null,
    checkoutToDraft: x.checkoutToDraft,
    tax: x.tax,
    direct: x.direct,
  });
  const clientErrors = validateTierInput(toInput(f));
  const serverErrors = (save.data && "fieldErrors" in save.data ? save.data.fieldErrors : {}) as Record<string, string>;
  const err = (k: keyof typeof clientErrors) => {
    const key = (touched[k] || submitted) ? clientErrors[k] ?? serverErrors[k] : undefined;
    return key ? t(key) : undefined;
  };
  const touch = (k: string) => setTouched((x) => ({ ...x, [k]: true }));

  useEffect(() => {
    if (save.state === "idle" && save.data?.message) shopify.toast.show(save.data.message, { isError: !save.data.ok });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save.state, save.data]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(clientErrors).length) return;
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set("input", JSON.stringify(toInput(f)));
    save.submit(fd, { method: "POST" });
  };

  const pickCollections = async () => {
    const picked = await shopify.resourcePicker({
      type: "collection", action: "select", multiple: true, selectionIds: f.collections.map((c) => ({ id: c.id })),
    });
    if (picked) set({ collections: picked.map((c) => ({ id: c.id, title: c.title })) });
  };

  const blocked = data.isNew && data.block;
  const heading = data.isNew ? t("tiers.editor.newHeading") : t("tiers.editor.editHeading", { name: data.tier!.name });

  return (
    <s-page heading={heading}>
      <s-link slot="breadcrumb-actions" href={href("/app/tiers")}>{t("tiers.title")}</s-link>
      {!data.isNew && (
        <s-button slot="secondary-actions" tone="critical" commandFor="delete-tier" command="--show">
          {t("tiers.delete.action")}
        </s-button>
      )}

      <form data-save-bar data-discard-confirmation onSubmit={onSubmit} onReset={() => { setF(initial); setTouched({}); setSubmitted(false); }}>
        <s-stack direction="block" gap="base">
          {blocked && (
            <s-banner tone="warning">
              <s-paragraph>{t(`tiers.block.${data.block}`, { used: data.budget?.used ?? 0, limit: data.budget?.limit ?? 0 })}</s-paragraph>
            </s-banner>
          )}
          {submitted && Object.keys(clientErrors).length > 0 && (
            <s-banner tone="critical" heading={t("tiers.editor.fixErrors")}>
              <s-unordered-list>
                {Object.values(clientErrors).map((k) => <s-list-item key={k}>{t(k!)}</s-list-item>)}
              </s-unordered-list>
            </s-banner>
          )}

          <s-section heading={t("tiers.editor.section.name")}>
            <s-stack direction="block" gap="base">
              <s-text-field
                label={t("tiers.editor.name")}
                details={t("tiers.editor.nameHelp")}
                required
                value={f.name}
                error={err("name")}
                onInput={(e) => set({ name: e.currentTarget.value })}
                onBlur={() => touch("name")}
              />
              {data.locales.length > 0 && (
                <s-stack direction="block" gap="small-200">
                  <s-text type="strong">{t("tiers.editor.buyerNames")}</s-text>
                  <s-text color="subdued">{t("tiers.editor.buyerNamesHelp")}</s-text>
                  <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
                    {data.locales.map((l) => (
                      <s-text-field
                        key={l}
                        label={localeName(l, t)}
                        value={f.buyerNames[l] ?? ""}
                        placeholder={f.name}
                        onInput={(e) => set({ buyerNames: { ...f.buyerNames, [l]: e.currentTarget.value } })}
                      />
                    ))}
                  </s-grid>
                </s-stack>
              )}
            </s-stack>
          </s-section>

          <s-section heading={t("tiers.editor.section.pricing")}>
            <s-stack direction="block" gap="base">
              {data.isNew ? (
                <s-select label={t("tiers.editor.pricing")} value={f.pricing} onChange={(e) => set({ pricing: e.currentTarget.value as Form["pricing"] })}>
                  <s-option value="percent">{t("tiers.editor.pricing.percent")}</s-option>
                  <s-option value="existing" disabled={data.catalogs.length === 0}>{t("tiers.editor.pricing.existing")}</s-option>
                </s-select>
              ) : (
                <s-text>{t(f.pricing === "percent" ? "tiers.editor.pricing.percent" : "tiers.editor.pricing.existing")}</s-text>
              )}
              {f.pricing === "percent" && (
                <s-number-field
                  label={t("tiers.editor.pct")}
                  details={t("tiers.editor.pctHelp")}
                  min={1}
                  max={90}
                  step={1}
                  suffix="%"
                  value={f.pct}
                  error={err("pct")}
                  onInput={(e) => set({ pct: e.currentTarget.value })}
                  onBlur={() => touch("pct")}
                />
              )}
              {f.pricing === "existing" && data.isNew && (
                <s-select
                  label={t("tiers.editor.catalog")}
                  details={t("tiers.editor.catalogHelp")}
                  value={f.catalogGid}
                  error={err("catalog")}
                  onChange={(e) => { touch("catalog"); set({ catalogGid: e.currentTarget.value }); }}
                >
                  <s-option value="">{t("tiers.editor.catalogChoose")}</s-option>
                  {data.catalogs.map((c) => <s-option key={c.id} value={c.id}>{c.title}</s-option>)}
                </s-select>
              )}
              {data.canDirect && data.isNew && (
                <s-checkbox
                  label={t("tiers.editor.direct")}
                  details={t("tiers.editor.directHelp")}
                  checked={f.direct}
                  onChange={(e) => set({ direct: e.currentTarget.checked })}
                />
              )}
            </s-stack>
          </s-section>

          {(f.pricing === "percent" || !data.isNew) && (
            <s-section heading={t("tiers.editor.section.products")}>
              <s-stack direction="block" gap="base">
                <s-select label={t("tiers.editor.products")} value={f.products} onChange={(e) => set({ products: e.currentTarget.value as Form["products"] })}>
                  <s-option value="all">{t("tiers.editor.products.all")}</s-option>
                  <s-option value="collections">{t("tiers.editor.products.collections")}</s-option>
                </s-select>
                {f.products === "collections" && (
                  <s-stack direction="block" gap="small-200">
                    <s-stack direction="inline" gap="small-200">
                      {f.collections.map((c) => (
                        <s-clickable-chip
                          key={c.id}
                          removable
                          accessibilityLabel={t("tiers.editor.removeCollection", { name: c.title })}
                          onRemove={() => set({ collections: f.collections.filter((x) => x.id !== c.id) })}
                        >
                          {c.title}
                        </s-clickable-chip>
                      ))}
                    </s-stack>
                    <s-button onClick={() => { touch("collections"); void pickCollections(); }}>{t("tiers.editor.chooseCollections")}</s-button>
                    {err("collections") && <s-text tone="critical">{err("collections")}</s-text>}
                    <s-text color="subdued">{t("tiers.editor.collectionsHelp")}</s-text>
                  </s-stack>
                )}
              </s-stack>
            </s-section>
          )}

          <s-section heading={t("tiers.editor.section.defaults")}>
            <s-stack direction="block" gap="base">
              <s-select label={t("tiers.editor.terms")} value={f.paymentTermsTemplateId} onChange={(e) => set({ paymentTermsTemplateId: e.currentTarget.value })}>
                <s-option value="">{t("tiers.terms.none")}</s-option>
                {data.terms.map((p) => <s-option key={p.id} value={p.id}>{p.name}</s-option>)}
              </s-select>
              <s-select label={t("tiers.editor.checkout")} value={f.checkoutToDraft ? "draft" : "pay"} onChange={(e) => set({ checkoutToDraft: e.currentTarget.value === "draft" })}>
                <s-option value="pay">{t("tiers.editor.checkout.pay")}</s-option>
                <s-option value="draft">{t("tiers.editor.checkout.draft")}</s-option>
              </s-select>
              <s-select label={t("tiers.editor.tax")} value={f.tax} onChange={(e) => set({ tax: e.currentTarget.value as Form["tax"] })}>
                <s-option value="charge">{t("tiers.editor.tax.charge")}</s-option>
                <s-option value="exempt_on_file">{t("tiers.editor.tax.exempt")}</s-option>
              </s-select>
              <s-paragraph>
                {t("tiers.editor.quantityRules")}{" "}
                <s-link href="https://help.shopify.com/manual/b2b/catalogs/quantity-pricing" target="_blank">{t("common.learnMore")}</s-link>
              </s-paragraph>
            </s-stack>
          </s-section>

          {data.isNew && (
            <s-stack direction="inline" justifyContent="end">
              <s-button variant="primary" type="submit" disabled={Boolean(blocked)} loading={save.state !== "idle"}>
                {t("tiers.editor.create")}
              </s-button>
            </s-stack>
          )}
        </s-stack>
      </form>

      {!data.isNew && (
        <s-modal id="delete-tier" heading={t("tiers.delete.heading", { name: data.tier!.name })}>
          {data.buyers > 0 ? (
            <s-paragraph>{t("tiers.delete.blocked", { count: data.buyers })}</s-paragraph>
          ) : (
            <s-stack direction="block" gap="base">
              <s-paragraph>{t("tiers.delete.body")}</s-paragraph>
              {data.tier!.createdByUs ? (
                <s-checkbox
                  label={t("tiers.delete.shopify")}
                  details={t("tiers.delete.shopifyHelp")}
                  checked={deleteShopify}
                  onChange={(e) => setDeleteShopify(e.currentTarget.checked)}
                />
              ) : (
                <s-paragraph>{t("tiers.delete.notOurs")}</s-paragraph>
              )}
              {del.data?.message && <s-text tone="critical">{del.data.message}</s-text>}
            </s-stack>
          )}
          {data.buyers === 0 && (
            <s-button
              slot="primary-action"
              variant="primary"
              tone="critical"
              loading={del.state !== "idle"}
              onClick={() => {
                const fd = new FormData();
                fd.set("intent", "delete");
                fd.set("deleteShopify", String(deleteShopify));
                del.submit(fd, { method: "POST" });
              }}
            >
              {t("tiers.delete.confirm")}
            </s-button>
          )}
          {data.buyers > 0 && (
            <s-button slot="primary-action" variant="primary" href={href(`/app/buyers?tier=${data.tier!.id}`)}>
              {t("tiers.delete.moveBuyers")}
            </s-button>
          )}
          <s-button slot="secondary-actions" commandFor="delete-tier" command="--hide">{t("common.cancel")}</s-button>
        </s-modal>
      )}
    </s-page>
  );
}

function localeName(tag: string, t: (k: string, v?: Record<string, string>) => string) {
  try {
    return t("tiers.editor.buyerNameFor", { language: new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? tag });
  } catch {
    return t("tiers.editor.buyerNameFor", { language: tag });
  }
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
