# Roadmap: out of scope for v1

Not built in v1, by design:

- Request-a-quote workflow
- CSV upload into the quick order list
- Custom payment reminders beyond Shopify's own
- Sales-rep portal
- Nested account hierarchies
- ERP / accounting sync
- Deposits and partial payments (Plus-only natively)
- Customer-specific pricing beyond 3 tiers on non-Plus plans
- AI document reading / OCR of certificates
- Paid tax registries
- SMS notifications

Ideas noted during the build (not committed):
- Ukrainian (`uk`) once Shopify adds it to the admin; the locale structure is ready.
- Move to Polaris 2.0 web components when it leaves release candidate (D-002).
- Daily re-sync of "Only these collections" tiers (D-032).
- Translated labels for the 22 Canadian tax exemptions (D-033).
- A spam count in the admin (spam is currently discarded unseen, D-036).

## Deferred from the spec (not built yet)
Built on 2026-10-17 (D-076 to D-080): "Powered by Tradepass" on the Free-plan form, tax-number checks gated to Starter, activity export (Pro), server-side file limits, the Settings switch for assisted tier assignment.
- Playwright end-to-end tests against a dev store; measured accessibility and performance passes.

## Open risks
- **B2B markets via API on non-Plus stores.** The `marketCreate` docs say company-location markets are "dev preview". The spike settles it; the fallback is assisted assignment.
- **Empty B2B markets.** If Shopify refuses them, a visible "Tradepass (do not delete)" placeholder company is needed (D-004).
- **Retail draft orders in wholesale-only mode** are blocked unless the customer has an exempt tag (D-064); POS and Create Order API orders aren't checked by Shopify at all.
- **Function outage** lets retail checkouts through (`blockOnFailure: false`, D-063).
- **Certificate file links** are unguessable but public if someone has the exact link (D-006).
- **Price flash on injected content** (predictive search, quick add, cart drawer): a price can show for a moment before it hides (D-034). Unusual themes may need custom selectors.
- **Gated product list cap** of 1,000 for collection/product/tag scopes (D-035).
- **Theme locale files are capped at 15 KB.** English is 6 KB; long scripts (hi, th, zh, ja, ko) should fit, but if one doesn't, form help texts move into a metafield.
- **App proxy subpath** is assumed to be `/apps/tradepass`; a merchant who changes it breaks the form.
- **App proxy client IP**: if Shopify doesn't forward the visitor's IP, per-IP limits become per-Shopify-edge (per-email limits still apply).
- **VIES REST field names** were taken from client libraries, not the official swagger.
- **Brevo free plan**: 300 emails/day for all stores together; our caps are 25 per store and 250 in total, so busy days push emails to the next day.

## Needs live verification (from the area notes)
- Theme editor deep links, `app.extensions()` statuses and "Check again".
- Save Bar with Polaris fields, Discard, navigation blocking and `leaveConfirmation()`.
- Resource picker results; Polaris web components' `value`/`checked` properties and events.
- Preview iframes under the admin's CSP; App Bridge adding the session token to `fetch("/app/files/:id")` and the blob window not being blocked.
- `app.metafields.tradepass.config.value` in Liquid; `customer.b2b?` for a company contact on non-Plus; `| json` escaping; the `t` filter with placeholders.
- Staged upload (POST, `FILE`) → `fileCreate` → file opens for staff; app proxy forwarding multipart bodies up to ~5 MB, `?lang=`, and locale-prefixed storefront URLs.
- `marketCreate` with no locations; placeholder company without an address; Plus `catalogCreate` with empty context and `catalogContextUpdate`.
- Whether `companyCreate` gives the first contact a role; `companyContactSendWelcomeEmail` scope and the email received.
- Collections in `publicationUpdate`; ALL_PRODUCTS + autoPublish shows every product.
- `Company.ordersCount`/`totalSpent` scope; the `shopify://admin/markets/<id>` deep link.
- Concurrent approvals in one store (acceptance 8); prices changing after move or pause (acceptance 15).
- `validationCreate` with `functionHandle`, `$app:` metafields and input variables on the Validation; how draft-order errors appear; checkout rule removed on uninstall.
- Flow: triggers and fields in Flow, `company_id` resolving, the Application ID variable name, the action's HMAC with the client secret, 202-then-200 retries, 4xx messages.
- `companies(query: "name:…")` matching and `customers(query: "email:… OR …")` batches; 200-row upload through the embedded app.
- Brevo real send and RTL/font rendering in Gmail, Outlook and Apple Mail; `unauthenticated.admin(shop)` in jobs; `companyLocationTaxSettingsUpdate` removing an exemption.
- Gating on Dawn, Horizon and two other free themes; hourly gated-list refresh after tagging a product.
