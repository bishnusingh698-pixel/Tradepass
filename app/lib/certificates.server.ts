// CONTRACT (owner: email/certificates area).
import db from "../db.server";
import { logActivity } from "./activity.server";
import { decrypt, encrypt, sha256, signToken, verifyToken } from "./crypto.server";
import { queueEmail } from "./email/index.server";
import { emitFlowTrigger } from "./flow.server";
import { gql, mutate, type Admin } from "./gql.server";
import { readSettings } from "./settings";
import { EU_COUNTRIES, usResellerExemption } from "./tax";

// Certificates (spec §H). Files live in the merchant's Shopify Files; we keep
// the GID, dates, review status and the encrypted number. Review state
// (pending / rejected) is stored; valid / expiring / expired is derived from
// the expiry date and refreshed daily so filters and the digest can query it.

export type CertificateStatus = "pending" | "valid" | "expiring" | "expired" | "rejected";
export type CertificateType = "resale" | "vat" | "licence" | "other";
export const CERTIFICATE_TYPES: CertificateType[] = ["resale", "vat", "licence", "other"];
export const RENEWAL_LINK_DAYS = 60;
export const RENEWAL_STAGES = [30, 7] as const;

const DAY = 86_400_000;
const utcMidnight = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Whole days from today (UTC) to the expiry date; negative once expired. Expiry day itself = 0 (still valid). */
export function daysUntil(expiresOn: Date, now = new Date()): number {
  return Math.round((utcMidnight(expiresOn) - utcMidnight(now)) / DAY);
}

/** Status from dates and review state; "expiring" when within `expiringDays` of expiry. */
export function certificateStatus(c: { expiresOn: Date | null; status: string }, expiringDays: number, now = new Date()): CertificateStatus {
  if (c.status === "pending" || c.status === "rejected") return c.status;
  if (!c.expiresOn) return "valid"; // flagged "No expiry date" separately
  const days = daysUntil(c.expiresOn, now);
  if (days < 0) return "expired";
  if (days <= expiringDays) return "expiring";
  return "valid";
}

export function certificateFlags(c: { expiresOn: Date | null; status: string }, now = new Date()) {
  return {
    noExpiry: !c.expiresOn && c.status !== "rejected",
    // Uploaded with a date that has already passed (still waiting for review).
    pastExpiry: Boolean(c.expiresOn && c.status === "pending" && daysUntil(c.expiresOn, now) < 0),
  };
}

/** Which renewal request is due today, if any: "30" in the 30..8-day window, "7" in the 7..0-day window, once each. */
export function renewalStage(c: { expiresOn: Date | null; status: string; remindedAt: unknown }, now = new Date()): "30" | "7" | null {
  if (!c.expiresOn || (c.status !== "valid" && c.status !== "expiring")) return null;
  const sent = (c.remindedAt ?? {}) as Record<string, string>;
  const days = daysUntil(c.expiresOn, now);
  if (days < 0) return null;
  if (days <= 7) return sent["7"] ? null : "7";
  if (days <= 30) return sent["30"] ? null : "30";
  return null;
}

export function maskNumber(plain: string | null | undefined): string {
  if (!plain) return "";
  const s = plain.replace(/\s+/g, "");
  return s.length <= 4 ? "•".repeat(s.length) : `${"•".repeat(Math.min(6, s.length - 4))}${s.slice(-4)}`;
}

export function maskedNumber(numberEnc: string | null): string {
  if (!numberEnc) return "";
  try {
    return maskNumber(decrypt(numberEnc));
  } catch {
    return "••••";
  }
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const normType = (t: string): CertificateType => ((CERTIFICATE_TYPES as string[]).includes(t) ? (t as CertificateType) : "other");

/** Create Certificate rows for files uploaded with an application. Safe to call twice (same file → same row). */
export async function recordApplicationCertificates(
  shop: string,
  applicationId: string,
  files: { fileGid: string; type: string; country?: string | null; region?: string | null; number?: string | null; expiresOn?: string | null }[],
): Promise<void> {
  for (const f of files) {
    const exists = await db.certificate.findFirst({ where: { shop, applicationId, fileGid: f.fileGid }, select: { id: true } });
    if (exists) continue;
    await db.certificate.create({
      data: {
        shop,
        applicationId,
        type: normType(f.type),
        country: f.country?.toUpperCase() || null,
        region: f.region?.toUpperCase() || null,
        numberEnc: f.number?.trim() ? encrypt(f.number.trim()) : null,
        expiresOn: parseDate(f.expiresOn),
        status: "pending",
        fileGid: f.fileGid,
      },
    });
  }
}

// ------------------------------------------------------------ recipients

export type AdminFor = (shop: string) => Promise<Admin>;

/** Offline Admin API client for background work (jobs have no request). */
export const defaultAdminFor: AdminFor = async (shop) => {
  const { unauthenticated } = await import("../shopify.server");
  return (await unauthenticated.admin(shop)).admin;
};

type Recipient = { email: string; locale: string; company: string; firstName: string };

const firstNameOf = (answers: unknown) => {
  const a = (answers ?? {}) as Record<string, unknown>;
  const v = a.firstName ?? a.first_name;
  return typeof v === "string" ? v : "";
};

/** The applicant's email when we have it; otherwise the company contact's email, read from Shopify (never stored). */
export async function certificateRecipient(
  shop: string,
  cert: { applicationId: string | null; buyerId: string | null },
  adminFor: AdminFor = defaultAdminFor,
): Promise<Recipient | null> {
  const app = cert.applicationId
    ? await db.application.findFirst({ where: { shop, id: cert.applicationId } })
    : cert.buyerId
      ? await db.application.findFirst({ where: { shop, buyerId: cert.buyerId }, orderBy: { submittedAt: "desc" } })
      : null;
  if (app) return { email: app.email, locale: app.locale, company: app.companyName, firstName: firstNameOf(app.answers) };
  if (!cert.buyerId) return null;
  const buyer = await db.buyer.findFirst({ where: { shop, id: cert.buyerId } });
  if (!buyer?.contactGid) return null;
  const data = await gql(await adminFor(shop), CONTACT_QUERY, { id: buyer.contactGid });
  const c = data?.companyContact;
  const email = c?.customer?.defaultEmailAddress?.emailAddress;
  if (!email) return null;
  return { email, locale: c.locale || c.customer.locale || "", company: c.company?.name ?? buyer.name, firstName: c.customer.firstName ?? "" };
}

const CONTACT_QUERY = `#graphql
  query TradepassCertContact($id: ID!) {
    companyContact(id: $id) {
      locale
      company { name }
      customer { firstName locale defaultEmailAddress { emailAddress } }
    }
  }`;

// ------------------------------------------------------------ renewal links

export function renewalLink(shop: string, token: string, locale?: string): string {
  const q = locale ? `?lang=${encodeURIComponent(locale)}` : "";
  return `https://${shop}/apps/tradepass/renew/${encodeURIComponent(token)}${q}`;
}

/** New single-use renewal link for a certificate; older unused links for it stop working. */
export async function createRenewalToken(shop: string, certificateId: string, now = new Date()): Promise<string> {
  const exp = Math.floor(now.getTime() / 1000) + RENEWAL_LINK_DAYS * 86_400;
  const token = signToken({ shop, purpose: "renewal", subject: certificateId, exp });
  const hash = sha256(token);
  await db.tokenUse.create({ data: { tokenHash: hash, shop, purpose: "renewal", subjectId: certificateId, expiresAt: new Date(exp * 1000) } });
  await db.tokenUse.updateMany({
    where: { shop, purpose: "renewal", subjectId: certificateId, usedAt: null, tokenHash: { not: hash } },
    data: { usedAt: now },
  });
  return token;
}

/** Atomically mark a reminder stage as sent. False when it was already sent (so a rerun never double-sends). */
export async function claimReminder(shop: string, id: string, stage: string, now = new Date()): Promise<boolean> {
  const n = await db.$executeRaw`
    UPDATE "Certificate" SET "remindedAt" = COALESCE("remindedAt", '{}'::jsonb) || jsonb_build_object(${stage}::text, ${now.toISOString()}::text)
    WHERE "id" = ${id} AND "shop" = ${shop} AND NOT jsonb_exists(COALESCE("remindedAt", '{}'::jsonb), ${stage}::text)`;
  return n === 1;
}

async function releaseReminder(shop: string, id: string, stage: string) {
  await db.$executeRaw`UPDATE "Certificate" SET "remindedAt" = "remindedAt" - ${stage}::text WHERE "id" = ${id} AND "shop" = ${shop}`;
}

/** Email a renewal request with a fresh upload link. Returns true when queued (or deferred by the quota). */
export async function sendRenewalRequest(
  shop: string,
  certificateId: string,
  kind: "expiring" | "expired",
  adminFor: AdminFor = defaultAdminFor,
  now = new Date(),
): Promise<boolean> {
  const cert = await db.certificate.findFirst({ where: { shop, id: certificateId } });
  if (!cert) return false;
  const to = await certificateRecipient(shop, cert, adminFor);
  if (!to) return false;
  const shopRow = await db.shop.findUnique({ where: { shop }, select: { name: true } });
  const token = await createRenewalToken(shop, cert.id, now);
  const res = await queueEmail({
    shop,
    type: kind === "expired" ? "cert_expired" : "cert_expiring",
    to: to.email,
    locale: to.locale,
    vars: {
      company: to.company,
      first_name: to.firstName,
      store_name: shopRow?.name ?? shop.replace(/\.myshopify\.com$/, ""),
      update_link: renewalLink(shop, token, to.locale),
      expiry_date: cert.expiresOn ? cert.expiresOn.toISOString().slice(0, 10) : "",
    },
    subjectId: cert.id,
  });
  return res.queued;
}

/** Send renewal requests (secure upload link) for the buyers' certificates. Returns how many were queued. */
export async function requestRenewalForBuyers(shop: string, buyerIds: string[], adminFor: AdminFor = defaultAdminFor): Promise<number> {
  let queued = 0;
  for (const buyerId of buyerIds) {
    // The buyer's most relevant certificate: the one expiring last (undated ones count as newest).
    const cert = await db.certificate.findFirst({
      where: { shop, buyerId, status: { not: "rejected" } },
      orderBy: [{ expiresOn: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    });
    if (!cert) continue;
    const expired = cert.expiresOn ? daysUntil(cert.expiresOn) < 0 : false;
    if (await sendRenewalRequest(shop, cert.id, expired ? "expired" : "expiring", adminFor)) queued++;
  }
  return queued;
}

// ------------------------------------------------------------ merchant actions

async function settingsFor(shop: string) {
  const row = await db.shop.findUnique({ where: { shop }, select: { settings: true } });
  return readSettings(row?.settings ?? {});
}

export async function approveCertificate(shop: string, id: string, actor: string): Promise<boolean> {
  const cert = await db.certificate.findFirst({ where: { shop, id } });
  if (!cert) return false;
  const s = await settingsFor(shop);
  const status = certificateStatus({ expiresOn: cert.expiresOn, status: "valid" }, s.certificates.expiringDays);
  await db.certificate.update({ where: { id }, data: { status, rejectReason: null } });
  await logActivity({ shop, actor, action: "certificate.approve", subject: id });
  return true;
}

export async function rejectCertificate(shop: string, id: string, actor: string, reason: string): Promise<boolean> {
  const n = await db.certificate.updateMany({ where: { shop, id }, data: { status: "rejected", rejectReason: reason.trim().slice(0, 500) || null } });
  if (n.count) await logActivity({ shop, actor, action: "certificate.reject", subject: id });
  return n.count === 1;
}

/** Set or change the expiry date. A new date restarts the 30/7-day reminders and recomputes the status. */
export async function setCertificateExpiry(shop: string, id: string, actor: string, expiresOn: string | null): Promise<boolean> {
  const cert = await db.certificate.findFirst({ where: { shop, id } });
  if (!cert) return false;
  const date = parseDate(expiresOn);
  const s = await settingsFor(shop);
  const changed = (date?.getTime() ?? null) !== (cert.expiresOn?.getTime() ?? null);
  await db.certificate.update({
    where: { id },
    data: {
      expiresOn: date,
      status: certificateStatus({ expiresOn: date, status: cert.status }, s.certificates.expiringDays),
      ...(changed ? { remindedAt: {}, decidedOnExpiry: null } : {}),
    },
  });
  await logActivity({ shop, actor, action: "certificate.set_expiry", subject: id });
  return true;
}

/** Tax exemption this certificate backs, when we can tell (US resale by state, EU VAT reverse charge). */
export function exemptionForCertificate(c: { type: string; country: string | null; region: string | null }): string | null {
  if (c.type === "resale" && c.country === "US") return usResellerExemption(c.region);
  if (c.type === "vat" && c.country && EU_COUNTRIES.has(c.country)) return "EU_REVERSE_CHARGE_EXEMPTION_RULE";
  return null;
}

const TAX_UPDATE = `#graphql
  mutation TradepassRemoveExemption($id: ID!, $remove: [TaxExemption!]) {
    companyLocationTaxSettingsUpdate(companyLocationId: $id, exemptionsToRemove: $remove) {
      companyLocation { id }
      userErrors { field message }
    }
  }`;

export type ExpiryDecision = { ok: boolean; reason?: "not_found" | "no_buyer" | "unknown_exemption" | "still_covered" | "shopify_error" };

/**
 * After expiry: "keep" leaves the exemption; "remove" takes this certificate's
 * exemption off every company location of the buyer (unless another valid
 * certificate still covers it). Logged either way.
 */
export async function decideOnExpiry(admin: Admin, shop: string, id: string, actor: string, decision: "keep" | "remove"): Promise<ExpiryDecision> {
  const cert = await db.certificate.findFirst({ where: { shop, id } });
  if (!cert) return { ok: false, reason: "not_found" };
  if (decision === "keep") {
    await db.certificate.update({ where: { id }, data: { decidedOnExpiry: "keep" } });
    await logActivity({ shop, actor, action: "certificate.expiry_keep", subject: id });
    return { ok: true };
  }
  const buyer = cert.buyerId ? await db.buyer.findFirst({ where: { shop, id: cert.buyerId } }) : null;
  if (!buyer) return { ok: false, reason: "no_buyer" };
  const ex = exemptionForCertificate(cert);
  if (!ex) return { ok: false, reason: "unknown_exemption" };
  const others = await db.certificate.findMany({
    where: { shop, buyerId: buyer.id, id: { not: id }, status: { in: ["valid", "expiring"] } },
    select: { type: true, country: true, region: true },
  });
  if (others.some((o) => exemptionForCertificate(o) === ex)) {
    await db.certificate.update({ where: { id }, data: { decidedOnExpiry: "keep" } });
    return { ok: false, reason: "still_covered" };
  }
  try {
    for (const loc of buyer.locationGids) await mutate(admin, "companyLocationTaxSettingsUpdate", TAX_UPDATE, { id: loc, remove: [ex] });
  } catch (e) {
    await logActivity({ shop, actor, action: "certificate.exemption_remove", subject: id, result: "failed", detail: { exemption: ex, error: (e as Error).name } });
    return { ok: false, reason: "shopify_error" };
  }
  await db.$transaction([
    db.buyer.update({ where: { id: buyer.id }, data: { taxExemptions: buyer.taxExemptions.filter((t) => t !== ex) } }),
    db.certificate.update({ where: { id }, data: { decidedOnExpiry: "remove" } }),
  ]);
  await logActivity({ shop, actor, action: "certificate.exemption_remove", subject: id, detail: { exemption: ex, locations: buyer.locationGids.length } });
  return { ok: true };
}

/** A buyer uploaded a new file through the renewal link: back to "pending review" with fresh reminders. */
export async function applyRenewalUpload(shop: string, id: string, fileGid: string, expiresOn: string | null): Promise<void> {
  await db.certificate.updateMany({
    where: { shop, id },
    data: { fileGid, status: "pending", expiresOn: parseDate(expiresOn), remindedAt: {}, rejectReason: null, decidedOnExpiry: null },
  });
  await logActivity({ shop, actor: "buyer", action: "certificate.renewal_upload", subject: id });
}

// ------------------------------------------------------------ daily job

export type DailyDeps = { adminFor?: AdminFor; now?: Date; deadline?: number };

/**
 * One shop's daily pass: refresh derived statuses, fire Flow triggers on
 * transitions, send 30/7-day renewal requests and the expiry email (each once),
 * and remove exemptions after expiry when the merchant chose "remove".
 * Returns certificates touched.
 */
export async function runCertificateDay(shop: string, deps: DailyDeps = {}): Promise<number> {
  const now = deps.now ?? new Date();
  const adminFor = deps.adminFor ?? defaultAdminFor;
  const settings = await settingsFor(shop);
  const { expiringDays, autoRenewal, onExpiry } = settings.certificates;
  let admin: Admin | null = null;
  const getAdmin = async () => (admin ??= await adminFor(shop));
  let touched = 0;
  let cursor: string | undefined;
  for (;;) {
    if (deps.deadline && Date.now() > deps.deadline) break;
    const batch = await db.certificate.findMany({
      where: { shop, status: { in: ["valid", "expiring", "expired"] }, expiresOn: { not: null } },
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!batch.length) break;
    cursor = batch[batch.length - 1].id;
    for (const c of batch) {
      if (deps.deadline && Date.now() > deps.deadline) break;
      const next = certificateStatus(c, expiringDays, now);
      if (next !== c.status) {
        await db.certificate.update({ where: { id: c.id }, data: { status: next } });
        touched++;
        if (next === "expiring" || next === "expired") {
          const buyer = c.buyerId ? await db.buyer.findFirst({ where: { shop, id: c.buyerId }, select: { companyGid: true, name: true } }) : null;
          await emitFlowTrigger(await getAdmin(), shop, next === "expiring" ? "certificate_expiring" : "certificate_expired", {
            buyerId: c.buyerId ?? undefined,
            applicationId: c.applicationId ?? undefined,
            companyGid: buyer?.companyGid,
            companyName: buyer?.name,
            expiryDate: c.expiresOn!.toISOString().slice(0, 10),
          });
        }
      }
      if (autoRenewal) {
        const stage = renewalStage({ ...c, status: next }, now);
        const expiredStage = next === "expired" && !((c.remindedAt ?? {}) as Record<string, string>).expired ? "expired" : null;
        const due = stage ?? expiredStage;
        if (due && (await claimReminder(shop, c.id, due, now))) {
          try {
            await sendRenewalRequest(shop, c.id, due === "expired" ? "expired" : "expiring", adminFor, now);
            touched++;
          } catch (e) {
            await releaseReminder(shop, c.id, due); // try again tomorrow
            throw e;
          }
        }
      }
      if (next === "expired" && onExpiry === "remove" && !c.decidedOnExpiry && c.buyerId) {
        await decideOnExpiry(await getAdmin(), shop, c.id, "system", "remove");
        touched++;
      }
    }
  }
  return touched;
}

// ------------------------------------------------------------ renewal token + staff file access

export type RenewalCheck =
  | { ok: true; certificateId: string; tokenHash: string }
  | { ok: false; reason: "invalid" | "expired" | "used" };

/** Check a renewal link for the shop the app proxy vouched for. Does not consume it. */
export async function checkRenewalToken(shop: string, raw: string, now = new Date()): Promise<RenewalCheck> {
  const v = verifyToken(raw, now.getTime());
  if (!v.ok) return { ok: false, reason: v.reason === "expired" ? "expired" : "invalid" };
  if (v.token.purpose !== "renewal" || v.token.shop !== shop) return { ok: false, reason: "invalid" };
  const tokenHash = sha256(raw);
  const use = await db.tokenUse.findUnique({ where: { tokenHash } });
  if (!use || use.shop !== shop || use.purpose !== "renewal") return { ok: false, reason: "invalid" };
  if (use.usedAt) return { ok: false, reason: "used" };
  if (use.expiresAt < now) return { ok: false, reason: "expired" };
  const cert = await db.certificate.findFirst({ where: { shop, id: use.subjectId }, select: { id: true } });
  if (!cert) return { ok: false, reason: "invalid" };
  return { ok: true, certificateId: cert.id, tokenHash };
}

/** Mark the link used; false if another request used it first (single use). */
export async function consumeRenewalToken(shop: string, tokenHash: string, now = new Date()): Promise<boolean> {
  const n = await db.tokenUse.updateMany({ where: { tokenHash, shop, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
  return n.count === 1;
}

/** File GID for a Certificate or ApplicationFile id — only when it belongs to `shop`. */
export async function findStaffFile(shop: string, id: string): Promise<string | null> {
  const cert = await db.certificate.findFirst({ where: { shop, id }, select: { fileGid: true } });
  if (cert?.fileGid) return cert.fileGid;
  const file = await db.applicationFile.findFirst({ where: { shop, id }, select: { fileGid: true } });
  return file?.fileGid ?? null;
}

const FILE_QUERY = `#graphql
  query TradepassFile($id: ID!) {
    node(id: $id) {
      ... on GenericFile { url mimeType }
      ... on MediaImage { mimeType image { url } }
    }
  }`;

/** Shopify CDN URL and type for a file GID (read through the merchant's own Admin API). */
export async function fileUrl(admin: Admin, fileGid: string): Promise<{ url: string; mimeType: string | null } | null> {
  const data = await gql(admin, FILE_QUERY, { id: fileGid });
  const n = data?.node;
  const url = n?.url ?? n?.image?.url;
  return url ? { url, mimeType: n.mimeType ?? null } : null;
}
