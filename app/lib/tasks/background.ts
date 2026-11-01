import db from "../../db.server";
import type { Task } from "../jobs.server";

// Durable background work queued from requests that must answer fast:
//  - intake_followup: merchant alert, Flow trigger and automation rules after a
//    storefront submission (normally done seconds after submit; this picks up
//    any run the process didn't finish).
//  - delete_files: remove applicant documents from the merchant's Shopify Files
//    after a customers/redact request (the webhook must answer in seconds).
// Jobs are claimed with a guarded update, so overlapping runs never take the same job twice.

export const DELETE_FILES_JOB = "delete_files";
const MAX_ATTEMPTS = 5;

async function claim(id: string): Promise<boolean> {
  const r = await db.job.updateMany({ where: { id, state: "queued" }, data: { state: "running", lockedAt: new Date(), attempts: { increment: 1 } } });
  return r.count === 1;
}

async function finish(id: string, ok: boolean, attempts: number, error?: string) {
  await db.job.update({
    where: { id },
    data: ok
      ? { state: "done", error: null }
      : attempts >= MAX_ATTEMPTS
        ? { state: "failed", error: error?.slice(0, 200) ?? null }
        : { state: "queued", error: error?.slice(0, 200) ?? null, runAfter: new Date(Date.now() + 60 * 60_000) },
  });
}

export async function runBackgroundJobs(deadline: number, now = new Date()): Promise<number> {
  // A run that crashed while holding a job: hand it back after 30 minutes.
  await db.job.updateMany({
    where: { type: { in: ["intake_followup", DELETE_FILES_JOB] }, state: "running", lockedAt: { lt: new Date(now.getTime() - 30 * 60_000) } },
    data: { state: "queued" },
  });
  const jobs = await db.job.findMany({
    where: { type: { in: ["intake_followup", DELETE_FILES_JOB] }, state: "queued", runAfter: { lte: now } },
    orderBy: { runAfter: "asc" },
    take: 100,
  });
  let n = 0;
  for (const job of jobs) {
    if (Date.now() > deadline) break;
    if (!(await claim(job.id))) continue;
    const payload = (job.payload ?? {}) as { applicationId?: string; fileGids?: string[] };
    try {
      if (job.type === "intake_followup" && payload.applicationId) {
        const { intakeFollowups } = await import("../intake.server");
        await intakeFollowups(job.shop, payload.applicationId);
      } else if (job.type === DELETE_FILES_JOB && payload.fileGids?.length) {
        const { deleteShopifyFiles } = await import("../jobs.server");
        await deleteShopifyFiles(job.shop, payload.fileGids);
      }
      await finish(job.id, true, job.attempts + 1);
      n++;
    } catch (e) {
      await finish(job.id, false, job.attempts + 1, (e as Error).message);
    }
  }
  // Finished jobs are only bookkeeping: keep a week for support, then drop them.
  await db.job.deleteMany({ where: { type: { in: ["intake_followup", DELETE_FILES_JOB] }, state: { in: ["done", "failed"] }, createdAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } } });
  return n;
}

export const hourly: Task[] = [{ name: "background-jobs", run: (deadline) => runBackgroundJobs(deadline) }];
export const daily: Task[] = [];
