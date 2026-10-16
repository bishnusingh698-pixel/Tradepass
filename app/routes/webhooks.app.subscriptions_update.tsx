import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { planForSubscriptionName } from "../lib/billing.server";

type Payload = { app_subscription?: { admin_graphql_api_id?: string; name?: string; status?: string } };

// Keeps Shop.billingPlan in step with Shopify when a subscription is approved,
// cancelled, declined, frozen or expires outside our Plans page. Losing a paid
// plan this way never turns wholesale-only mode off: the store stays closed to
// the public, and the merchant decides on the Storefront page.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const sub = (payload as Payload).app_subscription;
  if (!sub?.admin_graphql_api_id) return new Response();
  const row = await db.shop.findUnique({ where: { shop }, select: { subscriptionGid: true } });
  if (sub.status === "ACTIVE") {
    await db.shop.updateMany({ where: { shop }, data: { billingPlan: planForSubscriptionName(sub.name), subscriptionGid: sub.admin_graphql_api_id } });
  } else if (row?.subscriptionGid === sub.admin_graphql_api_id) {
    await db.shop.updateMany({ where: { shop }, data: { billingPlan: "free", subscriptionGid: null } });
  }
  return new Response();
};
