// CONTRACT (owner: storefront area). Implementation replaces the stub body.
import type { Admin } from "./gql.server";

/**
 * Write everything the storefront needs into app-owned metafields (access mode,
 * scope, texts per language, form definition, Function config) so the theme
 * extension and the validation Function work while our server sleeps.
 * Call after any change to storefront settings, forms, texts or tiers.
 */
export async function syncStorefrontConfig(_admin: Admin, _shop: string): Promise<void> {
  // stub: no-op until implemented
}
