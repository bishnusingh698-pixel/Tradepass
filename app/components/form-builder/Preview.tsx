import { useEffect, useMemo, useRef, useState } from "react";
import type { FormDefinition } from "../../lib/form-defaults";
import { useI18n } from "../../lib/i18n/react";
import { isRtl } from "../../lib/i18n/locales";
import { loadCountries, loadRenderer, loadStorefrontTexts, rendererAvailable } from "./storefront-assets";

// The preview runs the storefront renderer inside a sandboxed srcdoc iframe
// (scripts only, opaque origin), so theme-like CSS and the renderer's own code
// can't touch the admin page. Updates go in by postMessage instead of
// rebuilding the iframe on every keystroke.

const MESSAGE = "tradepass-preview";

function srcdoc(script: string, style: string, dir: string, lang: string): string {
  // `</script` inside the renderer would end the tag early.
  const safe = script.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:16px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1a1a1a;background:#fff}${style}</style></head>
<body><div id="root"></div><script>${safe}</script><script>
(function(){
  var root=document.getElementById("root");
  function size(){parent.postMessage({type:"${MESSAGE}:height",height:document.documentElement.scrollHeight},"*");}
  window.addEventListener("message",function(e){
    if(e.source!==parent||!e.data||e.data.type!=="${MESSAGE}:render")return;
    var d=e.data.payload;
    document.documentElement.lang=d.locale;document.documentElement.dir=d.dir;
    root.innerHTML="";
    try{window.TradepassForm.render(root,d);}catch(err){root.textContent="";parent.postMessage({type:"${MESSAGE}:error"},"*");}
    size();
  });
  if(window.ResizeObserver)new ResizeObserver(size).observe(document.body);
  parent.postMessage({type:"${MESSAGE}:ready"},"*");
})();
</script></body></html>`;
}

export function FormPreview({
  definition,
  locale,
  overrides,
  languages,
}: {
  definition: FormDefinition;
  locale: string;
  /** Merchant overrides of storefront strings for this language (Settings → Languages). */
  overrides: Record<string, string>;
  /** Store languages for the "Preferred language" question. */
  languages: { code: string; name: string }[];
}) {
  const { t } = useI18n();
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [doc, setDoc] = useState<string | null>(null);
  const [failed, setFailed] = useState(!rendererAvailable);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(640);
  const [texts, setTexts] = useState<Record<string, string> | null>(null);
  const [countries, setCountries] = useState<Record<string, unknown> | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const dir = isRtl(locale) ? "rtl" : "ltr";

  useEffect(() => {
    let live = true;
    loadCountries().then((c) => live && setCountries(c));
    loadRenderer()
      .then((r) => {
        if (!live) return;
        if (!r) setFailed(true);
        else setDoc(srcdoc(r.script, r.style, "ltr", "en"));
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    loadStorefrontTexts(locale)
      .then((x) => live && setTexts(x))
      .catch(() => live && setTexts({}));
    return () => {
      live = false;
    };
  }, [locale]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || typeof e.data?.type !== "string") return;
      if (e.data.type === `${MESSAGE}:ready`) setReady(true);
      if (e.data.type === `${MESSAGE}:height`) setHeight(Math.min(Math.max(Number(e.data.height) || 0, 200), 4000));
      if (e.data.type === `${MESSAGE}:error`) setFailed(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const payload = useMemo(
    () => (texts ? { definition, texts: { ...texts, ...overrides }, locale, dir, preview: true, languages, ...(countries ? { countries } : {}) } : null),
    [definition, texts, overrides, locale, dir, languages, countries],
  );

  useEffect(() => {
    if (!ready || !payload) return;
    // Debounce so typing in the editor doesn't re-render the form on every key.
    const id = window.setTimeout(() => {
      frame.current?.contentWindow?.postMessage({ type: `${MESSAGE}:render`, payload }, "*");
    }, 150);
    return () => window.clearTimeout(id);
  }, [ready, payload]);

  return (
    <s-section heading={t("form.preview.heading")}>
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="small-200">
          <s-button icon="desktop" {...(device === "desktop" ? { variant: "primary" as const } : {})} onClick={() => setDevice("desktop")}>
            {t("form.preview.desktop")}
          </s-button>
          <s-button icon="mobile" {...(device === "mobile" ? { variant: "primary" as const } : {})} onClick={() => setDevice("mobile")}>
            {t("form.preview.mobile")}
          </s-button>
        </s-stack>
        {failed ? (
          <s-banner tone="info" heading={t("form.preview.unavailableHeading")}>
            {t("form.preview.unavailableBody")}
          </s-banner>
        ) : doc ? (
          <div style={{ display: "flex", justifyContent: "center", border: "1px solid var(--s-color-border, #e3e3e3)", borderRadius: 12, overflow: "hidden", background: "#f6f6f7" }}>
            <iframe
              ref={frame}
              title={t("form.preview.frameTitle")}
              sandbox="allow-scripts"
              srcDoc={doc}
              style={{ width: device === "mobile" ? 375 : "100%", maxWidth: "100%", height, border: 0, background: "#fff", display: "block" }}
            />
          </div>
        ) : (
          <s-stack direction="block" gap="small" alignItems="center">
            <s-spinner accessibilityLabel={t("form.preview.loading")} />
          </s-stack>
        )}
        <s-text tone="neutral">{t("form.preview.note")}</s-text>
      </s-stack>
    </s-section>
  );
}
