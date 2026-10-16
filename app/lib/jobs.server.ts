import db from "../db.server";
import { safeEqual } from "./crypto.server";
import { areaDaily, areaHourly } from "./tasks";

// cron-job.org calls POST /jobs/hourly and /jobs/daily with the header
// `X-Tradepass-Job-Secret`. Each run must finish in ~2 minutes, so work is
// done in small batches with a time budget, and every task is idempotent:
// running it twice (or overlapping runs) never does the same thing twice.

export const JOB_SECRET_HEADER = "x-tradepass-job-secret";
export const TIME_BUDGET_MS = 100_000;

export function jobAuthorized(request: Request): boolean {
  const expected = process.env.JOB_SECRET;
  const got = request.headers.get(JOB_SECRET_HEADER);
  return Boolean(expected && got && safeEqual(got, expected));
}

export type TaskResult = { task: string; processed: number; ms: number; error?: string };
export type Task = { name: string; run: (deadline: number) => Promise<number> };

export async function runTasks(tasks: Task[], now = Date.now()): Promise<TaskResult[]> {
  const deadline = now + TIME_BUDGET_MS;
  const results: TaskResult[] = [];
  for (const task of tasks) {
    if (Date.now() > deadline) {
      results.push({ task: task.name, processed: 0, ms: 0, error: "skipped: time budget used" });
      continue;
    }
    const start = Date.now();
    try {
      const processed = await task.run(deadline);
      results.push({ task: task.name, processed, ms: Date.now() - start });
    } catch (e) {
      // Never include personal data in errors; messages here come from our own code/Prisma.
      results.push({ task: task.name, processed: 0, ms: Date.now() - start, error: (e as Error).message.slice(0, 200) });
    }
  }
  return results;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const coreHourly: Task[] = [
  {
    name: "prune-rate-limits",
    run: async () => {
      const cutoff = new Date(Date.now() - 2 * HOUR).toISOString().slice(0, 13);
      return (await db.rateHit.deleteMany({ where: { window: { lt: cutoff } } })).count;
    },
  },
  {
    name: "expire-link-tokens",
    // Keep used/expired token hashes 7 days so a reused link still shows "already used", then drop them.
    run: async () =>
      (await db.tokenUse.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * DAY) } } })).count,
  },
  {
    name: "release-stale-locks",
    run: async () => (await db.shopLock.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count,
  },
];

type RetentionSettings = { retention?: { months?: number } };

const coreDaily: Task[] = [
  {
    name: "retention-cleanup",
    run: async (deadline) => {
      let processed = 0;
      const shops = await db.shop.findMany({ where: { uninstalledAt: null }, select: { shop: true, settings: true } });
      for (const s of shops) {
        if (Date.now() > deadline) break;
        const months = (s.settings as RetentionSettings).retention?.months ?? 12;
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - months);
        const old = await db.application.findMany({
          where: { shop: s.shop, status: { in: ["rejected", "withdrawn"] }, decidedAt: { lt: cutoff } },
          select: { id: true },
          take: 200,
        });
        if (!old.length) continue;
        const ids = old.map((a) => a.id);
        await db.$transaction([
          db.applicationFile.deleteMany({ where: { shop: s.shop, applicationId: { in: ids } } }),
          db.certificate.deleteMany({ where: { shop: s.shop, applicationId: { in: ids }, buyerId: null } }),
          db.application.deleteMany({ where: { shop: s.shop, id: { in: ids } } }),
        ]);
        processed += ids.length;
      }
      return processed;
    },
  },
  {
    name: "prune-activity",
    // Activity older than 24 months is dropped to stay inside Neon's 0.5 GB.
    run: async () =>
      (await db.activityLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 730 * DAY) } } })).count,
  },
  {
    name: "prune-email-log",
    run: async () =>
      (await db.emailLog.deleteMany({ where: { status: { not: "queued" }, createdAt: { lt: new Date(Date.now() - 90 * DAY) } } })).count,
  },
];

// Area tasks first (they may queue emails), core housekeeping last.
export const hourlyTasks: Task[] = [...areaHourly, ...coreHourly];
export const dailyTasks: Task[] = [...areaDaily, ...coreDaily];
