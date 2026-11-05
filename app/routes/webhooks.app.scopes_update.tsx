import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Keeps the stored session's scopes in step when the merchant approves new scopes.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session } = await authenticate.webhook(request);
  const current = (payload as { current?: unknown } | undefined)?.current;
  if (session && Array.isArray(current)) {
    await db.session.updateMany({ where: { id: session.id }, data: { scope: current.map(String).join(",") } });
  }
  return new Response();
};
