// Certificate uploads go to the merchant's own Shopify Files (hard constraint 1):
// stagedUploadsCreate → POST the bytes to the staged target → fileCreate → brief
// fileStatus poll. Verified against Admin GraphQL 2026-10 (docs/notes/storefront.md).
// Files are never stored on our server and never rendered as HTML.
import { createHmac, randomBytes } from "node:crypto";
import { gql, mutate, type Admin } from "./gql.server";
import { safeEqual } from "./crypto.server";

export const ALLOWED_UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 3;

export type UploadInput = { filename: string; mimeType: string; bytes: Uint8Array };
export type AllowedType = (typeof ALLOWED_UPLOAD_TYPES)[number];
export type UploadCheck = { ok: true; mimeType: AllowedType; ext: "pdf" | "jpg" | "png" } | { ok: false; error: "file_type" | "file_size" };

/** Identify the file by its magic bytes, never by what the browser claims. */
export function sniffType(bytes: Uint8Array): AllowedType | null {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf"; // %PDF-
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

const EXT_FOR: Record<AllowedType, RegExp> = {
  "application/pdf": /\.pdf$/i,
  "image/jpeg": /\.jpe?g$/i,
  "image/png": /\.png$/i,
};

/** Extension, declared type and magic bytes must all agree; size ≤ 5 MB. */
export function validateUpload(file: UploadInput): UploadCheck {
  if (file.bytes.length === 0) return { ok: false, error: "file_type" };
  if (file.bytes.length > MAX_UPLOAD_BYTES) return { ok: false, error: "file_size" };
  const sniffed = sniffType(file.bytes);
  if (!sniffed || !EXT_FOR[sniffed].test(file.filename)) return { ok: false, error: "file_type" };
  // Browsers occasionally send an empty or generic type; a wrong specific type is rejected.
  const declared = file.mimeType.toLowerCase();
  if (declared && declared !== "application/octet-stream" && declared !== sniffed && !(sniffed === "image/jpeg" && declared === "image/jpg")) {
    return { ok: false, error: "file_type" };
  }
  return { ok: true, mimeType: sniffed, ext: sniffed === "application/pdf" ? "pdf" : sniffed === "image/png" ? "png" : "jpg" };
}

/** Random, unguessable name: the Shopify CDN URL is public, so the name must not be predictable (D-006). */
export function randomFilename(ext: string): string {
  return `tradepass-${randomBytes(16).toString("hex")}.${ext}`;
}

const STAGED = `#graphql
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }`;

const FILE_CREATE = `#graphql
  mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id fileStatus }
      userErrors { field message code }
    }
  }`;

const FILE_STATUS = `#graphql
  query fileStatus($id: ID!) { node(id: $id) { ... on File { id fileStatus } } }`;

type StagedTarget = { url: string; resourceUrl: string; parameters: { name: string; value: string }[] };

export class UploadError extends Error {
  constructor(readonly code: "file_type" | "file_size" | "upload_failed") {
    super(code);
    this.name = "UploadError";
  }
}

/** Validate (type sniffing + size) and store a file in the merchant's Shopify Files via staged upload. Returns the File GID. */
export async function uploadToShopifyFiles(
  admin: Admin,
  file: UploadInput,
  opts: { fetchImpl?: typeof fetch; pollMs?: number; polls?: number } = {},
): Promise<{ fileGid: string }> {
  const check = validateUpload(file);
  if (!check.ok) throw new UploadError(check.error);
  const doFetch = opts.fetchImpl ?? fetch;
  const filename = randomFilename(check.ext);

  const staged = await mutate<{ stagedTargets: StagedTarget[] }>(admin, "stagedUploadsCreate", STAGED, {
    input: [{ filename, mimeType: check.mimeType, resource: "FILE", httpMethod: "POST", fileSize: String(file.bytes.length) }],
  });
  const target = staged.stagedTargets[0];
  if (!target) throw new UploadError("upload_failed");

  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([new Uint8Array(file.bytes)], { type: check.mimeType }), filename);
  const put = await doFetch(target.url, { method: "POST", body: form, signal: AbortSignal.timeout(20_000) });
  if (!put.ok) throw new UploadError("upload_failed");

  const created = await mutate<{ files: { id: string; fileStatus: string }[] }>(admin, "fileCreate", FILE_CREATE, {
    files: [{ originalSource: target.resourceUrl, contentType: "FILE", filename, alt: "" }],
  });
  const f = created.files[0];
  if (!f) throw new UploadError("upload_failed");

  // Processing is asynchronous. Poll briefly; UPLOADED/PROCESSING files still finish
  // on Shopify's side, so only FAILED is an error.
  let status = f.fileStatus;
  for (let i = 0; i < (opts.polls ?? 3) && status !== "READY" && status !== "FAILED"; i++) {
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 700));
    const d = await gql<{ node: { fileStatus: string } | null }>(admin, FILE_STATUS, { id: f.id });
    status = d.node?.fileStatus ?? status;
  }
  if (status === "FAILED") throw new UploadError("upload_failed");
  return { fileGid: f.id };
}

// The browser uploads first and submits later, so it gets an opaque, signed
// reference instead of the raw GID. Submit only accepts refs for its own shop.
const REF_TTL_MS = 24 * 3600_000;

function refSecret(): string {
  const s = process.env.LINK_TOKEN_SECRET;
  if (!s) throw new Error("LINK_TOKEN_SECRET is not set");
  return s;
}

export function signFileRef(shop: string, fileGid: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ s: shop, g: fileGid, e: now + REF_TTL_MS })).toString("base64url");
  return `${body}.${createHmac("sha256", refSecret()).update(`file:${body}`).digest("base64url")}`;
}

export function verifyFileRef(ref: unknown, shop: string, now = Date.now()): string | null {
  if (typeof ref !== "string" || ref.length > 600) return null;
  const [body, sig] = ref.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", refSecret()).update(`file:${body}`).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { s: string; g: string; e: number };
    if (p.s !== shop || p.e < now || !p.g.startsWith("gid://shopify/")) return null;
    return p.g;
  } catch {
    return null;
  }
}
