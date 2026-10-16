import type { LoaderFunctionArgs } from "react-router";
import { adminContext } from "../lib/context.server";
import { homeNumbers } from "../lib/home.server";

// Resource route: Home loads its 30-day numbers from here after the page is
// shown, because the orders part needs a Shopify query.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  return homeNumbers(ctx.admin, ctx.shop);
};
