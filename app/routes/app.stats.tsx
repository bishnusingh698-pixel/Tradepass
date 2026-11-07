import type { LoaderFunctionArgs } from "react-router";
import { adminContext } from "../lib/context.server";
import { homeNumbers } from "../lib/home.server";

// Resource route: Home loads its 30-day numbers from here after the page is
// shown, because the orders part needs a Shopify query.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const days = new URL(request.url).searchParams.get("days") === "90" ? 90 : 30;
  return homeNumbers(ctx.admin, ctx.shop, new Date(), days);
};
