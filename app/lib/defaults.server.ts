import db from "../db.server";
import { defaultFormDefinition } from "./form-defaults";

/** Create first-run defaults only if they don't exist yet (safe on reinstall). */
export async function ensureDefaults(shop: string): Promise<void> {
  const existing = await db.form.count({ where: { shop } });
  if (existing > 0) return;
  await db.form.create({
    data: { shop, name: "Wholesale application", isDefault: true, definition: defaultFormDefinition() },
  });
}
