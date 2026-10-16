import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { EMBED_HANDLE, FORM_BLOCK_HANDLE } from "../app/lib/theme";

const DIR = "extensions/tradepass-theme";
const read = (p: string) => readFileSync(join(DIR, p), "utf8");
type Json = Record<string, unknown>;
const flatten = (o: Json, p = "", out: Record<string, string> = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flatten(v as Json, key, out);
  }
  return out;
};
const en = flatten(JSON.parse(read("locales/en.default.json")));
const schema = flatten(JSON.parse(read("locales/en.default.schema.json")));

describe("theme app extension budgets (hard constraint 7, Shopify limits)", () => {
  it("embed script is ≤ 20 KB gzipped (target ≤ 10 KB, Shopify's suggestion)", () => {
    const gz = gzipSync(readFileSync(join(DIR, "assets/tradepass.js"))).length;
    expect(gz).toBeLessThanOrEqual(10 * 1024);
  });
  it("form script stays small (loaded only on the application page)", () => {
    expect(gzipSync(readFileSync(join(DIR, "assets/tradepass-form.js"))).length).toBeLessThanOrEqual(20 * 1024);
  });
  it("locale files are ≤ 15 KB and Liquid ≤ 100 KB in total", () => {
    for (const f of readdirSync(join(DIR, "locales"))) expect(statSync(join(DIR, "locales", f)).size, f).toBeLessThanOrEqual(15 * 1024);
    // Leave room for translations that are longer in bytes (UTF-8 scripts): English must stay well under the cap.
    expect(statSync(join(DIR, "locales/en.default.json")).size).toBeLessThanOrEqual(7 * 1024);
    let liquid = 0;
    for (const d of ["blocks", "snippets"]) for (const f of readdirSync(join(DIR, d))) liquid += statSync(join(DIR, d, f)).size;
    expect(liquid).toBeLessThanOrEqual(100 * 1024);
  });
});

describe("extension structure", () => {
  it("has the block handles Home links to", () => {
    const blocks = readdirSync(join(DIR, "blocks"));
    expect(blocks).toContain(`${EMBED_HANDLE}.liquid`);
    expect(blocks).toContain(`${FORM_BLOCK_HANDLE}.liquid`);
    expect(read(`blocks/${EMBED_HANDLE}.liquid`)).toMatch(/"target": "body"/);
    expect(read(`blocks/${FORM_BLOCK_HANDLE}.liquid`)).toMatch(/"target": "section"/);
  });

  it("every t: key in block schemas exists in en.default.schema.json and every | t key in en.default.json", () => {
    for (const f of readdirSync(join(DIR, "blocks"))) {
      const src = read(`blocks/${f}`);
      for (const m of src.matchAll(/"t:([a-z_.]+)"/g)) expect(schema[m[1]], `${f} ${m[1]}`).toBeTypeOf("string");
      for (const m of src.matchAll(/'([a-z_]+(?:\.[a-zA-Z_0-9-]+)+)' \| t\b/g)) expect(en[m[1]], `${f} ${m[1]}`).toBeTypeOf("string");
    }
  });

  it("the generated form-texts snippet lists exactly the form.* keys", () => {
    const snippet = read("snippets/tradepass-form-texts.liquid");
    const listed = [...snippet.matchAll(/^ {2}"(form\.[^"]+)":/gm)].map((m) => m[1]).sort();
    expect(listed).toEqual(Object.keys(en).filter((k) => k.startsWith("form.")).sort());
    for (const [k, v] of Object.entries(en)) {
      for (const ph of v.matchAll(/\{\{ (\w+) \}\}/g)) if (k.startsWith("form.")) expect(snippet).toContain(`"${k}" | t: ${ph[1]}: tp_ph_${ph[1]}`);
    }
  });

  it("every literal string key the form script uses exists in the locale file", () => {
    const js = read("assets/tradepass-form.js");
    const keys = [...js.matchAll(/tx\("(form\.[a-z_.A-Z]+)"/g)].map((m) => m[1]).filter((k) => !k.endsWith("."));
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) expect(en[k], k).toBeTypeOf("string");
    // Dynamic families
    for (const z of ["state", "province", "region", "county", "prefecture", "emirate", "governorate", "state_and_territory"]) expect(en[`form.address.zone.${z}`]).toBeTruthy();
    for (const z of ["postal", "zip", "pin", "postcode"]) expect(en[`form.address.zip.${z}`]).toBeTruthy();
    for (const k of ["vat", "abn", "gst", "us_resale", "tax_id"]) expect(en[`form.tax.${k}`]).toBeTruthy();
  });

  it("embed Liquid and script share the default selectors", () => {
    const js = read("assets/tradepass.js");
    const liquid = read(`blocks/${EMBED_HANDLE}.liquid`);
    const def = (k: string) => new RegExp(`${k}: (["'])(.+?)\\1,?\\n`).exec(js)![2].replace(/\\"/g, '"');
    expect(liquid).toContain(`assign tp_price = '${def("price")}'`);
    expect(liquid).toContain(`assign tp_atc = '${def("addToCart")}'`);
    expect(liquid).toContain(`assign tp_card = '${def("productCard")}'`);
  });

  it("country data has zones with codes for the countries that need them", () => {
    const c = JSON.parse(read("assets/tradepass-countries.json")) as Record<string, { n: string; k?: string; r?: [string, string][]; z?: string | 0 }>;
    expect(c.US.r!.find((z) => z[0] === "TX")).toEqual(["TX", "Texas"]);
    expect(c.CA.k).toBe("province");
    expect(c.DE.r).toBeUndefined();
    expect(c.US.z).toBe("zip");
    expect(Object.keys(c).length).toBeGreaterThan(200);
  });
});
