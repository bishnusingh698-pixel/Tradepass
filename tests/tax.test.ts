import { describe, expect, it } from "vitest";
import { suggestExemption, US_RESELLER_STATES, usResellerExemption } from "../app/lib/tax";

describe("tax exemption suggestions", () => {
  it("covers the 51 US reseller exemptions (50 states + DC)", () => {
    expect(US_RESELLER_STATES).toHaveLength(51);
    expect(usResellerExemption("tx")).toBe("US_TX_RESELLER_EXEMPTION");
    expect(usResellerExemption("PR")).toBeNull();
  });

  it("acceptance 10: Texas resale certificate → US_TX_RESELLER_EXEMPTION", () => {
    expect(suggestExemption({ storeCountry: "US", buyerCountry: "US", buyerRegion: "CA", certificateType: "resale", certificateRegion: "TX" }))
      .toEqual({ exemption: "US_TX_RESELLER_EXEMPTION", reason: "us_resale_certificate" });
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
