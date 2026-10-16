import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogs } from "../app/lib/i18n/catalog";

// Every literal t("…") key used in the app must exist in English, so no
// screen ever shows a raw key. Template keys (t(`a.${b}`)) are checked by
// their static prefix: at least one English key must start with it.

const en = catalogs.en as Record<string, string>;
const keys = Object.keys(en);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(f) ? [p] : [];
  });
}

const sources = files("app").map((f) => ({ f, src: readFileSync(f, "utf8") }));

describe("i18n keys used in code", () => {
  it("every literal key exists in English", () => {
    const missing: string[] = [];
    for (const { f, src } of sources) {
      for (const m of src.matchAll(/\bt\(\s*"([a-zA-Z][\w-]*(?:\.[\w-]+)+)"/g)) {
        if (!(m[1] in en)) missing.push(`${f}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every template key prefix matches some English key", () => {
    const missing: string[] = [];
    for (const { f, src } of sources) {
      for (const m of src.matchAll(/\bt\(\s*`([a-zA-Z][\w.-]*)\$\{/g)) {
        if (!keys.some((k) => k.startsWith(m[1]))) missing.push(`${f}: ${m[1]}…`);
      }
    }
    expect(missing).toEqual([]);
  });
});
