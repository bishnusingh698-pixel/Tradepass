// Steps 2B/2C: talking to applicants for free (channels, status, WhatsApp, Flow, saved replies,
// re-apply wait, links) and faster review (waiting time, navigation, risk hints, sources, QR, tags).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import db from "../app/db.server";
import { defaultSettings, readSettings } from "../app/lib/settings";
import { updateSettings } from "../app/lib/settings.server";
import { channelLinks, gmailHref, lineHref, LINK_LIMITS, mailtoHref, outlookHref, safeHttpsUrl, safeWhatsAppUrl, smsHref, telegramHref, waDigits, whatsappHref } from "../app/lib/message-links";
import { buildMessage } from "../app/lib/messages";
import { applicationForCustomer, cooldownFor, publicStatus, readStatusToken, reapplyFrom, statusLink, statusView } from "../app/lib/status.server";
import { statusBody } from "../app/routes/proxy.status.$token";
import { blockView } from "../extensions/tradepass-account-status/src/view.js";
import { applicationPayload, buildFlowPayload, TRIGGER_FIELDS, TRIGGER_HANDLES } from "../app/lib/flow.server";
import { handleSubmit, infoReceivedFollowup, type IntakeDeps } from "../app/lib/intake.server";
import { replyIn, sanitizeReplies } from "../app/lib/replies";
import { matchCondition, sanitizeRules, type ApplicationFacts } from "../app/lib/rules";
import { hostOf, isPoBox, namesDiffer, riskHints } from "../app/lib/risk";
import { riskForApplication, waitingDays } from "../app/lib/applications";
import { exportCsv, parseFilters, queueNeighbours, rejectApplicationWithReason } from "../app/lib/applications.server";
import { topSources } from "../app/lib/home.server";
import { qrSvg, trackedUrl } from "../app/lib/qr";
import { cleanTags } from "../app/lib/customer-tags";
import { approveApplication, undoApproval, type ApproveInput } from "../app/lib/approval.server";
import { timing } from "../app/lib/tiers.server";
import { fakeShopify } from "./tiers-fake";

process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.LINK_TOKEN_SECRET ||= "test-link-secret";
process.env.SHOPIFY_API_KEY ||= "test-key";
timing.sleep = async () => undefined;

const rnd = randomBytes(4).toString("hex");
const SHOP = `test-msg-${rnd}.myshopify.com`;
let formId = "";

beforeAll(async () => {
  await db.shop.create({ data: { shop: SHOP, name: "Nordic Supply", primaryLocale: "en", domainUrl: "https://nordic.test", settings: defaultSettings() as object, b2bEnabled: true, billingPlan: "pro", country: "US" } });
  formId = (await db.form.create({ data: { shop: SHOP, name: "Default", isDefault: true, definition: (await import("../app/lib/form-defaults")).defaultFormDefinition() as object } })).id;
});
afterAll(async () => {
  for (const m of [db.tokenUse, db.application, db.activityLog, db.shopLock, db.buyer, db.tier, db.job, db.form, db.certificate]) {
    await (m as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { shop: SHOP } });
  }
  await db.shop.deleteMany({ where: { shop: SHOP } });
});

const mkApp = (over: Record<string, unknown> = {}) =>
  db.application.create({
    data: {
      shop: SHOP, idempotencyKey: randomBytes(8).toString("hex"), companyName: "Café Lumière", email: `lea-${randomBytes(3).toString("hex")}@lumiere.test`,
      locale: "fr", countryCode: "US", answers: { firstName: "Léa", lastName: "Martin", phone: "+33612345678", billingAddress: { address1: "1 Main St", city: "Austin", zoneCode: "TX", countryCode: "US" } },
      ...over,
    },
  });

describe("B6 message channels (links only)", () => {
  const m = { to: "lea@lumiere.test", phone: "+33 6 12 34 56 78", subject: "Votre demande", body: "Bonjour Léa,\n\nMerci !\nhttps://nordic.test/apps/tradepass/status/abc", link: "https://nordic.test/apps/tradepass/status/abc" };

  it("opens WhatsApp with the applicant's number when it's international, else WhatsApp's own picker", () => {
    expect(waDigits("+33 6 12 34 56 78")).toBe("33612345678");
    expect(waDigits("06 12 34 56 78")).toBeNull();
    expect(whatsappHref(m).href).toBe(`https://wa.me/33612345678?text=${encodeURIComponent(m.body)}`);
    expect(whatsappHref({ ...m, phone: "0612" }).href.startsWith("https://wa.me/?text=")).toBe(true);
  });

  it("builds Gmail, Outlook, mail app and text-message links with the text filled in", () => {
    expect(gmailHref(m).href).toBe(`https://mail.google.com/mail/?view=cm&fs=1&to=lea%40lumiere.test&su=Votre%20demande&body=${encodeURIComponent(m.body)}`);
    expect(outlookHref(m).href).toContain("https://outlook.office.com/mail/deeplink/compose?to=lea%40lumiere.test&subject=Votre%20demande&body=");
    expect(mailtoHref(m).href).toContain("mailto:lea@lumiere.test?subject=Votre%20demande&body=Bonjour%20L%C3%A9a%2C%0D%0A%0D%0A");
    // iOS reads "&body", Android "?body": "?&body" works on both.
    expect(smsHref(m).href).toBe(`sms:+33612345678?&body=${encodeURIComponent(m.body)}`);
    expect(smsHref({ ...m, phone: null }).href.startsWith("sms:?&body=")).toBe(true);
    expect(lineHref(m).href).toBe(`https://line.me/R/share?text=${encodeURIComponent(m.body)}`);
    expect(telegramHref(m)?.href).toContain(`https://t.me/share/url?url=${encodeURIComponent(m.link)}&text=`);
    expect(telegramHref({ ...m, link: null })).toBeNull();
    expect(channelLinks(m).map((l) => l.channel)).toEqual(["mailto", "gmail", "outlook", "whatsapp", "sms", "telegram", "line"]);
  });

  it("a message too long for an app's link opens it without the text (the dialog copies it first)", () => {
    const long = { ...m, body: "x".repeat(3000) };
    const wa = whatsappHref(long);
    expect(wa.withoutText).toBe(true);
    expect(wa.href).toBe("https://wa.me/33612345678");
    expect(mailtoHref(long)).toMatchObject({ withoutText: true, href: "mailto:lea@lumiere.test?subject=Votre%20demande" });
    expect(gmailHref(long).withoutText).toBe(false); // webmail takes much longer links
    expect(LINK_LIMITS.sms).toBe(2000);
  });

  it("accepts only https WhatsApp links on wa.me / api.whatsapp.com, and https or store paths for other links", () => {
    expect(safeWhatsAppUrl("https://wa.me/15125550123")).toBe("https://wa.me/15125550123");
    expect(safeWhatsAppUrl("https://api.whatsapp.com/send?phone=15125550123")).toBeTruthy();
    for (const bad of ["http://wa.me/1", "https://wa.me.evil.test/1", "https://evil.test/wa.me", "javascript:alert(1)", "https://user@wa.me/1", ""]) expect(safeWhatsAppUrl(bad), bad).toBeNull();
    expect(safeHttpsUrl("/collections/wholesale")).toBe("/collections/wholesale");
    expect(safeHttpsUrl("https://cal.com/acme/onboarding")).toBe("https://cal.com/acme/onboarding");
    for (const bad of ["http://x.test", "//evil.test", "javascript:x", "/a b"]) expect(safeHttpsUrl(bad), bad).toBeNull();
  });

  it("every application message carries the status link and the applicant's phone", () => {
    const msg = buildMessage("rejected", "fr", {}, { company: "Café", storeName: "Nordic", reason: "Hors zone", statusLink: "https://nordic.test/apps/tradepass/status/t" }, "lea@x.test", "+33612345678");
    expect(msg.body).toContain("https://nordic.test/apps/tradepass/status/t");
    expect(msg.phone).toBe("+33612345678");
    expect(msg.link).toBe("https://nordic.test/apps/tradepass/status/t");
    const renewal = buildMessage("renewal", "en", {}, { company: "Café", storeName: "Nordic", link: "https://r", statusLink: "https://s" });
    expect(renewal.body).not.toContain("https://s");
  });
});

describe("B5 applicant status", () => {
  it("signs a read-only, expiring status link bound to the shop", async () => {
    const link = statusLink({ shop: SHOP, domainUrl: "https://nordic.test" }, SHOP, "app123");
    const token = decodeURIComponent(link.split("/status/")[1]);
    expect(readStatusToken(SHOP, token)).toEqual({ ok: true, applicationId: "app123" });
    expect(readStatusToken("other.myshopify.com", token)).toEqual({ ok: false, reason: "invalid" });
    const old = decodeURIComponent(statusLink(null, SHOP, "app123", Date.now() - 100 * 86_400_000).split("/status/")[1]);
    expect(readStatusToken(SHOP, old)).toEqual({ ok: false, reason: "expired" });
    expect(readStatusToken(SHOP, `${token}x`).ok).toBe(false);
  });

  it("shows the merchant's message and a fresh single-use update link while information is requested", async () => {
    const app = await mkApp({ status: "needs_info", requested: { fields: ["phone"], message: "Merci d'ajouter votre certificat.", at: new Date().toISOString() } });
    const v = await statusView(SHOP, app.id);
    expect(v).toMatchObject({ status: "needs_info", message: "Merci d'ajouter votre certificat.", locale: "fr" });
    expect(v!.updateUrl).toMatch(/^https:\/\/nordic\.test\/apps\/tradepass\/update\//);
    expect(await db.tokenUse.count({ where: { shop: SHOP, subjectId: app.id, purpose: "more_info", usedAt: null } })).toBe(1);
    expect((await statusView(SHOP, app.id, new Date(), { withUpdateLink: false }))!.updateUrl).toBeNull();
  });

  it("never shows drafts or withdrawn applications, nor another shop's", async () => {
    const draft = await mkApp({ status: "draft" });
    expect(await statusView(SHOP, draft.id)).toBeNull();
    expect(await statusView("other.myshopify.com", draft.id)).toBeNull();
    expect(publicStatus("withdrawn")).toBeNull();
  });

  it("finds a logged-in customer's application by customer id, else by their email read from Shopify", async () => {
    const fake = fakeShopify();
    const cust = fake.addCustomer(`buyer-${rnd}@acme.test`);
    const byId = await mkApp({ customerGid: "gid://shopify/Customer/777000" });
    expect(await applicationForCustomer(SHOP, "gid://shopify/Customer/777000", null)).toBe(byId.id);
    const byEmail = await mkApp({ email: `buyer-${rnd}@acme.test` });
    expect(await applicationForCustomer(SHOP, cust, fake.admin)).toBe(byEmail.id);
    expect(await applicationForCustomer(SHOP, "gid://shopify/Customer/1", null)).toBeNull();
  });

  it("the hosted page escapes everything and offers the actions that fit the status", () => {
    const t = (k: string, v?: Record<string, unknown>) => `${k}${v ? JSON.stringify(v) : ""}`;
    const html = statusBody({
      status: "needs_info", company: "<script>x</script>", locale: "en", submittedAt: "2026-11-01T10:00:00Z", decidedAt: null,
      message: "Send <b>this</b>", updateUrl: "https://s.test/u?a=1&b=2", reapplyFrom: null, links: { booking: "https://cal.test/x", shopping: null, whatsapp: "https://wa.me/1" },
    }, { t, locale: "en", store: "Nordic", login: "https://s.test/account/login" });
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&#60;script&#62;");
    expect(html).toContain('href="https://s.test/u?a=1&#38;b=2"');
    expect(html).toContain("hosted.status.update");
    expect(html).toContain("hosted.status.book");
    expect(html).toContain("hosted.status.whatsapp");
    expect(html).not.toContain("hosted.status.signIn");
  });

  it("the customer account block shows only a known status and an https link", () => {
    expect(blockView({ status: "approved", submittedAt: "2026-11-01T10:00:00Z", statusUrl: "https://x.test/s" })).toEqual({ titleKey: "status.approved", tone: "success", submitted: "2026-11-01", reapplyFrom: null, url: "https://x.test/s" });
    expect(blockView({ status: "draft", submittedAt: "" })).toBeNull();
    expect(blockView({ status: "pending", submittedAt: "2026-11-01", statusUrl: "javascript:x" })?.url).toBeNull();
    expect(blockView(null)).toBeNull();
  });
});

describe("B10 re-apply wait", () => {
  it("computes the first day they may apply again", () => {
    expect(reapplyFrom(new Date("2026-11-01T15:00:00Z"), 30, new Date("2026-11-07T00:00:00Z"))).toBe("2026-12-01");
    expect(reapplyFrom(new Date("2026-10-01T15:00:00Z"), 30, new Date("2026-11-07T00:00:00Z"))).toBeNull();
    expect(reapplyFrom(new Date(), 0)).toBeNull();
  });

  it("a rejected applicant applying again within the wait is told the date; nothing is stored", async () => {
    await updateSettings(SHOP, { applications: { reapplyDays: 30 } });
    const email = `again-${rnd}@acme.test`;
    await mkApp({ email, companyName: `Again ${rnd}`, status: "rejected", decidedAt: new Date() });
    expect(await cooldownFor(SHOP, { email, companyName: "", taxHash: null })).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const body = {
      idempotencyKey: `cool-${rnd}-${randomBytes(3).toString("hex")}`, formId, locale: "en", elapsedMs: 10_000, hp: "",
      answers: { companyName: `Again ${rnd}`, businessType: "retail", firstName: "A", lastName: "B", email, consent: true, billingAddress: { countryCode: "DE", address1: "x", city: "Berlin", zip: "10115" } },
    };
    const deps = { getAdmin: vi.fn(), checkTaxNumber: vi.fn(), emitFlowTrigger: vi.fn(), evaluateRules: vi.fn(), recordApplicationCertificates: vi.fn(), defer: vi.fn() } as unknown as IntakeDeps;
    const res = await handleSubmit({ shop: SHOP, loggedInCustomerId: null, ip: `9.9.9.9#${rnd}` }, body, deps);
    expect(res).toMatchObject({ http: 409, body: { ok: false, error: "cooldown" } });
    expect(await db.application.count({ where: { shop: SHOP, idempotencyKey: body.idempotencyKey } })).toBe(0);
    await updateSettings(SHOP, { applications: { reapplyDays: 0 } });
    expect(await cooldownFor(SHOP, { email, companyName: "", taxHash: null })).toBeNull();
  });
});

describe("B8 Flow alerts", () => {
  it("every application trigger carries id, admin link, company, contact, email, phone, country, state and tier", async () => {
    for (const trig of ["application_submitted", "application_approved", "application_rejected", "application_info_received"] as const) {
      for (const k of ["Application ID", "Admin URL", "Company name", "Contact name", "Contact email", "Phone", "Country", "State", "Tier"]) expect(TRIGGER_FIELDS[trig], `${trig} ${k}`).toContain(k);
    }
    expect(TRIGGER_HANDLES.application_info_received).toBe("tradepass-flow-application-info-received");
    const tier = await db.tier.create({ data: { shop: SHOP, name: "Retailer" } });
    const app = await mkApp({ suggestedTierId: tier.id });
    const p = await applicationPayload(SHOP, app.id);
    expect(p).toMatchObject({ applicationId: app.id, companyName: "Café Lumière", contactName: "Léa Martin", phone: "+33612345678", state: "TX", country: "US", tierName: "Retailer" });
    expect(p.adminUrl).toBe(`https://admin.shopify.com/store/${SHOP.replace(".myshopify.com", "")}/apps/test-key/app/applications/${app.id}`);
    expect(buildFlowPayload("application_info_received", p)).toMatchObject({ Phone: "+33612345678", State: "TX", "Admin URL": p.adminUrl });
  });

  it("an applicant's reply fires 'Wholesale application info received'", async () => {
    const app = await mkApp();
    const emit = vi.fn(async () => undefined);
    await infoReceivedFollowup(SHOP, app.id, { getAdmin: async () => ({ graphql: vi.fn() }) as never, emitFlowTrigger: emit });
    expect(emit).toHaveBeenCalledWith(expect.anything(), SHOP, "application_info_received", expect.objectContaining({ applicationId: app.id, contactName: "Léa Martin" }));
  });
});

describe("B9 saved replies", () => {
  it("keeps only well-formed replies, in order, with limits", () => {
    const r = sanitizeReplies({ reject: [{ id: "a", texts: { en: { title: "Region", text: " We don't ship there. " }, fr: { title: "", text: "Nous ne livrons pas." }, "<x>": { title: "x", text: "y" } } }, { id: "b", texts: { en: { title: "Empty", text: "" } } }, "junk"], info: "nope" });
    expect(r.info).toEqual([]);
    expect(r.reject).toEqual([{ id: "a", texts: { en: { title: "Region", text: "We don't ship there." }, fr: { title: "Nous ne livrons pas.", text: "Nous ne livrons pas." } } }]);
  });

  it("picks the applicant's language, then the store's, then English", () => {
    const reply = { id: "a", texts: { en: { title: "E", text: "english" }, de: { title: "D", text: "deutsch" }, "pt-BR": { title: "P", text: "português" } } };
    expect(replyIn(reply, "de-AT", "en")?.text).toBe("deutsch");
    expect(replyIn(reply, "pt-BR", "en")?.text).toBe("português");
    expect(replyIn(reply, "ja", "de")?.text).toBe("deutsch");
    expect(replyIn(reply, "ja", "ko")?.text).toBe("english");
  });

  it("reject rules can point at a saved reply", () => {
    const [rule] = sanitizeRules([{ kind: "reject", conditions: { match: "all", list: [{ type: "po_box" }] }, action: { reason: null, replyId: "region-1" } }]);
    expect(rule.action).toEqual({ reason: null, replyId: "region-1" });
    expect(rule.conditions.list).toEqual([{ type: "po_box" }]);
  });
});

describe("C12–C15 review helpers", () => {
  it("counts waiting days and sorts the pending tab oldest first unless chosen otherwise", () => {
    expect(waitingDays(new Date(Date.now() - 3.5 * 86_400_000).toISOString())).toBe(3);
    expect(parseFilters(new URL("https://x/?tab=pending")).sort).toBe("oldest");
    expect(parseFilters(new URL("https://x/?tab=pending&sort=newest")).sort).toBe("newest");
    expect(parseFilters(new URL("https://x/?tab=approved")).sort).toBe("newest");
    expect(parseFilters(new URL("https://x/?assignee=me")).assignee).toBe("me");
  });

  it("finds previous and next in the reviewer's queue (same filters, 'Mine' included)", async () => {
    const base = Date.now() - 10 * 86_400_000;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await mkApp({ companyName: `Q${i} ${rnd}`, submittedAt: new Date(base + i * 1000), assignee: "Alex" })).id);
    const n = await queueNeighbours(SHOP, `tab=pending&assignee=me&q=${encodeURIComponent(rnd)}&sort=oldest`, ids[1], "Alex");
    expect(n).toMatchObject({ prev: ids[0], next: ids[2], position: 2, total: 3 });
    expect((await queueNeighbours(SHOP, `tab=pending&assignee=me&q=${rnd}`, ids[1], "Sam")).total).toBe(0);
  });

  it("risk hints: free email, website mismatch, registry name mismatch, P.O. box (hints only)", () => {
    expect(riskHints({ email: "a@gmail.com", companyName: "Acme" })).toEqual(["free_email"]);
    expect(riskHints({ email: "a@acme.com", website: "https://www.acme.com/shop", companyName: "Acme" })).toEqual([]);
    expect(riskHints({ email: "a@acme.com", website: "shop.acme.com", companyName: "Acme" })).toEqual([]);
    expect(riskHints({ email: "a@acme.com", website: "https://other.biz", companyName: "Acme" })).toEqual(["website_mismatch"]);
    expect(riskHints({ email: "a@acme.com", website: "https://www.etsy.com/shop/acme", companyName: "Acme" })).toEqual([]);
    expect(riskHints({ email: "a@acme.com", companyName: "Acme Trading GmbH", registryName: "ACME TRADING" })).toEqual([]);
    expect(riskHints({ email: "a@acme.com", companyName: "Acme Trading", registryName: "Globex Industries LLC" })).toEqual(["registry_mismatch"]);
    expect(riskHints({ email: "a@acme.com", companyName: "Acme", billingLine: "P.O. Box 123" })).toEqual(["po_box"]);
    expect(riskHints({ email: "a@acme.com", companyName: "Acme", billingLine: "PO Box 1", shippingSame: false, shippingLine: "1 Main St" })).toEqual([]);
    for (const x of ["PO Box 5", "p.o.box 9", "Postfach 12", "Boîte postale 4", "Apartado 33", "Casella postale 1"]) expect(isPoBox(x), x).toBe(true);
    expect(isPoBox("100 Boxwood Lane")).toBe(false);
    expect(hostOf("Example.co.uk/path")).toBe("example.co.uk");
    expect(namesDiffer("Müller & Söhne", "MULLER AND SOHNE KG")).toBe(false);
    const facts = { country: "US", businessType: null, emailDomain: "gmail.com", taxVerified: false, hasCertificate: false, flags: [], answers: {}, risk: ["free_email"] } as ApplicationFacts;
    expect(matchCondition({ type: "free_email" }, facts)).toBe(true);
    expect(matchCondition({ type: "po_box" }, facts)).toBe(false);
    expect(riskForApplication({ email: "x@hotmail.com", companyName: "X", taxCheckName: null, answers: { shippingAddress: { same: true }, billingAddress: { address1: "PO Box 4" } } })).toEqual(["free_email", "po_box"]);
  });

  it("shows where applicants came from: top sources and CSV columns", async () => {
    await mkApp({ attribution: { utm_source: "qr", utm_medium: "print" } });
    await mkApp({ attribution: { utm_source: "qr" } });
    await mkApp({ attribution: { ref: "google.com" } });
    const top = await topSources(SHOP, new Date(Date.now() - 86_400_000), new Date(Date.now() + 1000));
    expect(top.find((x) => x.source === "qr")).toEqual({ source: "qr", count: 2 });
    expect(top.some((x) => x.source === "google.com")).toBe(true);
    expect(top.some((x) => x.source === "")).toBe(true); // direct
    const csv = await exportCsv(SHOP, null, { tab: "all" });
    expect(csv.split("\r\n")[0]).toContain("utmSource,utmMedium,utmCampaign,referrer,landingPage");
    expect(csv).toContain(",qr,print,");
  });

  it("QR codes are made locally and tag the address", () => {
    const svg = qrSvg("https://nordic.test/pages/wholesale?utm_source=qr");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toMatch(/<path d="M\d/);
    expect(svg).not.toMatch(/<script|href=/);
    expect(trackedUrl("https://nordic.test/pages/wholesale")).toBe("https://nordic.test/pages/wholesale?utm_source=qr&utm_medium=print");
  });
});

describe("C19 customer tags on approval", () => {
  const input = (tierId: string, over: Partial<ApproveInput> = {}): ApproveInput => ({
    tierId, paymentTermsTemplateId: null, taxExempt: false, exemptions: [], taxRegistrationId: null, companyName: "Acme", locationName: "Acme HQ",
    billingAddress: { address1: "1 Main St", city: "Austin", zoneCode: "TX", countryCode: "US" }, shippingAddress: null,
    contact: { mode: "new" }, sendWelcome: false, ...over,
  });

  it("parses the merchant's tag list", () => {
    expect(cleanTags(" wholesale, b2b ,wholesale,")).toEqual(["wholesale", "b2b"]);
    expect(cleanTags(Array.from({ length: 11 }, (_, i) => `t${i}`).join(","))).toBeNull();
    expect(cleanTags("x".repeat(41))).toBeNull();
  });

  it("adds the tags as an approval step, reads them back, and Undo removes only what it added", async () => {
    const fake = fakeShopify();
    const marketGid = fake.addMarket(["gid://shopify/CompanyLocation/999"]);
    const tier = await db.tier.create({ data: { shop: SHOP, name: `T-${rnd}`, marketGid } });
    const app = await mkApp();
    const ctx = { admin: fake.admin, shop: SHOP, actor: "staff" };
    fake.hooks.TierMarketUpdate = () => ({ marketUpdate: { market: null, userErrors: [{ field: ["id"], message: "Busy", code: "MARKET_UPDATE_CONCURRENT_MODIFICATION" }] } });
    const state = await approveApplication(ctx, app.id, input(tier.id, { customerTags: ["wholesale", "b2b"] }));
    // The tier step failed (stops before tags): nothing tagged yet.
    expect(state.steps.tags.status).toBe("pending");
    delete fake.hooks.TierMarketUpdate;
    const customer = [...fake.companies.values()][0].contacts[0].customer;
    fake.tags.set(customer, new Set(["vip"]));
    const done = await approveApplication(ctx, app.id, input(tier.id, { customerTags: ["wholesale", "b2b"] }));
    expect(done.steps.tags).toMatchObject({ status: "done", gid: customer, added: ["wholesale", "b2b"] });
    expect([...fake.tags.get(customer)!].sort()).toEqual(["b2b", "vip", "wholesale"]);
    expect(done.finishedAt).toBeTruthy();
    // Undo applies to unfinished approvals; simulate one that stopped after the tags.
    await db.application.update({ where: { id: app.id }, data: { status: "pending", buyerId: null, approvalState: { ...done, finishedAt: undefined, buyerId: undefined } as object } });
    await undoApproval(ctx, app.id);
    expect([...fake.tags.get(customer)!]).toEqual(["vip"]);
  });

  it("older saved approvals without the tags step still load", async () => {
    const s = readSettings({});
    expect(s.customerTags).toEqual({ onApprove: [], removeOnPause: true });
    const app = await mkApp({ approvalState: { input: { tierId: "x" }, steps: { company: { status: "done" } }, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() } });
    // Approved and finished: approveApplication returns the stored state without running anything.
    await db.application.update({ where: { id: app.id }, data: { status: "approved" } });
    const st = await approveApplication({ admin: fakeShopify().admin, shop: SHOP, actor: "x" }, app.id, input("x"));
    expect(st.steps.tags.status).toBe("skipped");
  });
});

describe("rejecting still works with the richer Flow payload", () => {
  it("rejects and records the reason", async () => {
    const app = await mkApp();
    expect(await rejectApplicationWithReason({ admin: { graphql: async () => new Response(JSON.stringify({ data: {} })) } as never, shop: SHOP, actor: "x" }, app.id, { reason: "No" })).toBe(true);
  });
});
