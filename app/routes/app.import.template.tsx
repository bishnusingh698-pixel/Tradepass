import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { templateCsv } from "../lib/import.server";

// CSV template download (resource route).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return new Response(templateCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="tradepass-import-template.csv"',
    },
  });
};
