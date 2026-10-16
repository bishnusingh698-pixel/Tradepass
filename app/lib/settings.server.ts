import db from "../db.server";
import { patchSettings, readSettings, SETTINGS_VERSION, type DeepPartial, type Settings } from "./settings";

export async function getSettings(shop: string): Promise<Settings> {
  const row = await db.shop.findUnique({ where: { shop }, select: { settings: true } });
  return readSettings(row?.settings ?? {});
}

export async function updateSettings(shop: string, patch: DeepPartial<Settings>): Promise<Settings> {
  const next = patchSettings(await getSettings(shop), patch);
  await db.shop.update({ where: { shop }, data: { settings: next as object, settingsVersion: SETTINGS_VERSION } });
  return next;
}

/** Replace the whole `texts` map (a deep patch can't remove keys). */
export async function setTexts(shop: string, texts: Settings["texts"]): Promise<Settings> {
  const next = { ...(await getSettings(shop)), texts };
  await db.shop.update({ where: { shop }, data: { settings: next as object, settingsVersion: SETTINGS_VERSION } });
  return next;
}
