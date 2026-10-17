import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n/react";
import { isRtl } from "../../lib/i18n/locales";
import type { Settings } from "../../lib/settings";
import { SelectInput } from "../form-builder/wc";

// "Preview as": runs the real embed script (window.Tradepass.applyGating) on
// a small mock theme page inside sandboxed iframes, one per visitor type, with
// the merchant's unsaved texts and colours.

const scripts = import.meta.glob<string>("/extensions/tradepass-theme/assets/tradepass.js", { query: "?raw", import: "default" });

type Persona = "retail" | "customer" | "wholesale";
type Tier = { id: string; name: string; discountPct: number | null };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Same rule as the theme blocks (Liquid color_contrast): white text unless under 4.5:1, then black. */
function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const lin = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  return 1.05 / (lum + 0.05) < 4.5 ? "#000000" : "#ffffff";
}

function mockDoc(opts: {
  script: string;
  cfg: Record<string, unknown>;
  lang: string;
  labels: { product: string; collection: string; addToCart: string; quickAdd: string; price: string; tierPrice: string | null };
  colors: Settings["storefront"]["colors"];
}): string {
  const { labels, colors } = opts;
  const btn = colors.button ? `background:${colors.button};border-color:${colors.button};color:${readableOn(colors.button)};` : "";
  const txt = colors.text ? `color:${colors.text};` : "";
  const price = labels.tierPrice
    ? `<span style="text-decoration:line-through;color:#6d7175">${esc(labels.price)}</span> <strong>${esc(labels.tierPrice)}</strong>`
    : esc(labels.price);
  const safe = opts.script.replace(/<\/script/gi, "<\\/script");
  const cfg = JSON.stringify(opts.cfg).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="${esc(opts.lang)}" dir="${isRtl(opts.lang) ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1a1a1a;background:#fff}
main{padding:12px;display:grid;gap:12px}
.img{background:#eceef0;border-radius:8px;aspect-ratio:4/3}
.button{display:inline-block;padding:8px 14px;border-radius:6px;border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;text-decoration:none;font-size:13px;cursor:default}
.button--secondary{background:#fff;color:#1a1a1a}
.price{font-weight:600;margin:4px 0}
.card-wrapper{border:1px solid #e3e3e3;border-radius:8px;padding:8px}
.tp-gated-main .price,.tp-gated-main form[action*="/cart/add"],.tp-gated .price,.tp-gated .quick-add__submit{display:none!important}
.tp-gate{margin:8px 0;${txt}}.tp-gate__text{margin:0 0 8px}
.tp-actions{display:flex;flex-wrap:wrap;gap:8px}
.tp-btn{display:inline-block;padding:7px 12px;border-radius:6px;border:1px solid #1a1a1a;text-decoration:none;font-size:13px}
.tp-btn--primary{background:#1a1a1a;color:#fff;${btn}}
.tp-btn--secondary{background:#fff;color:#1a1a1a;${colors.button ? `border-color:${colors.button};color:${colors.button};` : ""}}
.tp-banner,.tp-hint{background:#f1f2f4;padding:8px 12px;border-radius:6px;${txt}}
.tp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.tp-banner__link{${colors.button ? `color:${colors.button};` : ""}font-weight:600}
</style></head><body>
<main id="MainContent">
<div class="shopify-section" id="shopify-section-template--1__main">
<div class="img"></div><h3 style="margin:8px 0 0">${esc(labels.product)}</h3><div class="price">${price}</div>
<form action="/cart/add" onsubmit="return false"><button type="submit" name="add" class="button product-form__submit">${esc(labels.addToCart)}</button></form>
</div>
<div><h4 style="margin:4px 0">${esc(labels.collection)}</h4>
<ul style="list-style:none;margin:0;padding:0"><li><div class="card-wrapper"><div class="img" style="aspect-ratio:2/1"></div>
<a href="/products/tradepass-preview" style="color:inherit">${esc(labels.product)}</a><div class="price">${price}</div>
<button type="button" class="button button--secondary quick-add__submit">${esc(labels.quickAdd)}</button></div></li></ul></div>
</main>
<script>${safe}</script>
<script>document.addEventListener("click",function(e){if(e.target.closest("a"))e.preventDefault();});
try{window.Tradepass&&window.Tradepass.applyGating(document,${cfg});}catch(e){}</script>
</body></html>`;
}

export function PreviewAs({
  storefront,
  texts,
  locale,
  tiers,
  currency,
}: {
  storefront: Settings["storefront"];
  /** Storefront strings for `locale` with the merchant's (unsaved) overrides applied. */
  texts: Record<string, string>;
  locale: string;
  tiers: Tier[];
  currency: string;
}) {
  const { t, locale: adminLocale } = useI18n();
  const [script, setScript] = useState<string | null>(null);
  const [missing, setMissing] = useState(Object.keys(scripts).length === 0);
  const [tierId, setTierId] = useState(tiers[0]?.id ?? "");

  useEffect(() => {
    const load = Object.values(scripts)[0];
    if (!load) return;
    load().then(setScript).catch(() => setMissing(true));
  }, []);

  const money = (n: number) => {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
    } catch {
      return new Intl.NumberFormat(adminLocale).format(n);
    }
  };
  const tier = tiers.find((x) => x.id === tierId);
  const base = 100;

  const docs = useMemo(() => {
    if (!script) return null;
    const gate = storefront.accessMode !== "show";
    const labels = {
      product: t("storefront.preview.product"),
      collection: t("storefront.preview.collection"),
      addToCart: t("storefront.preview.addToCart"),
      quickAdd: t("storefront.preview.quickAdd"),
      price: money(base),
    };
    const cfg = (b2b: boolean) => ({
      mode: storefront.accessMode,
      gate,
      scope: "all",
      handles: [],
      texts,
      overrides: {},
      applyUrl: storefront.applyUrl,
      loginUrl: storefront.loginUrl,
      banner: storefront.showApplyBanner,
      hint: storefront.showPriceHint,
      product: { gated: gate },
      b2b,
      preview: true,
    });
    const tierPrice = tier?.discountPct ? money(base * (1 - tier.discountPct / 100)) : null;
    return {
      retail: mockDoc({ script, cfg: cfg(false), lang: locale, labels: { ...labels, tierPrice: null }, colors: storefront.colors }),
      customer: mockDoc({ script, cfg: cfg(false), lang: locale, labels: { ...labels, tierPrice: null }, colors: storefront.colors }),
      wholesale: mockDoc({ script, cfg: cfg(true), lang: locale, labels: { ...labels, tierPrice }, colors: storefront.colors }),
    } satisfies Record<Persona, string>;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- money depends only on locale/currency
  }, [script, storefront, texts, locale, tier, currency, t]);

  // Rebuild the iframes at most a few times a second while the merchant types.
  const [shown, setShown] = useState(docs);
  useEffect(() => {
    const id = window.setTimeout(() => setShown(docs), 250);
    return () => window.clearTimeout(id);
  }, [docs]);

  if (missing) {
    return <s-banner tone="info" heading={t("storefront.preview.unavailableHeading")}>{t("storefront.preview.unavailableBody")}</s-banner>;
  }
  if (!shown) return <s-spinner accessibilityLabel={t("storefront.preview.loading")} />;

  const personas: { id: Persona; title: string; note: string }[] = [
    { id: "retail", title: t("storefront.preview.retail"), note: t("storefront.preview.retailNote") },
    { id: "customer", title: t("storefront.preview.customer"), note: t("storefront.preview.customerNote") },
    { id: "wholesale", title: t("storefront.preview.wholesale"), note: tier ? t("storefront.preview.wholesaleNote", { tier: tier.name }) : t("storefront.preview.wholesaleNoTier") },
  ];

  return (
    <s-stack direction="block" gap="base">
      {tiers.length > 0 && (
        <s-box maxInlineSize="320px">
          <SelectInput label={t("storefront.preview.tier")} value={tierId} options={tiers.map((x) => ({ value: x.id, label: x.name }))} onChange={setTierId} />
        </s-box>
      )}
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
        {personas.map((p) => (
          <s-stack key={p.id} direction="block" gap="small-200">
            <s-text type="strong">{p.title}</s-text>
            <s-text tone="neutral">{p.note}</s-text>
            <iframe
              title={t("storefront.preview.frameTitle", { visitor: p.title })}
              sandbox="allow-scripts"
              srcDoc={shown[p.id]}
              style={{ width: "100%", height: 560, border: "1px solid #e3e3e3", borderRadius: 8, background: "#fff" }}
            />
          </s-stack>
        ))}
      </s-grid>
      {storefront.accessMode === "wholesale_only" && <s-text tone="neutral">{t("storefront.preview.checkoutNote")}</s-text>}
    </s-stack>
  );
}
