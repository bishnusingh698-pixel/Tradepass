// Step 2A: US resale and exemption certificates per state, state lookups and the
// Texas open-data check, US form fields (EIN, DUNS, ZIP, E.164 phone), templates,
// nonprofits, and where applicants come from.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import db from "../app/db.server";
import { cleanAnswers, cleanAttribution, cleanUsPermits, handleSubmit, usCertificateRows, type IntakeDeps } from "../app/lib/intake.server";
import { applyTemplate, defaultFormDefinition, withAllStandardFields, type FormDefinition } from "../app/lib/form-defaults";
import { readDefinition } from "../app/lib/forms.server";
import { defaultSettings } from "../app/lib/settings";
import { decrypt } from "../app/lib/crypto.server";
import { signFileRef } from "../app/lib/uploads.server";
import { checkUsPermit, parseTexasPermits, TX_PERMITS_URL } from "../app/lib/taxcheck.server";
import { recordApplicationCertificates, markCertificateChecked, recheckCertificate } from "../app/lib/certificates.server";
import { dunsOk, einOk, PERMIT_LOOKUPS, SST_STATES, stateHints, texasTaxpayerNumber, US_STATES, usZipOk } from "../app/lib/us-states";

process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.LINK_TOKEN_SECRET ||= "test-link-secret";

const rnd = randomBytes(4).toString("hex");
const SHOP = `test-us-${rnd}.myshopify.com`;
const FREE = `test-us-free-${rnd}.myshopify.com`;
let formId = "";
let freeFormId = "";

const usForm = (): FormDefinition => applyTemplate(defaultFormDefinition(), "us_retail");

function deps(over: Partial<IntakeDeps> = {}) {
  const d = {
    getAdmin: vi.fn(async () => null),
    checkTaxNumber: vi.fn(async () => ({ status: "na" as const })),
    checkUsPermit: vi.fn(async (st: string) => (st === "TX" ? { status: "verified" as const, name: "LONE STAR GOODS LLC" } : { status: "na" as const })),
    emitFlowTrigger: vi.fn(async () => undefined),
    evaluateRules: vi.fn(async () => ({ decided: null })),
    recordApplicationCertificates: vi.fn(async (...a: Parameters<typeof recordApplicationCertificates>) => recordApplicationCertificates(...a)),
    defer: vi.fn(async (_s: string, _i: string, run: () => Promise<void>) => run()),
    ...over,
  };
  return d as typeof d & IntakeDeps;
}

let n = 0;
const addr = { countryCode: "US", address1: "1 Main St", city: "Austin", zoneCode: "TX", zip: "78701" };
function body(fid: string, answers: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  n++;
  return {
    idempotencyKey: `us-${rnd}-${n}-${randomBytes(3).toString("hex")}`, formId: fid, locale: "en", elapsedMs: 15_000, hp: "",
    answers: {
      companyName: `Lone Star ${n} ${rnd}`, businessType: "retail", firstName: "Sam", lastName: "Hill", email: `sam${n}-${rnd}@lonestar.test`,
      billingAddress: addr, consent: true, phone: "+15125550123", storeType: "both",
      taxNumber: { country: "US", form: "mtc", states: [{ region: "TX", number: "32012345678" }, { region: "CA", number: "SR-123-456789" }] },
      ...answers,
    },
    ...extra,
  };
}
const ctx = (shop = SHOP) => ({ shop, loggedInCustomerId: null, ip: `10.9.${n % 250}.${Math.floor(Math.random() * 250)}#${rnd}` });

beforeAll(async () => {
  await db.shop.create({ data: { shop: SHOP, name: "US Store", settings: defaultSettings() as object, billingPlan: "starter", country: "US" } });
  await db.shop.create({ data: { shop: FREE, name: "US Free", settings: defaultSettings() as object, billingPlan: "free", country: "US" } });
  formId = (await db.form.create({ data: { shop: SHOP, name: "US", isDefault: true, definition: usForm() as object } })).id;
  freeFormId = (await db.form.create({ data: { shop: FREE, name: "US", isDefault: true, definition: usForm() as object } })).id;
});
afterAll(async () => {
  for (const shop of [SHOP, FREE]) {
    for (const m of [db.certificate, db.applicationFile, db.application, db.activityLog, db.form, db.job]) {
      await (m as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { shop } });
    }
    await db.shop.deleteMany({ where: { shop } });
  }
});

describe("A1 multistate resale certificate: one certificate per state", () => {
  it("stores each state's permit encrypted, checks Texas live, and records one certificate row per state sharing the file", async () => {
    const d = deps();
    const ref = signFileRef(SHOP, "gid://shopify/GenericFile/77");
    const b = body(formId, { certificates: [{ ref, name: "mtc.pdf", expiresOn: "2027-12-31" }] });
    const res = await handleSubmit(ctx(), b, d);
    expect(res).toMatchObject({ http: 200, body: { ok: true, status: "received" } });
    const app = await db.application.findFirstOrThrow({ where: { shop: SHOP, idempotencyKey: b.idempotencyKey } });
    const answers = app.answers as Record<string, unknown>;
    expect(answers.taxNumber).toEqual({ country: "US", region: "TX", form: "mtc", states: [{ region: "TX" }, { region: "CA" }] });
    const permits = answers.usPermits as { region: string; numberEnc: string }[];
    expect(permits.map((p) => [p.region, decrypt(p.numberEnc)])).toEqual([["TX", "32012345678"], ["CA", "SR-123-456789"]]);
    expect(JSON.stringify(answers)).not.toContain("32012345678");
    expect(d.checkUsPermit).toHaveBeenCalledWith("TX", "32012345678");
    expect(app.taxCheck).toBe("verified");
    expect(app.taxCheckName).toBe("LONE STAR GOODS LLC");
    const certs = await db.certificate.findMany({ where: { shop: SHOP, applicationId: app.id }, orderBy: { region: "asc" } });
    expect(certs.map((c) => [c.region, c.form, c.type, c.fileGid, c.checkResult])).toEqual([
      ["CA", "mtc", "resale", "gid://shopify/GenericFile/77", null],
      ["TX", "mtc", "resale", "gid://shopify/GenericFile/77", "verified"],
    ]);
    expect(certs.every((c) => c.expiresOn?.toISOString().slice(0, 10) === "2027-12-31")).toBe(true);
    expect(decrypt(certs[1].numberEnc!)).toBe("32012345678");
    // Recording again (hourly retry) doesn't duplicate rows.
    await recordApplicationCertificates(SHOP, app.id, usCertificateRows({ country: "US", number: "", region: "", form: "mtc", states: [{ region: "TX", number: "32012345678" }, { region: "CA", number: "x" }] }, [{ fileGid: "gid://shopify/GenericFile/77", name: "", expiresOn: null }]));
    expect(await db.certificate.count({ where: { shop: SHOP, applicationId: app.id } })).toBe(2);
  });

  it("works without an uploaded file, and the Free plan makes no live call", async () => {
    const d = deps();
    const b = body(freeFormId, { certificates: undefined });
    const def = usForm();
    for (const s of def.sections) for (const f of s.fields) if (f.id === "certificates") f.state = "optional";
    await db.form.update({ where: { id: freeFormId }, data: { definition: def as object } });
    const res = await handleSubmit(ctx(FREE), b, d);
    expect(res.http).toBe(200);
    expect(d.checkUsPermit).not.toHaveBeenCalled();
    const app = await db.application.findFirstOrThrow({ where: { shop: FREE, idempotencyKey: b.idempotencyKey } });
    expect(app.taxCheck).toBe("skipped");
    expect(await db.certificate.count({ where: { shop: FREE, applicationId: app.id, fileGid: null } })).toBe(2);
  });

  it("validates the states: known state per number, a number per state, no duplicates, at most 12", () => {
    expect(cleanUsPermits({ form: "sst", states: [{ region: "tx", number: " 123 " }, { region: "TX", number: "456" }] })).toEqual({ form: "sst", states: [{ region: "TX", number: "123" }], error: null });
    expect(cleanUsPermits({ states: [{ region: "XX", number: "1" }] }).error).toBe("form.error.us_state");
    expect(cleanUsPermits({ states: [{ region: "CA", number: "" }] }).error).toBe("form.error.required");
    expect(cleanUsPermits({ form: "nope", states: [] }).form).toBe("state");
    const many = US_STATES.slice(0, 13).map((s) => ({ region: s, number: "1" }));
    expect(cleanUsPermits({ states: many }).error).toBe("form.error.too_many_states");
  });
});

describe("A2 state lookups and the Texas open data", () => {
  it("lists only official lookup pages (https, government or the state's own domain)", () => {
    for (const [st, l] of Object.entries(PERMIT_LOOKUPS)) {
      expect(US_STATES as readonly string[]).toContain(st);
      expect(l!.url).toMatch(/^https:\/\/([a-z0-9.-]+\.)?(gov|ca\.gov|texas\.gov|floridarevenue\.com|aztaxes\.gov)\//);
    }
    expect(PERMIT_LOOKUPS.CA!.live).toBeUndefined(); // CDTFA is a web form: link only
    expect(PERMIT_LOOKUPS.TX!.live).toBe("tx_socrata");
  });

  it("parses the dataset reply: a row is active, an empty list is not found, anything else couldn't be checked", () => {
    expect(parseTexasPermits(200, [{ taxpayer_number: "32012345678", taxpayer_name: "LONE STAR GOODS LLC" }], "32012345678")).toEqual({ status: "verified", name: "LONE STAR GOODS LLC", registry: "tx_comptroller" });
    expect(parseTexasPermits(200, [], "32012345678").status).toBe("not_verified");
    expect(parseTexasPermits(500, null, "32012345678").status).toBe("unavailable");
    expect(parseTexasPermits(200, { error: true }, "32012345678").status).toBe("unavailable");
  });

  it("calls data.texas.gov only for an 11-digit Texas taxpayer number, within the time budget", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify([{ taxpayer_number: "12345678901", taxpayer_name: "X" }]), { status: 200 }));
    expect((await checkUsPermit("TX", "1-23456-78901-0".slice(0, 15).replace(/-/g, "").slice(0, 11), f as never)).status).toBe("verified");
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe(`${TX_PERMITS_URL}?taxpayer_number=12345678901&%24limit=1`);
    expect(await checkUsPermit("TX", "12-3456789", f as never)).toEqual({ status: "na" }); // an FEIN: don't guess
    expect(await checkUsPermit("CA", "SR-123", f as never)).toEqual({ status: "na" });
    expect(f).toHaveBeenCalledTimes(1);
    const never = vi.fn(() => new Promise<Response>(() => undefined));
    expect(await checkUsPermit("TX", "32012345678", never as never, 50)).toEqual({ status: "unavailable" });
    expect(texasTaxpayerNumber("2012345678")).toBeNull();
  });

  it("staff can mark a permit checked (who, when) and re-run the live check", async () => {
    const app = await db.application.findFirstOrThrow({ where: { shop: SHOP } });
    const cert = await db.certificate.findFirstOrThrow({ where: { shop: SHOP, applicationId: app.id, region: "CA" } });
    expect(await markCertificateChecked(SHOP, cert.id, "Alex (staff)")).toBe(true);
    const after = await db.certificate.findUniqueOrThrow({ where: { id: cert.id } });
    expect(after).toMatchObject({ checkResult: "manual", checkedBy: "Alex (staff)" });
    expect(after.checkedAt).toBeInstanceOf(Date);
    expect(await db.activityLog.count({ where: { shop: SHOP, action: "certificate.checked", subject: cert.id } })).toBe(1);
    // California has no dataset: nothing to re-run.
    expect((await recheckCertificate(SHOP, cert.id, "staff", async () => ({ status: "na" }))).ok).toBe(false);
    const tx = await db.certificate.findFirstOrThrow({ where: { shop: SHOP, applicationId: app.id, region: "TX" } });
    expect(await recheckCertificate(SHOP, tx.id, "staff", async () => ({ status: "not_verified" }))).toEqual({ ok: true, result: "not_found" });
    expect((await db.certificate.findUniqueOrThrow({ where: { id: tx.id } })).checkResult).toBe("not_found");
  });

  it("shows neutral hints: no statewide tax, SST membership, MTC conditions, nonprofits", () => {
    expect(stateHints("OR", "state")).toEqual(["no_state_tax"]);
    expect(stateHints("AK", "state")).toEqual(["local_only"]);
    expect(stateHints("CA", "sst")).toEqual(["sst_not_member"]);
    expect(stateHints("WA", "sst")).toEqual([]);
    expect(stateHints("TX", "mtc")).toEqual(["mtc_conditional"]);
    expect(stateHints("NY", "exempt")).toEqual(["exempt_no_enum"]);
    expect(SST_STATES).toHaveLength(24);
  });
});

describe("A3 US form fields", () => {
  const def = usForm();
  const base = { companyName: "X", firstName: "A", lastName: "B", email: "a@b.test", consent: true, businessType: "retail", storeType: "online" };

  it("requires a state and a ZIP or ZIP+4 for US addresses", () => {
    expect(cleanAnswers(def, { ...base, billingAddress: { ...addr, zip: "7870" } }, SHOP).errors.billingAddress).toBe("form.error.zip");
    expect(cleanAnswers(def, { ...base, billingAddress: { ...addr, zoneCode: "" } }, SHOP).errors.billingAddress).toBe("form.error.required");
    expect(cleanAnswers(def, { ...base, billingAddress: { ...addr, zip: "78701-1234", zoneCode: "tx" } }, SHOP).answers.billingAddress).toMatchObject({ zoneCode: "TX", zip: "78701-1234" });
    expect(usZipOk("94103")).toBe(true);
    expect(usZipOk("9410")).toBe(false);
  });

  it("checks EIN and D-U-N-S by format only, and keeps phones in E.164", () => {
    const withAll = (extra: Record<string, unknown>) => cleanAnswers(withEinDuns(def), { ...base, billingAddress: addr, phone: "+15125550123", ...extra }, SHOP);
    expect(withAll({ ein: "12-3456789", duns: "15-048-3782" }).errors).toEqual({});
    expect(withAll({ ein: "123" }).errors.ein).toBe("form.error.ein");
    expect(withAll({ duns: "12345" }).errors.duns).toBe("form.error.duns");
    expect(withAll({ phone: "+1 512 555 0123" }).answers.phone).toBe("+15125550123");
    expect(withAll({ phone: "+1" }).errors.phone).toBe("form.error.phone");
    expect(withAll({ phone: "0512 555 0123" }).answers.phone).toBe("0512 555 0123"); // older form scripts: accepted as typed
    expect(einOk("12-3456789") && dunsOk("150483782")).toBe(true);
  });

  it("the US retailer template turns the new questions on; older forms get them as hidden", () => {
    const f = (d: FormDefinition, id: string) => d.sections.flatMap((s) => s.fields).find((x) => x.id === id);
    expect(f(def, "storeType")?.state).toBe("required");
    expect(f(def, "ein")?.state).toBe("optional");
    expect(f(def, "taxNumber")?.state).toBe("required");
    const old = defaultFormDefinition();
    old.sections[0].fields = old.sections[0].fields.filter((x) => !["ein", "duns", "storeType"].includes(x.id));
    const filled = withAllStandardFields(old);
    expect(f(filled, "ein")?.state).toBe("hidden");
    expect(f(readDefinition(old), "duns")?.state).toBe("hidden");
    expect(f(applyTemplate(old, "nonprofit"), "ein")?.state).toBe("required");
    expect(f(defaultFormDefinition(), "businessType")?.options?.map((o) => o.value)).toContain("nonprofit");
  });
});

describe("A15 attribution", () => {
  it("keeps UTM tags, the referring host and the landing path only", () => {
    expect(cleanAttribution({ utm_source: "Trade-Show", utm_medium: "qr", utm_campaign: "<b>expo</b>", ref: "www.Google.com", landing: "/pages/wholesale?email=x@y.z", extra: "drop" }))
      .toEqual({ utm_source: "trade-show", utm_medium: "qr", utm_campaign: "bexpob", ref: "google.com", landing: "/pages/wholesale" });
    expect(cleanAttribution({ ref: "https://evil.test/path" })).toBeNull();
    expect(cleanAttribution("nope")).toBeNull();
  });
});

function withEinDuns(def: FormDefinition): FormDefinition {
  const out = structuredClone(def);
  for (const s of out.sections) for (const f of s.fields) if (["ein", "duns", "phone", "taxNumber", "certificates"].includes(f.id)) f.state = "optional";
  return out;
}
