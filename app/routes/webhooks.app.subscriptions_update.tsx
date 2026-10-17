import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { planForSubscriptionName } from "../lib/billing.server";
import { syncStorefrontConfig } from "../lib/storefront-sync.server";

type Payload = { app_subscription?: { admin_graphql_api_id?: string; name?: string; status?: string } };

// Keeps Shop.billingPlan in step with Shopify when a subscription is approved,
// cancelled, declined, frozen or expires outside our Plans page. Losing a paid
// plan this way never turns wholesale-only mode off: the store stays closed to
// the public, and the merchant decides on the Storefront page.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, admin } = await authenticate.webhook(request);
  const sub = (payload as Payload).app_subscription;
  if (!sub?.admin_graphql_api_id) return new Response();
  const row = await db.shop.findUnique({ where: { shop }, select: { subscriptionGid: true, billingPlan: true } });
  if (sub.status === "ACTIVE") {
    await db.shop.updateMany({ where: { shop }, data: { billingPlan: planForSubscriptionName(sub.name), subscriptionGid: sub.admin_graphql_api_id } });
  } else if (row?.subscriptionGid === sub.admin_graphql_api_id) {
    await db.shop.updateMany({ where: { shop }, data: { billingPlan: "free", subscriptionGid: null } });
  }
  // Plan-dependent storefront parts (the Free plan's "Powered by Tradepass" link) follow the new plan.
  const after = await db.shop.findUnique({ where: { shop }, select: { billingPlan: true } });
  if (admin && after && after.billingPlan !== row?.billingPlan) await syncStorefrontConfig(admin, shop).catch(() => undefined);
  return new Response();
};
