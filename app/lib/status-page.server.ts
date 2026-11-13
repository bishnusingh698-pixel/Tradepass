// Body of the hosted application status page (route: proxy.status.$token.tsx).
import { esc } from "./hosted-page.server";
import type { StatusView } from "./status.server";

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
