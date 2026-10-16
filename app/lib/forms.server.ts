import db from "../db.server";
import { gql, type Admin } from "./gql.server";
import { defaultFormDefinition, type FormDefinition } from "./form-defaults";
import { LIMITS, sanitizeDefinition, validateDefinition, type FormError } from "../components/form-builder/model";
import { can, type PlanId } from "./plans";

export { validateDefinition, sanitizeDefinition, type FormError };

export type FormSummary = { id: string; name: string; isDefault: boolean; suggestedTierId: string | null; updatedAt: Date; fieldCount: number };

/** Stored definitions may predate a field we added; fill the top-level blocks so the builder never crashes. */
export function readDefinition(stored: unknown): FormDefinition {
  const def = sanitizeDefinition(stored);
  return def ?? defaultFormDefinition();
}

export async function listForms(shop: string): Promise<FormSummary[]> {
  const rows = await db.form.findMany({ where: { shop }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isDefault: r.isDefault,
    suggestedTierId: r.suggestedTierId,
    updatedAt: r.updatedAt,
    fieldCount: readDefinition(r.definition).sections.reduce((n, s) => n + s.fields.filter((f) => f.state !== "hidden").length, 0),
  }));
}

export async function getForm(shop: string, id: string) {
  const row = await db.form.findFirst({ where: { shop, id } });
  if (!row) return null;
  return { id: row.id, name: row.name, isDefault: row.isDefault, suggestedTierId: row.suggestedTierId, definition: readDefinition(row.definition) };
}

export type SaveFormInput = { name: string; suggestedTierId: string | null; definition: unknown };
export type SaveResult = { ok: true; definition: FormDefinition } | { ok: false; errors: FormError[] };

/** Parse, sanitise and validate what the builder posted. Pure apart from the tier lookup. */
export async function checkFormInput(shop: string, input: SaveFormInput): Promise<SaveResult> {
  const def = sanitizeDefinition(input.definition);
  if (!def) return { ok: false, errors: [{ code: "invalid", anchor: "fb-sections" }] };
  const errors = validateDefinition(def);
  const name = input.name.trim();
  if (!name || name.length > LIMITS.formName) errors.push({ code: "nameRequired", anchor: "fb-form-name" });
  if (input.suggestedTierId) {
    const tier = await db.tier.findFirst({ where: { shop, id: input.suggestedTierId }, select: { id: true } });
    if (!tier) errors.push({ code: "invalid", anchor: "fb-suggested-tier" });
  }
  return errors.length ? { ok: false, errors } : { ok: true, definition: def };
}

export async function saveForm(shop: string, id: string, input: SaveFormInput): Promise<SaveResult> {
  const checked = await checkFormInput(shop, input);
  if (!checked.ok) return checked;
  const res = await db.form.updateMany({
    where: { shop, id },
    data: { name: input.name.trim(), suggestedTierId: input.suggestedTierId || null, definition: checked.definition as object },
  });
  if (res.count === 0) return { ok: false, errors: [{ code: "invalid", anchor: "fb-sections" }] };
  return checked;
}

/** Extra forms are Pro (spec §D). The first form always exists (created on install). */
export async function createForm(shop: string, plan: PlanId, name: string): Promise<{ id: string } | { error: "plan" | "name" }> {
  const count = await db.form.count({ where: { shop } });
  if (count > 0 && !can(plan, "multiple_forms")) return { error: "plan" };
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > LIMITS.formName) return { error: "name" };
  const row = await db.form.create({ data: { shop, name: trimmed, isDefault: count === 0, definition: defaultFormDefinition() as object } });
  return { id: row.id };
}

/** The default form can't be deleted: the storefront form block falls back to it. */
export async function deleteForm(shop: string, id: string): Promise<boolean> {
  const res = await db.form.deleteMany({ where: { shop, id, isDefault: false } });
  return res.count > 0;
}

export async function setDefaultForm(shop: string, id: string): Promise<boolean> {
  const target = await db.form.findFirst({ where: { shop, id }, select: { id: true } });
  if (!target) return false;
  await db.$transaction([
    db.form.updateMany({ where: { shop, isDefault: true }, data: { isDefault: false } }),
    db.form.updateMany({ where: { shop, id }, data: { isDefault: true } }),
  ]);
  return true;
}

export type ShopLocale = { locale: string; primary: boolean; published: boolean };

/** Store languages (needs read_locales). Published first, primary at the top. */
export async function getShopLocales(admin: Admin): Promise<ShopLocale[]> {
  try {
    const data = await gql<{ shopLocales: ShopLocale[] }>(admin, `#graphql
      query TradepassShopLocales { shopLocales { locale primary published } }`);
    return [...data.shopLocales].sort((a, b) => Number(b.primary) - Number(a.primary) || Number(b.published) - Number(a.published));
  } catch {
    return []; // the page still works with the built-in language list
  }
}
