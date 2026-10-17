/* eslint-disable @typescript-eslint/no-explicit-any -- GraphQL payloads are untyped JSON at this boundary */
import type { Tier } from "@prisma/client";
import db from "../db.server";
import { gql, mutate, numericId, paginate, UserErrorsError, type Admin } from "./gql.server";
import { logActivity } from "./activity.server";
import { withLock } from "./lock.server";
import { countB2bCatalogs } from "./shop.server";
import { maxTiers, type PlanId } from "./plans";
import { readSettings } from "./settings";
import type { TierInput } from "./tiers";

export { validateTierInput, type TierFieldErrors, type TierInput } from "./tiers";

// Tiers = a B2B market + catalog + price list (+ publication) on non-Plus
// stores, or a catalog assigned straight to company locations on Plus
// ("direct"). Every mutation and field here was checked against Admin GraphQL
// 2026-10 (docs/notes/tiers.md). Market writes go through one per-shop lock,
// are read back, and are retried on MARKET_UPDATE_CONCURRENT_MODIFICATION.

export type Ctx = { admin: Admin; shop: string; actor: string };

export const PLACEHOLDER_COMPANY_NAME = "Tradepass (do not delete)";
export const PLACEHOLDER_EXTERNAL_ID = "tradepass-placeholder";
export const MARKET_LOCK = "market";
export const ASSISTED_JOB = "assisted_assignment";

export type TierDefaults = {
  pricing: "percent" | "existing";
  products: "all" | "collections";
  collectionIds: string[];
  paymentTermsTemplateId: string | null;
  checkoutToDraft: boolean;
  tax: "charge" | "exempt_on_file";
  /** Which Shopify objects Tradepass created (only these are ever deleted). */
  created: { market?: boolean; catalog?: boolean; priceList?: boolean; publication?: boolean };
};

export function readDefaults(raw: unknown): TierDefaults {
  const d = (raw ?? {}) as Partial<TierDefaults>;
  return {
    pricing: d.pricing === "existing" ? "existing" : "percent",
    products: d.products === "collections" ? "collections" : "all",
    collectionIds: Array.isArray(d.collectionIds) ? d.collectionIds : [],
    paymentTermsTemplateId: d.paymentTermsTemplateId ?? null,
    checkoutToDraft: Boolean(d.checkoutToDraft),
    tax: d.tax === "exempt_on_file" ? "exempt_on_file" : "charge",
    created: d.created ?? {},
  };
}

export type TierErrorCode =
  | "plan_limit" | "catalog_limit" | "no_b2b" | "markets_unavailable" | "volume_pricing"
  | "catalog_in_use" | "has_buyers" | "not_found" | "missing_in_shopify" | "shopify";

/** Error with a code the UI translates (`tiers.error.<code>`); `detail` is Shopify's own message, no personal data. */
export class TierError extends Error {
  constructor(readonly code: TierErrorCode, readonly detail?: string) {
    super(`${code}${detail ? `: ${detail}` : ""}`);
    this.name = "TierError";
  }
}

export class AssignmentError extends Error {
  constructor(readonly code: "verify_failed" | "concurrent" | "busy" | "missing_in_shopify", detail?: string) {
    super(`${code}${detail ? `: ${detail}` : ""}`);
    this.name = "AssignmentError";
  }
}

const Q = {
  b2bMarkets: `#graphql
    query TierBudget { markets(type: COMPANY_LOCATION, first: 50) { nodes { id catalogs(first: 10) { nodes { id } } } } }`,
  currency: `#graphql query { shop { currencyCode } }`,
  priceListCreate: `#graphql
    mutation TierPriceList($input: PriceListCreateInput!) { priceListCreate(input: $input) {
      priceList { id } userErrors { field message code } } }`,
  priceListUpdate: `#graphql
    mutation TierPriceListUpdate($id: ID!, $input: PriceListUpdateInput!) { priceListUpdate(id: $id, input: $input) {
      priceList { id } userErrors { field message code } } }`,
  marketCreate: `#graphql
    mutation TierMarket($input: MarketCreateInput!) { marketCreate(input: $input) {
      market { id } userErrors { field message code } } }`,
  marketUpdate: `#graphql
    mutation TierMarketUpdate($id: ID!, $input: MarketUpdateInput!) { marketUpdate(id: $id, input: $input) {
      market { id } userErrors { field message code } } }`,
  marketDelete: `#graphql
    mutation TierMarketDelete($id: ID!) { marketDelete(id: $id) { deletedId userErrors { field message code } } }`,
  catalogCreate: `#graphql
    mutation TierCatalog($input: CatalogCreateInput!) { catalogCreate(input: $input) {
      catalog { id } userErrors { field message code } } }`,
  catalogUpdate: `#graphql
    mutation TierCatalogUpdate($id: ID!, $input: CatalogUpdateInput!) { catalogUpdate(id: $id, input: $input) {
      catalog { id } userErrors { field message code } } }`,
  catalogDelete: `#graphql
    mutation TierCatalogDelete($id: ID!) { catalogDelete(id: $id, deleteDependentResources: true) {
      deletedId userErrors { field message code } } }`,
  catalogContextUpdate: `#graphql
    mutation TierCatalogContext($catalogId: ID!, $add: CatalogContextInput, $remove: CatalogContextInput) {
      catalogContextUpdate(catalogId: $catalogId, contextsToAdd: $add, contextsToRemove: $remove) {
        catalog { id } userErrors { field message code } } }`,
  publicationCreate: `#graphql
    mutation TierPublication($input: PublicationCreateInput!) { publicationCreate(input: $input) {
      publication { id } userErrors { field message code } } }`,
  publicationUpdate: `#graphql
    mutation TierPublicationUpdate($id: ID!, $input: PublicationUpdateInput!) { publicationUpdate(id: $id, input: $input) {
      publication { id } userErrors { field message code } } }`,
  collectionProducts: `#graphql
    query TierCollectionProducts($id: ID!, $after: String) { collection(id: $id) {
      products(first: 250, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } } }`,
  catalogInfo: `#graphql
    query TierCatalogInfo($id: ID!) { catalog(id: $id) {
      __typename id title status priceList { id } publication { id }
      ... on MarketCatalog { markets(first: 10, type: COMPANY_LOCATION) { nodes { id } } } } }`,
  listCatalogs: `#graphql
    query TierCatalogs { catalogs(first: 50) { nodes {
      __typename id title status
      ... on MarketCatalog { markets(first: 5, type: COMPANY_LOCATION) { nodes { id } } } } } }`,
  members: `#graphql
    query TierMembers($id: ID!, $after: String) { market(id: $id) { id
      conditions { companyLocationsCondition { companyLocations(first: 250, after: $after) {
        nodes { id } pageInfo { hasNextPage endCursor } } } } } }`,
  inCatalog: `#graphql
    query TierInCatalog($ids: [ID!]!, $catalogId: ID!) { nodes(ids: $ids) { ... on CompanyLocation { id inCatalog(catalogId: $catalogId) } } }`,
  syncTier: `#graphql
    query TierSync($ids: [ID!]!) { nodes(ids: $ids) { __typename id
      ... on Market { name status catalogs(first: 10) { nodes { id } } }
      ... on Catalog { title status priceList { id } }
      ... on PriceList { parent { adjustment { type value } } }
      ... on CompanyLocation { name } } }`,
  paymentTerms: `#graphql query TierPaymentTerms { paymentTermsTemplates { id translatedName paymentTermsType dueInDays } }`,
  findCompany: `#graphql
    query TierFindCompany($q: String!) { companies(first: 1, query: $q) { nodes { id locations(first: 1) { nodes { id } } } } }`,
  companyCreate: `#graphql
    mutation TierPlaceholder($input: CompanyCreateInput!) { companyCreate(input: $input) {
      company { id locations(first: 1) { nodes { id } } } userErrors { field message code } } }`,
  companyLocationCreate: `#graphql
    mutation TierPlaceholderLocation($companyId: ID!, $input: CompanyLocationInput!) { companyLocationCreate(companyId: $companyId, input: $input) {
      companyLocation { id } userErrors { field message code } } }`,
};

// ---------- pure helpers (unit-tested) ----------

export type Budget = { used: number | null; limit: number | null; direct: boolean };

/**
 * Why a new tier can't be created, or null. Free plan: 1 tier. Non-Plus: a new
 * percent tier needs one free B2B catalog slot (Shopify counts catalogs the
 * merchant made too). Linking an existing B2B catalog uses no new slot.
 */
export function createBlockReason(
  plan: PlanId,
  tierCount: number,
  shop: { b2bEnabled: boolean; b2bMarketsEnabled: boolean },
  budget: Budget,
  pricing: "percent" | "existing" = "percent",
): Exclude<TierErrorCode, "has_buyers" | "not_found" | "shopify" | "volume_pricing" | "catalog_in_use" | "missing_in_shopify"> | null {
  if (!shop.b2bEnabled) return "no_b2b";
  if (tierCount >= maxTiers(plan)) return "plan_limit";
  if (budget.direct) return null;
  if (!shop.b2bMarketsEnabled) return "markets_unavailable";
  if (pricing === "existing") return null;
  if (budget.limit !== null && budget.used !== null && budget.used >= budget.limit) return "catalog_limit";
  return null;
}

/** Shopify's catalog-cap and entitlement errors → our codes. */
export function mapShopifyError(e: unknown): TierError {
  if (e instanceof TierError) return e;
  if (e instanceof UserErrorsError) {
    if (e.hasCode("B2B_CATALOG_LIMIT_REACHED") || e.hasCode("CANNOT_ACTIVATE_MARKET_B2B_CATALOG_LIMIT_REACHED")) return new TierError("catalog_limit");
    if (e.hasCode("NOT_ENTITLED_TO_ACTIVATE_MARKET") || e.hasCode("UNPERMITTED_ENTITLEMENTS_MARKET_CATALOGS") || e.hasCode("B2B_MARKET_MUST_BE_MERCHANT_MANAGED"))
      return new TierError("markets_unavailable");
    if (e.hasCode("CATALOGS_WITH_VOLUME_PRICING_OR_QUANTITY_RULES_NOT_SUPPORTED")) return new TierError("volume_pricing");
    return new TierError("shopify", e.userErrors.map((u) => u.message).join(" "));
  }
  return new TierError("shopify", (e as Error)?.message?.slice(0, 200));
}

export const adminUrl = {
  company: (gid: string) => `shopify://admin/companies/${numericId(gid)}`,
  market: (gid: string) => `shopify://admin/markets/${numericId(gid)}`,
  catalog: (gid: string) => `shopify://admin/catalogs/${numericId(gid)}`,
};

/** Seam for tests: backoff waits. */
export const timing = { sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };

// ---------- reads ----------

export async function catalogBudget(admin: Admin, shop: string): Promise<Budget> {
  const row = await db.shop.findUnique({ where: { shop }, select: { catalogLimit: true, directCatalogs: true } });
  if (row?.directCatalogs) return { used: null, limit: null, direct: true };
  let used: number | null = null;
  try {
    const data = await gql(admin, Q.b2bMarkets);
    used = countB2bCatalogs(data.markets?.nodes);
  } catch {
    used = null; // budget unknown; Shopify still enforces the cap and we map its error
  }
  return { used, limit: row?.catalogLimit ?? null, direct: false };
}

export async function paymentTermsOptions(admin: Admin): Promise<{ id: string; name: string; type: string }[]> {
  try {
    const data = await gql(admin, Q.paymentTerms);
    return (data.paymentTermsTemplates ?? []).map((p: any) => ({ id: p.id, name: p.translatedName, type: p.paymentTermsType }));
  } catch {
    return [];
  }
}

/** The store's B2B catalogs (for "Use an existing B2B catalog"). */
export async function listB2bCatalogs(admin: Admin, direct: boolean): Promise<{ id: string; title: string }[]> {
  const data = await gql(admin, Q.listCatalogs);
  return (data.catalogs?.nodes ?? [])
    .filter((c: any) =>
      c.__typename === "CompanyLocationCatalog" ? direct : c.__typename === "MarketCatalog" && (c.markets?.nodes?.length ?? 0) > 0,
    )
    .map((c: any) => ({ id: c.id, title: c.title }));
}

/** Company location ids in a B2B market; throws AssignmentError("missing_in_shopify") if the market is gone. */
export async function marketMembers(admin: Admin, marketGid: string): Promise<string[]> {
  const nodes = await paginate<{ id: string }>(admin, Q.members, { id: marketGid }, (d) => {
    if (!d.market) throw new AssignmentError("missing_in_shopify");
    return d.market.conditions?.companyLocationsCondition?.companyLocations ?? { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
  }, 20_000);
  return nodes.map((n) => n.id);
}

// ---------- placeholder location (D-004) ----------

async function ensurePlaceholderLocation(ctx: Ctx): Promise<string> {
  const row = await db.shop.findUnique({ where: { shop: ctx.shop }, select: { placeholderCompanyGid: true } });
  const found = await gql(ctx.admin, Q.findCompany, { q: `external_id:${PLACEHOLDER_EXTERNAL_ID}` });
  const existing = found.companies?.nodes?.[0];
  if (existing) {
    if (row?.placeholderCompanyGid !== existing.id)
      await db.shop.update({ where: { shop: ctx.shop }, data: { placeholderCompanyGid: existing.id } });
    const loc = existing.locations?.nodes?.[0]?.id;
    if (loc) return loc;
    const r = await mutate(ctx.admin, "companyLocationCreate", Q.companyLocationCreate, {
      companyId: existing.id, input: { name: "Tradepass placeholder", note: "Keeps Tradepass tier markets from being empty." },
    });
    return r.companyLocation.id;
  }
  const r = await mutate(ctx.admin, "companyCreate", Q.companyCreate, {
    input: {
      company: { name: PLACEHOLDER_COMPANY_NAME, externalId: PLACEHOLDER_EXTERNAL_ID, note: "Created by Tradepass so its B2B markets are never empty. Deleting it can break tier pricing." },
      companyLocation: { name: "Tradepass placeholder" },
    },
  });
  await db.shop.update({ where: { shop: ctx.shop }, data: { placeholderCompanyGid: r.company.id } });
  await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "tier.placeholder_created", subject: r.company.id });
  return r.company.locations.nodes[0].id;
}

// ---------- market membership (assignment) ----------

const locCond = (ids: string[]) => ({ companyLocationsCondition: { companyLocationIds: ids } });

async function marketUpdateRetry(admin: Admin, marketGid: string, conditions: Record<string, unknown>, attempts = 4) {
  for (let i = 0; ; i++) {
    try {
      return await mutate(admin, "marketUpdate", Q.marketUpdate, { id: marketGid, input: { conditions } });
    } catch (e) {
      if (e instanceof UserErrorsError && e.hasCode("MARKET_UPDATE_CONCURRENT_MODIFICATION")) {
        if (i >= attempts - 1) throw new AssignmentError("concurrent");
        await timing.sleep(300 * 2 ** i + Math.floor(Math.random() * 200));
        continue;
      }
      throw e;
    }
  }
}

async function removeFromMarket(ctx: Ctx, tier: Pick<Tier, "id" | "marketGid" | "placeholderLocationGid">, ids: string[]) {
  if (!ids.length || !tier.marketGid) return;
  try {
    await marketUpdateRetry(ctx.admin, tier.marketGid, { conditionsToDelete: locCond(ids) });
  } catch (e) {
    // The last real buyer is leaving: keep the market alive with the placeholder (D-004), then remove.
    if (e instanceof UserErrorsError && e.hasCode("SPECIFIED_CONDITIONS_CANNOT_BE_EMPTY")) {
      const ph = await ensurePlaceholderLocation(ctx);
      await marketUpdateRetry(ctx.admin, tier.marketGid, { conditionsToAdd: locCond([ph]) });
      await db.tier.updateMany({ where: { id: tier.id, shop: ctx.shop }, data: { placeholderLocationGid: ph } });
      await marketUpdateRetry(ctx.admin, tier.marketGid, { conditionsToDelete: locCond(ids) });
    } else throw e;
  }
}

type AssignTier = Pick<Tier, "id" | "name" | "mode" | "marketGid" | "catalogGid" | "placeholderLocationGid">;
export type AssignResult = { mode: "auto" | "assisted" | "direct"; verified: boolean; jobIds: string[] };

/**
 * Move company locations from one tier to another (either side may be null).
 * auto: one write at a time per shop, read back, retried on concurrent modification.
 * assisted: records what the merchant must do in Shopify admin (Home card) and returns unverified.
 */
export async function moveLocations(
  ctx: Ctx,
  locationGids: string[],
  from: AssignTier | null,
  to: AssignTier | null,
  opts: { buyerId?: string | null; assignment?: "auto" | "assisted" } = {},
): Promise<AssignResult> {
  const ids = [...new Set(locationGids)];
  if (!ids.length || (from?.id && from.id === to?.id)) return { mode: "auto", verified: true, jobIds: [] };
  const assignment = opts.assignment ?? readSettings((await db.shop.findUnique({ where: { shop: ctx.shop }, select: { settings: true } }))?.settings).tiers.assignment;

  // Plus: direct catalog assignment (no market involved).
  const direct = (t: AssignTier | null) => t?.mode === "direct";
  if (direct(from) || direct(to)) {
    if (direct(from) && from!.catalogGid)
      await mutate(ctx.admin, "catalogContextUpdate", Q.catalogContextUpdate, { catalogId: from!.catalogGid, remove: { companyLocationIds: ids } });
    if (direct(to) && to!.catalogGid)
      await mutate(ctx.admin, "catalogContextUpdate", Q.catalogContextUpdate, { catalogId: to!.catalogGid, add: { companyLocationIds: ids } });
    // Mixed (a market tier on the other side) is handled below.
    const rest = await moveLocations(ctx, ids, direct(from) ? null : from, direct(to) ? null : to, { ...opts, assignment });
    let ok = rest.verified;
    for (const [t, want] of [[from, false], [to, true]] as const) {
      if (!direct(t) || !t?.catalogGid) continue;
      const d = await gql(ctx.admin, Q.inCatalog, { ids, catalogId: t.catalogGid });
      ok &&= (d.nodes ?? []).every((n: any) => n && n.inCatalog === want);
    }
    if (!ok) throw new AssignmentError("verify_failed");
    return { mode: "direct", verified: true, jobIds: rest.jobIds };
  }

  if (assignment === "assisted") {
    const jobIds: string[] = [];
    for (const [t, op] of [[from, "remove"], [to, "add"]] as const) {
      if (!t?.marketGid) continue;
      for (const loc of ids) {
        const job = await db.job.create({
          data: { shop: ctx.shop, type: ASSISTED_JOB, state: "waiting", payload: { op, tierId: t.id, marketGid: t.marketGid, locationGid: loc, buyerId: opts.buyerId ?? null } },
        });
        jobIds.push(job.id);
      }
    }
    return { mode: "assisted", verified: false, jobIds };
  }

  return withLock(ctx.shop, MARKET_LOCK, async () => {
    const write = async () => {
      if (from?.marketGid) await removeFromMarket(ctx, from, ids);
      if (to?.marketGid) await marketUpdateRetry(ctx.admin, to.marketGid, { conditionsToAdd: locCond(ids) });
    };
    const check = async () => {
      const [fromM, toM] = await Promise.all([
        from?.marketGid ? marketMembers(ctx.admin, from.marketGid) : Promise.resolve([]),
        to?.marketGid ? marketMembers(ctx.admin, to.marketGid) : Promise.resolve(null),
      ]);
      return ids.every((id) => !fromM.includes(id) && (toM === null || toM.includes(id)));
    };
    await write();
    // Another writer may have overwritten the condition list between our write and read: write once more.
    if (!(await check())) {
      await timing.sleep(500);
      await write();
      if (!(await check())) throw new AssignmentError("verify_failed");
    }
    return { mode: "auto" as const, verified: true, jobIds: [] };
  }, 25_000).catch((e) => {
    if (e?.name === "LockBusyError") throw new AssignmentError("busy");
    throw e;
  });
}

// ---------- assisted mode ----------

export type PendingAssignment = {
  id: string; op: "add" | "remove"; tierId: string; tierName: string; buyerId: string | null; buyerName: string | null;
  marketUrl: string; companyUrl: string | null; createdAt: string;
};

/** Open assisted-mode tasks for the Home card ("1 tier assignment needs your action"). */
export async function pendingAssignments(shop: string): Promise<PendingAssignment[]> {
  const jobs = await db.job.findMany({ where: { shop, type: ASSISTED_JOB, state: "waiting" }, orderBy: { createdAt: "asc" }, take: 50 });
  const p = (j: (typeof jobs)[number]) => j.payload as { op: "add" | "remove"; tierId: string; marketGid: string; locationGid: string; buyerId: string | null };
  const tierIds = [...new Set(jobs.map((j) => p(j).tierId))];
  const buyerIds = [...new Set(jobs.map((j) => p(j).buyerId).filter(Boolean) as string[])];
  const [tiers, buyers] = await Promise.all([
    db.tier.findMany({ where: { shop, id: { in: tierIds } }, select: { id: true, name: true } }),
    db.buyer.findMany({ where: { shop, id: { in: buyerIds } }, select: { id: true, name: true, companyGid: true } }),
  ]);
  return jobs.map((j) => {
    const pl = p(j);
    const b = buyers.find((x) => x.id === pl.buyerId);
    return {
      id: j.id, op: pl.op, tierId: pl.tierId, tierName: tiers.find((t) => t.id === pl.tierId)?.name ?? "",
      buyerId: pl.buyerId, buyerName: b?.name ?? null, marketUrl: adminUrl.market(pl.marketGid),
      companyUrl: b ? adminUrl.company(b.companyGid) : null, createdAt: j.createdAt.toISOString(),
    };
  });
}

export function pendingAssignmentCount(shop: string): Promise<number> {
  return db.job.count({ where: { shop, type: ASSISTED_JOB, state: "waiting" } });
}

/** Read membership back; marks the task done when Shopify shows the change. */
export async function verifyAssignment(ctx: Ctx, jobId: string): Promise<boolean> {
  const job = await db.job.findFirst({ where: { id: jobId, shop: ctx.shop, type: ASSISTED_JOB } });
  if (!job) return false;
  if (job.state === "done") return true;
  const pl = job.payload as { op: "add" | "remove"; marketGid: string; locationGid: string; tierId: string };
  const members = await marketMembers(ctx.admin, pl.marketGid);
  const ok = pl.op === "add" ? members.includes(pl.locationGid) : !members.includes(pl.locationGid);
  if (ok) {
    await db.job.update({ where: { id: job.id }, data: { state: "done" } });
    await logActivity({ shop: ctx.shop, actor: ctx.actor, action: `tier.assisted_${pl.op}_verified`, subject: pl.locationGid, detail: { tierId: pl.tierId } });
  }
  return ok;
}

// ---------- create / update / delete ----------

async function shopCurrency(admin: Admin, shop: string): Promise<string> {
  const row = await db.shop.findUnique({ where: { shop }, select: { currency: true } });
  if (row?.currency) return row.currency;
  const d = await gql(admin, Q.currency);
  const cur = d.shop.currencyCode as string;
  await db.shop.update({ where: { shop }, data: { currency: cur } });
  return cur;
}

async function collectionProductIds(admin: Admin, collectionIds: string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const id of collectionIds) {
    const nodes = await paginate<{ id: string }>(admin, Q.collectionProducts, { id }, (d) =>
      d.collection?.products ?? { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, 5000);
    nodes.forEach((n) => out.add(n.id));
  }
  return [...out];
}

async function publishInBatches(admin: Admin, publicationId: string, add: string[], remove: string[] = []) {
  for (let i = 0; i < Math.max(add.length, remove.length); i += 50) {
    await mutate(admin, "publicationUpdate", Q.publicationUpdate, {
      id: publicationId,
      input: { publishablesToAdd: add.slice(i, i + 50), publishablesToRemove: remove.slice(i, i + 50) },
    });
  }
}

/** "Only these collections" = an empty publication filled with the collections and their products. */
async function createPublication(admin: Admin, catalogId: string, products: TierInput["products"]): Promise<string> {
  const all = products.kind === "all";
  const r = await mutate(admin, "publicationCreate", Q.publicationCreate, {
    input: { catalogId, defaultState: all ? "ALL_PRODUCTS" : "EMPTY", autoPublish: all },
  });
  const id = r.publication.id as string;
  if (!all) {
    const productIds = await collectionProductIds(admin, products.ids);
    await publishInBatches(admin, id, [...products.ids, ...productIds]);
  }
  return id;
}

async function deleteObjects(admin: Admin, o: { catalogGid?: string | null; marketGid?: string | null; created: TierDefaults["created"] }) {
  // catalogDelete with deleteDependentResources also removes its price list and publication.
  if (o.catalogGid && o.created.catalog) await mutate(admin, "catalogDelete", Q.catalogDelete, { id: o.catalogGid }).catch(ignoreNotFound);
  if (o.marketGid && o.created.market) await mutate(admin, "marketDelete", Q.marketDelete, { id: o.marketGid }).catch(ignoreNotFound);
}

function ignoreNotFound(e: unknown) {
  if (e instanceof UserErrorsError && e.userErrors.every((u) => /not.?found|does not exist/i.test(`${u.code} ${u.message}`))) return;
  throw e;
}

export async function createTier(ctx: Ctx, plan: PlanId, input: TierInput): Promise<Tier> {
  const shopRow = await db.shop.findUnique({ where: { shop: ctx.shop } });
  if (!shopRow) throw new TierError("not_found");
  const direct = input.direct && shopRow.directCatalogs;
  const [count, budget] = await Promise.all([db.tier.count({ where: { shop: ctx.shop } }), catalogBudget(ctx.admin, ctx.shop)]);
  const block = createBlockReason(plan, count, shopRow, { ...budget, direct }, input.pricing.kind);
  if (block) throw new TierError(block);

  const created: TierDefaults["created"] = {};
  const g: { marketGid?: string; catalogGid?: string; priceListGid?: string; publicationGid?: string; placeholder?: string } = {};
  try {
    if (input.pricing.kind === "existing") {
      const info = (await gql(ctx.admin, Q.catalogInfo, { id: input.pricing.catalogGid })).catalog;
      if (!info) throw new TierError("missing_in_shopify");
      if (await db.tier.findFirst({ where: { shop: ctx.shop, catalogGid: info.id } })) throw new TierError("catalog_in_use");
      g.catalogGid = info.id;
      g.priceListGid = info.priceList?.id;
      g.publicationGid = info.publication?.id;
      const linkedMarket = info.markets?.nodes?.[0]?.id;
      if (!direct && linkedMarket) {
        if (await db.tier.findFirst({ where: { shop: ctx.shop, marketGid: linkedMarket } })) throw new TierError("catalog_in_use");
        g.marketGid = linkedMarket;
      }
    } else {
      const currency = await shopCurrency(ctx.admin, ctx.shop);
      const pl = await mutate(ctx.admin, "priceListCreate", Q.priceListCreate, {
        input: { name: `Tradepass ${input.name}`, currency, parent: { adjustment: { type: "PERCENTAGE_DECREASE", value: input.pricing.pct } } },
      });
      g.priceListGid = pl.priceList.id;
      created.priceList = true;
    }

    if (!direct && !g.marketGid) {
      const name = `Tradepass ${input.name}`;
      const marketInput = (ids: string[]) => ({
        name, status: "ACTIVE",
        conditions: { companyLocationsCondition: { applicationLevel: "SPECIFIED", companyLocationIds: ids } },
        ...(g.catalogGid ? { catalogs: [g.catalogGid] } : {}),
      });
      let m;
      try {
        m = await mutate(ctx.admin, "marketCreate", Q.marketCreate, { input: marketInput([]) });
      } catch (e) {
        if (!(e instanceof UserErrorsError && e.hasCode("SPECIFIED_CONDITIONS_CANNOT_BE_EMPTY"))) throw e;
        g.placeholder = await ensurePlaceholderLocation(ctx);
        m = await mutate(ctx.admin, "marketCreate", Q.marketCreate, { input: marketInput([g.placeholder]) });
      }
      g.marketGid = m.market.id;
      created.market = true;
    }

    if (!g.catalogGid) {
      const c = await mutate(ctx.admin, "catalogCreate", Q.catalogCreate, {
        input: {
          title: `Tradepass ${input.name}`, status: "ACTIVE", priceListId: g.priceListGid,
          context: direct ? { companyLocationIds: [] } : { marketIds: [g.marketGid] },
        },
      });
      g.catalogGid = c.catalog.id;
      created.catalog = true;
      g.publicationGid = await createPublication(ctx.admin, g.catalogGid!, input.products);
      await mutate(ctx.admin, "catalogUpdate", Q.catalogUpdate, { id: g.catalogGid, input: { publicationId: g.publicationGid } }).catch(() => undefined);
      created.publication = true;
    }
  } catch (e) {
    // Leave nothing half-made in Shopify.
    await deleteObjects(ctx.admin, { catalogGid: g.catalogGid, marketGid: g.marketGid, created }).catch(() => undefined);
    const err = mapShopifyError(e);
    await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "tier.create", result: "failed", detail: { code: err.code } });
    throw err;
  }

  const defaults: TierDefaults = {
    pricing: input.pricing.kind,
    products: input.products.kind,
    collectionIds: input.products.kind === "collections" ? input.products.ids : [],
    paymentTermsTemplateId: input.paymentTermsTemplateId,
    checkoutToDraft: input.checkoutToDraft,
    tax: input.tax,
    created,
  };
  const tier = await db.tier.create({
    data: {
      shop: ctx.shop, name: input.name.trim(), buyerNames: input.buyerNames,
      marketGid: g.marketGid ?? null, catalogGid: g.catalogGid ?? null, priceListGid: g.priceListGid ?? null, publicationGid: g.publicationGid ?? null,
      createdByUs: Boolean(created.market || created.catalog),
      discountPct: input.pricing.kind === "percent" ? input.pricing.pct : null,
      defaults: defaults as object, mode: direct ? "direct" : "market", placeholderLocationGid: g.placeholder ?? null, position: count,
    },
  });
  await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "tier.create", subject: tier.id, detail: { marketGid: g.marketGid ?? null, catalogGid: g.catalogGid ?? null, created } });
  return tier;
}

/** Update names, defaults, discount and product restriction. Pricing kind and mode can't change (create a new tier instead). */
export async function updateTier(ctx: Ctx, tierId: string, input: TierInput): Promise<Tier> {
  const tier = await db.tier.findFirst({ where: { id: tierId, shop: ctx.shop } });
  if (!tier) throw new TierError("not_found");
  const d = readDefaults(tier.defaults);
  try {
    if (input.pricing.kind === "percent" && tier.priceListGid && d.created.priceList && input.pricing.pct !== tier.discountPct) {
      await mutate(ctx.admin, "priceListUpdate", Q.priceListUpdate, {
        id: tier.priceListGid, input: { parent: { adjustment: { type: "PERCENTAGE_DECREASE", value: input.pricing.pct } } },
      });
    }
    let publicationGid = tier.publicationGid;
    const newIds = input.products.kind === "collections" ? input.products.ids : [];
    if (d.created.catalog && (input.products.kind !== d.products || newIds.join() !== d.collectionIds.join())) {
      // Rebuild the publication: simplest way to get exactly the chosen products, and catalogDelete cleans old ones.
      const fresh = await createPublication(ctx.admin, tier.catalogGid!, input.products);
      await mutate(ctx.admin, "catalogUpdate", Q.catalogUpdate, { id: tier.catalogGid, input: { publicationId: fresh } });
      publicationGid = fresh;
    }
    if (input.name.trim() !== tier.name && d.created.catalog && tier.catalogGid)
      await mutate(ctx.admin, "catalogUpdate", Q.catalogUpdate, { id: tier.catalogGid, input: { title: `Tradepass ${input.name.trim()}` } });
    if (input.name.trim() !== tier.name && d.created.market && tier.marketGid)
      await mutate(ctx.admin, "marketUpdate", Q.marketUpdate, { id: tier.marketGid, input: { name: `Tradepass ${input.name.trim()}` } });

    const defaults: TierDefaults = {
      ...d,
      products: input.products.kind,
      collectionIds: newIds,
      paymentTermsTemplateId: input.paymentTermsTemplateId,
      checkoutToDraft: input.checkoutToDraft,
      tax: input.tax,
    };
    const updated = await db.tier.update({
      where: { id: tier.id },
      data: {
        name: input.name.trim(), buyerNames: input.buyerNames, defaults: defaults as object, publicationGid,
        discountPct: input.pricing.kind === "percent" ? input.pricing.pct : tier.discountPct,
      },
    });
    await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "tier.update", subject: tier.id });
    return updated;
  } catch (e) {
    const err = mapShopifyError(e);
    await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "tier.update", subject: tier.id, result: "failed", detail: { code: err.code } });
    throw err;
  }
}

export async function tierBuyerCount(shop: string, tierId: string): Promise<number> {
  return db.buyer.count({ where: { shop, OR: [{ tierId }, { pausedTierId: tierId }] } });
}

/** Blocked while buyers exist. Shopify objects are deleted only if Tradepass created them and the merchant asked. */
export async function deleteTier(ctx: Ctx, tierId: string, opts: { deleteShopifyObjects: boolean }): Promise<void> {
  const tier = await db.tier.findFirst({ where: { id: tierId, shop: ctx.shop } });
  if (!tier) throw new TierError("not_found");
  if ((await tierBuyerCount(ctx.shop, tier.id)) > 0) throw new TierError("has_buyers");
  if (opts.deleteShopifyObjects) {
    try {
      await deleteObjects(ctx.admin, { ...tier, created: readDefaults(tier.defaults).created });
    } catch (e) {
      const err = mapShopifyError(e);
      await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "tier.delete", subject: tier.id, result: "failed", detail: { code: err.code } });
      throw err;
    }
  }
  await db.$transaction([
    db.form.updateMany({ where: { shop: ctx.shop, suggestedTierId: tier.id }, data: { suggestedTierId: null } }),
    db.tier.delete({ where: { id: tier.id } }),
  ]);
  await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "tier.delete", subject: tier.id, detail: { shopifyObjectsDeleted: opts.deleteShopifyObjects } });
}

// ---------- sync with Shopify (hourly + fix button) ----------

export type SyncState = "ok" | "changed_in_shopify" | "missing";

/** Pure: compare what Shopify returns with what the tier expects. */
export function syncStateFor(
  tier: Pick<Tier, "mode" | "marketGid" | "catalogGid" | "priceListGid" | "discountPct">,
  nodes: Record<string, any | null>,
  shopDirect: boolean,
): SyncState {
  const market = tier.marketGid ? nodes[tier.marketGid] : undefined;
  const catalog = tier.catalogGid ? nodes[tier.catalogGid] : undefined;
  if ((tier.marketGid && !market) || (tier.catalogGid && !catalog)) return "missing";
  if (tier.mode === "direct" && !shopDirect) return "changed_in_shopify";
  if (market) {
    if (market.status && market.status !== "ACTIVE") return "changed_in_shopify";
    if (tier.catalogGid && !(market.catalogs?.nodes ?? []).some((c: any) => c.id === tier.catalogGid)) return "changed_in_shopify";
  }
  if (catalog) {
    if (catalog.status && catalog.status !== "ACTIVE") return "changed_in_shopify";
    if (tier.priceListGid && catalog.priceList?.id !== tier.priceListGid) return "changed_in_shopify";
  }
  const pl = tier.priceListGid ? nodes[tier.priceListGid] : undefined;
  if (tier.discountPct != null && pl) {
    const adj = pl.parent?.adjustment;
    if (!adj || adj.type !== "PERCENTAGE_DECREASE" || Math.round(Number(adj.value)) !== tier.discountPct) return "changed_in_shopify";
  }
  return "ok";
}

export async function syncTiers(admin: Admin, shop: string): Promise<{ checked: number; changed: number }> {
  const [tiers, row] = await Promise.all([
    db.tier.findMany({ where: { shop } }),
    db.shop.findUnique({ where: { shop }, select: { directCatalogs: true } }),
  ]);
  let changed = 0;
  for (const tier of tiers) {
    const ids = [tier.marketGid, tier.catalogGid, tier.priceListGid].filter(Boolean) as string[];
    if (!ids.length) continue;
    const d = await gql(admin, Q.syncTier, { ids });
    const nodes: Record<string, any> = {};
    ids.forEach((id, i) => (nodes[id] = d.nodes?.[i] ?? null));
    const state = syncStateFor(tier, nodes, Boolean(row?.directCatalogs));
    if (state !== tier.syncState) {
      changed++;
      await db.tier.update({ where: { id: tier.id }, data: { syncState: state } });
      await logActivity({ shop, actor: "system", action: "tier.sync", subject: tier.id, detail: { from: tier.syncState, to: state } });
    }
  }
  return { checked: tiers.length, changed };
}

/**
 * "Fix" for a tier marked Changed in Shopify / Missing: re-activate and re-link
 * what exists, recreate what was deleted (then put the tier's buyers back).
 */
export async function repairTier(ctx: Ctx, tierId: string): Promise<Tier> {
  const tier = await db.tier.findFirst({ where: { id: tierId, shop: ctx.shop } });
  if (!tier) throw new TierError("not_found");
  const d = readDefaults(tier.defaults);
  const ids = [tier.marketGid, tier.catalogGid, tier.priceListGid].filter(Boolean) as string[];
  const res = ids.length ? await gql(ctx.admin, Q.syncTier, { ids }) : { nodes: [] };
  const nodes: Record<string, any> = {};
  ids.forEach((id, i) => (nodes[id] = res.nodes?.[i] ?? null));
  const data: { placeholderLocationGid?: string } = {};
  try {
    let priceListGid = tier.priceListGid && nodes[tier.priceListGid] ? tier.priceListGid : null;
    if (!priceListGid && tier.discountPct != null) {
      const currency = await shopCurrency(ctx.admin, ctx.shop);
      const pl = await mutate(ctx.admin, "priceListCreate", Q.priceListCreate, {
        input: { name: `Tradepass ${tier.name}`, currency, parent: { adjustment: { type: "PERCENTAGE_DECREASE", value: tier.discountPct } } },
      });
      priceListGid = pl.priceList.id;
      d.created.priceList = true;
    } else if (priceListGid && tier.discountPct != null) {
      await mutate(ctx.admin, "priceListUpdate", Q.priceListUpdate, {
        id: priceListGid, input: { parent: { adjustment: { type: "PERCENTAGE_DECREASE", value: tier.discountPct } } },
      });
    }
    let marketGid = tier.mode === "market" ? (tier.marketGid && nodes[tier.marketGid] ? tier.marketGid : null) : null;
    let marketRecreated = false;
    if (tier.mode === "market" && !marketGid) {
      const ph = await ensurePlaceholderLocation(ctx);
      const m = await mutate(ctx.admin, "marketCreate", Q.marketCreate, {
        input: { name: `Tradepass ${tier.name}`, status: "ACTIVE", conditions: { companyLocationsCondition: { applicationLevel: "SPECIFIED", companyLocationIds: [ph] } } },
      });
      marketGid = m.market.id;
      marketRecreated = true;
      d.created.market = true;
      data.placeholderLocationGid = ph;
    } else if (marketGid && nodes[marketGid]?.status !== "ACTIVE") {
      await mutate(ctx.admin, "marketUpdate", Q.marketUpdate, { id: marketGid, input: { status: "ACTIVE" } });
    }
    let catalogGid = tier.catalogGid && nodes[tier.catalogGid] ? tier.catalogGid : null;
    let publicationGid = tier.publicationGid;
    if (!catalogGid) {
      const c = await mutate(ctx.admin, "catalogCreate", Q.catalogCreate, {
        input: { title: `Tradepass ${tier.name}`, status: "ACTIVE", priceListId: priceListGid, context: tier.mode === "direct" ? { companyLocationIds: [] } : { marketIds: [marketGid] } },
      });
      catalogGid = c.catalog.id;
      d.created.catalog = true;
      const products = d.products === "collections" ? { kind: "collections" as const, ids: d.collectionIds } : { kind: "all" as const };
      publicationGid = await createPublication(ctx.admin, catalogGid!, products);
      await mutate(ctx.admin, "catalogUpdate", Q.catalogUpdate, { id: catalogGid, input: { publicationId: publicationGid } });
    } else {
      await mutate(ctx.admin, "catalogUpdate", Q.catalogUpdate, { id: catalogGid, input: { status: "ACTIVE", ...(priceListGid ? { priceListId: priceListGid } : {}) } });
      if (marketGid && !(nodes[marketGid]?.catalogs?.nodes ?? []).some((c: any) => c.id === catalogGid))
        await mutate(ctx.admin, "marketUpdate", Q.marketUpdate, { id: marketGid, input: { catalogsToAdd: [catalogGid] } });
    }
    const updated = await db.tier.update({
      where: { id: tier.id },
      data: { ...data, marketGid, catalogGid, priceListGid, publicationGid, defaults: d as object, syncState: "ok" },
    });
    if (marketRecreated || !tier.catalogGid || !nodes[tier.catalogGid] || tier.mode === "direct") {
      const buyers = await db.buyer.findMany({ where: { shop: ctx.shop, tierId: tier.id, status: "active" } });
      const locs = buyers.flatMap((b) => b.locationGids);
      if (locs.length) await moveLocations(ctx, locs, null, updated);
    }
    await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "tier.repair", subject: tier.id, detail: { marketRecreated } });
    return updated;
  } catch (e) {
    const err = mapShopifyError(e);
    await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "tier.repair", subject: tier.id, result: "failed", detail: { code: err.code } });
    throw err;
  }
}

/** One-line pricing summary input for the list ("20% off retail" or the catalog name). */
export async function catalogTitles(admin: Admin, gids: string[]): Promise<Record<string, string>> {
  if (!gids.length) return {};
  try {
    const d = await gql(admin, `#graphql query TierTitles($ids: [ID!]!) { nodes(ids: $ids) { ... on Catalog { id title } } }`, { ids: gids });
    return Object.fromEntries((d.nodes ?? []).filter(Boolean).map((n: any) => [n.id, n.title]));
  } catch {
    return {};
  }
}
