import { afterEach, describe, expect, it, vi } from "vitest";
import { abnChecksumOk, checkTaxNumber, parseAbn, parseHmrc, parseVies, viesPrefix, _resetHmrcToken } from "../app/lib/taxcheck.server";

const res = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

afterEach(() => {
  delete process.env.HMRC_CLIENT_ID;
  delete process.env.HMRC_CLIENT_SECRET;
  delete process.env.ABN_GUID;
  _resetHmrcToken();
});

describe("VIES", () => {
  it("parses valid, invalid and member-state-unavailable replies", () => {
    expect(parseVies(200, { countryCode: "DE", vatNumber: "123456789", valid: true, name: "ACME GMBH", address: "---" })).toEqual({ status: "verified", name: "ACME GMBH", registry: "vies" });
    expect(parseVies(200, { valid: true, name: "---" })).toEqual({ status: "verified", name: undefined, registry: "vies" });
    expect(parseVies(200, { valid: false })).toEqual({ status: "not_verified", registry: "vies" });
    expect(parseVies(200, { isValid: false, userError: "MS_UNAVAILABLE" }).status).toBe("unavailable");
    expect(parseVies(500, { actionSucceed: false, errorWrappers: [{ error: "MS_MAX_CONCURRENT_REQ" }] }).status).toBe("unavailable");
    expect(parseVies(400, { actionSucceed: false, errorWrappers: [{ error: "INVALID_INPUT" }] }).status).toBe("not_verified");
    expect(parseVies(200, {}).status).toBe("unavailable");
  });

  it("uses EL for Greece and XI for Northern Ireland, strips the prefix", async () => {
    expect(viesPrefix("GR", "123")).toBe("EL");
    expect(viesPrefix("GB", "XI123456789")).toBe("XI");
    expect(viesPrefix("US", "1")).toBeNull();
    const f = vi.fn(async () => res(200, { valid: true, name: "X" }));
    await checkTaxNumber("GR", "EL 094 259 216", f as never);
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ countryCode: "EL", vatNumber: "094259216" });
    await checkTaxNumber("GB", "XI 123456789", f as never);
    expect(JSON.parse((f.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toEqual({ countryCode: "XI", vatNumber: "123456789" });
  });

  it("marks malformed numbers not_verified without calling VIES, and timeouts unavailable", async () => {
    const f = vi.fn();
    expect(await checkTaxNumber("DE", "DE12345678901234567", f as never)).toEqual({ status: "not_verified", registry: "vies" });
    expect(f).not.toHaveBeenCalled();
    const slow = vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); });
    expect(await checkTaxNumber("FR", "FR12345678901", slow as never)).toEqual({ status: "unavailable" });
  });

  it("returns na for empty numbers and countries without a registry", async () => {
    expect(await checkTaxNumber("DE", "  ")).toEqual({ status: "na" });
    expect(await checkTaxNumber("JP", "1234", vi.fn() as never)).toEqual({ status: "na" });
  });
});

describe("HMRC (optional)", () => {
  it("is unavailable without credentials, and checks the format first", async () => {
    const f = vi.fn();
    expect(await checkTaxNumber("GB", "GB123456789", f as never)).toEqual({ status: "unavailable", registry: "hmrc" });
    expect(await checkTaxNumber("GB", "GB12", f as never)).toEqual({ status: "not_verified", registry: "hmrc" });
    expect(f).not.toHaveBeenCalled();
  });

  it("gets a token and looks the number up", async () => {
    process.env.HMRC_CLIENT_ID = "id";
    process.env.HMRC_CLIENT_SECRET = "secret";
    const f = vi.fn(async (url: string) =>
      url.endsWith("/oauth/token") ? res(200, { access_token: "tok", expires_in: 14400 }) : res(200, { target: { name: "ACME LTD", vatNumber: "123456789" } }),
    );
    expect(await checkTaxNumber("GB", "GB 123 4567 89", f as never)).toEqual({ status: "verified", name: "ACME LTD", registry: "hmrc" });
    expect(f.mock.calls[1][0]).toMatch(/\/organisations\/vat\/check-vat-number\/lookup\/123456789$/);
    expect(parseHmrc(404, {})).toEqual({ status: "not_verified", registry: "hmrc" });
    expect(parseHmrc(503, {}).status).toBe("unavailable");
  });
});

describe("ABN (optional)", () => {
  it("validates the checksum and parses JSONP", async () => {
    expect(abnChecksumOk("51824753556")).toBe(true); // ATO's published example
    expect(abnChecksumOk("51824753557")).toBe(false);
    expect(await checkTaxNumber("AU", "51 824 753 557", vi.fn() as never)).toEqual({ status: "not_verified", registry: "abr" });
    expect(await checkTaxNumber("AU", "51 824 753 556", vi.fn() as never)).toEqual({ status: "unavailable", registry: "abr" });
    process.env.ABN_GUID = "g";
    const f = vi.fn(async () => res(200, 'c({"Abn":"51824753556","AbnStatus":"Active","EntityName":"AUSTRALIAN TAXATION OFFICE","Message":""})'));
    expect(await checkTaxNumber("AU", "51824753556", f as never)).toEqual({ status: "verified", name: "AUSTRALIAN TAXATION OFFICE", registry: "abr" });
    expect(parseAbn('c({"Abn":"","Message":"Search text is not a valid ABN or ACN"})').status).toBe("not_verified");
    expect(parseAbn('c({"Abn":"1","AbnStatus":"Cancelled"})').status).toBe("not_verified");
    expect(parseAbn("garbage").status).toBe("unavailable");
  });
});
