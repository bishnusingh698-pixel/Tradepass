// Free, link-only ways to send a ready-made message from the merchant's own apps (feature B6).
// Tradepass never sends anything itself: each link opens the merchant's mail app, webmail, WhatsApp,
// phone messages, Telegram or LINE with the text filled in. No API, no account, no cost.
// Client-safe (no server imports); unit-tested in tests/messaging.test.ts.

export type Channel = "mailto" | "gmail" | "outlook" | "whatsapp" | "sms" | "telegram" | "line";

export type ChannelLink = {
  channel: Channel;
  href: string;
  /** The message didn't fit in this app's link, so it opens without the text: copy and paste it. */
  withoutText: boolean;
};

/**
 * Practical URL limits. mailto and sms are handed to another app by the OS and the shortest common
 * limit is about 2,000 characters (older Outlook/Windows handlers); webmail composes are server URLs
 * that accept far more; wa.me, t.me and LINE share links are kept under 2,000 as well.
 */
export const LINK_LIMITS: Record<Channel, number> = { mailto: 2000, sms: 2000, whatsapp: 2000, telegram: 2000, line: 2000, gmail: 8000, outlook: 8000 };

const SIMPLE_ADDRESS = /^[^\s@<>()?&#,;]+@[^\s@<>()?&#,;]+\.[^\s@<>()?&#,;]+$/;
const enc = (s: string) => encodeURIComponent(s);
const crlf = (s: string) => s.replace(/\r?\n/g, "\r\n");

/** Phone digits for wa.me (E.164 without "+"), or null when the number isn't a full international one. */
export function waDigits(phone: string | null | undefined): string | null {
  const p = (phone ?? "").replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{6,14}$/.test(p) ? p.slice(1) : null;
}

function fit(channel: Channel, full: string, bare: string): ChannelLink {
  return full.length <= LINK_LIMITS[channel] ? { channel, href: full, withoutText: false } : { channel, href: bare, withoutText: true };
}

export type LinkInput = { to?: string | null; phone?: string | null; subject: string; body: string; link?: string | null };

export function mailtoHref(m: LinkInput): ChannelLink {
  const to = SIMPLE_ADDRESS.test((m.to ?? "").trim()) ? (m.to ?? "").trim() : "";
  const base = `mailto:${to}?subject=${enc(m.subject)}`;
  return fit("mailto", `${base}&body=${enc(crlf(m.body))}`, base);
}

/** Gmail's web compose (works in any browser, also when no mail app is set up). */
export function gmailHref(m: LinkInput): ChannelLink {
  const to = SIMPLE_ADDRESS.test((m.to ?? "").trim()) ? (m.to ?? "").trim() : "";
  const base = `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(to)}&su=${enc(m.subject)}`;
  return fit("gmail", `${base}&body=${enc(m.body)}`, base);
}

/** Outlook on the web (Microsoft 365 / Outlook.com accounts). */
export function outlookHref(m: LinkInput): ChannelLink {
  const to = SIMPLE_ADDRESS.test((m.to ?? "").trim()) ? (m.to ?? "").trim() : "";
  const base = `https://outlook.office.com/mail/deeplink/compose?to=${enc(to)}&subject=${enc(m.subject)}`;
  return fit("outlook", `${base}&body=${enc(m.body)}`, base);
}

/** wa.me with the applicant's number when it's a full international number, else WhatsApp's own contact picker. */
export function whatsappHref(m: LinkInput): ChannelLink {
  const d = waDigits(m.phone);
  const base = d ? `https://wa.me/${d}` : "https://wa.me/";
  return fit("whatsapp", `${base}?text=${enc(m.body)}`, base);
}

/**
 * The merchant's own phone app. "sms:<number>?&body=" is read by both iOS (which expects "&body")
 * and Android (which expects "?body"); without a number the app asks for one.
 */
export function smsHref(m: LinkInput): ChannelLink {
  const d = waDigits(m.phone);
  const base = `sms:${d ? `+${d}` : ""}`;
  return fit("sms", `${base}?&body=${enc(m.body)}`, base);
}

/** Telegram's share link needs a URL; the message's own link (status or update page) is used. */
export function telegramHref(m: LinkInput): ChannelLink | null {
  if (!m.link) return null;
  const base = `https://t.me/share/url?url=${enc(m.link)}`;
  return fit("telegram", `${base}&text=${enc(m.body.replace(m.link, "").trim())}`, base);
}

/** LINE's official share link (Japan, Thailand, Taiwan). */
export function lineHref(m: LinkInput): ChannelLink {
  return fit("line", `https://line.me/R/share?text=${enc(m.body)}`, `https://line.me/R/share?text=${enc(m.link ?? "")}`);
}

/** Every channel for the copy-message dialog, in display order. */
export function channelLinks(m: LinkInput): ChannelLink[] {
  return [mailtoHref(m), gmailHref(m), outlookHref(m), whatsappHref(m), smsHref(m), telegramHref(m), lineHref(m)].filter((x): x is ChannelLink => x !== null);
}

/**
 * A WhatsApp contact link the merchant (or the app owner) configured: https only, on wa.me or
 * api.whatsapp.com. Anything else is ignored, so a typo can never send applicants elsewhere.
 */
export function safeWhatsAppUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v || v.length > 300) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    return u.hostname === "wa.me" || u.hostname === "api.whatsapp.com" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Any https link the merchant gives for "Book an onboarding call" / "Start shopping" (or a store path). */
export function safeHttpsUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v || v.length > 500) return null;
  if (v.startsWith("/") && !v.startsWith("//") && !/[\s<>"]/.test(v)) return v;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}
