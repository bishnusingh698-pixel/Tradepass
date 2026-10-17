import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { verifyProxyRequest } from "../lib/proxy.server";
import { sha256 } from "../lib/crypto.server";
import { createT, type Translator } from "../lib/i18n";
import { matchLocale } from "../lib/i18n/locales";
import { readSettings } from "../lib/settings";
import { escapeHtml, fontStack } from "../lib/email/render";
import { applyRenewalUpload, checkRenewalToken, consumeRenewalToken, defaultAdminFor } from "../lib/certificates.server";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, uploadToShopifyFiles } from "../lib/uploads.server";

// Hosted certificate-renewal page, served through the app proxy at
// https://{shop}/apps/tradepass/renew/{token}?lang=xx. Plain server-rendered
// HTML (works without JavaScript, nothing to hydrate), translated, RTL-aware.
// The link is signed, expires, and works once: it's consumed only after the
// file is safely in the merchant's Shopify Files.

const RATE_LIMIT_PER_HOUR = 20;

type Page =
  | { kind: "form"; error?: "type" | "size" | "missing" | "upload" | "date" }
  | { kind: "done" }
  | { kind: "invalid" | "expired" | "used" | "rate" };

async function context(request: Request, token: string) {
  const url = new URL(request.url);
  const proxy = verifyProxyRequest(url, process.env.SHOPIFY_API_SECRET ?? "");
  if (!proxy) return null;
  const shopRow = await db.shop.findUnique({ where: { shop: proxy.shop }, select: { name: true, primaryLocale: true, settings: true, uninstalledAt: true } });
  if (!shopRow || shopRow.uninstalledAt) return null;
  const settings = readSettings(shopRow.settings);
  const accept = request.headers.get("accept-language")?.split(",")[0]?.split(";")[0];
  const lang = matchLocale(url.searchParams.get("lang")) ?? matchLocale(accept) ?? shopRow.primaryLocale;
  const i18n = createT(lang, { primary: shopRow.primaryLocale, overrides: settings.texts });
  return { shop: proxy.shop, storeName: shopRow.name ?? proxy.shop.replace(/\.myshopify\.com$/, ""), i18n, token };
}

/** Per-IP hourly limit for this public endpoint (RateHit, pruned hourly). */
async function rateLimited(request: Request, shop: string): Promise<boolean> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const key = `renew:${sha256(`${shop}|${ip}`).slice(0, 32)}`;
  const window = new Date().toISOString().slice(0, 13);
  const row = await db.rateHit.upsert({
    where: { key_window: { key, window } },
    create: { key, window, count: 1 },
    update: { count: { increment: 1 } },
  });
  return row.count > RATE_LIMIT_PER_HOUR;
}

function html(c: { storeName: string; i18n: Translator }, page: Page, status = 200): Response {
  const { t, locale, dir } = c.i18n;
  const store = escapeHtml(c.storeName);
  const e = (k: string, v?: Record<string, string>) => escapeHtml(t(k, v));
  let main: string;
  if (page.kind === "form") {
    const err = page.error ? `<p id="err" class="error" role="alert">${e(`renew.error.${page.error}`)}</p>` : "";
    // The error belongs to the expiry date for "date", to the file otherwise.
    const onFile = page.error && page.error !== "date";
    const onDate = page.error === "date";
    main = `<h1>${e("renew.form.heading")}</h1>
<p>${e("renew.form.intro", { store_name: c.storeName })}</p>
${err}
<form method="post" enctype="multipart/form-data" id="f" novalidate>
  <div class="field">
    <label for="file">${e("renew.form.file")}</label>
    <p class="hint" id="file-hint">${e("renew.form.fileHint")}</p>
    <input type="file" id="file" name="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required aria-describedby="file-hint${onFile ? " err" : ""}"${onFile ? ' aria-invalid="true"' : ""}>
  </div>
  <div class="field">
    <label for="expiresOn">${e("renew.form.expiry")}</label>
    <p class="hint" id="exp-hint">${e("renew.form.expiryHint")}</p>
    <input type="date" id="expiresOn" name="expiresOn" aria-describedby="exp-hint${onDate ? " err" : ""}"${onDate ? ' aria-invalid="true"' : ""}>
  </div>
  <button type="submit" id="submit">${e("renew.form.submit")}</button>
  <p class="hint" id="status" role="status" aria-live="polite"></p>
</form>
<script>
document.getElementById("f").addEventListener("submit", function () {
  var b = document.getElementById("submit");
  b.disabled = true; b.textContent = ${JSON.stringify(t("renew.form.sending"))};
  document.getElementById("status").textContent = ${JSON.stringify(t("renew.form.sendingHint"))};
});
</script>`;
  } else if (page.kind === "done") {
    main = `<h1>${e("renew.done.heading")}</h1><p role="status">${e("renew.done.body", { store_name: c.storeName })}</p>`;
  } else {
    main = `<h1>${e(`renew.${page.kind}.heading`)}</h1><p>${e(`renew.${page.kind}.body`, { store_name: c.storeName })}</p>`;
  }
  const body = `<!doctype html>
<html lang="${escapeHtml(locale)}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${e("renew.title", { store_name: c.storeName })}</title>
<style>
  body { margin: 0; background: #ffffff; color: #1f1f1f; font-family: ${fontStack(locale)}; line-height: 1.5; }
  main { max-width: 560px; margin: 0 auto; padding: 32px 16px; }
  .store { font-weight: 700; margin: 0 0 24px; }
  h1 { font-size: 1.5rem; margin: 0 0 12px; }
  .field { margin: 0 0 20px; }
  label { display: block; font-weight: 600; margin-block-end: 4px; }
  .hint { color: #4a4a4a; margin: 0 0 6px; font-size: .95rem; }
  input[type=file], input[type=date] { font: inherit; padding: 8px; border: 1px solid #757575; border-radius: 6px; max-width: 100%; }
  button { font: inherit; font-weight: 600; background: #1f1f1f; color: #ffffff; border: 0; border-radius: 8px; padding: 12px 20px; min-height: 44px; cursor: pointer; }
  button[disabled] { opacity: .7; cursor: progress; }
  :focus-visible { outline: 3px solid #005bd3; outline-offset: 2px; }
  .error { color: #b3261e; font-weight: 600; border-inline-start: 4px solid #b3261e; padding-inline-start: 12px; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
</style>
</head>
<body>
<main>
<p class="store">${store}</p>
${main}
</main>
</body>
</html>`;
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" },
  });
}

const forbidden = () => new Response("Forbidden", { status: 403 });

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const c = await context(request, params.token ?? "");
  if (!c) return forbidden();
  const check = await checkRenewalToken(c.shop, c.token);
  return check.ok ? html(c, { kind: "form" }) : html(c, { kind: check.reason }, 410);
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const c = await context(request, params.token ?? "");
  if (!c) return forbidden();
  if (await rateLimited(request, c.shop)) return html(c, { kind: "rate" }, 429);
  const check = await checkRenewalToken(c.shop, c.token);
  if (!check.ok) return html(c, { kind: check.reason }, 410);

  const form = await request.formData();
  const file = form.get("file");
  const expiresOn = String(form.get("expiresOn") ?? "").trim();
  if (!(file instanceof File) || file.size === 0) return html(c, { kind: "form", error: "missing" }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return html(c, { kind: "form", error: "size" }, 400);
  if (!(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(file.type)) return html(c, { kind: "form", error: "type" }, 400);
  if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return html(c, { kind: "form", error: "date" }, 400);

  let fileGid: string;
  try {
    const admin = await defaultAdminFor(c.shop);
    ({ fileGid } = await uploadToShopifyFiles(admin, { filename: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }));
  } catch {
    // Type sniffing rejects files whose content doesn't match their extension, too.
    return html(c, { kind: "form", error: "upload" }, 400);
  }
  // Single use: a second tab submitting at the same moment gets "already used".
  if (!(await consumeRenewalToken(c.shop, check.tokenHash))) return html(c, { kind: "used" }, 410);
  await applyRenewalUpload(c.shop, check.certificateId, fileGid, expiresOn || null);
  return html(c, { kind: "done" });
};
