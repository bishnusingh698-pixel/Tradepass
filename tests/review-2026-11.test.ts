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

describe("C9 a state resale exemption must not exempt the location from all taxes", () => {
  it("sets only the chosen exemptions; the blanket flag needs the merchant's explicit choice", async () => {
    const { fake, tier, app, ctx } = await setup();
    const state = await approveApplication(ctx, app.id, input(tier.id, { taxExempt: true, exemptions: ["US_TX_RESELLER_EXEMPTION"], sendWelcome: false }));
    expect(fake.locations.get(state.steps.location.gid!)).toMatchObject({ taxExempt: false, exemptions: ["US_TX_RESELLER_EXEMPTION"] });

    const two = await setup();
    const s2 = await approveApplication(two.ctx, two.app.id, input(two.tier.id, { taxExempt: false, exemptions: [], taxExemptAll: true, sendWelcome: false }));
    expect(two.fake.locations.get(s2.steps.location.gid!)).toMatchObject({ taxExempt: true, exemptions: [] });
  });

  it("the posted input keeps taxExemptAll only when explicitly true", async () => {
    const { normalizeApproveInput } = await import("../app/lib/approval.server");
    const base = { companyName: "A", tierId: "t", billingAddress: { address1: "1", city: "c", countryCode: "US" }, contact: { mode: "new" } };
    expect(normalizeApproveInput(base)!.taxExemptAll).toBe(false);
    expect(normalizeApproveInput({ ...base, taxExemptAll: "true" })!.taxExemptAll).toBe(false);
    expect(normalizeApproveInput({ ...base, taxExemptAll: true })!.taxExemptAll).toBe(true);
  });
});

describe("storefront form: privacy, phone uploads and contrast", async () => {
  const { runInNewContext } = await import("node:vm");
  const sandbox: Record<string, unknown> = { window: { TradepassFormNoBoot: true }, document: { readyState: "complete" } };
  (sandbox.window as Record<string, unknown>).window = sandbox.window;
  runInNewContext(readFileSync("extensions/tradepass-theme/assets/tradepass-form.js", "utf8"), sandbox);
  const T = ((sandbox.window as Record<string, unknown>).TradepassForm as { _test: Record<string, (...a: unknown[]) => unknown> })._test;

  it("m18 the browser draft never keeps documents or the tax number", () => {
    const fields = { certificates: { type: "file" }, taxNumber: { type: "country_tax" }, companyName: { type: "text" } };
    const out = T.sanitizeDraft({ companyName: "Acme", taxNumber: { country: "US", region: "TX", number: "12345678901" }, certificates: [{ ref: "signed", name: "c.pdf", status: "done" }] }, fields);
    expect(out).toEqual({ companyName: "Acme", taxNumber: { country: "US", region: "TX", number: "" } });
  });

  it("m19 accepts PDFs that a phone sends with an empty type, still refuses other files", () => {
    expect(T.fileTypeOk({ name: "cert.pdf", type: "" })).toBe(true);
    expect(T.fileTypeOk({ name: "cert.PDF", type: "application/octet-stream" })).toBe(true);
    expect(T.fileTypeOk({ name: "photo.jpg", type: "image/jpeg" })).toBe(true);
    expect(T.fileTypeOk({ name: "letter.docx", type: "" })).toBe(false);
    expect(T.fileTypeOk({ name: "x.exe", type: "application/octet-stream" })).toBe(false);
  });

  it("m20 detects dark theme backgrounds so error text keeps its contrast", () => {
    expect(T.darkColor("rgb(18, 18, 18)")).toBe(true);
    expect(T.darkColor("rgb(255, 255, 255)")).toBe(false);
    expect(T.darkColor("rgba(0, 0, 0, 0)")).toBeNull();
    expect(T.darkColor("")).toBeNull();
  });
});

describe("E23 offline check digits (and the tax-ID examples)", async () => {
  const { taxChecksum, CHECKSUM_COUNTRIES } = await import("../app/lib/tax-checksums.js");
  const { checkTaxIdFormat, normaliseTaxId, TAX_ID_RULES } = await import("../app/lib/tax-ids");
  // Real, publicly listed numbers (companies' own registrations or the authorities' published examples).
  const VALID: [string, string][] = [
    ["AU", "51824753556"], ["NO", "923609016"], ["CN", "91350100M000100Y43"], ["BR", "11222333000181"], ["IN", "27AAPFU0939F1ZV"],
    ["NZ", "49091850"], ["NZ", "136410132"], ["DE", "DE136695976"], ["RU", "7707083893"], ["FR", "FR40303265045"], ["GB", "GB980780684"],
    ["IT", "IT00743110157"], ["BE", "BE0403170701"], ["DK", "DK13585628"], ["FI", "FI20774740"], ["PL", "PL5260250274"], ["PT", "PT501964843"],
    ["SE", "SE556036079301"], ["CH", "CHE116281710"], ["JP", "5010001008846"], ["TW", "04595257"], ["KR", "1208147521"], ["HR", "69435151530"],
    ["EE", "EE100931558"], ["LU", "LU15027442"], ["SI", "SI50223054"], ["HU", "HU12892312"], ["GR", "EL094259216"], ["SK", "SK2020317068"],
    ["TR", "10000000146"], ["IL", "520000118"], ["PE", "20131312955"], ["TH", "0994000165510"], ["AR", "30500010912"],
  ];
  // Change the check digit itself (Sweden's sits before the fixed "01").
  const flip = (n: string) => {
    const i = /^SE\d{12}$/.test(n) ? n.length - 3 : n.length - 1;
    return n.slice(0, i) + (n[i] === "1" ? "2" : "1") + n.slice(i + 1);
  };

  it("accepts real numbers and refuses the same numbers with the last character changed", () => {
    for (const [c, n] of VALID) {
      expect(taxChecksum(c, n), `${c} ${n}`).toBe(true);
      expect(taxChecksum(c, flip(n)), `${c} ${flip(n)}`).toBe(false);
    }
    // Inland Revenue's own invalid example, and the GSTIN example the form used to show.
    expect(taxChecksum("NZ", "136410133")).toBe(false);
    expect(taxChecksum("IN", "22AAAAA0000A1Z5")).toBe(false);
  });

  it("covers every country with an algorithm, and knows nothing about the others", () => {
    for (const c of CHECKSUM_COUNTRIES) expect(VALID.some(([v]) => v === c) || c === "CL", c).toBe(true);
    expect(taxChecksum("US", "12-3456789")).toBeNull();
    expect(taxChecksum("XX", "123")).toBeNull();
  });

  it("every example in the tax-ID table passes its own pattern and check digit", () => {
    for (const [c, r] of Object.entries(TAX_ID_RULES)) {
      let n = normaliseTaxId(r.ex);
      if (r.p && !n.startsWith(r.p) && !/^[A-Z]{2}/.test(n)) n = r.p + n;
      expect(new RegExp(r.re).test(n), `${c} pattern ${r.ex}`).toBe(true);
      expect(taxChecksum(c, n), `${c} checksum ${r.ex}`).not.toBe(false);
      expect(checkTaxIdFormat(c, r.ex), c).toBe("ok");
    }
  });

  it("the server refuses a strict country's number with a wrong check digit", () => {
    expect(checkTaxIdFormat("DE", "DE136695976")).toBe("ok");
    expect(checkTaxIdFormat("DE", "DE136695977")).toBe("invalid");
    expect(checkTaxIdFormat("IN", "22AAAAA0000A1Z5")).toBe("invalid");
  });

  it("the storefront form runs the very same code", async () => {
    const { runInNewContext } = await import("node:vm");
    const sandbox: Record<string, unknown> = { window: { TradepassFormNoBoot: true }, document: { readyState: "complete" } };
    runInNewContext(readFileSync("extensions/tradepass-theme/assets/tradepass-form.js", "utf8"), sandbox);
    const ck = ((sandbox.window as Record<string, unknown>).TradepassForm as { _test: { checksum: (c: string, n: string) => boolean | null } })._test.checksum;
    for (const [c, n] of VALID) {
      expect(ck(c, n)).toBe(true);
      expect(ck(c, flip(n))).toBe(false);
    }
    const lib = readFileSync("app/lib/tax-checksums.js", "utf8");
    const code = lib.slice(lib.indexOf("/* checksums:start */"), lib.indexOf("/* checksums:end */")).replace(/\s+/g, "");
    expect(readFileSync("extensions/tradepass-theme/assets/tradepass-form.js", "utf8").replace(/\s+/g, "")).toContain(code);
  });
});

describe("N2–N4 re-checked", async () => {
  const { clientIp } = await import("../app/lib/spam.server");
  const { readCapped } = await import("../app/lib/uploads.server");
  const { reserveAutoApproval } = await import("../app/lib/rules.server");

  it("N2 with TRUSTED_PROXY_HOPS set, a client can't choose its own IP by prepending to X-Forwarded-For", () => {
    const req = new Request("https://x.test", { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.7, 23.227.38.1, 10.0.0.2" } });
    expect(clientIp(req, 0)).toBe("6.6.6.6"); // default: unchanged behaviour
    expect(clientIp(req, 2)).toBe("203.0.113.7");
    expect(clientIp(new Request("https://x.test", { headers: { "x-forwarded-for": "10.0.0.2" } }), 2)).toBe("10.0.0.2");
  });

  it("N4 stops reading an upload body (with or without Content-Length) once it passes the limit", async () => {
    const big = new ReadableStream({ start(c) { for (let i = 0; i < 20; i++) c.enqueue(new Uint8Array(1024)); c.close(); } });
    expect(await readCapped(new Request("https://x.test", { method: "POST", body: big, duplex: "half" } as RequestInit), 10_000)).toBeNull();
    const small = await readCapped(new Request("https://x.test", { method: "POST", body: "hello" }), 10_000);
    expect(new TextDecoder().decode(small!)).toBe("hello");
  });

  it("N3 two applications racing for the last auto-approval slot: exactly one gets it", async () => {
    const mk = () => db.application.create({ data: { shop: SHOP, idempotencyKey: randomBytes(8).toString("hex"), companyName: "Race", email: `r-${randomBytes(3).toString("hex")}@x.test`, answers: {} } });
    await db.application.updateMany({ where: { shop: SHOP }, data: { autoRuleId: null } });
    const [a, b] = await Promise.all([mk(), mk()]);
    const res = await Promise.all([reserveAutoApproval(SHOP, a.id, "rule-x", 1), reserveAutoApproval(SHOP, b.id, "rule-x", 1)]);
    expect(res.filter(Boolean)).toHaveLength(1);
    // A reject decision (status rejected) doesn't use a slot.
    await db.application.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { status: "rejected" } });
    const c = await mk();
    expect(await reserveAutoApproval(SHOP, c.id, "rule-x", 1)).toBe(true);
  });
});
