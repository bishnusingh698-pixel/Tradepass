import db from "../../db.server";
import type { Task } from "../jobs.server";
import { readSettings } from "../settings";

// Scheduled work for the storefront area. Each task: small batches, idempotent, respects `deadline`.

const SHOPS_PER_RUN = 50;

/**
 * Collections and tags change without telling us, so the gated product handles
 * (used for product cards, quick add and predictive search) are re-resolved
 * hourly. Product pages also check tags/collections directly in Liquid, so a
 * stale list never un-hides a product page.
 */
const refreshGated: Task = {
  name: "storefront-refresh-gated",
  run: async (deadline) => {
    const shops = await db.shop.findMany({ where: { uninstalledAt: null }, select: { shop: true, settings: true } });
    const due = shops.filter((s) => {
      const sf = readSettings(s.settings).storefront;
      return sf.accessMode !== "show" && (sf.scope.type === "collections" || sf.scope.type === "tags");
    });
    if (!due.length) return 0;
    const { unauthenticated } = await import("../../shopify.server");
    const { refreshGatedHandles } = await import("../storefront-sync.server");
    let processed = 0;
    // More shops than one run can take: rotate through them hour by hour.
    const pages = Math.ceil(due.length / SHOPS_PER_RUN);
    const start = (new Date().getUTCHours() % pages) * SHOPS_PER_RUN;
    for (const s of due.slice(start, start + SHOPS_PER_RUN)) {
      if (Date.now() > deadline) break;
      try {
        const { admin } = await unauthenticated.admin(s.shop);
        if (await refreshGatedHandles(admin, s.shop)) processed++;
      } catch {
        // One shop's failure (no session, API error) must not stop the others.
      }
    }
    return processed;
  },
};

export const hourly: Task[] = [refreshGated];
export const daily: Task[] = [];
