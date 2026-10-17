# Tiers, approval engine, buyers — notes

## API notes (Admin GraphQL 2026-10, checked 2026-10-16 on shopify.dev)

✅ = confirmed on the docs page. ⚠️ = differs from the spec or carries a risk.

- ✅ `companyCreate(input: CompanyCreateInput!)`: `company: CompanyInput!` (`name`, `externalId`, `note`, `customerSince`), `companyLocation: CompanyLocationInput`, `companyContact: CompanyContactInput`. We create the company and its first location in one call; the contact is a separate step.
- ✅ `CompanyLocationInput`: `name`, `externalId`, `locale`, `phone`, `note`, `billingAddress`, `shippingAddress`, `billingSameAsShipping`, `buyerExperienceConfiguration`, `taxExempt`, `taxExemptions`, `taxRegistrationId`.
- ✅ `CompanyAddressInput`: `address1`, `address2`, `city`, `countryCode`, `zoneCode`, `zip`, `firstName`, `lastName`, `phone`, `recipient`. There's no `company` field, so our `Address.company` goes to `recipient`.
- ✅ `companyLocationCreate(companyId, input)`, `companyLocationDelete(companyLocationId) → deletedCompanyLocationId`, and `companyDelete(id) → deletedCompanyId`.
- ✅ `companyLocationUpdate(companyLocationId, input: CompanyLocationUpdateInput)`: `buyerExperienceConfiguration`, `externalId`, `locale`, `name`, `note`, `phone`.
- ✅ `BuyerExperienceConfigurationInput`: `paymentTermsTemplateId`, `checkoutToDraft` (the "orders go to you as drafts" option exists), `editableShippingAddress`, `deposit`. On read, `BuyerExperienceConfiguration` gives `paymentTermsTemplate { id }` and `checkoutToDraft`. `payNowOnly` is deprecated.
- ✅ `paymentTermsTemplates(paymentTermsType)` returns `[PaymentTermsTemplate!]!` with `id name translatedName paymentTermsType dueInDays description`. The docs don't name its scope.
- ✅ `companyLocationTaxSettingsUpdate(companyLocationId!, taxExempt, exemptionsToAssign, exemptionsToRemove, taxRegistrationId)`. We read it back from `CompanyLocation.taxSettings { taxExempt taxExemptions taxRegistrationId }`. ⚠️ The older `CompanyLocation.taxExemptions` / `taxRegistrationId` fields and `companyLocationAssign/RevokeTaxExemptions` and `companyLocationCreateTaxRegistration` are **deprecated**, so we don't use them.
- ✅ `TaxExemption`: 74 values (51 US, 22 CA, 1 EU). The full list is `TAX_EXEMPTIONS` in `approval.server.ts`, and a test checks it.
- ✅ `companyContactCreate(companyId, input: CompanyContactInput)` creates the contact *and* a customer. `CompanyContactInput` has `email firstName lastName locale phone title`. A duplicate email returns `BusinessCustomerErrorCode.TAKEN`, which we handle by linking the existing customer.
- ✅ `companyAssignCustomerAsContact(companyId, customerId)`, `companyAssignMainContact(companyId, companyContactId)`, and `companyContactRemoveFromCompany(companyContactId) → removedCompanyContactId` (removes the link and keeps the customer).
- ✅ `companyLocationAssignRoles(companyLocationId, rolesToAssign: [{ companyContactId, companyContactRoleId }])`. Roles come from `Company.contactRoles { id name }` and `Company.defaultRole`. ⚠️ The docs don't list default role names. We prefer `defaultRole`, then a role whose name contains "order" (Shopify's "Ordering only"), then the first role. Then we read `CompanyLocation.roleAssignments` back.
- ✅ `companyContactSendWelcomeEmail(companyContactId, email: EmailInput)`. The docs don't name its scope.
- ✅ `companies(query:)` supports `external_id:`. Retry uses it to find a company it created before its GID was saved.
- ✅ Markets: `marketCreate`, `marketUpdate(id, input { conditions { conditionsToAdd, conditionsToDelete }, catalogsToAdd, status, name })`, `marketDelete(id) → deletedId`, and `market(id) { conditions { companyLocationsCondition { companyLocations } } }` for read-back. The error codes are the ones in API_NOTES.md.
- ✅ Catalogs: `catalogCreate`, `catalogUpdate(id, input { title status priceListId publicationId context })`, `catalogDelete(id, deleteDependentResources: true)`, and `catalogContextUpdate(catalogId, contextsToAdd, contextsToRemove)` (Plus direct assignment). `MarketCatalog.markets(type: COMPANY_LOCATION)`, `CompanyLocationCatalog.companyLocations`, and `CompanyLocation.inCatalog(catalogId)` handle read-back on Plus.
- ✅ `priceListUpdate(id, input { parent { adjustment { type value } } })`, read back as `PriceList.parent.adjustment`.
- ✅ `publicationCreate(input { catalogId, defaultState: EMPTY | ALL_PRODUCTS, autoPublish })` and `publicationUpdate(id, input { publishablesToAdd, publishablesToRemove })`, max 50 per call, scope `write_publications`. ⚠️ The docs only promise products as publishables, so "Only these collections" publishes each collection's products (plus the collection IDs).
- ✅ `Company.ordersCount { count }` and `Company.totalSpent { amount currencyCode }` exist, so we read orders per buyer with one `nodes(ids:)` call per page. ⚠️ These most likely need `read_orders`; if the call fails we drop to a query without orders and the column shows "—".
- ⚠️ `customers(query: "email:…")` and `Customer.companyContactProfiles` need **`read_customers`**. The scopes page says company scopes don't cover Customer objects. Without it, "existing customer found by email" and the main-contact name don't show. Approval still works: a `TAKEN` email then fails with "link the existing customer instead".
- Admin deep links use `shopify://admin/companies/<id>` and `shopify://admin/markets/<id>` (App Bridge).

## Decisions

- **Proposed: add `read_customers` scope** (or `write_customers`). It's needed to find an existing customer by email in the approve modal, to show "already a contact of X", and to show the main contact's name in Buyers. Add it to `shopify.app.toml` / `SCOPES` and DECISIONS D-007. It needs protected customer data approval (email/name).
- **Proposed: `read_orders`** is already planned for P4. Buyers' order count and total use it, and are omitted when the scope isn't granted.
- Route file names follow the lead's instruction: `app.tiers._index.tsx` / `app.buyers._index.tsx` are the lists, `app.tiers.$id.tsx` / `app.buyers.$id.tsx` the detail pages. I deleted the old `app.tiers.tsx` / `app.buyers.tsx` placeholders.
- Assisted-mode pending assignments are `Job` rows with `type = "assisted_assignment"` and `state = "waiting"` (then `"done"`). The payload is `{ op, tierId, marketGid, locationGid, buyerId }`. Any generic Job processor must **ignore this type/state**. The Home card can call `pendingAssignments(shop)` from `tiers.server.ts`. The Tiers page also lists them with Open market / Check.
- Externally visible IDs: a company's `externalId` is `tradepass-<applicationId>` (imports use `tradepass-<source>-<key>`), and its location's is `…-loc`. The placeholder company's is `tradepass-placeholder`, named "Tradepass (do not delete)" (D-004). It's created only when Shopify answers `SPECIFIED_CONDITIONS_CANNOT_BE_EMPTY`.
- Step errors are stored already translated (in the admin language of whoever ran the step) in `approvalState.steps.<step>.error`, with the code in `.code`. The applications detail page shows `error` as is.
- `approveMany` returns `{ approved: string[]; skipped: { id, company, reason }[] }`, where `reason` is translated (`approval.skip.*`). After a `plan_limit` it skips the rest.
- The order is company → location → contact → terms_tax → tier → **finalize** (Buyer row, status approved, certificates linked, Flow trigger, activity) → email. A failed email doesn't undo the approval; the modal offers "Send email again".
- Undo deletes the company only if this approval created it. Otherwise it removes only the location and contact link it added. **It never deletes customers.** A customer created by `companyContactCreate` stays in Shopify as a normal customer after Undo. That's deliberate (spec: never delete customers), and the merchant may want to know.
- Approval uses `approvalsThisMonth` from `applications.server.ts` (the lead's). Quota is checked only on a fresh approval, not on Retry of one already started.
- Pause removes locations from the tier market and stores `Buyer.pausedTierId`. "Move to tier" on a paused buyer only changes `pausedTierId`.
- Tier delete is blocked while any buyer has `tierId` or `pausedTierId` equal to the tier. The Shopify market, catalog and price list are deleted only if `defaults.created` says Tradepass made them and the merchant ticks the box.
- Changing a "Only these collections" tier rebuilds the publication. Products added to those collections later are picked up the next time the tier is saved (said in the UI). A daily resync would cost API calls, so I left it out.
- Exemption labels: US and EU ones are translated (`approval.exemption.*`). The 22 Canadian ones show Shopify's enum name, humanised.

## Needs live verification

1. `marketCreate` with an empty `companyLocationIds` (we fall back to the placeholder), and the placeholder company created **without an address**.
2. Plus: `catalogCreate` with `context: { companyLocationIds: [] }`, and `catalogContextUpdate` adding and removing locations.
3. Whether `companyCreate` already gives the first contact a role on the location. We check and assign either way.
4. `companyContactSendWelcomeEmail` scope and the email the buyer actually receives.
5. Collections in `publicationUpdate.publishablesToAdd`, and that ALL_PRODUCTS + autoPublish shows every product.
6. `Company.ordersCount`/`totalSpent` scope.
7. The `shopify://admin/markets/<id>` deep link opens the B2B market. The admin path may be `/markets/<id>` or under settings.
8. The Contextual Save Bar with controlled Polaris fields in `<form data-save-bar>` (shows on edit, Discard resets).
9. A concurrent approval in the same shop, end to end (acceptance 8).
10. Prices change for the buyer after a move or pause (acceptance 15).

## Checklist

1. **Tiers → Create tier.** Name it "Retailer", choose 20% off, all products, Net 30, then **Create tier**. The list shows "20% off retail", 0 buyers, "Net 30", Active. In Shopify admin → Markets, a market "Tradepass Retailer" exists with a catalog.
2. Create two more tiers. Home and Tiers show "3 of 3 B2B catalogs used", and **Create tier** is greyed out with an explanation. If you made a catalog in Shopify yourself, it counts too.
3. Open a tier, change the discount to 25% and save. Then change it in Shopify admin to 30%. Within an hour (or after the hourly job), Tiers shows **Changed in Shopify**. Click **Fix**, and the tier is back to 25% and Active.
4. **Applications → open one → Approve.** Check that the tier, payment terms, address and "Tax exempt" are prefilled. For a Texas resale certificate, "US reseller exemption (TX)" is suggested. Click **Approve** and watch Company ✓ → Location ✓ → Contact ✓ → Terms and tax ✓ → Tier ✓ → Welcome email ✓.
5. In Shopify admin: the company, location (Net 30, tax exempt) and contact exist, and the location is in the Retailer market. Sign in as the buyer and see Retailer prices.
6. Approve an applicant whose email is already a customer. The modal offers "Link existing customer", and if they belong to another company it says so.
7. Simulated failure: in Shopify, delete the Retailer market, then approve someone to Retailer. The Tier step shows a plain-language error. Click **Fix** on Tiers, then **Retry**, and it finishes with no second company. On another one, click **Undo what was created**, and the company disappears from Shopify.
8. **Buyers:** filter by tier, select two, **Move to tier → Distributor → Move**. Their tier changes, and Shopify shows them in the Distributor market.
9. Buyer page → **Pause access → Pause**. The buyer sees retail prices. **Resume access** restores the tier. Tier history lists both.
10. Free plan (non-dev store): after 10 approvals this month, the 11th shows "You've used this month's free approvals" with **See plans**.
11. Settings: switch tier assignment to "assisted", then approve someone. Tiers shows "1 tier assignment needs your action". **Open market in Shopify**, add the location, then **Check** marks it done.
12. Try deleting a tier with buyers: it's blocked with "View buyers". Delete an empty tier with "Also delete…" ticked, and the market and catalog are gone from Shopify.
