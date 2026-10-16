import db from "../../db.server";
import type { Task } from "../jobs.server";
import { can, effectivePlan } from "../plans";
import { processImportRun } from "../import.server";

// Scheduled work for the imports area. Each task: small batches, idempotent, respects `deadline`.
// The open Import page drives runs forward while the merchant watches; this
// picks up whatever is left (page closed, server restarted) from the cursor.
export const hourly: Task[] = [
  {
    name: "import-runs",
    run: async (deadline) => {
      let processed = 0;
      const runs = await db.importRun.findMany({ where: { state: "running" }, orderBy: { createdAt: "asc" }, take: 20, select: { id: true, shop: true } });
      if (!runs.length) return 0;
      // Loaded lazily so the jobs module doesn't pull in the Shopify app config unless there's work.
      const { unauthenticated } = await import("../../shopify.server");
      for (const r of runs) {
        if (Date.now() > deadline) break;
        const shop = await db.shop.findUnique({ where: { shop: r.shop }, select: { uninstalledAt: true, billingPlan: true, isDevStore: true } });
        // Downgraded or uninstalled: leave the run paused; it resumes if Pro comes back.
        if (!shop || shop.uninstalledAt || !can(effectivePlan(shop.billingPlan, shop.isDevStore), "import")) continue;
        try {
          const { admin } = await unauthenticated.admin(r.shop);
          processed += await processImportRun(admin, r.shop, r.id, deadline);
        } catch {
          // One shop's failure (e.g. revoked token) must not stop the others; next hour retries.
        }
      }
      return processed;
    },
  },
];
export const daily: Task[] = [];
