/* eslint-disable @typescript-eslint/no-explicit-any -- fake contracts */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  approvalDefaults: vi.fn(),
  approveApplication: vi.fn(),
  undoApproval: vi.fn(),
  rejectApplication: vi.fn(),
  pauseBuyers: vi.fn(),
}));
vi.mock("../app/lib/approval.server", async (orig) => ({
  ...(await orig<typeof import("../app/lib/approval.server")>()),
  approvalDefaults: m.approvalDefaults, approveApplication: m.approveApplication, undoApproval: m.undoApproval,
}));
vi.mock("../app/lib/applications.server", () => ({ rejectApplication: m.rejectApplication }));
vi.mock("../app/lib/buyers.server", () => ({ pauseBuyers: m.pauseBuyers }));

import db from "../app/db.server";
import { evaluateRules, reverseAutoDecision, saveRules, listRules } from "../app/lib/rules.server";
import { matchCondition, matchRule, pickRule, validateRules, type ApplicationFacts, type RuleDef } from "../app/lib/rules";
import { updateSettings } from "../app/lib/settings.server";

const facts = (over: Partial<ApplicationFacts> = {}): ApplicationFacts => ({
  country: "US", businessType: "salon", emailDomain: "acme.com", taxVerified: true, hasCertificate: false, flags: [], answers: { custom_1: "Yes", custom_2: ["a", "B"] }, ...over,
});
const approveRule = (list: RuleDef["conditions"]["list"], extra: Partial<RuleDef> = {}): RuleDef => ({
  kind: "approve", enabled: true, position: 0, conditions: { match: "all", list }, action: { tierId: "t1", paymentTermsTemplateId: null, sendWelcome: true }, ...extra,
});

describe("rule matching", () => {
  it("evaluates every condition type", () => {
    const f = facts();
    expect(matchCondition({ type: "country", op: "is", values: ["us", "CA"] }, f)).toBe(true);
    expect(matchCondition({ type: "country", op: "is_not", values: ["US"] }, f)).toBe(false);
    expect(matchCondition({ type: "country", op: "is_not", values: ["DE"] }, facts({ country: null }))).toBe(true);
    expect(matchCondition({ type: "business_type", op: "is", values: ["Salon"] }, f)).toBe(true);
    expect(matchCondition({ type: "email_domain", op: "is", values: ["@ACME.com"] }, f)).toBe(true);
    expect(matchCondition({ type: "tax_verified" }, f)).toBe(true);
    expect(matchCondition({ type: "certificate_uploaded" }, f)).toBe(false);
    expect(matchCondition({ type: "custom_field", field: "custom_1", value: " yes " }, f)).toBe(true);
    expect(matchCondition({ type: "custom_field", field: "custom_2", value: "b" }, f)).toBe(true);
    expect(matchCondition({ type: "custom_field", field: "missing", value: "" }, f)).toBe(false);
    expect(matchCondition({ type: "spam" }, facts({ flags: ["possible_spam"] }))).toBe(true);
  });

  it("supports all/any, ignores disabled and empty rules", () => {
    const list: RuleDef["conditions"]["list"] = [{ type: "country", op: "is", values: ["US"] }, { type: "certificate_uploaded" }];
    expect(matchRule(approveRule(list), facts())).toBe(false);
    expect(matchRule(approveRule(list, { conditions: { match: "any", list } }), facts())).toBe(true);
    expect(matchRule(approveRule(list, { enabled: false, conditions: { match: "any", list } }), facts())).toBe(false);
    expect(matchRule(approveRule([]), facts())).toBe(false);
  });

  it("runs reject rules before approve rules, then by position", () => {
    const a1 = approveRule([{ type: "country", op: "is", values: ["US"] }], { position: 0 });
    const r1: RuleDef = { kind: "reject", enabled: true, position: 5, conditions: { match: "all", list: [{ type: "email_domain", op: "is", values: ["acme.com"] }] }, action: { reason: null, email: false } };
    expect(pickRule([a1, r1], facts())).toBe(r1);
    expect(pickRule([a1, r1], facts({ emailDomain: "other.com" }))).toBe(a1);
    expect(pickRule([a1, r1], facts({ country: "DE", emailDomain: "x.com" }))).toBeNull();
  });

  it("validates rules for the editor", () => {
    const bad = [approveRule([], { action: { tierId: "zzz", paymentTermsTemplateId: null, sendWelcome: false } }), approveRule([{ type: "country", op: "is", values: [" "] }])];
    expect(validateRules(bad, ["t1"]).map((p) => [p.index, p.code])).toEqual([[0, "conditions_required"], [0, "tier_required"], [1, "values_required"]]);
  });
});

const shop = `test-automation-rules-${Math.random().toString(36).slice(2, 8)}.myshopify.com`;
const admin = {} as any;
let tierId = "";
const done = { company: { status: "done" }, location: { status: "done" }, contact: { status: "done" }, terms_tax: { status: "done" }, tier: { status: "done" }, email: { status: "done" } };

async function newApp(over: Record<string, unknown> = {}) {
  return db.application.create({
    data: { shop, idempotencyKey: Math.random().toString(36), companyName: "Acme", email: "buyer@acme.com", countryCode: "US", businessType: "salon", answers: {}, ...over },
  });
}

beforeAll(async () => {
  await db.shop.create({ data: { shop, billingPlan: "pro" } });
  tierId = (await db.tier.create({ data: { shop, name: "Retailer" } })).id;
});
afterAll(async () => {
  for (const t of ["activityLog", "application", "rule", "tier", "shop"] as const) await (db[t] as any).deleteMany({ where: { shop } });
});
beforeEach(async () => {
  for (const f of Object.values(m)) f.mockReset();
  m.approvalDefaults.mockResolvedValue({ input: { tierId: "", paymentTermsTemplateId: "gid://shopify/PaymentTermsTemplate/1", sendWelcome: false } });
  m.approveApplication.mockImplementation(async (_ctx: any, id: string) => {
    await db.application.update({ where: { id }, data: { status: "approved", decidedAt: new Date() } });
    return { steps: done };
  });
  m.rejectApplication.mockImplementation(async (_ctx: any, id: string) => {
    await db.application.update({ where: { id }, data: { status: "rejected", decidedAt: new Date() } });
    return true;
  });
  m.pauseBuyers.mockResolvedValue({ moved: ["b1"], pending: [], failed: [] });
  await db.application.deleteMany({ where: { shop } });
  await updateSettings(shop, { automation: { paused: false, dailyLimit: 25 } });
  await saveRules(shop, "test", [
    { kind: "reject", enabled: true, position: 0, conditions: { match: "any", list: [{ type: "spam" }, { type: "email_domain", op: "is", values: ["spam.test"] }] }, action: { reason: null, email: false } },
    approveRule([{ type: "country", op: "is", values: ["US"] }, { type: "business_type", op: "is", values: ["salon"] }], { action: { tierId, paymentTermsTemplateId: null, sendWelcome: true } }),
  ]);
});

describe("evaluateRules", () => {
  it("auto-approves a matching applicant to the rule's tier, logged and marked", async () => {
    const app = await newApp();
    const out = await evaluateRules(admin, shop, app.id);
    expect(out.decided).toBe("approved");
    expect(m.approveApplication).toHaveBeenCalledWith(expect.objectContaining({ actor: "automation" }), app.id, expect.objectContaining({ tierId, sendWelcome: true, paymentTermsTemplateId: "gid://shopify/PaymentTermsTemplate/1" }));
    expect((await db.application.findUnique({ where: { id: app.id } }))!.autoRuleId).toBe(out.ruleId);
    expect(await db.activityLog.count({ where: { shop, action: "automation.approve", subject: app.id, result: "ok" } })).toBe(1);
  });

  it("auto-rejects spam before any approval rule", async () => {
    const app = await newApp({ email: "x@spam.test" });
    expect((await evaluateRules(admin, shop, app.id)).decided).toBe("rejected");
    expect(m.approveApplication).not.toHaveBeenCalled();
  });

  it("leaves non-matching applications for review", async () => {
    const app = await newApp({ countryCode: "DE" });
    expect(await evaluateRules(admin, shop, app.id)).toEqual({ decided: null });
  });

  it("Pause all automation stops everything", async () => {
    await updateSettings(shop, { automation: { paused: true } });
    const app = await newApp({ email: "x@spam.test" });
    expect(await evaluateRules(admin, shop, app.id)).toEqual({ decided: null });
    expect(m.rejectApplication).not.toHaveBeenCalled();
  });

  it("respects the daily auto-approval limit", async () => {
    await updateSettings(shop, { automation: { dailyLimit: 1 } });
    const a = await newApp();
    const b = await newApp({ idempotencyKey: "second" });
    expect((await evaluateRules(admin, shop, a.id)).decided).toBe("approved");
    expect((await evaluateRules(admin, shop, b.id)).decided).toBeNull();
    expect(await db.activityLog.count({ where: { shop, action: "automation.limit_reached", subject: b.id } })).toBe(1);
  });

  it("is Pro only", async () => {
    await db.shop.update({ where: { shop }, data: { billingPlan: "starter" } });
    const app = await newApp();
    expect(await evaluateRules(admin, shop, app.id)).toEqual({ decided: null });
    await db.shop.update({ where: { shop }, data: { billingPlan: "pro" } });
  });

  it("never throws", async () => {
    m.approvalDefaults.mockRejectedValueOnce(new Error("boom"));
    const app = await newApp();
    await expect(evaluateRules(admin, shop, app.id)).resolves.toEqual({ decided: null });
  });
});

describe("reverseAutoDecision", () => {
  const ctx = { admin, shop, actor: "Staff" };

  it("reopens an auto-rejection", async () => {
    const app = await newApp({ email: "x@spam.test" });
    await evaluateRules(admin, shop, app.id);
    expect(await reverseAutoDecision(ctx, app.id)).toBe("reopened");
    const after = await db.application.findUnique({ where: { id: app.id } });
    expect(after).toMatchObject({ status: "pending", autoRuleId: null, decidedAt: null });
  });

  it("pauses the buyer of a finished auto-approval", async () => {
    const app = await newApp();
    await evaluateRules(admin, shop, app.id);
    await db.application.update({ where: { id: app.id }, data: { buyerId: "b1" } });
    expect(await reverseAutoDecision(ctx, app.id)).toBe("paused");
    expect(m.pauseBuyers).toHaveBeenCalledWith(ctx, ["b1"]);
    expect(await db.activityLog.count({ where: { shop, action: "automation.reverse", subject: app.id } })).toBe(1);
  });

  it("undoes a partial auto-approval", async () => {
    m.approveApplication.mockResolvedValueOnce({ steps: { ...done, tier: { status: "failed" } } });
    const app = await newApp();
    expect((await evaluateRules(admin, shop, app.id)).decided).toBeNull();
    await db.application.update({ where: { id: app.id }, data: { approvalState: { steps: {} } } });
    expect(await reverseAutoDecision(ctx, app.id)).toBe("undone");
    expect(m.undoApproval).toHaveBeenCalledWith(ctx, app.id);
  });

  it("ignores manual decisions", async () => {
    const app = await newApp({ status: "approved" });
    expect(await reverseAutoDecision(ctx, app.id)).toBeNull();
  });
});

describe("rule storage", () => {
  it("replaces rules, keeping ids and positions per kind", async () => {
    const before = await listRules(shop);
    expect(before.map((r) => r.kind)).toEqual(["approve", "reject"]);
    await saveRules(shop, "test", [before[0], { ...before[0], id: undefined }]);
    const after = await listRules(shop);
    expect(after).toHaveLength(2);
    expect(after[0].id).toBe(before[0].id);
    expect(after.map((r) => r.position)).toEqual([0, 1]);
  });
});
