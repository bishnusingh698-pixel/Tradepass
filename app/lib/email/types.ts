import type { EmailType } from "../settings";

// Email kinds and their placeholders. Client-safe (no catalogs, no DB).

export const APPLICANT_EMAIL_TYPES: EmailType[] = ["received", "needs_info", "approved", "rejected", "cert_expiring", "cert_expired"];
export const MERCHANT_EMAIL_TYPES = ["merchant_new_application", "merchant_digest"] as const;
export type MerchantEmailType = (typeof MERCHANT_EMAIL_TYPES)[number];
export type TemplateType = EmailType | MerchantEmailType;

/** The spec's seven placeholders work in every applicant email (empty when not relevant). */
export const STANDARD_PLACEHOLDERS = ["company", "first_name", "store_name", "tier_name", "login_url", "update_link", "expiry_date"] as const;

/** Optional extras some emails carry (also empty when absent). */
export const EXTRA_PLACEHOLDERS: Partial<Record<TemplateType, string[]>> = {
  needs_info: ["message"],
  rejected: ["reason"],
  approved: ["terms"],
  merchant_new_application: ["admin_url"],
  merchant_digest: ["admin_url"],
};

/** Placeholders shown to the merchant for one email (most relevant first). */
export const RELEVANT_PLACEHOLDERS: Record<TemplateType, string[]> = {
  received: ["company", "first_name", "store_name"],
  needs_info: ["company", "first_name", "store_name", "update_link", "message"],
  approved: ["company", "first_name", "store_name", "tier_name", "login_url", "terms"],
  rejected: ["company", "first_name", "store_name", "reason"],
  cert_expiring: ["company", "first_name", "store_name", "expiry_date", "update_link"],
  cert_expired: ["company", "first_name", "store_name", "expiry_date", "update_link"],
  merchant_new_application: ["company", "store_name", "admin_url"],
  merchant_digest: ["store_name", "admin_url"],
};

export function allowedPlaceholders(type: TemplateType): string[] {
  return [...STANDARD_PLACEHOLDERS, ...(EXTRA_PLACEHOLDERS[type] ?? []), "message", "reason", "terms"];
}

export const isMerchantType = (t: string): t is MerchantEmailType => (MERCHANT_EMAIL_TYPES as readonly string[]).includes(t);

export const subjectKey = (type: TemplateType) => `email.${type}.subject`;
export const bodyKey = (type: TemplateType) => `email.${type}.body`;
