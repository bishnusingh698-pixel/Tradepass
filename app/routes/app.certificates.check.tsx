import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { adminContext } from "../lib/context.server";
import { can } from "../lib/plans";
import { markCertificateChecked, recheckCertificate } from "../lib/certificates.server";

// Resource route for the permit check on the application and certificate pages:
// intent=mark (staff checked it on the state's site) | intent=live (Texas open data, Starter+).
export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  const cert = await db.certificate.findFirst({ where: { shop: ctx.shop, id }, select: { id: true } });
  if (!cert) return { ok: false, intent, error: "not_found" };
  if (intent === "mark") return { ok: await markCertificateChecked(ctx.shop, id, ctx.actor), intent };
  if (intent === "live") {
    if (!can(ctx.plan, "tax_checks")) return { ok: false, intent, error: "plan" };
    const r = await recheckCertificate(ctx.shop, id, ctx.actor);
    return { ok: r.ok, intent, result: r.result, error: r.ok ? undefined : "not_checkable" };
  }
  return { ok: false, intent, error: "unknown_intent" };
};
