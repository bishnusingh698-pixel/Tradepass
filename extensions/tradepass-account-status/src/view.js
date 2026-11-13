// Pure view model for the profile block (unit-tested in tests/messaging.test.ts).
/** @param {{ status: string, submittedAt: string, reapplyFrom?: string | null, statusUrl?: string } | null | undefined} a */
export function blockView(a) {
  if (!a || !["pending", "needs_info", "approved", "rejected"].includes(a.status)) return null;
  return {
    titleKey: `status.${a.status}`,
    tone: a.status === "approved" ? "success" : a.status === "needs_info" ? "warning" : a.status === "rejected" ? "critical" : "info",
    submitted: a.submittedAt ? a.submittedAt.slice(0, 10) : null,
    reapplyFrom: a.status === "rejected" && a.reapplyFrom ? a.reapplyFrom : null,
    url: typeof a.statusUrl === "string" && /^https:\/\//.test(a.statusUrl) ? a.statusUrl : null,
  };
}
