// CONTRACT (owner: email/certificates area). Implementation replaces the stub bodies.
import type { EmailType } from "../settings";

export type AnyEmailType = EmailType | "merchant_new_application" | "merchant_digest" | "test";

export type QueueEmailInput = {
  shop: string;
  type: AnyEmailType;
  to: string;
  locale: string; // recipient's language; falls back to store primary, then English
  vars: Record<string, string | number>; // {company} {first_name} {store_name} {tier_name} {login_url} {update_link} {expiry_date}
  subjectId?: string; // application / certificate id, for the log (never personal data)
};

export type QueueResult = { queued: boolean; reason?: "disabled" | "quota_deferred" };

/** Queue a transactional email. Respects the merchant's on/off setting and the 25/store/day + 250/day caps (overflow is deferred to the next day, never dropped). */
export async function queueEmail(_input: QueueEmailInput): Promise<QueueResult> {
  throw new Error("queueEmail not implemented yet");
}

export type EmailQuota = { shopUsed: number; shopCap: number; globalUsed: number; globalCap: number; deferred: number };

export async function emailQuotaToday(_shop: string): Promise<EmailQuota> {
  throw new Error("emailQuotaToday not implemented yet");
}
