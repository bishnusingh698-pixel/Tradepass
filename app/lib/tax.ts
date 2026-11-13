// Tax exemption suggestions. Enum values verified against Admin GraphQL
// 2026-10 TaxExemption (74 values: 51 US reseller incl. DC, 22 Canadian,
// EU_REVERSE_CHARGE_EXEMPTION_RULE). See API_NOTES.md §Tax.

export const US_RESELLER_STATES = [
  "AK", "AL", "AR", "AZ", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "IA",
  "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MO", "MS",
  "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV", "WY",
] as const;

// EU member states (ISO country codes). VIES uses "EL" for Greece and "XI" for Northern Ireland.
export const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR",
  "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);

export function usResellerExemption(state: string | null | undefined): string | null {
  const s = state?.trim().toUpperCase();
  if (!s) return null;
  return (US_RESELLER_STATES as readonly string[]).includes(s) ? `US_${s}_RESELLER_EXEMPTION` : null;
}

import { LOCAL_SALES_TAX_ONLY, NO_STATE_SALES_TAX, type UsState } from "./us-states";

export type ExemptionInput = {
  storeCountry: string; // merchant's country
  buyerCountry: string; // billing country of the company location
  buyerRegion?: string | null; // US state, CA province
  certificateType?: "resale" | "vat" | "licence" | "other" | null;
  certificateRegion?: string | null; // state on the resale certificate
  vatVerified?: boolean;
  /** US: every state the buyer's resale certificates cover (one certificate per state). */
  coveredStates?: string[];
  /** US: the buyer gave a tax-exempt organisation certificate (Shopify has no matching exemption value). */
  exemptOrg?: boolean;
};

/** `alsoCovered`: exemptions for the other states the certificates cover (offered, never applied by default). */
export type ExemptionSuggestion = { exemption: string | null; reason: string; alsoCovered?: string[] };

/**
 * Suggest (never silently apply) an exemption. The merchant sees and can edit it in the approve modal.
 * - US resale certificate → that state's reseller exemption.
 * - Verified VAT number from a different EU country than the store → EU reverse charge.
 */
export function suggestExemption(i: ExemptionInput): ExemptionSuggestion {
  if (i.buyerCountry === "US") {
    const loc = i.buyerRegion?.trim().toUpperCase() ?? "";
    const covered = [...new Set((i.coveredStates ?? (i.certificateType === "resale" && i.certificateRegion ? [i.certificateRegion] : [])).map((x) => x.toUpperCase()))];
    const others = covered.filter((x) => x !== loc).map(usResellerExemption).filter((x): x is string => Boolean(x));
    // A state without a statewide sales tax: nothing to exempt (Alaska: local taxes only, so still offered).
    if (loc && NO_STATE_SALES_TAX.includes(loc as UsState) && !LOCAL_SALES_TAX_ONLY.includes(loc as UsState)) {
      return { exemption: null, reason: "no_state_sales_tax", alsoCovered: others };
    }
    if (covered.length) {
      if (covered.includes(loc)) {
        const ex = usResellerExemption(loc);
        if (ex) return { exemption: ex, reason: LOCAL_SALES_TAX_ONLY.includes(loc as UsState) ? "us_resale_local_only" : "us_resale_certificate", alsoCovered: others };
      }
      if (!loc && covered.length === 1) {
        const ex = usResellerExemption(covered[0]);
        if (ex) return { exemption: ex, reason: "us_resale_certificate", alsoCovered: [] };
      }
      return { exemption: null, reason: loc ? "us_state_not_covered" : "us_state_unknown", alsoCovered: others };
    }
    if (i.exemptOrg) return { exemption: null, reason: "us_exempt_org" };
    if (i.certificateType === "resale") return { exemption: null, reason: "us_state_unknown" };
  }
  if (EU_COUNTRIES.has(i.buyerCountry)) {
    if (!EU_COUNTRIES.has(i.storeCountry)) return { exemption: null, reason: "store_outside_eu" };
    if (i.buyerCountry === i.storeCountry) return { exemption: null, reason: "same_country" };
    if (!i.vatVerified) return { exemption: null, reason: "vat_not_verified" };
    return { exemption: "EU_REVERSE_CHARGE_EXEMPTION_RULE", reason: "eu_reverse_charge" };
  }
  return { exemption: null, reason: "none" };
}
