import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { createT } from "../lib/i18n";
import { proxyContext } from "../lib/intake.server";
import { readSettings } from "../lib/settings";
import { esc, page } from "../lib/hosted-page.server";
import { readStatusToken, statusView, type StatusView } from "../lib/status.server";
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

type T = (key: string, values?: Record<string, string | number | Date>) => string;

/** The page body; also used by tests. Every value is escaped. */
export function statusBody(v: StatusView, o: { t: T; locale: string; store: string; login: string }): string {
  const { t } = o;
  const date = (iso: string) => new Intl.DateTimeFormat(o.locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));
  const button = (href: string, text: string, primary = false) =>
    `<p><a class="${primary ? "btn btn-primary" : "btn"}" href="${esc(href)}" rel="noopener">${esc(text)}</a></p>`;
  const parts = [
    `<h1>${esc(t(`hosted.status.title.${v.status}`))}</h1>`,
    `<p>${esc(t("hosted.status.submitted", { company: v.company, date: date(v.submittedAt) }))}</p>`,
    `<p>${esc(t(`hosted.status.body.${v.status}`, { store: o.store }))}</p>`,
  ];
  if (v.status === "needs_info") {
    if (v.message) parts.push(`<div class="msg"><p class="msg-label">${esc(t("hosted.update.messageLabel", { store: o.store }))}</p>${esc(v.message)}</div>`);
    if (v.updateUrl) parts.push(button(v.updateUrl, t("hosted.status.update"), true));
  }
  if (v.status === "rejected" && v.reapplyFrom) parts.push(`<p>${esc(t("hosted.status.reapply", { date: date(v.reapplyFrom) }))}</p>`);
  if (v.status === "approved") {
    parts.push(button(o.login, t("hosted.status.signIn"), true));
    if (v.links.shopping) parts.push(button(v.links.shopping, t("hosted.status.shop")));
  }
  if (v.links.booking) parts.push(button(v.links.booking, t("hosted.status.book")));
  if (v.links.whatsapp) parts.push(button(v.links.whatsapp, t("hosted.status.whatsapp", { store: o.store })));
  return parts.join("\n");
}
