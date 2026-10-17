/* Tradepass storefront gating (app embed). Deferred, dependency-free, budget ≤ 20 KB gzipped.
 * Liquid already hides gated prices/buttons with CSS before paint; this script only adds the
 * "Log in / Apply" message, handles content themes load later (quick add, predictive search,
 * cart drawer, recommendations) and the optional banner/hint. Exposed as
 * window.Tradepass.applyGating(root, config) so the admin preview can reuse it. */
(function () {
  "use strict";
  var DEF = {
    price: ".price,.price__container,.product__price,[data-product-price],product-price,.product-price,.price-item,.price-list,.product-item__price,.product-block--price,.cart-item__price-wrapper,.cart-item__totals",
    addToCart: 'form[action*="/cart/add"] [type="submit"],form[action*="/cart/add"] button[name="add"],.product-form__submit,.product-form__buttons,.product-form__quantity,.shopify-payment-button,shopify-accelerated-checkout,.quick-add,.card__quick-add,.quick-add__submit,quick-add-component,add-to-cart-component,quantity-selector-component,.quantity-selector,.product-form__quantity-selector',
    productCard: ".card-wrapper,.product-card,product-card,.product-card-wrapper,.product-item,.predictive-search__list-item,.predictive-search__item,.cart-item,.cart-drawer__item,.cart-items__table-row,li.product,quick-add-modal,.quick-add-modal,.quick-view"
  };
  var MAIN = '.shopify-section[id*="__main"],main-product,.product-information';
  var mark = "data-tp";

  function sel(cfg, k) {
    var c = cfg.sel && cfg.sel[k];
    return c ? DEF[k] + "," + c : DEF[k];
  }
  function t(cfg, k) {
    var o = cfg.overrides || {};
    return o[k] || (cfg.texts || {})[k] || "";
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  function loginHref(cfg) {
    var u = cfg.loginUrl || "/account/login";
    if (cfg.preview) return u;
    var back = location.pathname + location.search;
    return u + (u.indexOf("?") < 0 ? "?" : "&") + "return_url=" + encodeURIComponent(back);
  }
  function buttons(cfg, compact) {
    var w = el("div", "tp-actions");
    var a = el("a", "tp-btn tp-btn--secondary" + (compact ? "" : " button button--secondary"), t(cfg, "gate.login"));
    a.href = loginHref(cfg);
    var b = el("a", "tp-btn tp-btn--primary" + (compact ? "" : " button"), t(cfg, "gate.apply"));
    b.href = cfg.applyUrl || "/pages/wholesale";
    w.appendChild(a);
    w.appendChild(b);
    return w;
  }
  function message(cfg, key, compact) {
    var box = el("div", "tp-gate" + (compact ? " tp-gate--compact" : ""));
    box.setAttribute(mark, "msg");
    // Compact (product cards): the message stays for screen readers so the
    // "Log in / Apply" links say why the price is missing.
    box.appendChild(el(compact ? "span" : "p", compact ? "tp-sr" : "tp-gate__text", t(cfg, key)));
    box.appendChild(buttons(cfg, compact));
    return box;
  }
  function handleOf(a) {
    var m = /\/products\/([^/?#]+)/.exec(a.getAttribute("href") || "");
    return m ? decodeURIComponent(m[1]) : null;
  }
  function isGated(cfg, h) {
    if (!h) return false;
    if (cfg.scope === "all") return true;
    return !!(cfg._set || (cfg._set = toSet(cfg.handles)))[h];
  }
  function toSet(list) {
    var s = {};
    (list || []).forEach(function (h) { s[h] = 1; });
    return s;
  }
  function first(root, q) {
    try { return root.querySelector(q); } catch (e) { return null; }
  }
  function all(root, q) {
    try { return Array.prototype.slice.call(root.querySelectorAll(q)); } catch (e) { return []; }
  }
  function insertAfterOrIn(target, node, fallback) {
    if (target && target.parentNode) target.parentNode.insertBefore(node, target.nextSibling);
    else if (fallback) fallback.insertBefore(node, fallback.firstChild);
  }

  function gateProductPage(root, cfg) {
    if (!cfg.product || !cfg.product.gated) return 0;
    var main = first(root, MAIN) || first(root, "main") || root;
    if (!main || first(main, "[" + mark + '="msg"]:not(.tp-gate--compact)')) return 0;
    main.classList.add("tp-gated-main");
    var anchor = first(main, sel(cfg, "price")) || first(main, 'form[action*="/cart/add"]');
    insertAfterOrIn(anchor, message(cfg, "gate.message", false), main);
    return 1;
  }

  function gateCards(root, cfg) {
    var n = 0;
    var cart = false;
    all(root, sel(cfg, "productCard")).forEach(function (card) {
      if (card.hasAttribute(mark)) return;
      // Nested card wrappers (li > .card-wrapper): the outer one already decided.
      var up = card.parentElement && card.parentElement.closest("[" + mark + "]");
      if (up && up.getAttribute(mark) !== "msg") return card.setAttribute(mark, "-");
      var a = first(card, 'a[href*="/products/"]');
      var h = a && handleOf(a);
      card.setAttribute(mark, h || "-");
      if (!isGated(cfg, h)) return;
      card.classList.add("tp-gated");
      n++;
      if (/cart/.test(card.className)) { cart = true; return; }
      var p = first(card, sel(cfg, "price"));
      insertAfterOrIn(p, message(cfg, "gate.message", true), card);
    });
    if (cart) {
      var drawer = first(document, "cart-drawer,#CartDrawer,.cart-drawer,cart-items,.cart__items,#main-cart-items");
      if (drawer && !first(drawer, ".tp-cart-note")) {
        var note = el("p", "tp-gate tp-cart-note", t(cfg, "gate.cart"));
        note.setAttribute(mark, "msg");
        drawer.insertBefore(note, drawer.firstChild);
      }
    }
    return n;
  }

  function wall(root, cfg) {
    var main = first(root, "#MainContent") || first(root, "main");
    if (!main || first(main, ".tp-wall")) return;
    var box = el("section", "tp-wall");
    box.setAttribute(mark, "msg");
    box.setAttribute("aria-labelledby", "tp-wall-heading");
    var hd = el("h1", "tp-wall__heading", t(cfg, "wall.heading"));
    hd.id = "tp-wall-heading";
    box.appendChild(hd);
    box.appendChild(el("p", "tp-gate__text", t(cfg, "wall.message")));
    box.appendChild(buttons(cfg, false));
    main.insertBefore(box, main.firstChild);
  }

  function banner(root, cfg) {
    var main = first(root, "#MainContent") || first(root, "main");
    if (!main || first(document, ".tp-banner")) return;
    var b = el("div", "tp-banner");
    b.setAttribute("role", "region");
    b.setAttribute("aria-label", t(cfg, "banner.link"));
    b.appendChild(el("span", "", t(cfg, "banner.text") + " "));
    var a = el("a", "tp-banner__link", t(cfg, "banner.link"));
    a.href = cfg.applyUrl || "/pages/wholesale";
    b.appendChild(a);
    main.insertBefore(b, main.firstChild);
  }

  function hint(root, cfg) {
    if (!cfg.product) return;
    var main = first(root, MAIN) || first(root, "main");
    if (!main || first(main, ".tp-hint")) return;
    var p = first(main, sel(cfg, "price"));
    if (p) insertAfterOrIn(p, el("p", "tp-hint", t(cfg, "hint.text")));
  }

  /** Apply gating inside `root`. Safe to call repeatedly: processed nodes are marked. */
  function applyGating(root, cfg) {
    root = root || document;
    if (!cfg || cfg.b2b) return 0;
    var n = 0;
    if (cfg.wall) wall(root, cfg);
    if (cfg.gate) {
      n += gateProductPage(root, cfg);
      n += gateCards(root, cfg);
    } else if (cfg.mode === "show") {
      if (cfg.banner) banner(root, cfg);
      if (cfg.hint) hint(root, cfg);
    }
    if (cfg.debug && window.console) console.info("[Tradepass]", { mode: cfg.mode, scope: cfg.scope, gatedNow: n });
    return n;
  }

  function readConfig() {
    var node = document.getElementById("tradepass-config");
    if (!node) return null;
    try { return JSON.parse(node.textContent); } catch (e) { return null; }
  }

  function start() {
    var cfg = readConfig();
    if (!cfg) return;
    if (/[?&]tradepass_debug=1/.test(location.search)) cfg.debug = true;
    applyGating(document, cfg);
    if (!cfg.gate || !window.MutationObserver) return;
    var queued = false;
    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      (window.requestAnimationFrame || setTimeout)(function () {
        queued = false;
        applyGating(document, cfg);
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  window.Tradepass = { applyGating: applyGating, defaults: DEF, version: 1 };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
