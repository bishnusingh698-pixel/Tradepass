import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

// Field names verified against Admin GraphQL 2026-10 (see API_NOTES.md §Plan).
export const SHOP_FACTS_QUERY = `#graphql
  query TradepassShopFacts {
    shop {
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
};

type FactsResponse = {
  data?: {
    shop: {
      plan: { publicDisplayName: string; partnerDevelopment: boolean; shopifyPlus: boolean };
      features: { directConnectionCatalogAssignmentEnabled: boolean };
      entitlements: {
        b2b: { enabled: boolean };
        markets: { b2b: { enabled: boolean; catalogs: { enabled: boolean; limit: number } } };
      };
    };
    shopLocales: { locale: string; primary: boolean; published: boolean }[];
    b2bMarkets?: { nodes: { id: string; catalogs: { nodes: { id: string }[] } }[] } | null;
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

export function parseShopFacts(json: FactsResponse): ShopFacts {
  const s = json.data?.shop;
  if (!s) throw new Error("Shop facts query returned no shop");
  const locales = json.data?.shopLocales ?? [];
  const b2bMarkets = s.entitlements.markets.b2b;
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
  };
}

/** Query Shopify for plan/B2B facts and store them. Called on install and on each Home load. */
export async function refreshShopFacts(shop: string, admin: AdminApiContext): Promise<ShopFacts> {
  const res = await admin.graphql(SHOP_FACTS_QUERY);
  const facts = parseShopFacts((await res.json()) as FactsResponse);
  const data = {
    planName: facts.planName,
    isPlus: facts.isPlus,
    isDevStore: facts.isDevStore,
    b2bEnabled: facts.b2bEnabled,
    b2bMarketsEnabled: facts.b2bMarketsEnabled,
    catalogLimit: facts.catalogLimit,
    directCatalogs: facts.directCatalogs,
    primaryLocale: facts.primaryLocale,
    checkedAt: new Date(),
  };
  // Upsert keeps reinstall clean: the row and its settings survive if shop/redact hasn't run yet.
  await db.shop.upsert({
    where: { shop },
    create: { shop, ...data },
    update: { ...data, uninstalledAt: null },
  });
  return facts;
}
