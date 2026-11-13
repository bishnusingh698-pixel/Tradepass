import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { applicationForCustomer, statusLink, statusView } from "../lib/status.server";

// GET /account/status — the customer account profile block (extensions/tradepass-account-status).
// The extension sends its session token; Shopify's library verifies it (shop in `dest`, the
// signed-in customer in `sub`). Only that customer's newest application is returned.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);
  const shop = String(sessionToken.dest ?? "").replace(/^https?:\/\//, "");
  const sub = String(sessionToken.sub ?? "");
  const row = await db.shop.findUnique({ where: { shop }, select: { shop: true, domainUrl: true, uninstalledAt: true } });
  if (!row || row.uninstalledAt || !/^gid:\/\/shopify\/Customer\/\d+$/.test(sub)) return cors(Response.json({ application: null }));
  let admin = null;
  try {
    admin = (await (await import("../shopify.server")).unauthenticated.admin(shop)).admin;
  } catch {
    admin = null;
  }
  const appId = await applicationForCustomer(shop, sub, admin);
  const view = appId ? await statusView(shop, appId, new Date(), { withUpdateLink: false }) : null;
  if (!view || !appId) return cors(Response.json({ application: null }));
  return cors(Response.json({ application: { status: view.status, company: view.company, submittedAt: view.submittedAt, reapplyFrom: view.reapplyFrom, statusUrl: statusLink(row, shop, appId) } }));
};

// CORS preflight from the customer account extension.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { cors } = await authenticate.public.customerAccount(request);
  return cors(new Response(null, { status: 204 }));
};
