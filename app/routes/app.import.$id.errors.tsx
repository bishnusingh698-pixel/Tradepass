import type { LoaderFunctionArgs } from "react-router";
import { adminContext } from "../lib/context.server";
import { errorReportCsv, getRun, type Issue } from "../lib/import.server";

// Downloadable error report for one import run (resource route).
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const run = await getRun(ctx.shop, params.id ?? "");
  if (!run) throw new Response("Not found", { status: 404 });
  const issues = (run.errors ?? []) as Issue[];
  const csv = errorReportCsv(
    issues,
    { message: (i) => ctx.t(`import.issue.${i.code}`), level: (i) => ctx.t(`import.level.${i.level}`) },
    [ctx.t("import.report.row"), ctx.t("import.report.column"), ctx.t("import.report.level"), ctx.t("import.report.message")],
  );
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tradepass-import-errors-${run.id}.csv"`,
    },
  });
};
