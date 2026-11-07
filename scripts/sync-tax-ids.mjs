// Copies the tax-ID table (app/lib/tax-ids.json) into the theme extension's
// country data, as `t: [name, example, pattern, prefix, strict]` per country.
// Run after editing the table: node scripts/sync-tax-ids.mjs
// Also copies the offline check digits into the storefront form script.
// tests/tax-ids.test.ts and tests/review-2026-11.test.ts fail if they drift apart.
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

// The offline check digits (app/lib/tax-checksums.js) run in the storefront form too.
const START = "/* checksums:start */";
const END = "/* checksums:end */";
const lib = readFileSync("app/lib/tax-checksums.js", "utf8");
const code = lib.slice(lib.indexOf(START) + START.length, lib.indexOf(END)).trim();
const formPath = "extensions/tradepass-theme/assets/tradepass-form.js";
const form = readFileSync(formPath, "utf8");
const a = form.indexOf(START);
const b = form.indexOf(END);
if (a < 0 || b < 0) throw new Error("checksum markers missing in " + formPath);
writeFileSync(formPath, form.slice(0, a + START.length) + "\n  " + code.replace(/\n/g, "\n  ") + "\n  " + form.slice(b));
console.log("check digits synced into", formPath);
