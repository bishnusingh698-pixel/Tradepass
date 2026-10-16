import type { LoaderFunctionArgs } from "react-router";
import formJs from "../../extensions/tradepass-theme/assets/tradepass-form.js?raw";
import formCss from "../../extensions/tradepass-theme/assets/tradepass-form.css?raw";
import countries from "../../extensions/tradepass-theme/assets/tradepass-countries.json?raw";
import { json, proxyContext } from "../lib/intake.server";

// The hosted "more info" page is served by us (not the theme), so it loads the
// same renderer, styles and country data from here instead of Shopify's CDN.
const FILES: Record<string, { body: string; type: string }> = {
  "form.js": { body: formJs, type: "text/javascript; charset=utf-8" },
  "form.css": { body: formCss, type: "text/css; charset=utf-8" },
  "countries.json": { body: countries, type: "application/json; charset=utf-8" },
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const ctx = await proxyContext(request);
  if (!ctx) return json({ ok: false, error: "unauthorized" }, 401);
  const f = FILES[params.file ?? ""];
  if (!f) return json({ ok: false, error: "not_found" }, 404);
  return new Response(f.body, {
    headers: { "Content-Type": f.type, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
};
