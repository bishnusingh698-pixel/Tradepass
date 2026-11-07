import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { isTestBilling, planForSubscriptionName, type PlanId } from "./plans";

// Field names verified against Admin GraphQL 2026-10 (see API_NOTES.md §Plan).
// One query gives everything Tradepass needs to know about the store: plan and
// B2B entitlements, the store profile used in messages and tax suggestions, and
// the app subscription that really exists in Shopify (the source of truth for
// billing — our own Shop.billingPlan is only a cache of it).
export const SHOP_FACTS_QUERY = `#graphql
  query TradepassShopFacts {
    shop {
      name
      currencyCode
      shopAddress { countryCodeV2 }
      primaryDomain { url }
      plan { publicDisplayName partnerDevelopment shopifyPlus }
      features { directConnectionCatalogAssignmentEnabled }
      entitlements {
        b2b { enabled }
        markets { b2b { enabled catalogs { enabled limit } } }
      }
    }
    shopLocales { locale primary published }
    b2bMarkets: markets(type: COMPANY_LOCATION, first: 50) {
      nodes { id name status catalogs(first: 10) { nodes { id } } }
    }
    currentAppInstallation {
      activeSubscriptions { id name status test trialDays createdAt }
    }
  }
`;

export type ShopFacts = {
  planName: string;
  isPlus: boolean;
  isDevStore: boolean;
  b2bEnabled: boolean;
  b2bMarketsEnabled: boolean;
  catalogLimit: number | null;
  directCatalogs: boolean;
  primaryLocale: string;
  publishedLocales: string[];
  catalogsUsed: number | null;
  profile: { name: string | null; currency: string | null; country: string | null; domainUrl: string | null };
  /** The subscription Shopify reports; undefined when the query didn't include it (older callers/tests). */
  subscription?: { gid: string | null; plan: PlanId; trialDays: number; createdAt: string | null; test: boolean };
};

type Subscription = { id: string; name: string; status: string; test?: boolean; trialDays?: number; createdAt?: string };

type FactsResponse = {
  data?: {
    shop: {
      name?: string | null;
      currencyCode?: string | null;
      shopAddress?: { countryCodeV2?: string | null } | null;
      primaryDomain?: { url?: string | null } | null;
      plan: { publicDisplayName: string; partnerDevelopment: boolean; shopifyPlus: boolean };
      features: { directConnectionCatalogAssignmentEnabled: boolean };
      entitlements: {
        b2b: { enabled: boolean };
        markets: { b2b: { enabled: boolean; catalogs: { enabled: boolean; limit: number } } };
      };
    };
    shopLocales: { locale: string; primary: boolean; published: boolean }[];
    b2bMarkets?: { nodes: { id: string; catalogs: { nodes: { id: string }[] } }[] } | null;
    currentAppInstallation?: { activeSubscriptions?: Subscription[] | null } | null;
  };
  errors?: unknown;
};

/** Distinct catalogs attached to B2B (company location) markets — what the non-Plus cap counts, ours or not. */
export function countB2bCatalogs(
  markets: { catalogs: { nodes: { id: string }[] } }[] | undefined,
): number | null {
  if (!markets) return null;
  return new Set(markets.flatMap((m) => m.catalogs.nodes.map((c) => c.id))).size;
}

/** "https://shop.example.com/" → "https://shop.example.com"; anything that isn't an https URL → null. */
export function cleanDomainUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * The active Tradepass subscription. Test charges only count where Tradepass
 * itself creates test charges (development stores, BILLING_TEST staging), so a
 * leftover test charge can't unlock paid features on a live store.
 */
export function activeSubscription(subs: Subscription[] | null | undefined, isDevStore: boolean): ShopFacts["subscription"] {
  const active = (subs ?? []).find((s) => s.status === "ACTIVE" && (!s.test || isTestBilling(isDevStore)) && planForSubscriptionName(s.name) !== "free");
  if (!active) return { gid: null, plan: "free", trialDays: 0, createdAt: null, test: false };
  return { gid: active.id, plan: planForSubscriptionName(active.name), trialDays: active.trialDays ?? 0, createdAt: active.createdAt ?? null, test: Boolean(active.test) };
}

export function parseShopFacts(json: FactsResponse): ShopFacts {
  const s = json.data?.shop;
  if (!s) throw new Error("Shop facts query returned no shop");
  const locales = json.data?.shopLocales ?? [];
  const b2bMarkets = s.entitlements.markets.b2b;
  const installation = json.data?.currentAppInstallation;
  return {
    planName: s.plan.publicDisplayName,
    isPlus: s.plan.shopifyPlus,
    isDevStore: s.plan.partnerDevelopment,
    b2bEnabled: s.entitlements.b2b.enabled,
    b2bMarketsEnabled: b2bMarkets.enabled,
    // On Plus the limit is not meaningful for direct assignment; we still record it.
    catalogLimit: b2bMarkets.catalogs.enabled ? b2bMarkets.catalogs.limit : 0,
    directCatalogs: s.features.directConnectionCatalogAssignmentEnabled,
    primaryLocale: locales.find((l) => l.primary)?.locale ?? "en",
    publishedLocales: locales.filter((l) => l.published).map((l) => l.locale),
    catalogsUsed: countB2bCatalogs(json.data?.b2bMarkets?.nodes),
    profile: {
      name: s.name?.trim() || null,
      currency: s.currencyCode || null,
      country: s.shopAddress?.countryCodeV2 || null,
      domainUrl: cleanDomainUrl(s.primaryDomain?.url),
    },
    subscription: installation === undefined ? undefined : activeSubscription(installation?.activeSubscriptions, s.plan.partnerDevelopment),
  };
}

/**
 * Query Shopify for plan/B2B facts, the store profile and the real app
 * subscription, and store them. Called on install/reinstall and on each Home
 * load. Returns `planChanged` so callers can re-sync plan-dependent storefront parts.
 */
export async function refreshShopFacts(shop: string, admin: Pick<AdminApiContext, "graphql">): Promise<ShopFacts & { planChanged: boolean }> {
  const res = await admin.graphql(SHOP_FACTS_QUERY);
  const facts = parseShopFacts((await res.json()) as FactsResponse);
  const before = await db.shop.findUnique({ where: { shop }, select: { billingPlan: true, trialStartedAt: true } });
  const sub = facts.subscription;
  const data = {
    planName: facts.planName,
    isPlus: facts.isPlus,
    isDevStore: facts.isDevStore,
    b2bEnabled: facts.b2bEnabled,
    b2bMarketsEnabled: facts.b2bMarketsEnabled,
    catalogLimit: facts.catalogLimit,
    directCatalogs: facts.directCatalogs,
    primaryLocale: facts.primaryLocale,
    name: facts.profile.name,
    currency: facts.profile.currency,
    country: facts.profile.country,
    domainUrl: facts.profile.domainUrl,
    checkedAt: new Date(),
    ...(sub
      ? {
          billingPlan: sub.plan,
          subscriptionGid: sub.gid,
          // The trial is given once per store (D-019): remember when the first one started.
          ...(sub.trialDays > 0 && sub.createdAt && !before?.trialStartedAt ? { trialStartedAt: new Date(sub.createdAt) } : {}),
        }
      : {}),
  };
  // Upsert keeps reinstall clean: the row and its settings survive if shop/redact hasn't run yet.
  await db.shop.upsert({
    where: { shop },
    create: { shop, ...data },
    update: { ...data, uninstalledAt: null },
  });
  const planChanged = Boolean(sub) && (before?.billingPlan ?? "free") !== sub!.plan;
  return { ...facts, planChanged };
}

/**
 * refreshShopFacts for pages: if Shopify can't be reached right now, the page still opens with the
 * facts stored at the last successful check (`stale: true`) instead of failing with an error.
 */
export async function shopFactsOrStored(shop: string, admin: Pick<AdminApiContext, "graphql">): Promise<ShopFacts & { planChanged: boolean; stale: boolean }> {
  try {
    return { ...(await refreshShopFacts(shop, admin)), stale: false };
  } catch {
    const row = await db.shop.findUnique({ where: { shop } });
    return {
      planName: row?.planName ?? "",
      isPlus: Boolean(row?.isPlus),
      isDevStore: Boolean(row?.isDevStore),
      b2bEnabled: Boolean(row?.b2bEnabled),
      b2bMarketsEnabled: Boolean(row?.b2bMarketsEnabled),
      catalogLimit: row?.catalogLimit ?? null,
      directCatalogs: Boolean(row?.directCatalogs),
      primaryLocale: row?.primaryLocale ?? "en",
      publishedLocales: [],
      catalogsUsed: null,
      profile: { name: row?.name ?? null, currency: row?.currency ?? null, country: row?.country ?? null, domainUrl: row?.domainUrl ?? null },
      planChanged: false,
      stale: true,
    };
  }
}

/** Absolute storefront URL for a path ("/account/login"), on the store's own domain when known. */
export function storefrontUrl(row: { shop: string; domainUrl?: string | null } | null | undefined, path: string, fallbackShop?: string): string {
  if (/^https:\/\//i.test(path)) return path;
  const base = row?.domainUrl || `https://${row?.shop ?? fallbackShop ?? ""}`;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
