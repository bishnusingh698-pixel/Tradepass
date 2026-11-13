// Tax-number checks against free official registries only (hard constraint 1).
// Never throws, never blocks an application: every lookup has a 5 s timeout and
// falls back to "unavailable" ("Couldn't verify — check manually").
//  - EU: VIES REST (no key). Greece is "EL", Northern Ireland "XI".
//  - UK: HMRC "Check a UK VAT number" v2, only when HMRC_CLIENT_ID/SECRET are set.
//  - AU: ABN Lookup JSON, only when ABN_GUID is set.
//  - US Texas: the Comptroller's "Active Sales Tax Permit Holders" open dataset on data.texas.gov
//    (Socrata, public, no key; SOCRATA_APP_TOKEN optional for higher rate limits).
//  - Norway: Brønnøysund Register Centre's open Enhetsregisteret API (data.brreg.no, no key, NLOD licence).
//  - New Zealand: the NZBN API (api.business.govt.nz), only when the free NZBN_API_KEY is set.
//  - Switzerland, Canada and others: no live call; the admin shows "Check on the official site" (tax-registries.ts).
// Malformed numbers are "not_verified" without a network call.
import { EU_COUNTRIES } from "./tax";
import { PERMIT_LOOKUPS, texasTaxpayerNumber } from "./us-states";
import { taxChecksum } from "./tax-checksums.js";

/** "skipped": a number was given but the plan has no live checks (Free). */
export type TaxCheck = { status: "verified" | "not_verified" | "unavailable" | "na" | "skipped"; name?: string; registry?: string };

export const TAX_TIMEOUT_MS = 5000;

const VIES_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
const HMRC_BASE = "https://api.service.hmrc.gov.uk";
const ABN_URL = "https://abr.business.gov.au/json/AbnDetails.aspx";
/** Enhetsregisteret (Brønnøysundregistrene), one entity by organisation number. */
export const BRREG_URL = "https://data.brreg.no/enhetsregisteret/api/enheter";
/** NZBN API v5 (MBIE), one entity by NZBN; free subscription key in the Ocp-Apim-Subscription-Key header. */
export const NZBN_URL = "https://api.business.govt.nz/gateway/nzbn/v5/entities";
/** data.texas.gov dataset jrea-zgmq ("Active Sales Tax Permit Holders", Texas Comptroller). */
export const TX_PERMITS_URL = "https://data.texas.gov/resource/jrea-zgmq.json";

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

/** Norwegian organisation number (9 digits, optional NO prefix and MVA suffix) with a valid mod-11 check digit. */
export function norwayOrgNumber(n: string): { orgnr: string; vat: boolean } | null {
  const m = /^(?:NO)?(\d{9})(MVA)?$/.exec(n);
  if (!m || taxChecksum("NO", m[1]) === false) return null;
  return { orgnr: m[1], vat: Boolean(m[2]) };
}

/**
 * Enhetsregisteret reply: 404 unknown, 410 removed from the register; a bankrupt, dissolving or deleted
 * entity is not verified. A number written as a VAT number (…MVA) must also be in the VAT register.
 */
export function parseBrreg(httpStatus: number, body: unknown, vat = false): TaxCheck {
  if (httpStatus === 404 || httpStatus === 410) return { status: "not_verified", registry: "brreg" };
  if (httpStatus !== 200 || !body || typeof body !== "object") return { status: "unavailable", registry: "brreg" };
  const b = body as Record<string, unknown>;
  if (typeof b.organisasjonsnummer !== "string") return { status: "unavailable", registry: "brreg" };
  const name = cleanName(b.navn);
  const closed = b.konkurs === true || b.underAvvikling === true || b.underTvangsavviklingEllerTvangsopplosning === true || Boolean(b.slettedato);
  if (closed || (vat && b.registrertIMvaregisteret === false)) return { status: "not_verified", name, registry: "brreg" };
  return { status: "verified", name, registry: "brreg" };
}

async function checkBrreg(number: string, f: Fetch): Promise<TaxCheck> {
  const no = norwayOrgNumber(number);
  if (!no) return { status: "not_verified", registry: "brreg" };
  const res = await f(`${BRREG_URL}/${no.orgnr}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TAX_TIMEOUT_MS) });
  return parseBrreg(res.status, await res.json().catch(() => null), no.vat);
}

/**
 * NZBN reply. The status field name is read defensively (entityStatusDescription, then entityStatusCode)
 * because it could only be confirmed from third-party clients (API_NOTES: needs verification with a key).
 * No status at all is "unavailable", never a guess.
 */
export function parseNzbn(httpStatus: number, body: unknown): TaxCheck {
  if (httpStatus === 404) return { status: "not_verified", registry: "nzbn" };
  if (httpStatus !== 200 || !body || typeof body !== "object") return { status: "unavailable", registry: "nzbn" };
  const b = body as Record<string, unknown>;
  const name = cleanName(b.entityName);
  const st = String(b.entityStatusDescription ?? b.entityStatusCode ?? "").trim();
  if (!st) return { status: "unavailable", name, registry: "nzbn" };
  return /^registered$/i.test(st) || st === "50" ? { status: "verified", name, registry: "nzbn" } : { status: "not_verified", name, registry: "nzbn" };
}

async function checkNzbn(number: string, f: Fetch): Promise<TaxCheck> {
  const nzbn = number.replace(/\D/g, "");
  if (!/^94\d{11}$/.test(nzbn)) return { status: "na" }; // a GST or company number: offline check only
  const key = process.env.NZBN_API_KEY;
  if (!key) return { status: "unavailable", registry: "nzbn" };
  const res = await f(`${NZBN_URL}/${nzbn}`, { headers: { Accept: "application/json", "Ocp-Apim-Subscription-Key": key }, signal: AbortSignal.timeout(TAX_TIMEOUT_MS) });
  return parseNzbn(res.status, await res.json().catch(() => null));
}

/**
 * The whole check, all calls together, must fit in the applicant's request (the app proxy gives about
 * 10 seconds, and HMRC needs a token call before the lookup, each with its own 5 s timeout).
 */
export const TAX_TOTAL_MS = 6000;

/** Check a tax number against free official registries (VIES, Brønnøysund, optionally HMRC/ABN/NZBN). Never throws; times out to "unavailable". */
export async function checkTaxNumber(country: string, number: string, fetchImpl: Fetch = fetch, totalMs = TAX_TOTAL_MS): Promise<TaxCheck> {
  const c = (country ?? "").toUpperCase();
  const n = cleanNumber(number ?? "");
  if (!n) return { status: "na" };
  const run = async (): Promise<TaxCheck> => {
    const prefix = viesPrefix(c, n);
    if (prefix) return checkVies(prefix, n, fetchImpl);
    if (c === "GB") return checkHmrc(n, fetchImpl);
    if (c === "AU") return checkAbn(n, fetchImpl);
    if (c === "NO") return checkBrreg(n, fetchImpl);
    if (c === "NZ") return checkNzbn(n, fetchImpl);
    return { status: "na" };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TaxCheck>((resolve) => {
    timer = setTimeout(() => resolve({ status: "unavailable" }), totalMs);
  });
  try {
    return await Promise.race([run(), timeout]);
  } catch {
    // Timeouts, DNS failures, registry outages: never block the application.
    return { status: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

/** Run a check within the total budget; any failure or overrun is "unavailable", never an exception. */
async function withBudget(run: () => Promise<TaxCheck>, totalMs: number): Promise<TaxCheck> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TaxCheck>((resolve) => {
    timer = setTimeout(() => resolve({ status: "unavailable" }), totalMs);
  });
  try {
    return await Promise.race([run(), timeout]);
  } catch {
    return { status: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

/** Parse a data.texas.gov reply: a row means an active permit, an empty list means not in the active list. */
export function parseTexasPermits(httpStatus: number, body: unknown, number: string): TaxCheck {
  if (httpStatus !== 200 || !Array.isArray(body)) return { status: "unavailable", registry: "tx_comptroller" };
  const row = body.find((r) => r && typeof r === "object" && String((r as Record<string, unknown>).taxpayer_number ?? "") === number) as Record<string, unknown> | undefined;
  if (row) return { status: "verified", name: cleanName(row.taxpayer_name), registry: "tx_comptroller" };
  return body.length === 0 ? { status: "not_verified", registry: "tx_comptroller" } : { status: "unavailable", registry: "tx_comptroller" };
}

/**
 * A US state seller's permit / sales tax ID. Only states with a free official open dataset are
 * checked live (Texas); everything else is "na" (the merchant uses "Check on the state's site").
 */
export async function checkUsPermit(state: string, number: string, fetchImpl: Fetch = fetch, totalMs = TAX_TOTAL_MS): Promise<TaxCheck> {
  const st = (state ?? "").toUpperCase();
  if (PERMIT_LOOKUPS[st as keyof typeof PERMIT_LOOKUPS]?.live !== "tx_socrata") return { status: "na" };
  const tin = texasTaxpayerNumber(number ?? "");
  // Not an 11-digit Texas taxpayer number (could be an FEIN): don't guess, the merchant checks on the site.
  if (!tin) return { status: "na" };
  return withBudget(async () => {
    const url = `${TX_PERMITS_URL}?${new URLSearchParams({ taxpayer_number: tin, $limit: "1" })}`;
    const token = process.env.SOCRATA_APP_TOKEN;
    const res = await fetchImpl(url, { headers: { Accept: "application/json", ...(token ? { "X-App-Token": token } : {}) }, signal: AbortSignal.timeout(TAX_TIMEOUT_MS) });
    return parseTexasPermits(res.status, await res.json().catch(() => null), tin);
  }, totalMs);
}

/** Test hook: forget the cached HMRC token. */
export function _resetHmrcToken() {
  hmrcToken = null;
}
