import type { LoaderFunctionArgs } from "react-router";
import { json, proxyContext } from "../lib/intake.server";
import { gql } from "../lib/gql.server";
import { unauthenticated } from "../shopify.server";

// GET /apps/tradepass/prefill: name and email of the signed-in customer, for
// pages Liquid rendered before the visitor logged in (cached page). The form
// block normally prefills from Liquid and never calls this.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await proxyContext(request);
  if (!ctx) return json({ ok: false, error: "unauthorized" }, 401);
  if (!ctx.loggedInCustomerId || !/^\d+$/.test(ctx.loggedInCustomerId)) return json({ ok: true, prefill: null });
  try {
    const { admin } = await unauthenticated.admin(ctx.shop);
    const d = await gql<{ customer: { firstName: string | null; lastName: string | null; defaultEmailAddress: { emailAddress: string | null } | null } | null }>(
      admin,
      `#graphql
      query tpPrefill($id: ID!) { customer(id: $id) { firstName lastName defaultEmailAddress { emailAddress } } }`,
      { id: `gid://shopify/Customer/${ctx.loggedInCustomerId}` },
    );
    const c = d.customer;
    return json({ ok: true, prefill: c ? { firstName: c.firstName ?? "", lastName: c.lastName ?? "", email: c.defaultEmailAddress?.emailAddress ?? "" } : null });
  } catch {
    return json({ ok: true, prefill: null });
  }
};
