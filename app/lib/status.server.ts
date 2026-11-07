// Application status for the applicant (feature B5): the hosted status page (signed, expiring,
// read-only link that every copyable message carries), the theme block for a logged-in customer
// (through the app proxy, which vouches for `logged_in_customer_id`) and the customer account
// profile block (session token). Only the applicant's own application is ever returned, and only
// what they need: status, dates, the merchant's "more info" message and a fresh update link.
// No personal data goes into metafields.
import db from "../db.server";
import { sha256, signToken, verifyToken } from "./crypto.server";
import { readSettings } from "./settings";
import { storefrontUrl } from "./shop.server";
import { safeHttpsUrl, safeWhatsAppUrl } from "./message-links";
import { gql, type Admin } from "./gql.server";

export const STATUS_LINK_DAYS = 90;
/** A fresh "more info" link made from the status page lasts as long as one the merchant sends. */
const UPDATE_LINK_DAYS = 14;

export type PublicStatus = "pending" | "needs_info" | "approved" | "rejected";

export type StatusView = {
  status: PublicStatus;
  company: string;
  locale: string;
  submittedAt: string;
  decidedAt: string | null;
  /** The merchant's "more info" message (needs_info only). */
  message: string | null;
  /** Single-use link to the secure update page (needs_info only). */
  updateUrl: string | null;
  /** Rejected with a re-apply wait: the first day they may apply again (YYYY-MM-DD). */
  reapplyFrom: string | null;
  links: { booking: string | null; shopping: string | null; whatsapp: string | null };
};

/** Statuses an applicant sees. Drafts and withdrawn applications show nothing. */
export function publicStatus(s: string): PublicStatus | null {
  return s === "pending" || s === "needs_info" || s === "approved" || s === "rejected" ? s : null;
}

/** First day a rejected applicant may apply again, or null when there's no wait (or it has passed). */
export function reapplyFrom(decidedAt: Date | null, days: number, now = new Date()): string | null {
  if (!decidedAt || !days || days < 1) return null;
  const from = new Date(Date.UTC(decidedAt.getUTCFullYear(), decidedAt.getUTCMonth(), decidedAt.getUTCDate() + days));
  return from > now ? from.toISOString().slice(0, 10) : null;
}

/** Signed, expiring, read-only link to the hosted status page (no database row: nothing to use up). */
export function statusLink(shopRow: { shop: string; domainUrl?: string | null } | null, shop: string, applicationId: string, now = Date.now()): string {
  const token = signToken({ shop, purpose: "status", subject: applicationId, exp: Math.floor(now / 1000) + STATUS_LINK_DAYS * 86_400 });
  return storefrontUrl(shopRow, `/apps/tradepass/status/${encodeURIComponent(token)}`, shop);
}

export function readStatusToken(shop: string, raw: string): { ok: true; applicationId: string } | { ok: false; reason: "invalid" | "expired" } {
  const v = verifyToken(raw);
  if (!v.ok) return { ok: false, reason: v.reason === "expired" ? "expired" : "invalid" };
  if (v.token.purpose !== "status" || v.token.shop !== shop) return { ok: false, reason: "invalid" };
  return { ok: true, applicationId: v.token.subject };
}

/** A new single-use update link for an application waiting for information (older links keep working until one is used). */
async function freshUpdateLink(shopRow: { shop: string; domainUrl: string | null }, applicationId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + UPDATE_LINK_DAYS * 86_400;
  const token = signToken({ shop: shopRow.shop, purpose: "more_info", subject: applicationId, exp });
  await db.tokenUse.create({ data: { tokenHash: sha256(token), shop: shopRow.shop, purpose: "more_info", subjectId: applicationId, expiresAt: new Date(exp * 1000) } });
  return storefrontUrl(shopRow, `/apps/tradepass/update/${encodeURIComponent(token)}`, shopRow.shop);
}

/** The view for one application of this shop, or null if it doesn't exist or isn't shown to applicants. */
export async function statusView(shop: string, applicationId: string, now = new Date(), opts: { withUpdateLink?: boolean } = {}): Promise<StatusView | null> {
  const [app, shopRow] = await Promise.all([
    db.application.findFirst({ where: { shop, id: applicationId } }),
    db.shop.findUnique({ where: { shop }, select: { shop: true, domainUrl: true, settings: true } }),
  ]);
  if (!app || !shopRow) return null;
  const status = publicStatus(app.status);
  if (!status) return null;
  const s = readSettings(shopRow.settings);
  const requested = (app.requested ?? {}) as { message?: string };
  return {
    status,
    company: app.companyName,
    locale: app.locale,
    submittedAt: app.submittedAt.toISOString(),
    decidedAt: app.decidedAt?.toISOString() ?? null,
    message: status === "needs_info" ? requested.message?.trim() || null : null,
    updateUrl: status === "needs_info" && !app.approvalStatus && opts.withUpdateLink !== false ? await freshUpdateLink(shopRow, app.id) : null,
    reapplyFrom: status === "rejected" ? reapplyFrom(app.decidedAt, s.applications.reapplyDays, now) : null,
    links: {
      booking: status === "pending" || status === "needs_info" ? safeHttpsUrl(s.links.bookingUrl) : null,
      shopping: status === "approved" ? safeHttpsUrl(s.links.shoppingUrl) : null,
      whatsapp: safeWhatsAppUrl(s.contact.whatsappUrl),
    },
  };
}

const CUSTOMER_EMAIL = `#graphql
  query TradepassStatusCustomer($id: ID!) { customer(id: $id) { id defaultEmailAddress { emailAddress } } }`;

/**
 * The newest application of a logged-in customer: linked by customer id, else by the customer's
 * email (read from Shopify, never stored). Returns its id or null.
 */
export async function applicationForCustomer(shop: string, customerGid: string, admin: Admin | null): Promise<string | null> {
  const where = { shop, status: { in: ["pending", "needs_info", "approved", "rejected"] } };
  const linked = await db.application.findFirst({ where: { ...where, customerGid }, orderBy: { submittedAt: "desc" }, select: { id: true } });
  if (linked) return linked.id;
  if (!admin) return null;
  let email = "";
  try {
    email = String((await gql(admin, CUSTOMER_EMAIL, { id: customerGid })).customer?.defaultEmailAddress?.emailAddress ?? "").toLowerCase();
  } catch {
    return null;
  }
  if (!email) return null;
  const byEmail = await db.application.findFirst({ where: { ...where, email }, orderBy: { submittedAt: "desc" }, select: { id: true } });
  return byEmail?.id ?? null;
}

/** A returning applicant within the re-apply wait after a rejection: the date they may apply again. */
export async function cooldownFor(shop: string, keys: { email: string; companyName: string; taxHash: string | null }, now = new Date()): Promise<string | null> {
  const row = await db.shop.findUnique({ where: { shop }, select: { settings: true } });
  const days = readSettings(row?.settings ?? {}).applications.reapplyDays;
  if (!days) return null;
  const or: object[] = [];
  if (keys.email) or.push({ email: keys.email });
  if (keys.companyName) or.push({ companyName: { equals: keys.companyName, mode: "insensitive" } });
  if (keys.taxHash) or.push({ answers: { path: ["taxNumberHash"], equals: keys.taxHash } });
  if (!or.length) return null;
  const last = await db.application.findFirst({
    where: { shop, status: "rejected", OR: or, decidedAt: { gte: new Date(now.getTime() - days * 86_400_000) } },
    orderBy: { decidedAt: "desc" },
    select: { decidedAt: true },
  });
  return last ? reapplyFrom(last.decidedAt, days, now) : null;
}
