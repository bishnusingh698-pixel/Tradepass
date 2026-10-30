// Copies the tax-ID table (app/lib/tax-ids.json) into the theme extension's
// country data, as `t: [name, example, pattern, prefix, strict]` per country.
// Run after editing the table: node scripts/sync-tax-ids.mjs
// tests/tax-ids.test.ts fails if the two drift apart.
import { readFileSync, writeFileSync } from "node:fs";

const table = JSON.parse(readFileSync("app/lib/tax-ids.json", "utf8"));
const path = "extensions/tradepass-theme/assets/tradepass-countries.json";
const countries = JSON.parse(readFileSync(path, "utf8"));
for (const [code, c] of Object.entries(countries)) {
  const r = table[code];
  if (r && r.re) c.t = [r.n, r.ex, r.re, r.p ?? "", r.s ? 1 : 0];
  else delete c.t;
}
writeFileSync(path, JSON.stringify(countries));
console.log("tax IDs synced into", path);
