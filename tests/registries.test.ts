import { afterEach, describe, expect, it } from "vitest";
import { BRREG_URL, NZBN_URL, checkTaxNumber, norwayOrgNumber, parseBrreg, parseNzbn } from "../app/lib/taxcheck.server";
import { registryFor, registryHost } from "../app/lib/tax-registries";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Norway: Brønnøysund Enhetsregisteret (E24)", () => {
  it("reads organisation numbers with the NO prefix and MVA suffix, and rejects bad check digits offline", () => {
    expect(norwayOrgNumber("923609016")).toEqual({ orgnr: "923609016", vat: false });
    expect(norwayOrgNumber("NO923609016MVA")).toEqual({ orgnr: "923609016", vat: true });
    expect(norwayOrgNumber("923609017")).toBeNull();
    expect(norwayOrgNumber("12345")).toBeNull();
  });

  it("maps register replies", () => {
    const ok = { organisasjonsnummer: "923609016", navn: "EQUINOR ASA", konkurs: false, underAvvikling: false, registrertIMvaregisteret: true };
    expect(parseBrreg(200, ok)).toEqual({ status: "verified", name: "EQUINOR ASA", registry: "brreg" });
    expect(parseBrreg(200, { ...ok, konkurs: true }).status).toBe("not_verified");
    expect(parseBrreg(200, { ...ok, slettedato: "2024-01-01" }).status).toBe("not_verified");
    expect(parseBrreg(200, { ...ok, registrertIMvaregisteret: false }, true).status).toBe("not_verified");
    expect(parseBrreg(200, { ...ok, registrertIMvaregisteret: false }, false).status).toBe("verified");
    expect(parseBrreg(404, null).status).toBe("not_verified");
    expect(parseBrreg(410, { slettedato: "2020-01-01" }).status).toBe("not_verified");
    expect(parseBrreg(500, null).status).toBe("unavailable");
    expect(parseBrreg(200, { unexpected: true }).status).toBe("unavailable");
  });

  it("calls the open API without a key, and never on a bad check digit", async () => {
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(String(url));
      return json(200, { organisasjonsnummer: "923609016", navn: "EQUINOR ASA" });
    }) as unknown as typeof fetch;
    expect((await checkTaxNumber("NO", "NO 923 609 016 MVA", f)).status).toBe("verified");
    expect(calls).toEqual([`${BRREG_URL}/923609016`]);
    expect((await checkTaxNumber("NO", "923609017", f)).status).toBe("not_verified");
    expect(calls).toHaveLength(1);
  });

  it("times out to unavailable within the total budget", async () => {
    const never = (() => new Promise(() => {})) as unknown as typeof fetch;
    const t0 = Date.now();
    expect((await checkTaxNumber("NO", "923609016", never, 50)).status).toBe("unavailable");
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("New Zealand: NZBN (E24)", () => {
  afterEach(() => {
    delete process.env.NZBN_API_KEY;
  });

  it("maps replies defensively", () => {
    expect(parseNzbn(200, { entityName: "ACME LIMITED", entityStatusDescription: "Registered" })).toEqual({ status: "verified", name: "ACME LIMITED", registry: "nzbn" });
    expect(parseNzbn(200, { entityName: "ACME LIMITED", entityStatusDescription: "Removed" }).status).toBe("not_verified");
    expect(parseNzbn(200, { entityName: "ACME LIMITED" }).status).toBe("unavailable");
    expect(parseNzbn(404, null).status).toBe("not_verified");
    expect(parseNzbn(503, null).status).toBe("unavailable");
  });

  it("only calls with the free key set, and only for 13-digit NZBNs", async () => {
    const calls: { url: string; key?: string }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), key: (init?.headers as Record<string, string>)?.["Ocp-Apim-Subscription-Key"] });
      return json(200, { entityName: "ACME LIMITED", entityStatusDescription: "Registered" });
    }) as unknown as typeof fetch;
    expect((await checkTaxNumber("NZ", "9429041535632", f)).status).toBe("unavailable");
    expect(calls).toHaveLength(0);
    process.env.NZBN_API_KEY = "k";
    expect((await checkTaxNumber("NZ", "9429041535632", f)).status).toBe("verified");
    expect(calls).toEqual([{ url: `${NZBN_URL}/9429041535632`, key: "k" }]);
    expect((await checkTaxNumber("NZ", "49-091-850", f)).status).toBe("na");
    expect(calls).toHaveLength(1);
  });
});

describe("official lookup links", () => {
  it("links every live-checked country and the link-only ones, government hosts only", () => {
    for (const c of ["DE", "FR", "XI", "GB", "AU", "NO", "NZ", "CH", "CA"]) {
      const r = registryFor(c);
      expect(r, c).not.toBeNull();
      expect(new URL(r!.url).protocol).toBe("https:");
      expect(registryHost(r!.url)).toMatch(/(europa\.eu|gov\.uk|gov\.au|brreg\.no|govt\.nz|admin\.ch|canada\.ca)$/);
    }
    expect(registryFor("CH")!.live).toBeNull();
    expect(registryFor("CA")!.live).toBeNull();
    expect(registryFor("ZZ")).toBeNull();
    expect(registryFor(undefined)).toBeNull();
  });
});
