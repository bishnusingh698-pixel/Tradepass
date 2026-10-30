import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Keep the shop's Tradepass data until shop/redact (48 h later) so a quick
// reinstall restores it. Sessions go now so reinstall runs a fresh OAuth.
// Shopify cancels the app's subscription on uninstall, so the stored plan goes
// back to Free: a reinstall must not keep paid features without a new charge.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  await db.session.deleteMany({ where: { shop } });
  await db.shop.updateMany({ where: { shop }, data: { uninstalledAt: new Date(), billingPlan: "free", subscriptionGid: null } });
  await db.job.deleteMany({ where: { shop, type: "storefront_sync" } });
  return new Response();
};
