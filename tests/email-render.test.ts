import { describe, expect, it } from "vitest";
import { buildEmail, checkPattern } from "../app/lib/email/templates.server";
import { fontStack, renderEmail } from "../app/lib/email/render";

const vars = { company: "Acme <GmbH>", first_name: "Jo", update_link: "https://s.myshopify.com/apps/tradepass/renew/abc", expiry_date: "2026-11-15" };

describe("email templates", () => {
  it("fills placeholders, escapes HTML, links URLs and adds a plain-text part", () => {
    const e = buildEmail({ type: "cert_expiring", locale: "en", vars, storeName: "Shop & Co" });
    expect(e.subject).toBe("Your certificate for Shop & Co expires on November 15, 2026");
    expect(e.html).toContain('<html lang="en" dir="ltr">');
    expect(e.html).toContain("Acme &lt;GmbH&gt;");
    expect(e.html).not.toContain("Acme <GmbH>");
    expect(e.html).toContain('<a href="https://s.myshopify.com/apps/tradepass/renew/abc"');
    expect(e.text).toContain("Hello Jo,");
    expect(e.text).toContain("https://s.myshopify.com/apps/tradepass/renew/abc");
    expect(e.text).not.toMatch(/<p|<a |&lt;/);
    expect(e.text).not.toMatch(/\{\w+\}/);
  });

  it("renders RTL languages with dir=rtl, isolated values and a script font stack", () => {
    const e = buildEmail({ type: "received", locale: "ar", vars, storeName: "Shop" });
    expect(e.dir).toBe("rtl");
    expect(e.html).toContain('dir="rtl"');
    expect(e.html).toContain("text-align:right");
    expect(e.html).toContain("<bdi>");
    expect(fontStack("ur")).toMatch(/Nastaliq/);
    expect(fontStack("ja")).toMatch(/Hiragino/);
    expect(fontStack("hi")).toMatch(/Devanagari/);
  });

  it("falls back: unknown language → store primary → English; merchant overrides win", () => {
    expect(buildEmail({ type: "received", locale: "xx", primary: "de", vars, storeName: "S" }).locale).toBe("de");
    const o = buildEmail({
      type: "received", locale: "fr", vars, storeName: "S",
      overrides: { fr: { "email.received.subject": "Merci {company}" } },
    });
    expect(o.subject).toBe("Merci Acme <GmbH>");
  });

  it("uses built-in text when a merchant override is broken", () => {
    const e = buildEmail({ type: "received", locale: "en", vars, storeName: "S", overrides: { en: { "email.received.subject": "Hi {company" } } });
    expect(e.subject).toContain("We received your wholesale application");
  });

  it("adds the optional reason only when given, and never greets an empty name", () => {
    const withReason = buildEmail({ type: "rejected", locale: "en", vars: { company: "Acme", reason: "Not a business" }, storeName: "S" });
    expect(withReason.text).toContain("Reason: Not a business");
    expect(withReason.text).toContain("Hello Acme,");
    const without = buildEmail({ type: "rejected", locale: "en", vars: { company: "Acme" }, storeName: "S" });
    expect(without.text).not.toContain("Reason:");
  });

  it("digest lists only non-zero counts with plurals", () => {
    const e = buildEmail({ type: "merchant_digest", locale: "en", vars: { admin_url: "https://x.myshopify.com/admin/apps/k" }, storeName: "S",
      digest: { pending: 3, expiring: 1, expired: 0, failed: 0, deferred: 0 } });
    expect(e.text).toContain("3 applications are waiting for your review.");
    expect(e.text).toContain("1 certificate expires soon.");
    expect(e.text).not.toContain("expired");
  });

  it("test emails carry a prefix and a note", () => {
    const e = buildEmail({ type: "approved", locale: "en", vars, storeName: "S", test: true, draft: { subject: "Welcome {company}" } });
    expect(e.subject).toBe("Test: Welcome Acme <GmbH>");
    expect(e.text).toContain("This is a test email");
  });

  it("validates merchant patterns", () => {
    expect(checkPattern("received", "Hi {company}")).toBeNull();
    expect(checkPattern("received", "Hi {company")).toEqual({ kind: "syntax" });
    expect(checkPattern("received", "Hi {nope}")).toEqual({ kind: "unknown_placeholder", name: "nope" });
  });

  it("renderer keeps paragraphs and logo optional (no images required)", () => {
    const r = renderEmail({ locale: "en", dir: "ltr", subject: "S", body: "A\n\nB", footer: "F", vars: {}, storeName: "X" });
    expect(r.html.match(/<p style/g)?.length).toBe(4); // store name, A, B, footer
    expect(r.html).not.toContain("<img");
    const withLogo = renderEmail({ locale: "en", dir: "ltr", subject: "S", body: "A", footer: "F", vars: {}, storeName: "X", logoUrl: "https://cdn/x.png" });
    expect(withLogo.html).toContain('alt="X"');
  });
});
