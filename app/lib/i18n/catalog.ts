import en from "../../locales/en.json";

export type Messages = typeof en;

// All admin/hosted-page catalogs, bundled at build time. Each file is a flat
// { key: ICU message } map; English is the source and the type of truth.
const modules = import.meta.glob<{ default: Partial<Messages> }>(
  "../../locales/*.json",
  { eager: true },
);

export const catalogs: Record<string, Partial<Messages>> = Object.fromEntries(
  Object.entries(modules)
    .map(([path, mod]) => [path.split("/").pop()!.replace(/\.json$/, ""), mod.default] as const)
    .filter(([name]) => !name.startsWith("_")),
);
