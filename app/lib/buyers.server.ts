/* eslint-disable @typescript-eslint/no-explicit-any -- GraphQL payloads are untyped JSON at this boundary */
import type { Buyer, Prisma } from "@prisma/client";
import db from "../db.server";
import { gql } from "./gql.server";
import { logActivity } from "./activity.server";
import { moveLocations, type Ctx } from "./tiers.server";

// Buyers: companies approved through, imported into or converted by Tradepass.
// We keep only GIDs + name; everything else (contact, terms, orders) is read
// from Shopify per page. Tradepass never deletes companies or customers.

export const BUYER_PAGE_SIZE = 25;
export const CERT_FILTERS = ["valid", "expiring", "expired", "pending", "none"] as const;
export type CertSummary = (typeof CERT_FILTERS)[number];

export type BuyerFilters = { tier?: string; cert?: CertSummary; country?: string; source?: string; status?: string; q?: string; page: number };

export function parseBuyerFilters(url: URL): BuyerFilters {
  const p = url.searchParams;
  const cert = p.get("cert");
  return {
    tier: p.get("tier") || undefined,
    cert: (CERT_FILTERS as readonly string[]).includes(cert ?? "") ? (cert as CertSummary) : undefined,
    country: p.get("country") || undefined,
    source: p.get("source") || undefined,
    status: p.get("status") || undefined,
    q: p.get("q")?.trim() || undefined,
    page: Math.max(1, Number(p.get("page")) || 1),
  };
}

/** Worst certificate status wins: one expired certificate makes the buyer "expired". */
export function summarizeCertificates(statuses: string[]): CertSummary {
  for (const s of ["expired", "expiring", "valid", "pending"] as const) if (statuses.includes(s)) return s;
  return "none";
}

async function certSummaries(shop: string, buyerIds: string[]): Promise<Record<string, CertSummary>> {
  const rows = await db.certificate.findMany({ where: { shop, buyerId: { in: buyerIds }, status: { not: "rejected" } }, select: { buyerId: true, status: true } });
  const by: Record<string, string[]> = {};
  for (const r of rows) (by[r.buyerId!] ??= []).push(r.status);
  return Object.fromEntries(buyerIds.map((id) => [id, summarizeCertificates(by[id] ?? [])]));
}

export type ShopifyBuyerInfo = {
  contactName: string | null;
  terms: string | null;
  taxExempt: boolean | null;
  orders: { count: number; total: string; currency: string } | null;
};

const INFO_BASE = `#graphql
  query BuyerInfo($ids: [ID!]!) { nodes(ids: $ids) { ... on Company { id
    locations(first: 1) { nodes { buyerExperienceConfiguration { paymentTermsTemplate { translatedName } } taxSettings { taxExempt } } } } } }`;
// mainContact.customer needs read_customers; ordersCount/totalSpent need read_orders. Tried first, dropped if not granted.
const INFO_FULL = `#graphql
  query BuyerInfoFull($ids: [ID!]!) { nodes(ids: $ids) { ... on Company { id
    mainContact { customer { displayName } }
    ordersCount { count } totalSpent { amount currencyCode }
    locations(first: 1) { nodes { buyerExperienceConfiguration { paymentTermsTemplate { translatedName } } taxSettings { taxExempt } } } } } }`;

export async function shopifyInfo(admin: Ctx["admin"], companyGids: string[]): Promise<Record<string, ShopifyBuyerInfo | null>> {
  if (!companyGids.length) return {};
  let nodes: any[] = [];
  try {
    nodes = (await gql(admin, INFO_FULL, { ids: companyGids })).nodes ?? [];
  } catch {
    try {
      nodes = (await gql(admin, INFO_BASE, { ids: companyGids })).nodes ?? [];
    } catch {
      return {};
    }
  }
  return Object.fromEntries(
    companyGids.map((gid, i) => {
      const n = nodes[i];
      if (!n) return [gid, null]; // deleted in Shopify
      const loc = n.locations?.nodes?.[0];
      return [gid, {
        contactName: n.mainContact?.customer?.displayName ?? null,
        terms: loc?.buyerExperienceConfiguration?.paymentTermsTemplate?.translatedName ?? null,
        taxExempt: loc ? Boolean(loc.taxSettings?.taxExempt) : null,
        orders: n.ordersCount ? { count: n.ordersCount.count, total: n.totalSpent?.amount ?? "0", currency: n.totalSpent?.currencyCode ?? "" } : null,
      }];
    }),
  );
}

export async function listBuyers(shop: string, f: BuyerFilters) {
  const where: Prisma.BuyerWhereInput = { shop };
  if (f.tier === "none") where.tierId = null;
  else if (f.tier) where.OR = [{ tierId: f.tier }, { pausedTierId: f.tier }];
  if (f.country) where.country = f.country;
  if (f.source) where.source = f.source;
  if (f.status) where.status = f.status;
  if (f.q) where.name = { contains: f.q, mode: "insensitive" };
  // Certificate status is derived, so filter after loading ids (buyer counts per shop are small).
  let all = await db.buyer.findMany({ where, orderBy: { approvedAt: "desc" }, select: { id: true } });
  const certs = await certSummaries(shop, all.map((b) => b.id));
  if (f.cert) all = all.filter((b) => certs[b.id] === f.cert);
  const total = all.length;
  const pageIds = all.slice((f.page - 1) * BUYER_PAGE_SIZE, f.page * BUYER_PAGE_SIZE).map((b) => b.id);
  const rows = await db.buyer.findMany({ where: { shop, id: { in: pageIds } }, orderBy: { approvedAt: "desc" } });
  return { rows: rows.map((b) => ({ ...b, cert: certs[b.id] ?? "none" })), total, pages: Math.max(1, Math.ceil(total / BUYER_PAGE_SIZE)) };
}

export async function buyerFilterOptions(shop: string) {
  const [countries, tiers] = await Promise.all([
    db.buyer.findMany({ where: { shop, country: { not: null } }, select: { country: true }, distinct: ["country"] }),
    db.tier.findMany({ where: { shop }, select: { id: true, name: true, mode: true, marketGid: true }, orderBy: { position: "asc" } }),
  ]);
  return { countries: countries.map((c) => c.country!).sort(), tiers };
}

export type MoveSummary = { moved: string[]; pending: string[]; failed: { id: string; name: string; code: string }[] };

/** Bulk "Move to tier…" (tierId null = remove from any tier). Each buyer is moved and read back. */
export async function moveBuyers(ctx: Ctx, buyerIds: string[], tierId: string | null): Promise<MoveSummary> {
  const out: MoveSummary = { moved: [], pending: [], failed: [] };
  const to = tierId ? await db.tier.findFirst({ where: { id: tierId, shop: ctx.shop } }) : null;
  if (tierId && !to) throw new Error("tier not found");
  const buyers = await db.buyer.findMany({ where: { shop: ctx.shop, id: { in: buyerIds } } });
  const tiers = await db.tier.findMany({ where: { shop: ctx.shop } });
  for (const b of buyers) {
    try {
      if (b.status === "paused") {
        // Paused buyers aren't in any market; Resume will use the new tier.
        await db.buyer.update({ where: { id: b.id }, data: { pausedTierId: tierId } });
      } else {
        const from = tiers.find((t) => t.id === b.tierId) ?? null;
        const res = await moveLocations(ctx, b.locationGids, from, to, { buyerId: b.id });
        await db.buyer.update({ where: { id: b.id }, data: { tierId } });
        if (!res.verified) out.pending.push(b.id);
      }
      out.moved.push(b.id);
      await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "buyer.move", subject: b.id, detail: { from: b.tierId ?? b.pausedTierId, to: tierId } });
    } catch (e) {
      const code = (e as { code?: string }).code ?? "shopify";
      out.failed.push({ id: b.id, name: b.name, code });
      await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "buyer.move", subject: b.id, result: "failed", detail: { to: tierId, code } });
    }
  }
  return out;
}

/** Pause: take the locations out of their tier market (buyer sees retail prices), remember the tier. */
export async function pauseBuyers(ctx: Ctx, buyerIds: string[]): Promise<MoveSummary> {
  const out: MoveSummary = { moved: [], pending: [], failed: [] };
  const buyers = await db.buyer.findMany({ where: { shop: ctx.shop, id: { in: buyerIds }, status: "active" } });
  for (const b of buyers) {
    try {
      const tier = b.tierId ? await db.tier.findFirst({ where: { id: b.tierId, shop: ctx.shop } }) : null;
      const res = tier ? await moveLocations(ctx, b.locationGids, tier, null, { buyerId: b.id }) : { verified: true };
      await db.buyer.update({ where: { id: b.id }, data: { status: "paused", pausedTierId: b.tierId, tierId: null } });
      (res.verified ? out.moved : out.pending).push(b.id);
      await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "buyer.pause", subject: b.id, detail: { tierId: b.tierId } });
    } catch (e) {
      const code = (e as { code?: string }).code ?? "shopify";
      out.failed.push({ id: b.id, name: b.name, code });
      await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "buyer.pause", subject: b.id, result: "failed", detail: { code } });
    }
  }
  return out;
}

export async function resumeBuyers(ctx: Ctx, buyerIds: string[]): Promise<MoveSummary> {
  const out: MoveSummary = { moved: [], pending: [], failed: [] };
  const buyers = await db.buyer.findMany({ where: { shop: ctx.shop, id: { in: buyerIds }, status: "paused" } });
  for (const b of buyers) {
    try {
      const tier = b.pausedTierId ? await db.tier.findFirst({ where: { id: b.pausedTierId, shop: ctx.shop } }) : null;
      const res = tier ? await moveLocations(ctx, b.locationGids, null, tier, { buyerId: b.id }) : { verified: true };
      await db.buyer.update({ where: { id: b.id }, data: { status: "active", tierId: tier?.id ?? null, pausedTierId: null } });
      (res.verified ? out.moved : out.pending).push(b.id);
      await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "buyer.resume", subject: b.id, detail: { tierId: tier?.id ?? null } });
    } catch (e) {
      const code = (e as { code?: string }).code ?? "shopify";
      out.failed.push({ id: b.id, name: b.name, code });
      await logActivity({ shop: ctx.shop, actor: ctx.actor, action: "buyer.resume", subject: b.id, result: "failed", detail: { code } });
    }
  }
  return out;
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // Neutralise spreadsheet formulas and quote everything.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

export async function exportBuyersCsv(shop: string, ids: string[] | null): Promise<string> {
  const [rows, tiers] = await Promise.all([
    db.buyer.findMany({ where: { shop, ...(ids ? { id: { in: ids } } : {}) }, orderBy: { approvedAt: "desc" } }),
    db.tier.findMany({ where: { shop }, select: { id: true, name: true } }),
  ]);
  const certs = await certSummaries(shop, rows.map((r) => r.id));
  const tierName = (id: string | null) => tiers.find((t) => t.id === id)?.name ?? "";
  const head = ["company", "tier", "status", "country", "source", "certificates", "tax_exemptions", "approved_at", "company_id"];
  const lines = rows.map((b: Buyer) =>
    [b.name, tierName(b.tierId ?? b.pausedTierId), b.status, b.country, b.source, certs[b.id], b.taxExemptions.join(" "), b.approvedAt.toISOString(), b.companyGid].map(csvCell).join(","),
  );
  return [head.join(","), ...lines].join("\n");
}

export async function buyerDetail(shop: string, id: string) {
  const buyer = await db.buyer.findFirst({ where: { shop, id } });
  if (!buyer) return null;
  const certificates = await db.certificate.findMany({ where: { shop, buyerId: buyer.id }, orderBy: { expiresOn: "asc" } });
  // Renewal requests are logged by the certificates area against the certificate id.
  const subjects = [buyer.id, buyer.companyGid, ...buyer.locationGids, ...(buyer.contactGid ? [buyer.contactGid] : []), ...certificates.map((c) => c.id)];
  const [tiers, activity, application] = await Promise.all([
    db.tier.findMany({ where: { shop }, select: { id: true, name: true }, orderBy: { position: "asc" } }),
    db.activityLog.findMany({ where: { shop, subject: { in: subjects } }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.application.findFirst({ where: { shop, buyerId: buyer.id }, select: { id: true } }),
  ]);
  const renewals = activity.filter((a) => /renewal/.test(a.action));
  const history = activity.filter((a) => /^(buyer\.(move|pause|resume|create)|tier\.(assign|unassign)|application\.approve)/.test(a.action));
  return { buyer, tiers, certificates, activity, history, applicationId: application?.id ?? null, renewals };
}
