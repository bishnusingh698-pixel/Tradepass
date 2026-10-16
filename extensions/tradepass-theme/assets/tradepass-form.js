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
  // ISO 3166-1 alpha-2 codes; names come from Intl.DisplayNames in the visitor's language.
  var CODES = "AD AE AF AG AI AL AM AO AR AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IS IT JE JM JO JP KE KG KH KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MK ML MM MN MO MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PS PT PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VN VU WF WS XK YE YT ZA ZM ZW".split(" ");
  var EU = "AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK".split(" ");
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
    function saveDraft() {
      if (preview) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        try {
          localStorage.setItem(storeKey, JSON.stringify({ v: state.values, idem: state.idem, startedAt: state.startedAt, at: Date.now() }));
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
        }
        return Object.keys(errs).length ? errs : null;
      }
      if (f.type === "country_tax") {
        var tv = v || {};
        if (req && !tv.number) return tx("form.error.required", { field: taxLabel(tv.country) });
        if (tv.number && tv.number.length > 40) return tx("form.error.too_long", { max: 40 });
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
        if (f.type === "phone" && !/^\+?[\d\s().-]{6,20}$/.test(v)) return tx("form.error.phone");
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
    function taxLabel(country) { return tx("form.tax." + taxKind(country)); }

    // ---------- controls ----------
    function fieldShell(f, control, opt) {
      var id = "tpf-" + (++uid);
      var help = ftext(f, "help");
      var errId = id + "-err";
      var helpId = help ? id + "-help" : null;
      var lab = label(f);
      var req = f.state === "required";
      var labelEl = h(opt && opt.legend ? "legend" : "label", { className: "tpf-label", "for": opt && opt.legend ? null : id }, [
        lab, req ? h("span", { className: "tpf-req", "aria-hidden": "true", text: " *" }) : h("span", { className: "tpf-opt", text: " " + tx("form.optional") })
      ]);
      var err = h("p", { className: "tpf-error", id: errId, hidden: true });
      var wrap = h(opt && opt.legend ? "fieldset" : "div", { className: "tpf-field tpf-field--" + f.type, "data-field": f.id }, [
        labelEl, helpId ? h("p", { className: "tpf-help", id: helpId, text: help }) : null
      ]);
      var built = control(id, [helpId, errId].filter(Boolean).join(" "));
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

    function checkboxesControl(f) {
      return function (id, describedBy) {
        var box = h("div", { className: "tpf-choices", "aria-describedby": describedBy });
        var first = null;
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
          box.appendChild(h("div", { className: "tpf-check" }, [cb, h("label", { "for": cid, text: optLabel(f, o) })]));
        });
        return { el: box, focus: function () { if (first) first.focus(); } };
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

    function sub(id, text, control) {
      var e = h("p", { className: "tpf-error", id: id + "-err", hidden: true });
      control.setAttribute("aria-describedby", id + "-err");
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
          parts.countryCode = sub(id + "-country", tx("form.address.country"), cs);
          parts.address1 = sub(id + "-address1", tx("form.address.address1"), input("address1", "address-line1"));
          parts.address2 = sub(id + "-address2", tx("form.address.address2") + " " + tx("form.optional"), input("address2", "address-line2"));
          parts.city = sub(id + "-city", tx("form.address.city"), input("city", "address-level2"));
          [parts.countryCode, parts.address1, parts.address2, parts.city].forEach(function (p) { inner.appendChild(p.el); });
          delete parts.zoneCode; delete parts.zip;
          if (c && c.r) {
            var zs = h("select", { id: id + "-zone", autocomplete: section + " address-level1" }, [h("option", { value: "", text: tx("form.select") })].concat(
              c.r.map(function (z) { return h("option", { value: z[0], text: z[1] }); })
            ));
            zs.value = a.zoneCode || "";
            zs.addEventListener("change", function () { set("zoneCode", zs.value); });
            parts.zoneCode = sub(id + "-zone", zoneLabel(c), zs);
            inner.appendChild(parts.zoneCode.el);
          }
          if (!c || c.z !== 0) {
            parts.zip = sub(id + "-zip", zipLabel(c), input("zip", "postal-code"));
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
          var cs = countrySelect(id + "-country", country, null, function (c) { v.country = c; onChange(f, v); build(); var n = document.getElementById(id + "-country"); if (n) n.focus(); });
          box.appendChild(sub(id + "-country", tx("form.tax.country"), cs).el);
          var kind = taxKind(country);
          numberInput = h("input", { id: id, type: "text", maxlength: 40, autocomplete: "off", spellcheck: "false", "aria-describedby": describedBy, "aria-required": f.state === "required" ? "true" : null });
          numberInput.value = v.number || "";
          numberInput.addEventListener("input", function () { v.number = numberInput.value.trim(); if (!v.country) v.country = country; onChange(f, v); });
          numberInput.addEventListener("blur", blur(f));
          box.appendChild(h("div", { className: "tpf-sub" }, [
            h("label", { "for": id, className: "tpf-sublabel", text: tx("form.tax." + kind) }),
            kind === "vat" ? h("p", { className: "tpf-help", text: tx("form.tax.vat_help") }) : null,
            numberInput
          ]));
          if (kind === "us_resale") {
            var us = countries && countries.US;
            var rs = h("select", { id: id + "-state" }, [h("option", { value: "", text: tx("form.select") })].concat(
              (us && us.r || []).map(function (z) { return h("option", { value: z[0], text: z[1] }); })
            ));
            rs.value = v.region || "";
            rs.addEventListener("change", function () { v.region = rs.value; onChange(f, v); });
            box.appendChild(sub(id + "-state", tx("form.tax.us_state"), rs).el);
          }
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
        }
        input.addEventListener("change", function () {
          var picked = Array.prototype.slice.call(input.files || []);
          input.value = "";
          var err = null;
          picked.forEach(function (file) {
            if (files.length >= MAX_FILES) { err = tx("form.error.file_count"); return; }
            if (!TYPES[file.type] || !EXT.test(file.name)) { err = tx("form.error.file_type", { name: file.name }); return; }
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
        });
        box.appendChild(hint);
        box.appendChild(list);
        box.appendChild(h("label", { "for": id, className: "tpf-filebtn", text: tx("form.upload.add") }));
        box.appendChild(input);
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

    var draft = loadDraft();
    if (draft && draft.v) {
      state.values = draft.v;
      state.idem = draft.idem || null;
      state.startedAt = draft.startedAt || state.startedAt;
      draftNote.hidden = false;
      draftNote.appendChild(h("span", { text: tx("form.draft_restored") + " " }));
      draftNote.appendChild(h("button", { type: "button", className: "tpf-link", text: tx("form.clear_draft"), onclick: function () {
        clearDraft();
        render(container, opts);
      } }));
    }
    var pre = opts.prefill || {};
    ["firstName", "lastName", "email"].forEach(function (k) { if (pre[k] && !state.values[k]) state.values[k] = pre[k]; });
    if (!state.values.preferredLanguage) state.values.preferredLanguage = locale;

    def.sections.forEach(function (s) { s.fields.forEach(function (f) { fieldsById[f.id] = f; }); });

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
      summary.appendChild(h("p", { className: "tpf-summary__title", text: tx("form.error.summary") }));
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
        h("p", { text: msgText }),
        opts.successEmail === false ? null : h("p", { text: tx("form.success.email") })
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
      if (errs.length) { nodes[errs[0].id].focus(); return; }
      if (preview) { success(false); return; }
      if (!state.idem) { state.idem = newKey(); saveDraft(); }
      var payload = {
        idempotencyKey: state.idem,
        formId: opts.formId || null,
        locale: locale,
        elapsedMs: Date.now() - state.startedAt,
        hp: hp.value,
        spam: spamInput ? spamInput.value : null,
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
              var msg = tx(j.errors[id], { field: label(fieldsById[id]), max: 255 }) || tx("form.error.required", { field: label(fieldsById[id]) });
              showError(fieldsById[id], msg);
              list.push({ id: id, text: msg });
            }
            if (j.errors.spam && spamInput) { status.textContent = tx("form.error.spam"); spamInput.focus(); }
            showSummary(list);
            if (list.length) nodes[list[0].id].focus();
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
      for (var k in ov) if (ov[k]) texts[k] = ov[k];
      var mount = root.querySelector(".tpf-mount") || root;
      render(mount, {
        definition: cfg.definition, texts: texts, locale: cfg.locale, dir: cfg.dir,
        endpoint: cfg.endpoint, formId: cfg.formId, country: cfg.country, prefill: cfg.prefill,
        languages: cfg.languages, countriesUrl: cfg.countriesUrl, submitUrl: cfg.submitUrl, uploadUrl: cfg.uploadUrl,
        successEmail: cfg.successEmail
      });
    });
  }

  window.TradepassForm = { render: render, boot: boot, version: 1 };
  if (typeof document !== "undefined" && !window.TradepassFormNoBoot) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})();
