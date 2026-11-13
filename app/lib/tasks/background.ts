import db from "../../db.server";
import type { Task } from "../jobs.server";

// Durable background work queued from requests that must answer fast:
//  - intake_followup: merchant alert, Flow trigger and automation rules after a
//    storefront submission (normally done seconds after submit; this picks up
//    any run the process didn't finish).
//  - delete_files: remove applicant documents from the merchant's Shopify Files
//    after a customers/redact request (the webhook must answer in seconds).
//  - storefront_sync: a push of the storefront settings to Shopify that failed.
//    Retried every hour for as long as the store has the app installed: a
//    stale config can leave a wholesale-only store open or lock out retail
//    customers, so it never gives up (a newer successful push removes the job).
// Jobs are claimed with a guarded update, so overlapping runs never take the same job twice.

export const DELETE_FILES_JOB = "delete_files";
export const STOREFRONT_SYNC = "storefront_sync";
//  - buyer_marker: the paused marker on a company (checkout lock, N1) couldn't be written or removed.
export const BUYER_MARKER = "buyer_marker";
const TYPES = ["intake_followup", DELETE_FILES_JOB, STOREFRONT_SYNC, BUYER_MARKER];
const MAX_ATTEMPTS = 5;

async function claim(id: string): Promise<boolean> {
  const r = await db.job.updateMany({ where: { id, state: "queued" }, data: { state: "running", lockedAt: new Date(), attempts: { increment: 1 } } });
  return r.count === 1;
}

async function finish(id: string, ok: boolean, attempts: number, error?: string, retryForever = false) {
  await db.job.update({
    where: { id },
    data: ok
      ? { state: "done", error: null }
      : attempts >= MAX_ATTEMPTS && !retryForever
        ? { state: "failed", error: error?.slice(0, 200) ?? null }
        : { state: "queued", error: error?.slice(0, 200) ?? null, runAfter: new Date(Date.now() + 60 * 60_000) },
  });
}

export async function runBackgroundJobs(deadline: number, now = new Date()): Promise<number> {
  // A run that crashed while holding a job: hand it back after 30 minutes.
  await db.job.updateMany({
    where: { type: { in: TYPES }, state: "running", lockedAt: { lt: new Date(now.getTime() - 30 * 60_000) } },
    data: { state: "queued" },
  });
  const jobs = await db.job.findMany({
    where: { type: { in: TYPES }, state: "queued", runAfter: { lte: now } },
    orderBy: { runAfter: "asc" },
    take: 100,
  });
  let n = 0;
  for (const job of jobs) {
    if (Date.now() > deadline) break;
    if (!(await claim(job.id))) continue;
    const payload = (job.payload ?? {}) as { applicationId?: string; fileGids?: string[]; buyerId?: string; kind?: string };
    try {
      if (job.type === "intake_followup" && payload.applicationId && payload.kind === "info") {
        const { infoReceivedFollowup } = await import("../intake.server");
        await infoReceivedFollowup(job.shop, payload.applicationId);
      } else if (job.type === "intake_followup" && payload.applicationId) {
        const { intakeFollowups } = await import("../intake.server");
        await intakeFollowups(job.shop, payload.applicationId);
      } else if (job.type === DELETE_FILES_JOB && payload.fileGids?.length) {
        const { deleteShopifyFiles } = await import("../jobs.server");
        await deleteShopifyFiles(job.shop, payload.fileGids);
      } else if (job.type === STOREFRONT_SYNC) {
        const row = await db.shop.findUnique({ where: { shop: job.shop }, select: { uninstalledAt: true } });
        // Uninstalled: Shopify removed the metafields anyway, and reinstalling pushes them again.
        if (row && !row.uninstalledAt) await syncWith(job.shop);
      } else if (job.type === BUYER_MARKER && payload.buyerId) {
        const row = await db.shop.findUnique({ where: { shop: job.shop }, select: { uninstalledAt: true } });
        if (row && !row.uninstalledAt) await storefrontRetry.marker(job.shop, payload.buyerId);
      }
      await finish(job.id, true, job.attempts + 1);
      n++;
    } catch (e) {
      // A stale storefront config or paused marker can let the wrong people check out: never give up.
      await finish(job.id, false, job.attempts + 1, (e as Error).message, job.type === STOREFRONT_SYNC || job.type === BUYER_MARKER);
    }
  }
  // Finished jobs are only bookkeeping: keep a week for support, then drop them.
  await db.job.deleteMany({ where: { type: { in: TYPES }, state: { in: ["done", "failed"] }, createdAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } } });
  return n;
}

/** Seam for tests: push the storefront config for a shop with its offline token. */
export const storefrontRetry = {
  push: async (shop: string) => {
    const { unauthenticated } = await import("../../shopify.server");
    const { pushStorefrontConfig } = await import("../storefront-sync.server");
    await pushStorefrontConfig((await unauthenticated.admin(shop)).admin, shop);
  },
  /** Write the paused marker to match the buyer's current status (throws on failure, so the job retries). */
  marker: async (shop: string, buyerId: string) => {
    const { unauthenticated } = await import("../../shopify.server");
    const { writePausedMarkers } = await import("../buyer-marker.server");
    const b = await db.buyer.findFirst({ where: { shop, id: buyerId }, select: { companyGid: true, status: true } });
    if (b) await writePausedMarkers((await unauthenticated.admin(shop)).admin, [b.companyGid], b.status === "paused");
  },
};
const syncWith = (shop: string) => storefrontRetry.push(shop);

export const hourly: Task[] = [{ name: "background-jobs", run: (deadline) => runBackgroundJobs(deadline) }];
export const daily: Task[] = [];
