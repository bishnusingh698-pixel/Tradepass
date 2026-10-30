// Regression tests for the review fixes (REVIEW.md).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import db from "../app/db.server";
import { defaultSettings } from "../app/lib/settings";
import { parseShopFacts } from "../app/lib/shop.server";
import { timing } from "../app/lib/tiers.server";
import {
  approveApplication, emptySteps, mergeRetryInput, normalizeInput, retryStuckApprovals, type ApprovalState, type ApproveInput,
} from "../app/lib/approval.server";
import { rejectApplicationResult, requestMoreInfo, parseFilters } from "../app/lib/applications.server";
import { requestedDefinition } from "../app/lib/intake.server";
import { defaultFormDefinition } from "../app/lib/form-defaults";
import { markSyncPending, retryPendingSyncs, SYNC_JOB } from "../app/lib/storefront-sync.server";
import { runCertificateDay, setCertificateExpiry } from "../app/lib/certificates.server";
import { sendQueuedEmails } from "../app/lib/email/index.server";
import { validateDefinition } from "../app/components/form-builder/model";
import { sanitizeRules } from "../app/lib/rules";
import { startRun } from "../app/lib/import.server";
import type { Admin } from "../app/lib/gql.server";
import { fakeShopify } from "./tiers-fake";

const rnd = randomBytes(4).toString("hex");
const SHOP = `test-review-${rnd}.myshopify.com`;
timing.sleep = async () => undefined;
delete process.env.BREVO_API_KEY;

let fake: ReturnType<typeof fakeShopify>;
let tierId: string;

beforeAll(async () => {
  await db.shop.create({ data: { shop: SHOP, settings: defaultSettings() as object, billingPlan: "pro", country: "US", name: "Test" } });
});
beforeEach(async () => {
  fake = fakeShopify();
  const marketGid = fake.addMarket(["gid://shopify/CompanyLocation/999"]);
  tierId = (await db.tier.create({ data: { shop: SHOP, name: `T-${randomBytes(2).toString("hex")}`, marketGid, defaults: {} } })).id;
});
afterAll(async () => {
  for (const table of ["certificate", "buyer", "application", "job", "tier", "activityLog", "emailLog", "shopLock", "tokenUse", "importRun"] as const) {
    await (db[table] as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { shop: SHOP } });
  }
  await db.shop.deleteMany({ where: { shop: SHOP } });
});

const newApp = (over: Record<string, unknown> = {}) =>
  db.application.create({
    data: {
      shop: SHOP, idempotencyKey: randomBytes(8).toString("hex"), companyName: "Acme", email: `b-${randomBytes(3).toString("hex")}@example.com`,
      countryCode: "US", locale: "en", answers: {}, ...over,
    },
  });
const input = (over: Partial<ApproveInput> = {}): ApproveInput => ({
  tierId, paymentTermsTemplateId: null, taxExempt: false, exemptions: [], taxRegistrationId: null, companyName: "Acme", locationName: "Acme",
  billingAddress: { address1: "1 Main St", city: "Austin", zoneCode: "TX", zip: "78701", countryCode: "US" }, shippingAddress: null,
  contact: { mode: "new" }, sendWelcome: false, ...over,
});
const ctx = () => ({ admin: fake.admin, shop: SHOP, actor: "test" });

describe("shop facts", () => {
  it("stores name, contact email, currency and country, and treats missing B2B catalogs as markets unavailable", () => {
    const f = parseShopFacts({
      data: {
        shop: {
          name: "Acme", email: "owner@acme.test", contactEmail: "hello@acme.test", currencyCode: "EUR", billingAddress: { countryCodeV2: "DE" },
          plan: { publicDisplayName: "Grow", partnerDevelopment: false, shopifyPlus: false },
          features: { directConnectionCatalogAssignmentEnabled: false },
          entitlements: { b2b: { enabled: true }, markets: { b2b: { enabled: true, catalogs: { enabled: false, limit: 0 } } } },
        },
        shopLocales: [],
      },
    });
    expect(f).toMatchObject({ name: "Acme", email: "hello@acme.test", currency: "EUR", country: "DE", b2bMarketsEnabled: false });
  });
});

describe("approval input", () => {
  it("drops unknown exemptions and bad contacts, falls back to the application's company name", () => {
    const n = normalizeInput({ ...input(), exemptions: ["US_TX_RESELLER_EXEMPTION", "NOPE"], companyName: " ", contact: { mode: "existing", customerGid: "x" } } as ApproveInput, { companyName: "Acme" });
    expect(n.exemptions).toEqual(["US_TX_RESELLER_EXEMPTION"]);
    expect(n.contact).toEqual({ mode: "new" });
    expect(n.companyName).toBe("Acme");
  });
  it("a retry keeps the tier (and other inputs) of steps already done", () => {
    const steps = emptySteps();
    steps.company = { status: "done", gid: "c" };
    steps.location = { status: "done", gid: "l" };
    steps.contact = { status: "done", gid: "x" };
    steps.terms_tax = { status: "done" };
    steps.tier = { status: "done" };
    const prev: ApprovalState = { input: input({ tierId: "old" }), steps, startedAt: new Date().toISOString() };
    expect(mergeRetryInput(prev, input({ tierId: "new", companyName: "Other" }))).toMatchObject({ tierId: "old", companyName: "Acme" });
    steps.tier = { status: "failed" };
    expect(mergeRetryInput(prev, input({ tierId: "new" })).tierId).toBe("new");
  });
});

describe("decisions vs. approval", () => {
  it("rejecting a half-finished approval removes what it created first", async () => {
    let n = 1;
    fake.hooks.TierMarketUpdate = () => (n-- > 0 ? { marketUpdate: { market: null, userErrors: [{ field: null, message: "x", code: "INTERNAL" }] } } : undefined);
    const app = await newApp();
    const state = await approveApplication(ctx(), app.id, input());
    expect(state.steps.tier.status).toBe("failed");
    const companyGid = state.steps.company.gid!;
    expect(fake.companies.has(companyGid)).toBe(true);
    const res = await rejectApplicationResult(ctx(), app.id, { reason: null, email: false });
    expect(res.ok).toBe(true);
    expect(fake.companies.has(companyGid)).toBe(false);
    expect((await db.application.findUnique({ where: { id: app.id } }))!.status).toBe("rejected");
  });
  it("can't reject while an approval holds the lock, nor ask for info after the approval started", async () => {
    const app = await newApp();
    await db.shopLock.create({ data: { shop: SHOP, name: `approval:${app.id}`, holder: "other", expiresAt: new Date(Date.now() + 60_000) } });
    expect(await rejectApplicationResult(ctx(), app.id, { reason: null, email: false })).toEqual({ ok: false, reason: "busy" });
    await db.shopLock.deleteMany({ where: { shop: SHOP } });
    const steps = emptySteps();
    steps.company = { status: "done", gid: "gid://shopify/Company/1", created: true };
    await db.application.update({ where: { id: app.id }, data: { approvalState: { input: input(), steps, startedAt: new Date().toISOString() } as object } });
    expect(await requestMoreInfo(ctx(), app.id, { message: "m", fields: ["phone"] })).toMatchObject({ ok: false, reason: "approval_started" });
  });
  it("never asks for consent again (the hosted page can't show it)", () => {
    const def = requestedDefinition(defaultFormDefinition(), ["consent", "phone"]);
    expect(def.sections.flatMap((s) => s.fields.map((f) => f.id))).toEqual(["phone"]);
  });
});

describe("hourly approval retry", () => {
  it("finds stuck approvals even when many finished ones exist", async () => {
    const finished = emptySteps();
    for (let i = 0; i < 55; i++) {
      await newApp({ status: "approved", approvalState: { input: input(), steps: finished, startedAt: new Date(0).toISOString(), finishedAt: new Date().toISOString() } });
    }
    const steps = emptySteps();
    steps.company = { status: "failed", code: "network" };
    const stuck = await newApp({ submittedAt: new Date(), approvalState: { input: input(), steps, startedAt: new Date().toISOString() } });
    await retryStuckApprovals(Date.now() + 60_000, async () => fake.admin);
    const after = await db.application.findUnique({ where: { id: stuck.id } });
    expect(after!.status).toBe("approved");
  });
});

describe("storefront sync retry", () => {
  it("keeps one pending marker per shop and clears it once a sync works", async () => {
    await markSyncPending(SHOP);
    await markSyncPending(SHOP);
    expect(await db.job.count({ where: { shop: SHOP, type: SYNC_JOB } })).toBe(1);
    // The fake admin has no installation query: the retry fails and stays queued with an attempt counted.
    await retryPendingSyncs(Date.now() + 10_000, async () => fake.admin);
    const job = await db.job.findFirst({ where: { shop: SHOP, type: SYNC_JOB } });
    expect(job?.attempts).toBe(1);
  });
});

describe("queue filters", () => {
  it("ignores malformed dates instead of failing the query", () => {
    const f = parseFilters(new URL("https://x/?from=2026-13-45&to=nope"));
    expect(f.from).toBeUndefined();
    expect(f.to).toBeUndefined();
  });
});

// ---------------------------------------------------------------- group B

describe("certificates daily job", () => {
  it("one certificate whose reminder fails doesn't stop the others", async () => {
    const exp = new Date(Date.now() + 20 * 86_400_000);
    const buyer = await db.buyer.create({ data: { shop: SHOP, companyGid: `gid://shopify/Company/${randomBytes(3).readUIntBE(0, 3)}`, locationGids: [], contactGid: "gid://shopify/CompanyContact/1", name: "B" } });
    // Recipient lookup goes to Shopify (no application) and fails; the second certificate has an application.
    const bad = await db.certificate.create({ data: { shop: SHOP, buyerId: buyer.id, type: "resale", status: "valid", expiresOn: exp } });
    const app = await newApp();
    const good = await db.certificate.create({ data: { shop: SHOP, applicationId: app.id, type: "resale", status: "valid", expiresOn: exp } });
    const failing = { graphql: async () => { throw new Error("down"); } } as unknown as Admin;
    await runCertificateDay(SHOP, { adminFor: async () => failing });
    const [b, g] = await Promise.all([db.certificate.findUnique({ where: { id: bad.id } }), db.certificate.findUnique({ where: { id: good.id } })]);
    expect((b!.remindedAt as Record<string, string>)["30"]).toBeUndefined(); // released, retried tomorrow
    expect((g!.remindedAt as Record<string, string>)["30"]).toBeTruthy();
  });
  it("refuses an impossible expiry date instead of clearing it", async () => {
    const c = await db.certificate.create({ data: { shop: SHOP, type: "resale", status: "valid", expiresOn: new Date("2027-01-01T00:00:00Z") } });
    expect(await setCertificateExpiry(SHOP, c.id, "t", "2027-02-31")).toBe(false);
    expect((await db.certificate.findUnique({ where: { id: c.id } }))!.expiresOn?.toISOString().slice(0, 10)).toBe("2027-01-01");
  });
});

describe("email sending", () => {
  it("doesn't requeue an old email that another run claimed a moment ago", async () => {
    const old = new Date(Date.now() - 3 * 3_600_000);
    const row = await db.emailLog.create({
      data: { shop: SHOP, type: "received", toHash: "x", payload: { to: "a@b.co", locale: "en", vars: {} }, status: "sending", quotaDay: "2000-01-01", createdAt: old, claimedAt: new Date() },
    });
    await sendQueuedEmails(Date.now() + 5_000, { send: async () => ({ ok: true }), shops: [SHOP] });
    expect((await db.emailLog.findUnique({ where: { id: row.id } }))!.status).toBe("sending");
  });
});

describe("form and rules input", () => {
  it("locked fields must stay required", () => {
    const def = defaultFormDefinition();
    def.sections.flatMap((s) => s.fields).find((f) => f.id === "email")!.state = "optional";
    expect(validateDefinition(def).some((e) => e.code === "lockedHidden" && e.fieldId === "email")).toBe(true);
  });
  it("drops unknown rule kinds, conditions and action fields", () => {
    const rules = sanitizeRules([
      { kind: "delete_everything", conditions: { list: [] } },
      { kind: "reject", conditions: { match: "any", list: [{ type: "spam" }, { type: "evil" }] }, action: { email: "yes", reason: 5 } },
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ kind: "reject", conditions: { match: "any", list: [{ type: "spam" }] }, action: { reason: null, email: false } });
  });
  it("a CSV import can't start before its dry run", async () => {
    const run = await db.importRun.create({ data: { shop: SHOP, kind: "csv", state: "draft", mapping: { kind: "csv", headers: [], map: {}, options: {} } } });
    expect(await startRun(SHOP, run.id, "t")).toBe(false);
    await db.importRun.delete({ where: { id: run.id } });
  });
});
