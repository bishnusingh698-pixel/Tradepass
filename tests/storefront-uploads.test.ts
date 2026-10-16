import { describe, expect, it, vi } from "vitest";
import { randomFilename, signFileRef, sniffType, uploadToShopifyFiles, UploadError, validateUpload, verifyFileRef, MAX_UPLOAD_BYTES } from "../app/lib/uploads.server";

process.env.LINK_TOKEN_SECRET ||= "test-link-secret";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");

describe("upload validation (magic bytes + extension + size)", () => {
  it("recognises PDF, PNG and JPEG by content", () => {
    expect(sniffType(PDF)).toBe("application/pdf");
    expect(sniffType(PNG)).toBe("image/png");
    expect(sniffType(JPG)).toBe("image/jpeg");
    expect(sniffType(HTML)).toBeNull();
  });

  it("accepts matching files and rejects disguised or oversized ones", () => {
    expect(validateUpload({ filename: "cert.PDF", mimeType: "application/pdf", bytes: PDF })).toEqual({ ok: true, mimeType: "application/pdf", ext: "pdf" });
    expect(validateUpload({ filename: "scan.jpeg", mimeType: "", bytes: JPG })).toMatchObject({ ok: true, ext: "jpg" });
    expect(validateUpload({ filename: "scan.jpg", mimeType: "image/jpg", bytes: JPG })).toMatchObject({ ok: true });
    // HTML renamed to .pdf, PDF bytes with an .exe name, PNG claiming to be a PDF.
    expect(validateUpload({ filename: "cert.pdf", mimeType: "application/pdf", bytes: HTML })).toEqual({ ok: false, error: "file_type" });
    expect(validateUpload({ filename: "cert.exe", mimeType: "application/pdf", bytes: PDF })).toEqual({ ok: false, error: "file_type" });
    expect(validateUpload({ filename: "cert.png", mimeType: "application/pdf", bytes: PNG })).toEqual({ ok: false, error: "file_type" });
    expect(validateUpload({ filename: "e.pdf", mimeType: "application/pdf", bytes: new Uint8Array() })).toEqual({ ok: false, error: "file_type" });
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(PDF);
    expect(validateUpload({ filename: "big.pdf", mimeType: "application/pdf", bytes: big })).toEqual({ ok: false, error: "file_size" });
  });

  it("randomises file names", () => {
    const a = randomFilename("pdf");
    expect(a).toMatch(/^tradepass-[0-9a-f]{32}\.pdf$/);
    expect(randomFilename("pdf")).not.toBe(a);
  });
});

describe("signed file references", () => {
  it("round-trips for the same shop only and expires", () => {
    const ref = signFileRef("a.myshopify.com", "gid://shopify/GenericFile/9", 1_000);
    expect(verifyFileRef(ref, "a.myshopify.com", 2_000)).toBe("gid://shopify/GenericFile/9");
    expect(verifyFileRef(ref, "b.myshopify.com", 2_000)).toBeNull();
    expect(verifyFileRef(ref, "a.myshopify.com", 1_000 + 25 * 3600_000)).toBeNull();
    expect(verifyFileRef(ref.replace(/.$/, (c) => (c === "A" ? "B" : "A")), "a.myshopify.com", 2_000)).toBeNull();
    expect(verifyFileRef(42, "a.myshopify.com")).toBeNull();
  });
});

describe("uploadToShopifyFiles", () => {
  function fakeAdmin(status = "READY") {
    const calls: { op: string; vars: Record<string, unknown> }[] = [];
    const graphql = vi.fn(async (query: string, opts?: { variables?: Record<string, unknown> }) => {
      const vars = opts?.variables ?? {};
      const op = /(stagedUploadsCreate|fileCreate|fileStatus)/.exec(query)![1];
      calls.push({ op, vars });
      const data =
        op === "stagedUploadsCreate"
          ? { stagedUploadsCreate: { stagedTargets: [{ url: "https://upload.example/bucket", resourceUrl: "https://upload.example/bucket/key", parameters: [{ name: "key", value: "k1" }] }], userErrors: [] } }
          : op === "fileCreate"
            ? { fileCreate: { files: [{ id: "gid://shopify/GenericFile/77", fileStatus: "UPLOADED" }], userErrors: [] } }
            : { node: { id: "gid://shopify/GenericFile/77", fileStatus: status } };
      return new Response(JSON.stringify({ data }));
    });
    return { admin: { graphql } as never, calls };
  }

  it("stages, uploads, creates and polls the file, with a random name", async () => {
    const { admin, calls } = fakeAdmin();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const out = await uploadToShopifyFiles(admin, { filename: "My Cert.pdf", mimeType: "application/pdf", bytes: PDF }, { fetchImpl: fetchImpl as never, pollMs: 1 });
    expect(out).toEqual({ fileGid: "gid://shopify/GenericFile/77" });
    const staged = (calls[0].vars.input as Record<string, unknown>[])[0];
    expect(staged).toMatchObject({ mimeType: "application/pdf", resource: "FILE", httpMethod: "POST" });
    expect(String(staged.filename)).toMatch(/^tradepass-[0-9a-f]{32}\.pdf$/);
    expect(fetchImpl).toHaveBeenCalledWith("https://upload.example/bucket", expect.objectContaining({ method: "POST" }));
    const created = (calls[1].vars.files as Record<string, unknown>[])[0];
    expect(created).toMatchObject({ originalSource: "https://upload.example/bucket/key", contentType: "FILE" });
    expect(calls[2].op).toBe("fileStatus");
  });

  it("refuses invalid files before calling Shopify and reports failed processing", async () => {
    const { admin, calls } = fakeAdmin("FAILED");
    await expect(uploadToShopifyFiles(admin, { filename: "x.pdf", mimeType: "application/pdf", bytes: HTML })).rejects.toBeInstanceOf(UploadError);
    expect(calls).toHaveLength(0);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(uploadToShopifyFiles(admin, { filename: "x.pdf", mimeType: "application/pdf", bytes: PDF }, { fetchImpl: fetchImpl as never, pollMs: 1 })).rejects.toThrow("upload_failed");
  });
});
