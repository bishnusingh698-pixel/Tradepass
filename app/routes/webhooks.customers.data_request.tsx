import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { recordDataRequest } from "../lib/privacy.server";

// Mandatory compliance webhook. authenticate.webhook verifies the HMAC and returns 401 if it's wrong.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const customer = (payload as { customer?: { id?: number; email?: string } }).customer ?? {};
  await recordDataRequest(shop, customer);
  return new Response();
};
