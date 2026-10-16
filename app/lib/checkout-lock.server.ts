import { gql, mutate, type Admin } from "./gql.server";
import type { Settings } from "./settings";
import { createT } from "./i18n";
import { logActivity } from "./activity.server";

// Wholesale-only checkout lock (spec §I mode 3). The Function lives in
// extensions/tradepass-checkout-lock; here we create/enable/disable its
// Validation and write its config into app-owned JSON metafields on the
// Validation (the Function reads metafields of its owner). App-owned
// metafields and the Function itself are removed by Shopify on uninstall, so
// the lock stops then (see docs/notes/automation.md).

export const FUNCTION_HANDLE = "tradepass-checkout-lock";
export const LOCK_NAMESPACE = "$app:tradepass";
export const MESSAGE_KEY = "automation.checkoutLock.message";
const TITLE = "Tradepass wholesale-only checkout";
// Shopify rejects GraphQL list variables over 100 items in Function input queries.
const MAX_EXEMPT_TAGS = 100;

export type LockConfig = { enabled: boolean; messages: Record<string, string>; defaultLocale: string };
export type LockVars = { exemptTags: string[] };

/** Exempt tags as the Function receives them: trimmed, unique, at most 100. */
export function exemptTags(settings: Settings): string[] {
  const out: string[] = [];
  for (const raw of settings.storefront.exemptCustomerTags) {
    const tag = raw.trim();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, MAX_EXEMPT_TAGS);
}

/**
 * Block message per published store language: merchant override for that
 * language, else our built-in translation, else the primary language, else
 * English (same order as every other text, see i18n/createT). English is
 * always included as the Function's last resort.
 */
export function buildLockConfig(settings: Settings, locales: string[], primary: string, enabled: boolean): LockConfig {
  const messages: Record<string, string> = {};
  for (const locale of new Set([...locales, primary, "en"])) {
    messages[locale] = createT(locale, { primary, overrides: settings.texts }).t(MESSAGE_KEY);
  }
  return { enabled, messages, defaultLocale: primary };
}

type ValidationNode = { id: string; enabled: boolean; shopifyFunction: { handle: string; appKey: string } };

/** Our Validation, if one exists (a store holds at most 25, so one page is enough). */
export async function findLockValidation(admin: Admin): Promise<ValidationNode | null> {
  const data = await gql<{ validations: { nodes: ValidationNode[] } }>(
    admin,
    `#graphql
    query TradepassValidations { validations(first: 25) { nodes { id enabled shopifyFunction { handle appKey } } } }`,
  );
  const apiKey = process.env.SHOPIFY_API_KEY;
  return (
    data.validations.nodes.find(
      (v) => v.shopifyFunction.handle === FUNCTION_HANDLE && (!apiKey || v.shopifyFunction.appKey === apiKey),
    ) ?? null
  );
}

async function storeLocales(admin: Admin): Promise<{ locales: string[]; primary: string }> {
  const data = await gql<{ shopLocales: { locale: string; primary: boolean; published: boolean }[] }>(
    admin,
    `#graphql
    query TradepassShopLocales { shopLocales { locale primary published } }`,
  );
  const primary = data.shopLocales.find((l) => l.primary)?.locale ?? "en";
  return { locales: data.shopLocales.filter((l) => l.published || l.primary).map((l) => l.locale), primary };
}

function metafields(config: LockConfig, vars: LockVars) {
  return [
    { namespace: LOCK_NAMESPACE, key: "lock_config", type: "json", value: JSON.stringify(config) },
    { namespace: LOCK_NAMESPACE, key: "lock_vars", type: "json", value: JSON.stringify(vars) },
  ];
}

const CREATE = `#graphql
mutation TradepassLockCreate($validation: ValidationCreateInput!) {
  validationCreate(validation: $validation) { validation { id enabled } userErrors { field message code } }
}`;
const UPDATE = `#graphql
mutation TradepassLockUpdate($id: ID!, $validation: ValidationUpdateInput!) {
  validationUpdate(id: $id, validation: $validation) { validation { id enabled } userErrors { field message code } }
}`;

/**
 * Make the wholesale-only checkout validation match settings: create/enable it
 * when accessMode is "wholesale_only", disable it otherwise, and write its
 * config (translated messages, exempt customer tags) where the Function reads it.
 * Throws on Shopify errors so the caller can tell the merchant the lock did not change.
 */
export async function ensureCheckoutLock(admin: Admin, shop: string, settings: Settings): Promise<{ active: boolean }> {
  const wanted = settings.storefront.accessMode === "wholesale_only";
  const existing = await findLockValidation(admin);
  if (!wanted && !existing) return { active: false };

  const { locales, primary } = await storeLocales(admin);
  const fields = metafields(buildLockConfig(settings, locales, primary, wanted), { exemptTags: exemptTags(settings) });

  try {
    let active: boolean;
    if (existing) {
      const res = await mutate<{ validation: { enabled: boolean } }>(admin, "validationUpdate", UPDATE, {
        id: existing.id,
        validation: { enable: wanted, metafields: fields },
      });
      active = res.validation.enabled;
    } else {
      // blockOnFailure false: if the Function itself errors (timeout), checkout is not blocked
      // for everyone, including B2B buyers. See DECISIONS proposal in docs/notes/automation.md.
      const res = await mutate<{ validation: { enabled: boolean } }>(admin, "validationCreate", CREATE, {
        validation: { functionHandle: FUNCTION_HANDLE, title: TITLE, enable: true, blockOnFailure: false, metafields: fields },
      });
      active = res.validation.enabled;
    }
    if (existing?.enabled !== active) {
      await logActivity({ shop, actor: "system", action: active ? "checkout_lock.enable" : "checkout_lock.disable" });
    }
    return { active };
  } catch (e) {
    await logActivity({
      shop,
      actor: "system",
      action: wanted ? "checkout_lock.enable" : "checkout_lock.disable",
      result: "failed",
      detail: { error: (e as Error).message.slice(0, 200) },
    }).catch(() => undefined);
    throw e;
  }
}
