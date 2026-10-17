Merged into API_NOTES / DECISIONS / CHECKLIST on 2026-10-17

# Storefront + applicant intake — notes

Area: theme app extension (`extensions/tradepass-theme`), app proxy endpoints (`app/routes/proxy.*`), intake, spam, uploads, tax checks, storefront sync.

## Files

| Path | What |
|---|---|
| `extensions/tradepass-theme/shopify.extension.toml` | `type = "theme"`, handle `tradepass-theme`. |
| `blocks/tradepass-embed.liquid` | App embed "Tradepass" (target `body`): CSS gating before paint, config JSON, deferred `tradepass.js`. |
| `blocks/application-form.liquid` | App block "Wholesale application" (target `section`); loads `tradepass-form.js` + `.css` via schema. Setting `form_id` (blank = default form). |
| `blocks/apply-button.liquid` | App block "Apply for wholesale" (button or banner), pure Liquid + CSS. |
| `snippets/tradepass-is-gated.liquid` | Prints `1` when a product is gated (scope all / handles / tags / collections). |
| `snippets/tradepass-form-texts.liquid` | GENERATED: every `form.*` key as JSON in the visitor's language. `tests/storefront-extension.test.ts` fails when it drifts from `locales/en.default.json` (one line per key: `"form.x": {{ "form.x" | t | json }}`, plus `: name: tp_ph_name` etc. for keys with `{{ name }}`/`{{ field }}`/`{{ max }}` placeholders). |
| `assets/tradepass.js` | Embed script, 8.2 KB raw / 2.8 KB gzipped. `window.Tradepass.applyGating(root, config)`. |
| `assets/tradepass-form.js` | Form renderer, 39 KB raw / 10.5 KB gzipped, only on the application page. `window.TradepassForm.render(container, opts)`. |
| `assets/tradepass-form.css` | Form styles (logical properties, no fixed widths). |
| `assets/tradepass-countries.json` | Country/zone data (27.6 KB / 11.4 KB gz), fetched lazily by the form. |
| `locales/en.default.json` (6 KB), `en.default.schema.json` | Storefront strings / theme-editor labels. English only. |
| `app/lib/intake.server.ts` | `handleSubmit`, `cleanAnswers`, `applyUpdate`, `requestedDefinition`, proxy helpers. |
| `app/lib/spam.server.ts` | Honeypot / min time, RateHit limits, salted hashes. |
| `app/lib/uploads.server.ts` | Magic-byte validation, staged upload → fileCreate, signed file refs. |
| `app/lib/taxcheck.server.ts` | VIES / HMRC / ABN. |
| `app/lib/storefront-sync.server.ts` | `syncStorefrontConfig`, `refreshGatedHandles`, `storefrontTexts`, builders. |
| `app/lib/tasks/storefront.ts` | Hourly `storefront-refresh-gated`. |
| `app/routes/proxy.submit.tsx`, `proxy.upload.tsx`, `proxy.prefill.tsx`, `proxy.update.$token.tsx`, `proxy.assets.$file.tsx` | App proxy endpoints (`/apps/tradepass/...` → `/proxy/...`). |
| `app/locales/en/hosted.json` + `_context/hosted.json` | `hosted` namespace (more-info page). |

## Contracts for other areas

- **Form renderer** (`render(container, opts)`): `opts = { definition, texts, locale, dir, preview, endpoint?, submitUrl?, uploadUrl?, formId?, country?, prefill?, languages?, countries?, countriesUrl?, successEmail?, onSuccess? }`. `texts` is the flat dotted map from the extension locale file with merchant overrides already applied (exactly what `loadStorefrontTexts` in `app/components/form-builder/storefront-assets.ts` returns, plus overrides). Per-field/section/option/consent/success/spam texts in the definition win for `locale` (then base language). With `preview: true` there is no fetch and no localStorage; uploads are faked and submit shows the success screen after validation. Pass `countries` (the JSON from `assets/tradepass-countries.json`) to show zone/postcode fields in the preview; without it the address shows country/address/city/postcode only. Set `window.TradepassFormNoBoot = true` before loading if auto-boot is unwanted (it only touches `[data-tradepass-form]`).
- **Embed config** for `applyGating(root, cfg)`: `{ mode, scope, gate, b2b, wall, banner, hint, debug, product: { handle, gated } | null, handles: string[], applyUrl, loginUrl, sel: { price, addToCart, productCard }, texts, overrides }`. Adds `.tp-gated-main` to the gated main product section and `.tp-gated` to gated cards (PreviewAs relies on these).
- **Storefront text overrides**: `Settings.texts[locale][key]` where `key` is an extension locale key (`gate.message`, `form.field.email.label`, …). `buildTexts` syncs only keys that exist in `en.default.json`; `checkout.message` is not one of them (the checkout-lock area handles it).
- **Application.answers** (agreed with lead): keys are field ids; addresses `{ countryCode, address1, address2, city, zoneCode, zip }`, shipping may be `{ same: true }`; `taxNumber: { country, region? }` (number only in `taxNumberEnc`); `taxNumberHash = sha256(normaliseTaxNumber(n))`; files `[{ fileGid, name, expiresOn }]`; `certificateMeta: [{ fileGid, expiresOn }]`.
- **Errors** returned by `/proxy/submit` are extension locale keys (`form.error.required`, …) so the renderer translates them.

## API notes

Checked 2026-10-16 against shopify.dev (Admin GraphQL `latest` = 2026-10):

- ✅ Theme app extension: `shopify.extension.toml` with `name`, `type = "theme"`, optional `handle`; folders `blocks/`, `assets/`, `locales/`, `snippets/`. Block schema keys `name` (< 25 chars), `target` (`section` | `head` | `body` | `compliance_head`), `javascript`, `stylesheet`, `settings`, `enabled_on`/`disabled_on`, `available_if` (boolean app-data metafield only). Limits: 10 MB total, 30 blocks, **locale files ≤ 15 KB each (enforced)**, Liquid ≤ 100 KB total (enforced), JS ≤ 10 KB compressed / CSS ≤ 100 KB (suggested). `javascript` in schema loads with `<script async>`; the embed instead writes its own `<script defer>` only when needed.
- ✅ App-data metafields: owned by the `AppInstallation` (`currentAppInstallation { id }`), written with `metafieldsSet` (max 25 per call, atomic, `ownerId` = installation GID), hidden from admin, readable in Liquid through the `app` object (`app.metafields.<namespace>.<key>`). ⚠️ The docs only show `{{ app.metafields.ns.key }}` in `available_if`; we read `.value` (standard Liquid metafield object) — needs live verification.
- ✅ Metafield limits: `json` values ≤ **128 KB** for apps created after 2026-04-01 (older apps grandfathered at 2 MB); most other types 64 KB. We check every value before writing and cap forms (later forms fall back to the default) and gated handles (1000).
- ✅ Liquid `customer`: `b2b?`, `current_company`, `current_location`, `company_available_locations`, `tags`, `id`. We use `customer.b2b?` as the spec says (true for any B2B customer, even before choosing a location).
- ✅ `stagedUploadsCreate(input: [StagedUploadInput!]!)`: `filename`, `mimeType`, `resource` (`FILE` = any file except HTML, for `fileCreate`), `fileSize` (required only for VIDEO/MODEL_3D), `httpMethod` (default PUT; we use POST multipart with `parameters`). Returns `stagedTargets { url resourceUrl parameters { name value } }`.
- ✅ `fileCreate(files: [FileCreateInput!]!)`: `originalSource!`, `contentType` (`FileContentType`: EXTERNAL_VIDEO, FILE, IMAGE, MODEL_3D, VIDEO), `filename`, `alt`, `duplicateResolutionMode`. Async; `fileStatus` (`FileStatus`: UPLOADED, PROCESSING, READY, FAILED). Scope `write_files`. We store every upload as `contentType: FILE` (GenericFile) with a random 128-bit name and poll `node(id) { ... on File { fileStatus } }` up to 3×0.7 s; only FAILED is an error.
- ✅ `Customer.firstName`, `lastName`, `defaultEmailAddress` exist (`email` is deprecated); requires `read_customers`. ⚠️ `CustomerEmailAddress.emailAddress` subfield not shown on the page — used by `/proxy/prefill` only.
- ⚠️ `all_country_option_tags` docs don't document the `value` attribute (it's the English country name, no ISO code) and give province names, not zone codes. Company addresses need `countryCode` + `zoneCode`, so the form uses **Shopify's own address data** from the MIT-licensed npm package `@shopify/address-mocks@3.3.1` (`countries_en` fixture = Shopify's address service snapshot: ISO code, zones with codes, `provinceKey`, postcode label/presence). Country names are shown with `Intl.DisplayNames` in the visitor's language; zone names are English/native (from the fixture).
- ⚠️ EU VIES swagger (`swagger_publicVAT.yaml`) could not be fetched from this environment (proxy blocked / returned binary). Implemented from the documented REST contract as used by maintained client libraries: `POST https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number` with `{ countryCode, vatNumber }` → `{ valid, name, address, requestDate, … }`; errors `{ actionSucceed: false, errorWrappers: [{ error, message }] }` with codes INVALID_INPUT, SERVICE_UNAVAILABLE, MS_UNAVAILABLE, TIMEOUT, GLOBAL/MS_MAX_CONCURRENT_REQ, VAT_BLOCKED, IP_BLOCKED. The parser also accepts the GET form (`isValid`, `userError`). `name` "---" = not disclosed.
- HMRC "Check a UK VAT number" v2: OAuth client-credentials token at `/oauth/token`, then `GET /organisations/vat/check-vat-number/lookup/{vrn}` with `Accept: application/vnd.hmrc.2.0+json`; 404 = not found. Only when `HMRC_CLIENT_ID`/`HMRC_CLIENT_SECRET` are set.
- ABN Lookup JSON: `https://abr.business.gov.au/json/AbnDetails.aspx?abn=&guid=&callback=` returns JSONP with `Abn`, `AbnStatus`, `EntityName`, `Message`. Only when `ABN_GUID` is set; checksum validated locally first.
- ✅ App proxy signature: verified with our `verifyProxyRequest` (`app/lib/proxy.server.ts`, already tested against Shopify's example) on **every** `/proxy/*` request, not `authenticate.public.appProxy` — we need plain JSON/HTML responses and a check that the shop is still installed. Admin API calls use `unauthenticated.admin(shop)`.

## Decisions

- **Gating CSS in Liquid, messages in JS.** "all" scope hides price/add-to-cart/dynamic checkout everywhere before paint; partial scopes hide the main product section on gated product pages and, on collection/search templates, emit `:has(a[href$="/products/<handle>"])` rules for gated products on that page. Content themes inject later (predictive search, quick add, recommendations, cart drawer) is handled by the MutationObserver, so it can briefly show a price before hiding (no layout break). Signed-in `customer.b2b?` buyers get no gating CSS at all.
- **Gated handle list capped at 1000** (~30 KB inline on every page for partial scopes). Product pages also check tags/collections directly in Liquid, so a stale or capped list never un-hides a product page; only cards beyond the cap on dynamic content would show prices. — **Proposed**: tell merchants with >1000 gated products to use "whole store" or a tag scope (product pages always correct).
- **First-time spam is discarded, not stored** (honeypot or < 3 s). The applicant (bot) sees success. After 5 spam hits per hour, everything from that IP is discarded for the hour. Nothing is written to Applications, so "auto-rejected silently" means "never created". — **Proposed** (merchant never sees spam; there is no spam count in the admin).
- **Rate limits** (per hour, RateHit, salted hashes): submit 10/IP and 3/email; upload 30/IP; needs-info update 20/IP. Retries of the same idempotency key don't count.
- **Duplicates**: an application matching an earlier one in the same shop by email, company name (case-insensitive) or tax-number hash is stored with flag `duplicate`. The applicant sees "You've already applied" (and gets no "received" email) only when the earlier one is pending, needs info or approved; after a rejection they see the normal success.
- **Uploads before submit**: each file is uploaded on selection (with the same 60 s retry) and the browser gets a signed, shop-bound, 24 h reference. Submit only accepts valid references, so nobody can attach someone else's Shopify File GID.
- **Needs-info page is standalone HTML** (not `application/liquid`), so applicant text can never be executed as Liquid and the page doesn't depend on the theme. It loads the same renderer/CSS/country data through `/apps/tradepass/assets/*`. The email address cannot be changed through the link. A link is claimed atomically before applying and released if validation fails.
- **Merchant text sanitising**: angle brackets are removed from all synced merchant text and form definitions (they end up inside `<script type="application/json">` in Liquid); colours must be hex; custom selectors lose `<>{}\;@"\``; apply/login URLs must be `/relative` or `https://`.
- **Locale files**: English is 6 KB of the 15 KB cap so translations in 3-byte UTF-8 scripts (hi, th, zh, ja, ko) should still fit. — **Risk**: if a translation exceeds 15 KB, split form help texts into the `tradepass.texts` metafield (synced from app catalogs) instead.
- Tax lookup is awaited inside the submit (≤ 5 s) rather than after the response, so the stored status is complete when the merchant opens it; any failure → `unavailable`, never an error.
- The app proxy path is assumed to be `/apps/tradepass` (from `shopify.app.toml`). Merchants can change an app proxy's subpath in their admin; the form would then 404. The hosted page uses the `path_prefix` Shopify sends.

## Schema / config wishes (not done — owned elsewhere)

- None required. Optional: `Application.flags` value `possible_spam` is not used (spam is never stored).
- `/proxy/prefill` needs **protected customer data** access (name, email) in the Partner Dashboard. The form block prefills from Liquid, which needs nothing, so prefill via proxy can be dropped if the access request is a problem.

## Needs live verification

1. `app.metafields.tradepass.config.value` returns the JSON object in Liquid (embed, form block, apply block). If `.value` is not needed for app metafields, drop it in the three blocks.
2. `customer.b2b?` is true for a signed-in company contact on a non-Plus store with B2B markets; prices show normally for them.
3. Gating on Dawn, Horizon and two other free themes: product page, collection grid, search page, predictive search, quick add modal, cart drawer, sticky add-to-cart. Add selectors to the defaults (`tradepass.js` DEF + the embed Liquid; the test keeps them equal) for anything missed.
4. `{{ x | json }}` escapes `<`/`>` inside `<script type="application/json">` (customer names in prefill are not sanitised by us).
5. The `t` filter returns `{{ name }}` placeholders literally when passed `name: tp_ph_name` (snippet `tradepass-form-texts`).
6. Staged upload with `httpMethod: POST` for `resource: FILE`, then `fileCreate` → file appears in Content → Files with the random name; images uploaded as `contentType: FILE` open correctly for staff.
7. App proxy forwards the client IP in `X-Forwarded-For` (rate limits use the left-most entry; if Shopify sends its own IP, per-IP limits become per-Shopify-edge — per-email limits still apply).
8. App proxy POST bodies up to ~5 MB (multipart) are forwarded.
9. Locale-prefixed storefronts (`/fr/...`): the form posts to `/apps/tradepass/...` without the prefix — confirm it works.
10. VIES REST JSON field names against the official swagger.
11. Hourly task: gated list refreshes after tagging a new product (tags scope).

## Checklist

### Storefront setup
- [ ] 1. In Shopify admin open **Online Store → Themes → Customize**. In the left bar click the **App embeds** icon and switch **Tradepass** on. Click **Save**.
- [ ] 2. Create a page: **Online Store → Pages → Add page**, title "Wholesale", save. In the theme editor open that page (top dropdown → Pages → Wholesale), click **Add block** (or **Add section → Apps**) and choose **Wholesale application**. Save.
- [ ] 3. Open the page on your phone. The form shows one column; tapping a field opens the right keyboard (email, phone, numbers).

### Application form
- [ ] 4. Press **Send application** with everything empty. A red box at the top lists the problems and the cursor jumps to the first field.
- [ ] 5. Type a bad email, leave the field: an error appears under it right away.
- [ ] 6. Fill a few fields, close the tab, open the page again: "We restored the answers you entered earlier." appears and your answers are back.
- [ ] 7. Choose **United States** as billing country: a **State** list and **ZIP code** appear. The tax field says "Resale certificate number" with a state list. Choose **Germany**: the tax field says "VAT number".
- [ ] 8. Add a PDF certificate under 5 MB: it shows as uploaded with an optional expiry date. Try a 6 MB file or a .docx: a clear error, nothing uploaded.
- [ ] 9. Submit. You see "Thank you, your application has been sent". In Tradepass → Applications the application is there; in **Content → Files** the certificate is there with a random name.
- [ ] 10. Submit again with the same email: you see "You've already applied. We'll be in touch." and the new application shows a duplicate flag.
- [ ] 11. Turn on airplane mode, submit, turn it off within a minute: the button says "Sending…", then the success screen. Only one application exists.
- [ ] 12. Switch the store language to Arabic (if published): the form is right-to-left.

### Access modes
- [ ] 13. Tradepass → Storefront → "Hide prices from non-wholesale visitors", whole store, save. In a private window: product pages, collection pages, search and the cart drawer show no prices or Add to cart, and show "Log in" / "Apply for wholesale".
- [ ] 14. Sign in as an approved wholesale buyer: prices and Add to cart are back everywhere.
- [ ] 15. Change scope to one collection, save, wait a minute: only products in that collection are hidden.
- [ ] 16. Mode "Show prices to everyone" with the banner on: the "Buying for a business? Apply for wholesale" bar shows at the top of pages for retail visitors.
- [ ] 17. Add the **Apply for wholesale** block to your footer, choose **Banner**: it links to your wholesale page.

### More-info link
- [ ] 18. On an application click **Needs info**, pick "Phone", send. Open the link from the email: only the phone field shows. Submit: "Thank you, your application has been updated". Open the link again: "This link has already been used".
