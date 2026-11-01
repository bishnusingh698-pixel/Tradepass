import type { Prisma } from "@prisma/client";
import db from "../db.server";
import { logActivity } from "./activity.server";
import { decrypt, sha256, signToken } from "./crypto.server";
import { emitFlowTrigger } from "./flow.server";
import { buildMessage, type ApplicantMessage } from "./messages";
import { readSettings } from "./settings";
import type { Admin } from "./gql.server";
import { storefrontUrl } from "./shop.server";
import { LockBusyError, withApplicationLock } from "./lock.server";

// Merchant-side reads and decisions on applications (queue, detail, reject,
// needs info, notes). Intake lives in intake.server.ts; approval in
// approval.server.ts.

import { TABS, type Tab } from "./applications";
export { TABS, type Tab };
export const PAGE_SIZE = 25;
export const MORE_INFO_DAYS = 14;

export type QueueFilters = {
  tab: Tab;
  q?: string;
  country?: string;
  businessType?: string;
  formId?: string;
  taxCheck?: string;
  hasCertificate?: "yes" | "no";
  flag?: string;
  /** "incomplete": an approval started and stopped part-way (needs Retry or Undo). */
  approval?: "incomplete";
  from?: string; // YYYY-MM-DD
  to?: string;
  sort?: "newest" | "oldest" | "company";
  page?: number;
};

export function parseFilters(url: URL): QueueFilters {
  const p = url.searchParams;
  const tab = (TABS as readonly string[]).includes(p.get("tab") ?? "") ? (p.get("tab") as Tab) : "pending";
  const sort = p.get("sort");
  return {
    tab,
    q: p.get("q")?.trim() || undefined,
    country: p.get("country") || undefined,
    businessType: p.get("businessType") || undefined,
    formId: p.get("formId") || undefined,
    taxCheck: p.get("taxCheck") || undefined,
    hasCertificate: p.get("hasCertificate") === "yes" ? "yes" : p.get("hasCertificate") === "no" ? "no" : undefined,
    flag: p.get("flag") || undefined,
    approval: p.get("approval") === "incomplete" ? "incomplete" : undefined,
    from: p.get("from") || undefined,
    to: p.get("to") || undefined,
    sort: sort === "oldest" || sort === "company" ? sort : "newest",
    page: Math.max(1, Number(p.get("page")) || 1),
  };
}

export function buildWhere(shop: string, f: QueueFilters, applicationIdsWithFiles?: string[]): Prisma.ApplicationWhereInput {
  const and: Prisma.ApplicationWhereInput[] = [{ shop }, { status: { not: "draft" } }];
  if (f.tab !== "all") and.push({ status: f.tab });
  if (f.country) and.push({ countryCode: f.country });
  if (f.businessType) and.push({ businessType: f.businessType });
  if (f.formId) and.push({ formId: f.formId });
  if (f.taxCheck) and.push({ taxCheck: f.taxCheck });
  if (f.flag) and.push({ flags: { has: f.flag } });
  if (f.approval === "incomplete") and.push({ approvalStatus: { in: ["running", "failed"] } });
  if (f.from) and.push({ submittedAt: { gte: new Date(`${f.from}T00:00:00Z`) } });
  if (f.to) and.push({ submittedAt: { lte: new Date(`${f.to}T23:59:59Z`) } });
  if (f.hasCertificate && applicationIdsWithFiles) {
    and.push(f.hasCertificate === "yes" ? { id: { in: applicationIdsWithFiles } } : { id: { notIn: applicationIdsWithFiles } });
  }
  if (f.q) {
    const q = f.q;
    // Tax numbers are encrypted, so search matches their hash (exact, normalised) as stored by intake.
    and.push({
      OR: [
        { companyName: { contains: q, mode: "insensitive" } },
        { email: { contains: q.toLowerCase() } },
        { answers: { path: ["taxNumberHash"], equals: sha256(normaliseTaxNumber(q)) } },
      ],
    });
  }
  return { AND: and };
}

export function normaliseTaxNumber(n: string): string {
  return n.replace(/[\s.\-/]/g, "").toUpperCase();
}

const ORDER: Record<NonNullable<QueueFilters["sort"]>, Prisma.ApplicationOrderByWithRelationInput> = {
  newest: { submittedAt: "desc" },
  oldest: { submittedAt: "asc" },
  company: { companyName: "asc" },
};

export async function listApplications(shop: string, f: QueueFilters) {
  const withFiles = f.hasCertificate
    ? (await db.applicationFile.findMany({ where: { shop }, select: { applicationId: true }, distinct: ["applicationId"] })).map((r) => r.applicationId)
    : undefined;
  const where = buildWhere(shop, f, withFiles);
  const [rows, total, counts, files] = await Promise.all([
    db.application.findMany({
      where,
      orderBy: ORDER[f.sort ?? "newest"],
      skip: ((f.page ?? 1) - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, companyName: true, email: true, countryCode: true, businessType: true, submittedAt: true,
        taxCheck: true, flags: true, status: true, answers: true, approvalStatus: true,
      },
    }),
    db.application.count({ where }),
    db.application.groupBy({ by: ["status"], where: { shop, status: { not: "draft" } }, _count: { _all: true } }),
    Promise.resolve(null),
  ]);
  void files;
  const ids = rows.map((r) => r.id);
  const fileCounts = await db.applicationFile.groupBy({ by: ["applicationId"], where: { shop, applicationId: { in: ids } }, _count: { _all: true } });
  const hasFile = new Set(fileCounts.map((c) => c.applicationId));
  const tabCounts: Record<string, number> = { all: 0 };
  for (const c of counts) {
    tabCounts[c.status] = c._count._all;
    tabCounts.all += c._count._all;
  }
  return {
    rows: rows.map((r) => ({
      id: r.id,
      companyName: r.companyName,
      contactName: contactName(r.answers),
      email: r.email,
      countryCode: r.countryCode,
      businessType: r.businessType,
      submittedAt: r.submittedAt.toISOString(),
      taxCheck: r.taxCheck,
      hasCertificate: hasFile.has(r.id),
      flags: r.flags,
      status: r.status,
      approvalIncomplete: r.approvalStatus === "running" || r.approvalStatus === "failed",
    })),
    total,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    tabCounts,
  };
}

type Answers = Record<string, unknown>;

export function contactName(answers: unknown): string {
  const a = (answers ?? {}) as Answers;
  return [a.firstName, a.lastName].filter((v) => typeof v === "string" && v).join(" ");
}

export async function getApplication(shop: string, id: string) {
  const app = await db.application.findFirst({ where: { shop, id } });
  if (!app) return null;
  const [files, certificates, activity, duplicates, buyer] = await Promise.all([
    db.applicationFile.findMany({ where: { shop, applicationId: id }, orderBy: { createdAt: "asc" } }),
    db.certificate.findMany({ where: { shop, applicationId: id } }),
    db.activityLog.findMany({ where: { shop, subject: id }, orderBy: { createdAt: "desc" }, take: 50 }),
    findDuplicates(shop, app),
    app.buyerId ? db.buyer.findFirst({ where: { shop, id: app.buyerId } }) : null,
  ]);
  let taxNumber: string | null = null;
  try {
    taxNumber = app.taxNumberEnc ? decrypt(app.taxNumberEnc) : null;
  } catch {
    taxNumber = null;
  }
  return { app, taxNumber, files, certificates, activity, duplicates, buyer };
}

/** Other applications from the same shop with the same email, company name or tax number. */
export async function findDuplicates(
  shop: string,
  app: { id: string; email: string; companyName: string; answers: unknown },
) {
  const taxHash = ((app.answers ?? {}) as Answers).taxNumberHash;
  return db.application.findMany({
    where: {
      shop,
      id: { not: app.id },
      status: { not: "draft" },
      OR: [
        { email: app.email },
        { companyName: { equals: app.companyName, mode: "insensitive" } },
        ...(typeof taxHash === "string" ? [{ answers: { path: ["taxNumberHash"], equals: taxHash } }] : []),
      ],
    },
    select: { id: true, companyName: true, email: true, status: true, submittedAt: true },
    take: 10,
  });
}

type DecisionCtx = { admin: Admin; shop: string; actor: string };

async function shopInfo(shop: string) {
  const row = await db.shop.findUnique({ where: { shop }, select: { shop: true, name: true, domainUrl: true, primaryLocale: true, settings: true } });
  return {
    storeName: row?.name || shop.replace(".myshopify.com", ""),
    row,
    primary: row?.primaryLocale ?? "en",
    overrides: readSettings(row?.settings ?? {}).texts,
  };
}

/**
 * Why a decision can't be made right now: the application is no longer open,
 * an approval already created things in Shopify (Undo it first, or the company
 * would be left behind), or someone else is deciding it this very moment.
 */
export type DecisionBlock = "not_open" | "approval_started" | "busy";

/** Statuses a decision may move an application out of, and only while no approval has started. */
const OPEN_FOR_DECISION: Prisma.ApplicationWhereInput = { status: { in: ["pending", "needs_info"] }, approvalStatus: null };

async function decisionLock<T>(shop: string, id: string, fn: () => Promise<T>): Promise<T | "busy"> {
  try {
    return await withApplicationLock(shop, id, fn);
  } catch (e) {
    if (e instanceof LockBusyError) return "busy";
    throw e;
  }
}

async function blockReason(shop: string, id: string): Promise<DecisionBlock> {
  const app = await db.application.findFirst({ where: { shop, id }, select: { status: true, approvalStatus: true } });
  return app && ["pending", "needs_info"].includes(app.status) && app.approvalStatus ? "approval_started" : "not_open";
}

export const MAX_REASON = 2000;

export async function rejectApplication(ctx: DecisionCtx, id: string, opts: { reason: string | null }): Promise<boolean> {
  return (await rejectApplicationWithReason(ctx, id, opts)) === true;
}

/**
 * Reject; returns true, or why it couldn't (shown to the merchant). Safe against
 * a concurrent approve/reject. The reason is kept on the application so the
 * merchant can copy the rejection message (rejectionMessage) now or later.
 */
export async function rejectApplicationWithReason(
  ctx: DecisionCtx,
  id: string,
  opts: { reason: string | null },
): Promise<true | DecisionBlock> {
  const reason = opts.reason?.trim().slice(0, MAX_REASON) || null;
  const res = await decisionLock(ctx.shop, id, async () => {
    const app = await db.application.findFirst({ where: { shop: ctx.shop, id, ...OPEN_FOR_DECISION } });
    if (!app) return blockReason(ctx.shop, id);
    // Guarded write: only one decision wins even without the lock (e.g. a lock that expired).
    const won = await db.application.updateMany({
      where: { shop: ctx.shop, id, ...OPEN_FOR_DECISION },
      data: { status: "rejected", decidedAt: new Date(), rejectReason: reason },
    });
    if (won.count !== 1) return blockReason(ctx.shop, id);
    return app;
  });
  if (res === "busy" || typeof res === "string") return res;
  const app = res;
  await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "application.reject", subject: id, detail: { hasReason: Boolean(reason) } });
  await emitFlowTrigger(ctx.admin, ctx.shop, "application_rejected", {
    applicationId: id, companyName: app.companyName, contactEmail: app.email, country: app.countryCode ?? undefined,
  });
  return true;
}

function firstName(answers: unknown): string {
  const v = ((answers ?? {}) as Answers).firstName;
  return typeof v === "string" ? v : "";
}

type MoreInfoResult = { ok: boolean; link?: string; message?: ApplicantMessage; error?: DecisionBlock };

export async function requestMoreInfo(
  ctx: DecisionCtx,
  id: string,
  opts: { message: string; fields: string[] },
): Promise<MoreInfoResult> {
  const res = await decisionLock(ctx.shop, id, () => requestMoreInfoLocked(ctx, id, opts));
  return res === "busy" ? { ok: false, error: "busy" } : res;
}

async function requestMoreInfoLocked(
  ctx: DecisionCtx,
  id: string,
  opts: { message: string; fields: string[] },
): Promise<MoreInfoResult> {
  const app = await db.application.findFirst({ where: { shop: ctx.shop, id, ...OPEN_FOR_DECISION } });
  if (!app) return { ok: false, error: await blockReason(ctx.shop, id) };
  const exp = Math.floor(Date.now() / 1000) + MORE_INFO_DAYS * 86400;
  const token = signToken({ shop: ctx.shop, purpose: "more_info", subject: id, exp });
  await db.tokenUse.create({
    data: { tokenHash: sha256(token), shop: ctx.shop, purpose: "more_info", subjectId: id, expiresAt: new Date(exp * 1000) },
  });
  // Earlier unused links for this application stop working: only the newest request counts.
  await db.tokenUse.updateMany({
    where: { shop: ctx.shop, subjectId: id, purpose: "more_info", usedAt: null, tokenHash: { not: sha256(token) } },
    data: { usedAt: new Date() },
  });
  await db.application.updateMany({
    where: { shop: ctx.shop, id },
    data: { status: "needs_info", requested: { fields: opts.fields, message: opts.message.slice(0, 2000), at: new Date().toISOString() } },
  });
  const info = await shopInfo(ctx.shop);
  const link = storefrontUrl(info.row, `/apps/tradepass/update/${encodeURIComponent(token)}`, ctx.shop);
  await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "application.needs_info", subject: id, detail: { fields: opts.fields } });
  // Only the link's hash is stored, so this is the one moment the merchant can copy it.
  const message = buildMessage("needs_info", app.locale, info, {
    company: app.companyName, firstName: firstName(app.answers), storeName: info.storeName, link, message: opts.message,
  }, app.email);
  return { ok: true, link, message };
}

/** The "not approved" message for a rejected application, in the applicant's language, with the stored reason. */
export async function rejectionMessage(shop: string, id: string): Promise<ApplicantMessage | null> {
  const app = await db.application.findFirst({ where: { shop, id, status: "rejected" } });
  if (!app) return null;
  const info = await shopInfo(shop);
  return buildMessage("rejected", app.locale, info, {
    company: app.companyName, firstName: firstName(app.answers), storeName: info.storeName, reason: app.rejectReason,
  }, app.email);
}

export async function addNote(shop: string, id: string, actor: string, text: string): Promise<void> {
  const app = await db.application.findFirst({ where: { shop, id }, select: { notes: true } });
  if (!app) return;
  const notes = Array.isArray(app.notes) ? (app.notes as unknown[]) : [];
  await db.application.update({
    where: { id },
    data: { notes: [...notes, { at: new Date().toISOString(), by: actor, text: text.slice(0, 2000) }] as object },
  });
}

export async function setAssignee(shop: string, id: string, assignee: string | null): Promise<void> {
  await db.application.updateMany({ where: { shop, id }, data: { assignee: assignee?.slice(0, 100) || null } });
}

/** Pending count + oldest submission, for Home. */
export async function pendingSummary(shop: string) {
  const [count, oldest] = await Promise.all([
    db.application.count({ where: { shop, status: "pending" } }),
    db.application.findFirst({ where: { shop, status: "pending" }, orderBy: { submittedAt: "asc" }, select: { submittedAt: true } }),
  ]);
  return { count, oldestAt: oldest?.submittedAt.toISOString() ?? null };
}

const CSV_COLUMNS = ["id", "status", "company", "contact", "email", "country", "businessType", "submittedAt", "taxCheck", "flags"] as const;

function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  // Neutralise spreadsheet formulas (CSV injection).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportCsv(shop: string, ids: string[] | null, f?: QueueFilters): Promise<string> {
  const where: Prisma.ApplicationWhereInput = ids ? { shop, id: { in: ids } } : buildWhere(shop, f ?? { tab: "all" });
  const rows = await db.application.findMany({ where, orderBy: { submittedAt: "desc" }, take: 5000 });
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push(
      [r.id, r.status, r.companyName, contactName(r.answers), r.email, r.countryCode, r.businessType, r.submittedAt.toISOString(), r.taxCheck, r.flags.join(" ")]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/** Approvals this calendar month (UTC), for the Free plan's limit. */
export async function approvalsThisMonth(shop: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return db.application.count({ where: { shop, status: "approved", decidedAt: { gte: start } } });
}
