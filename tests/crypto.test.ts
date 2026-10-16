import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt, signToken, verifyToken } from "../app/lib/crypto.server";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.LINK_TOKEN_SECRET = "test-secret";
});

describe("encryption at rest", () => {
  it("round-trips and never stores plaintext", () => {
    const c = encrypt("DE123456789");
    expect(c).not.toContain("DE123456789");
    expect(decrypt(c)).toBe("DE123456789");
    expect(encrypt("x")).not.toBe(encrypt("x"));
  });
});

describe("link tokens", () => {
  const base = { shop: "a.myshopify.com", purpose: "more_info" as const, subject: "app_1" };
  it("verifies valid tokens and carries no personal data", () => {
    const tok = signToken({ ...base, exp: Math.floor(Date.now() / 1000) + 60 });
    const r = verifyToken(tok);
    expect(r.ok).toBe(true);
    expect(Buffer.from(tok.split(".")[0], "base64url").toString()).not.toMatch(/@/);
  });
  it("rejects expired and tampered tokens", () => {
    expect(verifyToken(signToken({ ...base, exp: 1 }))).toEqual({ ok: false, reason: "expired" });
    const tok = signToken({ ...base, exp: Math.floor(Date.now() / 1000) + 60 });
    const forged = Buffer.from(JSON.stringify({ ...base, subject: "app_2", exp: 9e9, n: "x" })).toString("base64url") + "." + tok.split(".")[1];
    expect(verifyToken(forged)).toEqual({ ok: false, reason: "tampered" });
  });
});
