// Buyer list constants shared by the server and the Buyers page.
export const CERT_FILTERS = ["valid", "expiring", "expired", "pending", "none"] as const;
export type CertSummary = (typeof CERT_FILTERS)[number];
