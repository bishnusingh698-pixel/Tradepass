// Regenerates extensions/tradepass-theme/snippets/tradepass-form-texts.liquid from the form.* keys in
// extensions/tradepass-theme/locales/en.default.json (tests/storefront-extension.test.ts checks it).
//   node scripts/theme-form-texts.mjs
import { readFileSync, writeFileSync } from "node:fs";

const flatten = (o, p = "", out = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
};
const en = flatten(JSON.parse(readFileSync("extensions/tradepass-theme/locales/en.default.json", "utf8")));
const keys = Object.keys(en).filter((k) => k.startsWith("form."));
const phs = [...new Set(keys.flatMap((k) => [...String(en[k]).matchAll(/\{\{ (\w+) \}\}/g)].map((m) => m[1])))].sort();
const lines = keys.map((k) => {
  const own = [...new Set([...String(en[k]).matchAll(/\{\{ (\w+) \}\}/g)].map((m) => m[1]))];
  const args = own.length ? `: ${own.map((p) => `${p}: tp_ph_${p}`).join(", ")}` : "";
  return `  "${k}": {{ "${k}" | t${args} | json }}`;
});
const out = `{%- comment -%}
  GENERATED from locales/en.default.json (form.* keys) by scripts/theme-form-texts.mjs - tests/storefront-extension.test.ts
  checks it stays in sync. Prints a JSON object of the built-in form strings in the visitor language.
  Placeholders are passed through literally so the form script fills them in.
{%- endcomment -%}
${phs.map((p) => `{%- capture tp_ph_${p} -%}{% raw %}{{ ${p} }}{% endraw %}{%- endcapture -%}`).join("\n")}
{
${lines.join(",\n")}
}
`;
writeFileSync("extensions/tradepass-theme/snippets/tradepass-form-texts.liquid", out);
console.log(`${keys.length} keys, placeholders: ${phs.join(", ")}`);
