/* eslint-disable @typescript-eslint/no-explicit-any -- fake GraphQL payloads */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const approval = vi.hoisted(() => ({
  approvalDefaults: vi.fn(),
  approveApplication: vi.fn(),
}));
vi.mock("../app/lib/approval.server", async (orig) => ({ ...(await orig<typeof import("../app/lib/approval.server")>()), ...approval }));

import db from "../app/db.server";
import {
  buildFlowPayload, emitFlowTrigger, handleFlowApprove, MAX_PAYLOAD_BYTES, payloadBytes, TRIGGER_FIELDS, TRIGGER_HANDLES, verifyFlowHmac,
  ACTION_FIELDS, ACTION_HANDLE, type FlowTrigger,
} from "../app/lib/flow.server";

const shop = `test-automation-flow-${Math.random().toString(36).slice(2, 8)}.myshopify.com`;
const full = {
  applicationId: "app_1", buyerId: "buy_1", companyGid: "gid://shopify/Company/42", companyName: "Acme",
  contactEmail: "a@example.com", country: "US", tierName: "Retailer", expiryDate: "2026-12-31",
};

/** Read [[settings.fields]] of a flow extension TOML: reference types as payload keys, else `key`. */
function tomlFields(path: string): string[] {
  const src = readFileSync(path, "utf8");
  return src.split("[[settings.fields]]").slice(1).map((block) => {
    const type = /type = "([^"]+)"/.exec(block)![1];
    if (type === "company_reference") return "company_id";
    return /key = "([^"]+)"/.exec(block)![1];
  });
}

describe("Flow triggers", () => {
  it("each trigger extension declares exactly the fields the payload builder sends", () => {
    for (const [trigger, handle] of Object.entries(TRIGGER_HANDLES)) {
      const path = `extensions/${handle}/shopify.extension.toml`;
      expect(readFileSync(path, "utf8")).toContain(`handle = "${handle}"`);
      expect(tomlFields(path)).toEqual(TRIGGER_FIELDS[trigger as FlowTrigger]);
    }
  });

  it("field keys follow Flow's rule (letters and spaces only)", () => {
    for (const keys of Object.values(TRIGGER_FIELDS)) {
      for (const k of keys) if (k !== "company_id") expect(k).toMatch(/^[A-Za-z ]+$/);
    }
  });

  it("builds payloads with every declared field and a numeric company reference", () => {
    const p = buildFlowPayload("application_approved", full)!;
    expect(p).toEqual({
      company_id: 42, "Application ID": "app_1", "Buyer ID": "buy_1", "Company name": "Acme",
      "Contact email": "a@example.com", Country: "US", Tier: "Retailer",
    });
    expect(buildFlowPayload("application_submitted", { applicationId: "x" })).toEqual({
      "Application ID": "x", "Company name": "", "Contact email": "", Country: "",
    });
    expect(buildFlowPayload("certificate_expired", { ...full, companyGid: undefined })).toBeNull();
  });

  it("keeps payloads under 50 KB even with huge values", () => {
    const huge = "x".repeat(200_000);
    const p = buildFlowPayload("certificate_expiring", { ...full, companyName: huge, contactEmail: huge, tierName: huge })!;
    expect(p).not.toBeNull();
    expect(payloadBytes(p)).toBeLessThan(MAX_PAYLOAD_BYTES);
    expect(payloadBytes(buildFlowPayload("application_approved", full))).toBeLessThan(1000);
  });
});

function fakeAdmin(fail = false) {
  const calls: any[] = [];
  return {
    calls,
    admin: {
      graphql: async (_q: string, opts?: { variables?: any }) => {
        calls.push(opts?.variables);
        if (fail) return new Response(JSON.stringify({ errors: [{ message: "boom" }] }));
        return new Response(JSON.stringify({ data: { flowTriggerReceive: { userErrors: [] } } }));
      },
    } as any,
  };
}

beforeAll(async () => {
  await db.shop.create({ data: { shop, billingPlan: "pro" } });
});
afterAll(async () => {
  await db.activityLog.deleteMany({ where: { shop } });
  await db.application.deleteMany({ where: { shop } });
  await db.tier.deleteMany({ where: { shop } });
  await db.shopLock.deleteMany({ where: { shop } });
  await db.shop.deleteMany({ where: { shop } });
});

describe("emitFlowTrigger", () => {
  it("sends the trigger on Pro", async () => {
    const f = fakeAdmin();
    await emitFlowTrigger(f.admin, shop, "application_submitted", full);
    expect(f.calls[0]).toEqual({ handle: "tradepass-flow-application-submitted", payload: buildFlowPayload("application_submitted", full) });
  });

  it("does nothing below Pro", async () => {
    await db.shop.update({ where: { shop }, data: { billingPlan: "starter" } });
    const f = fakeAdmin();
    await emitFlowTrigger(f.admin, shop, "application_submitted", full);
    expect(f.calls).toHaveLength(0);
    await db.shop.update({ where: { shop }, data: { billingPlan: "pro" } });
  });

  it("never throws and logs the failure without personal data", async () => {
    const f = fakeAdmin(true);
    await expect(emitFlowTrigger(f.admin, shop, "application_rejected", full)).resolves.toBeUndefined();
    const log = await db.activityLog.findFirst({ where: { shop, action: "flow.application_rejected" } });
    expect(log?.result).toBe("failed");
    expect(JSON.stringify(log)).not.toContain("a@example.com");
    expect(JSON.stringify(log)).not.toContain("Acme");
  });
});

describe("Flow action", () => {
  const secret = "flow-secret";
  const sign = (body: string) => createHmac("sha256", secret).update(body, "utf8").digest("base64");

  it("verifies the HMAC of the raw body", () => {
    const body = JSON.stringify({ handle: ACTION_HANDLE, properties: {} });
    expect(verifyFlowHmac(body, sign(body), secret)).toBe(true);
    expect(verifyFlowHmac(`${body} `, sign(body), secret)).toBe(false);
    expect(verifyFlowHmac(body, sign(body), "other")).toBe(false);
    expect(verifyFlowHmac(body, null, secret)).toBe(false);
    expect(verifyFlowHmac(body, sign(body), undefined)).toBe(false);
  });

  let appId = "";
  let tierId = "";
  beforeEach(async () => {
    approval.approvalDefaults.mockReset();
    approval.approveApplication.mockReset();
    await db.application.deleteMany({ where: { shop } });
    await db.tier.deleteMany({ where: { shop } });
    tierId = (await db.tier.create({ data: { shop, name: "Retailer" } })).id;
    appId = (await db.application.create({ data: { shop, idempotencyKey: "k1", companyName: "Acme", email: "a@example.com", answers: {} } })).id;
    approval.approvalDefaults.mockResolvedValue({ input: { tierId: "", sendWelcome: true } });
    approval.approveApplication.mockResolvedValue({ steps: { company: { status: "done" }, location: { status: "done" }, contact: { status: "done" }, terms_tax: { status: "done" }, tier: { status: "done" }, email: { status: "done" } } });
  });
  const req = (props: Record<string, unknown>) => ({ handle: ACTION_HANDLE, shopify_domain: shop, action_run_id: "r1", properties: props });

  it("approves the application to the named tier", async () => {
    const res = await handleFlowApprove({} as any, shop, req({ [ACTION_FIELDS.applicationId]: appId, [ACTION_FIELDS.tier]: "retailer", [ACTION_FIELDS.sendWelcome]: false }));
    expect(res.status).toBe(200);
    expect(approval.approveApplication).toHaveBeenCalledWith(expect.objectContaining({ shop, actor: "flow" }), appId, expect.objectContaining({ tierId, sendWelcome: false }));
  });

  it("answers with a readable 4xx for permanent problems", async () => {
    expect((await handleFlowApprove({} as any, shop, req({ [ACTION_FIELDS.applicationId]: "nope" }))).status).toBe(404);
    const unknownTier = await handleFlowApprove({} as any, shop, req({ [ACTION_FIELDS.applicationId]: appId, [ACTION_FIELDS.tier]: "Gold" }));
    expect(unknownTier.status).toBe(422);
    expect(unknownTier.body.message).toContain("Gold");
    // No tier named and no suggested tier.
    expect((await handleFlowApprove({} as any, shop, req({ [ACTION_FIELDS.applicationId]: appId }))).status).toBe(422);
  });

  it("is idempotent: an already approved application returns 200 without running again", async () => {
    await db.application.update({ where: { id: appId }, data: { status: "approved" } });
    const res = await handleFlowApprove({} as any, shop, req({ [ACTION_FIELDS.applicationId]: appId }));
    expect(res.status).toBe(200);
    expect(approval.approveApplication).not.toHaveBeenCalled();
  });

  it("reports a failed step as 422 and a crash as 500 (Flow retries 5xx)", async () => {
    approval.approveApplication.mockResolvedValueOnce({ steps: { company: { status: "done" }, location: { status: "failed" } } });
    expect((await handleFlowApprove({} as any, shop, req({ [ACTION_FIELDS.applicationId]: appId, [ACTION_FIELDS.tier]: "Retailer" }))).status).toBe(422);
    approval.approveApplication.mockRejectedValueOnce(new Error("network"));
    expect((await handleFlowApprove({} as any, shop, req({ [ACTION_FIELDS.applicationId]: appId, [ACTION_FIELDS.tier]: "Retailer" }))).status).toBe(500);
  });

  it("refuses below Pro", async () => {
    await db.shop.update({ where: { shop }, data: { billingPlan: "starter" } });
    expect((await handleFlowApprove({} as any, shop, req({ [ACTION_FIELDS.applicationId]: appId }))).status).toBe(403);
    await db.shop.update({ where: { shop }, data: { billingPlan: "pro" } });
  });
});
