// Keep-alive endpoint for cron-job.org (every 10 minutes). Must answer
// instantly and must never touch the database, so Neon can sleep.
export const loader = () =>
  new Response("ok", { status: 200, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" } });
