import type { ActionFunctionArgs } from "react-router";
import { handleSubmit, json, proxyContext, readJsonBody } from "../lib/intake.server";
import { clientIp } from "../lib/spam.server";

// POST /apps/tradepass/submit (app proxy → /proxy/submit). The storefront form
// retries for up to 60 s with the same idempotency key, so this must be safe
// to repeat: a repeat returns the stored result.
export const loader = () => json({ ok: false, error: "method_not_allowed" }, 405);

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const ctx = await proxyContext(request);
  if (!ctx) return json({ ok: false, error: "unauthorized" }, 401);
  const body = await readJsonBody(request);
  if (!body) return json({ ok: false, error: "bad_request" }, 400);
  const res = await handleSubmit({ shop: ctx.shop, loggedInCustomerId: ctx.loggedInCustomerId, ip: clientIp(request) }, body);
  return json(res.body, res.http);
};
