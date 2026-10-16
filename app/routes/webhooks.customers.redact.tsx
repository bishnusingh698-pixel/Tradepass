import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { redactCustomer } from "../lib/privacy.server";

// Mandatory compliance webhook: delete what we hold about this customer.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const customer = (payload as { customer?: { id?: number; email?: string } }).customer ?? {};
  await redactCustomer(shop, customer);
  return new Response();
};
