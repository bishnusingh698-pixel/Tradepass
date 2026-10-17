// Tier input shape and validation, shared by the tier editor (browser) and tiers.server.ts.

export type TierInput = {
  name: string;
  buyerNames: Record<string, string>;
  pricing: { kind: "percent"; pct: number } | { kind: "existing"; catalogGid: string };
  products: { kind: "all" } | { kind: "collections"; ids: string[] };
  paymentTermsTemplateId: string | null;
  checkoutToDraft: boolean;
  tax: "charge" | "exempt_on_file";
  /** Plus only: assign the catalog straight to company locations (no market). */
  direct: boolean;
};


export type TierFieldErrors = Partial<Record<"name" | "pct" | "catalog" | "collections", string>>;

/** Field errors as i18n keys (shown next to the field after interaction). */
export function validateTierInput(i: TierInput): TierFieldErrors {
  const e: TierFieldErrors = {};
  if (!i.name.trim()) e.name = "tiers.editor.error.nameRequired";
  else if (i.name.trim().length > 60) e.name = "tiers.editor.error.nameTooLong";
  if (i.pricing.kind === "percent") {
    const p = i.pricing.pct;
    if (!Number.isInteger(p) || p < 1 || p > 90) e.pct = "tiers.editor.error.pctRange";
  } else if (!i.pricing.catalogGid) e.catalog = "tiers.editor.error.catalogRequired";
  if (i.products.kind === "collections" && i.products.ids.length === 0) e.collections = "tiers.editor.error.collectionsRequired";
  return e;
}

