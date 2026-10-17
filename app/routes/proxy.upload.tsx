import type { ActionFunctionArgs } from "react-router";
import { json, proxyContext } from "../lib/intake.server";
import { clientIp, hashKey, hit, LIMITS } from "../lib/spam.server";
import { MAX_UPLOAD_BYTES, readUploadForm, signFileRef, uploadToShopifyFiles, UploadError } from "../lib/uploads.server";
import { unauthenticated } from "../shopify.server";

// POST /apps/tradepass/upload: one certificate (PDF/JPG/PNG ≤ 5 MB, one file per request). The file
// goes straight to the merchant's Shopify Files; the browser gets a signed
// reference that the later submit turns back into the File GID.
export const loader = () => json({ ok: false, error: "method_not_allowed" }, 405);

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const ctx = await proxyContext(request);
  if (!ctx) return json({ ok: false, error: "unauthorized" }, 401);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024) return json({ ok: false, error: "file_size" }, 400);
  if (!(await hit(`upload:${hashKey("ip", clientIp(request))}`, LIMITS.uploadPerIp)).allowed) return json({ ok: false, error: "rate_limited" }, 429);

  let read: Awaited<ReturnType<typeof readUploadForm>>;
  try {
    read = await readUploadForm(await request.formData());
  } catch {
    read = { ok: false, error: "file_type" };
  }
  if (!read.ok) return json({ ok: false, error: read.error }, 400);
  const input = read.file;

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
