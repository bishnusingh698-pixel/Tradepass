// Risk hints for the reviewer (feature C14). They never block anything: they point at things worth a
// second look. Also used as automation rule conditions. Client-safe and pure.

/** Common free / consumer email domains (a business usually has its own; many small ones don't). */
export const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de", "yahoo.co.jp", "ymail.com", "rocketmail.com",
  "outlook.com", "hotmail.com", "hotmail.co.uk", "hotmail.fr", "hotmail.de", "live.com", "msn.com", "aol.com", "icloud.com", "me.com", "mac.com",
  "proton.me", "protonmail.com", "gmx.com", "gmx.de", "gmx.net", "web.de", "mail.com", "yandex.com", "yandex.ru", "mail.ru", "zoho.com",
  "qq.com", "163.com", "126.com", "naver.com", "daum.net", "hanmail.net", "libero.it", "orange.fr", "free.fr", "laposte.net", "t-online.de",
  "comcast.net", "att.net", "verizon.net", "sbcglobal.net", "bellsouth.net", "cox.net", "rediffmail.com", "seznam.cz", "wp.pl", "o2.pl", "interia.pl",
]);

export type RiskHint = "free_email" | "website_mismatch" | "registry_mismatch" | "po_box";

/** example.co.uk from "https://www.Example.co.uk/shop", or "" when it isn't a web address. */
export function hostOf(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Same organisation when one domain is the other or ends with it (shop.acme.com vs acme.com). */
function sameSite(a: string, b: string): boolean {
  return Boolean(a && b) && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));
}

const LEGAL = /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|gmbh|ag|sa|sas|sarl|srl|spa|bv|nv|oy|ab|as|aps|kg|co|corp|corporation|company|plc|pty|pte|kk|sl|sro|s\.r\.o|zoo|sp\.?\s?z\s?o\.?o)\b\.?/g;
/** "ACME Trading GmbH" → "acme trading" (legal forms, punctuation and accents dropped). */
export function normaliseCompany(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(LEGAL, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

/** The registry's name and the typed name share no meaningful word. */
export function namesDiffer(typed: string, registry: string): boolean {
  const a = new Set(normaliseCompany(typed).split(" ").filter((w) => w.length > 2));
  const b = normaliseCompany(registry).split(" ").filter((w) => w.length > 2);
  if (!a.size || !b.length) return false;
  return !b.some((w) => a.has(w));
}

/** P.O. box in many spellings and a few languages (US PO Box, Postfach, Boîte postale, Apartado, Casella postale…). */
const PO_BOX = /\b(p\.?\s?o\.?\s?box|post\s?office\s?box|postfach|bo[iî]te\s?postale|b\.?p\.?\s?\d|apartado(\s?postal)?|casella\s?postale|postbus|postboks|box\s\d{2,})\b/i;
export function isPoBox(line: string): boolean {
  return PO_BOX.test(line);
}

export type RiskInput = {
  email: string;
  website?: string | null;
  storeUrl?: string | null;
  companyName: string;
  registryName?: string | null;
  shippingLine?: string | null;
  billingLine?: string | null;
  shippingSame?: boolean;
};

export function riskHints(i: RiskInput): RiskHint[] {
  const out: RiskHint[] = [];
  const emailDomain = (i.email.split("@").pop() ?? "").toLowerCase();
  const free = FREE_EMAIL_DOMAINS.has(emailDomain);
  if (free) out.push("free_email");
  const site = hostOf(i.website || "") || hostOf(i.storeUrl || "");
  // Marketplaces and site builders host many sellers: a mismatch there means nothing.
  const hosted = /(^|\.)(etsy|amazon|ebay|shopify|myshopify|wixsite|squarespace|facebook|instagram|tiktok|google)\./.test(`.${site}`);
  if (!free && site && !hosted && !sameSite(site, emailDomain)) out.push("website_mismatch");
  if (i.registryName && namesDiffer(i.companyName, i.registryName)) out.push("registry_mismatch");
  const ship = i.shippingSame === false ? i.shippingLine : i.billingLine;
  if (ship && isPoBox(ship)) out.push("po_box");
  return out;
}
