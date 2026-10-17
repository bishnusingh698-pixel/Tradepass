/* eslint-disable @typescript-eslint/no-explicit-any -- fake GraphQL payloads */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import db from "../app/db.server";
import {
  createCsvRun, csvCell, errorReportCsv, guessMapping, ImportFileError, parseCsv, processImportRun, runData, startRun, summarize,
  TAX_EXEMPTION_SET, templateCsv, validateCsvRun, validateRows, IMPORT_FIELDS, type CsvData, type Issue,
} from "../app/lib/import.server";

const shop = `test-automation-import-${Math.random().toString(36).slice(2, 8)}.myshopify.com`;
const tiers = [{ id: "tier_retail", name: "Retailer" }, { id: "tier_dist", name: "Distributor" }];
const terms = [{ id: "gid://shopify/PaymentTermsTemplate/4", name: "Net 30" }];
const refs = { tiers, terms, exemptionValues: TAX_EXEMPTION_SET };

const HEADER = "Company,Email,First name,Last name,Phone,Street,Address 2,City,State,Postcode,Country,Location,Tier,Terms,VAT number,Exemptions";
function row(i: number, over: Partial<Record<string, string>> = {}) {
  const r: Record<string, string> = {
    company: `Company ${i}`, email: `buyer${i}@example.com`, first: "Ana", last: `Lopez ${i}`, phone: "+15125550100",
    street: `${i} Main St`, a2: "", city: "Austin", state: "TX", zip: "78701", country: "US", loc: "", tier: i % 2 ? "Retailer" : "distributor",
    terms: i % 3 ? "" : "Net 30", vat: "", ex: i % 5 ? "" : "US_TX_RESELLER_EXEMPTION", ...over,
  };
  return Object.values(r).map(csvCell).join(",");
}

/** 200 rows: 5 invalid in different ways, the rest valid. */
function file200(): string {
  const lines = [HEADER];
  for (let i = 1; i <= 200; i++) {
    if (i === 10) lines.push(row(i, { email: "not-an-email" }));
    else if (i === 20) lines.push(row(i, { country: "XX" }));
    else if (i === 30) lines.push(row(i, { state: "" }));
    else if (i === 40) lines.push(row(i, { tier: "Gold" }));
    else if (i === 50) lines.push(row(i, { email: "buyer1@example.com" })); // duplicate of row 1
    else if (i === 60) lines.push(row(i, { phone: "call me" })); // warning only
    else if (i === 70) lines.push(row(i, { ex: "US_ZZ_RESELLER_EXEMPTION" }));
    else lines.push(row(i));
  }
  return lines.join("\r\n");
}

describe("CSV parsing and mapping", () => {
  it("parses quotes, escaped quotes, newlines in fields, CRLF, BOM and semicolons", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n"multi\nline",z\n\n')).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["multi\nline", "z"]]);
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("guesses the mapping from common header names", () => {
    const map = guessMapping(HEADER.split(","));
    expect(map).toMatchObject({ company_name: 0, email: 1, first_name: 2, last_name: 3, phone: 4, address1: 5, address2: 6, city: 7, zone_code: 8, zip: 9, country_code: 10, location_name: 11, tier: 12, payment_terms: 13, tax_registration_id: 14, tax_exemptions: 15 });
    expect(guessMapping(IMPORT_FIELDS as unknown as string[])).toMatchObject({ company_name: 0, tax_exemptions: 15 });
  });

  it("ships a template that maps itself and validates", () => {
    const [h, ...data] = parseCsv(templateCsv());
    const { rows, issues } = validateRows(data, guessMapping(h), { ...refs, defaultTierId: null });
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(rows[0]).toMatchObject({ tierId: "tier_retail", paymentTermsTemplateId: terms[0].id, exemptions: ["US_TX_RESELLER_EXEMPTION"] });
  });

  it("writes a quoted error report", () => {
    expect(csvCell('a "b"')).toBe('"a ""b"""');
    const csv = errorReportCsv([{ row: 2, field: "email", level: "error", code: "invalid_email" }], { message: () => "Bad, email", level: () => "Error" }, ["Row", "Column", "Level", "Problem"]);
    expect(csv).toBe('Row,Column,Level,Problem\r\n2,email,Error,"Bad, email"\r\n');
  });
});

describe("validation of 200 rows", () => {
  const [h, ...data] = parseCsv(file200());
  const { rows, issues } = validateRows(data, guessMapping(h), { ...refs, defaultTierId: null });
  const at = (n: number) => issues.filter((i) => i.row === n).map((i) => `${i.level}:${i.field}:${i.code}`);

  it("reports each problem on the right line", () => {
    expect(rows).toHaveLength(200);
    expect(at(11)).toEqual(["error:email:invalid_email"]); // line = data row + 1
    expect(at(21)).toEqual(["error:country_code:invalid_country"]);
    expect(at(31)).toEqual(["error:zone_code:zone_required"]);
    expect(at(41)).toEqual(["error:tier:unknown_tier"]);
    expect(at(51)).toEqual(["error:email:duplicate_in_file"]);
    expect(at(61)).toEqual(["warning:phone:invalid_phone"]);
    expect(at(71)).toEqual(["error:tax_exemptions:invalid_exemption"]);
  });

  it("marks only rows with errors as not ready, and normalises values", () => {
    expect(rows.filter((r) => r.status === "error").map((r) => r.n)).toEqual([11, 21, 31, 41, 51, 71]);
    expect(rows.filter((r) => r.status === "ready")).toHaveLength(194);
    expect(rows[59].values.phone).toBeUndefined();
    expect(rows[1]).toMatchObject({ tierId: "tier_dist", values: { country_code: "US", zone_code: "TX" } });
  });

  it("requires a tier per row unless a default tier is set", () => {
    const noTier = validateRows([["A", "a@x.com", "", "", "", "1 St", "", "Paris", "", "75001", "FR"]], guessMapping(h), { ...refs, defaultTierId: null });
    expect(noTier.issues.map((i) => i.code)).toEqual(["no_tier"]);
    const withDefault = validateRows([["A", "a@x.com", "", "", "", "1 St", "", "Paris", "", "75001", "FR"]], guessMapping(h), { ...refs, defaultTierId: "tier_retail" });
    expect(withDefault.rows[0]).toMatchObject({ status: "ready", tierId: "tier_retail" });
  });
});

function fakeAdmin() {
  return {
    graphql: async (query: string, opts?: { variables?: any }) => {
      const op = /query\s+(\w+)/.exec(query)![1];
      const q = String(opts?.variables?.q ?? "");
      let data: any;
      if (op === "ImportCustomers") {
        data = { customers: { nodes: q.includes('"buyer5@example.com"') ? [{ id: "gid://shopify/Customer/5", defaultEmailAddress: { emailAddress: "Buyer5@example.com" }, companyContactProfiles: [] }] : [] } };
      } else if (op === "ImportCompanies") {
        data = { companies: { nodes: q.includes('"Company 7"') ? [{ id: "gid://shopify/Company/7", name: "company 7" }] : [] } };
      }
      return new Response(JSON.stringify({ data }));
    },
  } as any;
}

beforeAll(async () => {
  await db.shop.create({ data: { shop, billingPlan: "pro" } });
});
afterAll(async () => {
  for (const t of ["activityLog", "importRun", "shopLock", "shop"] as const) await (db[t] as any).deleteMany({ where: { shop } });
});
afterEach(() => vi.restoreAllMocks());

describe("import run: dry run, batches, resume", () => {
  it("rejects files over the limits", async () => {
    await expect(createCsvRun(shop, "Company\n")).rejects.toBeInstanceOf(ImportFileError);
    await expect(createCsvRun(shop, "")).rejects.toMatchObject({ code: "no_header" });
  });

  it("imports 200 rows in batches and resumes after an interruption", async () => {
    const created = await createCsvRun(shop, file200());
    const map = (runData(created) as CsvData).map;
    const { run: validated, issues } = await validateCsvRun(fakeAdmin(), shop, created.id, map, { defaultTierId: null, onExisting: "skip", sendWelcome: false }, refs);

    // Shopify duplicates: row 6 (buyer5) links the existing customer; row 8 (Company 7) is skipped.
    expect(issues.find((i) => i.row === 6)?.code).toBe("existing_customer");
    expect(issues.find((i) => i.row === 8)?.code).toBe("existing_company");
    const sum = summarize(validated);
    expect(sum).toMatchObject({ ready: 193, errors: 6, skipped: 1 });
    expect(validated.total).toBe(193);
    // Dry run creates nothing.
    expect(validated.state).toBe("validated");

    expect(await startRun(shop, created.id, "test")).toBe(true);

    // Fake clock: each buyer creation "takes" one second, so a 20 s budget covers ~5 rows.
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const seen: string[] = [];
    const create = vi.fn(async (_ctx: any, input: any) => {
      clock += 1000;
      seen.push(input.companyName);
      if (input.companyName === "Company 100") throw Object.assign(new Error("Shopify said no for Company 100"), { step: "location" });
      return { buyerId: `b-${seen.length}`, state: {} as any };
    });

    const first = await processImportRun({} as any, shop, created.id, clock + 20_000, { create });
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(10);
    let run = (await db.importRun.findUnique({ where: { id: created.id } }))!;
    expect(run.state).toBe("running");
    expect(run.done).toBe(first);
    const resumeAt = run.cursor;

    // Resume with plenty of time.
    await processImportRun({} as any, shop, created.id, clock + 10_000_000, { create });
    run = (await db.importRun.findUnique({ where: { id: created.id } }))!;
    expect(run.state).toBe("done");
    expect(run.done).toBe(193);
    expect(create).toHaveBeenCalledTimes(193);
    expect(new Set(seen).size).toBe(193); // no row created twice
    expect(run.cursor).toBeGreaterThan(resumeAt);
    expect(seen).not.toContain("Company 7");
    expect(seen).not.toContain("Company 10");

    // The existing customer becomes the contact; others are new contacts with their details.
    const row6 = create.mock.calls.find((c) => c[1].companyName === "Company 5")![1];
    expect(row6.contact).toEqual({ mode: "existing", customerGid: "gid://shopify/Customer/5" });
    const row2 = create.mock.calls.find((c) => c[1].companyName === "Company 2")![1];
    expect(row2).toMatchObject({ source: "import", tierId: "tier_dist", contact: { mode: "new", email: "buyer2@example.com" } });

    // Failures land in the error report; row data is gone after the run (privacy).
    const errs = run.errors as Issue[];
    expect(errs.find((e) => e.row === 101)).toMatchObject({ level: "error", code: "step_failed" });
    expect((runData(run) as CsvData).rows).toBeUndefined();
    expect(JSON.stringify(run)).not.toContain("buyer2@example.com");
    const log = await db.activityLog.findFirst({ where: { shop, action: "import.row" } });
    expect(JSON.stringify(log)).not.toContain("Company 100");
  });

  it("never processes the same run twice at once", async () => {
    const created = await createCsvRun(shop, `${HEADER}\r\n${row(1)}`);
    await validateCsvRun(fakeAdmin(), shop, created.id, (runData(created) as CsvData).map, { defaultTierId: null, onExisting: "skip", sendWelcome: false }, refs);
    await startRun(shop, created.id, "test");
    let release!: () => void;
    const create = vi.fn(() => new Promise<any>((r) => { release = () => r({ buyerId: "b", state: {} }); }));
    const a = processImportRun({} as any, shop, created.id, Date.now() + 60_000, { create });
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    expect(await processImportRun({} as any, shop, created.id, Date.now() + 60_000, { create })).toBe(0);
    release();
    expect(await a).toBe(1);
  });
});
