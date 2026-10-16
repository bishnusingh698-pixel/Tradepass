import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Tax numbers are encrypted at rest with AES-256-GCM. ENCRYPTION_KEY is 32
// random bytes, base64 (generate with `openssl rand -base64 32`).
function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return buf;
}

/** Returns "v1.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ct].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decrypt(blob: string): string {
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised ciphertext");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Signed link tokens for "more info" and certificate-renewal pages.
 * Payload holds only opaque ids (never personal data). Single use is enforced
 * by the TokenUse table, keyed by sha256(token).
 */
export type LinkToken = { shop: string; purpose: "more_info" | "renewal"; subject: string; exp: number; n: string };

function tokenSecret(): string {
  const s = process.env.LINK_TOKEN_SECRET;
  if (!s) throw new Error("LINK_TOKEN_SECRET is not set");
  return s;
}

export function signToken(t: Omit<LinkToken, "n">): string {
  const body = Buffer.from(JSON.stringify({ ...t, n: randomBytes(8).toString("base64url") })).toString("base64url");
  const sig = createHmac("sha256", tokenSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export type TokenCheck = { ok: true; token: LinkToken } | { ok: false; reason: "tampered" | "expired" };

export function verifyToken(raw: string, now = Date.now()): TokenCheck {
  const [body, sig] = raw.split(".");
  if (!body || !sig) return { ok: false, reason: "tampered" };
  const expected = createHmac("sha256", tokenSecret()).update(body).digest("base64url");
  if (!safeEqual(sig, expected)) return { ok: false, reason: "tampered" };
  let token: LinkToken;
  try {
    token = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "tampered" };
  }
  if (token.exp * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true, token };
}
