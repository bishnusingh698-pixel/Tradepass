// Certificate status rules shared by the server and the Certificates page
// (no server imports, so the page's component can use them).

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
