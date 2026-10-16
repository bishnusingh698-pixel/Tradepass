import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { fileUrl, findStaffFile } from "../lib/certificates.server";

// Opens a certificate / application file for authenticated staff of the same
// store only (DECISIONS D-006). The admin page fetches this with App Bridge's
// session token, and we stream the bytes back, so the Shopify CDN link never
// reaches the browser. Lookup is by our id AND the session's shop.

const SAFE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_BYTES = 10 * 1024 * 1024;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const gid = await findStaffFile(session.shop, params.id ?? "");
  if (!gid) return new Response("Not found", { status: 404 });
  const file = await fileUrl(admin, gid);
  if (!file) return new Response("Not found", { status: 404 });

  const upstream = await fetch(file.url, { signal: AbortSignal.timeout(20_000) });
  const length = Number(upstream.headers.get("content-length") ?? 0);
  if (!upstream.ok || !upstream.body || length > MAX_BYTES) return new Response("Unavailable", { status: 502 });
  const type = (upstream.headers.get("content-type") ?? file.mimeType ?? "").split(";")[0].trim();

  return new Response(upstream.body, {
    headers: {
      // Only PDF/JPG/PNG are shown inline; anything else downloads, never renders as HTML.
      "Content-Type": SAFE_TYPES.has(type) ? type : "application/octet-stream",
      "Content-Disposition": SAFE_TYPES.has(type) ? "inline" : "attachment",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'",
      "Cache-Control": "private, no-store",
      ...(length ? { "Content-Length": String(length) } : {}),
    },
  });
};
