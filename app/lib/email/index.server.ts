// CONTRACT (owner: email/certificates area).
import { Prisma } from "@prisma/client";
import db from "../../db.server";
import { sha256 } from "../crypto.server";
import { readSettings, type EmailType, type Settings } from "../settings";
import { brevoConfigured, sendViaBrevo, type OutgoingEmail, type SendResult } from "./brevo.server";
import { buildEmail, type DigestCounts } from "./templates.server";
import { APPLICANT_EMAIL_TYPES, isMerchantType, type TemplateType } from "./types";

// Queue + quota. Brevo's free plan sends 300 emails a day, so we cap at
// 25 per store and 250 in total per UTC day. Every queued email reserves a
// slot on a `quotaDay`; when today is full it reserves the next day with room
// (deferred, never dropped) and the merchant sees a notice. The recipient
// address lives in `payload` only until the email is sent, then the payload
// is cleared and only the recipient hash stays.

export type AnyEmailType = EmailType | "merchant_new_application" | "merchant_digest" | "test";

export type QueueEmailInput = {
  shop: string;
  type: AnyEmailType;
  to: string;
  locale: string; // recipient's language; falls back to store primary, then English
  vars: Record<string, string | number>; // {company} {first_name} {store_name} {tier_name} {login_url} {update_link} {expiry_date}
  subjectId?: string; // application / certificate id, for the log (never personal data)
};

export type QueueResult = { queued: boolean; reason?: "disabled" | "quota_deferred" | "invalid_recipient" };

export const SHOP_DAILY_CAP = 25;
export const GLOBAL_DAILY_CAP = 250;
const MAX_ATTEMPTS = 6;
const STUCK_SENDING_MS = 15 * 60_000;
// Any constant works; it only has to be the same for every caller.
const QUOTA_LOCK_KEY = 732_001;

type Payload = {
  to: string;
  locale: string;
  vars: Record<string, string | number>;
  subjectId?: string;
  attempts?: number;
  template?: TemplateType; // "test" emails: which email to render
  draft?: { subject?: string; body?: string };
  digest?: DigestCounts;
};

export const utcDay = (d: Date = new Date()) => d.toISOString().slice(0, 10);
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return utcDay(d);
}

const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;
const COUNTED = { not: "skipped" };
type Tx = Prisma.TransactionClient;

/** First day from `from` with room for this shop and globally. Call inside the quota lock. */
export async function reserveDay(tx: Tx, shop: string, from: string): Promise<string> {
  for (let i = 0; i < 366; i++) {
    const day = addDays(from, i);
    const [shopCount, globalCount] = await Promise.all([
      tx.emailLog.count({ where: { shop, quotaDay: day, status: COUNTED } }),
      tx.emailLog.count({ where: { quotaDay: day, status: COUNTED } }),
    ]);
    if (shopCount < SHOP_DAILY_CAP && globalCount < GLOBAL_DAILY_CAP) return day;
  }
  throw new Error("No email quota day available within a year");
}

/** Serialize quota reservations across requests and job runs (Postgres advisory lock, released at commit). */
async function withQuotaLock<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${QUOTA_LOCK_KEY})`);
    return fn(tx);
  });
}

export function merchantAddress(settings: Settings, shopEmail: string | null | undefined): string | null {
  return settings.notifications.merchant.email || shopEmail || null;
}

async function shopFor(shop: string) {
  return db.shop.findUnique({
    where: { shop },
    select: { shop: true, settings: true, email: true, name: true, primaryLocale: true, uninstalledAt: true },
  });
}

async function enqueue(shop: string, type: AnyEmailType, payload: Payload, now: Date): Promise<QueueResult & { id?: string; quotaDay?: string }> {
  const today = utcDay(now);
  const row = await withQuotaLock(async (tx) => {
    const quotaDay = await reserveDay(tx, shop, today);
    return tx.emailLog.create({
      data: { shop, type, toHash: sha256(payload.to.trim().toLowerCase()), payload: payload as object, status: "queued", quotaDay, createdAt: now },
      select: { id: true, quotaDay: true },
    });
  });
  const deferred = row.quotaDay > today;
  if (!deferred) void sendOne(row.id).catch(() => undefined); // best effort now; the hourly job retries
  return { queued: true, id: row.id, quotaDay: row.quotaDay, ...(deferred ? { reason: "quota_deferred" as const } : {}) };
}

const publicResult = (r: QueueResult): QueueResult => ({ queued: r.queued, ...(r.reason ? { reason: r.reason } : {}) });

/** Queue a transactional email. Respects the merchant's on/off setting and the 25/store/day + 250/day caps (overflow is deferred to the next day, never dropped). */
export async function queueEmail(input: QueueEmailInput, now = new Date()): Promise<QueueResult> {
  const shopRow = await shopFor(input.shop);
  if (!shopRow || shopRow.uninstalledAt) return { queued: false, reason: "disabled" };
  const settings = readSettings(shopRow.settings);
  let to = input.to?.trim() ?? "";

  if ((APPLICANT_EMAIL_TYPES as string[]).includes(input.type)) {
    if (!settings.notifications.emails[input.type as EmailType].enabled) return { queued: false, reason: "disabled" };
  } else if (isMerchantType(input.type)) {
    const mode = settings.notifications.merchant.mode;
    if (mode === "off") return { queued: false, reason: "disabled" };
    if (input.type === "merchant_new_application") {
      if (mode !== "instant") return { queued: false, reason: "disabled" };
      // Instant alerts share the store's 25/day. When today is full we don't
      // defer them: the daily digest lists every pending application anyway.
      const used = await db.emailLog.count({ where: { shop: input.shop, quotaDay: utcDay(now), status: COUNTED } });
      if (used >= SHOP_DAILY_CAP) return { queued: false, reason: "quota_deferred" };
    }
    to ||= merchantAddress(settings, shopRow.email) ?? "";
  }
  if (!EMAIL_RE.test(to)) return { queued: false, reason: "invalid_recipient" };

  return publicResult(await enqueue(input.shop, input.type, { to, locale: input.locale, vars: input.vars, subjectId: input.subjectId }, now));
}

/** New-application alert for the merchant (instant mode only; capped, falls back to the digest). */
export async function notifyMerchantNewApplication(shop: string, a: { applicationId: string; company: string }): Promise<QueueResult> {
  return queueEmail({
    shop,
    type: "merchant_new_application",
    to: "",
    locale: "",
    vars: { company: a.company, admin_url: adminAppUrl(shop, `/app/applications/${a.applicationId}`) },
    subjectId: a.applicationId,
  });
}

/** Link into the embedded app; Shopify admin redirects /admin/apps/<key> to the app. */
export function adminAppUrl(shop: string, path = ""): string {
  return `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY ?? ""}${path}`;
}

/** "Send test to me": renders `template` (with unsaved edits) in `locale`. Counts toward the caps like any email. */
export async function sendTestEmail(
  shop: string,
  template: TemplateType,
  locale: string,
  to: string,
  draft?: { subject?: string; body?: string },
  vars: Record<string, string | number> = {},
): Promise<QueueResult> {
  if (!EMAIL_RE.test(to.trim())) return { queued: false, reason: "invalid_recipient" };
  return publicResult(await enqueue(shop, "test", { to: to.trim(), locale, vars, template, draft }, new Date()));
}

/** Daily merchant digest (idempotent per UTC day). Returns true when queued. */
export async function queueMerchantDigest(shop: string, counts: DigestCounts, now = new Date()): Promise<boolean> {
  const shopRow = await shopFor(shop);
  if (!shopRow || shopRow.uninstalledAt) return false;
  const settings = readSettings(shopRow.settings);
  if (settings.notifications.merchant.mode === "off") return false;
  if (!Object.values(counts).some((n) => n > 0)) return false;
  const to = merchantAddress(settings, shopRow.email);
  if (!to || !EMAIL_RE.test(to)) return false;
  const start = new Date(`${utcDay(now)}T00:00:00Z`);
  const already = await db.emailLog.count({ where: { shop, type: "merchant_digest", createdAt: { gte: start, lt: new Date(start.getTime() + 86_400_000) } } });
  if (already) return false;
  await enqueue(shop, "merchant_digest", { to, locale: shopRow.primaryLocale, vars: { admin_url: adminAppUrl(shop) }, digest: counts }, now);
  return true;
}

export type EmailQuota = { shopUsed: number; shopCap: number; globalUsed: number; globalCap: number; deferred: number };

export async function emailQuotaToday(shop: string, now = new Date()): Promise<EmailQuota> {
  const today = utcDay(now);
  const [shopUsed, globalUsed, deferred] = await Promise.all([
    db.emailLog.count({ where: { shop, quotaDay: today, status: COUNTED } }),
    db.emailLog.count({ where: { quotaDay: today, status: COUNTED } }),
    db.emailLog.count({ where: { shop, status: "queued", quotaDay: { gt: today } } }),
  ]);
  return { shopUsed, shopCap: SHOP_DAILY_CAP, globalUsed, globalCap: GLOBAL_DAILY_CAP, deferred };
}

// ---------------------------------------------------------------- sending

type Sender = (e: OutgoingEmail) => Promise<SendResult>;
type ShopRow = NonNullable<Awaited<ReturnType<typeof shopFor>>>;

function render(row: { type: string; id: string }, p: Payload, s: ShopRow) {
  const settings = readSettings(s.settings);
  const storeName = s.name || s.shop.replace(/\.myshopify\.com$/, "");
  const type = (row.type === "test" ? p.template : row.type) as TemplateType;
  return buildEmail({
    type,
    locale: p.locale || s.primaryLocale,
    primary: s.primaryLocale,
    overrides: settings.texts,
    vars: p.vars,
    storeName,
    logoUrl: settings.branding.logoUrl,
    draft: p.draft,
    test: row.type === "test",
    digest: p.digest,
  });
}

const clear = Prisma.DbNull;

/** Send one claimed-or-claimable email. Returns "sent" | "retry" | "failed" | "skipped" | "busy". */
export async function sendOne(id: string, send: Sender = sendViaBrevo, cache = new Map<string, ShopRow | null>()) {
  if (send === sendViaBrevo && !brevoConfigured()) return "busy" as const;
  const claimed = await db.emailLog.updateMany({ where: { id, status: "queued" }, data: { status: "sending" } });
  if (claimed.count !== 1) return "busy" as const;
  const row = await db.emailLog.findUniqueOrThrow({ where: { id } });
  const p = row.payload as Payload | null;
  if (!cache.has(row.shop)) cache.set(row.shop, await shopFor(row.shop));
  const s = cache.get(row.shop);
  const settings = s ? readSettings(s.settings) : null;
  // The merchant may have turned the email off (or uninstalled) after it was queued.
  const turnedOff =
    !p || !s || s.uninstalledAt ||
    ((APPLICANT_EMAIL_TYPES as string[]).includes(row.type) && !settings!.notifications.emails[row.type as EmailType].enabled);
  if (turnedOff) {
    await db.emailLog.update({ where: { id }, data: { status: "skipped", payload: clear } });
    return "skipped" as const;
  }
  const email = render(row, p!, s!);
  const replyTo = isMerchantType(row.type) || row.type === "test" ? null : s!.email;
  const result = await send({
    to: p!.to,
    senderName: isMerchantType(row.type) ? "Tradepass" : s!.name || s!.shop.replace(/\.myshopify\.com$/, ""),
    replyTo,
    subject: email.subject,
    html: email.html,
    text: email.text,
    tag: row.type,
    idempotencyKey: row.id,
  });
  if (result.ok) {
    await db.emailLog.update({ where: { id }, data: { status: "sent", sentAt: new Date(), payload: clear } });
    return "sent" as const;
  }
  const attempts = (p!.attempts ?? 0) + 1;
  if (result.retry && attempts < MAX_ATTEMPTS) {
    await db.emailLog.update({ where: { id }, data: { status: "queued", payload: { ...p!, attempts } as object } });
    return "retry" as const;
  }
  await db.emailLog.update({ where: { id }, data: { status: "failed", payload: clear } });
  return "failed" as const;
}

/** Hourly: send what's due today within the caps and the time budget. Returns emails sent. */
export async function sendQueuedEmails(deadline: number, opts: { now?: Date; send?: Sender; limit?: number; shops?: string[] } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const send = opts.send ?? sendViaBrevo;
  const today = utcDay(now);
  // A crashed run can leave rows "sending"; Brevo's IdempotencyKey protects against a double send on retry.
  await db.emailLog.updateMany({
    where: { status: "sending", createdAt: { lt: new Date(now.getTime() - STUCK_SENDING_MS) } },
    data: { status: "queued" },
  });
  const due = await db.emailLog.findMany({
    where: { status: "queued", quotaDay: { lte: today }, ...(opts.shops ? { shop: { in: opts.shops } } : {}) },
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? GLOBAL_DAILY_CAP,
    select: { id: true, shop: true, quotaDay: true },
  });
  if (due.length && send === sendViaBrevo && !brevoConfigured()) throw new Error("BREVO_API_KEY / BREVO_SENDER_EMAIL not set");
  const cache = new Map<string, ShopRow | null>();
  let sent = 0;
  for (const row of due) {
    if (Date.now() > deadline) break;
    if (row.quotaDay < today) {
      // Left over from an earlier day (e.g. Brevo was down): it needs a slot today, or moves on.
      const day = await withQuotaLock(async (tx) => {
        await tx.emailLog.update({ where: { id: row.id }, data: { quotaDay: "0000-00-00" } }); // stop counting itself
        const d = await reserveDay(tx, row.shop, today);
        await tx.emailLog.update({ where: { id: row.id }, data: { quotaDay: d } });
        return d;
      });
      if (day > today) continue;
    }
    if ((await sendOne(row.id, send, cache)) === "sent") sent++;
  }
  return sent;
}
