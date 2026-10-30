import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import db from "../app/db.server";
import { activeSubscription, cleanDomainUrl, parseShopFacts, storefrontUrl } from "../app/lib/shop.server";
import { checkTaxIdFormat, TAX_ID_RULES, storefrontTaxRule } from "../app/lib/tax-ids";
import { countryAllowed, defaultSettings } from "../app/lib/settings";
import { applyTemplate, defaultFormDefinition, FORM_TEMPLATES } from "../app/lib/form-defaults";
import { approvalStatusOf, emptySteps, retryStuckApprovals, type ApprovalState } from "../app/lib/approval.server";
import { rejectApplicationWithReason, requestMoreInfo, buildWhere } from "../app/lib/applications.server";
import { tryLock, unlock } from "../app/lib/lock.server";
import { lastMonths, monthlyReport } from "../app/lib/home.server";
import { handleSubmit, type IntakeDeps } from "../app/lib/intake.server";
import { exportDataRequest, recordDataRequest, redactCustomer } from "../app/lib/privacy.server";
import { encrypt } from "../app/lib/crypto.server";
import { isDigestDay } from "../app/lib/tasks/emails";
import { DELETE_FILES_JOB } from "../app/lib/tasks/background";

process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.LINK_TOKEN_SECRET ||= "test-link-secret";

const rnd = randomBytes(4).toString("hex");
const SHOP = `test-audit-${rnd}.myshopify.com`;

const baseFacts = (shop: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  data: {
    shop: {
      name: "Acme Supply", email: "owner@acme.test", contactEmail: "hello@acme.test", currencyCode: "EUR",
      billingAddress: { countryCodeV2: "DE" }, primaryDomain: { url: "https://acme.test/" },
      plan: { publicDisplayName: "Grow", partnerDevelopment: false, shopifyPlus: false },
      features: { directConnectionCatalogAssignmentEnabled: false },
      entitlements: { b2b: { enabled: true }, markets: { b2b: { enabled: true, catalogs: { enabled: true, limit: 3 } } } },
      ...shop,
    },
    shopLocales: [{ locale: "de", primary: true, published: true }],
    b2bMarkets: { nodes: [] },
    ...extra,
  },
});

describe("B1/B2: store profile and the real subscription", () => {
  it("reads name, emails, currency, country and primary domain", () => {
    const f = parseShopFacts(baseFacts());
    expect(f.profile).toEqual({ name: "Acme Supply", email: "owner@acme.test", contactEmail: "hello@acme.test", currency: "EUR", country: "DE", domainUrl: "https://acme.test" });
  });
  it("leaves billing alone when the query has no installation, and reads Free when nothing is active", () => {
    expect(parseShopFacts(baseFacts()).subscription).toBeUndefined();
    const f = parseShopFacts(baseFacts({}, { currentAppInstallation: { activeSubscriptions: [] } }));
    expect(f.subscription).toMatchObject({ plan: "free", gid: null });
  });
  it("ignores test charges on live stores but accepts them on development stores", () => {
    const subs = [{ id: "gid://shopify/AppSubscription/1", name: "Tradepass Pro", status: "ACTIVE", test: true, trialDays: 14, createdAt: "2026-10-01T00:00:00Z" }];
    expect(activeSubscription(subs, false)?.plan).toBe("free");
    expect(activeSubscription(subs, true)?.plan).toBe("pro");
    expect(activeSubscription([{ ...subs[0], test: false, name: "Tradepass Starter" }], false)).toMatchObject({ plan: "starter", trialDays: 14 });
  });
  it("builds absolute storefront links on the store's own domain", () => {
    expect(cleanDomainUrl("http://insecure.test")).toBeNull();
    expect(storefrontUrl({ shop: "a.myshopify.com", domainUrl: "https://acme.test" }, "/account/login")).toBe("https://acme.test/account/login");
    expect(storefrontUrl({ shop: "a.myshopify.com", domainUrl: null }, "/apps/tradepass/update/x")).toBe("https://a.myshopify.com/apps/tradepass/update/x");
    expect(storefrontUrl(null, "https://other.test/login")).toBe("https://other.test/login");
  });
});

describe("B9/F3: country tax IDs", () => {
  it("accepts well-formed numbers with or without the country prefix and punctuation", () => {
    expect(checkTaxIdFormat("DE", "DE 123.456.789")).toBe("ok");
    expect(checkTaxIdFormat("DE", "123456789")).toBe("ok");
    expect(checkTaxIdFormat("GR", "EL123456789")).toBe("ok");
    expect(checkTaxIdFormat("CH", "CHE-123.456.789 MWST")).toBe("ok");
    expect(checkTaxIdFormat("IN", "22AAAAA0000A1Z5")).toBe("ok");
    expect(checkTaxIdFormat("BR", "12.345.678/0001-95")).toBe("ok");
  });
  it("refuses only formats it knows for certain", () => {
    expect(checkTaxIdFormat("DE", "DE12345")).toBe("invalid");
    expect(checkTaxIdFormat("IN", "12345")).toBe("invalid");
    expect(checkTaxIdFormat("SG", "!!")).toBe("unchecked"); // not strict: never blocks
    expect(checkTaxIdFormat("US", "anything")).toBe("unchecked"); // resale certificates vary by state
    expect(checkTaxIdFormat(null, "x")).toBe("unchecked");
  });
  it("every example passes its own rule, and the storefront copy is in sync", () => {
    for (const [cc, r] of Object.entries(TAX_ID_RULES)) {
      if (r.re) expect(checkTaxIdFormat(cc, r.ex), cc).not.toBe("invalid");
    }
    const countries = JSON.parse(readFileSync("extensions/tradepass-theme/assets/tradepass-countries.json", "utf8")) as Record<string, { t?: unknown }>;
    for (const [cc, r] of Object.entries(TAX_ID_RULES)) expect(countries[cc]?.t, cc).toEqual(storefrontTaxRule(r));
  });
});

describe("F4: country rules", () => {
  it("allow, block and all", () => {
    expect(countryAllowed({ mode: "all", list: ["FR"] }, "FR")).toBe(true);
    expect(countryAllowed({ mode: "allow", list: ["US", "CA"] }, "ca")).toBe(true);
    expect(countryAllowed({ mode: "allow", list: ["US", "CA"] }, "DE")).toBe(false);
    expect(countryAllowed({ mode: "block", list: ["RU"] }, "RU")).toBe(false);
    expect(countryAllowed({ mode: "block", list: ["RU"] }, null)).toBe(true);
  });
});

describe("F2: form templates", () => {
  it("only changes standard question states; core fields stay required and custom questions are kept", () => {
    const def = defaultFormDefinition();
    def.sections[0].fields.push({ id: "custom_1", type: "text", state: "optional", custom: true });
    for (const tpl of FORM_TEMPLATES) {
      const out = applyTemplate(def, tpl);
      const field = (id: string) => out.sections.flatMap((s) => s.fields).find((f) => f.id === id)!;
      for (const core of ["companyName", "email", "firstName", "lastName", "billingAddress", "consent"]) expect(field(core).state, `${tpl} ${core}`).toBe("required");
      expect(field("custom_1")).toMatchObject({ state: "optional", custom: true });
    }
    const salon = applyTemplate(def, "salon").sections.flatMap((s) => s.fields);
    expect(salon.find((f) => f.id === "certificates")?.state).toBe("required");
    const reseller = applyTemplate(def, "reseller").sections.flatMap((s) => s.fields);
    expect(reseller.find((f) => f.id === "taxNumber")?.state).toBe("required");
  });
});

describe("weekly digest", () => {
  it("sends weekly summaries on Mondays only", () => {
    expect(isDigestDay("weekly", new Date("2026-11-02T03:00:00Z"))).toBe(true); // Monday
    expect(isDigestDay("weekly", new Date("2026-11-03T03:00:00Z"))).toBe(false);
    expect(isDigestDay("digest", new Date("2026-11-03T03:00:00Z"))).toBe(true);
    expect(isDigestDay("off", new Date("2026-11-02T03:00:00Z"))).toBe(false);
  });
});

// ------------------------------------------------------------------ DB-backed

const state = (over: Partial<ApprovalState> = {}): ApprovalState => ({
  input: {} as ApprovalState["input"],
  steps: emptySteps(),
  startedAt: new Date(Date.now() - 3_600_000).toISOString(),
  ...over,
});

async function app(data: Record<string, unknown> = {}) {
  return db.application.create({
    data: {
      shop: SHOP, idempotencyKey: `k-${randomBytes(6).toString("hex")}`, companyName: `Co ${randomBytes(3).toString("hex")}`,
      email: `x-${randomBytes(3).toString("hex")}@example.com`, answers: {}, ...data,
    },
  });
}

const dctx = { admin: { graphql: vi.fn() } as never, shop: SHOP, actor: "staff" };

beforeAll(async () => {
  await db.shop.create({ data: { shop: SHOP, name: "Audit Store", settings: defaultSettings() as object, billingPlan: "starter" } });
  await db.form.create({ data: { shop: SHOP, name: "Default", isDefault: true, definition: defaultFormDefinition() as object } });
});

afterAll(async () => {
  for (const m of [db.applicationFile, db.certificate, db.application, db.activityLog, db.tokenUse, db.form, db.job, db.shopLock, db.emailLog] as unknown as { deleteMany: (a: object) => Promise<unknown> }[]) {
    await m.deleteMany({ where: { shop: SHOP } });
  }
  await db.shop.deleteMany({ where: { shop: SHOP } });
});

describe("B4: decisions vs. an approval in progress", () => {
  it("refuses to reject or ask for info once an approval has created things in Shopify", async () => {
    const a = await app({ approvalState: state() as object, approvalStatus: "failed" });
    expect(await rejectApplicationWithReason(dctx, a.id, { reason: null, email: false })).toBe("approval_started");
    expect(await requestMoreInfo(dctx, a.id, { message: "x", fields: ["website"] })).toMatchObject({ ok: false, error: "approval_started" });
    expect((await db.application.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("pending");
  });
  it("two simultaneous rejects: exactly one wins, the other is told it's already decided or busy", async () => {
    const a = await app();
    const results = await Promise.all([
      rejectApplicationWithReason(dctx, a.id, { reason: null, email: false }),
      rejectApplicationWithReason(dctx, a.id, { reason: null, email: false }),
    ]);
    expect(results.filter((r) => r === true)).toHaveLength(1);
    expect(results.find((r) => r !== true)).toMatch(/^(not_open|busy)$/);
  });
});

describe("B3: lock TTL", () => {
  it("a long lock is not taken over by a second caller", async () => {
    const h = await tryLock(SHOP, "approval:ttl", 600_000);
    expect(h).toBeTruthy();
    expect(await tryLock(SHOP, "approval:ttl", 600_000)).toBeNull();
    await unlock(SHOP, "approval:ttl", h!);
  });
});

describe("B5: hourly retry finds stuck approvals behind finished ones", () => {
  it("scans only unfinished approvals", async () => {
    expect(approvalStatusOf(null)).toBeNull();
    expect(approvalStatusOf(state({ finishedAt: new Date().toISOString() }))).toBe("done");
    for (let i = 0; i < 55; i++) {
      await app({ status: "approved", approvalStatus: "done", approvalState: state({ finishedAt: new Date().toISOString() }) as object, submittedAt: new Date(Date.now() - 86_400_000 * 30) });
    }
    const stuck = state();
    stuck.steps.company = { status: "failed", code: "network" };
    const s = await app({ approvalState: stuck as object, approvalStatus: "failed" });
    // The Shopify call fails here (no session); what matters is that the stuck row was reached.
    await retryStuckApprovals(Date.now() + 10_000, async () => { throw new Error("no session"); });
    const after = await db.application.findUniqueOrThrow({ where: { id: s.id } });
    expect((after.approvalState as unknown as ApprovalState).autoRetries).toBe(1);
  });
  it("the Applications filter finds them too", () => {
    const where = JSON.stringify(buildWhere(SHOP, { tab: "all", approval: "incomplete" }));
    expect(where).toContain("approvalStatus");
  });
});

describe("F7: monthly report", () => {
  it("counts per month with approval rate and average days to decide", async () => {
    const now = new Date();
    const thisMonth = lastMonths(1, now)[0];
    const submitted = new Date(Date.now() - 2 * 86_400_000);
    await app({ status: "approved", submittedAt: submitted, decidedAt: new Date(submitted.getTime() + 86_400_000) });
    await app({ status: "rejected", submittedAt: submitted, decidedAt: new Date(submitted.getTime() + 3 * 86_400_000) });
    const rows = await monthlyReport(SHOP, now);
    expect(rows).toHaveLength(6);
    const m = rows.find((r) => r.month === thisMonth)!;
    expect(m.approved).toBeGreaterThanOrEqual(1);
    expect(m.rejected).toBeGreaterThanOrEqual(1);
    expect(m.rate).toBeGreaterThan(0);
    expect(m.avgDays).toBeGreaterThan(0);
  });
});

describe("intake: country rule, tax format, background follow-ups", () => {
  const deps = () => {
    const d = {
      getAdmin: vi.fn(async () => ({ graphql: vi.fn() }) as never),
      checkTaxNumber: vi.fn(async () => ({ status: "verified" as const })),
      queueEmail: vi.fn(async () => ({ queued: true })),
      notifyMerchant: vi.fn(async () => ({ queued: true })),
      emitFlowTrigger: vi.fn(async () => undefined),
      evaluateRules: vi.fn(async () => ({ decided: null })),
      recordApplicationCertificates: vi.fn(async () => undefined),
      defer: vi.fn(async () => undefined), // production: runs after the response
    };
    return d as typeof d & IntakeDeps;
  };
  const body = (answers: Record<string, unknown> = {}) => ({
    idempotencyKey: `audit-${randomBytes(6).toString("hex")}`, locale: "en", elapsedMs: 9000, hp: "",
    answers: {
      companyName: `Shop ${randomBytes(3).toString("hex")}`, businessType: "retail", firstName: "A", lastName: "B",
      email: `a-${randomBytes(3).toString("hex")}@example.com`, consent: true,
      billingAddress: { countryCode: "DE", address1: "Weg 1", city: "Köln" }, ...answers,
    },
  });
  const ctx = () => ({ shop: SHOP, loggedInCustomerId: null, ip: `172.16.${randomBytes(1)[0]}.${randomBytes(1)[0]}#${rnd}` });

  it("answers without waiting for Flow and rules", async () => {
    const d = deps();
    const r = await handleSubmit(ctx(), body(), d);
    expect(r.http).toBe(200);
    expect(d.defer).toHaveBeenCalledOnce();
    expect(d.evaluateRules).not.toHaveBeenCalled();
  });
  it("refuses a tax number in a format that can't be right, on the server too", async () => {
    const r = await handleSubmit(ctx(), body({ taxNumber: { country: "DE", number: "DE12" } }), deps());
    expect(r).toMatchObject({ http: 400, body: { errors: { taxNumber: "form.error.tax_format" } } });
  });
  it("enforces the merchant's country rule", async () => {
    const s = defaultSettings();
    s.applications.countries = { mode: "allow", list: ["US"] };
    await db.shop.update({ where: { shop: SHOP }, data: { settings: s as object } });
    const r = await handleSubmit(ctx(), body(), deps());
    expect(r).toMatchObject({ http: 400, body: { errors: { billingAddress: "form.error.country_blocked" } } });
    await db.shop.update({ where: { shop: SHOP }, data: { settings: defaultSettings() as object } });
  });
});

describe("B8: privacy", () => {
  it("redact queues deletion of the applicant's files; data requests export decrypted data", async () => {
    const email = `gdpr-${rnd}@example.com`;
    const a = await app({ email, taxNumberEnc: encrypt("DE123456789"), answers: { website: "https://x.test", taxNumberHash: "h" } });
    await db.applicationFile.create({ data: { shop: SHOP, applicationId: a.id, fileGid: "gid://shopify/GenericFile/1", kind: "certificate" } });
    await recordDataRequest(SHOP, { id: 77, email });
    const req = await db.activityLog.findFirstOrThrow({ where: { shop: SHOP, action: "privacy.data_request" } });
    const out = (await exportDataRequest(SHOP, req.id)) as { applications: { taxNumber: string; answers: Record<string, unknown>; files: unknown[] }[] };
    expect(out.applications[0].taxNumber).toBe("DE123456789");
    expect(out.applications[0].answers).not.toHaveProperty("taxNumberHash");
    expect(out.applications[0].files).toHaveLength(1);

    expect(await redactCustomer(SHOP, { id: 77, email })).toBe(1);
    const job = await db.job.findFirstOrThrow({ where: { shop: SHOP, type: DELETE_FILES_JOB } });
    expect((job.payload as { fileGids: string[] }).fileGids).toEqual(["gid://shopify/GenericFile/1"]);
    expect(await db.application.count({ where: { shop: SHOP, email } })).toBe(0);
  });
});

describe("plan without B2B", () => {
  it("approval is refused in plain words before anything is created in Shopify", async () => {
    const { approveApplication, ApprovalError } = await import("../app/lib/approval.server");
    const NOB2B = `test-audit-nob2b-${rnd}.myshopify.com`;
    await db.shop.create({ data: { shop: NOB2B, settings: defaultSettings() as object, billingPlan: "pro", b2bEnabled: false } });
    const a = await db.application.create({ data: { shop: NOB2B, idempotencyKey: `nb-${rnd}`, companyName: "No B2B Co", email: "nb@example.com", answers: {} } });
    // The live re-check sees a plan without B2B too.
    const facts = baseFacts({ entitlements: { b2b: { enabled: false }, markets: { b2b: { enabled: false, catalogs: { enabled: false, limit: 0 } } } } });
    const graphql = vi.fn(async () => ({ json: async () => facts }));
    const input = {
      tierId: "t1", paymentTermsTemplateId: null, taxExempt: false, exemptions: [], taxRegistrationId: null, companyName: "No B2B Co", locationName: "HQ",
      billingAddress: { address1: "1 Main", city: "Austin", countryCode: "US" }, shippingAddress: null, contact: { mode: "new" as const }, sendWelcome: false,
    };
    await expect(approveApplication({ admin: { graphql }, shop: NOB2B, actor: "staff" }, a.id, input)).rejects.toBeInstanceOf(ApprovalError);
    // Only the plan check ran: no company, location or contact was created.
    expect(graphql.mock.calls.every((c) => String((c as unknown[])[0]).includes("TradepassShopFacts"))).toBe(true);
    await db.shopLock.deleteMany({ where: { shop: NOB2B } });
    await db.application.deleteMany({ where: { shop: NOB2B } });
    await db.shop.deleteMany({ where: { shop: NOB2B } });
  });
});
