/* eslint-disable @typescript-eslint/no-explicit-any -- the spike records raw, untyped GraphQL responses verbatim */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

// Phase 0 spike: can an app add/remove a company location to/from a B2B
// market on a non-Plus store? Runs only on development stores, from
// Help → Diagnostics. Every call, response and timing is recorded so the
// result can be pasted into SPIKE_RESULTS.md. All mutation and field names
// were checked against Admin GraphQL 2026-10 (API_NOTES.md).

type Gql = AdminApiContext["graphql"];

export type SpikeStep = { step: string; ms: number; ok: boolean; request?: unknown; response: unknown; note?: string };
export type SpikeReport = {
  startedAt: string;
  plan: unknown;
  steps: SpikeStep[];
  created: { companies: string[]; markets: string[]; catalogs: string[] };
  conclusion: {
    addWorks: boolean | null;
    moveWorks: boolean | null;
    concurrentBothLanded: boolean | null;
    emptyMarketAllowed: boolean | null;
    fourthCatalogError: string | null;
  };
};

const M = {
  facts: `#graphql
    query { shop { currencyCode plan { publicDisplayName partnerDevelopment shopifyPlus }
      features { directConnectionCatalogAssignmentEnabled }
      entitlements { b2b { enabled } markets { b2b { enabled catalogs { enabled limit } } } } } }`,
  companyCreate: `#graphql
    mutation($input: CompanyCreateInput!) { companyCreate(input: $input) {
      company { id locations(first: 1) { nodes { id } } contacts(first: 1) { nodes { id } } }
      userErrors { field message code } } }`,
  locationCreate: `#graphql
    mutation($companyId: ID!, $input: CompanyLocationInput!) { companyLocationCreate(companyId: $companyId, input: $input) {
      companyLocation { id } userErrors { field message code } } }`,
  priceListCreate: `#graphql
    mutation($input: PriceListCreateInput!) { priceListCreate(input: $input) {
      priceList { id } userErrors { field message code } } }`,
  marketCreate: `#graphql
    mutation($input: MarketCreateInput!) { marketCreate(input: $input) {
      market { id type status } userErrors { field message code } } }`,
  marketUpdate: `#graphql
    mutation($id: ID!, $input: MarketUpdateInput!) { marketUpdate(id: $id, input: $input) {
      market { id } userErrors { field message code } } }`,
  catalogCreate: `#graphql
    mutation($input: CatalogCreateInput!) { catalogCreate(input: $input) {
      catalog { id } userErrors { field message code } } }`,
  membership: `#graphql
    query($id: ID!) { market(id: $id) { id conditions { conditionTypes
      companyLocationsCondition { applicationLevel companyLocations(first: 50) { nodes { id } } } } } }`,
  marketDelete: `#graphql mutation($id: ID!) { marketDelete(id: $id) { deletedId userErrors { field message code } } }`,
  catalogDelete: `#graphql mutation($id: ID!) { catalogDelete(id: $id, deleteDependentResources: true) { deletedId userErrors { field message } } }`,
  companyDelete: `#graphql mutation($id: ID!) { companyDelete(id: $id) { deletedCompanyId userErrors { field message code } } }`,
};

export async function runSpike(graphql: Gql): Promise<SpikeReport> {
  const report: SpikeReport = {
    startedAt: new Date().toISOString(),
    plan: null,
    steps: [],
    created: { companies: [], markets: [], catalogs: [] },
    conclusion: { addWorks: null, moveWorks: null, concurrentBothLanded: null, emptyMarketAllowed: null, fourthCatalogError: null },
  };

  async function call(step: string, query: string, variables?: Record<string, unknown>, note?: string) {
    const start = Date.now();
    let response: any;
    try {
      const res = await graphql(query, variables ? { variables } : undefined);
      response = await res.json();
    } catch (e: any) {
      response = { thrown: String(e?.message ?? e), body: e?.body };
    }
    const errs = findUserErrors(response);
    const ok = !response?.thrown && !response?.errors && errs.length === 0;
    report.steps.push({ step, ms: Date.now() - start, ok, request: variables, response, note });
    return { ok, data: response?.data, errs };
  }

  async function members(marketId: string): Promise<string[]> {
    const r = await call(`read membership ${marketId}`, M.membership, { id: marketId });
    return r.data?.market?.conditions?.companyLocationsCondition?.companyLocations?.nodes?.map((n: { id: string }) => n.id) ?? [];
  }

  const facts = await call("plan + entitlements", M.facts);
  report.plan = facts.data?.shop;
  if (!facts.data?.shop?.plan?.partnerDevelopment) {
    report.steps.push({ step: "abort", ms: 0, ok: false, response: null, note: "Not a development store; spike refused." });
    return report;
  }
  const currency = facts.data.shop.currencyCode;
  const tag = Date.now().toString(36);

  // 1. Company + location + contact in one call, and a placeholder company (see step 3b).
  const co = await call("companyCreate (test buyer)", M.companyCreate, {
    input: {
      company: { name: `Tradepass spike ${tag}` },
      companyLocation: { name: "Main", shippingAddress: { address1: "1 Test St", city: "Austin", zoneCode: "TX", zip: "78701", countryCode: "US" }, billingSameAsShipping: true },
      companyContact: { email: `tradepass-spike-${tag}@example.com`, firstName: "Spike", lastName: "Test" },
    },
  });
  const companyId = co.data?.companyCreate?.company?.id;
  const loc = co.data?.companyCreate?.company?.locations?.nodes?.[0]?.id;
  if (!companyId || !loc) return report;
  report.created.companies.push(companyId);

  const ph = await call("companyCreate (placeholder)", M.companyCreate, {
    input: { company: { name: `Tradepass placeholder ${tag}` }, companyLocation: { name: "Placeholder", shippingAddress: { address1: "1 Test St", city: "Austin", zoneCode: "TX", zip: "78701", countryCode: "US" }, billingSameAsShipping: true } },
  });
  const phCompany = ph.data?.companyCreate?.company?.id;
  const phLoc = ph.data?.companyCreate?.company?.locations?.nodes?.[0]?.id;
  if (phCompany) report.created.companies.push(phCompany);

  // 2. Two price lists (−10 %, −20 %).
  const pl = [];
  for (const pct of [10, 20]) {
    const r = await call(`priceListCreate −${pct}%`, M.priceListCreate, {
      input: { name: `Tradepass spike ${tag} −${pct}%`, currency, parent: { adjustment: { type: "PERCENTAGE_DECREASE", value: pct } } },
    });
    pl.push(r.data?.priceListCreate?.priceList?.id);
  }

  // 3a. Can a B2B market exist with no company locations?
  const empty = await call("marketCreate with empty location list", M.marketCreate, {
    input: { name: `Tradepass spike ${tag} empty`, conditions: { companyLocationsCondition: { applicationLevel: "SPECIFIED", companyLocationIds: [] } } },
  });
  report.conclusion.emptyMarketAllowed = empty.ok;
  if (empty.data?.marketCreate?.market?.id) report.created.markets.push(empty.data.marketCreate.market.id);

  // 3b. Markets A and B, seeded with the placeholder location so they never become empty.
  const seed = phLoc ? [phLoc] : [];
  const mk = [];
  for (const name of ["A", "B"]) {
    const r = await call(`marketCreate ${name}`, M.marketCreate, {
      input: { name: `Tradepass spike ${tag} ${name}`, conditions: { companyLocationsCondition: { applicationLevel: "SPECIFIED", companyLocationIds: seed } } },
    });
    const id = r.data?.marketCreate?.market?.id;
    if (id) report.created.markets.push(id);
    mk.push(id);
  }
  const [mA, mB] = mk;
  if (!mA || !mB) return report;

  for (const [i, m] of [mA, mB].entries()) {
    const r = await call(`catalogCreate for market ${i ? "B" : "A"}`, M.catalogCreate, {
      input: { title: `Tradepass spike ${tag} ${i ? "B" : "A"}`, status: "ACTIVE", context: { marketIds: [m] }, priceListId: pl[i] },
    });
    const id = r.data?.catalogCreate?.catalog?.id;
    if (id) report.created.catalogs.push(id);
  }

  // 4. Add location to A, read back; move to B, read back.
  const locCond = (ids: string[]) => ({ companyLocationsCondition: { companyLocationIds: ids } });
  await call("add location to A", M.marketUpdate, { id: mA, input: { conditions: { conditionsToAdd: locCond([loc]) } } });
  report.conclusion.addWorks = (await members(mA)).includes(loc);

  await call("remove location from A", M.marketUpdate, { id: mA, input: { conditions: { conditionsToDelete: locCond([loc]) } } });
  await call("add location to B", M.marketUpdate, { id: mB, input: { conditions: { conditionsToAdd: locCond([loc]) } } });
  const [inA, inB] = [await members(mA), await members(mB)];
  report.conclusion.moveWorks = !inA.includes(loc) && inB.includes(loc);

  // 5. Two near-simultaneous additions to the same market.
  const l2 = await call("companyLocationCreate #2", M.locationCreate, { companyId, input: { name: "Second", billingSameAsShipping: true, shippingAddress: { address1: "2 Test St", city: "Austin", zoneCode: "TX", zip: "78701", countryCode: "US" } } });
  const l3 = await call("companyLocationCreate #3", M.locationCreate, { companyId, input: { name: "Third", billingSameAsShipping: true, shippingAddress: { address1: "3 Test St", city: "Austin", zoneCode: "TX", zip: "78701", countryCode: "US" } } });
  const id2 = l2.data?.companyLocationCreate?.companyLocation?.id;
  const id3 = l3.data?.companyLocationCreate?.companyLocation?.id;
  if (id2 && id3) {
    await Promise.all([
      call("concurrent add #2 to A", M.marketUpdate, { id: mA, input: { conditions: { conditionsToAdd: locCond([id2]) } } }),
      call("concurrent add #3 to A", M.marketUpdate, { id: mA, input: { conditions: { conditionsToAdd: locCond([id3]) } } }),
    ]);
    const after = await members(mA);
    report.conclusion.concurrentBothLanded = after.includes(id2) && after.includes(id3);
  }

  // 6. Keep creating B2B markets + catalogs until the cap answers (max 4 tries).
  for (let i = 0; i < 4 && !report.conclusion.fourthCatalogError; i++) {
    const m = await call(`extra marketCreate #${i + 1}`, M.marketCreate, {
      input: { name: `Tradepass spike ${tag} extra ${i + 1}`, conditions: { companyLocationsCondition: { applicationLevel: "SPECIFIED", companyLocationIds: seed } } },
    });
    const mid = m.data?.marketCreate?.market?.id;
    if (!m.ok) report.conclusion.fourthCatalogError = errorSummary(m.errs);
    if (!mid) continue;
    report.created.markets.push(mid);
    const c = await call(`extra catalogCreate #${i + 1}`, M.catalogCreate, {
      input: { title: `Tradepass spike ${tag} extra ${i + 1}`, status: "ACTIVE", context: { marketIds: [mid] }, priceListId: pl[0] },
    });
    if (c.data?.catalogCreate?.catalog?.id) report.created.catalogs.push(c.data.catalogCreate.catalog.id);
    else report.conclusion.fourthCatalogError = errorSummary(c.errs);
  }

  return report;
}

/** Remove everything a spike run created. Catalog delete also removes its price list. */
export async function cleanupSpike(graphql: Gql, created: SpikeReport["created"]): Promise<SpikeStep[]> {
  const steps: SpikeStep[] = [];
  const run = async (step: string, q: string, id: string) => {
    const start = Date.now();
    const res = await graphql(q, { variables: { id } });
    const response = await res.json();
    steps.push({ step, ms: Date.now() - start, ok: findUserErrors(response).length === 0, response });
  };
  for (const id of created.catalogs) await run("catalogDelete", M.catalogDelete, id);
  for (const id of created.markets) await run("marketDelete", M.marketDelete, id);
  for (const id of created.companies) await run("companyDelete", M.companyDelete, id);
  return steps;
}

function findUserErrors(json: any): { code?: string; message?: string }[] {
  const data = json?.data;
  if (!data || typeof data !== "object") return [];
  return Object.values(data).flatMap((v: any) => (Array.isArray(v?.userErrors) ? v.userErrors : []));
}

function errorSummary(errs: { code?: string; message?: string }[]): string | null {
  if (!errs.length) return null;
  return errs.map((e) => `${e.code ?? "?"}: ${e.message ?? ""}`).join("; ");
}
