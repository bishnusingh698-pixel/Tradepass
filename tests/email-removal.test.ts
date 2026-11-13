// Tradepass sends no email (D-091). These tests cover what replaced it: the
// ready-made messages the merchant copies (language, link, reason), the
// single-use expiring links inside them, and the approval's welcome-email step,
// which only ever asks Shopify to send its own B2B welcome email.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import db from "../app/db.server";
import { defaultSettings, readSettings } from "../app/lib/settings";
import { buildMessage, mailtoLink, renewalKind } from "../app/lib/messages";
import { rejectApplicationWithReason, rejectionMessage, requestMoreInfo } from "../app/lib/applications.server";
import { sha256, verifyToken } from "../app/lib/crypto.server";
import { timing } from "../app/lib/tiers.server";
import { approveApplication, retryApproval, type ApproveInput } from "../app/lib/approval.server";
import { fakeShopify } from "./tiers-fake";

process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.LINK_TOKEN_SECRET ||= "test-link-secret";
timing.sleep = async () => undefined;

const rnd = randomBytes(4).toString("hex");
const SHOP = `test-noemail-${rnd}.myshopify.com`;
const dctx = { admin: { graphql: async () => new Response(JSON.stringify({ data: {} })) } as never, shop: SHOP, actor: "staff" };

beforeAll(async () => {
  await db.shop.create({ data: { shop: SHOP, name: "Nordic Supply", primaryLocale: "en", domainUrl: "https://nordic.test", settings: defaultSettings() as object, b2bEnabled: true, billingPlan: "pro", country: "US" } });
});
afterAll(async () => {
  for (const m of [db.tokenUse, db.application, db.activityLog, db.shopLock, db.buyer, db.tier, db.job]) {
    await (m as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { shop: SHOP } });
  }
  await db.shop.deleteMany({ where: { shop: SHOP } });
});

const newApp = (over: Record<string, unknown> = {}) =>
  db.application.create({
    data: {
      shop: SHOP, idempotencyKey: randomBytes(8).toString("hex"), companyName: "Café Lumière", email: "achats@lumiere.test", locale: "fr",
      countryCode: "US", answers: { firstName: "Léa", billingAddress: { address1: "1 Main St", city: "Austin", zoneCode: "TX", countryCode: "US" } },
      ...over,
    },
  });

describe("message builder", () => {
  const opts = { primary: "en" };
  const vars = { company: "Acme", firstName: "Ada", storeName: "Nordic Supply", link: "https://nordic.test/apps/tradepass/update/abc", message: "Please send your resale certificate." };

  it("writes the needs-info message in the recipient's language with the merchant's message and the link", () => {
    const m = buildMessage("needs_info", "de", opts, vars, "ada@acme.test");
    expect(m.locale).toBe("de");
    expect(m.subject).toContain("Nordic Supply");
    expect(m.body).toMatch(/^Guten Tag Ada,/);
    expect(m.body).toContain("https://nordic.test/apps/tradepass/update/abc");
    expect(m.body).toContain("Nachricht von Nordic Supply: Please send your resale certificate.");
    expect(m.mailto.startsWith("mailto:ada@acme.test?subject=")).toBe(true);
  });

  it("falls back to the store's primary language, then English", () => {
    expect(buildMessage("rejected", "xx", { primary: "es" }, vars).locale).toBe("es");
    expect(buildMessage("rejected", "xx", {}, vars).locale).toBe("en");
  });

  it("adds the rejection reason only when there is one, and greets by company when the first name is missing", () => {
    const withReason = buildMessage("rejected", "en", opts, { ...vars, firstName: "", reason: "We only sell to salons." });
    expect(withReason.body).toMatch(/^Hello Acme,/);
    expect(withReason.body).toContain("Reason: We only sell to salons.");
    expect(buildMessage("rejected", "en", opts, { ...vars, reason: null }).body).not.toContain("Reason:");
  });

  it("isolates names in right-to-left languages but leaves links bare", () => {
    const m = buildMessage("needs_info", "ar", opts, vars);
    expect(m.dir).toBe("rtl");
    expect(m.body).toContain("⁨Ada⁩");
    expect(m.body).toContain(" https://nordic.test/apps/tradepass/update/abc".trim());
    expect(m.body).not.toContain("⁨https://");
  });

  it("uses the merchant's own wording from Settings → Languages, and survives a broken override", () => {
    const own = buildMessage("rejected", "en", { overrides: { en: { "message.rejected.subject": "About {company}" } } }, vars);
    expect(own.subject).toBe("About Acme");
    const broken = buildMessage("rejected", "en", { overrides: { en: { "message.rejected.subject": "About {company" } } }, vars);
    expect(broken.subject).toContain("Nordic Supply");
  });

  it("picks the renewal text from the expiry date and formats it in the recipient's language", () => {
    expect(renewalKind(null)).toBe("renewal");
    expect(renewalKind("2026-01-01", "2026-06-01")).toBe("renewal_expired");
    expect(renewalKind("2026-12-01", "2026-06-01")).toBe("renewal_expiring");
    const m = buildMessage("renewal_expiring", "fr", opts, { ...vars, expiryDate: "2026-12-01" });
    expect(m.body).toContain("1 décembre 2026");
  });

  it("builds a mailto link with CRLF line breaks and leaves odd addresses out", () => {
    const l = mailtoLink("a@b.test", "Hi & bye", "Line 1\n\nLine 2");
    expect(l).toBe("mailto:a@b.test?subject=Hi%20%26%20bye&body=Line%201%0D%0A%0D%0ALine%202");
    expect(mailtoLink("a@b.test?cc=x@y.test", "s", "b").startsWith("mailto:?subject=")).toBe(true);
  });
});

describe("ask for more info", () => {
  it("returns the message in the applicant's language with a signed, single-use link that expires in 14 days", async () => {
    const app = await newApp();
    const res = await requestMoreInfo(dctx, app.id, { message: "Merci d'ajouter votre certificat.", fields: ["website"] });
    expect(res.ok).toBe(true);
    expect(res.message?.locale).toBe("fr");
    expect(res.message?.to).toBe("achats@lumiere.test");
    expect(res.message?.body).toContain("Léa");
    expect(res.message?.body).toContain("Merci d'ajouter votre certificat.");
    expect(res.link).toMatch(/^https:\/\/nordic\.test\/apps\/tradepass\/update\//);
    expect(res.message?.body).toContain(res.link!);
    const token = decodeURIComponent(res.link!.split("/update/")[1]);
    const v = verifyToken(token);
    expect(v.ok && v.token.purpose).toBe("more_info");
    const use = await db.tokenUse.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
    expect(use.usedAt).toBeNull();
    expect(Math.round((use.expiresAt.getTime() - Date.now()) / 86_400_000)).toBe(14);
    // Asking again makes the first link stop working.
    const again = await requestMoreInfo(dctx, app.id, { message: "x", fields: ["website"] });
    expect(again.link).not.toBe(res.link);
    expect((await db.tokenUse.findUniqueOrThrow({ where: { tokenHash: sha256(token) } })).usedAt).not.toBeNull();
    expect(verifyToken(token, Date.now() + 15 * 86_400_000)).toEqual({ ok: false, reason: "expired" });
  });
});

describe("reject", () => {
  it("keeps the reason and offers the translated rejection message, now and later", async () => {
    const app = await newApp({ locale: "es", answers: { firstName: "Ana" } });
    expect(await rejectApplicationWithReason(dctx, app.id, { reason: "Solo vendemos a tiendas." })).toBe(true);
    expect((await db.application.findUniqueOrThrow({ where: { id: app.id } })).rejectReason).toBe("Solo vendemos a tiendas.");
    const m = await rejectionMessage(SHOP, app.id);
    expect(m?.locale).toBe("es");
    expect(m?.body).toContain("Ana");
    expect(m?.body).toContain("Solo vendemos a tiendas.");
    expect(await rejectionMessage(SHOP, (await newApp()).id)).toBeNull(); // not rejected
  });
});

describe("approval email step", () => {
  const input = (tierId: string, over: Partial<ApproveInput> = {}): ApproveInput => ({
    tierId, paymentTermsTemplateId: null, taxExempt: false, exemptions: [], taxRegistrationId: null, companyName: "Acme", locationName: "Acme HQ",
    billingAddress: { address1: "1 Main St", city: "Austin", zoneCode: "TX", countryCode: "US" }, shippingAddress: null,
    contact: { mode: "new" }, sendWelcome: true, ...over,
  });
  const setup = async () => {
    const fake = fakeShopify();
    const marketGid = fake.addMarket(["gid://shopify/CompanyLocation/999"]);
    const tier = await db.tier.create({ data: { shop: SHOP, name: `T-${randomBytes(2).toString("hex")}`, marketGid } });
    const app = await newApp({ locale: "en", email: `b-${randomBytes(3).toString("hex")}@acme.test` });
    return { fake, tier, app, ctx: { admin: fake.admin, shop: SHOP, actor: "staff" } };
  };

  it("asks Shopify to send its own B2B welcome email, and nothing else", async () => {
    const { fake, tier, app, ctx } = await setup();
    const state = await approveApplication(ctx, app.id, input(tier.id));
    expect(state.steps.email).toMatchObject({ status: "done", gid: "shopify" });
    expect(fake.calls.filter((c) => c.op === "ApprovalWelcome")).toHaveLength(1);
  });

  it("skips the welcome email when the merchant turned it off", async () => {
    const { fake, tier, app, ctx } = await setup();
    const state = await approveApplication(ctx, app.id, input(tier.id, { sendWelcome: false }));
    expect(state.steps.email.status).toBe("skipped");
    expect(fake.calls.some((c) => c.op === "ApprovalWelcome")).toBe(false);
  });

  it("a Shopify failure shows a plain-language error on the email step; the buyer is approved and Retry sends it", async () => {
    const { fake, tier, app, ctx } = await setup();
    let fail = true;
    fake.hooks.ApprovalWelcome = () => (fail ? { companyContactSendWelcomeEmail: { companyContact: null, userErrors: [{ field: null, message: "Customer accounts are off", code: "INVALID" }] } } : undefined);
    const state = await approveApplication(ctx, app.id, input(tier.id));
    expect(state.steps.email.status).toBe("failed");
    expect(state.steps.email.code).toBe("email_failed");
    expect(state.steps.email.error).toBe("The welcome email couldn't be sent. The buyer is approved; you can send it again.");
    expect((await db.application.findUniqueOrThrow({ where: { id: app.id } })).status).toBe("approved");
    fail = false;
    const retried = await retryApproval(ctx, app.id);
    expect(retried.steps.email.status).toBe("done");
    expect(retried.finishedAt).toBeTruthy();
  });
});

describe("no email path left in the app", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?|liquid|mjs)$/.test(f) ? [p] : [];
    });
  const sources = [...files("app"), ...files("extensions").filter((f) => !f.includes("node_modules")), ...files("scripts")].map((f) => ({ f, src: readFileSync(f, "utf8") }));

  it("has no email provider, SMTP client or email queue", () => {
    const hits = sources.filter(({ src }) => /brevo|sendinblue|nodemailer|smtp|sendgrid|mailgun|postmark|queueEmail|emailLog|sendTestEmail/i.test(src)).map((x) => x.f);
    expect(hits).toEqual([]);
    expect(existsSync("app/lib/email")).toBe(false);
    expect(readFileSync("prisma/schema.prisma", "utf8")).not.toMatch(/model EmailLog/);
  });

  it("the only email-sending Shopify mutation is the B2B welcome email", () => {
    const mutations = sources.flatMap(({ src }) => [...src.matchAll(/\b(\w*(?:Email|Invite)\w*)\s*\(/g)].map((m) => m[1]))
      .filter((n) => /^(company|customer)\w*(Send|Invite)/.test(n));
    expect([...new Set(mutations)]).toEqual(["companyContactSendWelcomeEmail"]);
  });

  it("has no SMS gateway or paid messaging API: WhatsApp, texts and mail apps are plain links the merchant opens", () => {
    const hits = sources
      .filter(({ src }) => /twilio|vonage|nexmo|messagebird|plivo|sinch|telnyx|clicksend|textmagic|africastalking|graph\.facebook\.com|whatsapp\.com\/v\d|api\.telegram\.org|api\.line\.me|shopifyMessaging|messagingSend/i.test(src))
      .map((x) => x.f);
    expect(hits).toEqual([]);
    // No server code fetches a messaging host: wa.me / api.whatsapp.com / t.me / line.me only appear as links.
    const fetched = sources.filter(({ f, src }) => /\.server\.ts$/.test(f) && /fetch\(\s*[`'"]https:\/\/(wa\.me|api\.whatsapp\.com|t\.me|line\.me)/.test(src));
    expect(fetched).toEqual([]);
  });

  it("server code talks only to Shopify and free official registries (no paid or keyed-for-cost services)", () => {
    // Every https host named in server modules. Registries: VIES (EU), HMRC (UK, free key), ABR (AU, free GUID),
    // data.texas.gov (open data), Brønnøysund (NO, open data), NZBN (NZ, free key). Example hosts are test placeholders.
    const allowed = new Set([
      "ec.europa.eu", "api.service.hmrc.gov.uk", "abr.business.gov.au", "data.texas.gov", "data.brreg.no", "api.business.govt.nz",
      "admin.shopify.com", "apps.shopify.com", "shop.example.com", "x.invalid",
    ]);
    const hosts = new Set(sources.filter(({ f }) => /\.server\.ts$/.test(f)).flatMap(({ src }) => [...src.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase())));
    expect([...hosts].filter((h) => !allowed.has(h))).toEqual([]);
  });

  it("old stored email settings still load and are dropped", () => {
    const s = readSettings({ notifications: { emails: { received: { enabled: false } }, merchant: { mode: "instant", email: "x@y.test" } }, branding: { logoUrl: "https://x" }, certificates: { autoRenewal: false, expiringDays: 45 } });
    expect(s).not.toHaveProperty("notifications");
    expect(s).not.toHaveProperty("branding");
    expect(s.certificates).toEqual({ expiringDays: 45, onExpiry: "ask" });
  });
});
