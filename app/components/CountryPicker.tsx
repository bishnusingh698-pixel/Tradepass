import { useMemo, useState } from "react";
import { sortedCountries } from "../lib/countries";
import { useI18n } from "../lib/i18n/react";

/**
 * Searchable, scrollable country checklist for forms that use the App Bridge
 * save bar: every country is a real checkbox named `name`, so FormData and the
 * save bar see changes; the search only hides rows, it never unchecks them.
 */
export function CountryPicker({ name, label, selected, error }: { name: string; label: string; selected: string[]; error?: string }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(selected));
  const all = useMemo(() => sortedCountries(locale), [locale]);
  const needle = q.trim().toLocaleLowerCase(locale);
  const match = (c: { code: string; name: string }) => !needle || c.name.toLocaleLowerCase(locale).includes(needle) || c.code.toLowerCase() === needle;
  const shown = all.filter(match).length;
  return (
    <s-stack direction="block" gap="small-200">
      <s-search-field
        label={label}
        placeholder={t("countries.search")}
        value={q}
        onInput={(e) => setQ((e.currentTarget as unknown as HTMLInputElement).value)}
      />
      <s-text color="subdued">{t("countries.selected", { count: picked.size })}</s-text>
      {error && <s-text tone="critical">{error}</s-text>}
      <div style={{ maxBlockSize: 280, overflowY: "auto", border: "1px solid var(--s-color-border, #e3e3e3)", borderRadius: 8, padding: 8 }} role="group" aria-label={label}>
        {all.map((c) => (
          <div key={c.code} style={match(c) ? undefined : { display: "none" }}>
            <s-checkbox
              name={name}
              value={c.code}
              label={c.name}
              defaultChecked={picked.has(c.code)}
              onChange={(e) => {
                const on = (e.currentTarget as unknown as HTMLInputElement).checked;
                setPicked((prev) => {
                  const next = new Set(prev);
                  if (on) next.add(c.code);
                  else next.delete(c.code);
                  return next;
                });
              }}
            />
          </div>
        ))}
        {shown === 0 && <s-text color="subdued">{t("countries.noMatch")}</s-text>}
      </div>
    </s-stack>
  );
}
