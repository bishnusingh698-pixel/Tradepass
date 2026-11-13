// Official places where a merchant can check a business tax number by hand (E24). Shown in the admin
// next to the number whenever the live check didn't verify it, couldn't run (no key, Free plan) or the
// country has no free machine-readable registry. Government sites only; links, no scraping.
import { EU_COUNTRIES } from "./tax";

export type Registry = { url: string; live: "vies" | "hmrc" | "abr" | "brreg" | "nzbn" | null };

const VIES = "https://ec.europa.eu/taxation_customs/vies/";

export const TAX_REGISTRIES: Record<string, Registry> = {
  GB: { url: "https://www.gov.uk/check-uk-vat-number", live: "hmrc" },
  AU: { url: "https://abr.business.gov.au/", live: "abr" },
  NO: { url: "https://www.brreg.no/", live: "brreg" },
  NZ: { url: "https://www.nzbn.govt.nz/", live: "nzbn" },
  // The UID register's SOAP web service exists (20 calls a minute) but its request format couldn't be
  // confirmed from the official documentation here: link only until verified (ROADMAP).
  CH: { url: "https://www.uid.admin.ch/", live: null },
  // CRA's GST/HST Registry is a web form only (first nine digits of the number).
  CA: { url: "https://www.canada.ca/en/revenue-agency/services/e-services/digital-services-businesses/confirming-a-gst-hst-account-number.html", live: null },
};

/** The official lookup for a country, or null when Tradepass knows none. */
export function registryFor(country: string | null | undefined): Registry | null {
  const c = (country ?? "").toUpperCase();
  if (TAX_REGISTRIES[c]) return TAX_REGISTRIES[c];
  if (EU_COUNTRIES.has(c) || c === "XI") return { url: VIES, live: "vies" };
  return null;
}

/** "ec.europa.eu" — what the link says, so the merchant sees it's a government site. */
export function registryHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
