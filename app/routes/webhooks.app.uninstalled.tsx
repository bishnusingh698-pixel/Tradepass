import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Keep the shop's Tradepass data until shop/redact (48 h later) so a quick
// reinstall restores it. Sessions go now so reinstall runs a fresh OAuth.
// Shopify cancels the app subscription on uninstall, so the cached plan goes
// back to Free at once; a reinstall reads the real subscription again.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  await db.session.deleteMany({ where: { shop } });
  await db.shop.updateMany({ where: { shop }, data: { uninstalledAt: new Date(), billingPlan: "free", subscriptionGid: null } });
  return new Response();
};
