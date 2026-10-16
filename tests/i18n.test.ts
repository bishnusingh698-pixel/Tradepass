import { describe, expect, it } from "vitest";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { catalogs } from "../app/lib/i18n/catalog";
import { LOCALES, matchLocale, isRtl } from "../app/lib/i18n/locales";
import { createT } from "../app/lib/i18n";
import { pseudoLocalize } from "../app/lib/i18n/pseudo";

const en = catalogs.en as Record<string, string>;
// Strings allowed to equal English in every language (brand names, units).
const SAME_AS_ENGLISH_OK = new Set(["app.name"]);

function walk(els: MessageFormatElement[], out: { args: Set<string>; plurals: Set<string>[] }) {
  for (const el of els) {
    if (el.type === TYPE.argument || el.type === TYPE.number || el.type === TYPE.date || el.type === TYPE.time) out.args.add(el.value);
    if (el.type === TYPE.plural || el.type === TYPE.select) {
      out.args.add(el.value);
      if (el.type === TYPE.plural) out.plurals.push(new Set(Object.keys(el.options).filter((k) => !k.startsWith("="))));
      for (const opt of Object.values(el.options)) walk(opt.value, out);
    }
    if (el.type === TYPE.tag) walk(el.children, out);
  }
  return out;
}

const analyse = (msg: string) => walk(parse(msg), { args: new Set(), plurals: [] });

describe("translation catalogs", () => {
  it("ships exactly the 36 built-in locales", () => {
    expect(LOCALES).toHaveLength(36);
    expect(Object.keys(catalogs).sort()).toEqual([...LOCALES].sort());
  });

  for (const locale of LOCALES) {
    describe(locale, () => {
      const cat = catalogs[locale] as Record<string, string>;
      const required = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;

      it("has every English key and no extras", () => {
        expect(Object.keys(cat).sort()).toEqual(Object.keys(en).sort());
      });

      it("has valid ICU, matching placeholders and complete plurals", () => {
        for (const [key, msg] of Object.entries(cat)) {
          const a = analyse(msg);
          expect([...a.args].sort(), `${locale} ${key} placeholders`).toEqual([...analyse(en[key]).args].sort());
          for (const cats of a.plurals) {
            for (const c of required) expect(cats.has(c), `${locale} ${key} missing plural "${c}"`).toBe(true);
            expect(cats.has("other"), `${locale} ${key} needs "other"`).toBe(true);
          }
        }
      });

      if (locale !== "en") {
        it("has no untranslated strings", () => {
          const same = Object.keys(cat).filter((k) => cat[k] === en[k] && !SAME_AS_ENGLISH_OK.has(k));
          expect(same).toEqual([]);
        });
      }
    });
  }
});

describe("runtime", () => {
  it("formats plurals per locale", () => {
    expect(createT("en").t("home.pending.applications", { count: 1 })).toBe("1 application waiting");
    expect(createT("en").t("home.pending.applications", { count: 4 })).toBe("4 applications waiting");
    expect(createT("en").t("home.readiness.catalogBudget", { used: 2, limit: 3 })).toBe("2 of 3 B2B catalogs used");
  });

  it("falls back: unknown language → store primary → English, and overrides win", () => {
    expect(createT("xx", { primary: "de" }).locale).toBe("de");
    expect(createT("xx").locale).toBe("en");
    expect(createT("de", { overrides: { de: { "nav.home": "Start" } } }).t("nav.home")).toBe("Start");
  });

  it("matches regional tags and marks RTL", () => {
    expect(matchLocale("pt-br")).toBe("pt-BR");
    expect(matchLocale("pt")).toBe("pt-BR");
    expect(matchLocale("zh-Hant-HK")).toBe("zh-TW");
    expect(matchLocale("no")).toBe("nb");
    expect(matchLocale("uk")).toBeNull();
    for (const l of ["ar", "he", "ur"]) expect(isRtl(l)).toBe(true);
    expect(createT("ar").dir).toBe("rtl");
  });

  it("pseudo-localization keeps ICU valid and expands ~40%", () => {
    for (const [key, msg] of Object.entries(en)) {
      const p = pseudoLocalize(msg);
      expect(() => parse(p), key).not.toThrow();
      expect([...analyse(p).args].sort()).toEqual([...analyse(msg).args].sort());
    }
    expect(pseudoLocalize("Save").length).toBeGreaterThanOrEqual(Math.ceil("Save".length * 1.4));
  });
});
