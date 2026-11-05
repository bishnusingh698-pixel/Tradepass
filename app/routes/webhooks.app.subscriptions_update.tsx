import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { enforcePlanLimits, planForSubscriptionName } from "../lib/billing.server";
import { syncStorefrontConfig } from "../lib/storefront-sync.server";
import { effectivePlan } from "../lib/plans";

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
  // Plan-dependent storefront parts (the Free plan's "Powered by Tradepass" link) and plan limits
  // follow the new plan. The push takes several Shopify calls, so it runs after the webhook has
  // been answered (Shopify allows 5 seconds); a failed push is queued and retried hourly.
  const after = await db.shop.findUnique({ where: { shop }, select: { billingPlan: true, isDevStore: true } });
  if (after && after.billingPlan !== row?.billingPlan) {
    await enforcePlanLimits(shop, effectivePlan(after.billingPlan, after.isDevStore));
    if (admin) void syncStorefrontConfig(admin, shop).catch(() => undefined);
  }
  return new Response();
};
