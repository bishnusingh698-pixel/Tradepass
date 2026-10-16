// The admin preview uses the real storefront renderer and the theme
// extension's own locale files, so what the merchant sees is what applicants
// get. Both are lazy chunks (one per language), and both may be missing while
// the extension is being built: callers show "Preview unavailable" then.

type Json = Record<string, unknown>;

const rendererModules = import.meta.glob<string>("/extensions/tradepass-theme/assets/tradepass-form.js", {
  query: "?raw",
  import: "default",
});
const styleModules = import.meta.glob<string>("/extensions/tradepass-theme/assets/tradepass-form.css", {
  query: "?raw",
  import: "default",
});
const localeModules = import.meta.glob<Json>("/extensions/tradepass-theme/locales/*.json", { import: "default" });

export const rendererAvailable = Object.keys(rendererModules).length > 0;

export async function loadRenderer(): Promise<{ script: string; style: string } | null> {
  const load = Object.values(rendererModules)[0];
  if (!load) return null;
  const loadStyle = Object.values(styleModules)[0];
  const [script, style] = await Promise.all([load(), loadStyle ? loadStyle() : Promise.resolve("")]);
  return { script, style };
}

/** Theme locale files are nested JSON; the renderer and our editors use flat dotted keys. */
export function flatten(obj: Json, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else if (v && typeof v === "object" && !Array.isArray(v)) flatten(v as Json, key, out);
  }
  return out;
}

function fileFor(locale: string): string | undefined {
  const paths = Object.keys(localeModules).filter((p) => !p.endsWith(".schema.json"));
  const name = (p: string) => p.split("/").pop()!.replace(/\.json$/, "").replace(/\.default$/, "").toLowerCase();
  const want = locale.toLowerCase();
  return paths.find((p) => name(p) === want) ?? paths.find((p) => name(p) === want.split("-")[0]);
}

const cache = new Map<string, Record<string, string>>();

/** Built-in storefront strings for a language, with English underneath for anything missing. */
export async function loadStorefrontTexts(locale: string): Promise<Record<string, string>> {
  const hit = cache.get(locale);
  if (hit) return hit;
  const enPath = fileFor("en");
  const ownPath = fileFor(locale);
  const [en, own] = await Promise.all([
    enPath ? localeModules[enPath]() : Promise.resolve({}),
    ownPath && ownPath !== enPath ? localeModules[ownPath]() : Promise.resolve({}),
  ]);
  const texts = { ...flatten(en), ...flatten(own) };
  cache.set(locale, texts);
  return texts;
}
