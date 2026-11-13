import { describe, expect, it } from "vitest";
import { suggestExemption, US_RESELLER_STATES, usResellerExemption } from "../app/lib/tax";

describe("tax exemption suggestions", () => {
  it("covers the 51 US reseller exemptions (50 states + DC)", () => {
    expect(US_RESELLER_STATES).toHaveLength(51);
    expect(usResellerExemption("tx")).toBe("US_TX_RESELLER_EXEMPTION");
    expect(usResellerExemption("PR")).toBeNull();
  });

  it("acceptance 10: Texas resale certificate for a Texas location → US_TX_RESELLER_EXEMPTION", () => {
    expect(suggestExemption({ storeCountry: "US", buyerCountry: "US", buyerRegion: "TX", certificateType: "resale", certificateRegion: "TX" }))
      .toEqual({ exemption: "US_TX_RESELLER_EXEMPTION", reason: "us_resale_certificate", alsoCovered: [] });
  });

  it("A1 the location's state decides; other covered states are offered, never applied", () => {
    // A California location with a Texas certificate: nothing suggested, Texas offered.
    expect(suggestExemption({ storeCountry: "US", buyerCountry: "US", buyerRegion: "CA", certificateType: "resale", certificateRegion: "TX" }))
      .toEqual({ exemption: null, reason: "us_state_not_covered", alsoCovered: ["US_TX_RESELLER_EXEMPTION"] });
    // A multistate certificate (one row per state) for a buyer located in Nevada.
    expect(suggestExemption({ storeCountry: "US", buyerCountry: "US", buyerRegion: "NV", coveredStates: ["NV", "TX", "CA"] }))
      .toEqual({ exemption: "US_NV_RESELLER_EXEMPTION", reason: "us_resale_certificate", alsoCovered: ["US_TX_RESELLER_EXEMPTION", "US_CA_RESELLER_EXEMPTION"] });
  });

  it("A1 states without a statewide sales tax: nothing to exempt (Alaska still offered: local taxes)", () => {
    for (const st of ["OR", "DE", "MT", "NH"]) {
      expect(suggestExemption({ storeCountry: "US", buyerCountry: "US", buyerRegion: st, coveredStates: [st, "WA"] }))
        .toEqual({ exemption: null, reason: "no_state_sales_tax", alsoCovered: ["US_WA_RESELLER_EXEMPTION"] });
    }
    expect(suggestExemption({ storeCountry: "US", buyerCountry: "US", buyerRegion: "AK", coveredStates: ["AK"] }))
      .toEqual({ exemption: "US_AK_RESELLER_EXEMPTION", reason: "us_resale_local_only", alsoCovered: [] });
  });

  it("A4 a tax-exempt organisation gets no automatic exemption (Shopify has no value for it)", () => {
    expect(suggestExemption({ storeCountry: "US", buyerCountry: "US", buyerRegion: "IL", exemptOrg: true })).toEqual({ exemption: null, reason: "us_exempt_org" });
  });

  it("acceptance 10: verified German VAT for a French store → EU reverse charge", () => {
    expect(suggestExemption({ storeCountry: "FR", buyerCountry: "DE", vatVerified: true }).exemption).toBe("EU_REVERSE_CHARGE_EXEMPTION_RULE");
  });

  it("does not suggest reverse charge when unverified, domestic, or store outside the EU", () => {
    expect(suggestExemption({ storeCountry: "FR", buyerCountry: "DE", vatVerified: false }).exemption).toBeNull();
    expect(suggestExemption({ storeCountry: "DE", buyerCountry: "DE", vatVerified: true }).exemption).toBeNull();
    expect(suggestExemption({ storeCountry: "US", buyerCountry: "DE", vatVerified: true }).exemption).toBeNull();
  });
});
