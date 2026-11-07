import { createT } from "./i18n";
import type { LocalizedTexts } from "./settings";

// Ready-made messages the merchant sends to an applicant or buyer themselves
// (Tradepass doesn't send email, D-091): "more information needed", "not
// approved" and certificate renewal. Written in the recipient's language
// (falling back to the store's primary language, then English), with the
// merchant's own wording from Settings → Languages when they changed it.

export type MessageKind = "needs_info" | "rejected" | "approved" | "renewal_expiring" | "renewal_expired" | "renewal";

const KEYS: Record<MessageKind, { subject: string; body: string; extra?: { key: string; value: "message" | "reason" } }> = {
  needs_info: { subject: "message.needs_info.subject", body: "message.needs_info.body", extra: { key: "message.needs_info.messageLine", value: "message" } },
  rejected: { subject: "message.rejected.subject", body: "message.rejected.body", extra: { key: "message.rejected.reasonLine", value: "reason" } },
  // Approved: sent by the merchant when Shopify's own B2B welcome email isn't available or was turned off (D-092).
  approved: { subject: "message.approved.subject", body: "message.approved.body" },
  renewal_expiring: { subject: "message.renewal_expiring.subject", body: "message.renewal_expiring.body" },
  renewal_expired: { subject: "message.renewal_expired.subject", body: "message.renewal_expired.body" },
  renewal: { subject: "message.renewal.subject", body: "message.renewal.body" },
};

export type MessageVars = {
  company: string;
  firstName?: string | null;
  storeName: string;
  link?: string | null;
  message?: string | null;
  reason?: string | null;
  /** YYYY-MM-DD; formatted as a long date in the recipient's language. */
  expiryDate?: string | null;
  /** Buyer-facing tier name (approved). */
  tierName?: string | null;
  /** Store sign-in page (approved). */
  loginUrl?: string | null;
  /** The applicant's hosted status page (signed, expiring); added as its own line to application messages. */
  statusLink?: string | null;
};

export type ApplicantMessage = {
  subject: string;
  /** Plain text; a blank line separates paragraphs. */
  body: string;
  locale: string;
  dir: "ltr" | "rtl";
  /** Recipient address when known (may be empty). */
  to: string;
  /** mailto: link that opens the merchant's email app with everything filled in. */
  mailto: string;
  /** Recipient's phone (E.164 when the form collected it that way), for WhatsApp and text messages. */
  phone?: string;
  /** The message's own link (update or status page), for share links that need one (Telegram). */
  link?: string;
};

// Unicode isolates keep names and numbers readable inside right-to-left sentences.
const FSI = "⁨";
const PDI = "⁩";
const isUrl = (v: string) => /^https?:\/\/\S+$/i.test(v);

function formatDate(iso: string, locale: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(d);
}

/** Which renewal text fits a certificate: dated and still valid, already expired, or no date at all. */
export function renewalKind(expiresOn: string | null | undefined, today = new Date().toISOString().slice(0, 10)): MessageKind {
  if (!expiresOn) return "renewal";
  return expiresOn.slice(0, 10) < today ? "renewal_expired" : "renewal_expiring";
}

const SIMPLE_ADDRESS = /^[^\s@<>()?&#,;]+@[^\s@<>()?&#,;]+\.[^\s@<>()?&#,;]+$/;

/** mailto: with subject and body. Line breaks become CRLF as RFC 6068 asks; an unusual address is left for the merchant to fill in. */
export function mailtoLink(to: string, subject: string, body: string): string {
  const enc = (s: string) => encodeURIComponent(s.replace(/\r?\n/g, "\r\n"));
  const addr = SIMPLE_ADDRESS.test(to.trim()) ? to.trim() : "";
  return `mailto:${addr}?subject=${enc(subject)}&body=${enc(body)}`;
}

function build(kind: MessageKind, locale: string | null | undefined, opts: { primary?: string; overrides?: LocalizedTexts }, v: MessageVars, to: string, phone?: string): ApplicantMessage {
  const i18n = createT(locale, { primary: opts.primary, overrides: opts.overrides });
  const rtl = i18n.dir === "rtl";
  const iso = (s: string) => (rtl && s && !isUrl(s) ? `${FSI}${s}${PDI}` : s);
  const values: Record<string, string> = {
    company: iso(v.company),
    // A greeting never reads "Hello ,": fall back to the company name.
    first_name: iso(v.firstName?.trim() || v.company),
    store_name: iso(v.storeName),
    update_link: v.link ?? "",
    expiry_date: v.expiryDate ? formatDate(v.expiryDate, i18n.locale) : "",
    message: iso(v.message?.trim() ?? ""),
    reason: iso(v.reason?.trim() ?? ""),
    tier_name: iso(v.tierName?.trim() ?? ""),
    login_url: v.loginUrl ?? "",
  };
  const k = KEYS[kind];
  const subject = i18n.t(k.subject, values).replace(/\s+/g, " ").trim();
  const paragraphs = i18n.t(k.body, values).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const extra = k.extra && values[k.extra.value];
  if (extra && !paragraphs.some((p) => p.includes(extra))) paragraphs.push(i18n.t(k.extra!.key, values));
  if (v.statusLink && !kind.startsWith("renewal")) paragraphs.push(i18n.t("message.statusLine", { status_link: v.statusLink }));
  const body = paragraphs.join("\n\n");
  const link = v.link || v.statusLink || undefined;
  return { subject, body, locale: i18n.locale, dir: i18n.dir, to, mailto: mailtoLink(to, subject, body), ...(phone ? { phone } : {}), ...(link ? { link } : {}) };
}

/** Build the message. A broken merchant override never blocks the merchant: the built-in text is used instead. */
export function buildMessage(
  kind: MessageKind,
  locale: string | null | undefined,
  opts: { primary?: string; overrides?: LocalizedTexts },
  vars: MessageVars,
  to = "",
  phone?: string,
): ApplicantMessage {
  try {
    return build(kind, locale, opts, vars, to, phone);
  } catch {
    return build(kind, locale, { primary: opts.primary }, vars, to, phone);
  }
}
