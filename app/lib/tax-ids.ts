// Business tax IDs per country (feature: country-aware form). One table drives
// the storefront form (label, example, inline check — synced into the theme's
// country data by scripts/sync-tax-ids.mjs) and the server check in intake.
// Client-safe: no Node APIs.
import table from "./tax-ids.json";

/** n = official name, ex = example, re = pattern for the normalised number, p = prefix added when missing, s = strict. */
export type TaxIdRule = { n: string; ex: string; re: string; p?: string; s: boolean };

export const TAX_ID_RULES: Record<string, TaxIdRule> = Object.fromEntries(
  Object.entries(table as Record<string, unknown>).filter(([k]) => /^[A-Z]{2}$/.test(k)),
) as Record<string, TaxIdRule>;

/** Upper case without spaces, dots, dashes or slashes ("DE 123.456.789" → "DE123456789"). */
export function normaliseTaxId(n: string): string {
  return n.replace(/[\s.\-/]/g, "").toUpperCase();
}

export type TaxIdFormat = "ok" | "invalid" | "unchecked";

/**
 * Check a number's shape for its country. "invalid" only for countries whose
 * format we know for certain (strict rules); everything else is "unchecked" so
 * an unusual but real number is never refused.
 */
export function checkTaxIdFormat(country: string | null | undefined, number: string): TaxIdFormat {
  const rule = country ? TAX_ID_RULES[country.toUpperCase()] : undefined;
  if (!rule || !rule.re) return "unchecked";
  let n = normaliseTaxId(number);
  if (!n) return "unchecked";
  if (rule.p && !n.startsWith(rule.p) && !/^[A-Z]{2}/.test(n)) n = rule.p + n;
  // Greece: VIES uses EL, people often type GR. Northern Ireland: XI.
  if (new RegExp(rule.re).test(n)) return "ok";
  return rule.s ? "invalid" : "unchecked";
}

/** Compact form for the storefront's country data: [name, example, pattern, prefix, strict]. */
export function storefrontTaxRule(rule: TaxIdRule): [string, string, string, string, 0 | 1] {
  return [rule.n, rule.ex, rule.re, rule.p ?? "", rule.s ? 1 : 0];
}
