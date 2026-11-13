# API notes — what was checked against Shopify's docs

Checked on **2026-10-16** (and per area on 2026-10-16/17, see the area sections at the end) against Admin GraphQL **2026-10** (the version shopify.dev labels "latest"), the app template's `ApiVersion.October26`, and the linked shopify.dev pages. "✅" = confirmed on the docs page. "⚠️" = differs from the build prompt or carries a risk. "🔲" = not yet verified, check before the phase that uses it.

## Plan, B2B and Markets detection (P1) ✅

```graphql
shop {
  plan { publicDisplayName partnerDevelopment shopifyPlus }          # ShopPlan
  features { directConnectionCatalogAssignmentEnabled }              # ShopFeatures
  entitlements {                                                      # EntitlementsType
    b2b { enabled }                                                   # B2BType
    markets { b2b { enabled catalogs { enabled limit } } }            # MarketsType → MarketsB2BEntitlement → MarketsCatalogsEntitlement
  }
}
shopLocales { locale primary published }                              # needs read_locales
markets(type: COMPANY_LOCATION, first: 50) { nodes { id catalogs(first: 10) { nodes { id } } } }
```

- `ShopPlan.publicDisplayName` values include Basic, Grow, Advanced, Plus, Plus Trial, Development, Starter, Retail, Trial, etc. `ShopPlan.displayName` is deprecated, and so is `ShopFeatures.shopifyPlus` (use `ShopPlan.shopifyPlus`).
- `entitlements.markets.b2b.catalogs.limit` is the B2B catalog cap (expected 3 on Basic/Grow/Advanced). **We read the cap from Shopify instead of hard-coding 3.**
- `directConnectionCatalogAssignmentEnabled` = catalogs can be assigned straight to company locations (Plus). This is our switch for Plus-only tier behaviour.
- Catalog budget = distinct catalogs attached to markets of `MarketType.COMPANY_LOCATION`, so catalogs the merchant made outside Tradepass count too.
- `MarketType` values: CHANNEL, COMPANY_LOCATION, LOCATION, NONE, REGION. `CatalogType` values: APP, COMPANY_LOCATION, MARKET, NONE.

## B2B markets (tier assignment) — P0/P2

- ✅ `marketCreate(input: MarketCreateInput!)`: fields `name!`, `handle`, `status`, `conditions: MarketConditionsInput`, `catalogs: [ID!]`, `currencySettings`, `priceInclusions`, `webPresences`, `delivery`, `discounts`, `returnPolicyProfileId`. `enabled` and `regions` are deprecated.
- ✅ `marketUpdate(id: ID!, input: MarketUpdateInput!)`: fields `conditions: MarketConditionsUpdateInput { conditionsToAdd, conditionsToDelete }` (both `MarketConditionsInput`), `catalogsToAdd`, `catalogsToDelete`, `status`, `name`, `handle`, etc.
- ✅ `MarketConditionsInput.companyLocationsCondition: MarketConditionsCompanyLocationsInput { applicationLevel: MarketConditionApplicationType (ALL | SPECIFIED), companyLocationIds: [ID!] }`.
- ✅ Read-back: `market(id) { type conditions { conditionTypes companyLocationsCondition { applicationLevel companyLocations(first: N) { nodes { id } } } } }`.
- ✅ Scopes: `read_markets` + `write_markets` (`write_markets` is enough to request).
- ✅ `MarketUserErrorCode` includes **`B2B_CATALOG_LIMIT_REACHED`**, **`CANNOT_ACTIVATE_MARKET_B2B_CATALOG_LIMIT_REACHED`**, **`MARKET_UPDATE_CONCURRENT_MODIFICATION`**, **`SPECIFIED_CONDITIONS_CANNOT_BE_EMPTY`**, `B2B_MARKET_MUST_BE_MERCHANT_MANAGED`, `UNPERMITTED_ENTITLEMENTS_MARKET_CATALOGS`, `CATALOGS_WITH_VOLUME_PRICING_OR_QUANTITY_RULES_NOT_SUPPORTED`, `NOT_ENTITLED_TO_ACTIVATE_MARKET`.
- ⚠️ **The `marketCreate` page says B2B markets for company locations are "currently only available in the dev preview."** This is the main risk the Phase 0 spike must settle on a real non-Plus store. If creating them by API is blocked outside the dev preview, tiers can still *link* to markets the merchant created in admin, and assignment may still work through `marketUpdate`. The spike records both.
- ⚠️ `SPECIFIED_CONDITIONS_CANNOT_BE_EMPTY` suggests a B2B market can't have zero locations. A new tier, or the last buyer leaving a tier, would then break. The spike tests an empty market. If it's rejected, each tier market keeps one **placeholder company location** that Tradepass creates and hides (see DECISIONS D-004).
- ⚠️ `MARKET_UPDATE_CONCURRENT_MODIFICATION` confirms concurrent writes to one market can clash, so a per-shop lock plus read-back plus retry is required (spike step 4).

## Catalogs, price lists, publications — P2

- ✅ `catalogCreate(input: CatalogCreateInput!)`: `title`, `status` (ACTIVE/DRAFT), `context: CatalogContextInput { marketIds, companyLocationIds }`, `priceListId`, `publicationId`. Scope `write_products`.
- ✅ `catalogDelete(id, deleteDependentResources: Boolean)` also deletes the catalog's own price list and publication.
- ✅ `priceListCreate(input: { name, currency, parent: { adjustment: { type: PriceListAdjustmentType, value } } })`. `PriceListAdjustmentType` = `PERCENTAGE_DECREASE | PERCENTAGE_INCREASE`. Scope `write_products`.
- ✅ `publicationCreate(input: { catalogId, defaultState, autoPublish })`. Scope **`write_publications`**. 🔲 `publicationUpdate` inputs for adding collections: verify in P2.
- ✅ `catalogsCount(type: CatalogType, query, limit)` exists.

## Companies — P2 ✅

- `companyCreate(input: CompanyCreateInput!)` with `company { name externalId }`, `companyLocation { name shippingAddress billingAddress billingSameAsShipping … }`, `companyContact { email firstName lastName … }`. Returns `company`, `userErrors: [BusinessCustomerUserError]`. Scope `write_companies` (or `write_customers`). Needs B2B access.
- `companyLocationCreate(companyId, input: CompanyLocationInput!)`: `name`, `shippingAddress`, `billingAddress`, `billingSameAsShipping`, `buyerExperienceConfiguration`, `externalId`, `locale`, `note`, `phone`, `taxExempt`, `taxExemptions`, `taxRegistrationId`.
- `companyLocationTaxSettingsUpdate(companyLocationId!, taxRegistrationId, taxExempt, exemptionsToAssign, exemptionsToRemove)`. ⚠️ The prompt only mentioned `exemptionsToAssign`; `exemptionsToRemove` and `taxExempt` exist too, and Undo uses them. `companyLocationAssignTaxExemptions` / `companyLocationRevokeTaxExemptions` also exist.
- Exists in 2026-10: `companyLocationUpdate`, `companyAssignCustomerAsContact`, `companyContactCreate`, `companyContactAssignRole(s)`, `companyLocationAssignRoles`, `companyAssignMainContact`, `companyDelete` (returns `deletedCompanyId`), `companyLocationCreateTaxRegistration`.
- ✅ **`companyContactSendWelcomeEmail(companyContactId: ID!, email: EmailInput)`** exists. So we use Shopify's own B2B welcome email (DECISIONS D-005). Since D-091 it is the only email in Tradepass, with no fallback. The Flow template is optional. `customerSendAccountInviteEmail` is not used: it only works with legacy customer accounts.
- 🔲 `paymentTermsTemplates` query exists (index). Check its scope and `BuyerExperienceConfigurationInput.paymentTermsTemplateId` / `checkoutToDraft` in P2.

## TaxExemption enum ✅ (exactly as the prompt says)

There are 74 values: 51 `US_<XX>_RESELLER_EXEMPTION` (50 states plus DC), 22 `CA_*`, and `EU_REVERSE_CHARGE_EXEMPTION_RULE`. None are deprecated. The mapping lives in `app/lib/tax.ts` and is tested in `tests/tax.test.ts`.

## Files — P3

- ✅ `stagedUploadsCreate(input: [StagedUploadInput!]!)` → `stagedTargets { url resourceUrl parameters { name value } }`. The index also lists `stagedUploadTargetGenerate`. 🔲 Check the `resource` value for PDFs (likely `FILE`) in P3.
- ✅ `fileCreate(files: [FileCreateInput!]!)` with `originalSource`, `contentType` (`FILE` for PDF gives a `GenericFile` with `url`), `filename`, `alt`. Processing is async, so poll `fileStatus` until `READY`. Scope `write_files`.
- ⚠️ A GenericFile `url` is a public CDN URL. "Files open only for staff" (acceptance 4) means we never show that URL on the storefront, and the admin opens files through an authenticated app route that streams them. Uploaded file names are randomised, so the URL can't be guessed. Recorded as DECISIONS D-006.

## App proxy — P3 ✅

The signature check is: drop `signature`, build `key=value` with repeated keys joined by `,`, sort, concatenate with no separator, HMAC-SHA256 with the app secret, hex, then compare in constant time. Shopify adds `shop`, `logged_in_customer_id` (empty if logged out), `path_prefix`, `timestamp` and `signature`. Cookies and Set-Cookie are stripped. Method and body are forwarded, and the signature is checked on the URL's query params. The implementation and tests (using Shopify's own example string) are in `app/lib/proxy.server.ts` and `tests/proxy.test.ts`. We also reject timestamps older than 5 minutes.

## App Bridge `app.extensions()` — P1/P5 ✅

`shopify.app.extensions()` → `[{ handle, type: 'theme_app_extension' | 'ui_extension', activations: [{ handle, name, target: 'section' | 'head' | 'body' | 'compliance_head', status: 'active' | 'available' | 'unavailable', activations: [{ target, themeId }] }] }]`. ⚠️ The status values are lowercase, not ACTIVE/AVAILABLE, and only the **published** theme is checked. The Shopify community reports stale status after disabling an embed, so the checklist also offers a "Check again" button.

## Cart & checkout validation Function — P5

- ✅ Target `cart.validations.generate.run`. Input can read `buyerJourney.step` and `cart.buyerIdentity.purchasingCompany { company location contact }`, plus customer and metafields.
- ⚠️ **It runs on Draft Orders (Admin and Checkout).** It does **not** run on POS, the Create Order API, order edits or subscriptions. So "admin draft orders still work" (acceptance 14) is not automatic: the function must let through carts where `purchasingCompany` is set, and staff-created draft orders for non-company customers would be blocked. 🔲 In P5, find a reliable way to detect the admin draft-order context. If there isn't one, document that wholesale-only mode blocks retail draft orders, and let merchants exempt a customer tag.
- Up to 25 validation functions per store. 🔲 Output schema (`operations[].validationAdd.errors[{ message, target }]`) to confirm in P5.

## Flow — P7

- ✅ `flowTriggerReceive(handle: String, payload: JSON)`, where `body` is deprecated. 🔲 Payload size limit (prompt says < 50 KB) and the public-app trigger and action extension TOML in P7.

## Polaris / App Bridge — P1 ✅

- The template (`@shopify/shopify-app-react-router` 3.0.x) uses **Polaris web components** (`s-page`, `s-section`, `s-app-nav`, …) through `AppProvider`, which injects `app-bridge.js` and `polaris.js`.
- Polaris 2.0 for App Home is still a **release candidate** (`polaris-2.0-rc.js`, types `@shopify/polaris-types@2.0.0-rc.x`). The unversioned `polaris.js` keeps serving 1.x. We stay on the template default (1.x) and switch when 2.0 is stable (DECISIONS D-002).

## Customer accounts / Liquid — P5 🔲

Check `customer.b2b?`, `customer.current_company` and `customer.current_location` availability in theme app extensions.

## Free tax registries — P3

- EU VIES REST: `POST https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number` (test service: `/check-vat-test-service`). Swagger: `https://ec.europa.eu/assets/taxud/vow-information/swagger_publicVAT.yaml`. It's free with no key, and it can return member-state-unavailable errors, so we use a timeout and the "Couldn't verify" fallback. 🔲 Confirm the JSON field names from the swagger in P3.
- UK HMRC "Check a UK VAT number" needs a free **HMRC Developer Hub** application (client id and secret owned by *us*, not the merchant). This is optional. Without it, UK numbers show "Couldn't verify — check manually". It's listed under "What I need from you" as optional.
- Australian ABN Lookup needs a free GUID registration and is optional, with the same fallback.

## Access scopes

P1 set: `write_companies`, `write_markets`, `write_products`, `read_locales`. Each is justified in DECISIONS D-007.

**Final set (2026-10-17, in `shopify.app.toml`, `.env.example` and `render.yaml`):** `write_companies, write_customers, write_markets, write_products, write_publications, write_files, write_validations, read_orders, read_locales`. `write_validations` was added for the checkout lock. `read_customers` is not requested because `write_customers` includes read access. See DECISIONS D-016.

## Area notes (merged 2026-10-17)

The sections below come from the per-area notes in `docs/notes/` and were checked on 2026-10-16/17 against shopify.dev (Admin GraphQL 2026-10, the version labelled "latest", and Functions 2026-10). Where they answer a 🔲 above, they replace it. Each section has two lists: what was confirmed, and where Shopify differs from the build prompt (or where there's a risk). Items that only a dev store can prove are listed in CHECKLIST.md and ROADMAP.md → "Needs live verification".

## Area: Tiers, approval engine, buyers (P2, P6)

**Confirmed**
- ✅ `companyCreate(input: CompanyCreateInput!)`: `company: CompanyInput!` (`name`, `externalId`, `note`, `customerSince`), `companyLocation: CompanyLocationInput`, `companyContact: CompanyContactInput`. We create the company and its first location in one call. The contact is a separate step.
- ✅ `CompanyLocationInput`: `name`, `externalId`, `locale`, `phone`, `note`, `billingAddress`, `shippingAddress`, `billingSameAsShipping`, `buyerExperienceConfiguration`, `taxExempt`, `taxExemptions`, `taxRegistrationId`.
- ✅ `CompanyAddressInput`: `address1`, `address2`, `city`, `countryCode`, `zoneCode`, `zip`, `firstName`, `lastName`, `phone`, `recipient`.
- ✅ `companyLocationCreate(companyId, input)`, `companyLocationDelete(companyLocationId) → deletedCompanyLocationId`, `companyDelete(id) → deletedCompanyId`.
- ✅ `companyLocationUpdate(companyLocationId, input: CompanyLocationUpdateInput)`: `buyerExperienceConfiguration`, `externalId`, `locale`, `name`, `note`, `phone`.
- ✅ `BuyerExperienceConfigurationInput`: `paymentTermsTemplateId`, `checkoutToDraft` (so "orders go to you as drafts" is possible), `editableShippingAddress`, `deposit`. Read back as `BuyerExperienceConfiguration { paymentTermsTemplate { id } checkoutToDraft }`. `payNowOnly` is deprecated.
- ✅ `paymentTermsTemplates(paymentTermsType)` → `[PaymentTermsTemplate!]!` with `id name translatedName paymentTermsType dueInDays description`.
- ✅ `companyLocationTaxSettingsUpdate(companyLocationId!, taxExempt, exemptionsToAssign, exemptionsToRemove, taxRegistrationId)`, read back from `CompanyLocation.taxSettings { taxExempt taxExemptions taxRegistrationId }`.
- ✅ `TaxExemption`: 74 values (51 US, 22 CA, 1 EU). The full list is `TAX_EXEMPTIONS` in `app/lib/approval.server.ts`, checked by a test.
- ✅ `companyContactCreate(companyId, input: CompanyContactInput)` creates the contact and a customer. `CompanyContactInput` has `email firstName lastName locale phone title`. A duplicate email returns `BusinessCustomerErrorCode.TAKEN`, which we handle by linking the existing customer.
- ✅ `companyAssignCustomerAsContact(companyId, customerId)`, `companyAssignMainContact(companyId, companyContactId)`, `companyContactRemoveFromCompany(companyContactId) → removedCompanyContactId` (removes the link, keeps the customer).
- ✅ `companyLocationAssignRoles(companyLocationId, rolesToAssign: [{ companyContactId, companyContactRoleId }])`. Roles come from `Company.contactRoles { id name }` and `Company.defaultRole`. Read back from `CompanyLocation.roleAssignments`.
- ✅ `companyContactSendWelcomeEmail(companyContactId, email: EmailInput)`.
- ✅ `companies(query:)` supports `external_id:`. Retry uses it to find a company it created before its ID was saved.
- ✅ Markets: `marketCreate`, `marketUpdate(id, input { conditions { conditionsToAdd, conditionsToDelete }, catalogsToAdd, status, name })`, `marketDelete(id) → deletedId`, read-back with `market(id) { conditions { companyLocationsCondition { companyLocations } } }`.
- ✅ Catalogs: `catalogCreate`, `catalogUpdate(id, input { title status priceListId publicationId context })`, `catalogDelete(id, deleteDependentResources: true)`, `catalogContextUpdate(catalogId, contextsToAdd, contextsToRemove)` (Plus direct assignment). Plus read-back: `MarketCatalog.markets(type: COMPANY_LOCATION)`, `CompanyLocationCatalog.companyLocations`, `CompanyLocation.inCatalog(catalogId)`.
- ✅ `priceListUpdate(id, input { parent { adjustment { type value } } })`, read back as `PriceList.parent.adjustment`.
- ✅ `publicationCreate(input { catalogId, defaultState: EMPTY | ALL_PRODUCTS, autoPublish })` and `publicationUpdate(id, input { publishablesToAdd, publishablesToRemove })`, max 50 per call, scope `write_publications`. (Answers the 🔲 in "Catalogs, price lists, publications".)
- ✅ `Company.ordersCount { count }` and `Company.totalSpent { amount currencyCode }` exist. Buyers reads them with one `nodes(ids:)` call per page.
- Admin deep links use `shopify://admin/companies/<id>` and `shopify://admin/markets/<id>` (App Bridge).

**Differences from the spec, and risks**
- ⚠️ `CompanyAddressInput` has no `company` field, so the address's company name goes into `recipient`.
- ⚠️ The older `CompanyLocation.taxExemptions` / `taxRegistrationId` fields, `companyLocationAssignTaxExemptions` / `companyLocationRevokeTaxExemptions` and `companyLocationCreateTaxRegistration` are **deprecated**. We use only `companyLocationTaxSettingsUpdate` and `taxSettings`. (This corrects the "Companies" section above, which lists them as existing.)
- ⚠️ The docs don't name the scope for `paymentTermsTemplates` or `companyContactSendWelcomeEmail`.
- ⚠️ The docs don't list the default contact role names. We pick `defaultRole`, then a role whose name contains "order" (Shopify's "Ordering only"), then the first role, and read the assignment back.
- ⚠️ The docs only promise products as publishables. "Only these collections" therefore publishes each collection's products (plus the collection IDs).
- ⚠️ `Company.ordersCount` / `totalSpent` most likely need `read_orders` (which we request). If the call fails, the Buyers page drops to a query without orders and shows "—".
- ⚠️ `customers(query: "email:…")` and `Customer.companyContactProfiles` need customer read access. We get it from `write_customers` (D-016). It also needs protected customer data approval for name and email.

## Area: Storefront and applicant intake (P3, P5)

Theme app extension `extensions/tradepass-theme`, app proxy endpoints `app/routes/proxy.*`, intake, spam, uploads, tax checks and storefront sync.

**Confirmed**
- ✅ Theme app extension: `shopify.extension.toml` with `name`, `type = "theme"`, optional `handle`. Folders `blocks/`, `assets/`, `locales/`, `snippets/`. Block schema keys: `name` (< 25 chars), `target` (`section` | `head` | `body` | `compliance_head`), `javascript`, `stylesheet`, `settings`, `enabled_on`/`disabled_on`, `available_if` (boolean app-data metafield only). Limits: 10 MB total, 30 blocks, **locale files ≤ 15 KB each (enforced)**, Liquid ≤ 100 KB total (enforced), JS ≤ 10 KB compressed and CSS ≤ 100 KB (suggested). `javascript` in the schema loads with `<script async>`; our embed writes its own `<script defer>` only when it's needed.
- ✅ App-data metafields: owned by the `AppInstallation` (`currentAppInstallation { id }`), written with `metafieldsSet` (max 25 per call, atomic, `ownerId` = installation ID), hidden from the admin, readable in Liquid through `app.metafields.<namespace>.<key>`.
- ✅ Metafield limits: `json` values ≤ **128 KB** for apps created after 2026-04-01 (older apps keep 2 MB). Most other types are 64 KB. We check every value before writing, cap the number of forms (later forms fall back to the default) and cap gated handles at 1,000.
- ✅ Liquid `customer`: `b2b?`, `current_company`, `current_location`, `company_available_locations`, `tags`, `id`. We use `customer.b2b?` as the spec says. It's true for any B2B customer, even before they choose a location. (Answers the 🔲 in "Customer accounts / Liquid".)
- ✅ `stagedUploadsCreate(input: [StagedUploadInput!]!)`: `filename`, `mimeType`, `resource` (`FILE` = any file except HTML, for `fileCreate`), `fileSize` (required only for VIDEO/MODEL_3D), `httpMethod` (default PUT; we use POST multipart with `parameters`). Returns `stagedTargets { url resourceUrl parameters { name value } }`. (Answers the 🔲 in "Files".)
- ✅ `fileCreate(files: [FileCreateInput!]!)`: `originalSource!`, `contentType` (`FileContentType`: EXTERNAL_VIDEO, FILE, IMAGE, MODEL_3D, VIDEO), `filename`, `alt`, `duplicateResolutionMode`. Async, with `fileStatus` (UPLOADED, PROCESSING, READY, FAILED). Scope `write_files`. We store every upload as `contentType: FILE` (GenericFile) with a random 128-bit name and poll `node(id) { ... on File { fileStatus } }` up to 3 × 0.7 s. Only FAILED counts as an error.
- ✅ `Customer.firstName`, `lastName`, `defaultEmailAddress` exist. `email` is deprecated.
- ✅ App proxy signature: checked with our own `verifyProxyRequest` (`app/lib/proxy.server.ts`, tested against Shopify's example) on **every** `/proxy/*` request, instead of `authenticate.public.appProxy`, because we need plain JSON/HTML responses and a check that the shop is still installed. Admin API calls from proxy routes use `unauthenticated.admin(shop)`.
- HMRC "Check a UK VAT number" v2: OAuth client-credentials token at `/oauth/token`, then `GET /organisations/vat/check-vat-number/lookup/{vrn}` with `Accept: application/vnd.hmrc.2.0+json`. 404 means not found. Used only when `HMRC_CLIENT_ID` and `HMRC_CLIENT_SECRET` are set.
- ABN Lookup JSON: `https://abr.business.gov.au/json/AbnDetails.aspx?abn=&guid=&callback=` returns JSONP with `Abn`, `AbnStatus`, `EntityName`, `Message`. Used only when `ABN_GUID` is set. The checksum is checked locally first.

**Differences from the spec, and risks**
- ⚠️ The docs only show `{{ app.metafields.ns.key }}` inside `available_if`. We read `.value` (the standard Liquid metafield object). Needs a live check.
- ⚠️ `CustomerEmailAddress.emailAddress` isn't shown on the docs page. Only `/proxy/prefill` uses it.
- ⚠️ Liquid's `all_country_option_tags` doesn't document its `value` attribute (it's the English country name, not an ISO code) and gives province names, not zone codes. Company addresses need `countryCode` + `zoneCode`. So the form uses **Shopify's own address data** from the MIT-licensed npm package `@shopify/address-mocks@3.3.1` (`countries_en`, a snapshot of Shopify's address service with ISO codes, zone codes, `provinceKey` and postcode rules). Country names are shown in the visitor's language with `Intl.DisplayNames`; zone names come from the snapshot.
- ⚠️ The EU VIES swagger (`swagger_publicVAT.yaml`) couldn't be fetched from this environment. The client follows the documented REST contract that maintained client libraries use: `POST https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number` with `{ countryCode, vatNumber }` → `{ valid, name, address, requestDate, … }`. Errors are `{ actionSucceed: false, errorWrappers: [{ error, message }] }` with codes INVALID_INPUT, SERVICE_UNAVAILABLE, MS_UNAVAILABLE, TIMEOUT, GLOBAL/MS_MAX_CONCURRENT_REQ, VAT_BLOCKED, IP_BLOCKED. The parser also accepts the GET form (`isValid`, `userError`). A `name` of "---" means "not disclosed". Field names need checking against the official swagger.
- ⚠️ Locale files are capped at 15 KB. English is 6 KB, so 3-byte scripts (hi, th, zh, ja, ko) should fit, but this is a risk (ROADMAP).
- ⚠️ The app proxy path is assumed to be `/apps/tradepass`. Merchants can change the subpath in their admin, and the form would then fail. The hosted page uses the `path_prefix` Shopify sends.

## Area: Form builder and Storefront admin pages (P3, P5)

**Confirmed**
- ✅ Theme editor deep links: embed `https://{shop}/admin/themes/current/editor?context=apps&template={t}&activateAppId={api_key}/{handle}`; block `...?template={t}&addAppBlockId={api_key}/{handle}&target=newAppsSection`. `api_key` is the app's client ID (`SHOPIFY_API_KEY`) and `handle` is the Liquid file name. Handles come from `shopify.app.extensions()` at runtime, with `tradepass-embed` and `application-form` as fallbacks.
- ✅ Save bar: shopify.dev says `<form data-save-bar>` doesn't see React state changes, and not to mix it with `shopify.saveBar` calls. The form builder keeps its state in React, so it uses App Bridge React `<SaveBar open discardConfirmation>`. In-app navigation is blocked with React Router `useBlocker`, which calls `shopify.saveBar.leaveConfirmation()`.
- ✅ Resource picker: `shopify.resourcePicker({ type: 'collection' | 'product', multiple, action, selectionIds })` resolves to the selection, or `undefined` on cancel.
- ✅ `shopify.app.extensions()`: statuses are lowercase (`active` / `available` / `unavailable`). Embeds have target `head`/`body`, blocks `section`. Only the published theme is checked, so the page has "Check again".
- ✅ `shopLocales { locale primary published }` (read_locales). `nodes(ids:)` with `... on Collection { title }` / `... on Product { title }` for the titles of chosen scope items.

**Differences from the spec, and risks**
- ⚠️ React 18 didn't attach `onChange` to custom elements and wrote `false` booleans as the string `"false"` on Polaris web components. `app/components/form-builder/wc.tsx` works around it by setting properties and listening to native events. The app is now on **React 19** (D-013), which supports custom elements properly.

## Area: Certificates (P4, P6) — the email parts were removed in D-091

**Confirmed**
- ✅ `companyLocationTaxSettingsUpdate(companyLocationId!, exemptionsToRemove: [TaxExemption!], …)` returns `companyLocation`, `userErrors { field message }`. Needs `write_companies` (or `write_customers`) and B2B. Not deprecated.
- ✅ `GenericFile { url mimeType fileStatus … }` and `MediaImage { mimeType image { url } }`, both read through `node(id:)`. Needs `read_files` or another qualifying read scope (`read_products`, covered by `write_products`).
- ✅ `CompanyContact { locale company { name } customer: Customer! }` and `Customer { firstName locale defaultEmailAddress { emailAddress } }`.
- ✅ App Bridge Save Bar: `<form data-save-bar data-discard-confirmation>`. Save fires `submit`, Discard fires `reset`. `shopify.saveBar.leaveConfirmation()` is called before programmatic navigation (the language switcher uses it).
- The renewal link is `https://{shop}/apps/tradepass/renew/{token}?lang=xx`, which maps to `/proxy/renew/:token`. The signature is checked with `verifyProxyRequest`.

**Differences from the spec, and risks**
- 🗑️ Brevo (removed, D-091): Brevo no longer sends from free addresses (Gmail etc.) on any plan, so it would need a purchased, authenticated domain.
- ⚠️ `Customer.email` is deprecated, so we use `defaultEmailAddress.emailAddress`.

## Area: Automation, Flow, wholesale-only lock, import (P5 Function, P7)

**Confirmed**
- ✅ Validation Function target `cart.validations.generate.run`. JS entry `cartValidationsGenerateRun(input)` returns `{ operations: [{ validationAdd: { errors: [{ message, target }] } }] }`. We use `target: "$.cart"`. (Answers the 🔲 output schema in "Cart & checkout validation Function".)
- ✅ Input fields used: `buyerJourney.step` (`CART_INTERACTION | CHECKOUT_INTERACTION | CHECKOUT_COMPLETION`), `cart.buyerIdentity.purchasingCompany { company { id } }`, `cart.buyerIdentity.customer.hasAnyTag(tags:)`, `cart.lines[].merchandise` (`ProductVariant | CustomProduct`) → `ProductVariant.product.isGiftCard`, `localization.language.isoCode` (e.g. `PT_BR`), `validation.metafield(namespace, key) { jsonValue }`.
- ✅ Input query variables: per target `input_variables = { namespace, key }` in the TOML (the extension-level `[extensions.input.variables]` is deprecated). The metafield goes on the function owner (the Validation), JSON only. A missing key is `null`, and a null non-null variable fails the run, so `lock_vars` always holds `exemptTags` (possibly `[]`). List variables are capped at 100 items, so we keep at most 100 tags.
- ✅ Function TOML: `api_version = "2026-10"`, `[[extensions.targeting]] target / input_query / export / input_variables`, `[extensions.build] path`. Limits: 128 kB input, 20 kB output, 11M instructions.
- ✅ Where it runs: B2B, cart, checkout, draft orders (admin and checkout), Shopify admin, storefront and accelerated checkout. It does **not** run on the Create Order API, order edits, **POS** or subscriptions.
- ✅ `validationCreate(validation: ValidationCreateInput!)` with `functionHandle`, `enable`, `blockOnFailure`, `metafields`, `title`. `validationUpdate(id:, validation: ValidationUpdateInput!)` takes the same fields minus the handle. Payload: `validation` plus `userErrors: [ValidationUserError]` (`field`, `message`, `code`). **Scope `write_validations`.** `validations(first:)` → `Validation { id enabled blockOnFailure title metafield shopifyFunction { id handle appKey apiType } }`.
- ✅ Uninstall: Shopify removes an app's Functions on uninstall, and app-owned (`$app:`) metafields are removed too (staff reply on community.shopify.dev). So the checkout lock stops on uninstall and leaves nothing behind. 🔲 Confirm on a dev store.
- ✅ `flowTriggerReceive(handle: String, payload: JSON)` → `userErrors { field message }`. `body` is deprecated. No scope is named.
- ✅ `flow_trigger` TOML: `[[extensions]] name, type = "flow_trigger", handle, description` plus `[settings] [[settings.fields]] type/key`. Reference types such as `company_reference` take no `key`; their payload key is `company_id`, sent as a number. Custom types: `boolean, email, single_line_text_field, number_decimal, url, schema.*`. Keys use letters and spaces only, in sentence case, sent verbatim. **The payload must be under 50,000 bytes**, keys included, or no workflow runs. (Answers the 🔲 in "Flow".)
- ✅ `flow_action` TOML: `type = "flow_action"`, `runtime_url` (absolute https or a relative `/path`; ours is `/flow/approve`), fields with `type/key/name/description/required`. Custom types: `boolean, email, single_line_text_field, multi_line_text_field, number_decimal, number_integer, url`.
- ✅ Flow action requests: POST with JSON `shop_id`, `shopify_domain`, `action_run_id` (for idempotency), `handle`, `properties`. Header `x-shopify-hmac-sha256` works like webhooks (base64 HMAC-SHA256 of the raw body with the app secret). Flow waits **10 s**. 200 = done; **202 = accepted, Flow retries** (with backoff, up to 36 h); 429 and 5xx are retried; any other 4xx is a final failure, and a `message` key is shown to the merchant.
- ✅ `customers(query:)` filters include `email` and `tag`. `companies(query:)` filters include `name` and `external_id`. `companyContactProfiles` is a list of CompanyContact.
- ✅ `TaxExemption` has 22 `CA_*` values (including `CA_NL_VPT_RESELLER_EXEMPTION` and `CA_SK_VPT_RESELLER_EXEMPTION`). The importer validates against `TAX_EXEMPTIONS`.

**Differences from the spec, and risks**
- ⚠️ **No input field identifies an admin draft order or staff.** `buyerJourney` describes the buyer's step only, and `BuyerIdentity.shopUser` is a Shop app user, not staff. So a staff draft order for a retail customer is blocked unless the customer has an **exempt tag** (`settings.storefront.exemptCustomerTags`). Draft orders for B2B companies pass. Acceptance test 14 ("admin draft orders still work") holds only for B2B draft orders or tagged customers. See D-064.
- ⚠️ The Function input has no customer tag list, so exempt tags reach the Function through input query variables.
- ⚠️ The `validationCreate` prose mentions `functionId`, but the 2026-10 schema lists only `functionHandle`. We use `functionHandle`.
- ⚠️ `customersCount` has **no tag filter** (only created_at/id/updated_at), so the tag-conversion preview counts by paging customer IDs (max 5,000).
- ⚠️ `Customer.email` and `Customer.phone` are deprecated; we use `defaultEmailAddress { emailAddress }`.

## Sources

- https://shopify.dev/docs/api/admin-graphql/latest (2026-10) pages: marketCreate, marketUpdate, MarketCreateInput, MarketUpdateInput, MarketConditionsInput, MarketConditionsCompanyLocationsInput, MarketUserErrorCode, Market, MarketType, MarketConditions, companyCreate, companyLocationCreate, companyLocationTaxSettingsUpdate, companyContactSendWelcomeEmail, companyDelete, catalogCreate, catalogDelete, catalogsCount, CatalogType, CatalogContextInput, priceListCreate, PriceListAdjustmentType, publicationCreate, TaxExemption, ShopPlan, ShopFeatures, EntitlementsType, B2BType, MarketsType, MarketsB2BEntitlement, MarketsCatalogsEntitlement, shopLocales, stagedUploadsCreate, fileCreate, flowTriggerReceive
- https://shopify.dev/docs/api/usage/access-scopes
- https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies
- https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/app-api
- https://shopify.dev/docs/apps/build/app-home/polaris2.md
- https://shopify.dev/docs/api/functions/latest/cart-and-checkout-validation
- https://help.shopify.com/en/manual/your-account/languages (36 admin languages, matches the prompt's list)
- Area checks 2026-10-16/17: theme app extensions (configuration, app blocks, app-data metafields), Liquid customer object, cart-and-checkout-validation Function API and tutorial, validationCreate/validationUpdate, Flow trigger and action extension references, Brevo send-transac-email, App Bridge Save Bar / resourcePicker / app.extensions(), companyLocationAssignRoles, companyContactCreate, publicationUpdate, paymentTermsTemplates, BuyerExperienceConfigurationInput

## 2026-11-07 — verified with the Shopify dev toolkit (`@shopify/dev-mcp` 1.18.0, run locally)

The hosted `shopify-dev-mcp` server didn't connect and shopify.dev is blocked by the session's network policy,
so the toolkit was run over stdio. Its `validate` tool checks operations against the schemas it bundles
(offline): **every operation in `app/` and `extensions/` passes against Admin 2026-10**, and the checkout
Function input query passes against the cart-and-checkout-validation Function schema 2026-10. Doc search
(`search_docs_chunks`) needs shopify.dev and was unavailable; facts that only docs prose can confirm are under
"Needs a dev store" in CHECKLIST.md.

- ❌ `companyContactSendWelcomeEmail` — **not in any bundled Admin schema** (2026-01, -04, -07, -10, 2027-01,
  unstable). Kept behind a "skip if Shopify refuses the field" guard (DECISIONS D-092).
- ❌→✅ `Market.status` + `Catalog.status` in one selection conflict (different enum types): aliased.
- ⚠️→✅ `Shop.billingAddress` is deprecated; `Shop.shopAddress { countryCodeV2 }` used.
- ✅ `metafieldsSet(metafields: [MetafieldsSetInput!]!)` (max 25, atomic) and
  `metafieldsDelete(metafields: [MetafieldIdentifierInput!]!) { deletedMetafields { key namespace ownerId } }`;
  `Company` implements `HasMetafields`.
- ✅ Function input: `PurchasingCompany.company: Company!` with `metafield(namespace: String, key: String!)` —
  read as `paused: metafield(namespace: "$app:tradepass", key: "paused") { value }`.
- ✅ `CompanyLocationTaxSettings.taxExempt` ("whether the location is exempt from taxes") vs `taxExemptions`
  ("the list of tax exemptions applied"): D-093.
- ✅ `priceListDelete(id: ID!) { deletedId userErrors }` (REVIEW M5's open question).
- ✅ `tagsAdd(id: ID!, tags: [String!]!) { node userErrors }`, `tagsRemove(...)` (feature C19).
- ✅ `customerSendAccountInviteEmail` exists but only for **legacy** customer accounts; not used.
- ✅ Customer account UI extension target `customer-account.profile.block.render`; Session Token API with the
  `network_access` capability; server side `authenticate.public.customerAccount(request)` in
  `@shopify/shopify-app-react-router` 3.0.2 (type definitions in node_modules).
- Required scopes the validator reports for our queries are all covered by D-016's list.

A test (`tests/graphql-verified.test.ts`) pins a hash of every operation: a changed or new operation fails
until it has been validated again with the toolkit and its hash added.

## US sales tax facts (feature A1/A2), checked 2026-11-07 on official sites

| Fact | Source |
|---|---|
| Oregon has no general sales, use or transaction tax | Oregon DOR, https://www.oregon.gov/dor/programs/businesses/pages/sales-tax.aspx |
| Delaware has no state or local sales tax (gross receipts tax on sellers instead) | Delaware Division of Revenue, https://revenue.delaware.gov/business-tax-forms/doing-business-in-delaware/step-4-gross-receipts-taxes/ |
| Montana has no general sales tax | Montana DOR, https://revenue.mt.gov/taxes/general-sales-tax |
| New Hampshire has no general sales and use tax | NH DRA, https://www.revenue.nh.gov/faq/does-new-hampshire-have-sales-tax |
| Alaska has no statewide sales tax; local governments may levy one | Alaska DCRA, https://www.commerce.alaska.gov/web/dcra/officeofthestateassessor/alaskataxfacts.aspx |
| Streamlined Sales Tax: 23 full member states + Tennessee (associate) | SST Governing Board, https://www.streamlinedsalestax.org/ |
| MTC uniform resale certificate: states attach their own conditions; acceptance can change without notice; the seller decides | MTC, https://www.mtc.gov/resources/uniform-sales-use-tax-exemption-certificate/ and https://www.mtc.gov/resources/faq-uniform-sales-and-use-tax-certificate/ — so **no state list is hard-coded**, only a neutral hint and a link |
| Florida annual resale certificates expire on 31 December | Florida DOR, https://floridarevenue.com/taxes/taxesfees/Pages/annual_resale_certificate_sut.aspx |
| Georgia: most exemption certificates don't expire (GATE agricultural ones do) | Georgia DOR, https://dor.georgia.gov/taxes/sales-use-tax/sales-tax-id-verification-tool — not shown as a hint (not needed) |

Official permit lookups (link only unless marked live): CA CDTFA (https://services.cdtfa.ca.gov/m/svs/AboutSales.aspx),
TX Comptroller taxpayer search (https://comptroller.texas.gov/taxes/sales/taxpayer-search.php; 11-digit taxpayer
number starting with 1 or 3, or 9-digit FEIN), FL DOR certificate verification (https://floridarevenue.com/taxes/certificates),
WA DOR reseller permit verification (https://dor.wa.gov/taxes-rates/retail-sales-tax/reseller-permits/how-verify-reseller-permits),
IL MyTax Illinois "Verify a Registered Business" (https://mytax.illinois.gov/), AZ AZTaxes license verification
(https://www.aztaxes.gov/Home/LicenseVerification), CO Revenue Online (https://www.colorado.gov/revenueonline), GA Sales
Tax ID verification tool (https://dor.georgia.gov/taxes/sales-use-tax/sales-tax-id-verification-tool), NC sales and use
tax number registries (https://www.ncdor.gov/sales-and-use-tax-number-registries), MA verify a sales tax certificate
(https://www.mass.gov/how-to/verify-a-sales-or-meals-food-beverage-tax-certificate). New York, Pennsylvania and Ohio:
no public lookup found on their sites, so no link. Other states: not researched yet (ROADMAP).

**Texas open data (live check, Starter like VIES).** Dataset "Active Sales Tax Permit Holders", Texas Comptroller,
`jrea-zgmq` on data.texas.gov (https://data.texas.gov/Government-and-Taxes/Active-Sales-Tax-Permit-Holders/jrea-zgmq),
Socrata API `https://data.texas.gov/resource/jrea-zgmq.json?taxpayer_number=<11 digits>&$limit=1`, no key
(optional free `SOCRATA_APP_TOKEN` header `X-App-Token`). ⚠️ The column API name `taxpayer_number` comes from the
dataset's CSV header ("Taxpayer Number") and published query examples; data.texas.gov is blocked from this
session, so **confirm one real query after deploy**. Any non-200, non-array or unexpected reply is "Couldn't check".
Searches found **no other state** publishing an active-permit dataset.

**Nonprofits.** IRS Tax Exempt Organization Search (https://www.irs.gov/charities-non-profits/tax-exempt-organization-search)
is a web search; the free bulk files (Pub. 78, EO BMF, https://www.irs.gov/charities-non-profits/tax-exempt-organization-search-bulk-data-downloads)
hold over a million organisations, too large for Neon's free 0.5 GB next to our data, so Tradepass links to the
search (with the EIN) instead of importing. There is no free public EIN verification; EINs are format-checked only.

## Offline check digits (feature E23)

Algorithms (published by the registries named in `app/lib/tax-checksums.js`) and the real numbers they were tested
against are in `tests/review-2026-11.test.ts`. India GSTIN (GSTN mod 36), Brazil CNPJ (Receita Federal), Swiss UID
(FSO mod 11), Norway organisation number (Brønnøysund mod 11), New Zealand IRD/GST (Inland Revenue two-weight mod 11)
and NZBN (GS1), Australia ABN (ABR), Chile RUT, Argentina CUIT, Italy, Poland, Portugal, Belgium, Denmark, Finland,
Germany and Croatia (ISO 7064 MOD 11,10), France (TVA key), Estonia, Luxembourg, Slovenia, Hungary, Sweden, Greece,
Slovakia, UK VAT (mod 97 / 9755), China USCC (GB 32100-2015), South Korea BRN, Russia INN, Türkiye TCKN, Israel,
Peru RUC, Thailand, Japan corporate number, Taiwan UBN (divisible-by-5 rule).

## Official registries added 2026-11-07 (E24, D-113)
The registry hosts are blocked by this build environment's network policy, so nothing below was called live; facts come from web searches of the official pages and are marked.
- **Norway, Enhetsregisteret** (Brønnøysundregistrene): `GET https://data.brreg.no/enhetsregisteret/api/enheter/{orgnr}`, JSON, no key. A removed entity answers **410 Gone** with `slettedato` (official API docs, data.brreg.no/enhetsregisteret/api/docs/index.html, as quoted in search results); unknown numbers 404. Fields used: `organisasjonsnummer`, `navn`, `konkurs`, `underAvvikling`, `underTvangsavviklingEllerTvangsopplosning`, `slettedato`, `registrertIMvaregisteret` (field names listed by the docs' filters and the Microsoft connector schema). Licence: NLOD 2.0 per data.norge.no (attribution: "Brønnøysundregistrene"). 🔲 Confirm the 200-response field names with one live call after deploy.
- **New Zealand, NZBN API v5** (MBIE): `GET https://api.business.govt.nz/gateway/nzbn/v5/entities/{nzbn}` with header `Ocp-Apim-Subscription-Key`. portal.api.business.govt.nz: "there is no fee for using this API"; subscriptions may be reviewed; sandbox and production keys differ. `entityName` per third-party clients; the status field name (`entityStatusDescription` / `entityStatusCode`) is **not confirmed**, so the parser treats a missing status as "unavailable". 🔲 Needs verification with a real key.
- **Switzerland, UID register**: public SOAP service `https://www.uid-wse.admin.ch/V5.0/PublicServices.svc`, namespace `http://www.uid.admin.ch/xmlns/uid-wse`, SOAPAction `…/IPublicServices/ValidateVatNumber` (from a published WSDL, V3.0). Federal Statistical Office: free, **20 requests per minute**, over the limit the caller is blocked for a while. Request element names couldn't be read from official docs here → not called; link `https://www.uid.admin.ch/` only.
- **Canada, CRA GST/HST Registry**: web form only ("Confirming a GST/HST account number", canada.ca; enter the first nine digits). Link only.
- Official lookup links per country: `app/lib/tax-registries.ts`.
