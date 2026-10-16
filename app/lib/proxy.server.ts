import { createHmac } from "node:crypto";
import { safeEqual } from "./crypto.server";

// App proxy signature check, per shopify.dev "Authenticate app proxies"
// (verified 2026-10-16, see API_NOTES.md): remove `signature`, build
// key=value with repeated keys joined by ",", sort, concatenate with no
// separator, HMAC-SHA256 with the app secret, hex, constant-time compare.

export const MAX_PROXY_AGE_SECONDS = 300;

export type ProxyContext = {
  shop: string;
  loggedInCustomerId: string | null;
  pathPrefix: string;
};

export function proxySignature(params: URLSearchParams, secret: string): string {
  const grouped = new Map<string, string[]>();
  for (const [k, v] of params) {
    if (k === "signature") continue;
    grouped.set(k, [...(grouped.get(k) ?? []), v]);
  }
  const message = [...grouped.entries()]
    .map(([k, vs]) => `${k}=${vs.join(",")}`)
    .sort()
    .join("");
  return createHmac("sha256", secret).update(message).digest("hex");
}

export function verifyProxyRequest(
  url: URL,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): ProxyContext | null {
  const sig = url.searchParams.get("signature");
  const shop = url.searchParams.get("shop");
  const ts = Number(url.searchParams.get("timestamp"));
  if (!sig || !shop || !Number.isFinite(ts)) return null;
  if (Math.abs(nowSeconds - ts) > MAX_PROXY_AGE_SECONDS) return null;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return null;
  if (!safeEqual(proxySignature(url.searchParams, secret), sig)) return null;
  return {
    shop,
    loggedInCustomerId: url.searchParams.get("logged_in_customer_id") || null,
    pathPrefix: url.searchParams.get("path_prefix") ?? "",
  };
}
