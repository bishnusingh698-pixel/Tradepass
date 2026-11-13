import db from "../db.server";
import { mutate, type Admin } from "./gql.server";

// Paused buyers in a wholesale-only store (REVIEW N1). Pausing takes the buyer's locations out of
// their tier's market, but the checkout lock lets any cart with a purchasing company through, so a
// paused buyer could still order (at retail prices). The company gets an app-owned marker
// `$app:tradepass.paused = true`, which the checkout Function reads from
// `purchasingCompany.company.metafield` (both verified with the Shopify dev toolkit against
// Admin 2026-10 and the cart-and-checkout-validation Function schema 2026-10).
// A failed write is queued as a `buyer_marker` job and retried hourly (background.ts).

export const MARKER_NAMESPACE = "$app:tradepass";
export const MARKER_KEY = "paused";
export const BUYER_MARKER_JOB = "buyer_marker";

const SET = `#graphql
  mutation BuyerPausedSet($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message code } } }`;
const DELETE = `#graphql
  mutation BuyerPausedDelete($metafields: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $metafields) { deletedMetafields { key namespace ownerId } userErrors { field message } } }`;

/** Write (paused) or remove (active) the marker on the given companies, 25 per call (metafieldsSet's limit). */
export async function writePausedMarkers(admin: Admin, companyGids: string[], paused: boolean): Promise<void> {
  for (let i = 0; i < companyGids.length; i += 25) {
    const ids = companyGids.slice(i, i + 25);
    if (paused) {
      await mutate(admin, "metafieldsSet", SET, {
        metafields: ids.map((ownerId) => ({ ownerId, namespace: MARKER_NAMESPACE, key: MARKER_KEY, type: "boolean", value: "true" })),
      });
    } else {
      await mutate(admin, "metafieldsDelete", DELETE, {
        metafields: ids.map((ownerId) => ({ ownerId, namespace: MARKER_NAMESPACE, key: MARKER_KEY })),
      });
    }
  }
}

/** Set the marker to match the buyer's status now; on failure queue a retry (never throws). */
export async function syncBuyerMarker(admin: Admin, shop: string, buyerId: string): Promise<boolean> {
  const b = await db.buyer.findFirst({ where: { shop, id: buyerId }, select: { companyGid: true, status: true } });
  if (!b) return true;
  try {
    await writePausedMarkers(admin, [b.companyGid], b.status === "paused");
    await db.job.deleteMany({ where: { shop, type: BUYER_MARKER_JOB, state: "queued", payload: { path: ["buyerId"], equals: buyerId } } });
    return true;
  } catch {
    const queued = await db.job.findFirst({ where: { shop, type: BUYER_MARKER_JOB, state: "queued", payload: { path: ["buyerId"], equals: buyerId } }, select: { id: true } });
    if (!queued) await db.job.create({ data: { shop, type: BUYER_MARKER_JOB, payload: { buyerId }, runAfter: new Date(Date.now() + 60 * 60_000) } });
    return false;
  }
}

/** After a reinstall Shopify has removed app-owned metafields: write the marker on every paused buyer again. */
export async function restorePausedMarkers(admin: Admin, shop: string): Promise<number> {
  const paused = await db.buyer.findMany({ where: { shop, status: "paused" }, select: { companyGid: true } });
  if (paused.length) await writePausedMarkers(admin, paused.map((b) => b.companyGid), true);
  return paused.length;
}
