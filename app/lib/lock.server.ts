import { randomUUID } from "node:crypto";
import db from "../db.server";

// Per-shop mutex in Postgres (one B2B-market write at a time per shop).
// Locks expire so a crashed request never blocks a shop for long.

export class LockBusyError extends Error {
  constructor(readonly shop: string, readonly name: string) {
    super(`Lock ${name} busy for ${shop}`);
    this.name = "LockBusyError";
  }
}

export async function tryLock(shop: string, name: string, ttlMs = 30_000): Promise<string | null> {
  const holder = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  // Take over an expired lock, or insert a new one; both are a single atomic statement.
  const taken = await db.$executeRaw`
    INSERT INTO "ShopLock" ("shop", "name", "holder", "expiresAt") VALUES (${shop}, ${name}, ${holder}, ${expiresAt})
    ON CONFLICT ("shop", "name") DO UPDATE SET "holder" = EXCLUDED."holder", "expiresAt" = EXCLUDED."expiresAt"
    WHERE "ShopLock"."expiresAt" < ${now}`;
  return taken === 1 ? holder : null;
}

export async function unlock(shop: string, name: string, holder: string): Promise<void> {
  await db.shopLock.deleteMany({ where: { shop, name, holder } });
}

/**
 * Run `fn` holding the lock; waits up to `waitMs` for it, polling. `ttlMs` must
 * be longer than `fn` can take: an expired lock can be taken over by another
 * request, which is exactly the double-run the lock exists to prevent.
 */
export async function withLock<T>(shop: string, name: string, fn: () => Promise<T>, waitMs = 20_000, ttlMs = 30_000): Promise<T> {
  const deadline = Date.now() + waitMs;
  let holder: string | null = null;
  let delay = 150;
  while (!(holder = await tryLock(shop, name, ttlMs))) {
    if (Date.now() > deadline) throw new LockBusyError(shop, name);
    await new Promise((r) => setTimeout(r, delay + Math.random() * 100));
    delay = Math.min(delay * 2, 1500);
  }
  try {
    return await fn();
  } finally {
    await unlock(shop, name, holder);
  }
}

/** Approve, reject, "needs info" and Undo on one application never run at the same time. */
export const APPLICATION_LOCK_TTL_MS = 10 * 60_000;
export function withApplicationLock<T>(shop: string, applicationId: string, fn: () => Promise<T>, waitMs = 3_000): Promise<T> {
  return withLock(shop, `approval:${applicationId}`, fn, waitMs, APPLICATION_LOCK_TTL_MS);
}
