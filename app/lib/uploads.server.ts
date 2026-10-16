// CONTRACT (owner: storefront area). Implementation replaces the stub body.
import type { Admin } from "./gql.server";

export const ALLOWED_UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type UploadInput = { filename: string; mimeType: string; bytes: Uint8Array };

/** Validate (type sniffing + size) and store a file in the merchant's Shopify Files via staged upload. Returns the File GID. */
export async function uploadToShopifyFiles(_admin: Admin, _file: UploadInput): Promise<{ fileGid: string }> {
  throw new Error("uploadToShopifyFiles not implemented yet");
}
