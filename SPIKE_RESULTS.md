# Phase 0 spike results

**Status: still pending (2026-10-17).** It needs a development store on a non-Plus plan with B2B turned on. The code is ready, and the rest of the app is built so that either outcome works (automatic tier assignment, or assisted assignment).

## How to run it
1. Deploy the app and install it on a non-Plus development store (README §2–4). The test refuses to run on stores that aren't development stores.
2. In the app, open **Help** → **B2B compatibility test** (`/app/diagnostics`) → **Run test**. Wait up to a minute.
3. Click **Copy results** and paste the JSON under "Results" below; fill in the table.
4. Do the manual storefront price check (CHECKLIST.md §0, step 0.3).
5. Click **Remove test data**.
6. Write the decision below. If moves don't work, the agent switches tier assignment to **Assisted** (a stored setting; there is no button for it yet).

## What it tests
Open the app → Help → **B2B compatibility test** → **Run test**. The test refuses to run on stores that aren't development stores. It then:

1. Reads the plan and B2B entitlements (`shop.plan`, `shop.entitlements`, `shop.features.directConnectionCatalogAssignmentEnabled`).
2. `companyCreate`: creates a test company with location and contact, plus a placeholder company.
3. `priceListCreate` −10% and −20% (`PERCENTAGE_DECREASE`).
4. `marketCreate` with an **empty** company-location condition, to see whether an empty B2B market is allowed (see D-004).
5. `marketCreate` A and B, seeded with the placeholder location, then `catalogCreate` one catalog per market with the price lists.
6. Adds the test location to A (`marketUpdate … conditionsToAdd`) and reads it back. Moves it to B (`conditionsToDelete` on A, `conditionsToAdd` on B) and reads both back.
7. Creates two more locations and adds both to A **at the same moment**, then reads back to see whether both landed.
8. Keeps creating B2B markets and catalogs until Shopify refuses, and records the exact error.
9. **Manual:** sign in on the storefront as the test contact and check prices after each move (CHECKLIST.md §Spike).

Every call is recorded with its variables, full response and milliseconds. **Copy results** puts the full JSON on the clipboard to paste below. **Remove test data** deletes the catalogs (with their price lists), markets and companies.

## Results
_(paste the copied JSON summary here, then fill in the table)_

| Question | Answer |
|---|---|
| Plan / entitlements | |
| Empty B2B market allowed? | |
| Add location to market works? | |
| Move between markets works? | |
| Concurrent adds both land? | |
| Exact catalog-limit error | |
| Storefront prices follow the move? | |
| Typical latency per call | |

## Decision
_(Automatic tier assignment, or Assisted assignment, and why.)_

## Known risk before running
The `marketCreate` docs page says company-location markets are "currently only available in the dev preview". If `marketCreate` is refused on a normal dev store, the spike will show it. The fallback to test then is linking markets the merchant creates in admin and moving locations with `marketUpdate`.
