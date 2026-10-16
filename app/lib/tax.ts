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

export type ExemptionInput = {
  storeCountry: string; // merchant's country
  buyerCountry: string; // billing country of the company location
  buyerRegion?: string | null; // US state, CA province
  certificateType?: "resale" | "vat" | "licence" | "other" | null;
  certificateRegion?: string | null; // state on the resale certificate
  vatVerified?: boolean;
};

export type ExemptionSuggestion = { exemption: string | null; reason: string };

/**
 * Suggest (never silently apply) an exemption. The merchant sees and can edit it in the approve modal.
 * - US resale certificate → that state's reseller exemption.
 * - Verified VAT number from a different EU country than the store → EU reverse charge.
 */
export function suggestExemption(i: ExemptionInput): ExemptionSuggestion {
  if (i.buyerCountry === "US" && i.certificateType === "resale") {
    const ex = usResellerExemption(i.certificateRegion ?? i.buyerRegion);
    return ex ? { exemption: ex, reason: "us_resale_certificate" } : { exemption: null, reason: "us_state_unknown" };
  }
  if (EU_COUNTRIES.has(i.buyerCountry)) {
    if (!EU_COUNTRIES.has(i.storeCountry)) return { exemption: null, reason: "store_outside_eu" };
    if (i.buyerCountry === i.storeCountry) return { exemption: null, reason: "same_country" };
    if (!i.vatVerified) return { exemption: null, reason: "vat_not_verified" };
    return { exemption: "EU_REVERSE_CHARGE_EXEMPTION_RULE", reason: "eu_reverse_charge" };
  }
  return { exemption: null, reason: "none" };
}
