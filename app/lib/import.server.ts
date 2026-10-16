import type { ImportRun } from "@prisma/client";
import db from "../db.server";
import { gql, mutate, type Admin } from "./gql.server";
import { logActivity } from "./activity.server";
import { tryLock, unlock } from "./lock.server";
import { createBuyerFromInput, TAX_EXEMPTIONS, type Address, type ApproveInput } from "./approval.server";

// CSV import and tag conversion (spec §L, Pro). A run is an ImportRun row:
//   draft      → file parsed, waiting for column mapping
//   validated  → rows checked (dry run shown), waiting for "Start import"
//   running    → rows processed in small batches (by the open Import page and
//                the hourly job); `cursor` is the resume point
//   done       → finished; row data is cleared, only row numbers + codes stay
// Row data lives in ImportRun.mapping (JSON) only while the run is open, so no
// personal data stays in our database after the import (PRIVACY.md).

export const MAX_FILE_BYTES = 2_000_000;
export const MAX_ROWS = 5000;
/** Leave room for one buyer creation (several Shopify calls) before the deadline. */
const ROW_MARGIN_MS = 15_000;

// ---------------------------------------------------------------------------
// CSV parsing (RFC 4180: quoted fields, "" escapes, CRLF/LF, BOM; `,` or `;`).

export function detectDelimiter(firstLine: string): "," | ";" | "\t" {
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const counts = { ",": count(","), ";": count(";"), "\t": count("\t") };
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as "," | ";" | "\t");
}

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const delim = detectDelimiter(src.split(/\r?\n/, 1)[0] ?? "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** Quote a value for CSV output, neutralising spreadsheet formulas. */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------------------------------------------------------------------
// Columns and mapping.

export const IMPORT_FIELDS = [
  "company_name", "email", "first_name", "last_name", "phone",
  "address1", "address2", "city", "zone_code", "zip", "country_code",
  "location_name", "tier", "payment_terms", "tax_registration_id", "tax_exemptions",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const REQUIRED_FIELDS: ImportField[] = ["company_name", "email", "address1", "city", "country_code"];

const SYNONYMS: Record<ImportField, string[]> = {
  company_name: ["company", "companyname", "business", "businessname", "organization", "organisation"],
  email: ["email", "emailaddress", "mail", "contactemail"],
  first_name: ["firstname", "givenname", "first"],
  last_name: ["lastname", "surname", "familyname", "last"],
  phone: ["phone", "phonenumber", "telephone", "tel", "mobile"],
  address1: ["address1", "address", "street", "addressline1", "street1"],
  address2: ["address2", "addressline2", "street2", "suite", "apartment"],
  city: ["city", "town"],
  zone_code: ["zonecode", "province", "provincecode", "state", "statecode", "region"],
  zip: ["zip", "zipcode", "postcode", "postalcode"],
  country_code: ["countrycode", "country"],
  location_name: ["locationname", "location", "branch", "store"],
  tier: ["tier", "tiername", "pricelevel", "group"],
  payment_terms: ["paymentterms", "terms", "net"],
  tax_registration_id: ["taxregistrationid", "taxid", "vat", "vatnumber", "taxnumber", "ein", "abn"],
  tax_exemptions: ["taxexemptions", "exemptions", "taxexemption", "exemption"],
};

export type ColumnMap = Partial<Record<ImportField, number | null>>;

const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export function guessMapping(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    const idx = headers.findIndex((h, i) => !used.has(i) && (key(h) === key(field) || SYNONYMS[field].includes(key(h))));
    map[field] = idx >= 0 ? idx : null;
    if (idx >= 0) used.add(idx);
  }
  return map;
}

export function templateCsv(): string {
  const example = [
    "Acme Supplies", "buyer@example.com", "Ana", "Lopez", "+15125550100",
    "100 Main St", "Suite 4", "Austin", "TX", "78701", "US",
    "Austin store", "Retailer", "Net 30", "", "US_TX_RESELLER_EXEMPTION",
  ];
  return `${IMPORT_FIELDS.join(",")}\r\n${example.map(csvCell).join(",")}\r\n`;
}

// ---------------------------------------------------------------------------
// Row validation (pure; Shopify duplicate lookups are added by checkShopify).

export type IssueCode =
  | "required" | "invalid_email" | "invalid_country" | "zone_required" | "invalid_phone"
  | "unknown_tier" | "no_tier" | "unknown_terms" | "invalid_exemption"
  | "duplicate_in_file" | "existing_company" | "existing_customer" | "customer_in_company"
  | "already_buyer" | "no_address" | "step_failed" | "failed";
export type Issue = { row: number; field: ImportField | null; level: "error" | "warning"; code: IssueCode };

export type PreparedRow = {
  n: number; // 1-based line number in the file, header = 1
  values: Partial<Record<ImportField, string>>;
  tierId: string | null;
  paymentTermsTemplateId: string | null;
  exemptions: string[];
  status: "ready" | "error" | "skip" | "started" | "done" | "failed";
  customerGid?: string | null;
  companyGid?: string | null;
};

export const TAX_EXEMPTION_SET: ReadonlySet<string> = new Set(TAX_EXEMPTIONS);

export type ValidationRefs = {
  tiers: { id: string; name: string }[];
  terms: { id: string; name: string }[];
  defaultTierId: string | null;
  exemptionValues: ReadonlySet<string>;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9][0-9 ().-]{5,}$/;
const ZONE_REQUIRED = new Set(["US", "CA", "AU"]);
const regionNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "code" });

export function isCountryCode(code: string): boolean {
  if (!/^[A-Z]{2}$/.test(code)) return false;
  try {
    return regionNames.of(code) !== code;
  } catch {
    return false;
  }
}

export function validateRows(data: string[][], map: ColumnMap, refs: ValidationRefs): { rows: PreparedRow[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const rows: PreparedRow[] = [];
  const seenEmail = new Map<string, number>();
  const seenCompany = new Map<string, number>();
  const byName = <T extends { name: string }>(list: T[], name: string) => list.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase());

  data.forEach((cells, i) => {
    const n = i + 2;
    const values: PreparedRow["values"] = {};
    for (const f of IMPORT_FIELDS) {
      const idx = map[f];
      const v = idx === null || idx === undefined ? "" : (cells[idx] ?? "").trim();
      if (v) values[f] = v;
    }
    const add = (field: ImportField | null, level: Issue["level"], code: IssueCode) => issues.push({ row: n, field, level, code });

    for (const f of REQUIRED_FIELDS) if (!values[f]) add(f, "error", "required");
    if (values.email) {
      values.email = values.email.toLowerCase();
      if (!EMAIL.test(values.email)) add("email", "error", "invalid_email");
    }
    if (values.country_code) {
      values.country_code = values.country_code.toUpperCase();
      if (!isCountryCode(values.country_code)) add("country_code", "error", "invalid_country");
      else if (ZONE_REQUIRED.has(values.country_code) && !values.zone_code) add("zone_code", "error", "zone_required");
    }
    if (values.zone_code) values.zone_code = values.zone_code.toUpperCase();
    if (values.phone && !PHONE.test(values.phone)) {
      add("phone", "warning", "invalid_phone");
      delete values.phone; // Shopify rejects malformed phones; import without it
    }

    let tierId = refs.defaultTierId;
    if (values.tier) {
      const t = byName(refs.tiers, values.tier);
      if (t) tierId = t.id;
      else add("tier", "error", "unknown_tier");
    } else if (!tierId) add("tier", "error", "no_tier");

    let termsId: string | null = null;
    if (values.payment_terms) {
      const t = byName(refs.terms, values.payment_terms);
      if (t) termsId = t.id;
      else add("payment_terms", "warning", "unknown_terms");
    }

    const exemptions = (values.tax_exemptions ?? "").split(/[;|,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    const badEx = exemptions.filter((e) => !refs.exemptionValues.has(e));
    if (badEx.length) add("tax_exemptions", "error", "invalid_exemption");

    if (values.email) {
      if (seenEmail.has(values.email)) add("email", "error", "duplicate_in_file");
      else seenEmail.set(values.email, n);
    }
    if (values.company_name) {
      const k = values.company_name.toLowerCase();
      if (seenCompany.has(k)) add("company_name", "error", "duplicate_in_file");
      else seenCompany.set(k, n);
    }

    const hasError = issues.some((x) => x.row === n && x.level === "error");
    rows.push({ n, values, tierId, paymentTermsTemplateId: termsId, exemptions, status: hasError ? "error" : "ready" });
  });
  return { rows, issues };
}

// ---------------------------------------------------------------------------
// Duplicate detection against Shopify (batched search queries).

const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const BATCH = 20;

export type ExistingOption = "skip" | "link";

/**
 * Mark rows whose company or customer already exists in Shopify.
 * Existing company → skipped (or linked when the merchant chose "link");
 * existing customer → becomes the company contact (warning only).
 */
export async function checkShopify(admin: Admin, shop: string, rows: PreparedRow[], onExisting: ExistingOption): Promise<Issue[]> {
  const issues: Issue[] = [];
  const ready = rows.filter((r) => r.status === "ready");

  for (let i = 0; i < ready.length; i += BATCH) {
    const chunk = ready.slice(i, i + BATCH);
    const emails = chunk.map((r) => r.values.email!).filter(Boolean);
    if (emails.length) {
      const data = await gql(admin, `#graphql
        query ImportCustomers($q: String!, $n: Int!) { customers(first: $n, query: $q) {
          nodes { id defaultEmailAddress { emailAddress } companyContactProfiles { company { id } } } } }`,
      { q: emails.map((e) => `email:${quote(e)}`).join(" OR "), n: 50 });
      for (const c of data.customers.nodes as { id: string; defaultEmailAddress: { emailAddress: string } | null; companyContactProfiles: { company: { id: string } }[] }[]) {
        const email = c.defaultEmailAddress?.emailAddress?.toLowerCase();
        const row = chunk.find((r) => r.values.email === email);
        if (!row) continue;
        row.customerGid = c.id;
        issues.push({ row: row.n, field: "email", level: "warning", code: c.companyContactProfiles.length ? "customer_in_company" : "existing_customer" });
      }
    }
    const names = chunk.map((r) => r.values.company_name!).filter(Boolean);
    if (names.length) {
      const data = await gql(admin, `#graphql
        query ImportCompanies($q: String!, $n: Int!) { companies(first: $n, query: $q) { nodes { id name } } }`,
      { q: names.map((nm) => `name:${quote(nm)}`).join(" OR "), n: 50 });
      for (const co of data.companies.nodes as { id: string; name: string }[]) {
        const row = chunk.find((r) => r.values.company_name?.toLowerCase() === co.name.toLowerCase());
        if (!row) continue;
        row.companyGid = co.id;
        const buyer = await db.buyer.findFirst({ where: { shop, companyGid: co.id }, select: { id: true } });
        if (buyer || onExisting === "skip") {
          row.status = "skip";
          issues.push({ row: row.n, field: "company_name", level: "warning", code: buyer ? "already_buyer" : "existing_company" });
        } else {
          issues.push({ row: row.n, field: "company_name", level: "warning", code: "existing_company" });
        }
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Runs.

export type CsvOptions = { defaultTierId: string | null; onExisting: ExistingOption; sendWelcome: boolean };
export type CsvData = { kind: "csv"; headers: string[]; map: ColumnMap; options: CsvOptions; raw?: string[][]; rows?: PreparedRow[] };
export type TagData = {
  kind: "tag";
  tags: string[];
  tierId: string;
  paymentTermsTemplateId: string | null;
  taxExempt: boolean;
  exemptions: string[];
  sendWelcome: boolean;
  preview: number;
  pageCursor: string | null;
  pageDone: number; // customers handled on the current page (resume inside a page)
};
export type RunData = CsvData | TagData;

export function runData(run: Pick<ImportRun, "mapping">): RunData {
  return run.mapping as unknown as RunData;
}

export class ImportFileError extends Error {
  constructor(readonly code: "too_large" | "too_many_rows" | "empty" | "no_header") {
    super(code);
  }
}

/** Parse an uploaded CSV into a draft run. */
export async function createCsvRun(shop: string, text: string): Promise<ImportRun> {
  if (Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES) throw new ImportFileError("too_large");
  const all = parseCsv(text);
  if (all.length < 2) throw new ImportFileError(all.length ? "empty" : "no_header");
  if (all.length - 1 > MAX_ROWS) throw new ImportFileError("too_many_rows");
  const [headers, ...raw] = all;
  const data: CsvData = { kind: "csv", headers, map: guessMapping(headers), options: { defaultTierId: null, onExisting: "skip", sendWelcome: false }, raw };
  return db.importRun.create({ data: { shop, kind: "csv", state: "draft", mapping: data as object, total: raw.length } });
}

export async function getRun(shop: string, id: string): Promise<ImportRun | null> {
  return db.importRun.findFirst({ where: { shop, id } });
}

/** Dry run: validate every row and check Shopify for duplicates. Nothing is created. */
export async function validateCsvRun(
  admin: Admin, shop: string, id: string, map: ColumnMap, options: CsvOptions, refs: Omit<ValidationRefs, "defaultTierId">,
): Promise<{ run: ImportRun; issues: Issue[] }> {
  const run = await getRun(shop, id);
  if (!run || !["draft", "validated"].includes(run.state)) throw new Error("run_not_editable");
  const data = runData(run) as CsvData;
  const raw = data.raw ?? [];
  const { rows, issues } = validateRows(raw, map, { ...refs, defaultTierId: options.defaultTierId });
  issues.push(...(await checkShopify(admin, shop, rows, options.onExisting)));
  issues.sort((a, b) => a.row - b.row);
  const next: CsvData = { ...data, map, options, rows };
  const updated = await db.importRun.update({
    where: { id: run.id },
    data: { state: "validated", mapping: next as object, errors: issues as object, total: rows.filter((r) => r.status === "ready").length, done: 0, cursor: 0 },
  });
  return { run: updated, issues };
}

export function summarize(run: Pick<ImportRun, "mapping" | "errors">) {
  const data = runData(run);
  const issues = (run.errors ?? []) as Issue[];
  const rows = data.kind === "csv" ? data.rows ?? [] : [];
  return {
    ready: rows.filter((r) => r.status === "ready").length,
    errors: rows.filter((r) => r.status === "error").length,
    skipped: rows.filter((r) => r.status === "skip").length,
    warnings: new Set(issues.filter((i) => i.level === "warning").map((i) => i.row)).size,
  };
}

export async function startRun(shop: string, id: string, actor: string): Promise<boolean> {
  const res = await db.importRun.updateMany({ where: { shop, id, state: { in: ["validated", "draft"] }, kind: { in: ["csv", "tag"] } }, data: { state: "running" } });
  if (res.count) await logActivity({ shop, actor, action: "import.start", subject: id });
  return res.count > 0;
}

export async function cancelRun(shop: string, id: string, actor: string): Promise<void> {
  const run = await getRun(shop, id);
  if (!run || run.state === "done") return;
  await finish(run, "failed");
  await logActivity({ shop, actor, action: "import.cancel", subject: id });
}

/** Close a run and drop row data (personal data must not outlive the import). */
async function finish(run: ImportRun, state: "done" | "failed") {
  const data = runData(run);
  const slim = data.kind === "csv" ? { kind: "csv", headers: [], map: data.map, options: data.options } : { ...data, pageCursor: null };
  await db.importRun.update({ where: { id: run.id }, data: { state, mapping: slim as object } });
}

/** Error report rows: line, column, level, message (no personal data, the merchant has the file). */
export function errorReportCsv(issues: Issue[], label: { message: (i: Issue) => string; level: (i: Issue) => string }, header: string[]): string {
  const lines = [header.map(csvCell).join(",")];
  for (const i of issues) lines.push([i.row, i.field ?? "", label.level(i), label.message(i)].map(csvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------------------
// Processing.

function addressFrom(v: PreparedRow["values"]): Address {
  return {
    firstName: v.first_name, lastName: v.last_name, company: v.company_name,
    address1: v.address1 ?? "", address2: v.address2, city: v.city ?? "", zoneCode: v.zone_code, zip: v.zip,
    countryCode: v.country_code ?? "", phone: v.phone,
  };
}

export type ProcessDeps = { create?: typeof createBuyerFromInput };

/**
 * Create one buyer. createBuyerFromInput is idempotent (Shopify objects carry an
 * externalId derived from company name + email), so a row interrupted mid-way
 * is simply run again on resume.
 */
async function processCsvRow(admin: Admin, shop: string, row: PreparedRow, options: CsvOptions, create: typeof createBuyerFromInput): Promise<void> {
  const v = row.values;
  const input: ApproveInput & { source: "import"; existingCompanyGid?: string } = {
    tierId: row.tierId!,
    paymentTermsTemplateId: row.paymentTermsTemplateId,
    taxExempt: row.exemptions.length > 0,
    exemptions: row.exemptions,
    taxRegistrationId: v.tax_registration_id ?? null,
    companyName: v.company_name!,
    locationName: v.location_name ?? v.company_name!,
    billingAddress: addressFrom(v),
    shippingAddress: null,
    contact: row.customerGid
      ? { mode: "existing", customerGid: row.customerGid }
      : { mode: "new", email: v.email, firstName: v.first_name, lastName: v.last_name, phone: v.phone },
    sendWelcome: options.sendWelcome,
    source: "import",
    ...(options.onExisting === "link" && row.companyGid ? { existingCompanyGid: row.companyGid } : {}),
  };
  await create({ admin, shop, actor: "import" }, input);
}

/** Error text from the approval engine may echo Shopify input, so only the failing step is logged. */
function failedStep(e: unknown): string {
  return String((e as { step?: string }).step ?? (e as Error).name ?? "error").slice(0, 40);
}

/**
 * Process a running import until `deadline`. Safe to call from several places
 * at once (per-run lock) and to stop at any moment: progress is saved after
 * every row and the cursor is the resume point.
 */
export async function processImportRun(admin: Admin, shop: string, id: string, deadline: number, deps: ProcessDeps = {}): Promise<number> {
  const create = deps.create ?? createBuyerFromInput;
  const lockName = `import:${id}`;
  const holder = await tryLock(shop, lockName, 5 * 60_000);
  if (!holder) return 0;
  let processed = 0;
  try {
    let run = await getRun(shop, id);
    if (!run || run.state !== "running") return 0;
    if (run.kind === "tag") return await processTagRun(admin, run, deadline, create);

    const data = runData(run) as CsvData;
    const rows = data.rows ?? [];
    const issues = (run.errors ?? []) as Issue[];
    let { cursor, done } = run;
    while (cursor < rows.length && Date.now() + ROW_MARGIN_MS < deadline) {
      const row = rows[cursor];
      if (row.status === "ready" || row.status === "started") {
        // Mark before calling Shopify, so an interruption is detected on resume.
        if (row.status === "ready") {
          row.status = "started";
          await db.importRun.update({ where: { id }, data: { mapping: { ...data, rows } as object } });
        }
        let issue: Issue | null = null;
        try {
          await processCsvRow(admin, shop, row, data.options, create);
        } catch (e) {
          const step = failedStep(e);
          issue = { row: row.n, field: null, level: "error", code: (e as { step?: string }).step ? "step_failed" : "failed" };
          await logActivity({ shop, actor: "import", action: "import.row", subject: id, result: "failed", detail: { row: row.n, step } }).catch(() => undefined);
        }
        row.status = issue ? "failed" : "done";
        if (issue) issues.push(issue);
        done++;
        processed++;
      }
      cursor++;
      run = await db.importRun.update({ where: { id }, data: { cursor, done, errors: issues as object, mapping: { ...data, rows } as object } });
    }
    if (cursor >= rows.length) {
      await finish(run, "done");
      const failed = rows.filter((r) => r.status === "failed").length;
      await logActivity({ shop, actor: "import", action: "import.done", subject: id, result: failed ? "failed" : "ok", detail: { done, failed } });
    }
    return processed;
  } finally {
    await unlock(shop, lockName, holder);
  }
}

// ---------------------------------------------------------------------------
// Tag conversion.

export function tagQuery(tags: string[]): string {
  return tags.map((t) => `tag:${quote(t)}`).join(" OR ");
}

/** Customers with the tags (up to 5,000 counted), for the preview. */
export async function previewTagCount(admin: Admin, tags: string[]): Promise<{ count: number; capped: boolean }> {
  let count = 0;
  let after: string | null = null;
  do {
    const data: { customers: { nodes: { id: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await gql(admin, `#graphql
      query ImportTagCount($q: String!, $after: String) { customers(first: 250, after: $after, query: $q) { nodes { id } pageInfo { hasNextPage endCursor } } }`,
    { q: tagQuery(tags), after });
    count += data.customers.nodes.length;
    after = data.customers.pageInfo.hasNextPage ? data.customers.pageInfo.endCursor : null;
  } while (after && count < 5000);
  return { count, capped: Boolean(after) };
}

export async function createTagRun(shop: string, opts: Omit<TagData, "kind" | "pageCursor" | "pageDone">): Promise<ImportRun> {
  const data: TagData = { kind: "tag", ...opts, pageCursor: null, pageDone: 0 };
  return db.importRun.create({ data: { shop, kind: "tag", state: "validated", mapping: data as object, total: opts.preview } });
}

const TAG_PAGE = 10;
type TagCustomer = {
  id: string;
  displayName: string;
  companyContactProfiles: { id: string }[];
  defaultAddress: { firstName: string | null; lastName: string | null; company: string | null; address1: string | null; address2: string | null; city: string | null; provinceCode: string | null; zip: string | null; countryCodeV2: string | null; phone: string | null } | null;
};

async function processTagRun(admin: Admin, run: ImportRun, deadline: number, create: typeof createBuyerFromInput): Promise<number> {
  const shop = run.shop;
  const data = runData(run) as TagData;
  const issues = (run.errors ?? []) as Issue[];
  let { cursor, done } = run;
  let processed = 0;
  while (Date.now() + ROW_MARGIN_MS < deadline) {
    const page = await gql(admin, `#graphql
      query ImportTagPage($q: String!, $n: Int!, $after: String) { customers(first: $n, after: $after, query: $q) {
        nodes { id displayName companyContactProfiles { id }
          defaultAddress { firstName lastName company address1 address2 city provinceCode zip countryCodeV2 phone } }
        pageInfo { hasNextPage endCursor } } }`,
    { q: tagQuery(data.tags), n: TAG_PAGE, after: data.pageCursor });
    const nodes = page.customers.nodes as TagCustomer[];
    for (let i = data.pageDone; i < nodes.length; i++) {
      if (Date.now() + ROW_MARGIN_MS >= deadline) break;
      const c = nodes[i];
      cursor++;
      const n = cursor;
      // Already a company contact (including ones this run created before an interruption): skip.
      if (c.companyContactProfiles.length) {
        issues.push({ row: n, field: null, level: "warning", code: "customer_in_company" });
      } else if (!c.defaultAddress?.address1 || !c.defaultAddress.city || !c.defaultAddress.countryCodeV2) {
        issues.push({ row: n, field: null, level: "error", code: "no_address" });
      } else {
        const a = c.defaultAddress;
        const companyName = a.company?.trim() || c.displayName;
        try {
          await create({ admin, shop, actor: "import" }, {
            tierId: data.tierId,
            paymentTermsTemplateId: data.paymentTermsTemplateId,
            taxExempt: data.taxExempt,
            exemptions: data.exemptions,
            taxRegistrationId: null,
            companyName,
            locationName: companyName,
            billingAddress: {
              firstName: a.firstName ?? undefined, lastName: a.lastName ?? undefined, company: a.company ?? undefined,
              address1: a.address1!, address2: a.address2 ?? undefined, city: a.city!, zoneCode: a.provinceCode ?? undefined,
              zip: a.zip ?? undefined, countryCode: a.countryCodeV2!, phone: a.phone ?? undefined,
            },
            shippingAddress: null,
            contact: { mode: "existing", customerGid: c.id },
            sendWelcome: data.sendWelcome,
            source: "tag",
          });
          done++;
        } catch (e) {
          issues.push({ row: n, field: null, level: "error", code: (e as { step?: string }).step ? "step_failed" : "failed" });
          await logActivity({ shop, actor: "import", action: "import.row", subject: run.id, result: "failed", detail: { row: n, step: failedStep(e) } }).catch(() => undefined);
        }
      }
      processed++;
      data.pageDone = i + 1;
      run = await db.importRun.update({ where: { id: run.id }, data: { cursor, done, errors: issues as object, mapping: data as object } });
    }
    if (data.pageDone < nodes.length) return processed; // out of time inside this page
    if (!page.customers.pageInfo.hasNextPage) {
      await finish(run, "done");
      await logActivity({ shop, actor: "import", action: "import.done", subject: run.id, detail: { done, issues: issues.length } });
      return processed;
    }
    data.pageCursor = page.customers.pageInfo.endCursor;
    data.pageDone = 0;
    run = await db.importRun.update({ where: { id: run.id }, data: { mapping: data as object } });
  }
  return processed;
}
