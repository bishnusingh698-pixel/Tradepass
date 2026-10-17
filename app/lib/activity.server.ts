import db from "../db.server";

/**
 * Every action that changes Shopify data writes one entry: who, what, when, result.
 * `subject` and `detail` must hold ids / codes only — never names, emails or tax numbers.
 */
export async function logActivity(entry: {
  shop: string;
  actor: string;
  action: string;
  subject?: string | null;
  result?: "ok" | "failed";
  detail?: Record<string, unknown>;
}): Promise<void> {
  await db.activityLog.create({
    data: {
      shop: entry.shop,
      actor: entry.actor,
      action: entry.action,
      subject: entry.subject ?? null,
      result: entry.result ?? "ok",
      detail: (entry.detail as object) ?? undefined,
    },
  });
}

/** Staff identity for the activity log from an admin session (online sessions carry the user). */
export function staffActor(session: { onlineAccessInfo?: { associated_user?: { id?: number; first_name?: string; last_name?: string } } }): string {
  const u = session.onlineAccessInfo?.associated_user;
  const name = [u?.first_name, u?.last_name].filter(Boolean).join(" ");
  return name || (u?.id ? `staff:${u.id}` : "staff");
}

// ---------------------------------------------------------------- export (Pro)

/** Newest entries first; the cap keeps one download well under a few MB. */
export const ACTIVITY_EXPORT_MAX_ROWS = 10_000;
export const ACTIVITY_CSV_COLUMNS = ["createdAt", "actor", "action", "subject", "result", "detail"] as const;

// Detail is meant to hold ids and codes only; these are dropped anyway in case an entry ever carried them.
const SECRET_KEY = /secret|token|password|passwd|apikey|api_key|signature|hmac|cookie|authorization/i;
const PERSONAL_KEY = /^(e-?mail|phone|address\d?|billingAddress|shippingAddress|taxNumber|tax_number|firstName|lastName|first_name|last_name|name|contactName|company|companyName|ip|ipHash)$/i;
const EMAIL_IN_TEXT = /[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[A-Za-z]{2,}/g;

function cleanValue(v: unknown, depth: number): unknown {
  if (typeof v === "string") return v.replace(EMAIL_IN_TEXT, "[email]").slice(0, 200);
  if (typeof v === "number" || typeof v === "boolean" || v === null) return v;
  if (Array.isArray(v)) return depth > 2 ? undefined : v.slice(0, 50).map((x) => cleanValue(x, depth + 1));
  if (v && typeof v === "object") return depth > 2 ? undefined : cleanDetail(v as Record<string, unknown>, depth + 1);
  return undefined;
}

/** Activity detail as exported: no secrets, no personal data, short values. */
export function cleanDetail(detail: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (SECRET_KEY.test(k) || PERSONAL_KEY.test(k)) continue;
    const c = cleanValue(v, depth);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  // Neutralise spreadsheet formulas (CSV injection).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The shop's activity log as CSV (Pro: "activity export"). Who, what, when and
 * result, as recorded: `actor` is the staff member's name as Shopify gave it, or
 * "system", "applicant", "automation", "flow". Subjects are our ids or Shopify GIDs.
 */
export async function exportActivityCsv(shop: string): Promise<{ csv: string; rows: number; truncated: boolean }> {
  const rows = await db.activityLog.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: ACTIVITY_EXPORT_MAX_ROWS + 1,
    select: { createdAt: true, actor: true, action: true, subject: true, result: true, detail: true },
  });
  const truncated = rows.length > ACTIVITY_EXPORT_MAX_ROWS;
  const lines = [ACTIVITY_CSV_COLUMNS.join(",")];
  for (const r of rows.slice(0, ACTIVITY_EXPORT_MAX_ROWS)) {
    const d = r.detail && typeof r.detail === "object" && !Array.isArray(r.detail) ? cleanDetail(r.detail as Record<string, unknown>) : {};
    lines.push(
      [r.createdAt.toISOString(), r.actor, r.action, r.subject ?? "", r.result, Object.keys(d).length ? JSON.stringify(d) : ""].map(csvCell).join(","),
    );
  }
  return { csv: lines.join("\r\n") + "\r\n", rows: Math.min(rows.length, ACTIVITY_EXPORT_MAX_ROWS), truncated };
}
