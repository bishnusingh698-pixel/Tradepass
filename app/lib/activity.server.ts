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
