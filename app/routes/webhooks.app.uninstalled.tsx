import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Keep the shop's Tradepass data until shop/redact (48 h later) so a quick
// reinstall restores it. Sessions go now so reinstall runs a fresh OAuth.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  await db.session.deleteMany({ where: { shop } });
  await db.shop.updateMany({ where: { shop }, data: { uninstalledAt: new Date() } });
  return new Response();
};
