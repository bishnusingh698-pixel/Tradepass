import db from "../db.server";
import { sha256 } from "./crypto.server";

// Spam protection without a paid captcha (feature spec §D): honeypot, minimum
// time-to-submit, per-IP and per-email rate limits (RateHit, pruned hourly by
// the core job), optional question (checked in intake). IPs and emails are
// only ever stored as salted hashes.

export const MIN_ELAPSED_MS = 3000;

export const LIMITS = {
  submitPerIp: 10, // per hour
  submitPerEmail: 3,
  uploadPerIp: 30,
  updatePerIp: 20,
  spamPerIp: 5, // after this many spam hits in an hour, everything from that IP is discarded
} as const;

export function hourWindow(now = new Date()): string {
  return now.toISOString().slice(0, 13); // 2026-10-16T15, matches the prune task's format
}

function pepper(): string {
  return process.env.LINK_TOKEN_SECRET ?? process.env.SHOPIFY_API_SECRET ?? "tradepass";
}

/** Salted hash so a leaked RateHit/Application row never reveals an IP or email. */
export function hashKey(kind: string, value: string): string {
  return sha256(`${pepper()}:${kind}:${value.trim().toLowerCase()}`).slice(0, 40);
}

/**
 * Client IP as seen behind Shopify's app proxy and Render's load balancer.
 * The left-most X-Forwarded-For entry is the original client.
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? request.headers.get("cf-connecting-ip") ?? "unknown";
}

/** Count one hit and say whether the caller is still within `limit` for this hour. */
export async function hit(key: string, limit: number, now = new Date()): Promise<{ allowed: boolean; count: number }> {
  const window = hourWindow(now);
  const row = await db.rateHit.upsert({
    where: { key_window: { key, window } },
    create: { key, window, count: 1 },
    update: { count: { increment: 1 } },
  });
  return { allowed: row.count <= limit, count: row.count };
}

/** Read the current count without adding a hit. */
export async function peek(key: string, now = new Date()): Promise<number> {
  const row = await db.rateHit.findUnique({ where: { key_window: { key, window: hourWindow(now) } } });
  return row?.count ?? 0;
}

/** Honeypot filled or submitted faster than a person can type. */
export function looksLikeBot(input: { hp?: unknown; elapsedMs?: unknown }): boolean {
  if (typeof input.hp === "string" && input.hp.trim() !== "") return true;
  const ms = Number(input.elapsedMs);
  return !Number.isFinite(ms) || ms < MIN_ELAPSED_MS;
}
