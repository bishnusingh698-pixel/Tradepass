// Regression tests for the bugs found in the 2026-11-07 review (REVIEW.md, part C).
// Every GraphQL operation was checked with the Shopify dev toolkit's validator
// against Admin 2026-10; these tests pin the behaviour that check exposed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import db from "../app/db.server";
import { defaultSettings } from "../app/lib/settings";
import { approvedMessage } from "../app/lib/applications.server";
import { approveApplication, welcomeUnavailable, type ApproveInput } from "../app/lib/approval.server";
import { GqlError } from "../app/lib/gql.server";
import { timing, syncStateFor } from "../app/lib/tiers.server";
import { pauseBuyers, resumeBuyers } from "../app/lib/buyers.server";
import { BUYER_MARKER_JOB, restorePausedMarkers } from "../app/lib/buyer-marker.server";
import { runBackgroundJobs, storefrontRetry } from "../app/lib/tasks/background";
import { SHOP_FACTS_QUERY } from "../app/lib/shop.server";
import { allowReason, companyPaused } from "../extensions/tradepass-checkout-lock/src/cart_validations_generate_run.js";
import { fakeShopify } from "./tiers-fake";

process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.LINK_TOKEN_SECRET ||= "test-link-secret";
timing.sleep = async () => undefined;

const rnd = randomBytes(4).toString("hex");
const SHOP = `test-rev11-${rnd}.myshopify.com`;

beforeAll(async () => {
  await db.shop.create({ data: { shop: SHOP, name: "Nordic Supply", primaryLocale: "en", domainUrl: "https://nordic.test", settings: defaultSettings() as object, b2bEnabled: true, billingPlan: "pro", country: "US" } });
});
afterAll(async () => {
  for (const m of [db.tokenUse, db.application, db.activityLog, db.shopLock, db.buyer, db.tier, db.job, db.certificate]) {
    await (m as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { shop: SHOP } });
  }
  await db.shop.deleteMany({ where: { shop: SHOP } });
});

const input = (tierId: string, over: Partial<ApproveInput> = {}): ApproveInput => ({
  tierId, paymentTermsTemplateId: null, taxExempt: false, exemptions: [], taxRegistrationId: null, companyName: "Acme", locationName: "Acme HQ",
  billingAddress: { address1: "1 Main St", city: "Austin", zoneCode: "TX", countryCode: "US" }, shippingAddress: null,
  contact: { mode: "new" }, sendWelcome: true, ...over,
});

async function setup() {
  const fake = fakeShopify();
  const marketGid = fake.addMarket(["gid://shopify/CompanyLocation/999"]);
  const tier = await db.tier.create({ data: { shop: SHOP, name: `Retail-${randomBytes(2).toString("hex")}`, buyerNames: { fr: "Revendeur" }, marketGid } });
  const app = await db.application.create({
    data: {
      shop: SHOP, idempotencyKey: randomBytes(8).toString("hex"), companyName: "Café Lumière", email: `b-${randomBytes(3).toString("hex")}@lumiere.test`,
      locale: "fr", countryCode: "US", answers: { firstName: "Léa" },
    },
  });
  return { fake, tier, app, ctx: { admin: fake.admin, shop: SHOP, actor: "staff" } };
}

describe("C7 welcome email mutation missing from the Admin schema", () => {
  const schemaError = [{ message: "Field 'companyContactSendWelcomeEmail' doesn't exist on type 'Mutation'", extensions: { code: "undefinedField" } }];

  it("recognises Shopify's unknown-field and access-denied answers, not one-off failures", () => {
    expect(welcomeUnavailable(new GqlError("GraphQL error", schemaError))).toBe(true);
    expect(welcomeUnavailable(new GqlError("GraphQL error", [{ message: "Access denied", extensions: { code: "ACCESS_DENIED" } }]))).toBe(true);
    expect(welcomeUnavailable(new GqlError("GraphQL error", [{ message: "Throttled", extensions: { code: "THROTTLED" } }]))).toBe(false);
    expect(welcomeUnavailable(new Error("network"))).toBe(false);
  });

  it("finishes the approval (no endless 'Approval incomplete') and marks the email step as unavailable", async () => {
    const { fake, tier, app, ctx } = await setup();
    fake.hooks.ApprovalWelcome = () => ({ __errors: schemaError });
    const state = await approveApplication(ctx, app.id, input(tier.id));
    expect(state.steps.email).toMatchObject({ status: "skipped", code: "email_unavailable" });
    expect(state.steps.email.error).toMatch(/welcome email/);
    expect(state.finishedAt).toBeTruthy();
    const row = await db.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(row.status).toBe("approved");
    expect(row.approvalStatus).toBe("done");
  });

  it("offers the 'you're approved' message in the buyer's language with the buyer-facing tier name and sign-in link", async () => {
    const { tier, app, ctx } = await setup();
    await approveApplication(ctx, app.id, input(tier.id, { sendWelcome: false }));
    const m = await approvedMessage(SHOP, app.id);
    expect(m?.locale).toBe("fr");
    expect(m?.to).toBe(app.email);
    expect(m?.body).toContain("Revendeur");
    expect(m?.body).toContain("https://nordic.test/account/login");
    expect(m?.body).toContain("Café Lumière");
    expect(m?.mailto.startsWith(`mailto:${app.email}?subject=`)).toBe(true);
  });

  it("no message for an application that isn't approved", async () => {
    const { app } = await setup();
    expect(await approvedMessage(SHOP, app.id)).toBeNull();
  });
});

describe("C8 tier sync query", () => {
  it("aliases Market.status and Catalog.status (same name, different enum types: the query was invalid)", () => {
    const src = readFileSync("app/lib/tiers.server.ts", "utf8");
    const q = /syncTier: `#graphql([\s\S]*?)`/.exec(src)![1];
    expect(q).toContain("marketStatus: status");
    expect(q).toContain("catalogStatus: status");
    expect(q).not.toMatch(/on Market \{ name status/);
  });

  it("reads the aliased statuses", () => {
    const tier = { mode: "market", marketGid: "m1", catalogGid: "c1", priceListGid: null, discountPct: null };
    expect(syncStateFor(tier, { m1: { marketStatus: "ACTIVE", catalogs: { nodes: [{ id: "c1" }] } }, c1: { catalogStatus: "ACTIVE" } }, false)).toBe("ok");
    expect(syncStateFor(tier, { m1: { marketStatus: "DRAFT", catalogs: { nodes: [{ id: "c1" }] } }, c1: { catalogStatus: "ACTIVE" } }, false)).toBe("changed_in_shopify");
    expect(syncStateFor(tier, { m1: { marketStatus: "ACTIVE", catalogs: { nodes: [{ id: "c1" }] } }, c1: { catalogStatus: "ARCHIVED" } }, false)).toBe("changed_in_shopify");
  });
});

describe("m17 shop facts use shopAddress (billingAddress is deprecated)", () => {
  it("queries shopAddress", () => {
    expect(SHOP_FACTS_QUERY).toContain("shopAddress { countryCodeV2 }");
    expect(SHOP_FACTS_QUERY).not.toContain("billingAddress");
  });
});

describe("N1 paused buyers can't check out in a wholesale-only store", () => {
  const cart = (paused?: string | null, exempt = false) => ({
    buyerJourney: { step: "CHECKOUT_COMPLETION" },
    cart: {
      buyerIdentity: {
        customer: { exempt },
        purchasingCompany: { company: { id: "gid://shopify/Company/1", paused: paused === undefined ? null : paused === null ? null : { value: paused } } },
      },
      lines: [{ merchandise: { __typename: "ProductVariant", product: { isGiftCard: false } } }],
    },
    validation: { config: { jsonValue: { enabled: true, messages: { en: "Wholesale only" } } } },
  });

  it("the Function blocks a paused company and lets active ones (and exempt-tag customers) through", () => {
    expect(companyPaused({ company: { paused: { value: "true" } } })).toBe(true);
    expect(allowReason(cart("true"))).toBeNull();
    expect(allowReason(cart(undefined))).toBe("company");
    expect(allowReason(cart("false"))).toBe("company");
    expect(allowReason(cart("true", true))).toBe("exempt");
  });

  it("the Function's input query reads the app-owned marker on the company", () => {
    const q = readFileSync("extensions/tradepass-checkout-lock/src/cart_validations_generate_run.graphql", "utf8");
    expect(q).toMatch(/paused: metafield\(namespace: "\$app:tradepass", key: "paused"\)/);
  });

  it("pause writes the marker, resume removes it", async () => {
    const fake = fakeShopify();
    const ctx = { admin: fake.admin, shop: SHOP, actor: "staff" };
    const buyer = await db.buyer.create({ data: { shop: SHOP, companyGid: `gid://shopify/Company/${randomBytes(3).readUIntBE(0, 3)}`, locationGids: [], name: "Paused Co" } });
    await pauseBuyers(ctx, [buyer.id]);
    expect(fake.metafields.get(`${buyer.companyGid}|$app:tradepass|paused`)).toBe("true");
    await resumeBuyers(ctx, [buyer.id]);
    expect(fake.metafields.has(`${buyer.companyGid}|$app:tradepass|paused`)).toBe(false);
  });

  it("a failed write is queued and retried by the hourly job until it works", async () => {
    const fake = fakeShopify();
    fake.hooks.BuyerPausedSet = () => ({ __errors: [{ message: "Internal error" }] });
    const ctx = { admin: fake.admin, shop: SHOP, actor: "staff" };
    const buyer = await db.buyer.create({ data: { shop: SHOP, companyGid: `gid://shopify/Company/${randomBytes(3).readUIntBE(0, 3)}`, locationGids: [], name: "Flaky Co" } });
    const res = await pauseBuyers(ctx, [buyer.id]);
    expect(res.moved).toEqual([buyer.id]); // the pause itself still went through
    const job = await db.job.findFirstOrThrow({ where: { shop: SHOP, type: BUYER_MARKER_JOB } });
    await db.job.update({ where: { id: job.id }, data: { runAfter: new Date(0) } });
    const seen: string[] = [];
    const orig = storefrontRetry.marker;
    storefrontRetry.marker = async (shop, buyerId) => { seen.push(`${shop}:${buyerId}`); };
    try {
      await runBackgroundJobs(Date.now() + 10_000);
    } finally {
      storefrontRetry.marker = orig;
    }
    expect(seen).toEqual([`${SHOP}:${buyer.id}`]);
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).state).toBe("done");
  });

  it("a reinstall writes the marker on every paused buyer again", async () => {
    const fake = fakeShopify();
    const n = await restorePausedMarkers(fake.admin, SHOP);
    const paused = await db.buyer.findMany({ where: { shop: SHOP, status: "paused" } });
    expect(n).toBe(paused.length);
    for (const b of paused) expect(fake.metafields.get(`${b.companyGid}|$app:tradepass|paused`)).toBe("true");
  });
});
