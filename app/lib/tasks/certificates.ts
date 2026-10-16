import db from "../../db.server";
import type { Task } from "../jobs.server";
import { runCertificateDay } from "../certificates.server";
import { can, effectivePlan } from "../plans";

// Scheduled work for the certificates area. Each task: small batches, idempotent, respects `deadline`.
export const hourly: Task[] = [];

export const daily: Task[] = [
  {
    // Status refresh, Flow triggers, 30/7-day renewal emails and expiry handling.
    // Reminders are claimed atomically, so a rerun the same day sends nothing twice.
    name: "certificate-expiry",
    run: async (deadline) => {
      let processed = 0;
      const shops = await db.shop.findMany({ where: { uninstalledAt: null }, select: { shop: true, billingPlan: true, isDevStore: true } });
      for (const s of shops) {
        if (Date.now() > deadline) break;
        if (!can(effectivePlan(s.billingPlan, s.isDevStore), "certificate_vault")) continue;
        try {
          processed += await runCertificateDay(s.shop, { deadline });
        } catch {
          // One shop's failure (e.g. revoked token) must not stop the others; tomorrow retries.
        }
      }
      return processed;
    },
  },
];
