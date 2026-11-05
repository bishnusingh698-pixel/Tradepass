import type { LoaderFunctionArgs } from "react-router";
import { adminContext } from "../lib/context.server";
import { exportBuyersCsv } from "../lib/buyers.server";

// CSV of every wholesale buyer (resource route), downloaded with App Bridge's authenticated fetch.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  return new Response(`\uFEFF${await exportBuyersCsv(ctx.shop, null)}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="buyers.csv"`, "Cache-Control": "no-store" },
  });
};
