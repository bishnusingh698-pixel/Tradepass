import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { json, proxyContext } from "../lib/intake.server";
import { applicationForCustomer, statusLink, statusView } from "../lib/status.server";
import { clientIp, hashKey, hit, LIMITS } from "../lib/spam.server";

// GET /apps/tradepass/status — the logged-in customer's own application, for the theme blocks.
// Shopify's app proxy signs `logged_in_customer_id`, so a visitor only ever sees their own status;
// logged out, the answer is always "no application".
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await proxyContext(request);
  if (!ctx) return json({ ok: false, error: "unauthorized" }, 401);
  const id = ctx.loggedInCustomerId && /^\d+$/.test(ctx.loggedInCustomerId) ? ctx.loggedInCustomerId : null;
  if (!id) return json({ ok: true, application: null });
  if (!(await hit(`status:${hashKey("ip", clientIp(request))}`, LIMITS.updatePerIp * 3)).allowed) return json({ ok: false, error: "rate_limited" }, 429);
  let admin = null;
  try {
    admin = (await (await import("../shopify.server")).unauthenticated.admin(ctx.shop)).admin;
  } catch {
    admin = null; // no offline session: only applications linked by customer id are found
  }
  const appId = await applicationForCustomer(ctx.shop, `gid://shopify/Customer/${id}`, admin);
  const view = appId ? await statusView(ctx.shop, appId) : null;
  if (!view || !appId) return json({ ok: true, application: null });
  const shopRow = await db.shop.findUnique({ where: { shop: ctx.shop }, select: { shop: true, domainUrl: true } });
  return json({ ok: true, application: { ...view, statusUrl: statusLink(shopRow, ctx.shop, appId) } });
};
