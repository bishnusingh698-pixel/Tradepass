// Regression tests for the bugs fixed in REVIEW.md (2026-11-01). Each block names the REVIEW.md id.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import db from "../app/db.server";
import { defaultSettings } from "../app/lib/settings";
import { defaultFormDefinition } from "../app/lib/form-defaults";
import { STOREFRONT_SYNC_JOB, syncStorefrontConfig } from "../app/lib/storefront-sync.server";
import { runBackgroundJobs, storefrontRetry, STOREFRONT_SYNC } from "../app/lib/tasks/background";
import { applyUpdate, cleanAnswers, handleSubmit, requestedDefinition, type IntakeDeps } from "../app/lib/intake.server";
import { addNote, parseFilters } from "../app/lib/applications.server";
import { mergeRetryInput, normalizeApproveInput, retryStuckApprovals, emptySteps, type ApprovalState, type ApproveInput } from "../app/lib/approval.server";
import { isRealDate } from "../app/lib/dates";
import { hit } from "../app/lib/spam.server";
import { checkTaxNumber } from "../app/lib/taxcheck.server";
import { enforcePlanLimits } from "../app/lib/billing.server";
import { createCsvRun, startRun } from "../app/lib/import.server";
import { moveErrorCode } from "../app/lib/buyers.server";
import { applyRenewalUpload, runCertificateDay, setCertificateExpiry } from "../app/lib/certificates.server";
import type { Admin } from "../app/lib/gql.server";

process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.LINK_TOKEN_SECRET ||= "test-link-secret";

const rnd = randomBytes(4).toString("hex");
const SHOP = `test-review-${rnd}.myshopify.com`;

beforeAll(async () => {
  await db.shop.create({ data: { shop: SHOP, name: "Review Store", settings: defaultSettings() as object, billingPlan: "pro", b2bEnabled: true } });
  await db.form.create({ data: { shop: SHOP, name: "Default", isDefault: true, definition: defaultFormDefinition() as object } });
});
afterAll(async () => {
  for (const m of [db.job, db.application, db.applicationFile, db.certificate, db.buyer, db.activityLog, db.rule, db.importRun, db.form, db.tokenUse]) {
    await (m as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { shop: SHOP } });
  }
  await db.rateHit.deleteMany({ where: { key: { startsWith: `review-${rnd}` } } });
  await db.shop.deleteMany({ where: { shop: SHOP } });
});

const failingAdmin = { graphql: async () => { throw new Error("Shopify down"); } } as unknown as Admin;

describe("C1: a failed storefront push is retried until Shopify accepts it", () => {
  it("queues one retry job per shop, keeps retrying past the normal attempt limit, and a later success clears it", async () => {
    await expect(syncStorefrontConfig(failingAdmin, SHOP)).rejects.toThrow();
    await expect(syncStorefrontConfig(failingAdmin, SHOP)).rejects.toThrow();
    expect(await db.job.count({ where: { shop: SHOP, type: STOREFRONT_SYNC_JOB, state: "queued" } })).toBe(1);
    expect(STOREFRONT_SYNC).toBe(STOREFRONT_SYNC_JOB);

    const push = vi.spyOn(storefrontRetry, "push").mockRejectedValue(new Error("still down"));
    for (let i = 0; i < 7; i++) {
      await db.job.updateMany({ where: { shop: SHOP, type: STOREFRONT_SYNC_JOB }, data: { runAfter: new Date(Date.now() - 1000) } });
      await runBackgroundJobs(Date.now() + 10_000);
    }
    // Still queued after 7 failed hours (other jobs give up after 5): a stale storefront is never left alone.
    expect(await db.job.findFirstOrThrow({ where: { shop: SHOP, type: STOREFRONT_SYNC_JOB } })).toMatchObject({ state: "queued", attempts: 7 });

    push.mockResolvedValue(undefined);
    await db.job.updateMany({ where: { shop: SHOP, type: STOREFRONT_SYNC_JOB }, data: { runAfter: new Date(Date.now() - 1000) } });
    await runBackgroundJobs(Date.now() + 10_000);
    expect(await db.job.findFirstOrThrow({ where: { shop: SHOP, type: STOREFRONT_SYNC_JOB } })).toMatchObject({ state: "done" });
    expect(push).toHaveBeenLastCalledWith(SHOP);
    push.mockRestore();
  });
});

describe("C3: the more-info reply", () => {
  const mk = (over: Record<string, unknown> = {}) =>
    db.application.create({
      data: {
        shop: SHOP, idempotencyKey: randomBytes(8).toString("hex"), companyName: "Reply Co", email: "orig@reply.test", status: "needs_info",
        answers: { email: "orig@reply.test", website: "https://old.test" }, requested: { fields: ["website", "email", "consent"], message: "x" }, ...over,
      },
    });
  const deps = { checkTaxNumber: vi.fn(), recordApplicationCertificates: vi.fn(async () => undefined) } as unknown as Pick<IntakeDeps, "checkTaxNumber" | "recordApplicationCertificates">;

  it("never asks for consent or the email, so a required consent can't block the reply", () => {
    const def = requestedDefinition(defaultFormDefinition(), ["website", "email", "consent"]);
    expect(def.sections.flatMap((s) => s.fields.map((f) => f.id))).toEqual(["website"]);
    expect(cleanAnswers(def, { website: "https://new.test" }, SHOP).errors).toEqual({});
  });

  it("keeps the original email and goes back to pending", async () => {
    const app = await mk();
    expect(await applyUpdate({ shop: SHOP, ip: "1.1.1.1" }, app.id, { answers: { website: "https://new.test", email: "attacker@evil.test" } }, deps)).toEqual({ ok: true });
    const after = await db.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(after.status).toBe("pending");
    expect(after.email).toBe("orig@reply.test");
    expect((after.answers as Record<string, unknown>).email).toBe("orig@reply.test");
    expect((after.answers as Record<string, unknown>).website).toBe("https://new.test");
  });

  it("can't reopen an application the merchant rejected or started approving meanwhile", async () => {
    const rejected = await mk({ status: "rejected" });
    expect(await applyUpdate({ shop: SHOP, ip: "1.1.1.1" }, rejected.id, { answers: { website: "https://x.test" } }, deps)).toEqual({ ok: false, error: "closed" });
    expect((await db.application.findUniqueOrThrow({ where: { id: rejected.id } })).status).toBe("rejected");
    const approving = await mk({ approvalStatus: "running" });
    expect(await applyUpdate({ shop: SHOP, ip: "1.1.1.1" }, approving.id, { answers: { website: "https://x.test" } }, deps)).toEqual({ ok: false, error: "closed" });
  });
});

describe("C5/C6: approval input from the browser", () => {
  const base = {
    tierId: "t1", companyName: "  Acme  ", billingAddress: { address1: "1 Main", city: "Austin", countryCode: "us", zoneCode: "tx" },
    contact: { mode: "new" }, taxExempt: true, exemptions: ["US_TX_RESELLER_EXEMPTION", "NOT_A_REAL_EXEMPTION"], paymentTermsTemplateId: "<script>",
  };

  it("is rebuilt from known fields and values", () => {
    const out = normalizeApproveInput(base)!;
    expect(out).toMatchObject({
      companyName: "Acme", locationName: "Acme", exemptions: ["US_TX_RESELLER_EXEMPTION"], taxExempt: true, paymentTermsTemplateId: null, sendWelcome: true,
      billingAddress: { countryCode: "US", zoneCode: "TX" }, contact: { mode: "new" }, shippingAddress: null,
    });
    expect(normalizeApproveInput({ ...base, companyName: "" })).toBeNull();
    expect(normalizeApproveInput({ ...base, contact: { mode: "existing", customerGid: "1 OR 1=1" } })).toBeNull();
    expect(normalizeApproveInput({ ...base, exemptions: ["NOPE"] })!.taxExempt).toBe(false);
    expect(normalizeApproveInput("nonsense")).toBeNull();
  });

  it("keeps the inputs of finished steps on retry", () => {
    const steps = emptySteps();
    steps.company = { status: "done", gid: "gid://shopify/Company/1" };
    steps.location = { status: "done", gid: "gid://shopify/CompanyLocation/1" };
    steps.contact = { status: "done", gid: "gid://shopify/CompanyContact/1" };
    steps.terms_tax = { status: "done" };
    steps.tier = { status: "failed", code: "busy" };
    const prevInput = normalizeApproveInput(base)!;
    const prev: ApprovalState = { input: prevInput, steps, startedAt: new Date().toISOString() };
    const next: ApproveInput = { ...prevInput, companyName: "Other", tierId: "t2", taxExempt: false, exemptions: [], sendWelcome: false };
    expect(mergeRetryInput(prev, next)).toMatchObject({ companyName: "Acme", taxExempt: true, tierId: "t2", sendWelcome: false });
  });
});

describe("M7: hourly approval retry isn't starved by approvals that can't be retried", () => {
  it("reaches a stuck approval behind 120 permanently failed ones", async () => {
    const stuck = (code: string, autoRetries = 0) => ({ input: {}, steps: { ...emptySteps(), company: { status: "failed", code } }, startedAt: new Date(0).toISOString(), autoRetries });
    await db.application.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        id: `aaa-${rnd}-${String(i).padStart(3, "0")}`, shop: SHOP, idempotencyKey: `perm-${rnd}-${i}`, companyName: "P", email: "p@p.test", answers: {},
        approvalState: stuck("shopify") as object, approvalStatus: "failed",
      })),
    });
    const target = await db.application.create({
      data: { id: `zzz-${rnd}`, shop: SHOP, idempotencyKey: `stuck-${rnd}`, companyName: "S", email: "s@s.test", answers: {}, approvalState: stuck("network") as object, approvalStatus: "failed" },
    });
    await retryStuckApprovals(Date.now() + 20_000, async () => { throw new Error("no session in tests"); });
    expect(((await db.application.findUniqueOrThrow({ where: { id: target.id } })).approvalState as { autoRetries?: number }).autoRetries).toBe(1);
  });
});

describe("intake hardening", () => {
  const deps = () => ({
    getAdmin: vi.fn(async () => null), checkTaxNumber: vi.fn(async () => ({ status: "verified" as const })),
    emitFlowTrigger: vi.fn(async () => undefined), evaluateRules: vi.fn(async () => ({ decided: null })),
    recordApplicationCertificates: vi.fn(async () => undefined), defer: vi.fn(async () => undefined),
  }) as unknown as IntakeDeps;
  const body = (ip: string) => ({
    idempotencyKey: `rv-${randomBytes(6).toString("hex")}`, locale: "en", elapsedMs: 9000, hp: "",
    answers: {
      companyName: `Co ${randomBytes(3).toString("hex")}`, businessType: "retail", firstName: "A", lastName: "B", email: `${randomBytes(4).toString("hex")}@ex.test`,
      billingAddress: { address1: "1 St", city: "Berlin", countryCode: "DE" }, consent: true,
    },
    ip,
  });

  it("M8: flags a human-looking submission from an address that just sent bot-like ones", async () => {
    const ip = `10.99.${randomBytes(1)[0]}.7#${rnd}`;
    await handleSubmit({ shop: SHOP, loggedInCustomerId: null, ip }, { ...body(ip), hp: "bot" }, deps());
    const real = body(ip);
    expect((await handleSubmit({ shop: SHOP, loggedInCustomerId: null, ip }, real, deps())).http).toBe(200);
    expect((await db.application.findFirstOrThrow({ where: { shop: SHOP, idempotencyKey: real.idempotencyKey } })).flags).toContain("possible_spam");
  });

  it("refuses impossible dates instead of rolling them over", () => {
    expect(isRealDate("2028-02-29")).toBe(true);
    expect(isRealDate("2027-02-29")).toBe(false);
    expect(isRealDate("2027-02-31")).toBe(false);
    expect(isRealDate("2027-13-01")).toBe(false);
    const def = defaultFormDefinition();
    def.sections[0].fields.push({ id: "custom_1", type: "date", state: "required", custom: true, texts: { en: { label: "Founded" } } } as never);
    expect(cleanAnswers(def, { custom_1: "2027-02-31" }, SHOP).errors.custom_1).toBe("form.error.date");
  });

  it("counts simultaneous first hits without failing any of them", async () => {
    const key = `review-${rnd}-burst`;
    const res = await Promise.all(Array.from({ length: 15 }, () => hit(key, 10)));
    expect(res.map((r) => r.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(res.filter((r) => r.allowed)).toHaveLength(10);
  });

  it("M10: the whole tax check fits in the applicant's request", async () => {
    const never = (() => new Promise(() => undefined)) as unknown as typeof fetch;
    const started = Date.now();
    expect(await checkTaxNumber("DE", "DE123456789", never, 200)).toEqual({ status: "unavailable" });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("merchant side", () => {
  it("m1: a malformed date filter is ignored instead of crashing the queue", () => {
    const f = parseFilters(new URL("https://x.test/app/applications?from=yesterday&to=2026-02-30"));
    expect(f.from).toBeUndefined();
    expect(f.to).toBeUndefined();
    expect(parseFilters(new URL("https://x.test/?from=2026-02-01")).from).toBe("2026-02-01");
  });

  it("m8: two notes added at the same moment are both kept", async () => {
    const app = await db.application.create({ data: { shop: SHOP, idempotencyKey: `n-${rnd}`, companyName: "N", email: "n@n.test", answers: {} } });
    await Promise.all([addNote(SHOP, app.id, "Ann", "first"), addNote(SHOP, app.id, "Bob", "second"), addNote(SHOP, app.id, "Cy", "third")]);
    const notes = (await db.application.findUniqueOrThrow({ where: { id: app.id } })).notes as { text: string }[];
    expect(notes.map((n) => n.text).sort()).toEqual(["first", "second", "third"]);
  });

  it("C4: plan limits are applied only for a confirmed plan", async () => {
    await db.rule.create({ data: { shop: SHOP, kind: "approve", conditions: {}, action: {} } });
    await enforcePlanLimits(SHOP, "pro");
    expect(await db.rule.count({ where: { shop: SHOP, enabled: true } })).toBe(1);
    await enforcePlanLimits(SHOP, "starter");
    expect(await db.rule.count({ where: { shop: SHOP, enabled: true } })).toBe(0);
  });

  it("m4: a CSV import can't start before its dry run", async () => {
    const run = await createCsvRun(SHOP, "company_name,email\nAcme,a@b.test\n");
    expect(await startRun(SHOP, run.id, "staff")).toBe(false);
    await db.importRun.update({ where: { id: run.id }, data: { state: "validated" } });
    expect(await startRun(SHOP, run.id, "staff")).toBe(true);
  });

  it("m14: unexpected error codes show the generic Shopify message, not a raw key", () => {
    expect(moveErrorCode({ code: "P2025" })).toBe("shopify");
    expect(moveErrorCode(new Error("x"))).toBe("shopify");
    expect(moveErrorCode({ code: "busy" })).toBe("busy");
  });
});

describe("certificates", () => {
  it("m13: a renewal upload keeps the replaced file listed under the application (deleted with it later)", async () => {
    const app = await db.application.create({ data: { shop: SHOP, idempotencyKey: `c-${rnd}`, companyName: "C", email: "c@c.test", answers: {} } });
    const cert = await db.certificate.create({ data: { shop: SHOP, applicationId: app.id, type: "vat", status: "expired", fileGid: "gid://shopify/GenericFile/old1" } });
    await applyRenewalUpload(SHOP, cert.id, "gid://shopify/GenericFile/new1", null);
    expect(await db.applicationFile.count({ where: { shop: SHOP, applicationId: app.id, fileGid: "gid://shopify/GenericFile/old1" } })).toBe(1);
  });

  it("m18: an impossible expiry date is refused, not silently cleared", async () => {
    const cert = await db.certificate.create({ data: { shop: SHOP, type: "vat", status: "valid", expiresOn: new Date("2027-01-01T00:00:00Z") } });
    expect(await setCertificateExpiry(SHOP, cert.id, "staff", "2027-02-31")).toBe(false);
    expect((await db.certificate.findUniqueOrThrow({ where: { id: cert.id } })).expiresOn?.toISOString().slice(0, 10)).toBe("2027-01-01");
  });

  it("M6: when Shopify can't be reached, the status change (and its Flow trigger) waits for the next run", async () => {
    const buyer = await db.buyer.create({ data: { shop: SHOP, companyGid: `gid://shopify/Company/9${Date.now()}`, locationGids: [], name: "B" } });
    const now = new Date("2026-10-16T09:00:00Z");
    const a = await db.certificate.create({ data: { shop: SHOP, buyerId: buyer.id, type: "resale", country: "US", region: "TX", expiresOn: new Date("2026-11-01T00:00:00Z"), status: "valid" } });
    await runCertificateDay(SHOP, { adminFor: async () => { throw new Error("no session"); }, now });
    expect((await db.certificate.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("valid");
    expect(await db.activityLog.count({ where: { shop: SHOP, action: "certificate.daily", subject: a.id, result: "failed" } })).toBe(1);
    const calls: string[] = [];
    const admin = { graphql: async (q: string) => { calls.push(q); return new Response(JSON.stringify({ data: { flowTriggerReceive: { userErrors: [] } } })); } } as unknown as Admin;
    await runCertificateDay(SHOP, { adminFor: async () => admin, now });
    expect((await db.certificate.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("expiring");
    expect(calls.filter((q) => q.includes("flowTriggerReceive"))).toHaveLength(1);
  });
});
