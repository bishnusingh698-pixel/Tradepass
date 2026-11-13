// Offline check digits for business tax IDs (feature E23). Written in ES5 so the
// same code runs on the server (imported by tax-ids.ts) and in the storefront form:
// scripts/sync-tax-ids.mjs copies everything between the "checksums" markers into
// extensions/tradepass-theme/assets/tradepass-form.js. Only published, official
// algorithms are listed (sources in API_NOTES.md → "Offline check digits"); a
// country without one is never refused for its check digit.
//
// Input: the normalised number (upper case, no spaces . - /), with or without the
// country prefix the table adds (DE, FR, CHE …). Returns true (valid), false (the
// check digit is wrong) or null (no algorithm for this country or shape).

/* checksums:start */
var TAX_CHECKSUMS = (function () {
  function digits(s) { return /^\d+$/.test(s) ? s.split("").map(Number) : null; }
  function weighted(d, w) { var t = 0; for (var i = 0; i < w.length; i++) t += d[i] * w[i]; return t; }
  // ISO 7064 MOD 11,10 (Germany USt-IdNr, Croatia OIB).
  function mod1110(d) {
    var p = 10;
    for (var i = 0; i < d.length - 1; i++) { var s = (d[i] + p) % 10; if (s === 0) s = 10; p = (2 * s) % 11; }
    var c = 11 - p; if (c === 10) c = 0;
    return c === d[d.length - 1];
  }
  function luhn(d) {
    var t = 0;
    for (var i = d.length - 1, k = 0; i >= 0; i--, k++) { var x = d[i]; if (k % 2 === 1) { x *= 2; if (x > 9) x -= 9; } t += x; }
    return t % 10 === 0;
  }
  // Mod 11 with weights; "c" maps the remainder to the check digit (null = no valid check digit).
  function mod11(d, w, c) { var r = weighted(d, w) % 11; var k = c(r); return k !== null && k === d[w.length]; }
  var m11 = function (r) { var k = 11 - r; return k === 11 ? 0 : k === 10 ? null : k; };
  var A36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var A31 = "0123456789ABCDEFGHJKLMNPQRTUWXY";

  var rules = {
    // India GSTIN: GSTN's mod-36 check character (15th).
    IN: function (n) {
      if (!/^[0-9A-Z]{15}$/.test(n)) return null;
      var t = 0;
      for (var i = 0; i < 14; i++) { var p = A36.indexOf(n[i]) * (i % 2 === 0 ? 1 : 2); t += Math.floor(p / 36) + (p % 36); }
      return A36[(36 - (t % 36)) % 36] === n[14];
    },
    // Brazil CNPJ: two mod-11 check digits (Receita Federal).
    BR: function (n) {
      var d = digits(n); if (!d || d.length !== 14 || /^(\d)\1+$/.test(n)) return null;
      var c = function (len, w) { var r = weighted(d, w) % 11; return (r < 2 ? 0 : 11 - r) === d[len]; };
      return c(12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) && c(13, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    },
    // Switzerland UID (CHE-123.456.789): mod 11 over the 8 digits (Federal Statistical Office).
    CH: function (n) {
      var m = /^(?:CHE)?(\d{9})(?:MWST|TVA|IVA)?$/.exec(n); if (!m) return null;
      return mod11(digits(m[1]), [5, 4, 3, 2, 7, 6, 5, 4], m11);
    },
    // Norway organisation number (Brønnøysund): mod 11.
    NO: function (n) {
      var m = /^(?:NO)?(\d{9})(?:MVA)?$/.exec(n); if (!m) return null;
      return mod11(digits(m[1]), [3, 2, 7, 6, 5, 4, 3, 2], m11);
    },
    // New Zealand: GST number = IRD number (Inland Revenue's two-weight mod 11), or the 13-digit NZBN (GS1).
    NZ: function (n) {
      var d = digits(n); if (!d) return null;
      if (d.length === 13) { var t = 0; for (var i = 0; i < 12; i++) t += d[i] * (i % 2 === 0 ? 1 : 3); return (10 - (t % 10)) % 10 === d[12]; }
      if (d.length !== 8 && d.length !== 9) return null;
      if (d.length === 8) d.unshift(0);
      var v = Number(d.join(""));
      if (v < 10000000 || v > 150000000) return false;
      var pick = function (w) { var r = weighted(d, w) % 11; return r === 0 ? 0 : 11 - r; };
      var c = pick([3, 2, 7, 6, 5, 4, 3, 2]);
      if (c === 10) c = pick([7, 4, 3, 2, 5, 2, 7, 6]);
      return c !== 10 && c === d[8];
    },
    // Australia ABN (ABR): subtract 1 from the first digit, weighted sum divisible by 89.
    AU: function (n) {
      var d = digits(n); if (!d || d.length !== 11) return null;
      d[0] -= 1;
      return weighted(d, [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]) % 89 === 0;
    },
    // Chile RUT (SII): mod 11, check 0-9 or K.
    CL: function (n) {
      var m = /^(\d{7,8})([0-9K])$/.exec(n); if (!m) return null;
      var t = 0, w = 2;
      for (var i = m[1].length - 1; i >= 0; i--) { t += Number(m[1][i]) * w; w = w === 7 ? 2 : w + 1; }
      var r = 11 - (t % 11);
      return (r === 11 ? "0" : r === 10 ? "K" : String(r)) === m[2];
    },
    // Argentina CUIT (AFIP): mod 11.
    AR: function (n) { var d = digits(n); if (!d || d.length !== 11) return null; return mod11(d, [5, 4, 3, 2, 7, 6, 5, 4, 3, 2], m11); },
    // Italy partita IVA: Luhn.
    IT: function (n) { var m = /^(?:IT)?(\d{11})$/.exec(n); return m ? luhn(digits(m[1])) : null; },
    // Poland NIP: mod 11 (10 = invalid).
    PL: function (n) { var m = /^(?:PL)?(\d{10})$/.exec(n); return m ? mod11(digits(m[1]), [6, 5, 7, 2, 3, 4, 5, 6, 7], function (r) { return r === 10 ? null : r; }) : null; },
    // Portugal NIF: mod 11.
    PT: function (n) { var m = /^(?:PT)?(\d{9})$/.exec(n); return m ? mod11(digits(m[1]), [9, 8, 7, 6, 5, 4, 3, 2], function (r) { return r < 2 ? 0 : 11 - r; }) : null; },
    // Belgium enterprise number: 97 - (first 8 digits mod 97).
    BE: function (n) { var m = /^(?:BE)?([01]\d{9})$/.exec(n); if (!m) return null; return 97 - (Number(m[1].slice(0, 8)) % 97) === Number(m[1].slice(8)); },
    // Denmark CVR: weighted sum divisible by 11.
    DK: function (n) { var m = /^(?:DK)?(\d{8})$/.exec(n); return m ? weighted(digits(m[1]), [2, 7, 6, 5, 4, 3, 2, 1]) % 11 === 0 : null; },
    // Finland Y-tunnus: mod 11 (remainder 1 = invalid).
    FI: function (n) { var m = /^(?:FI)?(\d{8})$/.exec(n); return m ? mod11(digits(m[1]), [7, 9, 10, 5, 8, 4, 2], function (r) { return r === 0 ? 0 : r === 1 ? null : 11 - r; }) : null; },
    // Germany USt-IdNr: ISO 7064 MOD 11,10.
    DE: function (n) { var m = /^(?:DE)?(\d{9})$/.exec(n); return m ? mod1110(digits(m[1])) : null; },
    // Croatia OIB: ISO 7064 MOD 11,10.
    HR: function (n) { var m = /^(?:HR)?(\d{11})$/.exec(n); return m ? mod1110(digits(m[1])) : null; },
    // France TVA: numeric key = (12 + 3 × (SIREN mod 97)) mod 97; letter keys have no public formula.
    FR: function (n) { var m = /^(?:FR)?(\d{2})(\d{9})$/.exec(n); if (!m) return null; return (12 + 3 * (Number(m[2]) % 97)) % 97 === Number(m[1]); },
    // Estonia KMKR: weights 3 7 1.
    EE: function (n) { var m = /^(?:EE)?(\d{9})$/.exec(n); if (!m) return null; var d = digits(m[1]); return (10 - (weighted(d, [3, 7, 1, 3, 7, 1, 3, 7]) % 10)) % 10 === d[8]; },
    // Luxembourg: first 6 digits mod 89.
    LU: function (n) { var m = /^(?:LU)?(\d{8})$/.exec(n); if (!m) return null; return Number(m[1].slice(0, 6)) % 89 === Number(m[1].slice(6)); },
    // Slovenia: mod 11 (11 - r; 10 → 0; 11 = invalid).
    SI: function (n) { var m = /^(?:SI)?(\d{8})$/.exec(n); return m ? mod11(digits(m[1]), [8, 7, 6, 5, 4, 3, 2], function (r) { var k = 11 - r; return k === 11 ? null : k === 10 ? 0 : k; }) : null; },
    // Hungary: weights 9 7 3 1.
    HU: function (n) { var m = /^(?:HU)?(\d{8})$/.exec(n); if (!m) return null; var d = digits(m[1]); return (10 - (weighted(d, [9, 7, 3, 1, 9, 7, 3]) % 10)) % 10 === d[7]; },
    // Sweden: Luhn over the 10-digit organisation number, then "01".
    SE: function (n) { var m = /^(?:SE)?(\d{10})01$/.exec(n); return m ? luhn(digits(m[1])) : null; },
    // Greece: powers of two, mod 11 mod 10.
    GR: function (n) { var m = /^(?:EL|GR)?(\d{9})$/.exec(n); if (!m) return null; var d = digits(m[1]); return weighted(d, [256, 128, 64, 32, 16, 8, 4, 2]) % 11 % 10 === d[8]; },
    // Slovakia IČ DPH: the whole number is divisible by 11.
    SK: function (n) { var m = /^(?:SK)?(\d{10})$/.exec(n); return m ? Number(m[1]) % 11 === 0 : null; },
    // United Kingdom VAT (9 digits, or 12 with a branch): mod 97, or the 9755 scheme.
    GB: function (n) {
      var m = /^(?:GB|XI)?(\d{9})(\d{3})?$/.exec(n); if (!m) return null;
      var d = digits(m[1]); var t = weighted(d, [8, 7, 6, 5, 4, 3, 2]) + Number(m[1].slice(7));
      return t % 97 === 0 || (t + 55) % 97 === 0;
    },
    // China unified social credit code (GB 32100-2015): mod 31 over 17 characters.
    CN: function (n) {
      if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(n)) return null;
      var w = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28], t = 0;
      for (var i = 0; i < 17; i++) t += A31.indexOf(n[i]) * w[i];
      return A31[(31 - (t % 31)) % 31] === n[17];
    },
    // South Korea business registration number (National Tax Service).
    KR: function (n) {
      var d = digits(n); if (!d || d.length !== 10) return null;
      var t = weighted(d, [1, 3, 7, 1, 3, 7, 1, 3, 5]) + Math.floor((d[8] * 5) / 10);
      return (10 - (t % 10)) % 10 === d[9];
    },
    // Russia INN (10 digits for companies, 12 for individuals).
    RU: function (n) {
      var d = digits(n); if (!d) return null;
      var c = function (w) { return (weighted(d, w) % 11) % 10; };
      if (d.length === 10) return c([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
      if (d.length === 12) return c([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && c([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
      return null;
    },
    // Türkiye: T.C. kimlik no (11 digits, used by sole traders).
    TR: function (n) {
      var d = digits(n); if (!d) return null;
      // The 10-digit VKN algorithm couldn't be confirmed against a published number: not checked.
      if (d.length === 11) {
        if (d[0] === 0) return false;
        var c10 = ((d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7])) % 10;
        if (c10 < 0) c10 += 10;
        var s10 = 0; for (var j = 0; j < 10; j++) s10 += d[j];
        return c10 === d[9] && s10 % 10 === d[10];
      }
      return null;
    },
    // Israel company / dealer number: Luhn-style 1-2 weights.
    IL: function (n) {
      var d = digits(n); if (!d || d.length !== 9) return null;
      var t = 0; for (var i = 0; i < 9; i++) { var x = d[i] * (i % 2 === 0 ? 1 : 2); t += x > 9 ? x - 9 : x; }
      return t % 10 === 0;
    },
    // Peru RUC (SUNAT): mod 11.
    PE: function (n) { var d = digits(n); if (!d || d.length !== 11) return null; return mod11(d, [5, 4, 3, 2, 7, 6, 5, 4, 3, 2], function (r) { return (11 - r) % 10; }); },
    // Thailand 13-digit tax ID: mod 11.
    TH: function (n) { var d = digits(n); if (!d || d.length !== 13) return null; return (11 - (weighted(d, [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) % 11)) % 10 === d[12]; },
    // Japan corporate number (National Tax Agency): the first digit checks the other 12.
    JP: function (n) {
      var m = /^T?(\d{13})$/.exec(n); if (!m) return null;
      var d = digits(m[1]), t = 0;
      for (var i = 1; i <= 12; i++) t += d[13 - i] * (i % 2 === 1 ? 1 : 2);
      return 9 - (t % 9) === d[0];
    },
    // Taiwan unified business number (Ministry of Finance, divisible-by-5 rule since 2023).
    TW: function (n) {
      var d = digits(n); if (!d || d.length !== 8) return null;
      var w = [1, 2, 1, 2, 1, 2, 4, 1], t = 0;
      for (var i = 0; i < 8; i++) { var p = d[i] * w[i]; t += Math.floor(p / 10) + (p % 10); }
      return t % 5 === 0 || (d[6] === 7 && (t + 1) % 5 === 0);
    }
  };

  return function (country, n) {
    var f = rules[country];
    if (!f || !n) return null;
    try { return f(n); } catch (e) { return null; }
  };
})();
/* checksums:end */

export const taxChecksum = TAX_CHECKSUMS;
/** Countries with an offline check-digit algorithm. */
export const CHECKSUM_COUNTRIES = ["IN", "BR", "CH", "NO", "NZ", "AU", "CL", "AR", "IT", "PL", "PT", "BE", "DK", "FI", "DE", "HR", "FR", "EE", "LU", "SI", "HU", "SE", "GR", "SK", "GB", "CN", "KR", "RU", "TR", "IL", "PE", "TH", "JP", "TW"];
