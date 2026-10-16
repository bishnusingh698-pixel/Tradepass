# API notes — what was checked against Shopify's docs

Checked on **2026-10-16** against Admin GraphQL **2026-10** (the version shopify.dev labels "latest"), the app template's `ApiVersion.October26`, and the linked shopify.dev pages. "✅" = confirmed on the docs page. "⚠️" = differs from the build prompt or carries a risk. "🔲" = not yet verified, check before the phase that uses it.

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
- ✅ **`companyContactSendWelcomeEmail(companyContactId: ID!, email: EmailInput)`** exists. So we use Shopify's own B2B welcome email, and our "You're approved" email is the fallback (DECISIONS D-005). The Flow template is optional.
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

## Access scopes (P1 set)

`write_companies`, `write_markets`, `write_products`, `read_locales`. Each is justified in DECISIONS D-007. Scopes added in later phases: `write_publications` (P2), `write_files` (P3), `read_orders` (P4/Home numbers), `write_customers` if linking existing customers needs it (P2, 🔲).

## Sources

- https://shopify.dev/docs/api/admin-graphql/latest (2026-10) pages: marketCreate, marketUpdate, MarketCreateInput, MarketUpdateInput, MarketConditionsInput, MarketConditionsCompanyLocationsInput, MarketUserErrorCode, Market, MarketType, MarketConditions, companyCreate, companyLocationCreate, companyLocationTaxSettingsUpdate, companyContactSendWelcomeEmail, companyDelete, catalogCreate, catalogDelete, catalogsCount, CatalogType, CatalogContextInput, priceListCreate, PriceListAdjustmentType, publicationCreate, TaxExemption, ShopPlan, ShopFeatures, EntitlementsType, B2BType, MarketsType, MarketsB2BEntitlement, MarketsCatalogsEntitlement, shopLocales, stagedUploadsCreate, fileCreate, flowTriggerReceive
- https://shopify.dev/docs/api/usage/access-scopes
- https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies
- https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/app-api
- https://shopify.dev/docs/apps/build/app-home/polaris2.md
- https://shopify.dev/docs/api/functions/latest/cart-and-checkout-validation
- https://help.shopify.com/en/manual/your-account/languages (36 admin languages, matches the prompt's list)
