// CONTRACT (owner: email/certificates area). Implementation replaces the stub bodies.

export type CertificateStatus = "pending" | "valid" | "expiring" | "expired" | "rejected";

/** Status from dates and review state; "expiring" when within `expiringDays` of expiry. */
export function certificateStatus(_c: { expiresOn: Date | null; status: string }, _expiringDays: number, _now = new Date()): CertificateStatus {
  throw new Error("certificateStatus not implemented yet");
}

/** Send renewal requests (secure upload link) for the buyers' certificates. Returns how many were queued. */
export async function requestRenewalForBuyers(_shop: string, _buyerIds: string[]): Promise<number> {
  throw new Error("requestRenewalForBuyers not implemented yet");
}

/** Create Certificate rows for files uploaded with an application. */
export async function recordApplicationCertificates(
  _shop: string,
  _applicationId: string,
  _files: { fileGid: string; type: string; country?: string | null; region?: string | null; number?: string | null; expiresOn?: string | null }[],
): Promise<void> {
  throw new Error("recordApplicationCertificates not implemented yet");
}
