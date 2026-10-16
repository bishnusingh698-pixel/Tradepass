import type { ActionFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import { createT } from "../lib/i18n";
import { ACTION_HANDLE, handleFlowApprove, verifyFlowHmac, type FlowActionRequest } from "../lib/flow.server";

// Shopify Flow action endpoint ("Approve wholesale application to tier").
// Not an admin route: Flow signs the request body (x-shopify-hmac-sha256), and
// we act with the shop's offline token.

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

// Before the shop is known we can't pick its language; these only show for malformed requests.
const { t } = createT("en");

export const loader = () => new Response("Method not allowed", { status: 405 });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const raw = await request.text();
  if (!verifyFlowHmac(raw, request.headers.get("x-shopify-hmac-sha256"), process.env.SHOPIFY_API_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }
  let body: FlowActionRequest;
  try {
    body = JSON.parse(raw) as FlowActionRequest;
  } catch {
    return json(400, { message: t("flow.action.badRequest") });
  }
  if (body.handle !== ACTION_HANDLE) return json(400, { message: t("flow.action.badRequest") });
  const shop = body.shopify_domain ?? "";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return json(400, { message: t("flow.action.badRequest") });

  let admin;
  try {
    ({ admin } = await unauthenticated.admin(shop));
  } catch {
    // No offline session: the app is not installed (or was uninstalled) on this shop.
    return json(410, { message: t("flow.action.notInstalled") });
  }
  const res = await handleFlowApprove(admin, shop, body);
  return json(res.status, res.body, res.headers);
};
