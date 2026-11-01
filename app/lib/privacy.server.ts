import db from "../db.server";
import { decrypt } from "./crypto.server";
import { DELETE_FILES_JOB } from "./tasks/background";

// Everything we store per shop, in one place, so privacy webhooks and the
// "Delete all Tradepass data" button can't drift apart. Keep in sync with
// prisma/schema.prisma and PRIVACY.md.

export async function deleteShopData(shop: string): Promise<void> {
  await db.$transaction([
    db.application.deleteMany({ where: { shop } }),
    db.applicationFile.deleteMany({ where: { shop } }),
    db.certificate.deleteMany({ where: { shop } }),
    db.buyer.deleteMany({ where: { shop } }),
    db.tier.deleteMany({ where: { shop } }),
    db.form.deleteMany({ where: { shop } }),
    db.activityLog.deleteMany({ where: { shop } }),
    db.job.deleteMany({ where: { shop } }),
    db.shopLock.deleteMany({ where: { shop } }),
    db.importRun.deleteMany({ where: { shop } }),
    db.tokenUse.deleteMany({ where: { shop } }),
    db.rule.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
    db.shop.deleteMany({ where: { shop } }),
  ]);
}

/**
 * "Delete all Tradepass data" from Settings: the same tables as deleteShopData,
 * but the app stays installed, so the Shop row (plan, billing) and sessions are
 * kept and settings go back to defaults. Shopify companies, markets and catalogs
 * are the merchant's and are never touched.
 */
export async function resetShopData(shop: string): Promise<void> {
  await db.$transaction([
    db.application.deleteMany({ where: { shop } }),
    db.applicationFile.deleteMany({ where: { shop } }),
    db.certificate.deleteMany({ where: { shop } }),
    db.buyer.deleteMany({ where: { shop } }),
    db.tier.deleteMany({ where: { shop } }),
    db.form.deleteMany({ where: { shop } }),
    db.activityLog.deleteMany({ where: { shop } }),
    db.job.deleteMany({ where: { shop } }),
    db.shopLock.deleteMany({ where: { shop } }),
    db.importRun.deleteMany({ where: { shop } }),
    db.tokenUse.deleteMany({ where: { shop } }),
    db.rule.deleteMany({ where: { shop } }),
    db.shop.updateMany({ where: { shop }, data: { settings: {}, welcomeDoneAt: null, placeholderCompanyGid: null } }),
  ]);
}

export type CustomerRef = { id?: number | string | null; email?: string | null };

function customerGid(id: CustomerRef["id"]): string | null {
  return id ? `gid://shopify/Customer/${id}` : null;
}

async function applicationsFor(shop: string, c: CustomerRef) {
  const gid = customerGid(c.id);
  const or = [
    ...(c.email ? [{ email: c.email.toLowerCase() }] : []),
    ...(gid ? [{ customerGid: gid }] : []),
  ];
  if (!or.length) return [];
  return db.application.findMany({ where: { shop, OR: or }, select: { id: true, buyerId: true } });
}

/** customers/redact: delete the applicant's applications and everything hanging off them. */
export async function redactCustomer(shop: string, c: CustomerRef): Promise<number> {
  const apps = await applicationsFor(shop, c);
  const ids = apps.map((a) => a.id);
  if (!ids.length) return 0;
  // The applicant's documents live in the merchant's Shopify Files. Deleting them
  // needs Admin API calls, so a job does it within the hour (the webhook must answer fast).
  const [files, certs] = await Promise.all([
    db.applicationFile.findMany({ where: { shop, applicationId: { in: ids } }, select: { fileGid: true } }),
    db.certificate.findMany({ where: { shop, applicationId: { in: ids }, fileGid: { not: null } }, select: { fileGid: true } }),
  ]);
  const fileGids = [...new Set([...files.map((f) => f.fileGid), ...certs.map((c) => c.fileGid!)])];
  if (fileGids.length) await db.job.create({ data: { shop, type: DELETE_FILES_JOB, payload: { fileGids } } });
  await db.$transaction([
    db.applicationFile.deleteMany({ where: { shop, applicationId: { in: ids } } }),
    db.certificate.deleteMany({ where: { shop, applicationId: { in: ids } } }),
    db.tokenUse.deleteMany({ where: { shop, subjectId: { in: ids } } }),
    db.application.deleteMany({ where: { shop, id: { in: ids } } }),
  ]);
  // Buyer rows hold only Shopify GIDs and the company name (business data, not the person);
  // the company itself belongs to the merchant in Shopify and is never deleted by us.
  return ids.length;
}

/**
 * customers/data_request: record which of our records hold this customer's
 * data so the merchant can export them (Settings → Privacy requests). We never
 * put the personal data itself into the activity log.
 */
export async function recordDataRequest(shop: string, c: CustomerRef): Promise<number> {
  const apps = await applicationsFor(shop, c);
  await db.activityLog.create({
    data: {
      shop,
      actor: "shopify",
      action: "privacy.data_request",
      subject: customerGid(c.id),
      detail: { applicationIds: apps.map((a) => a.id) },
    },
  });
  return apps.length;
}

export type DataRequestRow = { id: string; at: string; customer: string | null; applications: number };

/** Privacy data requests received from Shopify (last 12 months), newest first. */
export async function listDataRequests(shop: string): Promise<DataRequestRow[]> {
  const rows = await db.activityLog.findMany({
    where: { shop, action: "privacy.data_request", createdAt: { gte: new Date(Date.now() - 365 * 86_400_000) } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    customer: r.subject,
    applications: ((r.detail as { applicationIds?: string[] } | null)?.applicationIds ?? []).length,
  }));
}

/**
 * Everything Tradepass holds about the customer of one data request, as JSON
 * for the merchant to send on. Tax numbers are decrypted: the customer gave
 * them and is entitled to a copy. Records deleted since the request are skipped.
 */
export async function exportDataRequest(shop: string, requestId: string): Promise<Record<string, unknown> | null> {
  const req = await db.activityLog.findFirst({ where: { shop, id: requestId, action: "privacy.data_request" } });
  if (!req) return null;
  const ids = (req.detail as { applicationIds?: string[] } | null)?.applicationIds ?? [];
  const apps = await db.application.findMany({ where: { shop, id: { in: ids } }, orderBy: { submittedAt: "asc" } });
  const [files, certs] = await Promise.all([
    db.applicationFile.findMany({ where: { shop, applicationId: { in: ids } } }),
    db.certificate.findMany({ where: { shop, applicationId: { in: ids } } }),
  ]);
  const plain = (enc: string | null) => {
    if (!enc) return null;
    try {
      return decrypt(enc);
    } catch {
      return null;
    }
  };
  return {
    store: shop,
    customer: req.subject,
    requestedAt: req.createdAt.toISOString(),
    exportedAt: new Date().toISOString(),
    applications: apps.map((a) => {
      // Internal bookkeeping (hashes, file references) isn't the customer's data.
      const answers = Object.fromEntries(Object.entries((a.answers ?? {}) as Record<string, unknown>).filter(([k]) => k !== "taxNumberHash" && k !== "certificateMeta"));
      return {
        id: a.id,
        status: a.status,
        submittedAt: a.submittedAt.toISOString(),
        decidedAt: a.decidedAt?.toISOString() ?? null,
        companyName: a.companyName,
        email: a.email,
        country: a.countryCode,
        language: a.locale,
        answers,
        taxNumber: plain(a.taxNumberEnc),
        taxCheck: a.taxCheck,
        files: files.filter((f) => f.applicationId === a.id).map((f) => ({ shopifyFileId: f.fileGid, kind: f.kind, uploadedAt: f.createdAt.toISOString() })),
        certificates: certs.filter((c) => c.applicationId === a.id).map((c) => ({
          type: c.type, country: c.country, region: c.region, number: plain(c.numberEnc),
          issuedOn: c.issuedOn?.toISOString().slice(0, 10) ?? null, expiresOn: c.expiresOn?.toISOString().slice(0, 10) ?? null, status: c.status,
        })),
      };
    }),
  };
}
