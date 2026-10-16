import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { proxySignature, verifyProxyRequest } from "../app/lib/proxy.server";

const SECRET = "hush";

describe("app proxy signature", () => {
  it("matches Shopify's documented example string", () => {
    // From shopify.dev "Authenticate app proxies": repeated keys joined with ",", sorted, no separator.
    const p = new URLSearchParams("extra=1&extra=2&shop=shop.myshopify.com&logged_in_customer_id=1&path_prefix=/apps/awesome_reviews&timestamp=1317327555&signature=x");
    const expected = createHmac("sha256", SECRET)
      .update("extra=1,2logged_in_customer_id=1path_prefix=/apps/awesome_reviewsshop=shop.myshopify.comtimestamp=1317327555")
      .digest("hex");
    expect(proxySignature(p, SECRET)).toBe(expected);
  });

  const signed = (q: string) => {
    const p = new URLSearchParams(q);
    p.set("signature", proxySignature(p, SECRET));
    return new URL(`https://app.test/proxy/apply?${p}`);
  };

  it("accepts a fresh, correctly signed request and reads the customer", () => {
    const now = 1_800_000_000;
    const ctx = verifyProxyRequest(signed(`shop=a-b.myshopify.com&logged_in_customer_id=42&path_prefix=/apps/tradepass&timestamp=${now}`), SECRET, now);
    expect(ctx).toEqual({ shop: "a-b.myshopify.com", loggedInCustomerId: "42", pathPrefix: "/apps/tradepass" });
  });

  it("treats an empty logged_in_customer_id as anonymous", () => {
    const now = 1_800_000_000;
    expect(verifyProxyRequest(signed(`shop=a.myshopify.com&logged_in_customer_id=&timestamp=${now}`), SECRET, now)?.loggedInCustomerId).toBeNull();
  });

  it("rejects tampered, stale and malformed requests", () => {
    const now = 1_800_000_000;
    const url = signed(`shop=a.myshopify.com&logged_in_customer_id=1&timestamp=${now}`);
    url.searchParams.set("logged_in_customer_id", "2");
    expect(verifyProxyRequest(url, SECRET, now)).toBeNull();
    expect(verifyProxyRequest(signed(`shop=a.myshopify.com&timestamp=${now - 3600}`), SECRET, now)).toBeNull();
    expect(verifyProxyRequest(signed(`shop=evil.com&timestamp=${now}`), SECRET, now)).toBeNull();
    expect(verifyProxyRequest(new URL("https://app.test/proxy"), SECRET, now)).toBeNull();
  });
});
