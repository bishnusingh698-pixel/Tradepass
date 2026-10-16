import { IntlMessageFormat } from "intl-messageformat";

// Pure email renderer, safe to use in the browser (the Notifications live
// preview) and on the server. It takes ICU patterns that the caller already
// resolved for the recipient's language, so it never loads catalogs itself.
//
// Accessibility: lang + dir on <html>, real text (no images required), 4.5:1
// contrast or better, links underlined, system font stacks that cover the
// non-Latin scripts we ship (hi, th, ar, he, ur, zh, ja, ko).

export type EmailVars = Record<string, string | number>;

export type RenderInput = {
  locale: string;
  dir: "ltr" | "rtl";
  subject: string; // ICU pattern
  body: string; // ICU pattern; blank line = new paragraph
  leadLines?: string[]; // ICU patterns shown before the body (e.g. the test-email note)
  extraLines?: string[]; // ICU patterns appended as their own paragraphs
  footer: string; // ICU pattern
  vars: EmailVars;
  storeName: string;
  logoUrl?: string | null;
};

export type RenderedEmail = { subject: string; html: string; text: string; locale: string; dir: "ltr" | "rtl" };

// Colours: text #1f1f1f on #ffffff ≈ 16:1, muted #4a4a4a ≈ 8.9:1, link #005bd3 ≈ 5.6:1.
const COLORS = { text: "#1f1f1f", muted: "#4a4a4a", link: "#005bd3", bg: "#ffffff", rule: "#d4d4d4" };

const BASE_FONTS = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans"`;
const SCRIPT_FONTS: Record<string, string> = {
  ar: `"Segoe UI", Tahoma, "Geeza Pro", "Noto Sans Arabic", "Noto Naskh Arabic"`,
  ur: `"Noto Nastaliq Urdu", "Jameel Noori Nastaleeq", "Segoe UI", Tahoma, "Noto Sans Arabic"`,
  he: `"Segoe UI", Arial, "Noto Sans Hebrew"`,
  hi: `"Nirmala UI", "Kohinoor Devanagari", "Noto Sans Devanagari", Mangal`,
  th: `"Leelawadee UI", Thonburi, "Noto Sans Thai", Tahoma`,
  zh: `"PingFang SC", "PingFang TC", "Microsoft YaHei", "Microsoft JhengHei", "Noto Sans CJK SC", "Noto Sans SC"`,
  ja: `"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, "Noto Sans CJK JP", "Noto Sans JP"`,
  ko: `"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", "Noto Sans KR"`,
};

/** System font stack for a language: script-specific fonts first, then the Latin stack, then sans-serif. */
export function fontStack(locale: string): string {
  const base = locale.split("-")[0];
  const script = SCRIPT_FONTS[base];
  return `${script ? `${script}, ` : ""}${BASE_FONTS}, sans-serif`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const isUrl = (v: string) => /^https?:\/\/\S+$/i.test(v);
const S_OPEN = "";
const S_CLOSE = "";
const SENTINEL_RE = /(\d+)/g;
// Unicode isolates keep names, numbers and emails readable inside RTL sentences.
const FSI = "⁨";
const PDI = "⁩";

function formatWithSentinels(pattern: string, locale: string, vars: EmailVars, strings: string[]): string {
  const values: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (typeof v === "number") values[k] = v; // numbers stay numbers so plurals work
    else {
      strings.push(v);
      values[k] = `${S_OPEN}${strings.length - 1}${S_CLOSE}`;
    }
  }
  return String(new IntlMessageFormat(pattern, locale).format(values));
}

function toText(formatted: string, strings: string[], rtl: boolean): string {
  return formatted.replace(SENTINEL_RE, (_, i) => {
    const v = strings[Number(i)] ?? "";
    // URLs stay bare so mail clients still detect them as links.
    return rtl && v && !isUrl(v) ? `${FSI}${v}${PDI}` : v;
  });
}

function toHtml(formatted: string, strings: string[]): string {
  return escapeHtml(formatted)
    .replace(/\n/g, "<br>")
    .replace(SENTINEL_RE, (_, i) => {
      const v = strings[Number(i)] ?? "";
      if (!v) return "";
      if (isUrl(v)) {
        const e = escapeHtml(v);
        return `<a href="${e}" dir="ltr" style="color:${COLORS.link};text-decoration:underline;word-break:break-all">${e}</a>`;
      }
      return `<bdi>${escapeHtml(v)}</bdi>`;
    });
}

const paragraphs = (s: string) => s.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

/** Render subject, accessible HTML and the plain-text part. Throws on invalid ICU (callers fall back to built-in text). */
export function renderEmail(i: RenderInput): RenderedEmail {
  const rtl = i.dir === "rtl";
  const strings: string[] = [];
  const fmt = (p: string) => formatWithSentinels(p, i.locale, i.vars, strings);

  const subject = toText(fmt(i.subject), strings, rtl).replace(/\s+/g, " ").trim();
  const blocks = [
    ...(i.leadLines ?? []).map(fmt),
    ...paragraphs(fmt(i.body)),
    ...(i.extraLines ?? []).map(fmt),
  ];
  const footer = fmt(i.footer);

  const text = [...blocks.map((b) => toText(b, strings, rtl)), "--", toText(footer, strings, rtl)].join("\n\n");

  const align = rtl ? "right" : "left";
  const font = fontStack(i.locale);
  const pStyle = `margin:0 0 16px 0;font-size:16px;line-height:1.5;color:${COLORS.text};text-align:${align}`;
  const logo =
    i.logoUrl && /^https:\/\//i.test(i.logoUrl)
      ? `<img src="${escapeHtml(i.logoUrl)}" alt="${escapeHtml(i.storeName)}" width="120" style="display:block;max-width:120px;height:auto;border:0;margin:0 0 16px 0">`
      : "";
  const html = `<!doctype html>
<html lang="${escapeHtml(i.locale)}" dir="${i.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};color:${COLORS.text};font-family:${escapeHtml(font)}">
<div role="article" aria-roledescription="email" lang="${escapeHtml(i.locale)}" dir="${i.dir}" style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:${escapeHtml(font)};text-align:${align}">
${logo}<p style="margin:0 0 24px 0;font-size:18px;font-weight:bold;color:${COLORS.text};text-align:${align}">${escapeHtml(i.storeName)}</p>
${blocks.map((b) => `<p style="${pStyle}">${toHtml(b, strings)}</p>`).join("\n")}
<hr style="border:0;border-top:1px solid ${COLORS.rule};margin:24px 0">
<p style="margin:0;font-size:14px;line-height:1.5;color:${COLORS.muted};text-align:${align}">${toHtml(footer, strings)}</p>
</div>
</body>
</html>`;
  return { subject, html, text, locale: i.locale, dir: i.dir };
}
