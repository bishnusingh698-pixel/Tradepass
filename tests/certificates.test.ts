import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import db from "../app/db.server";
import {
  certificateStatus, certificateFlags, checkRenewalToken, consumeRenewalToken, createRenewalToken, decideOnExpiry,
  findStaffFile, maskNumber, recordApplicationCertificates, renewalStage, runCertificateDay, applyRenewalUpload,
} from "../app/lib/certificates.server";
import { defaultSettings } from "../app/lib/settings";
import type { Admin } from "../app/lib/gql.server";

process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.LINK_TOKEN_SECRET = "test-secret";
delete process.env.BREVO_API_KEY;

const rnd = randomBytes(4).toString("hex");
const S1 = `test-cert-1-${rnd}.myshopify.com`;
const S2 = `test-cert-2-${rnd}.myshopify.com`;
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const now = new Date("2026-10-16T09:00:00Z");

// Fake Admin API: records calls, answers every mutation without userErrors.
function fakeAdmin() {
  const calls: { query: string; variables?: Record<string, unknown> }[] = [];
  const admin = {
    graphql: async (query: string, opts?: { variables?: Record<string, unknown> }) => {
      calls.push({ query, variables: opts?.variables });
      const data = query.includes("companyLocationTaxSettingsUpdate")
        ? { companyLocationTaxSettingsUpdate: { companyLocation: { id: "x" }, userErrors: [] } }
        : {};
      return new Response(JSON.stringify({ data }));
    },
  } as unknown as Admin;
  return { admin, calls };
}

beforeAll(async () => {
  for (const shop of [S1, S2]) await db.shop.create({ data: { shop, name: "Cert Store", email: "owner@example.com", settings: defaultSettings() as object } });
});
afterAll(async () => {
  const shops = { in: [S1, S2] };
  await db.emailLog.deleteMany({ where: { shop: shops } });
  await db.tokenUse.deleteMany({ where: { shop: shops } });
  await db.certificate.deleteMany({ where: { shop: shops } });
  await db.applicationFile.deleteMany({ where: { shop: shops } });
  await db.application.deleteMany({ where: { shop: shops } });
  await db.buyer.deleteMany({ where: { shop: shops } });
  await db.activityLog.deleteMany({ where: { shop: shops } });
  await db.shop.deleteMany({ where: { shop: shops } });
});

describe("status", () => {
  it("derives valid / expiring / expired and keeps review states", () => {
    const st = (exp: string | null, status = "valid") => certificateStatus({ expiresOn: exp ? d(exp) : null, status }, 30, now);
    expect(st("2027-01-01")).toBe("valid");
    expect(st("2026-11-15")).toBe("expiring");
    expect(st("2026-10-16")).toBe("expiring"); // expiry day itself is still valid
    expect(st("2026-10-15")).toBe("expired");
    expect(st(null)).toBe("valid");
    expect(st("2020-01-01", "pending")).toBe("pending");
    expect(st("2020-01-01", "rejected")).toBe("rejected");
    expect(certificateFlags({ expiresOn: null, status: "valid" }).noExpiry).toBe(true);
    expect(certificateFlags({ expiresOn: d("2020-01-01"), status: "pending" }, now).pastExpiry).toBe(true);
    expect(maskNumber("DE123456789")).toBe("••••••6789");
  });

  it("schedules renewals at 30 and 7 days, once each", () => {
    const c = (exp: string, remindedAt = {}) => ({ expiresOn: d(exp), status: "expiring", remindedAt });
    expect(renewalStage(c("2026-12-01"), now)).toBeNull(); // 46 days
    expect(renewalStage(c("2026-11-15"), now)).toBe("30");
    expect(renewalStage(c("2026-11-15", { "30": "x" }), now)).toBeNull();
    expect(renewalStage(c("2026-10-23", { "30": "x" }), now)).toBe("7");
    expect(renewalStage(c("2026-10-23", { "30": "x", "7": "y" }), now)).toBeNull();
    expect(renewalStage(c("2026-10-01"), now)).toBeNull();
  });
});

describe("daily job", () => {
  it("sends the 30-day renewal once even when run twice, and marks status", async () => {
    const app = await db.application.create({
      data: { shop: S1, idempotencyKey: `k-${rnd}`, companyName: "Acme", email: "buyer@example.com", locale: "de", answers: { firstName: "Jo" } },
    });
    const cert = await db.certificate.create({ data: { shop: S1, applicationId: app.id, type: "resale", country: "US", region: "TX", expiresOn: d("2026-11-15"), status: "valid", fileGid: "gid://shopify/GenericFile/1" } });
    const { admin } = fakeAdmin();
    await runCertificateDay(S1, { adminFor: async () => admin, now });
    await runCertificateDay(S1, { adminFor: async () => admin, now });
    const after = await db.certificate.findUniqueOrThrow({ where: { id: cert.id } });
    expect(after.status).toBe("expiring");
    expect(Object.keys(after.remindedAt as object)).toEqual(["30"]);
    const emails = await db.emailLog.findMany({ where: { shop: S1, type: "cert_expiring" } });
    expect(emails).toHaveLength(1);
    const p = emails[0].payload as { to: string; locale: string; vars: Record<string, string> };
    expect(p).toMatchObject({ to: "buyer@example.com", locale: "de" });
    expect(p.vars.update_link).toMatch(new RegExp(`^https://${S1}/apps/tradepass/renew/[^?]+\\?lang=de$`));
    expect(await db.tokenUse.count({ where: { shop: S1, subjectId: cert.id, purpose: "renewal" } })).toBe(1);
  });

  it("on expiry with onExpiry=remove, removes only that certificate's exemption from every location", async () => {
    const s = defaultSettings();
    s.certificates.onExpiry = "remove";
    await db.shop.update({ where: { shop: S1 }, data: { settings: s as object } });
    const buyer = await db.buyer.create({ data: { shop: S1, companyGid: `gid://shopify/Company/${rnd}`, locationGids: ["gid://shopify/CompanyLocation/1", "gid://shopify/CompanyLocation/2"], name: "Acme", taxExemptions: ["US_TX_RESELLER_EXEMPTION", "US_CA_RESELLER_EXEMPTION"] } });
    await db.certificate.create({ data: { shop: S1, buyerId: buyer.id, type: "resale", country: "US", region: "TX", expiresOn: d("2026-10-10"), status: "expiring", remindedAt: { "30": "x", "7": "y" } } });
    const { admin, calls } = fakeAdmin();
    await runCertificateDay(S1, { adminFor: async () => admin, now });
    const removes = calls.filter((c) => c.query.includes("companyLocationTaxSettingsUpdate"));
    expect(removes.map((c) => c.variables)).toEqual([
      { id: "gid://shopify/CompanyLocation/1", remove: ["US_TX_RESELLER_EXEMPTION"] },
      { id: "gid://shopify/CompanyLocation/2", remove: ["US_TX_RESELLER_EXEMPTION"] },
    ]);
    expect((await db.buyer.findUniqueOrThrow({ where: { id: buyer.id } })).taxExemptions).toEqual(["US_CA_RESELLER_EXEMPTION"]);
    // Second run: decision recorded, nothing removed twice.
    const again = fakeAdmin();
    await runCertificateDay(S1, { adminFor: async () => again.admin, now });
    expect(again.calls.filter((c) => c.query.includes("companyLocationTaxSettingsUpdate"))).toHaveLength(0);
  });

  it("keeps the exemption when another valid certificate covers it", async () => {
    const buyer = await db.buyer.create({ data: { shop: S2, companyGid: `gid://shopify/Company/b${rnd}`, locationGids: ["gid://shopify/CompanyLocation/9"], name: "B" } });
    const old = await db.certificate.create({ data: { shop: S2, buyerId: buyer.id, type: "resale", country: "US", region: "TX", expiresOn: d("2026-01-01"), status: "expired" } });
    await db.certificate.create({ data: { shop: S2, buyerId: buyer.id, type: "resale", country: "US", region: "TX", expiresOn: d("2027-12-01"), status: "valid" } });
    const { admin, calls } = fakeAdmin();
    expect(await decideOnExpiry(admin, S2, old.id, "staff", "remove")).toEqual({ ok: false, reason: "still_covered" });
    expect(calls).toHaveLength(0);
  });
});

describe("renewal links and files", () => {
  it("tokens are single-use, shop-bound and reset the certificate to pending review", async () => {
    const cert = await db.certificate.create({ data: { shop: S2, type: "vat", status: "expired", expiresOn: d("2026-01-01"), fileGid: "gid://shopify/GenericFile/old", rejectReason: "x" } });
    const token = await createRenewalToken(S2, cert.id, now);
    expect(await checkRenewalToken(S1, token, now)).toEqual({ ok: false, reason: "invalid" }); // other shop
    expect((await checkRenewalToken(S2, `${token}x`, now)).ok).toBe(false); // tampered
    const ok = await checkRenewalToken(S2, token, now);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(await consumeRenewalToken(S2, ok.tokenHash, now)).toBe(true);
    expect(await consumeRenewalToken(S2, ok.tokenHash, now)).toBe(false);
    expect(await checkRenewalToken(S2, token, now)).toEqual({ ok: false, reason: "used" });
    expect(await checkRenewalToken(S2, token, new Date(now.getTime() + 61 * 86_400_000))).toEqual({ ok: false, reason: "expired" });
    await applyRenewalUpload(S2, cert.id, "gid://shopify/GenericFile/new", "2028-01-31");
    const after = await db.certificate.findUniqueOrThrow({ where: { id: cert.id } });
    expect(after).toMatchObject({ status: "pending", fileGid: "gid://shopify/GenericFile/new", rejectReason: null, remindedAt: {} });
    expect(after.expiresOn?.toISOString().slice(0, 10)).toBe("2028-01-31");
  });

  it("a newer link invalidates the older one", async () => {
    const cert = await db.certificate.create({ data: { shop: S2, type: "vat", status: "valid" } });
    const first = await createRenewalToken(S2, cert.id, now);
    await createRenewalToken(S2, cert.id, now);
    expect(await checkRenewalToken(S2, first, now)).toEqual({ ok: false, reason: "used" });
  });

  it("files open only for the shop that owns them", async () => {
    const cert = await db.certificate.create({ data: { shop: S1, type: "other", status: "pending", fileGid: "gid://shopify/GenericFile/77" } });
    const af = await db.applicationFile.create({ data: { shop: S1, applicationId: "a", fileGid: "gid://shopify/GenericFile/78", kind: "other" } });
    expect(await findStaffFile(S1, cert.id)).toBe("gid://shopify/GenericFile/77");
    expect(await findStaffFile(S1, af.id)).toBe("gid://shopify/GenericFile/78");
    expect(await findStaffFile(S2, cert.id)).toBeNull();
    expect(await findStaffFile(S2, af.id)).toBeNull();
  });

  it("records application certificates once, with the number encrypted", async () => {
    const files = [{ fileGid: "gid://shopify/GenericFile/5", type: "resale", country: "us", region: "tx", number: "123-456", expiresOn: "2027-05-01" }];
    await recordApplicationCertificates(S2, "app-1", files);
    await recordApplicationCertificates(S2, "app-1", files);
    const rows = await db.certificate.findMany({ where: { shop: S2, applicationId: "app-1" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ country: "US", region: "TX", status: "pending" });
    expect(rows[0].numberEnc).not.toContain("123-456");
  });
});

describe("hosted renewal page", () => {
  it("serves a translated, RTL page for a valid link and a friendly page once used", async () => {
    const { proxySignature } = await import("../app/lib/proxy.server");
    const { loader } = await import("../app/routes/proxy.renew.$token");
    process.env.SHOPIFY_API_SECRET = "proxy-secret";
    const cert = await db.certificate.create({ data: { shop: S2, type: "resale", status: "expiring" } });
    const token = await createRenewalToken(S2, cert.id);
    const req = (lang: string) => {
      const p = new URLSearchParams({ shop: S2, logged_in_customer_id: "", path_prefix: "/apps/tradepass", timestamp: String(Math.floor(Date.now() / 1000)), lang });
      p.set("signature", proxySignature(p, "proxy-secret"));
      return new Request(`https://app.example/proxy/renew/${token}?${p}`);
    };
    const call = (r: Request) => loader({ request: r, params: { token }, context: {} } as never) as Promise<Response>;
    const ok = await call(req("ar"));
    expect(ok.status).toBe(200);
    const body = await ok.text();
    expect(body).toContain('<html lang="ar" dir="rtl">');
    expect(body).toContain('type="file"');
    // Unsigned request is refused.
    expect((await call(new Request(`https://app.example/proxy/renew/${token}?shop=${S2}`))).status).toBe(403);
    await db.tokenUse.update({ where: { tokenHash: (await import("../app/lib/crypto.server")).sha256(token) }, data: { usedAt: new Date() } });
    const used = await call(req("en"));
    expect(used.status).toBe(410);
    expect(await used.text()).toContain("This link was already used");
  });
});
