import db from "../../db.server";
import type { Task } from "../jobs.server";
import { queueMerchantDigest, sendQueuedEmails, utcDay } from "../email/index.server";
import { readSettings } from "../settings";

// Scheduled work for the emails area. Each task: small batches, idempotent, respects `deadline`.

/** Counts for one shop's merchant digest (ids/counts only, no personal data). */
export async function digestCounts(shop: string, now = new Date()) {
  const [pending, expiring, expired, failed, deferred] = await Promise.all([
    db.application.count({ where: { shop, status: "pending" } }),
    db.certificate.count({ where: { shop, status: "expiring" } }),
    db.certificate.count({ where: { shop, status: "expired", decidedOnExpiry: null, buyerId: { not: null } } }),
    db.activityLog.count({ where: { shop, result: "failed", createdAt: { gte: new Date(now.getTime() - 86_400_000) } } }),
    db.emailLog.count({ where: { shop, status: "queued", quotaDay: { gt: utcDay(now) } } }),
  ]);
  return { pending, expiring, expired, failed, deferred };
}

export const hourly: Task[] = [
  { name: "send-queued-emails", run: (deadline) => sendQueuedEmails(deadline) },
];

export const daily: Task[] = [
  {
    name: "merchant-digest",
    run: async (deadline) => {
      let queued = 0;
      const shops = await db.shop.findMany({ where: { uninstalledAt: null }, select: { shop: true, settings: true } });
      for (const s of shops) {
        if (Date.now() > deadline) break;
        if (readSettings(s.settings).notifications.merchant.mode === "off") continue;
        if (await queueMerchantDigest(s.shop, await digestCounts(s.shop))) queued++;
      }
      return queued;
    },
  },
];
