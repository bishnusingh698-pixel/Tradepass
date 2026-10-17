import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import db from "../app/db.server";
import { defaultSettings } from "../app/lib/settings";
import { timing } from "../app/lib/tiers.server";
import {
  approvalDefaults, approveApplication, approveMany, ApprovalError, createBuyerFromInput, retryApproval, undoApproval, type ApproveInput,
} from "../app/lib/approval.server";
import { fakeShopify } from "./tiers-fake";

const rnd = randomBytes(4).toString("hex");
const SHOP = `test-approval-${rnd}.myshopify.com`;
const FREE = `test-approval-free-${rnd}.myshopify.com`;
const EU = `test-approval-eu-${rnd}.myshopify.com`;
const shops = [SHOP, FREE, EU];

timing.sleep = async () => undefined;
delete process.env.BREVO_API_KEY;

let fake: ReturnType<typeof fakeShopify>;
let tierId: string;
let marketGid: string;

beforeAll(async () => {
  await db.shop.create({ data: { shop: SHOP, settings: defaultSettings() as object, billingPlan: "pro", country: "US", name: "Test" } });
  await db.shop.create({ data: { shop: FREE, settings: defaultSettings() as object, billingPlan: "free", country: "US" } });
  await db.shop.create({ data: { shop: EU, settings: defaultSettings() as object, billingPlan: "pro", country: "FR" } });
});

beforeEach(async () => {
  fake = fakeShopify();
  marketGid = fake.addMarket(["gid://shopify/CompanyLocation/999"]);
  const t = await db.tier.create({
    data: { shop: SHOP, name: `Retailer-${randomBytes(2).toString("hex")}`, marketGid, defaults: { tax: "exempt_on_file", paymentTermsTemplateId: "gid://shopify/PaymentTermsTemplate/4" } },
  });
  tierId = t.id;
});

afterAll(async () => {
  for (const shop of shops) {
    for (const table of ["certificate", "buyer", "application", "job", "tier", "activityLog", "emailLog", "shopLock"] as const) {
      await (db[table] as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { shop } });
    }
    await db.shop.deleteMany({ where: { shop } });
  }
});

const newApp = (shop: string, over: Record<string, unknown> = {}) =>
  db.application.create({
    data: {
      shop, idempotencyKey: randomBytes(8).toString("hex"), companyName: "Acme Supplies", email: `buyer-${randomBytes(3).toString("hex")}@example.com`,
      countryCode: "US", locale: "en",
      answers: { firstName: "Ada", lastName: "Lovelace", billingAddress: { address1: "1 Main St", city: "Austin", zoneCode: "TX", zip: "78701", countryCode: "US" } },
      ...over,
    },
  });

const input = (over: Partial<ApproveInput> = {}): ApproveInput => ({
  tierId, paymentTermsTemplateId: "gid://shopify/PaymentTermsTemplate/4", taxExempt: true, exemptions: ["US_TX_RESELLER_EXEMPTION"],
  taxRegistrationId: null, companyName: "Acme Supplies", locationName: "Acme – Austin",
  billingAddress: { address1: "1 Main St", city: "Austin", zoneCode: "TX", zip: "78701", countryCode: "US" }, shippingAddress: null,
  contact: { mode: "new" }, sendWelcome: true, ...over,
});

const ctx = (shop = SHOP) => ({ admin: fake.admin, shop, actor: "test" });
const failTierOnce = () => {
  let n = 1;
  fake.hooks.TierMarketUpdate = () => (n-- > 0 ? { marketUpdate: { market: null, userErrors: [{ field: null, message: "Internal error", code: "INTERNAL" }] } } : undefined);
};

describe("approval step machine", () => {
  it("runs all steps, verifies each, creates the buyer and assigns the tier", async () => {
    const app = await newApp(SHOP);
    const state = await approveApplication(ctx(), app.id, input());
    expect(Object.values(state.steps).map((s) => s.status)).toEqual(["done", "done", "done", "done", "done", "done"]);
    const loc = state.steps.location.gid!;
    expect(fake.markets.get(marketGid)!.locs).toContain(loc);
    const l = fake.locations.get(loc)!;
    expect(l).toMatchObject({ terms: "gid://shopify/PaymentTermsTemplate/4", taxExempt: true, exemptions: ["US_TX_RESELLER_EXEMPTION"] });
    expect(l.roles).toContain(state.steps.contact.gid);
    const saved = await db.application.findUnique({ where: { id: app.id } });
    expect(saved?.status).toBe("approved");
    const buyer = await db.buyer.findFirst({ where: { shop: SHOP, id: saved!.buyerId! } });
    expect(buyer).toMatchObject({ tierId, source: "application", locationGids: [loc] });
    expect(fake.count("ApprovalWelcome")).toBe(1);
  });

  it("acceptance 9: failure at the tier step → Retry finishes without duplicates", async () => {
    const app = await newApp(SHOP);
    failTierOnce();
    const first = await approveApplication(ctx(), app.id, input());
    expect(first.steps.tier.status).toBe("failed");
    expect(first.steps.tier.error).toMatch(/Shopify didn't accept the change/);
    expect(first.steps.company.status).toBe("done");
    expect((await db.application.findUnique({ where: { id: app.id } }))?.status).toBe("pending");

    const second = await retryApproval(ctx(), app.id);
    expect(second.finishedAt).toBeDefined();
    expect(fake.count("ApprovalCompanyCreate")).toBe(1);
    expect(fake.count("ApprovalContactCreate")).toBe(1);
    expect(fake.companies.size).toBe(1);
    expect(await db.buyer.count({ where: { shop: SHOP, companyGid: second.steps.company.gid! } })).toBe(1);
  });

  it("Retry after a crash between create and save finds the company by externalId", async () => {
    const app = await newApp(SHOP);
    failTierOnce();
    await approveApplication(ctx(), app.id, input());
    // Lose every stored GID, as if the process died before saving.
    await db.application.update({ where: { id: app.id }, data: { approvalState: { input: input(), steps: { company: { status: "running" }, location: { status: "pending" }, contact: { status: "pending" }, terms_tax: { status: "pending" }, tier: { status: "pending" }, email: { status: "pending" } }, startedAt: new Date().toISOString() } } });
    const st = await retryApproval(ctx(), app.id);
    expect(st.finishedAt).toBeDefined();
    expect(fake.count("ApprovalCompanyCreate")).toBe(1);
    expect(fake.count("ApprovalContactCreate")).toBe(1);
  });

  it("Undo removes only what this approval created and never deletes customers", async () => {
    const existing = fake.addCustomer("owner@shop.example", "Existing Owner");
    const app = await newApp(SHOP, { email: "owner@shop.example" });
    failTierOnce();
    const st = await approveApplication(ctx(), app.id, input({ contact: { mode: "existing", customerGid: existing } }));
    expect(st.steps.tier.status).toBe("failed");
    expect(fake.count("ApprovalAssignCustomer")).toBe(1);
    await undoApproval(ctx(), app.id);
    expect(fake.calls.filter((c) => c.op === "ApprovalCompanyDelete").map((c) => c.variables.id)).toEqual([st.steps.company.gid]);
    expect(fake.calls.some((c) => /customerDelete/i.test(c.op))).toBe(false);
    expect(fake.customers.has(existing)).toBe(true);
    expect((await db.application.findUnique({ where: { id: app.id } }))?.approvalState).toBeNull();
  });

  it("createBuyerFromInput on an existing company adds a location and contact, never a new company", async () => {
    // Pre-existing company (e.g. tag conversion), then a failed run.
    const pre = fake.admin;
    const res = await pre.graphql(`mutation ApprovalCompanyCreate($input: CompanyCreateInput!) { x }`, { variables: { input: { company: { name: "Old Co" } } } });
    const companyGid = ((await res.json()) as { data: { companyCreate: { company: { id: string } } } }).data.companyCreate.company.id;
    const out = await createBuyerFromInput(ctx(), { ...input(), contact: { mode: "new", email: "new@old.example" }, source: "tag", existingCompanyGid: companyGid });
    expect(out.state.steps.company.created).toBe(false);
    expect(fake.companies.get(companyGid)!.locations).toHaveLength(1);
    expect(fake.count("ApprovalCompanyCreate")).toBe(1); // only our setup call
  });

  it("links the existing customer when the email is already taken", async () => {
    fake.addCustomer("taken@example.com");
    const app = await newApp(SHOP, { email: "taken@example.com" });
    const st = await approveApplication(ctx(), app.id, input());
    expect(st.steps.contact.status).toBe("done");
    expect(fake.count("ApprovalAssignCustomer")).toBe(1);
  });
});

describe("plan limit (acceptance 20)", () => {
  it("blocks the 11th approval this month on the Free plan", async () => {
    for (let i = 0; i < 10; i++) await newApp(FREE, { status: "approved", decidedAt: new Date() });
    const t = await db.tier.create({ data: { shop: FREE, name: "Only", marketGid } });
    const app = await newApp(FREE);
    await expect(approveApplication(ctx(FREE), app.id, input({ tierId: t.id }))).rejects.toMatchObject({ code: "plan_limit" });
    await expect(approveApplication(ctx(FREE), app.id, input({ tierId: t.id }))).rejects.toBeInstanceOf(ApprovalError);
    const summary = await approveMany(ctx(FREE), [app.id], t.id);
    expect(summary.approved).toEqual([]);
    expect(summary.skipped[0].reason).toMatch(/Free plan limit/);
    expect(fake.count("ApprovalCompanyCreate")).toBe(0);
  });
});

describe("approve modal defaults (exemption suggestions)", () => {
  it("Texas resale certificate → US_TX_RESELLER_EXEMPTION, exempt because the tier exempts on file", async () => {
    const app = await newApp(SHOP, { suggestedTierId: tierId });
    await db.certificate.create({ data: { shop: SHOP, applicationId: app.id, type: "resale", country: "US", region: "TX", status: "pending" } });
    const d = await approvalDefaults(ctx(), app.id);
    expect(d.suggestedExemption.exemption).toBe("US_TX_RESELLER_EXEMPTION");
    expect(d.input).toMatchObject({ tierId, taxExempt: true, exemptions: ["US_TX_RESELLER_EXEMPTION"], paymentTermsTemplateId: "gid://shopify/PaymentTermsTemplate/4" });
    expect(d.allExemptions).toHaveLength(74);
    expect(d.paymentTermsOptions[0].name).toBe("Net 30");
  });

  it("verified German VAT for a French store → EU reverse charge; existing customer is offered", async () => {
    fake.addCustomer("einkauf@beispiel.de", "Greta Beispiel");
    const t = await db.tier.create({ data: { shop: EU, name: "Händler", marketGid, defaults: { tax: "exempt_on_file" } } });
    const app = await newApp(EU, {
      email: "einkauf@beispiel.de", countryCode: "DE", taxCheck: "verified", suggestedTierId: t.id,
      answers: { firstName: "Greta", billingAddress: { address1: "Hauptstr. 1", city: "Berlin", zip: "10115", countryCode: "DE" } },
    });
    const d = await approvalDefaults(ctx(EU), app.id);
    expect(d.suggestedExemption).toEqual({ exemption: "EU_REVERSE_CHARGE_EXEMPTION_RULE", reason: "eu_reverse_charge" });
    expect(d.existingCustomer?.name).toBe("Greta Beispiel");
    expect(d.input.contact.mode).toBe("existing");
  });
});
