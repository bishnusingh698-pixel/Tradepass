Merged into API_NOTES / DECISIONS / CHECKLIST on 2026-10-17

# Automation, Flow, wholesale-only lock, import — area notes

Covers spec P5 (validation Function) and P7: §I mode 3, §K, §L, the wholesale-only edge cases, and acceptance tests 14, 17, 18 and 19.

## Files

| Path | What |
|---|---|
| `extensions/tradepass-checkout-lock/` | Cart and checkout validation Function (JS). The logic is a pure function in `src/cart_validations_generate_run.js`. |
| `app/lib/checkout-lock.server.ts` | `ensureCheckoutLock`: creates, enables or disables the Validation and writes its config metafields. |
| `extensions/tradepass-flow-*` | 5 `flow_trigger` extensions and 1 `flow_action` (`tradepass-flow-approve-application`). |
| `app/lib/flow.server.ts` | `emitFlowTrigger`, `buildFlowPayload`, `verifyFlowHmac`, `handleFlowApprove`. |
| `app/routes/flow.approve.tsx` | Flow action endpoint (`POST /flow/approve`), HMAC-verified. |
| `app/lib/rules.ts` / `rules.server.ts` | Rule types and matching (pure) / `evaluateRules`, `reverseAutoDecision`, rule storage. |
| `app/lib/import.server.ts`, `app/lib/tasks/imports.ts` | CSV parse/map/validate, duplicate checks, batched resumable processing, tag conversion, hourly pickup. |
| `app/routes/app.automation.tsx` | Rules editor (SaveBar), Pause all, daily limit, automatic decisions with Reverse, Flow section. |
| `app/routes/app.import._index.tsx`, `app.import.$id.tsx`, `app.import.template.tsx`, `app.import.$id.errors.tsx` | Upload, tag conversion, mapping and dry run, progress, CSV template and error report. |

## API notes

Checked on 2026-10-16/17 against shopify.dev (Admin GraphQL 2026-10 = "latest", Functions 2026-10).

- ✅ **Validation Function target** `cart.validations.generate.run`. JS entry `cartValidationsGenerateRun(input)` returns `{ operations: [{ validationAdd: { errors: [{ message, target }] } }] }` (from the "create server-side validation function" tutorial). We use `target: "$.cart"`.
- ✅ **Input fields used**: `buyerJourney.step` (`CART_INTERACTION | CHECKOUT_INTERACTION | CHECKOUT_COMPLETION`), `cart.buyerIdentity.purchasingCompany { company { id } }`, `cart.buyerIdentity.customer.hasAnyTag(tags:)`, `cart.lines[].merchandise` (union `ProductVariant | CustomProduct`) → `ProductVariant.product.isGiftCard`, `localization.language.isoCode` (`LanguageCode` enum, e.g. `PT_BR`), `validation.metafield(namespace, key) { jsonValue }` (`Validation implements HasMetafields`). Customer has no tag list in Functions, so exempt tags go through **input query variables**.
- ✅ **Input query variables**: per target `input_variables = { namespace, key }` in the TOML (the extension-level `[extensions.input.variables]` is deprecated). The metafield goes on the **function owner (the Validation)**, JSON type only. A missing top-level key = `null`, and a null non-null variable fails the run, so `lock_vars` always holds `exemptTags` (possibly `[]`). List variables are capped at 100 items, so we trim to 100 tags.
- ✅ **Function TOML** `api_version = "2026-10"`, `[[extensions.targeting]] target / input_query / export / input_variables`, `[extensions.build] path`. Limits: 128 kB input, 20 kB output, 11M instructions.
- ✅ **Where it runs**: B2B, Cart, Checkout, Draft Order (Admin), Draft Order (Checkout), Shopify Admin, Storefront and accelerated checkout. It does **not** run on the Create Order API, Order Edit, **POS** or Subscriptions.
- ⚠️ **No input field identifies an admin draft order or staff context.** `buyerJourney` describes the buyer's step only. `BuyerIdentity.shopUser` is a "Shop User" (Shop app) and has nothing to do with staff. So staff draft orders for retail customers are blocked unless the customer has an **exempt tag** (`settings.storefront.exemptCustomerTags`). Draft orders for B2B companies pass (purchasingCompany is set). See Decisions.
- ✅ **`validationCreate(validation: ValidationCreateInput!)`** with `functionHandle`, `enable`, `blockOnFailure`, `metafields: [MetafieldInput!]`, `title`. **`validationUpdate(id:, validation: ValidationUpdateInput!)`** takes the same fields minus the handle. The payload holds `validation` plus `userErrors: [ValidationUserError]` (`field`, `message`, `code`). **Scope: `write_validations`.** `validations(first:)` → `Validation { id enabled blockOnFailure title metafield shopifyFunction { id handle appKey apiType } }`.
- ⚠️ The `validationCreate` prose mentions `functionId`, but the 2026-10 schema lists only `functionHandle`. We use `functionHandle`.
- ✅ **Uninstall**: Shopify removes an app's Functions on uninstall, and app-owned (`$app:`) metafields are cleaned up too (community.shopify.dev, staff reply). So the checkout lock stops on uninstall and no config is left behind. 🔲 Confirm on a dev store (see below).
- ✅ **`flowTriggerReceive(handle: String, payload: JSON)`** → `userErrors { field message }`. `body` is deprecated. No scope is named.
- ✅ **flow_trigger TOML**: `[[extensions]] name, type = "flow_trigger", handle, description` plus `[settings] [[settings.fields]] type/key`. Reference types `company_reference` and others don't take a `key`; their payload key is `company_id`, sent as a number. Custom types are `boolean, email, single_line_text_field, number_decimal, url, schema.*`. Keys use letters and spaces only, in sentence case, sent verbatim. **The payload must be under 50,000 bytes**, keys included, or no workflow runs.
- ✅ **flow_action TOML**: `type = "flow_action"`, `runtime_url` (absolute https or a relative `/path`), fields with `type/key/name/description/required`. Custom types are `boolean, email, single_line_text_field, multi_line_text_field, number_decimal, number_integer, url`.
- ✅ **Flow action requests**: a POST with JSON `shop_id`, `shopify_domain`, `action_run_id` (for idempotency), `handle`, `properties`. The header `x-shopify-hmac-sha256` works "the same as webhooks" (base64 HMAC-SHA256 of the raw body with the app secret). Flow waits **10 s**. Responses: 200 = done; **202 = accepted, Flow retries** (backoff, up to 36 h); 429 and 5xx are retried; any other 4xx is a final failure, and a `message` key is shown to the merchant.
- ✅ `customers(query:)` filters include `email` and `tag`. `companies(query:)` filters include `name` and `external_id`. `customersCount` has **no tag filter** (only created_at/id/updated_at), so the tag preview counts by paging ids (max 5,000). `Customer.email` and `Customer.phone` are deprecated, so we use `defaultEmailAddress { emailAddress }`. `companyContactProfiles` is a list of CompanyContact.
- ✅ `TaxExemption` has 22 `CA_*` values (including `CA_NL_VPT_RESELLER_EXEMPTION` and `CA_SK_VPT_RESELLER_EXEMPTION`). The importer validates against `TAX_EXEMPTIONS` from approval.server.ts.

## Decisions

- **A-1 Lock blocks at checkout, not at cart interaction — Decided.** Errors at `CART_INTERACTION` would make theme cart forms fail in odd ways. Mode 2 already hides Add to cart. Any other or unknown step is treated as checkout, so a wholesale-only store never silently opens to the public.
- **A-2 `blockOnFailure: false` — Proposed.** If the Function itself crashes or times out, checkout is *not* blocked. The alternative (`true`) means a Shopify-side Function failure blocks every buyer, B2B included. Merchant-facing: for the length of a Function outage, retail checkouts could get through. Bishnu to confirm.
- **A-3 Staff draft orders need an exempt tag — Proposed (merchant-facing).** Nothing in the Function input identifies admin draft orders, so a retail draft order is blocked unless the customer has an exempt tag. B2B draft orders work. The wholesale-only settings and Help must say this. POS and Create Order API orders are never checked (Shopify doesn't run the Function there), so POS keeps working.
- **A-4 Gift-card-only carts pass — Decided** (spec edge case). A cart with any non-gift-card line is blocked.
- **A-5 Messages**: the Function gets one message per published store language plus the primary language and English. Each comes from the merchant override (`settings.texts[locale]["automation.checkoutLock.message"]`), then our built-in translation, then the primary language, then English. The Function picks exact tag → base language → any regional variant → store default → `en` → built-in English. Re-run `ensureCheckoutLock` after editing texts (storefront sync does this).
- **A-6 Flow template "Send Shopify's B2B access email" not built — Decided.** `companyContactSendWelcomeEmail` exists (D-005), and approval already sends it. The Automation page says so.
- **A-7 Flow action answers within 8 s.** A longer approval keeps running in the background and the response is 202. Flow then retries, and the retry gets 200 once the application is approved. There's a per-application lock (`flow-approve:<id>`, 5 min). A failed step returns 422 (no retry, message shown in Flow). An unexpected error returns 500 (Flow retries, and the approval engine resumes idempotently).
- **A-8 Trigger field "Contact email" is `single_line_text_field`, not `email`.** Certificate triggers may not know an email, and an empty string could fail Flow's email validation.
- **A-9 Reversing an automatic decision — Proposed (merchant-facing).** An auto-rejection goes back to Pending (a sent email can't be recalled). A partial auto-approval is Undone. A **finished** auto-approval **pauses the buyer** (out of the tier, sees retail prices) and does not delete the company: `undoApproval` refuses finished approvals, and deleting a company that may already have orders is destructive. The merchant can resume the buyer from Buyers.
- **A-10 Empty rules never match**, so a rule with no conditions can't approve everyone. Rule order: all reject rules (by position), then approve rules. The first match decides.
- **A-11 Daily limit** counts today's (UTC) auto-approved applications. Two simultaneous submissions can overshoot it by one, which we accept.
- **A-12 Import row data lives only in `ImportRun.mapping` while the run is open.** It's cleared when the run finishes or is cancelled. The error report holds row numbers and codes only. Progress is saved every 10 rows. Rows after the last save are re-run on resume, which is safe because `createBuyerFromInput` is idempotent by externalId (company name + email). The open Import page drives the run in ~25 s steps. The hourly job picks up the rest. Runs pause (stay "running") while the shop isn't on Pro.
- **A-13 Import limits**: 2 MB and 5,000 rows per file. A company that already exists in Shopify is **skipped** by default, or "linked" (passed as `existingCompanyGid`) if chosen. An existing customer with the row's email becomes the contact. Phone numbers that don't look valid are dropped with a warning. US, CA and AU rows need a zone code.
- **A-14 Tag conversion** skips customers who already belong to a company. This also makes a re-run after an interruption safe. Customers without a default address (street, city, country) are reported, not converted. The company name is the default address's company, else the customer's display name.

## Schema / config changes requested

- `shopify.app.toml`: add **`write_validations`** to `scopes` (required by validationCreate/validationUpdate). Justify in D-007 as "Wholesale-only checkout lock (validation Function)".
- `package-lock.json` was updated by `npm install` for the new workspace `extensions/tradepass-checkout-lock` (dependency `@shopify/shopify_function@2.0.1`, which Shopify CLI needs to build JS Functions). package.json itself was not changed by me. Note: someone else's change in the tree moved React to 19, and `npx tsc` now reports `s-app-nav` missing in `app/routes/app.tsx` (not my file).
- No Prisma changes. ImportRun.mapping holds the run data, and TokenUse isn't needed because Flow idempotency uses the application status.
- **Protected customer data**: tag conversion and duplicate checks read customer name, email and address (Level 2), as approval already does.

## Needs live verification

1. Deploy the Function (`shopify app deploy`), switch Storefront to wholesale-only, and confirm `validationCreate` with `functionHandle: "tradepass-checkout-lock"` and `$app:tradepass` metafields succeeds. Check that the rule shows in Settings → Checkout → Checkout rules.
2. The Function reads `validation.metafield(namespace: "$app:tradepass", ...)` and `input_variables` with an `$app:` namespace on the Validation owner. Check the run log input in Partner Dashboard → Extensions → Function runs.
3. A retail checkout (direct /checkout link) is blocked with the translated message in at least `de` and `ar`. A B2B buyer checks out. A gift-card-only cart checks out.
4. Admin draft order for a retail customer: blocked unless tagged with an exempt tag. Check how Shopify shows the error in the draft-order screen. Draft order for a company location: works. POS sale: works.
5. Uninstall with wholesale-only on: the checkout rule disappears and retail checkout works again. Reinstall: turning wholesale-only on again creates a fresh Validation.
6. Flow: each trigger appears in Flow with the listed fields, and `company_id` resolves to the Company. Find the Liquid variable name Flow gives "Application ID" (expected `{{applicationId}}`; the action field description mentions it).
7. Flow action: HMAC header verifies with the app's API secret (client secret). The 202 then 200 retry behaviour works. The 4xx `message` shows in the run log.
8. `companies(query: "name:\"…\"")` matches exact names case-insensitively, and `customers(query: "email:\"…\" OR …")` returns up to 50 per batch.
9. The `s-drop-zone` `files` property gives the File, and the upload of a 200-row file works through the embedded app.

## Checklist

**Wholesale-only checkout lock (acceptance 14)**
1. Tradepass → Plans: be on Starter or a dev store.
2. Tradepass → Storefront → choose "Wholesale-only store" → Save.
3. Shopify admin → Settings → Checkout → Checkout rules: "Tradepass wholesale-only checkout" is listed and active.
4. In a private window, add a product to the cart and open `/checkout`. You see "This store sells to approved wholesale customers only. Log in or apply for an account." and can't pay.
5. Switch the storefront language to German (if published) and repeat: the message is in German.
6. Log in as an approved buyer and check out: it works.
7. Buy only a gift card while logged out: it works.
8. Tradepass → Storefront: add the exempt tag "staff". In the admin, tag a retail customer "staff", create a draft order for them and mark it as paid: it works. Without the tag it's blocked.
9. Switch back to "Show prices to everyone" → Save. Retail checkout works again, and the checkout rule shows as inactive.

**Automation rules (acceptance 17)**
1. Be on Pro (or a dev store). Tradepass → Automation → Add approval rule → Country is "US" and Business type is "salon" → Tier "Retailer" → Save (the Save bar appears; "Saved" toast).
2. Submit a US salon application from the storefront. Within seconds it shows as Approved in Applications, and Automation → Automatic decisions lists it.
3. Click Reverse → confirm. The buyer is paused (Buyers shows Paused).
4. Turn on "Pause all automation" → Save → submit another matching application. It stays Pending.
5. Set the daily limit to 0 → Save → turn Pause off → submit: it stays Pending, and the activity log shows "limit reached".
6. Add a rejection rule "Email domain is spam.test", submit with x@spam.test: it is Rejected automatically.

**Flow (acceptance 19)**
1. Install Shopify Flow. In Flow → Create workflow → Select a trigger → search "Wholesale application submitted".
2. Add the action "Approve wholesale application to tier". Set Application ID to the trigger's Application ID variable and Tier to "Retailer" → Turn on.
3. Submit an application. In Flow → Recent runs the run succeeds, and in Tradepass the application is Approved by "flow".
4. Make a second workflow on "Wholesale application approved" that sends an internal email with the Company name and Tier. Approve one: the email arrives with the right values.

**Import (acceptance 18)**
1. Tradepass → Import → "Download the CSV template". Fill in 200 rows (or use the test file from `tests/automation-import.test.ts`) → upload.
2. Check the column mapping (pre-filled) → choose "Tier for rows without one" → Check rows.
3. The dry run shows ready, errors, skipped and warnings. Download the error report: it lists row numbers and problems.
4. Click "Import N companies" → confirm. The progress bar moves.
5. Close the tab halfway, wait, then reopen Import → the run. It continues from where it stopped (or the hourly job finished it). No company is duplicated in Shopify → Customers → Companies.
6. Tag conversion: tag 3 customers "wholesale" (with default addresses) → Import → Customer tags "wholesale" → Count customers → Convert 3 customers → confirm. 3 companies appear in Shopify and in Tradepass → Buyers.
