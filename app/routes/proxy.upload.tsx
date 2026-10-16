import type { ActionFunctionArgs } from "react-router";
import { json, proxyContext } from "../lib/intake.server";
import { clientIp, hashKey, hit, LIMITS } from "../lib/spam.server";
import { MAX_UPLOAD_BYTES, signFileRef, uploadToShopifyFiles, UploadError, validateUpload } from "../lib/uploads.server";
import { unauthenticated } from "../shopify.server";

// POST /apps/tradepass/upload: one certificate (PDF/JPG/PNG ≤ 5 MB). The file
// goes straight to the merchant's Shopify Files; the browser gets a signed
// reference that the later submit turns back into the File GID.
export const loader = () => json({ ok: false, error: "method_not_allowed" }, 405);

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const ctx = await proxyContext(request);
  if (!ctx) return json({ ok: false, error: "unauthorized" }, 401);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024) return json({ ok: false, error: "file_size" }, 400);
  if (!(await hit(`upload:${hashKey("ip", clientIp(request))}`, LIMITS.uploadPerIp)).allowed) return json({ ok: false, error: "rate_limited" }, 429);

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
  } catch {
    file = null;
  }
  if (!file) return json({ ok: false, error: "file_type" }, 400);
  const input = { filename: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
  const check = validateUpload(input);
  if (!check.ok) return json({ ok: false, error: check.error }, 400);

  try {
    const { admin } = await unauthenticated.admin(ctx.shop);
    const { fileGid } = await uploadToShopifyFiles(admin, input);
    return json({ ok: true, ref: signFileRef(ctx.shop, fileGid) });
  } catch (e) {
    if (e instanceof UploadError && e.code !== "upload_failed") return json({ ok: false, error: e.code }, 400);
    // 503 makes the browser retry (server waking up, Shopify hiccup).
    return json({ ok: false, error: "upload_failed" }, 503);
  }
};
