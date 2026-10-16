import db from "../db.server";
import { sha256 } from "./crypto.server";

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
    db.emailLog.deleteMany({ where: { shop } }),
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
    db.emailLog.deleteMany({ where: { shop } }),
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
  if (c.email) {
    await db.emailLog.deleteMany({ where: { shop, toHash: sha256(c.email.toLowerCase()) } });
  }
  if (!ids.length) return 0;
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
 * data so the merchant can export them (Settings → Data). We never put the
 * personal data itself into the activity log.
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
