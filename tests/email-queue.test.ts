import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import db from "../app/db.server";
import { emailQuotaToday, queueEmail, queueMerchantDigest, sendQueuedEmails, SHOP_DAILY_CAP } from "../app/lib/email/index.server";
import { defaultSettings } from "../app/lib/settings";
import type { OutgoingEmail, SendResult } from "../app/lib/email/brevo.server";

// Far-future days keep these counts separate from anything else using the shared test DB.
const rnd = randomBytes(4).toString("hex");
const A = `test-email-a-${rnd}.myshopify.com`;
const B = `test-email-b-${rnd}.myshopify.com`;
const C = `test-email-c-${rnd}.myshopify.com`;
const OTHERS = `test-email-x-${rnd}`;
const day1 = new Date("2099-01-01T10:00:00Z");

delete process.env.BREVO_API_KEY; // never call Brevo from tests

const mail = (shop: string, over: Record<string, unknown> = {}) => ({
  shop, type: "received" as const, to: "buyer@example.com", locale: "en", vars: { company: "Acme", first_name: "Jo" }, ...over,
});

beforeAll(async () => {
  const s = defaultSettings();
  s.notifications.emails.rejected.enabled = false;
  s.notifications.merchant.mode = "instant";
  for (const shop of [A, B, C]) {
    await db.shop.create({ data: { shop, name: "Test Store", email: "owner@example.com", settings: s as object } });
  }
});

afterAll(async () => {
  await db.emailLog.deleteMany({ where: { OR: [{ shop: { in: [A, B, C] } }, { shop: { startsWith: OTHERS } }] } });
  await db.shop.deleteMany({ where: { shop: { in: [A, B, C] } } });
});

describe("email caps", () => {
  it("keeps 25 per store per day and defers the overflow to the next day", async () => {
    const results = [];
    for (let i = 0; i < SHOP_DAILY_CAP + 2; i++) results.push(await queueEmail(mail(A), day1));
    expect(results.slice(0, SHOP_DAILY_CAP).every((r) => r.queued && !r.reason)).toBe(true);
    expect(results.slice(SHOP_DAILY_CAP)).toEqual([{ queued: true, reason: "quota_deferred" }, { queued: true, reason: "quota_deferred" }]);
    const q = await emailQuotaToday(A, day1);
    expect(q).toMatchObject({ shopUsed: 25, shopCap: 25, deferred: 2 });
    const next = await db.emailLog.count({ where: { shop: A, quotaDay: "2099-01-02" } });
    expect(next).toBe(2);
  });

  it("keeps 250 per day across all stores", async () => {
    const day = new Date("2099-02-01T08:00:00Z");
    await db.emailLog.createMany({
      data: Array.from({ length: 245 }, (_, i) => ({ shop: `${OTHERS}-${i % 20}`, type: "received", toHash: "x", status: "sent", quotaDay: "2099-02-01" })),
    });
    const r = [];
    for (let i = 0; i < 7; i++) r.push(await queueEmail(mail(B), day));
    expect(r.filter((x) => !x.reason)).toHaveLength(5);
    expect(r.filter((x) => x.reason === "quota_deferred")).toHaveLength(2);
    expect((await emailQuotaToday(B, day)).globalUsed).toBe(250);
  });

  it("respects the merchant's on/off switch and rejects bad addresses", async () => {
    expect(await queueEmail(mail(C, { type: "rejected" }), day1)).toEqual({ queued: false, reason: "disabled" });
    expect(await queueEmail(mail(C, { to: "not-an-email" }), day1)).toEqual({ queued: false, reason: "invalid_recipient" });
  });

  it("instant merchant alerts count toward the store cap and switch to the digest when full", async () => {
    const day = new Date("2099-03-01T08:00:00Z");
    const alert = { shop: C, type: "merchant_new_application" as const, to: "", locale: "", vars: { company: "Acme" } };
    expect(await queueEmail(alert, day)).toEqual({ queued: true });
    const row = await db.emailLog.findFirst({ where: { shop: C, type: "merchant_new_application" } });
    expect((row?.payload as { to: string }).to).toBe("owner@example.com");
    await db.emailLog.createMany({ data: Array.from({ length: 24 }, () => ({ shop: C, type: "received", toHash: "x", status: "sent", quotaDay: "2099-03-01" })) });
    expect(await queueEmail(alert, day)).toEqual({ queued: false, reason: "quota_deferred" });
    expect(await db.emailLog.count({ where: { shop: C, type: "merchant_new_application" } })).toBe(1);
  });

  it("queues one digest per day, only when there is something to report", async () => {
    const day = new Date("2099-04-01T06:00:00Z");
    const none = { pending: 0, expiring: 0, expired: 0, failed: 0, deferred: 0 };
    expect(await queueMerchantDigest(C, none, day)).toBe(false);
    expect(await queueMerchantDigest(C, { ...none, pending: 2 }, day)).toBe(true);
    expect(await queueMerchantDigest(C, { ...none, pending: 2 }, day)).toBe(false);
  });
});

describe("sending", () => {
  it("sends what's due, clears the payload, keeps only the hash, and leaves deferred mail queued", async () => {
    const sent: OutgoingEmail[] = [];
    const ok = async (e: OutgoingEmail): Promise<SendResult> => (sent.push(e), { ok: true });
    const n = await sendQueuedEmails(Date.now() + 60_000, { now: day1, send: ok, shops: [A] });
    expect(n).toBe(25);
    expect(sent[0]).toMatchObject({ to: "buyer@example.com", senderName: "Test Store", replyTo: "owner@example.com" });
    expect(sent[0].text.length).toBeGreaterThan(20);
    const rows = await db.emailLog.findMany({ where: { shop: A, status: "sent" } });
    expect(rows).toHaveLength(25);
    expect(rows.every((r) => r.payload === null && r.toHash.length === 64 && r.sentAt)).toBe(true);
    expect(await db.emailLog.count({ where: { shop: A, status: "queued", quotaDay: "2099-01-02" } })).toBe(2);
    // Running again the same hour sends nothing twice.
    expect(await sendQueuedEmails(Date.now() + 60_000, { now: day1, send: ok, shops: [A] })).toBe(0);
  });

  it("retries temporary failures and fails permanent ones (payload cleared)", async () => {
    const day2 = new Date("2099-01-02T10:00:00Z");
    let call = 0;
    const flaky = async (): Promise<SendResult> => (call++ === 0 ? { ok: false, retry: true, status: 503 } : { ok: false, retry: false, status: 400 });
    await sendQueuedEmails(Date.now() + 60_000, { now: day2, send: flaky, shops: [A] });
    const rows = await db.emailLog.findMany({ where: { shop: A, quotaDay: "2099-01-02" }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.status).sort()).toEqual(["failed", "queued"]);
    expect(rows.find((r) => r.status === "failed")?.payload).toBeNull();
    expect((rows.find((r) => r.status === "queued")?.payload as { attempts: number }).attempts).toBe(1);
  });

  it("moves leftovers from an earlier day onto today's quota", async () => {
    const day5 = new Date("2099-01-05T10:00:00Z");
    const sent: OutgoingEmail[] = [];
    await sendQueuedEmails(Date.now() + 60_000, { now: day5, send: async (e) => (sent.push(e), { ok: true }), shops: [A] });
    expect(sent).toHaveLength(1);
    expect(await db.emailLog.count({ where: { shop: A, quotaDay: "2099-01-05", status: "sent" } })).toBe(1);
  });
});
