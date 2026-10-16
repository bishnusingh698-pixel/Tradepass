// All admin / hosted-page / email catalogs, bundled at build time.
// Layout: app/locales/<locale>/<namespace>.json, each a flat { key: ICU message }.
// Namespaces are merged per locale. English is the source; `_context` holds
// translator notes and is not a locale.
export type Messages = Record<string, string>;

const modules = import.meta.glob<{ default: Messages }>("../../locales/*/*.json", { eager: true });

export const catalogs: Record<string, Messages> = {};
for (const [path, mod] of Object.entries(modules)) {
  const locale = path.split("/").slice(-2)[0];
  if (locale.startsWith("_")) continue;
  Object.assign((catalogs[locale] ??= {}), mod.default);
}

export const context: Record<string, { note: string; maxLength: number; placeholders: string[] }> = {};
for (const [path, mod] of Object.entries(modules)) {
  if (path.includes("/_context/")) Object.assign(context, mod.default as unknown as typeof context);
}
