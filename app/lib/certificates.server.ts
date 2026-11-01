// CONTRACT (owner: email/certificates area).
import db from "../db.server";
import { storefrontUrl } from "./shop.server";
import { logActivity } from "./activity.server";
import { decrypt, encrypt, sha256, signToken, verifyToken } from "./crypto.server";
import { emitFlowTrigger } from "./flow.server";
import { buildMessage, renewalKind, type ApplicantMessage } from "./messages";
import { gql, mutate, type Admin } from "./gql.server";
import { readSettings } from "./settings";
import { can, effectivePlan } from "./plans";
import { EU_COUNTRIES, usResellerExemption } from "./tax";
import { isRealDate } from "./dates";

// Certificates (spec §H). Files live in the merchant's Shopify Files; we keep
// the GID, dates, review status and the encrypted number. Review state
// (pending / rejected) is stored; valid / expiring / expired is derived from
// the expiry date and refreshed daily so filters and Home can query it.
// Tradepass sends no email (D-091): to ask for a new certificate the merchant
// copies a ready-made message with a signed, single-use upload link (renewalMessage).

export * from "./certificates";
import { CERTIFICATE_TYPES, certificateStatus, maskNumber, RENEWAL_LINK_DAYS, type CertificateType } from "./certificates";

export function maskedNumber(numberEnc: string | null): string {
  if (!numberEnc) return "";
  try {
    return maskNumber(decrypt(numberEnc));
  } catch {
    return "••••";
  }
}

function parseDate(s: string | null | undefined): Date | null {
  const day = s?.slice(0, 10) ?? "";
  return isRealDate(day) ? new Date(`${day}T00:00:00Z`) : null;
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

/** Renewal link on the store's own domain (falls back to the myshopify domain). */
export function renewalLink(shop: string, token: string, locale?: string, domainUrl?: string | null): string {
  const q = locale ? `?lang=${encodeURIComponent(locale)}` : "";
  return storefrontUrl({ shop, domainUrl }, `/apps/tradepass/renew/${encodeURIComponent(token)}${q}`);
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

/**
 * The renewal request the merchant sends the buyer themselves: a fresh signed,
 * single-use upload link (older unused links stop working) inside a message in
 * the buyer's language. The recipient address is read from the application or
 * Shopify (never stored).
 */
export async function renewalMessage(
  shop: string,
  certificateId: string,
  actor: string,
  adminFor: AdminFor = defaultAdminFor,
  now = new Date(),
): Promise<ApplicantMessage | null> {
  const cert = await db.certificate.findFirst({ where: { shop, id: certificateId } });
  if (!cert) return null;
  const [to, shopRow, holder] = await Promise.all([
    certificateRecipient(shop, cert, adminFor).catch(() => null),
    db.shop.findUnique({ where: { shop }, select: { name: true, domainUrl: true, primaryLocale: true, settings: true } }),
    cert.buyerId
      ? db.buyer.findFirst({ where: { shop, id: cert.buyerId }, select: { name: true } })
      : cert.applicationId
        ? db.application.findFirst({ where: { shop, id: cert.applicationId }, select: { companyName: true } }).then((a) => (a ? { name: a.companyName } : null))
        : null,
  ]);
  const token = await createRenewalToken(shop, cert.id, now);
  const primary = shopRow?.primaryLocale ?? "en";
  const locale = to?.locale || primary;
  const expiry = cert.expiresOn ? cert.expiresOn.toISOString().slice(0, 10) : null;
  await logActivity({ shop, actor, action: "certificate.renewal_link", subject: cert.id });
  return buildMessage(renewalKind(expiry, now.toISOString().slice(0, 10)), locale, { primary, overrides: readSettings(shopRow?.settings ?? {}).texts }, {
    company: to?.company || holder?.name || "",
    firstName: to?.firstName,
    storeName: shopRow?.name ?? shop.replace(/\.myshopify\.com$/, ""),
    link: renewalLink(shop, token, locale, shopRow?.domainUrl),
    expiryDate: expiry,
  }, to?.email ?? "");
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

/** Set or change the expiry date. A new date recomputes the status and reopens the after-expiry decision. */
export async function setCertificateExpiry(shop: string, id: string, actor: string, expiresOn: string | null): Promise<boolean> {
  const cert = await db.certificate.findFirst({ where: { shop, id } });
  if (!cert) return false;
  // An impossible date must not silently clear the expiry (the caller reports it).
  if (expiresOn && !isRealDate(expiresOn)) return false;
  const date = parseDate(expiresOn);
  const s = await settingsFor(shop);
  const changed = (date?.getTime() ?? null) !== (cert.expiresOn?.getTime() ?? null);
  await db.certificate.update({
    where: { id },
    data: {
      expiresOn: date,
      status: certificateStatus({ expiresOn: date, status: cert.status }, s.certificates.expiringDays),
      ...(changed ? { decidedOnExpiry: null } : {}),
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

/** A buyer uploaded a new file through the renewal link: back to "pending review". */
export async function applyRenewalUpload(shop: string, id: string, fileGid: string, expiresOn: string | null): Promise<void> {
  // The replaced file stays in the merchant's Shopify Files. Keep it listed under the application, so
  // it is still visible there and is deleted with the application (customers/redact, retention).
  const prev = await db.certificate.findFirst({ where: { shop, id }, select: { fileGid: true, applicationId: true } });
  if (prev?.fileGid && prev.applicationId && prev.fileGid !== fileGid) {
    const listed = await db.applicationFile.count({ where: { shop, applicationId: prev.applicationId, fileGid: prev.fileGid } });
    if (!listed) await db.applicationFile.create({ data: { shop, applicationId: prev.applicationId, fileGid: prev.fileGid, kind: "certificate" } });
  }
  await db.certificate.updateMany({
    where: { shop, id },
    data: { fileGid, status: "pending", expiresOn: parseDate(expiresOn), rejectReason: null, decidedOnExpiry: null },
  });
  await logActivity({ shop, actor: "buyer", action: "certificate.renewal_upload", subject: id });
}

// ------------------------------------------------------------ daily job

export type DailyDeps = { adminFor?: AdminFor; now?: Date; deadline?: number };

/**
 * One shop's daily pass: refresh derived statuses, fire Flow triggers on
 * transitions, and remove exemptions after expiry when the merchant chose "remove".
 * Returns certificates touched.
 */
export async function runCertificateDay(shop: string, deps: DailyDeps = {}): Promise<number> {
  const now = deps.now ?? new Date();
  const adminFor = deps.adminFor ?? defaultAdminFor;
  const shopRow = await db.shop.findUnique({ where: { shop }, select: { settings: true, billingPlan: true, isDevStore: true } });
  const settings = readSettings(shopRow?.settings ?? {});
  const { expiringDays, onExpiry } = settings.certificates;
  // Flow triggers need the Admin API; Free/Starter stores get none, so they never need a token here.
  const flowOn = Boolean(shopRow) && can(effectivePlan(shopRow!.billingPlan, shopRow!.isDevStore), "flow");
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
      // Each certificate on its own: one failure (a revoked token, a Shopify error) must not stop the
      // rest of the shop's certificates; the failed one is simply tried again tomorrow.
      try {
        touched += await certificateDay(shop, c, { now, expiringDays, onExpiry, flowOn, getAdmin });
      } catch (e) {
        await logActivity({ shop, actor: "system", action: "certificate.daily", subject: c.id, result: "failed", detail: { error: (e as Error).name } }).catch(() => undefined);
      }
    }
  }
  return touched;
}

type CertRow = Awaited<ReturnType<typeof db.certificate.findMany>>[number];

async function certificateDay(
  shop: string,
  c: CertRow,
  o: { now: Date; expiringDays: number; onExpiry: "ask" | "remove"; flowOn: boolean; getAdmin: () => Promise<Admin> },
): Promise<number> {
  let touched = 0;
  const next = certificateStatus(c, o.expiringDays, o.now);
  if (next !== c.status) {
    const trigger = next === "expiring" ? "certificate_expiring" : next === "expired" ? "certificate_expired" : null;
    const buyer = c.buyerId ? await db.buyer.findFirst({ where: { shop, id: c.buyerId }, select: { id: true, companyGid: true, name: true, country: true, tierId: true, pausedTierId: true } }) : null;
    // The certificate triggers carry a company reference, so they fire for buyers only.
    const fire = Boolean(trigger && o.flowOn && buyer);
    // Get the token before changing the status: if Shopify can't be reached, the status stays as it
    // was and the transition (and its trigger) happens on the next run instead of being lost.
    const admin = fire ? await o.getAdmin() : null;
    // Guarded: only the run that moves the status fires the trigger, even if two runs overlap.
    const moved = await db.certificate.updateMany({ where: { id: c.id, shop, status: c.status }, data: { status: next } });
    if (moved.count !== 1) return 0;
    touched++;
    if (fire && admin && buyer) {
      const [app, tier] = await Promise.all([
        db.application.findFirst({ where: { shop, OR: [...(c.applicationId ? [{ id: c.applicationId }] : []), { buyerId: buyer.id }] }, orderBy: { submittedAt: "desc" }, select: { email: true } }),
        buyer.tierId ?? buyer.pausedTierId ? db.tier.findFirst({ where: { shop, id: (buyer.tierId ?? buyer.pausedTierId)! }, select: { name: true } }) : null,
      ]);
      await emitFlowTrigger(admin, shop, trigger!, {
        buyerId: c.buyerId ?? undefined,
        applicationId: c.applicationId ?? undefined,
        companyGid: buyer.companyGid,
        companyName: buyer.name,
        contactEmail: app?.email,
        country: buyer.country ?? c.country ?? undefined,
        tierName: tier?.name,
        expiryDate: c.expiresOn!.toISOString().slice(0, 10),
      });
    }
  }
  if (next === "expired" && o.onExpiry === "remove" && !c.decidedOnExpiry && c.buyerId) {
    await decideOnExpiry(await o.getAdmin(), shop, c.id, "system", "remove");
    touched++;
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
