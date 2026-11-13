import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { createT } from "../lib/i18n";
import { proxyContext } from "../lib/intake.server";
import { readSettings } from "../lib/settings";
import { esc, page } from "../lib/hosted-page.server";
import { readStatusToken, statusView } from "../lib/status.server";
import { statusBody } from "../lib/status-page.server";
import { storefrontUrl } from "../lib/shop.server";
import { clientIp, hashKey, hit, LIMITS } from "../lib/spam.server";

// Hosted application status page: /apps/tradepass/status/<token> (app proxy → /proxy/status/<token>).
// The token is signed and expires after 90 days; it is read-only (nothing to use up). It shows the
// status in the applicant's language, the merchant's "more info" message with a fresh secure update
// link, the re-apply date after a rejection, and the merchant's optional links (B5, B7, B10, B11).

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const ctx = await proxyContext(request);
  if (!ctx) return new Response("Not found", { status: 404 });
  const shopRow = await db.shop.findUnique({ where: { shop: ctx.shop }, select: { shop: true, name: true, domainUrl: true, primaryLocale: true, settings: true } });
  const settings = readSettings(shopRow?.settings ?? {});
  const store = shopRow?.name || ctx.shop.replace(/\.myshopify\.com$/, "");
  const primary = shopRow?.primaryLocale ?? "en";
  if (!(await hit(`status:${hashKey("ip", clientIp(request))}`, LIMITS.updatePerIp * 3)).allowed) {
    const { t, locale, dir } = createT(primary, { primary, overrides: settings.texts });
    return page({ lang: locale, dir, title: t("hosted.status.busyTitle"), status: 429, body: `<h1>${esc(t("hosted.status.busyTitle"))}</h1>` });
  }
  const tok = readStatusToken(ctx.shop, params.token ?? "");
  const view = tok.ok ? await statusView(ctx.shop, tok.applicationId) : null;
  const i18n = createT(view?.locale ?? new URL(request.url).searchParams.get("lang") ?? primary, { primary, overrides: settings.texts });
  const { t } = i18n;
  if (!view) {
    const key = !tok.ok && tok.reason === "expired" ? "expired" : "invalid";
    const title = t(`hosted.link.${key}Title`);
    return page({ lang: i18n.locale, dir: i18n.dir, title, status: key === "expired" ? 410 : 404, body: `<h1>${esc(title)}</h1><p>${esc(t(key === "expired" ? "hosted.status.expiredBody" : "hosted.link.invalidBody", { store }))}</p>` });
  }
  const login = storefrontUrl(shopRow, settings.storefront.loginUrl || "/account/login", ctx.shop);
  return page({ lang: i18n.locale, dir: i18n.dir, title: t(`hosted.status.title.${view.status}`), body: statusBody(view, { t, locale: i18n.locale, store, login }) });
};

