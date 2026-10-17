import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import db from "../app/db.server";
import { applyUpdate, cleanAnswers, handleSubmit, requestedDefinition, type IntakeDeps } from "../app/lib/intake.server";
import { defaultFormDefinition, type FormDefinition } from "../app/lib/form-defaults";
import { defaultSettings } from "../app/lib/settings";
import { decrypt, sha256 } from "../app/lib/crypto.server";
import { signFileRef } from "../app/lib/uploads.server";
import { normaliseTaxNumber } from "../app/lib/applications.server";

process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.LINK_TOKEN_SECRET ||= "test-link-secret";

const rnd = randomBytes(4).toString("hex");
const SHOP = `test-storefront-${rnd}.myshopify.com`;
const OTHER = `test-storefront-o-${rnd}.myshopify.com`;
let formId = "";

function definition(): FormDefinition {
  const def = defaultFormDefinition();
  for (const s of def.sections) for (const f of s.fields) if (f.id === "certificates") f.state = "optional";
  def.spamQuestion = { enabled: false, texts: {} };
  return def;
}

function deps(over: Partial<IntakeDeps> = {}) {
  const d = {
    getAdmin: vi.fn(async () => ({ graphql: vi.fn() }) as never),
    checkTaxNumber: vi.fn(async () => ({ status: "verified" as const, name: "ACME GMBH", registry: "vies" })),
    queueEmail: vi.fn(async () => ({ queued: true })),
    notifyMerchant: vi.fn(async () => ({ queued: true })),
    emitFlowTrigger: vi.fn(async () => undefined),
    evaluateRules: vi.fn(async () => ({ decided: null })),
    recordApplicationCertificates: vi.fn(async () => undefined),
    ...over,
  };
  return d as typeof d & IntakeDeps;
}

let n = 0;
function body(over: Record<string, unknown> = {}, answers: Record<string, unknown> = {}) {
  n++;
  return {
    idempotencyKey: `key-${rnd}-${n}-${randomBytes(3).toString("hex")}`,
    formId,
    locale: "de",
    elapsedMs: 15_000,
    hp: "",
    answers: {
      companyName: `Acme ${n} ${rnd}`,
      businessType: "retail",
      firstName: "Jo",
      lastName: "Doe",
      email: `jo${n}-${rnd}@example.com`,
      billingAddress: { countryCode: "DE", address1: "Hauptstr. 1", city: "Berlin", zip: "10115" },
      consent: true,
      ...answers,
    },
    ...over,
  };
}

// IPs carry the run id so reruns within the same hour don't share rate-limit windows.
const ctx = (ip = `10.0.${n % 250}.${Math.floor(Math.random() * 250)}`) => ({ shop: SHOP, loggedInCustomerId: null, ip: `${ip}#${rnd}` });

beforeAll(async () => {
  // Starter: these tests cover live tax-number checks, which the Free plan doesn't include (tests/plan-gaps.test.ts).
  for (const shop of [SHOP, OTHER]) await db.shop.create({ data: { shop, name: "Test Store", settings: defaultSettings() as object, billingPlan: "starter" } });
  const f = await db.form.create({ data: { shop: SHOP, name: "Default", isDefault: true, definition: definition() as object } });
  formId = f.id;
});

afterAll(async () => {
  for (const shop of [SHOP, OTHER]) {
    await db.applicationFile.deleteMany({ where: { shop } });
    await db.application.deleteMany({ where: { shop } });
    await db.activityLog.deleteMany({ where: { shop } });
    await db.tokenUse.deleteMany({ where: { shop } });
    await db.form.deleteMany({ where: { shop } });
    await db.shop.deleteMany({ where: { shop } });
  }
  // RateHit rows are salted hashes of per-run IPs/emails; the hourly prune removes them.
});

describe("submit", () => {
  it("stores an application with encrypted tax number, hash, customer link and follow-ups", async () => {
    const d = deps();
    const b = body({}, { taxNumber: { country: "DE", number: "DE 123 456 789" } });
    const res = await handleSubmit({ shop: SHOP, loggedInCustomerId: "42", ip: `10.1.1.1#${rnd}` }, b, d);
    expect(res).toMatchObject({ http: 200, body: { ok: true, status: "received" } });
    const app = await db.application.findFirstOrThrow({ where: { shop: SHOP, idempotencyKey: b.idempotencyKey } });
    expect(app.email).toBe(b.answers.email);
    expect(app.countryCode).toBe("DE");
    expect(app.locale).toBe("de");
    expect(app.customerGid).toBe("gid://shopify/Customer/42");
    expect(app.taxCheck).toBe("verified");
    expect(app.taxCheckName).toBe("ACME GMBH");
    expect(decrypt(app.taxNumberEnc!)).toBe("DE 123 456 789");
    const answers = app.answers as Record<string, unknown>;
    expect(answers.taxNumberHash).toBe(sha256(normaliseTaxNumber("DE123456789")));
    expect(JSON.stringify(answers)).not.toContain("123 456 789");
    expect(d.queueEmail).toHaveBeenCalledWith(expect.objectContaining({ type: "received", to: b.answers.email, locale: "de" }));
    expect(d.notifyMerchant).toHaveBeenCalled();
    expect(d.emitFlowTrigger).toHaveBeenCalledWith(expect.anything(), SHOP, "application_submitted", expect.objectContaining({ applicationId: app.id }));
    expect(d.evaluateRules).toHaveBeenCalledWith(expect.anything(), SHOP, app.id);
  });

  it("is idempotent: the same key returns the same application and sends nothing twice", async () => {
    const d = deps();
    const b = body();
    const first = await handleSubmit(ctx(), b, d);
    const again = await handleSubmit(ctx(), b, d);
    const parallel = await Promise.all([handleSubmit(ctx(), b, d), handleSubmit(ctx(), b, d)]);
    expect(first.body).toMatchObject({ ok: true });
    for (const r of [again, ...parallel]) expect(r.body).toEqual(first.body);
    expect(await db.application.count({ where: { shop: SHOP, idempotencyKey: b.idempotencyKey } })).toBe(1);
    expect(d.queueEmail).toHaveBeenCalledTimes(1);
  });

  it("silently accepts and discards honeypot and too-fast submissions", async () => {
    const d = deps();
    const hp = body({ hp: "http://spam.example" });
    const fast = body({ elapsedMs: 400 });
    for (const b of [hp, fast]) {
      const r = await handleSubmit(ctx("10.9.9.9"), b, d);
      expect(r).toEqual({ http: 200, body: { ok: true, status: "received" } });
      expect(await db.application.count({ where: { shop: SHOP, idempotencyKey: b.idempotencyKey } })).toBe(0);
    }
    expect(d.queueEmail).not.toHaveBeenCalled();
  });

  it("discards everything from an IP after repeated spam", async () => {
    const d = deps();
    for (let i = 0; i < 6; i++) await handleSubmit(ctx("10.8.8.8"), body({ hp: "x" }), d);
    const human = body();
    expect((await handleSubmit(ctx("10.8.8.8"), human, d)).body).toEqual({ ok: true, status: "received" });
    expect(await db.application.count({ where: { shop: SHOP, idempotencyKey: human.idempotencyKey } })).toBe(0);
  });

  it("rate-limits per IP and per email", async () => {
    const d = deps();
    const results = [];
    for (let i = 0; i < 11; i++) results.push((await handleSubmit(ctx("10.7.7.7"), body(), d)).http);
    expect(results.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(results[10]).toBe(429);

    const email = `same-${rnd}@example.com`;
    const byEmail = [];
    for (let i = 0; i < 4; i++) byEmail.push((await handleSubmit(ctx(`10.6.${i}.1`), body({}, { email }), d)).http);
    expect(byEmail).toEqual([200, 200, 200, 429]);
  });

  it("flags duplicates by email, company name and tax number and tells the applicant", async () => {
    const d = deps();
    const first = body({}, { companyName: `Dup Co ${rnd}`, taxNumber: { country: "FR", number: "FR12345678901" } });
    await handleSubmit(ctx("10.5.0.1"), first, d);
    const byName = body({}, { companyName: `dup co ${rnd}` });
    const byTax = body({}, { taxNumber: { country: "FR", number: "fr 1234 5678 901" } });
    for (const b of [byName, byTax]) {
      const r = await handleSubmit(ctx(`10.5.${Math.floor(Math.random() * 200)}.2`), b, d);
      expect(r.body).toMatchObject({ ok: true, status: "duplicate" });
      const app = await db.application.findFirstOrThrow({ where: { shop: SHOP, idempotencyKey: b.idempotencyKey } });
      expect(app.flags).toContain("duplicate");
      // A retry of the duplicate still says "already applied".
      expect((await handleSubmit(ctx("10.5.3.3"), b, d)).body).toMatchObject({ status: "duplicate" });
    }
    // Only the first applicant got the "received" email.
    expect(d.queueEmail).toHaveBeenCalledTimes(1);
  });

  it("does not see another shop's applications as duplicates", async () => {
    await db.form.create({ data: { shop: OTHER, name: "Default", isDefault: true, definition: definition() as object } });
    const b = body({ formId: null }, { companyName: `Dup Co ${rnd}` });
    const r = await handleSubmit({ shop: OTHER, loggedInCustomerId: null, ip: `10.4.4.4#${rnd}` }, b, deps());
    expect(r.body).toMatchObject({ ok: true, status: "received" });
  });

  it("returns field errors as message keys and rejects bad keys", async () => {
    const r = await handleSubmit(ctx(), body({}, { email: "not-an-email", consent: false, businessType: "pirate" }), deps());
    expect(r).toMatchObject({ http: 400, body: { errors: { email: "form.error.email", consent: "form.error.consent", businessType: "form.error.choose" } } });
    expect((await handleSubmit(ctx(), { ...body(), idempotencyKey: "x" }, deps())).http).toBe(400);
  });

  it("never fails the submission when follow-ups or the tax lookup fail", async () => {
    const boom = async () => { throw new Error("down"); };
    const d = deps({ checkTaxNumber: boom, queueEmail: boom, notifyMerchant: boom, emitFlowTrigger: boom, evaluateRules: boom, getAdmin: async () => null });
    const b = body({}, { taxNumber: { country: "DE", number: "DE999999999" } });
    const r = await handleSubmit(ctx(), b, d);
    expect(r.body).toMatchObject({ ok: true, status: "received" });
    const app = await db.application.findFirstOrThrow({ where: { shop: SHOP, idempotencyKey: b.idempotencyKey } });
    expect(app.taxCheck).toBe("unavailable");
  });

  it("checks the optional spam question", async () => {
    const def = definition();
    def.spamQuestion = { enabled: true, texts: { en: { question: "What colour is the sky?", answer: "Blue" } } };
    const f = await db.form.create({ data: { shop: SHOP, name: "Spammy", definition: def as object } });
    expect((await handleSubmit(ctx(), body({ formId: f.id, spam: "green" }), deps())).body).toMatchObject({ errors: { spam: "form.error.spam" } });
    expect((await handleSubmit(ctx(), body({ formId: f.id, spam: " blue " }), deps())).body).toMatchObject({ ok: true });
  });

  it("attaches uploaded files only with a valid signed reference for this shop", async () => {
    const d = deps();
    const good = signFileRef(SHOP, "gid://shopify/GenericFile/1");
    const foreign = signFileRef(OTHER, "gid://shopify/GenericFile/2");
    const b = body({}, {
      taxNumber: { country: "US", number: "TX-123", region: "TX" },
      billingAddress: { countryCode: "US", address1: "1 Main", city: "Austin", zoneCode: "TX", zip: "73301" },
      certificates: [{ ref: good, name: "cert.pdf", expiresOn: "2030-01-31" }, { ref: foreign, name: "x.pdf" }, { ref: "forged.sig" }],
    });
    await handleSubmit(ctx(), b, d);
    const app = await db.application.findFirstOrThrow({ where: { shop: SHOP, idempotencyKey: b.idempotencyKey } });
    const files = await db.applicationFile.findMany({ where: { shop: SHOP, applicationId: app.id } });
    expect(files.map((f) => f.fileGid)).toEqual(["gid://shopify/GenericFile/1"]);
    expect((app.answers as Record<string, unknown>).certificateMeta).toEqual([{ fileGid: "gid://shopify/GenericFile/1", expiresOn: "2030-01-31" }]);
    expect(d.recordApplicationCertificates).toHaveBeenCalledWith(SHOP, app.id, [
      expect.objectContaining({ fileGid: "gid://shopify/GenericFile/1", type: "resale", country: "US", region: "TX", number: "TX-123", expiresOn: "2030-01-31" }),
    ]);
  });
});

describe("answers", () => {
  it("drops hidden and conditional fields that are not shown, and keeps 'same as billing'", () => {
    const def = definition();
    def.sections[0].fields.push({ id: "custom_1", type: "text", state: "required", custom: true, showIf: { field: "businessType", equals: "salon" } });
    const r = cleanAnswers(def, { ...body().answers, yearEstablished: "1999", custom_1: "x", shippingAddress: { same: true } }, SHOP);
    expect(r.errors).toEqual({});
    expect(r.answers.yearEstablished).toBeUndefined(); // hidden by default
    expect(r.answers.custom_1).toBeUndefined(); // business type isn't salon
    expect(r.answers.shippingAddress).toEqual({ same: true });
    const salon = cleanAnswers(def, { ...body().answers, businessType: "salon" }, SHOP);
    expect(salon.errors.custom_1).toBe("form.error.required");
  });
});

describe("needs-info update", () => {
  it("updates only requested fields, re-checks the tax number and sets the status back to pending", async () => {
    const b = body();
    await handleSubmit(ctx(), b, deps());
    const app = await db.application.findFirstOrThrow({ where: { shop: SHOP, idempotencyKey: b.idempotencyKey } });
    await db.application.update({ where: { id: app.id }, data: { status: "needs_info", requested: { fields: ["phone", "taxNumber"], message: "Please add", at: new Date().toISOString() } } });
    const d = deps({ checkTaxNumber: vi.fn(async () => ({ status: "not_verified" as const })) });
    const bad = await applyUpdate({ shop: SHOP, ip: "x" }, app.id, { answers: { phone: "abc" } }, d);
    expect(bad).toEqual({ ok: false, errors: { phone: "form.error.phone" } });
    const ok = await applyUpdate({ shop: SHOP, ip: "x" }, app.id, { answers: { phone: "+49 30 1234567", taxNumber: { country: "DE", number: "DE111111111" }, companyName: "Hacked" } }, d);
    expect(ok).toEqual({ ok: true });
    const after = await db.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(after.status).toBe("pending");
    expect(after.companyName).toBe(app.companyName); // not requested → ignored
    expect(after.taxCheck).toBe("not_verified");
    expect(decrypt(after.taxNumberEnc!)).toBe("DE111111111");
    expect((after.answers as Record<string, unknown>).phone).toBe("+49 30 1234567");
    expect((after.answers as Record<string, unknown>).firstName).toBe("Jo");
    // Other shops can't touch it.
    expect(await applyUpdate({ shop: OTHER, ip: "x" }, app.id, { answers: {} }, d)).toEqual({ ok: false, error: "not_found" });
  });

  it("requestedDefinition keeps only the requested fields and turns hidden into optional", () => {
    const def = requestedDefinition(definition(), ["yearEstablished", "phone"]);
    const fields = def.sections.flatMap((s) => s.fields);
    expect(fields.map((f) => f.id)).toEqual(["yearEstablished", "phone"]);
    expect(fields[0].state).toBe("optional");
  });
});
