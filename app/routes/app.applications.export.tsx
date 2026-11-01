import type { LoaderFunctionArgs } from "react-router";
import { adminContext } from "../lib/context.server";
import { exportCsv, parseFilters } from "../lib/applications.server";

// CSV of the applications matching the queue's filters (resource route). The page downloads it with
// App Bridge's authenticated fetch, because a plain link carries no session token in the embedded admin.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const csv = await exportCsv(ctx.shop, null, parseFilters(new URL(request.url)));
  return new Response(`\uFEFF${csv}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="applications.csv"`, "Cache-Control": "no-store" },
  });
};
