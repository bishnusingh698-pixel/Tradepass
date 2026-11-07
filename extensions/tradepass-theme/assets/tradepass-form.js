/* Tradepass wholesale application form renderer. Loaded only by the "Wholesale application"
 * app block (and by the admin preview and the hosted "more info" page). No dependencies.
 *
 * window.TradepassForm.render(container, {
 *   definition,           // FormDefinition JSON (app/lib/form-defaults.ts)
 *   texts,                // flat { "form.field.email.label": "Email", ... } built-in + merchant overrides
 *   locale, dir,          // "fr", "ltr" | "rtl"
 *   preview,              // true: no network, no storage
 *   endpoint,             // app proxy base, default "/apps/tradepass"
 *   submitUrl, uploadUrl, // optional overrides (hosted update page)
 *   formId, country, prefill, languages, countries, countriesUrl, onSuccess
 * })
 * Everything typed stays in localStorage until the server confirms, every submission carries
 * an idempotency key, and sending retries automatically for up to 60 s (server asleep). */
(function () {
  "use strict";
  var RETRY_MS = 60000;
  var MAX_FILES = 3;
  var MAX_BYTES = 5 * 1024 * 1024;
  var TYPES = { "application/pdf": 1, "image/jpeg": 1, "image/png": 1 };
  var EXT = /\.(pdf|jpe?g|png)$/i;
  /** PDF, JPG or PNG. Some phones send PDFs with an empty or generic type: the name decides, the server checks the content. */
  function fileTypeOk(file) {
    return !!TYPES[file.type] || (EXT.test(file.name) && (!file.type || file.type === "application/octet-stream"));
  }
  // ISO 3166-1 alpha-2 codes; names come from Intl.DisplayNames in the visitor's language.
  var CODES = "AD AE AF AG AI AL AM AO AR AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IS IT JE JM JO JP KE KG KH KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MK ML MM MN MO MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PS PT PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VN VU WF WS XK YE YT ZA ZM ZW".split(" ");
  var EU = "AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK".split(" ");
  // ITU country calling codes for the phone field's country-code picker (E.164 numbers).
  var DIAL = {};
  "AD376 AE971 AF93 AG1 AI1 AL355 AM374 AO244 AR54 AT43 AU61 AW297 AX358 AZ994 BA387 BB1 BD880 BE32 BF226 BG359 BH973 BI257 BJ229 BL590 BM1 BN673 BO591 BQ599 BR55 BS1 BT975 BW267 BY375 BZ501 CA1 CC61 CD243 CF236 CG242 CH41 CI225 CK682 CL56 CM237 CN86 CO57 CR506 CV238 CW599 CX61 CY357 CZ420 DE49 DJ253 DK45 DM1 DO1 DZ213 EC593 EE372 EG20 EH212 ER291 ES34 ET251 FI358 FJ679 FK500 FO298 FR33 GA241 GB44 GD1 GE995 GF594 GG44 GH233 GI350 GL299 GM220 GN224 GP590 GQ240 GR30 GS500 GT502 GW245 GY592 HK852 HN504 HR385 HT509 HU36 ID62 IE353 IL972 IM44 IN91 IO246 IQ964 IS354 IT39 JE44 JM1 JO962 JP81 KE254 KG996 KH855 KI686 KM269 KN1 KR82 KW965 KY1 KZ7 LA856 LB961 LC1 LI423 LK94 LR231 LS266 LT370 LU352 LV371 LY218 MA212 MC377 MD373 ME382 MF590 MG261 MK389 ML223 MM95 MN976 MO853 MQ596 MR222 MS1 MT356 MU230 MV960 MW265 MX52 MY60 MZ258 NA264 NC687 NE227 NF672 NG234 NI505 NL31 NO47 NP977 NR674 NU683 NZ64 OM968 PA507 PE51 PF689 PG675 PH63 PK92 PL48 PM508 PN64 PS970 PT351 PY595 QA974 RE262 RO40 RS381 RU7 RW250 SA966 SB677 SC248 SD249 SE46 SG65 SH290 SI386 SJ47 SK421 SL232 SM378 SN221 SO252 SR597 SS211 ST239 SV503 SX1 SZ268 TC1 TD235 TF262 TG228 TH66 TJ992 TK690 TL670 TM993 TN216 TO676 TR90 TT1 TV688 TW886 TZ255 UA380 UG256 UM1 US1 UY598 UZ998 VA39 VC1 VE58 VG1 VN84 VU678 WF681 WS685 XK383 YE967 YT262 ZA27 ZM260 ZW263".split(" ").forEach(function (x) { DIAL[x.slice(0, 2)] = x.slice(2); });
  var US_FORMS = ["state", "sst", "mtc", "exempt"];
  var MAX_STATES = 12;
  /** "+14155550123" → true; US/Canada numbers (+1) need 10 digits after the code. */
  function e164Ok(v) {
    if (!/^\+[1-9]\d{6,14}$/.test(v)) return false;
    return v.indexOf("+1") !== 0 || v.length === 12;
  }
  var AUTO = {
    companyName: "organization", firstName: "given-name", lastName: "family-name", email: "email",
    phone: "tel", jobTitle: "organization-title", website: "url"
  };
  var INPUT = { text: "text", number: "number", email: "email", phone: "tel", url: "url", date: "date" };
  var MAXLEN = { textarea: 5000 };
  var uid = 0;

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "text") e.textContent = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else if (k === "className") e.className = v;
      else e.setAttribute(k, v === true ? "" : v);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function isEmpty(v) {
    if (v == null || v === "" || v === false) return true;
    if (Array.isArray(v)) return v.length === 0;
    return false;
  }
  function newKey() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // Copied from app/lib/tax-checksums.js by scripts/sync-tax-ids.mjs (do not edit here).
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
  /** Draft values without documents (upload references) or tax numbers (kept: tax country and state). */
  function sanitizeDraft(values, fieldsById) {
    var out = {};
    for (var k in values) {
      var f = fieldsById[k];
      var v = values[k];
      if (f && f.type === "file") continue;
      if (f && f.type === "country_tax") { if (v) out[k] = { country: v.country || "", region: v.region || "", number: "" }; continue; }
      out[k] = v;
    }
    return out;
  }
  /** "rgb(r, g, b)" / "rgba(r, g, b, a)" is an opaque, dark colour (relative luminance under 0.2); null when transparent or unknown. */
  function darkColor(css) {
    var m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(css || "");
    if (!m || (m[4] != null && Number(m[4]) < 0.5)) return null;
    var lin = function (c) { c = Number(c) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]) < 0.2;
  }
  /** The first non-transparent background behind the form is dark. */
  function isDarkBackground(el) {
    try {
      for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
        var d = darkColor(getComputedStyle(n).backgroundColor);
        if (d !== null) return d;
      }
    } catch (e) { /* no styles (tests, old browsers) */ }
    return false;
  }

  function render(container, opts) {
    opts = opts || {};
    var def = opts.definition;
    var texts = opts.texts || {};
    var locale = opts.locale || "en";
    var base = locale.split("-")[0];
    var preview = !!opts.preview;
    var endpoint = opts.endpoint || "/apps/tradepass";
    var submitUrl = opts.submitUrl || endpoint + "/submit";
    var uploadUrl = opts.uploadUrl || endpoint + "/upload";
    var countries = opts.countries || null;
    var storeKey = "tradepass-draft:" + (opts.formId || "default");
    var state = { values: {}, touched: {}, errors: {}, idem: null, startedAt: Date.now(), sending: false };
    var fieldsById = {};
    var nodes = {}; // field id -> { wrap, error, control, refresh }

    container.innerHTML = "";
    container.classList.add("tpf");
    if (isDarkBackground(container)) container.classList.add("tpf--dark");
    container.setAttribute("dir", opts.dir || "ltr");
    container.setAttribute("lang", locale);

    function tx(key, vars) {
      var s = texts[key];
      if (s == null) return "";
      return String(s).replace(/\{\{\s*(\w+)\s*\}\}/g, function (_, n) { return vars && vars[n] != null ? vars[n] : ""; });
    }
    function own(map) {
      if (!map) return null;
      return map[locale] || map[base] || null;
    }
    function ftext(f, prop) {
      var o = own(f.texts);
      if (o && o[prop]) return o[prop];
      if (f.custom) {
        for (var l in f.texts || {}) if (f.texts[l] && f.texts[l][prop]) return f.texts[l][prop];
        return "";
      }
      return tx("form.field." + f.id + "." + prop);
    }
    function optLabel(f, o) {
      var own_ = own(o.texts);
      if (own_) return own_;
      if (f.id === "businessType") return tx("form.business_type." + o.value) || o.value;
      if (f.id === "monthlyOrderValue") return tx("form.order_value." + o.value) || o.value;
      for (var l in o.texts || {}) return o.texts[l];
      return o.value;
    }
    var regionNames = null;
    try { regionNames = new Intl.DisplayNames([locale, "en"], { type: "region" }); } catch (e) { regionNames = null; }
    function countryName(code) {
      var n = null;
      try { n = regionNames && regionNames.of(code); } catch (e) { n = null; }
      return n || (countries && countries[code] && countries[code].n) || code;
    }
    var sortedCodes = CODES.slice().sort(function (a, b) { return countryName(a).localeCompare(countryName(b), locale); });

    // ---------- draft ----------
    function loadDraft() {
      if (preview) return null;
      try { return JSON.parse(localStorage.getItem(storeKey) || "null"); } catch (e) { return null; }
    }
    var saveTimer = null;
    // The draft never holds documents (their signed upload references) or tax numbers: a shared or
    // public computer must not keep them. After a restore the applicant adds those again.
    function draftValues() { return sanitizeDraft(state.values, fieldsById); }
    function saveDraft() {
      if (preview) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        try {
          localStorage.setItem(storeKey, JSON.stringify({ v: draftValues(), idem: state.idem, startedAt: state.startedAt, at: Date.now() }));
        } catch (e) { /* storage full or blocked: keep going */ }
      }, 300);
    }
    function clearDraft() {
      if (preview) return;
      try { localStorage.removeItem(storeKey); } catch (e) { /* ignore */ }
    }

    // ---------- visibility & validation ----------
    function visible(f) {
      if (f.state === "hidden") return false;
      if (!f.showIf) return true;
      var other = fieldsById[f.showIf.field];
      if (other && !visible(other)) return false;
      var v = state.values[f.showIf.field];
      return Array.isArray(v) ? v.indexOf(f.showIf.equals) >= 0 : v === f.showIf.equals;
    }
    function label(f) { return ftext(f, "label") || f.id; }

    function validate(f) {
      var v = state.values[f.id];
      var req = f.state === "required";
      var name = label(f);
      if (f.type === "address") {
        if (f.id === "shippingAddress" && v && v.same) return null;
        var a = v || {};
        var errs = {};
        var c = countries && countries[a.countryCode];
        if (req || a.address1 || a.city) {
          if (!a.countryCode) errs.countryCode = tx("form.error.choose", { field: tx("form.address.country") });
          if (!a.address1) errs.address1 = tx("form.error.required", { field: tx("form.address.address1") });
          if (!a.city) errs.city = tx("form.error.required", { field: tx("form.address.city") });
          if (c && c.r && !a.zoneCode) errs.zoneCode = tx("form.error.choose", { field: zoneLabel(c) });
          if (c && c.z !== 0 && !a.zip) errs.zip = tx("form.error.required", { field: zipLabel(c) });
          else if (a.countryCode === "US" && a.zip && !/^\d{5}(-\d{4})?$/.test(a.zip.trim())) errs.zip = tx("form.error.zip");
        }
        if (f.id === "billingAddress" && countryBlocked(a.countryCode)) errs.countryCode = tx("form.error.country_blocked");
        return Object.keys(errs).length ? errs : null;
      }
      if (f.type === "country_tax") {
        var tv = v || {};
        if (tv.states) {
          var rows = tv.states.filter(function (r) { return r.region || r.number; });
          if (req && !rows.length) return tx("form.error.required", { field: taxLabel("US") });
          for (var ri = 0; ri < rows.length; ri++) {
            if (!rows[ri].region) return tx("form.error.us_state");
            if (!rows[ri].number) return tx("form.error.required", { field: tx("form.tax.us_permit") });
          }
          return null;
        }
        if (req && !tv.number) return tx("form.error.required", { field: taxLabel(tv.country) });
        if (tv.number && tv.number.length > 40) return tx("form.error.too_long", { max: 40 });
        var bill0 = state.values.billingAddress;
        var tc = tv.country || (bill0 && bill0.countryCode) || opts.country || "";
        if (tv.number && taxFormatBad(tc, tv.number)) return tx("form.error.tax_format", { name: taxLabel(tc) });
        return null;
      }
      if (f.type === "file") {
        var files = v || [];
        if (req && !files.length) return tx("form.error.required", { field: name });
        if (files.some(function (x) { return x.status === "uploading"; })) return tx("form.error.file_pending");
        return null;
      }
      if (f.type === "consent") return req && !v ? tx("form.error.consent") : null;
      if (isEmpty(v)) {
        if (!req) return null;
        return tx(f.type === "select" || f.type === "checkboxes" ? "form.error.choose" : "form.error.required", { field: name });
      }
      if (typeof v === "string") {
        var max = MAXLEN[f.type] || 255;
        if (v.length > max) return tx("form.error.too_long", { max: max });
        if (f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return tx("form.error.email");
        if (f.type === "url" && !/^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i.test(v)) return tx("form.error.url");
        if (f.type === "phone" && !(v.charAt(0) === "+" ? e164Ok(v) : /^\+?[\d\s().-]{6,20}$/.test(v))) return tx("form.error.phone");
        if (f.id === "ein" && !/^\d{2}-?\d{7}$/.test(v.trim())) return tx("form.error.ein");
        if (f.id === "duns" && !/^\d{9}$/.test(v.replace(/[\s-]/g, ""))) return tx("form.error.duns");
        if (f.type === "number" && !/^-?\d+([.,]\d+)?$/.test(v)) return tx("form.error.number");
        if (f.type === "date" && isNaN(Date.parse(v))) return tx("form.error.date");
      }
      return null;
    }

    function showError(f, err) {
      var n = nodes[f.id];
      if (!n) return;
      state.errors[f.id] = err;
      n.paint(err);
    }

    // ---------- labels ----------
    function zoneLabel(c) { return tx("form.address.zone." + (c && c.k || "region")); }
    function zipLabel(c) { return tx("form.address.zip." + (c && c.z || "postal")); }
    function taxKind(country) {
      if (!country) return "tax_id";
      if (EU.indexOf(country) >= 0 || country === "GB" || country === "XI") return "vat";
      if (country === "AU") return "abn";
      if (country === "CA") return "gst";
      if (country === "US") return "us_resale";
      return "tax_id";
    }
    // Country tax-ID rule from the country data: [name, example, pattern, prefix, strict].
    function taxRule(country) { var c = countries && countries[country]; return c && c.t ? c.t : null; }
    function taxLabel(country) {
      var base = tx("form.tax." + taxKind(country));
      var r = taxRule(country);
      return r && r[0] && base.indexOf(r[0]) < 0 ? base + " (" + r[0] + ")" : base;
    }
    /** True when a strict rule says the number can't be right (same check as the server). */
    function taxFormatBad(country, number) {
      var r = taxRule(country);
      if (!r || !r[2] || !r[4] || !number) return false;
      var n = String(number).replace(/[\s.\-/]/g, "").toUpperCase();
      if (r[3] && n.indexOf(r[3]) !== 0 && !/^[A-Z]{2}/.test(n)) n = r[3] + n;
      try { return !new RegExp(r[2]).test(n) || TAX_CHECKSUMS(country, n) === false; } catch (e) { return false; }
    }
    // Countries the merchant accepts applications from (Settings → Countries).
    var countryRule = opts.countryRule || null;
    function countryBlocked(code) {
      if (!code || !countryRule || !countryRule.list) return false;
      var listed = countryRule.list.indexOf(code) >= 0;
      return countryRule.mode === "allow" ? !listed : countryRule.mode === "block" ? listed : false;
    }

    // ---------- controls ----------
    function fieldShell(f, control, opt) {
      var id = "tpf-" + (++uid);
      var help = ftext(f, "help");
      var errId = id + "-err";
      var helpId = help ? id + "-help" : null;
      var lab = label(f);
      var req = f.state === "required";
      var labelEl = h(opt && opt.legend ? "legend" : "label", { className: "tpf-label", "for": opt && opt.legend ? null : id }, [
        lab, req ? h("span", { className: "tpf-req", "aria-hidden": opt && opt.legend ? null : "true", text: " *" }) : h("span", { className: "tpf-opt", text: " " + tx("form.optional") })
      ]);
      var err = h("p", { className: "tpf-error", id: errId, hidden: true });
      var wrap = h(opt && opt.legend ? "fieldset" : "div", { className: "tpf-field tpf-field--" + f.type, "data-field": f.id }, [
        labelEl, helpId ? h("p", { className: "tpf-help", id: helpId, text: help }) : null
      ]);
      var described = [helpId, errId].filter(Boolean).join(" ");
      // Groups: the fieldset carries the help and error text for its legend.
      if (opt && opt.legend) wrap.setAttribute("aria-describedby", described);
      var built = control(id, described);
      wrap.appendChild(built.el);
      wrap.appendChild(err);
      nodes[f.id] = {
        wrap: wrap,
        focus: built.focus,
        paint: function (e) {
          var msg = typeof e === "object" && e ? null : e;
          err.hidden = !msg;
          err.textContent = msg || "";
          if (built.paint) built.paint(e);
          else if (built.input) {
            if (e) built.input.setAttribute("aria-invalid", "true");
            else built.input.removeAttribute("aria-invalid");
          }
        }
      };
      return wrap;
    }

    var taxRebuild = null;
    var lastBillCountry = null;
    function onChange(f, v, fromBlur) {
      state.values[f.id] = v;
      saveDraft();
      // The tax field follows the billing country until the applicant picks one.
      if (f.id === "billingAddress" && taxRebuild && v && v.countryCode !== lastBillCountry) {
        lastBillCountry = v.countryCode;
        var tv = state.values.taxNumber;
        if (!tv || !tv.country) taxRebuild();
      }
      refreshConditions();
      if (state.touched[f.id] || fromBlur) {
        state.touched[f.id] = true;
        showError(f, validate(f));
      }
    }
    function blur(f) {
      return function () {
        state.touched[f.id] = true;
        showError(f, validate(f));
      };
    }

    function simpleControl(f) {
      return function (id, describedBy) {
        var v = state.values[f.id];
        var input;
        if (f.type === "textarea") {
          input = h("textarea", { id: id, name: f.id, rows: 4, maxlength: 5000 });
          input.value = v || "";
        } else if (f.type === "select") {
          var opts_ = f.options || [];
          if (f.id === "preferredLanguage" && !opts_.length) opts_ = (opts.languages || [{ code: locale, name: locale }]).map(function (l) { return { value: l.code, texts: { x: l.name } }; });
          input = h("select", { id: id, name: f.id }, [h("option", { value: "", text: tx("form.select") })].concat(
            opts_.map(function (o) { return h("option", { value: o.value, text: optLabel(f, o) }); })
          ));
          input.value = v || "";
        } else if (f.type === "phone") {
          return phoneControl(f, id, describedBy);
        } else {
          input = h("input", {
            id: id, name: f.id, type: INPUT[f.type] || "text",
            autocomplete: AUTO[f.id] || null, maxlength: 255,
            inputmode: f.type === "number" ? "numeric" : null,
            placeholder: ftext(f, "placeholder") || null,
            spellcheck: f.type === "email" || f.type === "url" ? "false" : null
          });
          input.value = v || "";
        }
        if (f.state === "required") input.setAttribute("aria-required", "true");
        input.setAttribute("aria-describedby", describedBy);
        input.addEventListener(f.type === "select" ? "change" : "input", function () { onChange(f, input.value.trim() ? input.value : ""); });
        input.addEventListener("blur", blur(f));
        return { el: input, input: input, focus: function () { input.focus(); } };
      };
    }

    /** Country code + national number → E.164 ("+" code digits). Starts from the billing or store country. */
    function phoneControl(f, id, describedBy) {
      var box = h("div", { className: "tpf-phone" });
      var cur = state.values[f.id] || "";
      var bill = state.values.billingAddress;
      var cc = (bill && bill.countryCode) || opts.country || "";
      var national = cur;
      if (cur.charAt(0) === "+") {
        // Longest calling code that fits; keep the chosen country when its code matches.
        var best = "";
        for (var k in DIAL) if (cur.indexOf("+" + DIAL[k]) === 0 && DIAL[k].length > (DIAL[best] || "").length) best = k;
        if (best && !(DIAL[cc] && cur.indexOf("+" + DIAL[cc]) === 0)) cc = best;
        national = DIAL[cc] ? cur.slice(DIAL[cc].length + 1) : cur;
      }
      var sel = h("select", { id: id + "-cc", "aria-label": tx("form.phone.country"), autocomplete: "tel-country-code" }, sortedCodes.filter(function (c) { return DIAL[c]; }).map(function (c) {
        return h("option", { value: c, text: countryName(c) + " (+" + DIAL[c] + ")" });
      }));
      sel.value = DIAL[cc] ? cc : "US";
      var input = h("input", { id: id, name: f.id, type: "tel", inputmode: "tel", autocomplete: "tel-national", maxlength: 20, "aria-describedby": describedBy });
      input.value = national;
      if (f.state === "required") input.setAttribute("aria-required", "true");
      function update(fromBlur) {
        var digits = input.value.replace(/\D/g, "").replace(/^0+/, "");
        onChange(f, digits ? "+" + DIAL[sel.value] + digits : "", fromBlur);
      }
      sel.addEventListener("change", function () { update(true); });
      input.addEventListener("input", function () { update(false); });
      input.addEventListener("blur", blur(f));
      box.appendChild(sel);
      box.appendChild(input);
      return { el: box, input: input, focus: function () { input.focus(); } };
    }

    function checkboxesControl(f) {
      return function (id) {
        var box = h("div", { className: "tpf-choices" });
        var first = null;
        var boxes = [];
        (f.options || []).forEach(function (o, i) {
          var cid = id + "-" + i;
          var cb = h("input", { type: "checkbox", id: cid, value: o.value });
          cb.checked = (state.values[f.id] || []).indexOf(o.value) >= 0;
          cb.addEventListener("change", function () {
            var cur = (state.values[f.id] || []).filter(function (x) { return x !== o.value; });
            if (cb.checked) cur.push(o.value);
            onChange(f, cur, true);
          });
          if (!first) first = cb;
          boxes.push(cb);
          box.appendChild(h("div", { className: "tpf-check" }, [cb, h("label", { "for": cid, text: optLabel(f, o) })]));
        });
        return { el: box, focus: function () { if (first) first.focus(); }, paint: function (e) {
          boxes.forEach(function (cb) { if (e) cb.setAttribute("aria-invalid", "true"); else cb.removeAttribute("aria-invalid"); });
        } };
      };
    }

    function consentField(f) {
      var id = "tpf-" + (++uid);
      var errId = id + "-err";
      var cb = h("input", { type: "checkbox", id: id, name: f.id, "aria-describedby": errId, "aria-required": f.state === "required" ? "true" : null });
      cb.checked = !!state.values[f.id];
      cb.addEventListener("change", function () { onChange(f, cb.checked, true); });
      var text = own(def.consent && def.consent.texts) || ftext(f, "label");
      var privacy = def.consent && def.consent.privacyUrl;
      var err = h("p", { className: "tpf-error", id: errId, hidden: true });
      var wrap = h("div", { className: "tpf-field tpf-field--consent", "data-field": f.id }, [
        h("div", { className: "tpf-check" }, [cb, h("label", { "for": id }, [text, f.state === "required" ? h("span", { className: "tpf-req", "aria-hidden": "true", text: " *" }) : null])]),
        privacy ? h("p", { className: "tpf-help" }, [h("a", { href: privacy, target: "_blank", rel: "noopener", text: tx("form.consent_privacy") })]) : null,
        err
      ]);
      nodes[f.id] = {
        wrap: wrap,
        focus: function () { cb.focus(); },
        paint: function (e) {
          err.hidden = !e;
          err.textContent = e || "";
          if (e) cb.setAttribute("aria-invalid", "true"); else cb.removeAttribute("aria-invalid");
        }
      };
      return wrap;
    }

    function countrySelect(id, value, auto, onPick) {
      var s = h("select", { id: id, autocomplete: auto || null }, [h("option", { value: "", text: tx("form.select") })].concat(
        sortedCodes.map(function (c) { return h("option", { value: c, text: countryName(c) }); })
      ));
      s.value = value || "";
      s.addEventListener("change", function () { onPick(s.value); });
      return s;
    }

    function sub(id, text, control, req) {
      var e = h("p", { className: "tpf-error", id: id + "-err", hidden: true });
      control.setAttribute("aria-describedby", id + "-err");
      if (req) control.setAttribute("aria-required", "true");
      var w = h("div", { className: "tpf-sub" }, [h("label", { "for": id, className: "tpf-sublabel", text: text }), control, e]);
      return { el: w, paint: function (msg) {
        e.hidden = !msg; e.textContent = msg || "";
        if (msg) control.setAttribute("aria-invalid", "true"); else control.removeAttribute("aria-invalid");
      } };
    }

    function addressControl(f) {
      var section = f.id === "shippingAddress" ? "shipping" : "billing";
      return function (id) {
        var box = h("div", { className: "tpf-address" });
        var parts = {};
        var a = state.values[f.id] || (state.values[f.id] = { countryCode: opts.country || "" });
        if (f.id === "shippingAddress" && a.same == null) a.same = true;
        function set(k, val) {
          a[k] = val;
          onChange(f, a);
        }
        var inner = h("div", { className: "tpf-address__fields" });
        if (f.id === "shippingAddress") {
          var sid = id + "-same";
          var same = h("input", { type: "checkbox", id: sid });
          same.checked = !!a.same;
          same.addEventListener("change", function () { a.same = same.checked; inner.hidden = a.same; onChange(f, a, true); });
          box.appendChild(h("div", { className: "tpf-check" }, [same, h("label", { "for": sid, text: tx("form.address.same_as_billing") })]));
          inner.hidden = !!a.same;
        }
        function input(k, auto) {
          var i = h("input", { id: id + "-" + k, type: "text", autocomplete: section + " " + auto, maxlength: 255 });
          i.value = a[k] || "";
          i.addEventListener("input", function () { set(k, i.value); });
          i.addEventListener("blur", blur(f));
          return i;
        }
        function build() {
          inner.innerHTML = "";
          var c = countries && countries[a.countryCode];
          var cs = countrySelect(id + "-country", a.countryCode, section + " country", function (v) {
            a.countryCode = v; a.zoneCode = ""; onChange(f, a); build(); var n = document.getElementById(id + "-country"); if (n) n.focus();
          });
          var rq = f.state === "required";
          parts.countryCode = sub(id + "-country", tx("form.address.country"), cs, rq);
          parts.address1 = sub(id + "-address1", tx("form.address.address1"), input("address1", "address-line1"), rq);
          parts.address2 = sub(id + "-address2", tx("form.address.address2") + " " + tx("form.optional"), input("address2", "address-line2"));
          parts.city = sub(id + "-city", tx("form.address.city"), input("city", "address-level2"), rq);
          [parts.countryCode, parts.address1, parts.address2, parts.city].forEach(function (p) { inner.appendChild(p.el); });
          delete parts.zoneCode; delete parts.zip;
          if (c && c.r) {
            var zs = h("select", { id: id + "-zone", autocomplete: section + " address-level1" }, [h("option", { value: "", text: tx("form.select") })].concat(
              c.r.map(function (z) { return h("option", { value: z[0], text: z[1] }); })
            ));
            zs.value = a.zoneCode || "";
            zs.addEventListener("change", function () { set("zoneCode", zs.value); });
            parts.zoneCode = sub(id + "-zone", zoneLabel(c), zs, rq);
            inner.appendChild(parts.zoneCode.el);
          }
          if (!c || c.z !== 0) {
            parts.zip = sub(id + "-zip", zipLabel(c), input("zip", "postal-code"), rq && !!c);
            inner.appendChild(parts.zip.el);
          }
          if (state.errors[f.id]) paint(state.errors[f.id]);
        }
        function paint(e) {
          for (var k in parts) parts[k].paint(e && typeof e === "object" ? e[k] : null);
        }
        box.appendChild(inner);
        build();
        addressRebuilders.push(build);
        return { el: box, paint: paint, focus: function () {
          var e = state.errors[f.id] || {};
          var k = ["countryCode", "address1", "city", "zoneCode", "zip"].filter(function (x) { return e[x]; })[0] || "country";
          var map = { countryCode: "-country", address1: "-address1", city: "-city", zoneCode: "-zone", zip: "-zip", country: "-country" };
          var n = document.getElementById(id + map[k]);
          if (n) n.focus();
        } };
      };
    }
    var addressRebuilders = [];

    function taxControl(f) {
      return function (id, describedBy) {
        var box = h("div", { className: "tpf-tax" });
        var v = state.values[f.id] || (state.values[f.id] = { country: "", number: "", region: "" });
        var numberInput;
        function build() {
          box.innerHTML = "";
          var bill = state.values.billingAddress;
          var country = v.country || (bill && bill.countryCode) || opts.country || "";
          var cs = countrySelect(id + "-country", country, null, function (c) { v.country = c; if (c !== "US") { delete v.states; delete v.form; } onChange(f, v); build(); var n = document.getElementById(id + "-country"); if (n) n.focus(); });
          if (taxKind(country) !== "us_resale" && v.states) { delete v.states; delete v.form; }
          box.appendChild(sub(id + "-country", tx("form.tax.country"), cs).el);
          var kind = taxKind(country);
          var rule = taxRule(country);
          numberInput = h("input", { id: id, type: "text", maxlength: 40, autocomplete: "off", spellcheck: "false", placeholder: rule && rule[1] ? rule[1] : null, "aria-describedby": describedBy, "aria-required": f.state === "required" ? "true" : null });
          numberInput.value = v.number || "";
          numberInput.addEventListener("input", function () { v.number = numberInput.value.trim(); if (!v.country) v.country = country; onChange(f, v); });
          numberInput.addEventListener("blur", blur(f));
          box.appendChild(h("div", { className: "tpf-sub" }, [
            h("label", { "for": id, className: "tpf-sublabel", text: tx("form.tax." + kind) }),
            rule && rule[1] ? h("p", { className: "tpf-help", text: tx("form.tax.example", { example: rule[1] }) })
              : kind === "vat" ? h("p", { className: "tpf-help", text: tx("form.tax.vat_help") }) : null,
            numberInput
          ]));
          if (kind === "us_resale") { usRows(); return; }
        }
        /** US: which certificate, then one seller's permit / sales tax ID per state it covers. */
        function usRows() {
          box.lastChild && box.removeChild(box.lastChild); // the single-number input built above
          var us = countries && countries.US;
          v.form = US_FORMS.indexOf(v.form) >= 0 ? v.form : "state";
          if (!v.states || !v.states.length) v.states = [{ region: v.region || (state.values.billingAddress || {}).zoneCode || "", number: v.number || "" }];
          var fs = h("select", { id: id + "-form" }, US_FORMS.map(function (x) { return h("option", { value: x, text: tx("form.tax.us_form_" + x) }); }));
          fs.value = v.form;
          fs.addEventListener("change", function () { v.form = fs.value; onChange(f, v, true); });
          box.appendChild(sub(id + "-form", tx("form.tax.us_form"), fs).el);
          var list = h("div", { className: "tpf-states" });
          function sync() {
            var first = v.states[0] || {};
            v.region = first.region || ""; v.number = first.number || "";
            onChange(f, v);
          }
          function draw() {
            list.innerHTML = "";
            v.states.forEach(function (row, i) {
              var rid = id + "-s" + i;
              var rs = h("select", { id: rid + "-state" }, [h("option", { value: "", text: tx("form.select") })].concat(
                (us && us.r || []).map(function (z) { return h("option", { value: z[0], text: z[1] }); })
              ));
              rs.value = row.region || "";
              rs.addEventListener("change", function () { row.region = rs.value; sync(); });
              var ni = h("input", { id: i === 0 ? id : rid, type: "text", maxlength: 40, autocomplete: "off", spellcheck: "false", "aria-describedby": i === 0 ? describedBy : null });
              ni.value = row.number || "";
              ni.addEventListener("input", function () { row.number = ni.value.trim(); sync(); });
              ni.addEventListener("blur", blur(f));
              if (i === 0) numberInput = ni;
              var name = rs.value ? rs.options[rs.selectedIndex].text : String(i + 1);
              list.appendChild(h("div", { className: "tpf-staterow" }, [
                sub(rid + "-state", tx("form.tax.us_state"), rs).el,
                sub(i === 0 ? id : rid, tx("form.tax.us_permit"), ni).el,
                v.states.length > 1 ? h("button", { type: "button", className: "tpf-link", text: tx("form.tax.us_remove_state", { name: name }), onclick: function () {
                  v.states.splice(i, 1); sync(); draw(); var n = document.getElementById(id); if (n) n.focus();
                } }) : null
              ]));
            });
            if (v.states.length < MAX_STATES) list.appendChild(h("button", { type: "button", className: "tpf-link", text: tx("form.tax.us_add_state"), onclick: function () {
              v.states.push({ region: "", number: "" }); sync(); draw();
              var n = document.getElementById(id + "-s" + (v.states.length - 1) + "-state"); if (n) n.focus();
            } }));
          }
          draw();
          box.appendChild(list);
        }
        build();
        addressRebuilders.push(build);
        taxRebuild = build;
        return { el: box, input: { setAttribute: function (k, x) { numberInput.setAttribute(k, x); }, removeAttribute: function (k) { numberInput.removeAttribute(k); } }, focus: function () { numberInput.focus(); } };
      };
    }

    function fileControl(f) {
      return function (id, describedBy) {
        var box = h("div", { className: "tpf-files" });
        var list = h("ul", { className: "tpf-filelist" });
        var input = h("input", { id: id, type: "file", multiple: true, accept: ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png", "aria-describedby": describedBy + " " + id + "-hint", className: "tpf-fileinput" });
        var hint = h("p", { className: "tpf-help", id: id + "-hint", text: tx("form.upload.hint") });
        var live = h("p", { className: "tpf-sr", "aria-live": "polite" });
        var files = state.values[f.id] = (state.values[f.id] || []).filter(function (x) { return x.status === "done"; });
        function draw() {
          list.innerHTML = "";
          files.forEach(function (x, i) {
            var row = h("li", { className: "tpf-file" }, [
              h("span", { className: "tpf-file__name", text: x.name }),
              h("span", { className: "tpf-file__status", text: x.status === "uploading" ? tx("form.upload.uploading", { name: "" }) : x.status === "failed" ? tx("form.upload.failed", { name: "" }) : "" }),
              h("button", { type: "button", className: "tpf-link", text: tx("form.upload.remove", { name: x.name }), onclick: function () {
                files.splice(i, 1); onChange(f, files, true); draw(); input.focus();
              } })
            ]);
            if (f.id === "certificates" && x.status === "done") {
              var did = id + "-exp-" + i;
              var d = h("input", { type: "date", id: did });
              d.value = x.expiresOn || "";
              d.addEventListener("change", function () { x.expiresOn = d.value; onChange(f, files); });
              row.appendChild(h("div", { className: "tpf-sub" }, [h("label", { "for": did, className: "tpf-sublabel", text: tx("form.upload.expiry", { name: x.name }) }), d]));
            }
            list.appendChild(row);
          });
          input.disabled = files.length >= MAX_FILES;
          if (typeof cam !== "undefined") cam.disabled = input.disabled;
        }
        input.addEventListener("change", function () {
          var picked = Array.prototype.slice.call(input.files || []);
          input.value = "";
          pick(picked);
        });
        function pick(picked) {
          var err = null;
          picked.forEach(function (file) {
            if (files.length >= MAX_FILES) { err = tx("form.error.file_count"); return; }
            if (!fileTypeOk(file)) { err = tx("form.error.file_type", { name: file.name }); return; }
            if (file.size > MAX_BYTES) { err = tx("form.error.file_size", { name: file.name }); return; }
            var item = { name: file.name, status: "uploading", ref: null, expiresOn: "" };
            files.push(item);
            live.textContent = tx("form.upload.uploading", { name: file.name });
            upload(file, f.id).then(function (ref) {
              item.ref = ref; item.status = "done";
              live.textContent = tx("form.upload.done", { name: file.name });
            }, function () {
              item.status = "failed";
              files.splice(files.indexOf(item), 1);
              live.textContent = tx("form.upload.failed", { name: file.name });
              showError(f, tx("form.upload.failed", { name: file.name }));
            }).then(function () { onChange(f, files); draw(); });
          });
          state.touched[f.id] = true;
          showError(f, err || validate(f));
          onChange(f, files);
          draw();
        }
        // Phones: a second button opens the camera straight away (photo of a paper certificate).
        var cam = h("input", { id: id + "-cam", type: "file", accept: "image/*", capture: "environment", "aria-describedby": id + "-hint", className: "tpf-fileinput" });
        cam.addEventListener("change", function () { pick(Array.prototype.slice.call(cam.files || [])); cam.value = ""; });
        box.appendChild(hint);
        box.appendChild(list);
        box.appendChild(h("div", { className: "tpf-filebtns" }, [
          input, h("label", { "for": id, className: "tpf-filebtn", text: tx("form.upload.add") }),
          cam, h("label", { "for": id + "-cam", className: "tpf-filebtn tpf-filebtn--camera", text: tx("form.upload.camera") })
        ]));
        box.appendChild(live);
        draw();
        return { el: box, input: input, focus: function () { input.focus(); } };
      };
    }

    // ---------- network ----------
    function withRetry(make, onSlow) {
      var start = Date.now();
      var attempt = 0;
      function go() {
        attempt++;
        return make().then(function (res) {
          if (res.status >= 500 || res.status === 408) throw { retry: true };
          return res;
        }).catch(function (e) {
          if (e && e.retry === false) throw e;
          if (Date.now() - start > RETRY_MS) throw { retry: false, offline: true };
          if (attempt === 1 && onSlow) onSlow();
          return sleep(Math.min(2000 * attempt, 8000)).then(go);
        });
      }
      return go();
    }

    function upload(file, field) {
      if (preview) return sleep(300).then(function () { return "preview"; });
      return withRetry(function () {
        var fd = new FormData();
        fd.append("file", file, file.name);
        fd.append("field", field);
        return fetch(uploadUrl, { method: "POST", body: fd, credentials: "same-origin" });
      }).then(function (res) {
        return res.json().then(function (j) {
          if (!res.ok || !j.ref) throw { retry: false, error: j && j.error };
          return j.ref;
        });
      });
    }

    // ---------- layout ----------
    var form = h("form", { className: "tpf-form", novalidate: true });
    var status = h("div", { className: "tpf-status", role: "status", "aria-live": "polite" });
    var summary = h("div", { className: "tpf-summary", role: "alert", tabindex: "-1", hidden: true });
    var draftNote = h("div", { className: "tpf-note", hidden: true });

    if (!def || !def.sections) {
      container.appendChild(h("p", { className: "tpf-note", text: tx("form.unavailable") }));
      return { destroy: function () { container.innerHTML = ""; } };
    }

    def.sections.forEach(function (s) { s.fields.forEach(function (f) { fieldsById[f.id] = f; }); });
    var draft = loadDraft();
    if (draft && draft.v) {
      state.values = draft.v;
      state.values = draftValues(); // drafts saved by older versions could still hold files or a tax number
      state.idem = draft.idem || null;
      state.startedAt = draft.startedAt || state.startedAt;
      draftNote.hidden = false;
      draftNote.appendChild(h("span", { text: tx("form.draft_restored") + " " + tx("form.draft_private") + " " }));
      draftNote.appendChild(h("button", { type: "button", className: "tpf-link", text: tx("form.clear_draft"), onclick: function () {
        clearDraft();
        render(container, opts);
        var first = container.querySelector("input:not([tabindex='-1']):not([type=file]),select,textarea");
        if (first) first.focus();
      } }));
    }
    var pre = opts.prefill || {};
    ["firstName", "lastName", "email"].forEach(function (k) { if (pre[k] && !state.values[k]) state.values[k] = pre[k]; });
    if (!state.values.preferredLanguage) state.values.preferredLanguage = locale;


    form.appendChild(summary);
    form.appendChild(draftNote);
    form.appendChild(h("p", { className: "tpf-help", text: tx("form.required_note") }));

    def.sections.forEach(function (s) {
      var shown = s.fields.filter(function (f) { return f.state !== "hidden"; });
      if (!shown.length) return;
      var title = (own(s.texts) || {}).title || tx("form.section." + s.id);
      var sec = h("fieldset", { className: "tpf-section" }, [title ? h("legend", { className: "tpf-section__title", text: title }) : null]);
      shown.forEach(function (f) {
        var el;
        if (f.type === "consent") el = consentField(f);
        else if (f.type === "address") el = fieldShell(f, addressControl(f), { legend: true });
        else if (f.type === "country_tax") el = fieldShell(f, taxControl(f), { legend: true });
        else if (f.type === "file") el = fieldShell(f, fileControl(f));
        else if (f.type === "checkboxes") el = fieldShell(f, checkboxesControl(f), { legend: true });
        else el = fieldShell(f, simpleControl(f));
        sec.appendChild(el);
      });
      form.appendChild(sec);
    });

    var sq = def.spamQuestion && def.spamQuestion.enabled ? own(def.spamQuestion.texts) : null;
    var spamInput = null;
    if (sq && sq.question) {
      spamInput = h("input", { id: "tpf-spam-" + (++uid), type: "text", autocomplete: "off", "aria-required": "true" });
      form.appendChild(h("div", { className: "tpf-field" }, [h("label", { "for": spamInput.id, className: "tpf-label", text: sq.question }), spamInput]));
    }
    // Honeypot: invisible to people and assistive tech, bots fill it in.
    var hp = h("input", { type: "text", name: "company_website", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" });
    form.appendChild(h("div", { className: "tpf-hp", "aria-hidden": "true" }, [h("label", { text: tx("form.honeypot") }, [hp])]));

    var submitBtn = h("button", { type: "submit", className: "tpf-submit button", text: tx("form.submit") });
    form.appendChild(submitBtn);
    form.appendChild(status);
    container.appendChild(form);

    function refreshConditions() {
      for (var id in nodes) {
        var f = fieldsById[id];
        if (f) nodes[id].wrap.hidden = !visible(f);
      }
    }
    refreshConditions();

    if (!countries && opts.countriesUrl && !preview) {
      fetch(opts.countriesUrl).then(function (r) { return r.json(); }).then(function (d) {
        countries = d;
        addressRebuilders.forEach(function (b) { b(); });
      }).catch(function () { /* keep free-text fallback */ });
    }

    // ---------- submit ----------
    function collect() {
      var out = {};
      def.sections.forEach(function (s) {
        s.fields.forEach(function (f) {
          if (!visible(f)) return;
          var v = state.values[f.id];
          if (f.type === "file") v = (v || []).filter(function (x) { return x.status === "done"; }).map(function (x) { return { ref: x.ref, name: x.name, expiresOn: x.expiresOn || null }; });
          if (f.type === "country_tax" && v && !v.country) {
            var bill = state.values.billingAddress;
            v.country = (bill && bill.countryCode) || opts.country || "";
          }
          if (!isEmpty(v)) out[f.id] = v;
        });
      });
      return out;
    }

    function showSummary(errs) {
      summary.innerHTML = "";
      if (!errs.length) { summary.hidden = true; return; }
      var sid = "tpf-sum-" + (++uid);
      summary.setAttribute("aria-labelledby", sid);
      summary.appendChild(h("p", { className: "tpf-summary__title", id: sid, text: tx("form.error.summary") }));
      var ul = h("ul");
      errs.forEach(function (e) {
        ul.appendChild(h("li", {}, [h("a", { href: "#", text: e.text, onclick: function (ev) { ev.preventDefault(); nodes[e.id].focus(); } })]));
      });
      summary.appendChild(ul);
      summary.hidden = false;
    }

    function setSending(on, msg) {
      state.sending = on;
      submitBtn.disabled = on;
      submitBtn.setAttribute("aria-busy", on ? "true" : "false");
      submitBtn.textContent = on ? tx("form.sending") : tx("form.submit");
      status.textContent = msg || "";
    }

    function success(dup) {
      clearDraft();
      if (opts.onSuccess) opts.onSuccess({ duplicate: dup });
      var redirect = def.success && def.success.redirectUrl;
      if (redirect && !preview && !dup && /^(https?:\/\/|\/)/.test(redirect)) { location.assign(redirect); return; }
      var msgText = own(def.success && def.success.texts) || tx("form.success.body");
      var box = h("div", { className: "tpf-success", tabindex: "-1", role: "status" }, dup ? [
        h("h2", { className: "tpf-success__title", text: tx("form.duplicate") })
      ] : [
        h("h2", { className: "tpf-success__title", text: tx("form.success.heading") }),
        h("p", { text: msgText })
      ]);
      container.innerHTML = "";
      container.appendChild(box);
      box.focus();
    }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (state.sending) return;
      var errs = [];
      def.sections.forEach(function (s) {
        s.fields.forEach(function (f) {
          if (!visible(f) || !nodes[f.id]) return;
          state.touched[f.id] = true;
          var e = validate(f);
          showError(f, e);
          if (e) errs.push({ id: f.id, text: typeof e === "string" ? e : e[Object.keys(e)[0]] });
        });
      });
      showSummary(errs);
      if (errs.length) { summary.focus(); return; }
      if (preview) { success(false); return; }
      if (!state.idem) { state.idem = newKey(); saveDraft(); }
      var payload = {
        idempotencyKey: state.idem,
        formId: opts.formId || null,
        locale: locale,
        elapsedMs: Date.now() - state.startedAt,
        hp: hp.value,
        spam: spamInput ? spamInput.value : null,
        attribution: attribution(),
        answers: collect()
      };
      setSending(true, tx("form.sending"));
      withRetry(function () {
        return fetch(submitUrl, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload), credentials: "same-origin" });
      }, function () { status.textContent = tx("form.retrying"); }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (res.ok && j.ok) return success(j.status === "duplicate");
          setSending(false);
          if (res.status === 429) { status.textContent = tx("form.rate_limited"); return; }
          if (j.errors) {
            var list = [];
            for (var id in j.errors) {
              if (!nodes[id]) continue;
              var tv1 = state.values.taxNumber || {};
              var msg = tx(j.errors[id], { field: label(fieldsById[id]), max: 255, name: taxLabel(tv1.country || "") }) || tx("form.error.required", { field: label(fieldsById[id]) });
              // Server errors on an address are about its country (e.g. not accepted): show them there.
              showError(fieldsById[id], fieldsById[id].type === "address" ? { countryCode: msg } : msg);
              list.push({ id: id, text: msg });
            }
            if (j.errors.spam && spamInput) { status.textContent = tx("form.error.spam"); spamInput.focus(); }
            showSummary(list);
            if (list.length) summary.focus();
            return;
          }
          status.textContent = tx("form.failed");
        });
      }, function () {
        setSending(false);
        status.textContent = tx("form.failed");
        submitBtn.textContent = tx("form.retry");
      });
    });

    return { destroy: function () { container.innerHTML = ""; }, values: function () { return state.values; } };
  }

  /**
   * Where the applicant came from (A15): UTM parameters and the referring site's host, first touch of
   * the browsing session (the app embed stores it on every page), else this page. No personal data.
   */
  function attribution() {
    var a = null;
    try { a = JSON.parse(sessionStorage.getItem("tradepass-attr") || "null"); } catch (e) { a = null; }
    if (a) return a;
    try {
      var q = new URLSearchParams(location.search);
      var ref = document.referrer ? new URL(document.referrer).host : "";
      a = { utm_source: q.get("utm_source") || "", utm_medium: q.get("utm_medium") || "", utm_campaign: q.get("utm_campaign") || "", ref: ref === location.host ? "" : ref, landing: location.pathname };
    } catch (e) { a = null; }
    return a;
  }

  /** Storefront strings added after the theme locale files neared their size cap (assets/tradepass-texts.<locale>.json). */
  function loadExtraTexts(urls) {
    var list = (urls || []).filter(Boolean);
    function next(i) {
      if (i >= list.length) return Promise.resolve({});
      return fetch(list[i]).then(function (r) { if (!r.ok) throw r; return r.json(); }).catch(function () { return next(i + 1); });
    }
    return Promise.race([next(0), sleep(3000).then(function () { return {}; })]);
  }

  /** Boot every form block on the page from its inline JSON. */
  function boot() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-tradepass-form]"), function (root) {
      if (root.getAttribute("data-ready")) return;
      root.setAttribute("data-ready", "1");
      var cfgNode = root.querySelector("script[type='application/json']");
      var cfg = {};
      try { cfg = JSON.parse(cfgNode.textContent); } catch (e) { cfg = {}; }
      var texts = cfg.texts || {};
      var ov = cfg.overrides || {};
      var mount = root.querySelector(".tpf-mount") || root;
      loadExtraTexts(cfg.extraTexts).then(function (extra) {
      for (var x in extra) if (texts[x] == null) texts[x] = extra[x];
      for (var k in ov) if (ov[k]) texts[k] = ov[k];
      render(mount, {
        definition: cfg.definition, texts: texts, locale: cfg.locale, dir: cfg.dir,
        endpoint: cfg.endpoint, formId: cfg.formId, country: cfg.country, prefill: cfg.prefill,
        languages: cfg.languages, countriesUrl: cfg.countriesUrl, submitUrl: cfg.submitUrl, uploadUrl: cfg.uploadUrl,
        countryRule: cfg.countryRule
      });
      });
    });
  }

  window.TradepassForm = { render: render, boot: boot, version: 1, _test: { sanitizeDraft: sanitizeDraft, darkColor: darkColor, fileTypeOk: fileTypeOk, checksum: TAX_CHECKSUMS } };
  if (typeof document !== "undefined" && !window.TradepassFormNoBoot) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})();
