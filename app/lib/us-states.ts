// US sales-tax facts used for resale and exemption certificates (feature A1/A2).
// Only facts confirmed on official state or government sites are listed; each one
// is cited in API_NOTES.md → "US sales tax facts" with the URL and the date it was
// checked (2026-11-07). Anything not confirmed is simply absent, and the app then
// shows a neutral hint instead of a claim. Client-safe (no server imports).

export const US_STATES = [
  "AK", "AL", "AR", "AZ", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA",
  "MD", "ME", "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV", "WY",
] as const;
export type UsState = (typeof US_STATES)[number];
export const isUsState = (s: unknown): s is UsState => typeof s === "string" && (US_STATES as readonly string[]).includes(s);

/** Certificate forms a US buyer can give. "exempt" = a tax-exempt organisation's certificate (nonprofits). */
export const US_CERT_FORMS = ["state", "sst", "mtc", "exempt"] as const;
export type UsCertForm = (typeof US_CERT_FORMS)[number];
export const isUsCertForm = (s: unknown): s is UsCertForm => typeof s === "string" && (US_CERT_FORMS as readonly string[]).includes(s);

/**
 * No statewide general sales tax (official: Oregon DOR, Delaware Division of Revenue, Montana DOR,
 * New Hampshire DRA, Alaska Department of Commerce). Alaska allows local sales taxes.
 */
export const NO_STATE_SALES_TAX: readonly UsState[] = ["AK", "DE", "MT", "NH", "OR"];
export const LOCAL_SALES_TAX_ONLY: readonly UsState[] = ["AK"];

/**
 * Streamlined Sales Tax: 23 full member states plus Tennessee (associate member), as listed by
 * the Streamlined Sales Tax Governing Board (streamlinedsalestax.org, checked 2026-11-07).
 */
export const SST_STATES: readonly UsState[] = [
  "AR", "GA", "IN", "IA", "KS", "KY", "MI", "MN", "NE", "NV", "NJ", "NC", "ND", "OH", "OK", "RI", "SD", "UT", "VT", "WA", "WV", "WI", "WY", "TN",
];

/** The MTC's own page for the uniform resale certificate, with each state's notes. Acceptance is conditional, so we never list states. */
export const MTC_CERTIFICATE_URL = "https://www.mtc.gov/resources/uniform-sales-use-tax-exemption-certificate/";
/** IRS Tax Exempt Organization Search (nonprofits): web search only; the bulk files are too large for our free database. */
export const IRS_TEOS_URL = "https://www.irs.gov/charities-non-profits/tax-exempt-organization-search";

export type PermitLookup = {
  /** Official page where staff check the number (web form: link only, no scraping). */
  url: string;
  /** Message key (applications.usLookup.enter.<key>) saying what to type there. */
  enter: "permit" | "permit_or_fein" | "certificate" | "account_id" | "tpt" | "can" | "sales_tax_id";
  /** A free official open dataset Tradepass can check automatically (Starter, like VIES). */
  live?: "tx_socrata";
};

/** Official free lookup pages confirmed on 2026-11-07 (sources in API_NOTES.md). States not listed: no confirmed public lookup. */
export const PERMIT_LOOKUPS: Partial<Record<UsState, PermitLookup>> = {
  // CDTFA "Verify a Permit, License, or Account" (web form only).
  CA: { url: "https://services.cdtfa.ca.gov/m/svs/AboutSales.aspx", enter: "permit" },
  // Texas Comptroller taxpayer search (11-digit taxpayer number or 9-digit FEIN) + the open dataset on data.texas.gov.
  TX: { url: "https://comptroller.texas.gov/taxes/sales/taxpayer-search.php", enter: "permit_or_fein", live: "tx_socrata" },
  // Florida DOR Seller Certificate Verification (annual resale certificate number).
  FL: { url: "https://floridarevenue.com/taxes/certificates", enter: "certificate" },
  // Washington DOR: Business Lookup / reseller permit verification.
  WA: { url: "https://dor.wa.gov/taxes-rates/retail-sales-tax/reseller-permits/how-verify-reseller-permits", enter: "permit" },
  // Illinois DOR: MyTax Illinois → "Verify a Registered Business".
  IL: { url: "https://mytax.illinois.gov/", enter: "account_id" },
  // Arizona DOR: AZTaxes license verification (8-digit TPT license).
  AZ: { url: "https://www.aztaxes.gov/Home/LicenseVerification", enter: "tpt" },
  // Colorado DOR: Revenue Online (Colorado account number).
  CO: { url: "https://www.colorado.gov/revenueonline", enter: "can" },
  // Georgia DOR: Sales Tax ID verification tool in the Georgia Tax Center.
  GA: { url: "https://dor.georgia.gov/taxes/sales-use-tax/sales-tax-id-verification-tool", enter: "sales_tax_id" },
  // North Carolina DOR: sales and use tax number registries.
  NC: { url: "https://www.ncdor.gov/sales-and-use-tax-number-registries", enter: "account_id" },
  // Massachusetts DOR: verify a sales tax certificate (MassTaxConnect, for sellers given Form ST-4).
  MA: { url: "https://www.mass.gov/how-to/verify-a-sales-or-meals-food-beverage-tax-certificate", enter: "sales_tax_id" },
};

/** Confirmed expiry rules shown as a hint (Florida DOR: annual resale certificates expire on 31 December). */
export const EXPIRY_HINTS: Partial<Record<UsState, "dec31">> = { FL: "dec31" };

export type StateHint = "no_state_tax" | "local_only" | "sst_not_member" | "mtc_conditional" | "exempt_no_enum";

/** Neutral, sourced hints for one state on one certificate form (message keys certificates.usHint.<hint>). */
export function stateHints(state: string | null | undefined, form: UsCertForm | null | undefined): StateHint[] {
  if (!isUsState(state)) return [];
  const out: StateHint[] = [];
  if (LOCAL_SALES_TAX_ONLY.includes(state)) out.push("local_only");
  else if (NO_STATE_SALES_TAX.includes(state)) out.push("no_state_tax");
  if (form === "sst" && !SST_STATES.includes(state)) out.push("sst_not_member");
  if (form === "mtc") out.push("mtc_conditional");
  if (form === "exempt") out.push("exempt_no_enum");
  return out;
}

/** Texas sales tax permits are the 11-digit taxpayer number, starting with 1 or 3 (Comptroller taxpayer search). */
export function texasTaxpayerNumber(n: string): string | null {
  const d = n.replace(/\D/g, "");
  return /^[13]\d{10}$/.test(d) ? d : null;
}

/** EIN: 9 digits, usually written 12-3456789. Format only: there is no free public EIN check. */
export function einOk(v: string): boolean {
  return /^\d{2}-?\d{7}$/.test(v.trim());
}

/** D-U-N-S: 9 digits (format only). */
export function dunsOk(v: string): boolean {
  return /^\d{9}$/.test(v.replace(/[\s-]/g, ""));
}

/** US ZIP or ZIP+4. */
export function usZipOk(v: string): boolean {
  return /^\d{5}(-\d{4})?$/.test(v.trim());
}
