import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteShopData } from "../lib/privacy.server";

// Mandatory compliance webhook, sent 48 hours after uninstall: delete everything for the shop.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  await deleteShopData(shop);
  return new Response();
};
