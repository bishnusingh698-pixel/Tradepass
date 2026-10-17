// Checks one or more locales against English: node scripts/i18n-check.mjs de fr
// App catalogs (app/locales/<locale>/*.json), theme extension locales and the
// App Store listing. Prints problems and exits 1 if there are any.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";

const SAME_OK = new Set(["app.name"]);
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const nsFiles = readdirSync("app/locales/en").filter((f) => f.endsWith(".json"));

function walk(els, out) {
  for (const el of els) {
    if ([TYPE.argument, TYPE.number, TYPE.date, TYPE.time].includes(el.type)) out.args.add(el.value);
    if (el.type === TYPE.plural || el.type === TYPE.select) {
      out.args.add(el.value);
      if (el.type === TYPE.plural) out.plurals.push(Object.keys(el.options).filter((k) => !k.startsWith("=")));
      for (const o of Object.values(el.options)) walk(o.value, out);
    }
    if (el.type === TYPE.tag) walk(el.children, out);
  }
  return out;
}
const analyse = (m) => walk(parse(m), { args: new Set(), plurals: [] });
const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}
const liquidVars = (s) => new Set([...String(s).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]));

let problems = 0;
const bad = (loc, msg) => {
  problems++;
  console.log(`${loc}: ${msg}`);
};

for (const loc of process.argv.slice(2)) {
  const cats = new Intl.PluralRules(loc).resolvedOptions().pluralCategories;
  for (const f of nsFiles) {
    const en = read(`app/locales/en/${f}`);
    const p = `app/locales/${loc}/${f}`;
    if (!existsSync(p)) { bad(loc, `missing file ${p}`); continue; }
    const tr = read(p);
    for (const k of Object.keys(en)) if (!(k in tr)) bad(loc, `${f}: missing ${k}`);
    for (const k of Object.keys(tr)) if (!(k in en)) bad(loc, `${f}: extra ${k}`);
    for (const [k, msg] of Object.entries(tr)) {
      if (!(k in en)) continue;
      let a;
      try { a = analyse(msg); } catch (e) { bad(loc, `${k}: ICU error ${e.message}`); continue; }
      if (!same(a.args, analyse(en[k]).args)) bad(loc, `${k}: placeholders differ`);
      for (const pl of a.plurals) for (const c of cats) if (!pl.includes(c)) bad(loc, `${k}: plural missing "${c}"`);
      if (msg === en[k] && !SAME_OK.has(k)) bad(loc, `${k}: same as English`);
    }
  }
  for (const [kind, enFile] of [["", "en.default.json"], [".schema", "en.default.schema.json"]]) {
    const dir = "extensions/tradepass-theme/locales";
    const enT = flatten(read(`${dir}/${enFile}`));
    const p = `${dir}/${loc}${kind}.json`;
    if (!existsSync(p)) { bad(loc, `missing ${p}`); continue; }
    if (statSync(p).size > 15000) bad(loc, `${p} is over 15 KB`);
    const tr = flatten(read(p));
    for (const k of Object.keys(enT)) if (!(k in tr)) bad(loc, `${p}: missing ${k}`);
    for (const k of Object.keys(tr)) if (!(k in enT)) bad(loc, `${p}: extra ${k}`);
    for (const [k, v] of Object.entries(tr)) if (k in enT && !same(liquidVars(v), liquidVars(enT[k]))) bad(loc, `${p}: ${k} variables differ`);
  }
  const lp = `docs/listing/${loc}.json`;
  if (!existsSync(lp)) bad(loc, `missing ${lp}`);
  else {
    const l = read(lp);
    if (!l.subtitle || l.subtitle.length > 100) bad(loc, "listing subtitle missing or over 100 characters");
    if (!l.description) bad(loc, "listing description missing");
  }
}
console.log(problems ? `${problems} problem(s)` : "OK");
process.exit(problems ? 1 : 0);
