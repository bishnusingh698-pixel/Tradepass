import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { catalogs } from "../i18n/catalog";
import { isRtl, matchLocale, SOURCE_LOCALE } from "../i18n/locales";
import type { LocalizedTexts } from "../settings";
import { renderEmail, type EmailVars, type RenderedEmail } from "./render";
import { allowedPlaceholders, bodyKey, isMerchantType, subjectKey, type TemplateType } from "./types";

// Resolves the ICU patterns for one email in the recipient's language and
// renders it. Language order (same as createT): merchant override for the
// language → built-in language → merchant override for the store's primary
// language → English. A broken merchant override never blocks sending: we
// fall back to the built-in text.

type Ctx = { locale: string; primary?: string | null; overrides?: LocalizedTexts };

/** Raw pattern for a key, following the language fallback order. */
export function resolvePattern(key: string, c: Ctx, useOverrides = true): string {
  const matched = matchLocale(c.locale) ?? matchLocale(c.primary) ?? SOURCE_LOCALE;
  const ov = useOverrides ? (c.overrides ?? {}) : {};
  const primary = c.primary ? matchLocale(c.primary) ?? c.primary : undefined;
  return (
    ov[c.locale]?.[key] ??
    ov[matched]?.[key] ??
    (catalogs[matched] as Record<string, string> | undefined)?.[key] ??
    (primary ? ov[primary]?.[key] : undefined) ??
    (catalogs[SOURCE_LOCALE] as Record<string, string>)[key] ??
    key
  );
}

/** Built-in (not overridden) subject/body for a language, for the editor's defaults. */
export function builtInPatterns(type: TemplateType, locale: string, primary?: string | null) {
  const c = { locale, primary };
  return { subject: resolvePattern(subjectKey(type), c, false), body: resolvePattern(bodyKey(type), c, false) };
}

function args(els: MessageFormatElement[], out = new Set<string>()): Set<string> {
  for (const el of els) {
    if (el.type === TYPE.argument || el.type === TYPE.number || el.type === TYPE.date || el.type === TYPE.time) out.add(el.value);
    if (el.type === TYPE.plural || el.type === TYPE.select) {
      out.add(el.value);
      for (const o of Object.values(el.options)) args(o.value, out);
    }
    if (el.type === TYPE.tag) args(el.children, out);
  }
  return out;
}

export type PatternProblem = { kind: "syntax" } | { kind: "unknown_placeholder"; name: string };

/** Check a merchant-edited subject/body: valid ICU and only known placeholders. */
export function checkPattern(type: TemplateType, pattern: string): PatternProblem | null {
  let els: MessageFormatElement[];
  try {
    els = parse(pattern);
  } catch {
    return { kind: "syntax" };
  }
  const allowed = new Set(allowedPlaceholders(type));
  for (const name of args(els)) if (!allowed.has(name)) return { kind: "unknown_placeholder", name };
  return null;
}

export type DigestCounts = { pending: number; expiring: number; expired: number; failed: number; deferred: number };

export type BuildInput = {
  type: TemplateType;
  locale: string;
  primary?: string | null;
  overrides?: LocalizedTexts;
  vars: EmailVars;
  storeName: string;
  logoUrl?: string | null;
  /** Unsaved editor text, used by "Send test to me". */
  draft?: { subject?: string; body?: string };
  test?: boolean;
  digest?: DigestCounts;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

function prepareVars(i: BuildInput, locale: string): EmailVars {
  const vars: EmailVars = {};
  for (const p of allowedPlaceholders(i.type)) vars[p] = "";
  Object.assign(vars, i.vars);
  vars.store_name = String(vars.store_name || i.storeName);
  // A greeting never reads "Hello ,": fall back to the company name.
  if (!vars.first_name) vars.first_name = vars.company;
  const exp = vars.expiry_date;
  if (typeof exp === "string" && ISO_DATE.test(exp)) {
    const d = new Date(exp.length === 10 ? `${exp}T00:00:00Z` : exp);
    if (!Number.isNaN(d.getTime())) vars.expiry_date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(d);
  }
  return vars;
}

function extraLines(i: BuildInput, vars: EmailVars, body: string, p: (k: string) => string): string[] {
  const lines: string[] = [];
  const unused = (name: string) => vars[name] && !body.includes(`{${name}`);
  if (i.type === "rejected" && unused("reason")) lines.push(p("email.rejected.reasonLine"));
  if (i.type === "needs_info" && unused("message")) lines.push(p("email.needs_info.messageLine"));
  if (i.type === "approved" && unused("terms")) lines.push(p("email.approved.termsLine"));
  if (i.type === "merchant_digest" && i.digest) {
    for (const k of ["pending", "expiring", "expired", "failed", "deferred"] as const) {
      if (i.digest[k] > 0) lines.push(p(`email.merchant_digest.${k}`).replace(/\{count\b/g, `{digest_${k}`));
    }
    lines.push(p("email.merchant_digest.open"));
  }
  return lines;
}

/** Build the final email for one recipient. */
export function buildEmail(i: BuildInput): RenderedEmail {
  const attempt = (useOverrides: boolean): RenderedEmail => {
    const c = { locale: i.locale, primary: i.primary, overrides: i.overrides };
    const p = (k: string) => resolvePattern(k, c, useOverrides);
    const matched = matchLocale(i.locale) ?? matchLocale(i.primary) ?? SOURCE_LOCALE;
    // A store language we don't ship (e.g. "is") is used as-is when the merchant wrote that text.
    const lang = useOverrides && i.overrides?.[i.locale]?.[subjectKey(i.type)] ? i.locale : matched;
    const vars = prepareVars(i, matched);
    if (i.digest) for (const [k, v] of Object.entries(i.digest)) vars[`digest_${k}`] = v;
    const subject = (useOverrides && i.draft?.subject) || p(subjectKey(i.type));
    const body = (useOverrides && i.draft?.body) || p(bodyKey(i.type));
    const out = renderEmail({
      locale: lang,
      dir: isRtl(lang) ? "rtl" : "ltr",
      subject,
      body,
      leadLines: i.test ? [p("email.test.note")] : [],
      extraLines: extraLines(i, vars, body, p),
      footer: p(isMerchantType(i.type) ? "email.footer.merchant" : "email.footer.applicant"),
      vars,
      storeName: i.storeName,
      logoUrl: i.logoUrl,
    });
    if (i.test) {
      const wrapped = renderEmail({ ...out, locale: lang, dir: out.dir, subject: p("email.test.subject"), body: "", footer: "", vars: { subject: out.subject }, storeName: i.storeName });
      out.subject = wrapped.subject;
    }
    return out;
  };
  try {
    return attempt(true);
  } catch {
    return attempt(false);
  }
}
