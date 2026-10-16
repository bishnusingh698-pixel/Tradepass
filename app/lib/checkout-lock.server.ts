// CONTRACT (owner: automation/function area). Implementation replaces the stub body.
import type { Admin } from "./gql.server";
import type { Settings } from "./settings";

/**
 * Make the wholesale-only checkout validation match settings: create/enable it
 * when accessMode is "wholesale_only", disable it otherwise, and write its
 * config (translated messages, exempt customer tags) where the Function reads it.
 */
export async function ensureCheckoutLock(_admin: Admin, _shop: string, _settings: Settings): Promise<{ active: boolean }> {
  return { active: false };
}
