# Code review — Tradepass (2026-11-01)

Scope: every file in `app/`, `extensions/`, `prisma/`, `scripts/`, `tests/` and the docs, starting from `main` at `79ec937`.
The earlier review on branch `ccr-a79ddd23-95guxy` (done on older code) was used only as a list of leads; each
lead was re-checked against current `main` (column "Lead" below; the branch was not merged).

Line numbers point at `79ec937` (the reviewed code). Severity: **critical** = data loss, money, security, a whole
flow broken, or a store wrongly opened/closed; **major** = a feature broken or wrong in a common case;
**minor** = edge cases, polish, wasted work. Status: ✅ fixed · ⚠️ not fixed (reason given).

The Shopify docs server (`shopify-dev-mcp`) failed to connect in this session, so no new Shopify field names were
looked up; everything relies on the names already verified in API_NOTES.md. The one exception is marked below.

## Baseline on `main` (before any change)

| Check | Result |
|---|---|
| `prisma migrate deploy` on an empty Postgres 16 | ✅ applies; `migrate diff` empty |
| `npm run lint` | ✅ clean |
| `npm run build` | ✅ (only React Router v8 future-flag notices and one empty route chunk) |
| `npm run typecheck` | ❌ `tests/audit-fixes.test.ts:300` — mocked `graphql` not assignable to the Admin client type |
| `vitest run` | ❌ 1 of 354 fails: `tests/audit-fixes.test.ts:210` "F7 monthly report" puts its decisions 2–3 days back, so it fails on the 1st and 2nd of every month (today is 1 November) |

Both test problems are fixed (the monthly-report test now decides "now"; the mock is cast).

## Part A — email removed (DECISIONS D-091)

Brevo can no longer send from free addresses on any plan, so email would need a purchased domain, which breaks
the zero-cost rule. Commit `faf84c4`.

**Removed**
- `app/lib/email/*` (queue, 25/250 daily caps, Brevo client, ICU rendering, templates, placeholders), `app/lib/tasks/emails.ts` (hourly send, daily/weekly digest), the `prune-email-log` job.
- The Notifications page (`/app/notifications`: email editor, preview, test emails, merchant alerts, quota), its nav item and tabs; the "Emails & automation" nav item is now "Automation".
- "Application received", "You're approved" (fallback), "Not approved", "More information needed", 30/7-day and expiry certificate reminder emails, new-application and info-received merchant alerts, daily and weekly digest, test emails.
- Bulk "Request certificate renewal" (buyers list) and the buyer-page renewal button and "renewal requests sent" line.
- Home's email-quota alert; email branding settings (logo, accent colour); `certificates.autoRenewal`; the `notifications`/`branding` settings blocks (old stored keys are ignored on read).
- Database (migration `20261101000000_remove_email`): `EmailLog` table, `Certificate.remindedAt`, `Shop.email` and `Shop.contactEmail` (only used as alert recipient / reply-to). The shop-facts query no longer reads the store's emails.
- GDPR: customers/redact, shop/redact and "Delete all data" no longer touch an email log (everything else they delete is unchanged).
- `BREVO_*` from `.env.example`, `render.yaml`, README; Brevo from PRIVACY.md sub-processors.
- The storefront line "We've sent you a confirmation email" in all 36 theme locales; `successEmail` option in the form script.
- Tests for deleted code (`email-queue`, `email-render`); an unused `EmptyPage` placeholder component.

**Replaced by**
| Was | Now |
|---|---|
| Our "You're approved" email / fallback | Shopify's own B2B welcome email only (`companyContactSendWelcomeEmail`). Kept in the approve dialog, automation rules, the Flow action, tag conversion/import, and **bulk approve now has its own switch** (it always sent before). A Shopify failure shows "The welcome email couldn't be sent. The buyer is approved; you can send it again." on the email step, with Retry. `customerSendAccountInviteEmail` is not used. |
| "More information needed" email | After **Create request**, a "Message for …" dialog with the message in the applicant's language (their message + the signed, single-use, 14-day link), **Copy message** and **Open in email** (mailto with address, subject, body). |
| "Not approved" email + "Email the applicant" box | The box is gone; the reason is now stored (`Application.rejectReason`) and the same dialog opens after rejecting. A rejected application keeps a **Message for the applicant** button, so bulk and automatic rejections can be messaged later too. |
| Renewal reminders and "Request renewal" | **Copy renewal link** on one certificate: a fresh signed, single-use, 60-day upload link inside the translated renewal message (expiring / expired / no-date variants). The daily job still refreshes statuses, fires the Flow triggers and applies "remove the exemption when expired". |
| Merchant alerts / digests | Pending work on Home and in the queue. Help ("How do I hear about new applications?") and the Automation page explain Flow's "Send internal email" with the "Wholesale application submitted" trigger, noting it only emails fixed staff addresses. |
| Email texts editor | Settings → Languages → Change texts → "Messages to applicants and buyers" (the same per-language override mechanism). |

Translations: the email texts were renamed `email.*` → `message.*` in all 36 catalogs (no translation lost); email-only
strings removed; 28 new and 24 reworded strings translated into all 35 other languages; listing descriptions in
36 languages now say approval uses Shopify's own B2B welcome email and claim no email features. Docs updated: README,
PRIVACY, LISTING_DRAFT, `docs/listing/*`, REVIEWER_NOTES, CHECKLIST, feature_list.json (`removed` status), AUDIT
(🗑️), DECISIONS (D-091; D-005, D-050–D-055, D-061 superseded), PLAN, API_NOTES, ROADMAP, progress, area notes.

Remaining mentions of "email" are intended: applicant/contact email addresses as data, Shopify's welcome email,
the merchant replying from their own email ("we review … and reply by email", "reply to this email" inside the
messages the merchant sends), Flow guidance, and the support contact.

New tests (`tests/email-removal.test.ts`, certificates tests): message language, fallbacks, reason/message lines,
RTL isolation, merchant overrides incl. broken ones, renewal text choice and date formatting, mailto encoding;
more-info and renewal links signed, single-use, expiring and replaced by a newer one; reject stores the reason;
the approval email step calls only Shopify's welcome email, skips when off, and a failure is retryable; a static
guard that no email provider, SMTP client, queue or other email-sending mutation exists; old settings load.

## Part B — bugs

### Critical

| # | File:line | Bug and root cause | Lead | Status |
|---|---|---|---|---|
| C1 | `app/lib/storefront-sync.server.ts:317`, every caller | A failed push of storefront settings to Shopify was never retried, although the pages say "Your storefront will update within an hour". Our DB already held the new mode, so turning wholesale-only **off** could leave retail customers locked out, and turning it **on** (or a reinstall) could leave a wholesale-only store open, indefinitely. | C3 | ✅ `syncStorefrontConfig` queues one `storefront_sync` job per shop on failure; the hourly run retries it for as long as the app is installed (never gives up); any later successful push clears it. |
| C2 | `app/lib/rules.server.ts:88` | Auto-approve rules approved applications flagged **duplicate**. The engine keys Shopify objects by application, so a second application from an approved company created a **second company**. | C7 | ✅ approve rules skip duplicates (`automation.skipped_duplicate`); reject rules still apply. |
| C3 | `app/lib/intake.server.ts:515`, `:458`, `:507` | The "more info" reply wrote `status: "pending"` unconditionally: if the merchant rejected (or started approving) after the page opened, the reply **reopened a decided application**. Also: a required consent field could be requested but the hosted page hides consent, so the applicant could **never submit**; and the original email was **deleted** from the answers whenever the email field was requested. | M7, m1 | ✅ guarded update (`needs_info` and no approval started, else "link used"); consent and email can't be requested (UI and server); original email kept. |
| C4 | `app/routes/app.plans.tsx:58` | Downgrading Pro → Starter switched every automation rule off **before** the merchant approved the charge; cancelling on Shopify's page left them on Pro with all rules off. Going to Free switched wholesale-only off before the cancel call. | M17 | ✅ nothing changes before Shopify confirms: `enforcePlanLimits` runs from `syncBilling` and the subscription webhook; Free cancels first, then applies. The wholesale-only confirmation is still asked up front. |
| C5 | `app/routes/app.applications.$id.approve.tsx:35` | The approve action trusted the posted JSON: unknown exemption codes made Shopify refuse the whole tax call, a missing `contact` crashed the run, an empty company name reached `companyCreate`, any string became a payment-terms or customer GID. Invalid JSON gave a 500. | M3 | ✅ `normalizeApproveInput` rebuilds the input from known fields/values; malformed input gets the plain "Add a billing address…" refusal. |
| C6 | `app/lib/approval.server.ts:629` | Retry replaced the stored input with whatever the dialog sent. Changing the tier, company name, addresses, contact or terms after those steps ran recorded the new values on the buyer while Shopify kept the old ones (location left in the old tier's market). | M2 | ✅ `mergeRetryInput` keeps the inputs of steps that already ran. |

### Major

| # | File:line | Bug and root cause | Lead | Status |
|---|---|---|---|---|
| M1 | `app/lib/approval.server.ts:389` | Tax step verification compared the registration id exactly; Shopify may store other spacing/case, so the step failed "Shopify didn't confirm" forever. | M4 | ✅ normalised compare. |
| M2 | `app/lib/approval.server.ts:819` | Bulk approve applied the chosen tier's terms but the suggested tier's tax default; and had no "Send welcome email" choice (always sent). | M11 | ✅ tax default follows the chosen tier; bulk approve has a welcome-email switch (existing translated labels). The approve dialog's tier picker also applies the tier's tax default unless the merchant set the switch. |
| M3 | `app/lib/flow.server.ts:186`, `app/lib/rules.server.ts:103` | A failed welcome email (buyer fully approved) made the Flow action answer 422 "step failed" and the automation log "failed". | M10 | ✅ only steps before the email count. |
| M4 | `app/routes/app.applications._index.tsx:124`, `app.buyers._index.tsx:131`, `app.applications.$id.tsx:245`, `app.import._index.tsx:125`, `app.import.$id.tsx:232` | "Export all" (applications, buyers), opening an applicant's document, the import template and the error report used plain links / new tabs. In the embedded admin these carry no session token and land on the login redirect: dead buttons. The exports also lived in UI loaders. | M5 | ✅ `app/components/download.ts` fetches through App Bridge (token added) and saves/opens a blob; exports are resource routes `/app/applications/export`, `/app/buyers/export`. |
| M5 | `app/lib/tiers.server.ts:465` | If `marketCreate` failed after `priceListCreate`, cleanup deleted only catalogs and markets, leaving a "Tradepass …" price list in the store on every failed attempt. | M16 | ✅ the price list is deleted when no catalog was made. ⚠️ `priceListDelete(id) { deletedId userErrors }` is not yet in API_NOTES (docs server down); failure is ignored, so the worst case is the old leak. Verify on a dev store. |
| M6 | `app/lib/certificates.server.ts:335` | In the daily certificate job one certificate's failure (no offline token, Shopify error) aborted the shop's whole pass, every day. The status was also saved **before** getting the token, so a failure lost that certificate's Flow trigger for good; triggers for applicant-only certificates always failed (no company) and carried no contact, country or tier. | M14 | ✅ each certificate isolated and logged; token fetched first, status change guarded so the trigger fires exactly once; triggers only for buyers and only on plans with Flow, with contact email, country and tier filled in. |
| M7 | `app/lib/approval.server.ts:895` | The hourly retry took the first 50 incomplete approvals; approvals that can never be retried automatically (merchant must fix, 3 retries used) stay "failed" forever, so after 50 of them new stuck approvals were never retried. | M1 (variant) | ✅ pages through all incomplete approvals, filters retryable ones, skips uninstalled shops. |
| M8 | `app/lib/rules.ts:61`, `app/lib/intake.server.ts` | The "Looks like spam" rule condition and the "Possible spam" filter depended on a `possible_spam` flag that nothing set. | M8 | ✅ intake flags submissions from an address that sent bot-like ones in the same hour. |
| M9 | `app/routes/app.certificates.tsx:193`, `app/lib/settings.ts` | The certificate settings (Expiring-soon window, "remove the exemption automatically") had **no UI**: "Change in Settings" was a dead link, and automatic exemption removal was unreachable. | new | ✅ Settings → Certificates (translated in all languages). |
| M10 | `app/lib/taxcheck.server.ts:144` | Each registry call had a 5 s timeout, but HMRC makes two calls in a row, so a UK submission could take 10 s+ and hit the app proxy timeout (the form then retries). | new | ✅ the whole check is capped at 6 s, then "Couldn't check". |
| M11 | `app/routes/app._index.tsx:20`, `app.help.tsx:26`, `app.setup.tsx:30`, `app/shopify.server.ts:40` | Home, Help (where merchants go when something is wrong) and Setup crashed with an error page whenever Shopify's facts query failed. The same failure in `afterAuth` failed the install, so a reinstalled shop stayed "uninstalled" and the app proxy refused its storefront form. | new | ✅ pages fall back to the stored facts; install still marks the shop installed, creates defaults and syncs. |
| M12 | `app/routes/proxy.renew.$token.tsx:147` | The renewal page refused files the browser sent with an empty type (common for PDFs), read the whole body before any size check, and a tab losing the single-use race left its upload in the merchant's Files. | m16 | ✅ type decided by content, body size checked first, losing upload deleted. |
| M13 | `app/lib/intake.server.ts:208`, `app/lib/certificates.server.ts:29`, certificates "Set expiry" | Impossible dates like 2027-02-31 were accepted (JS rolls them to March); "Set expiry" with one silently cleared the expiry. | m18 | ✅ `app/lib/dates.ts` round-trip check everywhere; "Set expiry" reports the error. |
| M14 | `app/components/storefront/model.ts:75` | Opening or closing a wholesale-only store was confirmed only in the browser; a save from an old tab or a script could open a wholesale-only store to the public. Invalid JSON gave a 500. | new | ✅ the server requires the confirmed mode for any change into or out of wholesale-only. |
| M15 | `app/routes/app.automation.tsx:65` | Rules were saved as posted (unknown kinds, conditions, actions) and bad JSON crashed the action. | m17 | ✅ `sanitizeRules`. |
| M16 | `app/routes/webhooks.app.subscriptions_update.tsx:25` | The webhook waited for a full storefront sync (several Shopify calls) before answering; past Shopify's 5 s limit the webhook is retried. | m21 | ✅ sync runs after the response (failures retried by C1); plan limits applied there too. |
| M17 | `app/routes/app.applications.$id.tsx:370` (+ reject modal, notes) | Reject, Ask for more info and Notes used their own fetchers, but only the page's fetcher showed toasts: no feedback, and refusals (already decided, approval running, busy) were silent. | M9 | ✅ each shows a success or error toast (part of the Part A rework). |

### Minor

| # | File:line | Bug and root cause | Lead | Status |
|---|---|---|---|---|
| m1 | `app/lib/applications.server.ts:51` | A malformed `from`/`to` date in the queue URL became an Invalid Date and crashed the page. | m2 | ✅ |
| m2 | `app/routes/app.applications.$id.tsx:242`, `:55` | Document expiry dates were paired with files by list position (wrong date next to a file) and shown a day early west of UTC; custom field labels were read from English only. | m3, m4 | ✅ matched by file; admin/primary/any language. |
| m3 | `app/routes/app.files.$id.tsx:33` | Forwarded the upstream `Content-Length` with a body `fetch` had already decompressed → cut-off or hanging downloads. | m6 | ✅ |
| m4 | `app/lib/import.server.ts:348`, `:442`, `app/routes/app.import._index.tsx:48`, `app/lib/approval.server.ts:843` | A CSV run could start from "draft" (finished with nothing imported); every 10 rows the run rewrote its whole row JSON (up to ~2 MB) to Neon; the upload was read fully before the 2 MB check; linking an existing company put the raw GID into an external ID. | m15, m9, m8, m10 | ✅ |
| m5 | `app/routes/webhooks.app.scopes_update.tsx:7` | Leftover `console.log`, crash on a missing payload. | m14 | ✅ |
| m6 | `app/routes/app.applications._index.tsx:358` | `countryLabel` read `document` during server render → hydration mismatch. | m5 | ✅ uses the admin locale. |
| m7 | `app/lib/home.server.ts:170` | 30-day "received" counted drafts (the monthly report didn't). | new | ✅ |
| m8 | `app/lib/applications.server.ts:316` | Notes were read-modify-write: two staff adding notes at once lost one. | new | ✅ single-statement append. |
| m9 | `app/routes/app.applications._index.tsx:204` | Bulk buttons stayed active while a bulk approve ran. | m7 | ✅ |
| m10 | `app/routes/app.form._index.tsx:38` | Creating a form didn't push forms to the storefront. | C2 (part) | ✅ |
| m11 | `app/lib/spam.server.ts:50`, renewal page | Rate-limit `upsert` raced: two simultaneous first submissions from one address could fail one with a unique-constraint error (500). | new | ✅ atomic `INSERT … ON CONFLICT`. |
| m12 | `app/lib/certificates.server.ts:290`, `app/lib/jobs.server.ts:108` | A renewal upload replaced the certificate's file without tracking the old one, and retention only deleted files listed as application files, so applicant documents could stay in the merchant's Files after redact/retention. | M13 (variant) | ✅ old file stays listed under the application; retention also deletes the application's certificate files. |
| m13 | `app/lib/buyers.server.ts:138` | Unknown error codes (e.g. Prisma `P2025`) showed as raw translation keys. | m11 | ✅ |
| m14 | `app/routes/app.help.tsx:57` | Turning storefront debug on/off threw a server error when the push failed. | m20 | ✅ |
| m15 | `tests/audit-fixes.test.ts:210`, `:300` | Date-dependent test failure and typecheck error on `main`. | — | ✅ |

### Leads from the earlier review already fixed on `main`
C1 (store profile), C2 (default form + sync on install), C5 (lock TTLs), C6 (uninstall resets plan), C4
(reject/needs-info under the approval lock, guarded), M6 (rules after the response), M12 (catalog entitlement),
M13 (redact deletes files), m19 (needs-info vs. stale attempt — `approvalStatus` guard), M15 (email double send —
moot after Part A), m13 (landing page text).

### Not fixed (and why)

| # | Where | Issue | Why not |
|---|---|---|---|
| N1 | `extensions/tradepass-checkout-lock` | A **paused** buyer still checks out in a wholesale-only store: the Function lets any cart with a purchasing company through, and pausing only removes the location from the tier's market. | Needs a company-level marker the Function can read (e.g. an app metafield on the company in the Function input). The field names can't be verified without the Shopify docs, which were unreachable. Prices already revert to retail while paused. |
| N2 | `app/lib/spam.server.ts` `clientIp` | Left-most `X-Forwarded-For` can be spoofed to dodge the per-IP limit (per-email limit, honeypot, timing and the per-store hourly cap still apply). | The safe hop depends on the real proxy chain (Shopify proxy, Render); check headers on the live deploy, then pick the position. |
| N3 | `app/lib/rules.server.ts` | Two applications arriving at the same second can both pass the daily auto-approval limit. | One extra approval at worst; a lock would serialise all of a shop's background follow-ups. Same trade-off as AUDIT B17. |
| N4 | `app/routes/proxy.upload.tsx` | A chunked upload without `Content-Length` is read before the 5 MB check. | Shopify's app proxy forwards a length for browser uploads; capping a streamed multipart body needs a custom parser. |
| N5 | `shop/redact` | A later reinstall gets a fresh 14-day trial. | Keeping a trial record would keep shop data after the mandatory redaction; product decision. |
| N6 | Shopify behaviour | Error codes the code relies on, `priceListDelete`, B2B markets below Plus, `companyContactSendWelcomeEmail` scope, clipboard/mailto inside the admin iframe. | Need a dev store (SPIKE_RESULTS.md, CHECKLIST.md). |

## Verification
- After each group: `npm run typecheck`, `npm run lint`, `vitest run`, `npm run build` all pass.
- `prisma migrate deploy` on an empty database applies both migrations; `migrate diff` against the schema is empty.
- `node scripts/i18n-check.mjs` passes for all 35 non-English languages; i18n tests pass.
- Regression tests: `tests/review-fixes.test.ts`, additions in `tests/automation-rules.test.ts`, `tests/tiers-approval.test.ts`, `tests/form-admin-storefront.test.ts`, `tests/email-removal.test.ts`.
