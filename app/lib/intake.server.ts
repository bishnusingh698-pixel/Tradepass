// Applicant intake (feature spec §D): validate a storefront submission against
// the merchant's form, stop spam quietly, detect duplicates, encrypt the tax
// number, check it against a free registry, store the application, then fire
// the follow-ups (emails, Flow, rules) without ever failing the submission.
// Called by the app proxy routes (app/routes/proxy.*). Nothing here logs
// personal data.
import { Prisma } from "@prisma/client";
import db from "../db.server";
import { logActivity } from "./activity.server";
import { encrypt, sha256 } from "./crypto.server";
import { normaliseTaxNumber } from "./applications.server";
import { readDefinition } from "./forms.server";
import type { FormDefinition, FormField } from "./form-defaults";
import { hashKey, hit, LIMITS, looksLikeBot, peek } from "./spam.server";
import { checkTaxNumber as realCheckTax, type TaxCheck } from "./taxcheck.server";
import { MAX_UPLOAD_FILES, verifyFileRef } from "./uploads.server";
import type { Admin } from "./gql.server";

export type IntakeDeps = {
  getAdmin: (shop: string) => Promise<Admin | null>;
  checkTaxNumber: (country: string, number: string) => Promise<TaxCheck>;
  queueEmail: (input: import("./email/index.server").QueueEmailInput) => Promise<unknown>;
  notifyMerchant: (shop: string, a: { applicationId: string; company: string }) => Promise<unknown>;
  emitFlowTrigger: typeof import("./flow.server").emitFlowTrigger;
  evaluateRules: typeof import("./rules.server").evaluateRules;
  recordApplicationCertificates: typeof import("./certificates.server").recordApplicationCertificates;
};

/** Real dependencies, loaded lazily so tests and the proxy loader stay light. */
export const defaultDeps: IntakeDeps = {
  getAdmin: async (shop) => {
    try {
      const { unauthenticated } = await import("../shopify.server");
      return (await unauthenticated.admin(shop)).admin;
    } catch {
      return null; // no offline session (e.g. mid-reinstall): skip Admin follow-ups
    }
  },
  checkTaxNumber: (c, n) => realCheckTax(c, n),
  queueEmail: async (i) => (await import("./email/index.server")).queueEmail(i),
  notifyMerchant: async (s, a) => (await import("./email/index.server")).notifyMerchantNewApplication(s, a),
  emitFlowTrigger: async (...a) => (await import("./flow.server")).emitFlowTrigger(...a),
  evaluateRules: async (...a) => (await import("./rules.server")).evaluateRules(...a),
  recordApplicationCertificates: async (...a) => (await import("./certificates.server")).recordApplicationCertificates(...a),
};

export type IntakeContext = { shop: string; loggedInCustomerId: string | null; ip: string };

export type IntakeResponse =
  | { http: 200; body: { ok: true; status: "received" | "duplicate"; id?: string } }
  | { http: 400; body: { ok: false; error?: string; errors?: Record<string, string> } }
  | { http: 429; body: { ok: false; error: "rate_limited" } };

const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;
const LOCALE_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/;
const URL_RE = /^(https?:\/\/)?[^\s.<>"]+\.[^\s<>"]{2,}$/i;
const PHONE_RE = /^\+?[\d\s().-]{6,20}$/;
const NUMBER_RE = /^-?\d+([.,]\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const MAX = { text: 255, textarea: 5000 } as const;

type Json = Record<string, unknown>;
type FileAnswer = { fileGid: string; name: string; expiresOn: string | null };
type Clean = {
  answers: Json;
  errors: Record<string, string>;
  tax: { country: string; number: string; region: string } | null;
  files: Record<string, FileAnswer[]>;
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max + 1) : "");
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Whether a field is shown, given the submitted values (mirrors the storefront renderer). */
export function fieldVisible(def: FormDefinition, f: FormField, values: Json): boolean {
  if (f.state === "hidden") return false;
  if (!f.showIf) return true;
  const other = def.sections.flatMap((s) => s.fields).find((x) => x.id === f.showIf!.field);
  if (other && !fieldVisible(def, other, values)) return false;
  const v = values[f.showIf.field];
  return Array.isArray(v) ? v.includes(f.showIf.equals) : v === f.showIf.equals;
}

function cleanAddress(v: unknown, f: FormField): { value: Json | null; error: string | null } {
  if (f.id === "shippingAddress" && isObj(v) && v.same === true) return { value: { same: true }, error: null };
  const a = isObj(v) ? v : {};
  const out: Json = {};
  for (const k of ["address1", "address2", "city", "zoneCode", "zip", "company"]) {
    const s = str(a[k], 255);
    if (s.length > 255) return { value: null, error: "form.error.too_long" };
    if (s) out[k] = s;
  }
  const cc = str(a.countryCode, 2).toUpperCase();
  if (COUNTRY_RE.test(cc)) out.countryCode = cc;
  const any = Object.keys(out).length > 0;
  if (f.state === "required" || any) {
    if (!out.countryCode || !out.address1 || !out.city) return { value: null, error: "form.error.required" };
  }
  return { value: any ? out : null, error: null };
}

/** Validate submitted answers against the form; returns cleaned answers and error message keys per field. */
export function cleanAnswers(def: FormDefinition, raw: unknown, shop: string): Clean {
  const input = isObj(raw) ? raw : {};
  const out: Clean = { answers: {}, errors: {}, tax: null, files: {} };
  // First pass: plain values for showIf (choice fields only drive conditions).
  const values: Json = {};
  for (const f of def.sections.flatMap((s) => s.fields)) values[f.id] = input[f.id];

  for (const f of def.sections.flatMap((s) => s.fields)) {
    if (!fieldVisible(def, f, values)) continue;
    const v = input[f.id];
    const required = f.state === "required";
    const fail = (key: string) => {
      out.errors[f.id] = key;
    };
    switch (f.type) {
      case "address": {
        const r = cleanAddress(v, f);
        if (r.error) fail(r.error);
        else if (r.value) out.answers[f.id] = r.value;
        break;
      }
      case "country_tax": {
        const t = isObj(v) ? v : {};
        const number = str(t.number, 40);
        if (number.length > 40) { fail("form.error.too_long"); break; }
        if (!number) { if (required) fail("form.error.required"); break; }
        const country = str(t.country, 2).toUpperCase();
        const region = str(t.region, 3).toUpperCase();
        out.tax = { country: COUNTRY_RE.test(country) ? country : "", number, region: /^[A-Z]{2,3}$/.test(region) ? region : "" };
        out.answers[f.id] = { country: out.tax.country, region: out.tax.region || undefined }; // the number itself is encrypted, never in answers
        break;
      }
      case "file": {
        const list = Array.isArray(v) ? v.slice(0, MAX_UPLOAD_FILES + 1) : [];
        if (list.length > MAX_UPLOAD_FILES) { fail("form.error.file_count"); break; }
        const files: FileAnswer[] = [];
        for (const item of list) {
          const gid = isObj(item) ? verifyFileRef(item.ref, shop) : null;
          if (!gid) continue; // expired or forged reference: drop silently
          const exp = isObj(item) ? str(item.expiresOn, 10) : "";
          files.push({ fileGid: gid, name: isObj(item) ? str(item.name, 120).replace(/[<>]/g, "") : "", expiresOn: DATE_RE.test(exp) ? exp : null });
        }
        if (!files.length) { if (required) fail("form.error.required"); break; }
        out.files[f.id] = files;
        out.answers[f.id] = files.map((x) => ({ fileGid: x.fileGid, name: x.name, expiresOn: x.expiresOn }));
        break;
      }
      case "consent": {
        if (v === true) out.answers[f.id] = true;
        else if (required) fail("form.error.consent");
        break;
      }
      case "checkboxes": {
        const allowed = new Set((f.options ?? []).map((o) => o.value));
        const picked = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && allowed.has(x)) : [];
        if (picked.length) out.answers[f.id] = [...new Set(picked)];
        else if (required) fail("form.error.choose");
        break;
      }
      case "select": {
        const s = str(v, 60);
        if (!s) { if (required) fail("form.error.choose"); break; }
        const ok = f.id === "preferredLanguage" && !(f.options ?? []).length ? LOCALE_RE.test(s) : (f.options ?? []).some((o) => o.value === s);
        if (ok) out.answers[f.id] = s;
        else fail("form.error.choose");
        break;
      }
      default: {
        const max = f.type === "textarea" ? MAX.textarea : MAX.text;
        const s = str(v, max);
        if (!s) { if (required) fail("form.error.required"); break; }
        if (s.length > max) { fail("form.error.too_long"); break; }
        if (f.type === "email" && !EMAIL_RE.test(s)) { fail("form.error.email"); break; }
        if (f.type === "url" && !URL_RE.test(s)) { fail("form.error.url"); break; }
        if (f.type === "phone" && !PHONE_RE.test(s)) { fail("form.error.phone"); break; }
        if (f.type === "number" && !NUMBER_RE.test(s)) { fail("form.error.number"); break; }
        if (f.type === "date" && (!DATE_RE.test(s) || isNaN(Date.parse(s)))) { fail("form.error.date"); break; }
        out.answers[f.id] = f.type === "email" ? s.toLowerCase() : s;
      }
    }
  }
  return out;
}

function spamAnswerOk(def: FormDefinition, locale: string, given: unknown): boolean {
  const sq = def.spamQuestion;
  if (!sq?.enabled) return true;
  const answers = Object.values(sq.texts ?? {}).map((t) => t?.answer).filter((a): a is string => Boolean(a?.trim()));
  if (!answers.length) return true;
  const g = typeof given === "string" ? given.trim().toLowerCase() : "";
  const own = sq.texts?.[locale]?.answer ?? sq.texts?.[locale.split("-")[0]]?.answer;
  const accepted = own ? [own, ...answers] : answers;
  return accepted.some((a) => a.trim().toLowerCase() === g);
}

async function loadForm(shop: string, formId: unknown) {
  const id = typeof formId === "string" && formId.length < 40 ? formId : null;
  const row =
    (id ? await db.form.findFirst({ where: { shop, id } }) : null) ??
    (await db.form.findFirst({ where: { shop }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }));
  return row ? { id: row.id, suggestedTierId: row.suggestedTierId, definition: readDefinition(row.definition) } : null;
}

async function existingResponse(shop: string, idempotencyKey: string): Promise<IntakeResponse | null> {
  const prev = await db.application.findUnique({
    where: { shop_idempotencyKey: { shop, idempotencyKey } },
    select: { id: true, flags: true, email: true, companyName: true, answers: true, submittedAt: true },
  });
  if (!prev) return null;
  let dup = false;
  if (prev.flags.includes("duplicate")) {
    const taxHash = isObj(prev.answers) && typeof prev.answers.taxNumberHash === "string" ? prev.answers.taxNumberHash : null;
    const earlier = await findDuplicates(shop, prev.email, prev.companyName, taxHash, prev.submittedAt);
    dup = earlier.some((d) => d.id !== prev.id && OPEN.includes(d.status));
  }
  return { http: 200, body: { ok: true, status: dup ? "duplicate" : "received", id: prev.id } };
}

const OPEN = ["pending", "needs_info", "approved"];

/** Same email, same company name or same tax number among this shop's earlier applications. */
async function findDuplicates(shop: string, email: string, companyName: string, taxHash: string | null, before?: Date) {
  const or: Prisma.ApplicationWhereInput[] = [];
  if (email) or.push({ email });
  if (companyName) or.push({ companyName: { equals: companyName, mode: "insensitive" } });
  if (taxHash) or.push({ answers: { path: ["taxNumberHash"], equals: taxHash } });
  return db.application.findMany({
    where: { shop, status: { not: "withdrawn" }, OR: or, ...(before ? { submittedAt: { lt: before } } : {}) },
    select: { id: true, status: true },
    take: 5,
  });
}

/** Handle POST /proxy/submit. Idempotent on (shop, idempotencyKey). */
export async function handleSubmit(ctx: IntakeContext, raw: unknown, deps: IntakeDeps = defaultDeps): Promise<IntakeResponse> {
  const body = isObj(raw) ? raw : {};
  const key = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  if (!KEY_RE.test(key)) return { http: 400, body: { ok: false, error: "bad_request" } };
  const { shop } = ctx;

  // A retry of a submission we already stored: answer exactly as before, no new hits.
  const replay = await existingResponse(shop, key);
  if (replay) return replay;

  const ipKey = hashKey("ip", ctx.ip);
  // Bots: pretend success, store nothing. Repeat offenders get the same silent treatment.
  if (looksLikeBot(body) || (await peek(`spam:${ipKey}`)) >= LIMITS.spamPerIp) {
    await hit(`spam:${ipKey}`, LIMITS.spamPerIp);
    return { http: 200, body: { ok: true, status: "received" } };
  }
  if (!(await hit(`submit:${ipKey}`, LIMITS.submitPerIp)).allowed) return { http: 429, body: { ok: false, error: "rate_limited" } };

  const form = await loadForm(shop, body.formId);
  if (!form) return { http: 400, body: { ok: false, error: "no_form" } };
  const locale = typeof body.locale === "string" && LOCALE_RE.test(body.locale) ? body.locale : "en";

  if (!spamAnswerOk(form.definition, locale, body.spam)) return { http: 400, body: { ok: false, errors: { spam: "form.error.spam" } } };

  const clean = cleanAnswers(form.definition, body.answers, shop);
  if (Object.keys(clean.errors).length) return { http: 400, body: { ok: false, errors: clean.errors } };

  const email = typeof clean.answers.email === "string" ? clean.answers.email : "";
  if (email && !(await hit(`submit:${hashKey("email", email)}`, LIMITS.submitPerEmail)).allowed) {
    return { http: 429, body: { ok: false, error: "rate_limited" } };
  }
  const companyName = typeof clean.answers.companyName === "string" ? clean.answers.companyName : "";
  const billing = isObj(clean.answers.billingAddress) ? clean.answers.billingAddress : {};
  const countryCode = (billing.countryCode as string | undefined) ?? clean.tax?.country ?? null;

  let taxNumberEnc: string | null = null;
  let taxHash: string | null = null;
  let taxCheck: TaxCheck = { status: "na" };
  if (clean.tax) {
    taxNumberEnc = encrypt(clean.tax.number);
    taxHash = sha256(normaliseTaxNumber(clean.tax.number));
    clean.answers.taxNumberHash = taxHash;
    taxCheck = await deps.checkTaxNumber(clean.tax.country || countryCode || "", clean.tax.number).catch(() => ({ status: "unavailable" as const }));
  }
  const certs = clean.files.certificates ?? [];
  if (certs.length) clean.answers.certificateMeta = certs.map((c) => ({ fileGid: c.fileGid, expiresOn: c.expiresOn }));

  const dups = email || companyName || taxHash ? await findDuplicates(shop, email, companyName, taxHash) : [];
  const flags: string[] = [];
  if (dups.length) flags.push("duplicate");
  // The applicant hears "You've already applied" only while an earlier one is open or approved.
  const tellApplicant = dups.some((d) => OPEN.includes(d.status));

  let app: { id: string };
  try {
    app = await db.application.create({
      data: {
        shop,
        formId: form.id,
        idempotencyKey: key,
        companyName,
        email,
        countryCode,
        businessType: typeof clean.answers.businessType === "string" ? clean.answers.businessType : null,
        locale,
        customerGid: ctx.loggedInCustomerId && /^\d+$/.test(ctx.loggedInCustomerId) ? `gid://shopify/Customer/${ctx.loggedInCustomerId}` : null,
        answers: clean.answers as Prisma.InputJsonObject,
        taxNumberEnc,
        taxCheck: taxCheck.status,
        taxCheckName: taxCheck.name ?? null,
        flags,
        suggestedTierId: form.suggestedTierId,
        ipHash: ipKey,
      },
      select: { id: true },
    });
  } catch (e) {
    // Two copies of the same submission raced: the first one wins, both get its answer.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await existingResponse(shop, key);
      if (again) return again;
    }
    throw e;
  }

  const allFiles = Object.entries(clean.files).flatMap(([field, list]) => list.map((f) => ({ field, ...f })));
  if (allFiles.length) {
    await db.applicationFile.createMany({
      data: allFiles.map((f) => ({ shop, applicationId: app.id, fileGid: f.fileGid, kind: f.field === "certificates" ? "certificate" : "other" })),
    });
  }
  await logActivity({
    shop, actor: "applicant", action: "application.submitted", subject: app.id,
    detail: { duplicate: flags.includes("duplicate"), taxCheck: taxCheck.status, files: allFiles.length },
  }).catch(() => undefined);

  await afterSubmit(ctx, deps, {
    id: app.id, email, companyName, locale, countryCode, tellApplicant,
    firstName: typeof clean.answers.firstName === "string" ? clean.answers.firstName : "",
    certificates: certs, tax: clean.tax,
  });

  return { http: 200, body: { ok: true, status: tellApplicant ? "duplicate" : "received", id: app.id } };
}

type Submitted = {
  id: string; email: string; companyName: string; locale: string; countryCode: string | null; tellApplicant: boolean;
  firstName: string; certificates: FileAnswer[]; tax: Clean["tax"];
};

/** Follow-ups never fail the submission; each is isolated. */
async function afterSubmit(ctx: IntakeContext, deps: IntakeDeps, a: Submitted) {
  const { shop } = ctx;
  const safe = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      await logActivity({ shop, actor: "system", action: `application.${what}`, subject: a.id, result: "failed", detail: { error: (e as Error).name } }).catch(() => undefined);
    }
  };
  await safe("certificates", async () => {
    if (!a.certificates.length) return;
    const t = a.tax;
    const resale = t?.country === "US";
    await deps.recordApplicationCertificates(shop, a.id, a.certificates.map((c) => ({
      fileGid: c.fileGid,
      type: resale ? "resale" : "other",
      country: t?.country || a.countryCode,
      region: t?.region || null,
      number: resale ? t?.number ?? null : null,
      expiresOn: c.expiresOn,
    })));
  });
  const shopRow = await db.shop.findUnique({ where: { shop }, select: { name: true } });
  if (!a.tellApplicant && a.email) {
    await safe("email_received", () => deps.queueEmail({
      shop, type: "received", to: a.email, locale: a.locale,
      vars: { company: a.companyName, first_name: a.firstName, store_name: shopRow?.name ?? shop },
      subjectId: a.id,
    }));
  }
  await safe("notify_merchant", () => deps.notifyMerchant(shop, { applicationId: a.id, company: a.companyName }));
  const admin = await deps.getAdmin(shop);
  if (admin) {
    await safe("flow", () => deps.emitFlowTrigger(admin, shop, "application_submitted", {
      applicationId: a.id, companyName: a.companyName, contactEmail: a.email, country: a.countryCode ?? undefined,
    }));
    await safe("rules", () => deps.evaluateRules(admin, shop, a.id));
  }
}

// ---------------------------------------------------------------- needs info

export type UpdateContext = { shop: string; ip: string };

/** Keep only the requested fields of a form, for the hosted "more info" page. */
export function requestedDefinition(def: FormDefinition, fields: string[]): FormDefinition {
  const want = new Set(fields);
  return {
    ...def,
    sections: def.sections
      .map((s) => ({ ...s, fields: s.fields.filter((f) => want.has(f.id)).map((f) => ({ ...f, showIf: undefined, state: f.state === "hidden" ? "optional" as const : f.state })) }))
      .filter((s) => s.fields.length),
    spamQuestion: { enabled: false, texts: {} },
  };
}

/**
 * Apply the applicant's answers to the requested fields. The caller has already
 * claimed the single-use token. Re-encrypts and re-checks the tax number and
 * attaches new certificates.
 */
export async function applyUpdate(
  ctx: UpdateContext,
  applicationId: string,
  raw: unknown,
  deps: Pick<IntakeDeps, "checkTaxNumber" | "recordApplicationCertificates"> = defaultDeps,
): Promise<{ ok: true } | { ok: false; errors: Record<string, string> } | { ok: false; error: "not_found" }> {
  const { shop } = ctx;
  const app = await db.application.findFirst({ where: { shop, id: applicationId } });
  if (!app) return { ok: false, error: "not_found" };
  const fields = ((app.requested as { fields?: string[] } | null)?.fields ?? []).filter((x) => typeof x === "string");
  const form = await loadForm(shop, app.formId);
  if (!form) return { ok: false, error: "not_found" };
  const def = requestedDefinition(form.definition, fields);
  const body = isObj(raw) ? raw : {};
  const clean = cleanAnswers(def, body.answers, shop);
  if (Object.keys(clean.errors).length) return { ok: false, errors: clean.errors };

  const answers: Json = { ...(isObj(app.answers) ? app.answers : {}), ...clean.answers };
  const data: Prisma.ApplicationUpdateInput = { status: "pending" };
  if (clean.tax) {
    answers.taxNumberHash = sha256(normaliseTaxNumber(clean.tax.number));
    data.taxNumberEnc = encrypt(clean.tax.number);
    const check = await deps.checkTaxNumber(clean.tax.country || app.countryCode || "", clean.tax.number).catch(() => ({ status: "unavailable" as const, name: undefined }));
    data.taxCheck = check.status;
    data.taxCheckName = check.name ?? null;
  }
  if (typeof clean.answers.companyName === "string") data.companyName = clean.answers.companyName;
  if (typeof clean.answers.businessType === "string") data.businessType = clean.answers.businessType;
  const billing = clean.answers.billingAddress;
  if (isObj(billing) && typeof billing.countryCode === "string") data.countryCode = billing.countryCode;
  // Email stays as submitted: changing it via a link would let anyone holding the link redirect the account.
  if ("email" in clean.answers) delete answers.email;

  const certs = clean.files.certificates ?? [];
  if (certs.length) {
    const prev = Array.isArray(answers.certificateMeta) ? (answers.certificateMeta as Json[]) : [];
    answers.certificateMeta = [...prev, ...certs.map((c) => ({ fileGid: c.fileGid, expiresOn: c.expiresOn }))];
  }
  data.answers = answers as Prisma.InputJsonObject;
  await db.application.update({ where: { id: app.id }, data });

  const allFiles = Object.entries(clean.files).flatMap(([field, list]) => list.map((f) => ({ field, ...f })));
  if (allFiles.length) {
    await db.applicationFile.createMany({
      data: allFiles.map((f) => ({ shop, applicationId: app.id, fileGid: f.fileGid, kind: f.field === "certificates" ? "certificate" : "other" })),
    });
  }
  if (certs.length) {
    const taxAns = isObj(answers.taxNumber) ? answers.taxNumber : {};
    await deps.recordApplicationCertificates(shop, app.id, certs.map((c) => ({
      fileGid: c.fileGid, type: taxAns.country === "US" ? "resale" : "other",
      country: (taxAns.country as string) || app.countryCode, region: (taxAns.region as string) || null, expiresOn: c.expiresOn,
    }))).catch(() => undefined);
  }
  await logActivity({ shop, actor: "applicant", action: "application.updated", subject: app.id, detail: { fields: Object.keys(clean.answers) } }).catch(() => undefined);
  return { ok: true };
}

// ---------------------------------------------------------------- proxy plumbing

/**
 * Every /proxy/* request: verify Shopify's app proxy signature (and timestamp)
 * with our own helper rather than authenticate.public.appProxy, because the
 * routes must answer with plain JSON/HTML and must not need a session for the
 * signature check. Returns null when the request is not from Shopify or the
 * shop is not (or no longer) installed.
 */
export async function proxyContext(request: Request) {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return null;
  const ctx = (await import("./proxy.server")).verifyProxyRequest(new URL(request.url), secret);
  if (!ctx) return null;
  const shop = await db.shop.findUnique({ where: { shop: ctx.shop }, select: { uninstalledAt: true } });
  if (!shop || shop.uninstalledAt) return null;
  return ctx;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/** Read a JSON body with a size cap (the form never sends more than a few KB). */
export async function readJsonBody(request: Request, maxBytes = 200_000): Promise<unknown> {
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > maxBytes) return null;
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
