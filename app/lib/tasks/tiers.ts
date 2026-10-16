import type { Task } from "../jobs.server";
import db from "../../db.server";
import type { Admin } from "../gql.server";

// Scheduled work for the tiers area. Each task: small batches, idempotent, respects `deadline`.
// shopify.server and the tiers/approval modules load lazily so /jobs and its tests don't need Shopify config.

async function offlineAdmin(shop: string): Promise<Admin> {
  const { unauthenticated } = await import("../../shopify.server");
  const { admin } = await unauthenticated.admin(shop);
  return admin;
}

export const hourly: Task[] = [
  {
    // Merchant edited/deleted a tier's market or catalog in Shopify admin → "Changed in Shopify" with a fix button.
    name: "tiers-sync",
    run: async (deadline) => {
      const { syncTiers } = await import("../tiers.server");
      const shops = await db.tier.findMany({ where: { shop: { in: (await db.shop.findMany({ where: { uninstalledAt: null }, select: { shop: true } })).map((s) => s.shop) } }, select: { shop: true }, distinct: ["shop"] });
      let n = 0;
      for (const { shop } of shops) {
        if (Date.now() > deadline) break;
        try {
          n += (await syncTiers(await offlineAdmin(shop), shop)).checked;
        } catch {
          // shop without a valid offline session (e.g. mid-uninstall): try again next hour
        }
      }
      return n;
    },
  },
  {
    // Approvals that stopped on a transient error (lock busy, concurrent market edit, network) continue by themselves.
    name: "approval-retry",
    run: async (deadline) => {
      const { retryStuckApprovals } = await import("../approval.server");
      return retryStuckApprovals(deadline, offlineAdmin);
    },
  },
];
export const daily: Task[] = [];
