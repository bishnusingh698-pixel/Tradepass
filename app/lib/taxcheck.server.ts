// Tax-number checks against free official registries only (hard constraint 1).
// Never throws, never blocks an application: every lookup has a 5 s timeout and
// falls back to "unavailable" ("Couldn't verify — check manually").
//  - EU: VIES REST (no key). Greece is "EL", Northern Ireland "XI".
//  - UK: HMRC "Check a UK VAT number" v2, only when HMRC_CLIENT_ID/SECRET are set.
//  - AU: ABN Lookup JSON, only when ABN_GUID is set.
// Malformed numbers are "not_verified" without a network call.
import { EU_COUNTRIES } from "./tax";

export type TaxCheck = { status: "verified" | "not_verified" | "unavailable" | "na"; name?: string; registry?: string };

export const TAX_TIMEOUT_MS = 5000;

const VIES_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
const HMRC_BASE = "https://api.service.hmrc.gov.uk";
const ABN_URL = "https://abr.business.gov.au/json/AbnDetails.aspx";

type Fetch = typeof fetch;

export function cleanNumber(n: string): string {
  return n.replace(/[\s.\-/]/g, "").toUpperCase();
}

/** VIES country prefix for an ISO country (Greece → EL; Northern Ireland numbers carry XI). */
export function viesPrefix(country: string, number: string): string | null {
  const c = country.toUpperCase();
  if (number.startsWith("XI") && (c === "GB" || c === "XI")) return "XI";
  if (c === "XI") return "XI";
  if (c === "GR" || c === "EL") return "EL";
  return EU_COUNTRIES.has(c) ? c : null;
}

function cleanName(n: unknown): string | undefined {
  if (typeof n !== "string") return undefined;
  const t = n.trim();
  return t && t !== "---" ? t.slice(0, 200) : undefined;
}

const VIES_INVALID = new Set(["INVALID_INPUT", "INVALID", "VAT_BLOCKED"]);

/** Parse a VIES REST reply (POST check-vat-number returns `valid`; the GET form uses `isValid` + `userError`). */
export function parseVies(httpStatus: number, body: unknown): TaxCheck {
  const b = (body ?? {}) as Record<string, unknown>;
  const errCode = Array.isArray(b.errorWrappers) ? String((b.errorWrappers[0] as { error?: string })?.error ?? "") : "";
  if (errCode) return { status: VIES_INVALID.has(errCode) ? "not_verified" : "unavailable", registry: "vies" };
  if (httpStatus !== 200) return { status: "unavailable", registry: "vies" };
  const userError = typeof b.userError === "string" ? b.userError : null;
  if (userError && userError !== "VALID" && userError !== "INVALID") {
    return { status: VIES_INVALID.has(userError) ? "not_verified" : "unavailable", registry: "vies" };
  }
  const valid = typeof b.valid === "boolean" ? b.valid : typeof b.isValid === "boolean" ? b.isValid : null;
  if (valid === null) return { status: "unavailable", registry: "vies" };
  return valid ? { status: "verified", name: cleanName(b.name), registry: "vies" } : { status: "not_verified", registry: "vies" };
}

async function checkVies(prefix: string, number: string, f: Fetch): Promise<TaxCheck> {
  const vat = number.startsWith(prefix) ? number.slice(prefix.length) : number.replace(/^[A-Z]{2}(?=\d)/, "");
  if (!/^[0-9A-Z+*]{2,12}$/.test(vat)) return { status: "not_verified", registry: "vies" };
  const res = await f(VIES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ countryCode: prefix, vatNumber: vat }),
    signal: AbortSignal.timeout(TAX_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => null);
  return parseVies(res.status, body);
}

let hmrcToken: { value: string; exp: number } | null = null;

async function hmrcAccessToken(f: Fetch): Promise<string> {
  if (hmrcToken && hmrcToken.exp > Date.now() + 60_000) return hmrcToken.value;
  const res = await f(`${HMRC_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.HMRC_CLIENT_ID ?? "",
      client_secret: process.env.HMRC_CLIENT_SECRET ?? "",
    }),
    signal: AbortSignal.timeout(TAX_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error("hmrc token");
  const j = (await res.json()) as { access_token: string; expires_in: number };
  hmrcToken = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

export function parseHmrc(httpStatus: number, body: unknown): TaxCheck {
  if (httpStatus === 404) return { status: "not_verified", registry: "hmrc" };
  if (httpStatus !== 200) return { status: "unavailable", registry: "hmrc" };
  const t = (body as { target?: { name?: string; vatNumber?: string } } | null)?.target;
  return t?.vatNumber ? { status: "verified", name: cleanName(t.name), registry: "hmrc" } : { status: "unavailable", registry: "hmrc" };
}

async function checkHmrc(number: string, f: Fetch): Promise<TaxCheck> {
  const vrn = number.replace(/^GB/, "");
  if (!/^\d{9}(\d{3})?$/.test(vrn)) return { status: "not_verified", registry: "hmrc" };
  if (!process.env.HMRC_CLIENT_ID || !process.env.HMRC_CLIENT_SECRET) return { status: "unavailable", registry: "hmrc" };
  const token = await hmrcAccessToken(f);
  const res = await f(`${HMRC_BASE}/organisations/vat/check-vat-number/lookup/${vrn}`, {
    headers: { Accept: "application/vnd.hmrc.2.0+json", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TAX_TIMEOUT_MS),
  });
  return parseHmrc(res.status, await res.json().catch(() => null));
}

/** ABN checksum (ABR's published algorithm): subtract 1 from the first digit, weighted sum mod 89. */
export function abnChecksumOk(abn: string): boolean {
  if (!/^\d{11}$/.test(abn)) return false;
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const d = abn.split("").map(Number);
  d[0] -= 1;
  return d.reduce((s, x, i) => s + x * w[i], 0) % 89 === 0;
}

/** ABN Lookup returns JSONP: callback({...}). */
export function parseAbn(text: string): TaxCheck {
  const m = /^[^(]*\(([\s\S]*)\)\s*;?\s*$/.exec(text.trim());
  let j: { Abn?: string; AbnStatus?: string; EntityName?: string; Message?: string } | null = null;
  try {
    j = JSON.parse(m ? m[1] : text);
  } catch {
    return { status: "unavailable", registry: "abr" };
  }
  if (!j || j.Message) return { status: j?.Message ? "not_verified" : "unavailable", registry: "abr" };
  if (!j.Abn) return { status: "not_verified", registry: "abr" };
  return j.AbnStatus === "Active" ? { status: "verified", name: cleanName(j.EntityName), registry: "abr" } : { status: "not_verified", registry: "abr" };
}

async function checkAbn(number: string, f: Fetch): Promise<TaxCheck> {
  const abn = number.replace(/\D/g, "");
  if (!abnChecksumOk(abn)) return { status: "not_verified", registry: "abr" };
  const guid = process.env.ABN_GUID;
  if (!guid) return { status: "unavailable", registry: "abr" };
  const url = `${ABN_URL}?${new URLSearchParams({ abn, guid, callback: "c" })}`;
  const res = await f(url, { signal: AbortSignal.timeout(TAX_TIMEOUT_MS) });
  if (!res.ok) return { status: "unavailable", registry: "abr" };
  return parseAbn(await res.text());
}

/** Check a tax number against free official registries (VIES, optionally HMRC/ABN). Never throws; times out to "unavailable". */
export async function checkTaxNumber(country: string, number: string, fetchImpl: Fetch = fetch): Promise<TaxCheck> {
  const c = (country ?? "").toUpperCase();
  const n = cleanNumber(number ?? "");
  if (!n) return { status: "na" };
  try {
    const prefix = viesPrefix(c, n);
    if (prefix) return await checkVies(prefix, n, fetchImpl);
    if (c === "GB") return await checkHmrc(n, fetchImpl);
    if (c === "AU") return await checkAbn(n, fetchImpl);
    return { status: "na" };
  } catch {
    // Timeouts, DNS failures, registry outages: never block the application.
    return { status: "unavailable" };
  }
}

/** Test hook: forget the cached HMRC token. */
export function _resetHmrcToken() {
  hmrcToken = null;
}
