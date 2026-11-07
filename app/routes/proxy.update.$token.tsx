import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { sha256, verifyToken } from "../lib/crypto.server";
import { createT } from "../lib/i18n";
import { applyUpdate, json, proxyContext, readJsonBody, requestedDefinition } from "../lib/intake.server";
import { readDefinition } from "../lib/forms.server";
import { readSettings } from "../lib/settings";
import { clientIp, hashKey, hit, LIMITS } from "../lib/spam.server";
import { storefrontTexts } from "../lib/storefront-sync.server";
import { esc, page, scriptJson } from "../lib/hosted-page.server";
import { safeWhatsAppUrl } from "../lib/message-links";

// Hosted "more info" page: /apps/tradepass/update/<token> (app proxy →
// /proxy/update/<token>). The token is signed, expiring and single use
// (TokenUse). The page shows only the fields the merchant asked for, in the
// applicant's language, mirrored for RTL. It is a standalone HTML page (not
// application/liquid) so nothing an applicant typed is ever run as Liquid.

type LinkState = "ok" | "invalid" | "expired" | "used";


async function inspect(shop: string, raw: string) {
  const check = verifyToken(raw);
  if (!check.ok) return { state: (check.reason === "expired" ? "expired" : "invalid") as LinkState, app: null };
  const tok = check.token;
  if (tok.shop !== shop || tok.purpose !== "more_info") return { state: "invalid" as LinkState, app: null };
  const use = await db.tokenUse.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!use || use.shop !== shop || use.usedAt) return { state: "used" as LinkState, app: null };
  if (use.expiresAt < new Date()) return { state: "expired" as LinkState, app: null };
  const app = await db.application.findFirst({ where: { shop, id: tok.subject } });
  // Already decided (approved, rejected, withdrawn) or no longer waiting for info: nothing to update.
  if (!app || app.status !== "needs_info") return { state: "used" as LinkState, app: null };
  return { state: "ok" as LinkState, app };
}

async function shopInfo(shop: string) {
  const row = await db.shop.findUnique({ where: { shop }, select: { name: true, primaryLocale: true, settings: true } });
  return { name: row?.name ?? shop.replace(/\.myshopify\.com$/, ""), primary: row?.primaryLocale ?? "en", settings: readSettings(row?.settings ?? {}) };
}


export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const ctx = await proxyContext(request);
  if (!ctx) return new Response("Not found", { status: 404 });
  const raw = params.token ?? "";
  const { state, app } = await inspect(ctx.shop, raw);
  const info = await shopInfo(ctx.shop);
  const i18n = createT(app?.locale ?? info.primary, { primary: info.primary, overrides: info.settings.texts });
  const { t } = i18n;
  const store = info.name;

  if (state !== "ok" || !app) {
    const key = state === "expired" ? "expired" : state === "used" ? "used" : "invalid";
    const title = t(`hosted.link.${key}Title`);
    return page({
      lang: i18n.locale, dir: i18n.dir, title, status: state === "invalid" ? 404 : 410,
      body: `<h1>${esc(title)}</h1><p>${esc(t(`hosted.link.${key}Body`, { store }))}</p>`,
    });
  }

  const requested = (app.requested ?? {}) as { fields?: string[]; message?: string };
  const form = await db.form.findFirst({ where: { shop: ctx.shop, ...(app.formId ? { id: app.formId } : { isDefault: true }) } })
    ?? (await db.form.findFirst({ where: { shop: ctx.shop }, orderBy: { createdAt: "asc" } }));
  const def = requestedDefinition(readDefinition(form?.definition), requested.fields ?? []);
  def.success = { texts: {}, redirectUrl: null };

  const texts = storefrontTexts(i18n.locale, info.settings.texts[i18n.locale]);
  texts["form.submit"] = t("hosted.update.submit");
  texts["form.success.heading"] = t("hosted.update.doneHeading");
  texts["form.success.body"] = t("hosted.update.doneBody", { store });
  texts["form.required_note"] = texts["form.required_note"] ?? "";
  const answers = (app.answers ?? {}) as Record<string, unknown>;
  const billing = answers.billingAddress as { countryCode?: string } | undefined;
  const prefix = ctx.pathPrefix || "/apps/tradepass";
  const self = `${prefix}/update/${encodeURIComponent(raw)}`;
  const boot = {
    definition: def,
    texts,
    locale: i18n.locale,
    dir: i18n.dir,
    endpoint: prefix,
    submitUrl: self,
    formId: `update-${app.id}`,
    country: billing?.countryCode ?? app.countryCode ?? "",
    countriesUrl: `${prefix}/assets/countries.json`,
    countryRule: info.settings.applications.countries.mode === "all" ? null : info.settings.applications.countries,
  };
  const title = t("hosted.update.title");
  const wa = safeWhatsAppUrl(info.settings.contact.whatsappUrl);
  const message = requested.message?.trim()
    ? `<div class="msg"><p class="msg-label">${esc(t("hosted.update.messageLabel", { store }))}</p>${esc(requested.message.trim())}</div>`
    : "";
  return page({
    lang: i18n.locale,
    dir: i18n.dir,
    title,
    head: `<link rel="stylesheet" href="${esc(prefix)}/assets/form.css">`,
    body: `<h1>${esc(title)}</h1>
<p>${esc(t("hosted.update.intro", { store }))}</p>
${message}
${wa ? `<p><a class="btn" href="${esc(wa)}" target="_blank" rel="noopener">${esc(t("hosted.status.whatsapp", { store }))}</a></p>` : ""}
<div data-tradepass-form><div class="tpf-mount"><noscript><p>${esc(t("hosted.noscript"))}</p></noscript></div>
<script type="application/json">${scriptJson(boot)}</script></div>
<script src="${esc(prefix)}/assets/form.js" defer></script>`,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const ctx = await proxyContext(request);
  if (!ctx) return json({ ok: false, error: "unauthorized" }, 401);
  if (!(await hit(`update:${hashKey("ip", clientIp(request))}`, LIMITS.updatePerIp)).allowed) return json({ ok: false, error: "rate_limited" }, 429);
  const raw = params.token ?? "";
  const { state, app } = await inspect(ctx.shop, raw);
  if (state !== "ok" || !app) return json({ ok: false, error: `link_${state}` }, state === "invalid" ? 404 : 410);
  const body = await readJsonBody(request);
  if (!body) return json({ ok: false, error: "bad_request" }, 400);

  // Claim the token first so two tabs can't both apply; release it if validation fails.
  const tokenHash = sha256(raw);
  const claimed = await db.tokenUse.updateMany({
    where: { tokenHash, shop: ctx.shop, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return json({ ok: false, error: "link_used" }, 410);
  try {
    const res = await applyUpdate({ shop: ctx.shop, ip: clientIp(request) }, app.id, body);
    if (!res.ok) {
      await db.tokenUse.updateMany({ where: { tokenHash, shop: ctx.shop }, data: { usedAt: null } });
      if ("errors" in res) return json({ ok: false, errors: res.errors }, 400);
      // Decided meanwhile: the link has nothing left to update.
      return res.error === "closed" ? json({ ok: false, error: "link_used" }, 410) : json({ ok: false, error: res.error }, 404);
    }
    return json({ ok: true, status: "received" });
  } catch (e) {
    await db.tokenUse.updateMany({ where: { tokenHash, shop: ctx.shop }, data: { usedAt: null } });
    throw e;
  }
};
