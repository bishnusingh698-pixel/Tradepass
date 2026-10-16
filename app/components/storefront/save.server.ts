import db from "../../db.server";
import { getSettings, updateSettings } from "../../lib/settings.server";
import { SETTINGS_VERSION, type Settings } from "../../lib/settings";
import { mergeTextEdits, type StorefrontInput } from "./model";

/**
 * Save the Storefront page. Settings go through updateSettings; text overrides
 * are written as whole per-language maps, because patchSettings can only add
 * keys that already exist (it can't add a new language or remove an override
 * for "Reset to default").
 */
export async function saveStorefrontSettings(shop: string, input: StorefrontInput): Promise<{ before: Settings; after: Settings }> {
  const before = await getSettings(shop);
  let after = await updateSettings(shop, { storefront: input.storefront, onboarding: { storefrontReviewed: true } });
  const replaced = mergeTextEdits(after.texts, input.texts);
  if (Object.keys(replaced).length) {
    after = { ...after, texts: { ...after.texts, ...replaced } };
    await db.shop.update({ where: { shop }, data: { settings: after as object, settingsVersion: SETTINGS_VERSION } });
  }
  return { before, after };
}
