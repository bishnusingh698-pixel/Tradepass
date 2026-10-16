import type { ActionFunctionArgs } from "react-router";
import { jobAuthorized, dailyTasks, runTasks } from "../lib/jobs.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (!jobAuthorized(request)) return new Response(null, { status: 401 });
  const results = await runTasks(dailyTasks);
  return Response.json({ ok: results.every((r) => !r.error), results });
};

export const loader = () => new Response(null, { status: 405 });
