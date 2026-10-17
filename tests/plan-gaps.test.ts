// Spec gaps closed on 2026-10-17: plan gating of tax-number checks (Starter) and
// the "Powered by Tradepass" link (Free), the server-side file limits, and the
// Pro activity export.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import db from "../app/db.server";
import { applyUpdate, cleanAnswers, handleSubmit, taxChecksEnabled, type IntakeDeps } from "../app/lib/intake.server";
import { defaultFormDefinition, type FormDefinition } from "../app/lib/form-defaults";
import { defaultSettings, readSettings } from "../app/lib/settings";
import { decrypt } from "../app/lib/crypto.server";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES, readUploadForm, signFileRef } from "../app/lib/uploads.server";
import { buildConfig, POWERED_BY_URL } from "../app/lib/storefront-sync.server";
import { ACTIVITY_CSV_COLUMNS, cleanDetail, exportActivityCsv, logActivity } from "../app/lib/activity.server";
import { effectivePlan, type PlanId } from "../app/lib/plans";

process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.LINK_TOKEN_SECRET ||= "test-link-secret";

// The Settings route is driven through its action with a fake admin context.
vi.mock("../app/shopify.server", () => ({ authenticate: { admin: vi.fn() }, unauthenticated: { admin: vi.fn() } }));
vi.mock("../app/lib/storefront-sync.server", async (orig) => ({ ...(await orig<object>()), syncStorefrontConfig: vi.fn(async () => undefined) }));
vi.mock("../app/lib/context.server", async () => {
  const { default: prisma } = await import("../app/db.server");
  const settingsMod = await import("../app/lib/settings");
  const plans = await import("../app/lib/plans");
  return {
    adminContext: async (request: Request) => {
      const shop = new URL(request.url).searchParams.get("shop")!;
      const row = await prisma.shop.findUnique({ where: { shop } });
      return {
        shop, shopRow: row, admin: {}, actor: "staff:1", t: (k: string) => k,
        settings: settingsMod.readSettings(row?.settings ?? {}),
        plan: plans.effectivePlan(row?.billingPlan ?? "free", Boolean(row?.isDevStore)),
      };
    },
  };
});

const rnd = randomBytes(4).toString("hex");
const FREE = `test-gaps-free-${rnd}.myshopify.com`;
const STARTER = `test-gaps-starter-${rnd}.myshopify.com`;
const PRO = `test-gaps-pro-${rnd}.myshopify.com`;
const DEV = `test-gaps-dev-${rnd}.myshopify.com`;
const SHOPS = [FREE, STARTER, PRO, DEV];
const forms: Record<string, string> = {};

function definition(): FormDefinition {
  const def = defaultFormDefinition();
  for (const s of def.sections) for (const f of s.fields) if (f.id === "certificates" || f.id === "taxNumber") f.state = "optional";
  def.spamQuestion = { enabled: false, texts: {} };
  return def;
}

function deps(over: Partial<IntakeDeps> = {}) {
  const d = {
    getAdmin: vi.fn(async () => null),
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
function body(shop: string, answers: Record<string, unknown> = {}) {
  n++;
  return {
    idempotencyKey: `gaps-${rnd}-${n}-${randomBytes(3).toString("hex")}`,
    formId: forms[shop],
    locale: "en",
    elapsedMs: 15_000,
    hp: "",
    answers: {
      companyName: `Gaps ${n} ${rnd}`,
      businessType: "retail",
      firstName: "Jo",
      lastName: "Doe",
      email: `gaps${n}-${rnd}@example.com`,
      billingAddress: { countryCode: "DE", address1: "Hauptstr. 1", city: "Berlin", zip: "10115" },
      consent: true,
      ...answers,
    },
  };
}
const ctx = (shop: string) => ({ shop, loggedInCustomerId: null, ip: `10.9.${n % 250}.${Math.floor(Math.random() * 250)}#${rnd}` });

beforeAll(async () => {
  const rows: [string, PlanId, boolean][] = [[FREE, "free", false], [STARTER, "starter", false], [PRO, "pro", false], [DEV, "free", true]];
  for (const [shop, billingPlan, isDevStore] of rows) {
    await db.shop.create({ data: { shop, name: "Gaps Store", settings: defaultSettings() as object, billingPlan, isDevStore } });
    forms[shop] = (await db.form.create({ data: { shop, name: "Default", isDefault: true, definition: definition() as object } })).id;
  }
});

afterAll(async () => {
  for (const shop of SHOPS) {
    await db.applicationFile.deleteMany({ where: { shop } });
    await db.application.deleteMany({ where: { shop } });
    await db.activityLog.deleteMany({ where: { shop } });
    await db.form.deleteMany({ where: { shop } });
    await db.shop.deleteMany({ where: { shop } });
  }
});

describe("tax-number checks are a Starter feature", () => {
  it("knows which shops get live checks (dev stores count as Pro)", async () => {
    expect(await taxChecksEnabled(FREE)).toBe(false);
    expect(await taxChecksEnabled(STARTER)).toBe(true);
    expect(await taxChecksEnabled(PRO)).toBe(true);
    expect(await taxChecksEnabled(DEV)).toBe(true);
    expect(await taxChecksEnabled(`missing-${rnd}.myshopify.com`)).toBe(false);
  });

  it("Free: stores the number encrypted, makes no lookup and marks it skipped", async () => {
    const d = deps();
    const b = body(FREE, { taxNumber: { country: "DE", number: "DE123456789" } });
    const res = await handleSubmit(ctx(FREE), b, d);
    expect(res).toMatchObject({ http: 200, body: { ok: true } });
    expect(d.checkTaxNumber).not.toHaveBeenCalled();
    const app = await db.application.findFirstOrThrow({ where: { shop: FREE, idempotencyKey: b.idempotencyKey } });
    expect(app.taxCheck).toBe("skipped");
    expect(app.taxCheckName).toBeNull();
    expect(decrypt(app.taxNumberEnc!)).toBe("DE123456789");
    expect((app.answers as Record<string, unknown>).taxNumberHash).toBeTypeOf("string"); // duplicates still detected
  });

  it("Free without a tax number stays N/A", async () => {
    const b = body(FREE);
    await handleSubmit(ctx(FREE), b, deps());
    const app = await db.application.findFirstOrThrow({ where: { shop: FREE, idempotencyKey: b.idempotencyKey } });
    expect(app.taxCheck).toBe("na");
  });

  it("Starter and dev stores check the number live", async () => {
    for (const shop of [STARTER, DEV]) {
      const d = deps();
      const b = body(shop, { taxNumber: { country: "DE", number: "DE123456789" } });
      await handleSubmit(ctx(shop), b, d);
      expect(d.checkTaxNumber).toHaveBeenCalledWith("DE", "DE123456789");
      const app = await db.application.findFirstOrThrow({ where: { shop, idempotencyKey: b.idempotencyKey } });
      expect(app.taxCheck).toBe("verified");
    }
  });

  it("the needs-info update follows the same rule", async () => {
    const b = body(FREE);
    await handleSubmit(ctx(FREE), b, deps());
    const app = await db.application.findFirstOrThrow({ where: { shop: FREE, idempotencyKey: b.idempotencyKey } });
    await db.application.update({ where: { id: app.id }, data: { status: "needs_info", requested: { fields: ["taxNumber"], message: "x", at: new Date().toISOString() } } });
    const d = deps();
    expect(await applyUpdate({ shop: FREE, ip: "x" }, app.id, { answers: { taxNumber: { country: "DE", number: "DE999999999" } } }, d)).toEqual({ ok: true });
    expect(d.checkTaxNumber).not.toHaveBeenCalled();
    const after = await db.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(after.taxCheck).toBe("skipped");
    expect(decrypt(after.taxNumberEnc!)).toBe("DE999999999");
  });
});

describe("'Powered by Tradepass' on the Free plan's form", () => {
  it("is in the storefront config on Free only", () => {
    const s = defaultSettings();
    expect(buildConfig(s, [], [], new Date(), "free").brand).toBe(POWERED_BY_URL);
    expect(buildConfig(s, [], [], new Date(), "starter").brand).toBeNull();
    expect(buildConfig(s, [], [], new Date(), "pro").brand).toBeNull();
    // Dev stores get Pro, so no branding there either.
    expect(buildConfig(s, [], [], new Date(), effectivePlan("free", true)).brand).toBeNull();
    expect(POWERED_BY_URL).toMatch(/^https:\/\//);
  });

  it("the form block renders the link only when config.brand is set, with a built-in string", () => {
    const liquid = readFileSync("extensions/tradepass-theme/blocks/application-form.liquid", "utf8");
    expect(liquid).toContain("app.metafields.tradepass.config.value.brand");
    expect(liquid).toMatch(/if tp_form != blank and tp_brand != blank/);
    const en = JSON.parse(readFileSync("extensions/tradepass-theme/locales/en.default.json", "utf8"));
    expect(en.brand.powered_by).toBe("Powered by Tradepass");
  });
});

describe("file limits are enforced on the server", () => {
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
  const file = (bytes: Uint8Array, name = "cert.pdf", type = "application/pdf") => new File([new Uint8Array(bytes)], name, { type });
  const refs = (shop: string, count: number) => Array.from({ length: count }, (_, i) => ({ ref: signFileRef(shop, `gid://shopify/GenericFile/${rnd}${i}`), name: `c${i}.pdf` }));

  it("upload: exactly one PDF/JPG/PNG of at most 5 MB per request", async () => {
    const one = new FormData();
    one.append("file", file(PDF));
    one.append("field", "certificates");
    const ok = await readUploadForm(one);
    expect(ok.ok).toBe(true);

    const two = new FormData();
    two.append("file", file(PDF));
    two.append("file", file(PDF, "b.pdf"));
    expect(await readUploadForm(two)).toEqual({ ok: false, error: "file_count" });

    const sneaky = new FormData();
    sneaky.append("file", file(PDF));
    sneaky.append("other", file(PDF, "b.pdf"));
    expect(await readUploadForm(sneaky)).toEqual({ ok: false, error: "file_count" });

    const none = new FormData();
    none.append("file", "not a file");
    expect(await readUploadForm(none)).toEqual({ ok: false, error: "file_type" });

    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(PDF);
    const large = new FormData();
    large.append("file", file(big));
    expect(await readUploadForm(large)).toEqual({ ok: false, error: "file_size" });

    const html = new FormData();
    html.append("file", file(new TextEncoder().encode("<html></html>"), "cert.pdf"));
    expect(await readUploadForm(html)).toEqual({ ok: false, error: "file_type" });
  });

  it("submit: more than 3 files on a question is refused, repeats of one file count once", async () => {
    const def = definition();
    expect(MAX_UPLOAD_FILES).toBe(3);
    const four = cleanAnswers(def, { ...body(STARTER).answers, certificates: refs(STARTER, 4) }, STARTER);
    expect(four.errors.certificates).toBe("form.error.file_count");
    const three = cleanAnswers(def, { ...body(STARTER).answers, certificates: refs(STARTER, 3) }, STARTER);
    expect(three.errors).toEqual({});
    expect(three.files.certificates).toHaveLength(3);
    const [r] = refs(STARTER, 1);
    const repeated = cleanAnswers(def, { ...body(STARTER).answers, certificates: [r, r, r] }, STARTER);
    expect(repeated.files.certificates).toHaveLength(1);
    // Another shop's references are dropped.
    const foreign = cleanAnswers(def, { ...body(STARTER).answers, certificates: refs(FREE, 2) }, STARTER);
    expect(foreign.files.certificates).toBeUndefined();
  });

  it("submit through the proxy handler returns the field error and stores nothing", async () => {
    const b = body(STARTER, { certificates: refs(STARTER, 4) });
    const res = await handleSubmit(ctx(STARTER), b, deps());
    expect(res).toEqual({ http: 400, body: { ok: false, errors: { certificates: "form.error.file_count" } } });
    expect(await db.application.count({ where: { shop: STARTER, idempotencyKey: b.idempotencyKey } })).toBe(0);
  });
});

describe("activity export (Pro)", () => {
  beforeAll(async () => {
    await logActivity({ shop: PRO, actor: "Ann Staff", action: "application.approve", subject: "app_1", detail: { tierId: "t1", to: "t2" } });
    await logActivity({
      shop: PRO, actor: "system", action: "tier.sync", subject: "=HYPERLINK(\"x\")", result: "failed",
      detail: { error: "Customer jo@example.com not found", token: "abc", email: "jo@example.com", nested: { secret: "s", code: "X" } },
    });
    await logActivity({ shop: STARTER, actor: "Other Shop", action: "application.approve", subject: "other_app" });
  });

  it("exports this shop's entries only, newest first, without secrets or personal data", async () => {
    const { csv, rows, truncated } = await exportActivityCsv(PRO);
    expect(truncated).toBe(false);
    expect(rows).toBe(2);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(ACTIVITY_CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("tier.sync"); // newest first
    expect(csv).not.toContain("other_app");
    expect(csv).not.toContain("Other Shop");
    expect(csv).not.toContain("jo@example.com");
    expect(csv).not.toContain("abc");
    expect(csv).not.toMatch(/"secret"/);
    expect(csv).toContain("[email]");
    expect(csv).toContain(`'=HYPERLINK`); // spreadsheet formulas neutralised
    expect(csv).toContain("Ann Staff"); // who did it, as the spec's activity entries record
  });

  it("cleanDetail keeps ids and codes", () => {
    expect(cleanDetail({ tierId: "t1", to: "starter", rows: 3, ok: true, phone: "+1", companyName: "Acme", api_key: "k" })).toEqual({ tierId: "t1", to: "starter", rows: 3, ok: true });
  });

  it("the Settings action refuses the export below Pro and returns CSV on Pro", async () => {
    const { action } = await import("../app/routes/app.settings._index");
    const call = (shop: string) => {
      const fd = new FormData();
      fd.set("intent", "export_activity");
      return action({ request: new Request(`https://app.test/app/settings?shop=${shop}`, { method: "POST", body: fd }), params: {}, context: {} } as never);
    };
    const locked = await call(STARTER);
    expect(locked).toMatchObject({ ok: false, intent: "export_activity", errors: { export: "settings.activity.locked" } });
    const ok = (await call(PRO)) as { ok: boolean; csv?: string };
    expect(ok.ok).toBe(true);
    expect(ok.csv).toContain("application.approve");
    expect(ok.csv).not.toContain("other_app");
  });
});

describe("Settings: tier assignment switch", () => {
  it("saves automatic/assisted, keeps the mode when the field is absent and rejects other values", async () => {
    const { action } = await import("../app/routes/app.settings._index");
    const save = (fields: Record<string, string>) => {
      const fd = new FormData();
      fd.set("intent", "save");
      fd.set("months", "12");
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      return action({ request: new Request(`https://app.test/app/settings?shop=${STARTER}`, { method: "POST", body: fd }), params: {}, context: {} } as never);
    };
    const mode = async () => readSettings((await db.shop.findUniqueOrThrow({ where: { shop: STARTER } })).settings).tiers.assignment;
    expect(await save({ assignment: "assisted" })).toMatchObject({ ok: true });
    expect(await mode()).toBe("assisted");
    expect(await save({})).toMatchObject({ ok: true });
    expect(await mode()).toBe("assisted");
    expect(await save({ assignment: "magic" })).toMatchObject({ ok: false, errors: { assignment: "settings.error.assignment" } });
    expect(await save({ assignment: "auto" })).toMatchObject({ ok: true });
    expect(await mode()).toBe("auto");
    expect(await db.activityLog.count({ where: { shop: STARTER, action: "settings.tier_assignment" } })).toBe(2);
  });
});
