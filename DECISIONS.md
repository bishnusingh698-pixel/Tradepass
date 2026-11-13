# Decisions

Each entry gives the decision, why, and its status. **Proposed** entries change scope, cost, billing, data handling or merchant-facing behaviour, so they wait for Bishnu's OK. Some Proposed items are already built the proposed way so they can be tested; if you say no, they get changed. Entries D-021 onwards come from the per-area notes in `docs/notes/` (merged 2026-10-17).

## D-001 Start from Shopify's React Router app template — Decided
Cloned `Shopify/shopify-app-template-react-router` (HEAD on 2026-10-16), which uses `@shopify/shopify-app-react-router` 3.0.x, React Router 7.18, Admin API `2026-10`, Prisma 6 and Polaris web components. Template-repo files (CI for the template itself, CLA bot, editor configs, Dockerfile) were removed. We don't use Docker because Render runs Node natively.

## D-002 Polaris web components 1.x, not the 2.0 RC — Decided
Polaris 2.0 for App Home is still a release candidate. Built for Shopify review shouldn't depend on an RC. The template's default script serves 1.x. Moving to 2.0 later means changing `polarisUrl` in two places plus the types package, and needs no component changes.

## D-003 Postgres from day one (Neon), no SQLite — Decided
Production is Neon Postgres, so dev and tests use Postgres too (`DATABASE_URL` pooled, `DIRECT_DATABASE_URL` for migrations). This avoids SQLite/Postgres drift such as arrays, JSON and dates.

## D-004 Placeholder company location per tier market — Proposed (fallback built, waits on the spike)
The API lists `SPECIFIED_CONDITIONS_CANNOT_BE_EMPTY`, which suggests a B2B market can't be empty. The code handles both answers. It first tries to create a tier's market with no locations. Only if Shopify refuses with that error does Tradepass create one hidden placeholder location under a company named "Tradepass (do not delete)" (external ID `tradepass-placeholder`) and keep it in each tier market. That company would appear in the merchant's Companies list. The spike (SPIKE_RESULTS.md, not run yet) will show which case applies. **If the placeholder turns out to be needed, it is visible to merchants, so it needs your OK.** The alternative is to create a market only when its first buyer is approved, but then a tier can't exist before it has buyers.

## D-005 Use Shopify's own B2B welcome email — Decided (updated by D-091)
`companyContactSendWelcomeEmail` exists in 2026-10, so "Send welcome email" calls it. Since D-091 it is the only welcome email: there is no Tradepass fallback, and a failure shows on the approval's email step with Retry.

## D-006 Certificate files: admin-only viewing through the app — Proposed (built, residual risk needs your OK)
Files go to the merchant's Shopify Files, as required. A Shopify `GenericFile` URL is a public CDN link, so "opens only for staff" can't be guaranteed by Shopify alone. What's built: uploads get random 128-bit file names; the link is never shown on the storefront or in emails; the admin opens a file through `/app/files/:id`, which looks the file up by id **and** the signed-in store, reads it through that store's Admin API and streams it with `nosniff`, a sandbox CSP and `no-store`. The admin page fetches it with the App Bridge session token and opens it as a blob, so the CDN link never reaches the browser. **Residual risk:** anyone who already has the exact CDN link can open it. Storing files ourselves would break the zero-cost and no-files-on-our-server rules. Recommended: accept this; PRIVACY.md says so.

## D-007 Access scopes (minimal, added per phase) — Decided
| Scope | Why | Phase |
|---|---|---|
| `write_companies` | Create companies, locations, contacts and tax settings on approval. | P1 (spike), P2 |
| `write_markets` | Create B2B markets for tiers and move company locations between them. | P1 (spike), P2 |
| `write_products` | `catalogCreate` / `priceListCreate` for tier pricing. | P1 (spike), P2 |
| `read_locales` | Read the store's published languages and primary language. | P1 |
| `write_publications` | Restrict a tier's catalog to chosen collections. | P2 |
| `write_files` | Upload certificates into the merchant's Shopify Files. | P3 |
| `read_orders` | Home: orders placed by Tradepass buyers (last 60 days only); Buyers: order count and total. | P4 |
| `write_customers` | Find an existing customer by email, link them as a contact, read contact names, tag conversion. | P2 |
| `write_validations` | Wholesale-only checkout lock (validation Function). | P5 |
Every write scope implies its read scope. Final list and reasons: D-016.

## D-008 Admin language travels in the URL — Decided
Shopify sends `locale` on the first embedded load. Tradepass keeps `?locale=` on its own nav links and falls back to Accept-Language, then the store's primary language, then English. Only the active language's strings are sent to the browser, which keeps the admin's load time (LCP) small.

## D-009 Uninstall keeps data for 48 hours — Decided
`app/uninstalled` deletes sessions and marks the shop uninstalled. All data is deleted when `shop/redact` arrives (Shopify sends it 48 h later). A quick reinstall restores tiers and settings, and defaults are never duplicated (`ensureDefaults` is create-if-missing).

## D-010 Data retention defaults (within the prompt's settings) — Decided
Rejected or withdrawn applications are deleted after 12 months (merchant setting). The activity log is pruned after 24 months, and sent-email log rows after 90 days. These keep Neon well under 0.5 GB (see PLAN.md §Capacity).

## D-011 Translation of example tag names — Decided
Translators localised the illustrative "wholesale" tag in the Import empty state (for example Danish "engros", Russian «опт»). Merchants type their real tag themselves, so this is only an example. Flagged in TRANSLATION_REVIEW.md.

## D-012 Repository — Decided
Code lives at https://github.com/bishnusingh698-pixel/tradepass (branch `main`).

## D-013 Upgraded to React 19 — Decided
React 18 didn't pass `onChange` or boolean props to Polaris web components correctly (a `false` became the string `"false"`, so fields could show as disabled). React 19 supports custom elements properly. All tests and the production build pass on React 19.

## D-014 Diagnostic info shows the theme ID, not the theme name or version — Proposed
Help → "Copy diagnostic info" includes the published theme's ID (from `app.extensions()`). The spec asks for the theme name and version, but reading those needs the `read_themes` scope, which we avoid to keep scopes minimal. Support can still find the theme from its ID.

## D-015 Downgrading below Starter while wholesale-only mode is on — Decided (follows the spec)
On the Plans page the merchant must tick a confirmation before the downgrade goes through, and the store then moves to "Hide prices", never fully open. If Shopify cancels the plan outside the app (the `app_subscriptions/update` webhook), wholesale-only stays on and the store stays closed; the merchant decides on the Storefront page. A shop that is already wholesale-only can keep that mode after losing Starter, but turning it on again needs Starter. Both directions show a confirmation.

## D-016 Access scopes (final) — Decided
Final list: `write_companies, write_customers, write_markets, write_products, write_publications, write_files, write_validations, read_orders, read_locales`. `write_validations` was added for the checkout lock. `read_customers` is **not** added, because `write_customers` already includes read access (this settles the tiers note that proposed it). Protected customer data access (name, email, address; phone if the form asks for it) must be requested in the Partner Dashboard. It's needed for finding existing customers by email, contact names, `/proxy/prefill` and tag conversion. **This is a setup step for the owner** (README → Shopify Partner app setup).

## D-017 Free plan: auto-approve rules are paused on downgrade — Decided (per the spec's "downgrade lists what turns off")
Moving to a plan without automation rules switches every enabled rule off and the downgrade screen lists how many. Rules aren't deleted. After upgrading again the merchant switches them back on in Automation.

## D-018 Where merchants edit texts — Decided
Emails and the hosted pages (more-info update, certificate renewal) are edited in Settings → Languages. Storefront texts (gate message, buttons, banner, checkout-lock message) are edited on the Storefront page, stored under the theme extension's own keys (`gate.message`, `checkout.message`, …).

## D-019 Trial — Decided
The 14-day trial is given once per store, counted from the first trial start (`Shop.trialStartedAt`). Switching between Starter and Pro keeps counting from that date; it never restarts.

## D-020 "Delete all Tradepass data" — Decided
Settings → Danger zone (type the store name) deletes our rows for the store but keeps the Shop row, the plan and the sessions, so the app stays installed and billing is untouched. Settings go back to defaults. Shopify companies, markets, catalogs and files are the merchant's and stay.

## D-021 Buyers' order count and total use `read_orders` — Decided
The scope was already in D-007. If Shopify refuses the orders fields, the Buyers list falls back to a query without them and shows "—".

## D-022 Route names for list and detail pages — Decided
`app.tiers._index.tsx` / `app.buyers._index.tsx` are the lists, `app.tiers.$id.tsx` / `app.buyers.$id.tsx` the detail pages. Code structure only.

## D-023 Assisted-mode assignments are stored as Job rows — Decided
`type = "assisted_assignment"`, `state = "waiting"` then `"done"`, payload `{ op, tierId, marketGid, locationGid, buyerId }`. Generic job processing ignores them. Home and Tiers list them with "Open market" and "Check".

## D-024 External IDs on Shopify objects — Decided
A company's `externalId` is `tradepass-<applicationId>` (imports: `tradepass-<source>-<key>`), its location's is `…-loc`. Retry uses these to find objects created before their IDs were saved. The placeholder company is described in D-004.

## D-025 Approval step errors are stored already translated — Decided
Stored in the admin language of whoever ran the step, with the error code next to it. The application page shows the stored text.

## D-026 Bulk approve returns a summary — Decided
"N approved, M skipped because …". Once the Free plan's monthly limit is reached, the rest are skipped with that reason.

## D-027 Approval order, and a failed email doesn't undo — Decided
Company → location → contact → terms and tax → tier → finalise (buyer record, certificates linked, Flow trigger, activity) → email. If only the email fails, the approval stands and the modal offers "Send email again".

## D-028 Undo never deletes customers — Decided (follows the spec)
Undo deletes the company only if this approval created it; otherwise it removes only the location and contact link it added. A customer created during approval stays in Shopify as a normal customer after Undo. Worth knowing for merchants.

## D-029 Free-plan quota is checked on fresh approvals only — Decided
Retrying an approval that already started doesn't count again or get blocked.

## D-030 Pause and Move for paused buyers — Decided
Pause removes the buyer's locations from the tier market and remembers the tier (`Buyer.pausedTierId`). "Move to tier" on a paused buyer only changes which tier Resume restores.

## D-031 Deleting a tier — Decided (follows the spec)
Blocked while any buyer is in the tier or paused from it. The Shopify market, catalog and price list are deleted only if Tradepass created them **and** the merchant ticks the box.

## D-032 "Only these collections" tiers aren't re-synced daily — Proposed
Products added to those collections later are picked up the next time the tier is saved (the editor says so). A daily re-sync would cost API calls on every store. Say if you want it.

## D-033 Canadian exemption labels show Shopify's enum names — Proposed
US and EU exemption labels are translated. The 22 Canadian ones show Shopify's own code name, made more readable, in every language. Translating them is possible if Canadian stores matter.

## D-034 Price hiding: CSS in Liquid, messages in JS — Decided
Whole-store scope hides price, Add to cart and dynamic checkout buttons before the page paints. Partial scopes hide the main product section on gated product pages and, on collection and search pages, hide cards linking to gated products. Content a theme injects later (predictive search, quick add, recommendations, cart drawer) is handled by a script watcher, so a price can show for a moment before it hides; the layout doesn't break. Signed-in B2B buyers get no hiding at all.

## D-035 Gated product list capped at 1,000 — Proposed
For collection, product or tag scopes, the list of gated products is embedded on every page (about 30 KB at the cap). Product pages always check tags and collections directly, so they're always right; only cards beyond the cap in injected content could show prices. Proposal: tell merchants with more than 1,000 gated products to use "whole store" or a tag scope.

## D-036 Obvious spam is discarded, not stored — Proposed
A submission that fills the hidden honeypot field or arrives in under 3 seconds is thrown away while the sender sees the normal success screen. After 5 such hits in an hour, everything from that IP is discarded for the hour. Nothing is saved, so the merchant never sees spam and there's no spam count in the admin.

## D-037 Rate limits on public endpoints — Decided
Per hour, stored as salted hashes: submit 10 per IP and 3 per email; upload 30 per IP; more-info update 20 per IP. Retries with the same idempotency key don't count.

## D-038 Duplicates — Decided
An application matching an earlier one in the same store by email, company name (ignoring case) or tax number is saved with a Duplicate flag. The applicant sees "You've already applied" (and gets no "received" email) only if the earlier one is pending, needs info or approved; after a rejection they see the normal success.

## D-039 Files upload before submit, with signed references — Decided
Each file uploads as soon as it's chosen (same 60-second retry). The browser gets a signed, store-bound reference valid for 24 hours, and submit only accepts valid references, so nobody can attach someone else's file.

## D-040 More-info page is standalone HTML — Decided
Not a theme (Liquid) page, so applicant text can't run as Liquid and the page doesn't depend on the theme. The email address can't be changed through the link. The link is claimed before saving and released if validation fails.

## D-041 Merchant texts are sanitised before reaching the storefront — Decided
Angle brackets are removed, colours must be hex codes, custom selectors lose risky characters, and Apply/Login URLs must be `/relative` or `https://`.

## D-042 Tax-number check runs during submit — Decided
Up to 5 seconds, so the result is there when the merchant opens the application. Any failure is stored as "Couldn't check" and never blocks the application.

## D-043 Logged-in prefill — Decided
The form block prefills name and email from Liquid, which needs no extra access. `/proxy/prefill` also links the application to the customer and needs protected customer data (D-016); it can be dropped if that request is refused.

## D-044 Forms list and default form — Decided
Forms list at `/app/form`, builder at `/app/form/:id`. The default form can't be deleted (the form block falls back to it); "Make default" moves the flag. Extra forms need Pro.

## D-045 One language switcher in the form builder — Decided
It drives both editing and the preview. Store languages come first, then every built-in language so texts can be prepared before a language is published.

## D-046 Form texts storage — Decided
Merchant texts for fields, sections, options, consent and success live in the form definition per language; an empty text means the built-in translation is used.

## D-047 Core form fields can't be removed — Decided
Company name, Email, First and Last name, Billing address and Consent can't be hidden, removed or made conditional. "Show if" must point at an earlier visible dropdown or checkbox question. Custom question IDs are never reused.

## D-048 When form-builder errors show — Decided
Errors for empty inputs appear after leaving the field or trying to save; errors caused by a deliberate choice show at once. Saving with errors shows a summary banner linking to each field.

## D-049 "Preview as" runs the real storefront script — Decided
On a mock product page and collection card, in three sandboxed frames (retail, logged-in non-wholesale, wholesale with the chosen tier's discount).

## D-050 Email caps — Superseded by D-091 (2026-11-01)
Every queued email reserves a slot on a UTC day: 25 per store, 250 in total, protected by a database lock so busy moments can't overshoot. Overflow goes to the next day with room and is never dropped; Notifications and the digest say "N emails are waiting for tomorrow". Failed sends still count (Brevo may have counted them).

## D-051 Instant merchant alerts count toward the store's 25 — Superseded by D-091 (2026-11-01)
When the day is full the alert isn't queued, because the daily digest lists every pending application anyway.

## D-052 Daily digest — Superseded by D-091 (2026-11-01)
Sent once per UTC day when there's something to report (pending applications, expiring or expired certificates, failed actions in the last 24 h, deferred emails), to the notification email or else the store email, in the store's primary language.

## D-053 Emails are rendered at send time — Superseded by D-091 (2026-11-01)
The copyable messages keep the same language rule: in the recipient's language, falling back to the store's primary language, then English. A broken merchant override falls back to the built-in text and never blocks sending. An empty `{first_name}` uses the company name.

## D-054 "Sending" status prevents double sends — Superseded by D-091 (2026-11-01)
Overlapping job runs can't send the same email twice; rows stuck for more than 15 minutes go back to the queue, and Brevo's idempotency key guards the retry.

## D-055 Emails try to send immediately — Superseded by D-091 (2026-11-01)
After queueing for today, the app tries to send at once, so "Application received" doesn't wait for the hourly job (which remains the safety net).

## D-056 Certificate statuses — Decided
Review states (waiting for review, rejected) are stored; valid, expiring and expired are worked out from the expiry date daily. The expiry day itself still counts as valid. (The 30/7-day reminder and expiry emails were removed in D-091; Flow triggers fire on the status change, once.)

## D-057 Renewal links last 60 days and work once — Decided
A newer link cancels older unused ones. The link is used up only after the upload succeeds, and the new upload sets the certificate to "Waiting for review".

## D-058 Expired certificate → tax exemption — Proposed
Default "ask": the certificate shows "Decide about the tax exemption" with Keep or Remove (with a confirmation). Setting "remove": the daily job removes it automatically. Removal only takes off the exemption that certificate backs (US state resale or EU reverse charge), on every location of the buyer, and is skipped if another valid certificate covers it. Canadian, licence and other certificates are never removed automatically.

## D-059 Email address for buyers without an application — Decided
For imported buyers, the contact's email address (filled into the copied renewal message) is read live from Shopify and never stored.

## D-060 Certificates on the Free plan — Decided
The page stays visible with actions disabled and an "Available on Starter" banner. The daily certificate job runs only for plans with the certificate vault.

## D-061 No "Sent with Tradepass" footer on Free-plan emails — Superseded by D-091 (2026-11-01)
We haven't added a footer to Free-plan emails. Say if you want one. (The "Powered by Tradepass" link on the Free-plan form is now built, D-077.)

## D-062 The checkout lock blocks at checkout, not in the cart — Decided
Errors while editing the cart make theme cart forms fail in odd ways, and hide-prices mode already hides Add to cart. Any unknown step is treated as checkout, so a wholesale-only store never silently opens.

## D-063 If the lock itself fails, checkout is not blocked — Proposed
`blockOnFailure: false`. If Shopify's Function system crashes or times out, retail checkouts could get through for the length of the outage. The alternative blocks every buyer, B2B included, during such an outage.

## D-064 Staff draft orders for retail customers need an exempt tag — Proposed
Nothing Shopify gives the Function identifies an admin draft order, so in wholesale-only mode a draft order for a non-company customer is blocked unless the customer has a tag listed under Storefront → exempt tags. Draft orders for companies work. POS and Create Order API orders are never checked, so POS keeps working. The settings and Help must say this.

## D-065 Gift-card-only carts pass the lock — Decided (spec edge case)
A cart with any non-gift-card item is blocked.

## D-066 Checkout-lock message language — Decided
The Function gets one message per published store language plus the primary language and English (merchant text, else built-in translation). It picks the exact language, then the base language, then a regional variant, then the store default, then English. Saving the Storefront page refreshes the messages.

## D-067 No Flow template for Shopify's B2B access email — Decided
`companyContactSendWelcomeEmail` exists (D-005) and approval already sends it. The Automation page says so.

## D-068 Flow action answers within 8 seconds — Decided
A longer approval keeps running and the response is "accepted"; Flow retries and gets "done" once the application is approved. A failed step returns a final error with the message shown in Flow; an unexpected error lets Flow retry, and approval resumes without duplicates.

## D-069 Flow field "Contact email" is plain text — Decided
Certificate triggers may not know an email, and an empty value could fail Flow's email check.

## D-070 Reversing an automatic decision — Proposed
An auto-rejection goes back to Pending (a sent email can't be recalled). A half-finished auto-approval is undone. A **finished** auto-approval **pauses the buyer** (out of the tier, sees retail prices) instead of deleting the company, because the company may already have orders. The merchant can resume the buyer from Buyers.

## D-071 Rule matching — Decided
A rule with no conditions never matches. Reject rules are checked first, then approve rules, in order; the first match decides.

## D-072 Daily auto-approval limit — Decided
Counts today's (UTC) auto-approvals, default 25. Two exactly simultaneous submissions can go one over the limit, which we accept.

## D-073 Import rows are kept only while the import is open — Decided
Row data lives in the import run until it finishes or is cancelled, then it's cleared. The error report holds row numbers and problem codes only. Progress is saved every 10 rows; rows after the last save are re-run on resume, which can't create duplicates. The open Import page drives the run; the hourly job finishes the rest. Runs pause while the store isn't on Pro.

## D-074 Import limits and existing companies — Proposed
2 MB and 5,000 rows per file. A company that already exists in Shopify is skipped by default, or linked if the merchant chooses. An existing customer with the row's email becomes the contact. Invalid-looking phone numbers are dropped with a warning. US, Canadian and Australian rows need a state/province code.

## D-075 Tag conversion — Decided
Customers who already belong to a company are skipped, which also makes a re-run safe. Customers without a full default address are reported, not converted. The company name is the address's company, else the customer's name.

## D-076 Free plan: no live tax-number checks — Proposed
Spec §N puts tax-number checks on Starter. On Free (not on development stores, which get Pro) the number is still asked for, encrypted and used for duplicate detection, but no VIES/HMRC/ABN lookup is made. The application shows a new "Not checked on your plan" badge (status `skipped`, also a filter option) and the detail page says checks come with Starter. Consequence: on Free the EU reverse-charge exemption is never suggested automatically (it needs a verified number); the merchant can still pick it in the Approve dialog. Upgrading doesn't re-check older applications.

## D-077 "Powered by Tradepass" link on the Free plan's form — Proposed
A small centred link "Powered by Tradepass" under the application form block, Free plan only (shown when the `config` metafield's `brand` is set; dev stores and paid plans have none). It opens in a new tab so the applicant's answers stay on the page. It isn't a merchant-editable text. It points to `https://apps.shopify.com/tradepass` (`POWERED_BY_URL` in `app/lib/storefront-sync.server.ts`); **confirm the App Store slug before publishing**. The storefront config is re-synced when the plan changes (Plans page and the `app_subscriptions/update` webhook). Free-plan emails still have no footer (D-061).

## D-078 Activity export (Pro) — Proposed
Settings → Activity history → "Export activity (CSV)" downloads the shop's latest 10,000 activity entries (newest first): time, actor, action, subject, result, detail. The actor is the staff member's name as Shopify gives it (the spec's "who"); subjects are our ids or Shopify GIDs. Detail keys that could hold secrets or personal data are dropped and email addresses inside text are replaced with "[email]". Locked on Free and Starter (badge "Available on Pro"; the server refuses too). Each export writes an `activity.export` entry.

## D-079 Tier assignment switch in Settings — Proposed
Settings → Tier assignment: Automatic (default) or Assisted. The change applies to new approvals and tier changes only. Open assisted checklist items stay on the Tiers page after switching back to Automatic, and Home now counts them in either mode. The switch is on every plan (automatic assignment isn't plan-gated today, although the plans text lists it under Starter; say if Free should be assisted-only).

## D-080 File limits on the server — Decided
The submit (and needs-info update) handlers refuse more than 3 files per upload question with the same "You can add up to 3 files" error the browser shows, and count a repeated reference to the same file once. The upload endpoint accepts exactly one file per request and checks type by content and size (≤ 5 MB) as before. The limit is per upload question, as in the spec's form section and the browser; there is no separate cap across all upload questions of one application.

## D-081 Shopify is the source of truth for the plan — Decided (2026-10-30)
Install, reinstall and every Home load read `currentAppInstallation.activeSubscriptions`; `Shop.billingPlan` is a cache. Uninstall resets it to Free (Shopify cancels app subscriptions on uninstall). Test charges only count on development stores or with `BILLING_TEST=true`.

## D-082 Reinstall restores the storefront at once — Decided
`afterAuth` re-writes the app-owned metafields and the checkout validation from saved settings, because Shopify deletes both on uninstall. A wholesale-only store is locked again the moment the app is reinstalled.

## D-083 Decisions wait for an approval in progress — Decided
Reject and "needs more info" are refused while an approval has created objects in Shopify (`approvalStatus` set). The merchant finishes it (Retry) or removes it (Undo) first, so no company is left behind under a rejected application. Approve, reject, needs-info and Undo share one 10-minute per-application lock.

## D-084 Submit answers before the follow-ups — Decided
The app proxy request returns once the application is stored (plus the ≤5 s tax check, D-042). Merchant alert, Flow trigger and automation rules run right after in the background, recorded as an `intake_followup` job that the hourly run finishes if the process stopped.

## D-085 Tax-ID formats: strict only where certain — Decided
`app/lib/tax-ids.json` lists ~65 countries with the local name, an example and a pattern. A mismatch blocks submission only for formats we know for certain (EU VAT, UK, CH, NO, CA BN, AU ABN, IN GSTIN, BR CNPJ, MX RFC, JP, KR, CN, TW, TH, VN, AE, SA, IL, TR, ZA, RU, CL, AR, PE, NZ); for the others the example is shown but anything is accepted. US resale certificate numbers vary by state and are never format-checked. Run `npm run sync-tax-ids` after editing the table.

## D-086 Who can apply, by billing country — Decided
Settings → Who can apply: every country (default), only chosen countries, or every country except chosen ones. The form shows the message on the billing country before submitting; the server refuses too. Existing applications and buyers are not affected.

## D-087 Navigation in nine sections — Decided
See PLAN.md → Navigation. Certificates and Import moved under Wholesale buyers; Notifications and Automation under Emails & automation; Plans is reached from Settings and every "Available on …" label. URLs didn't change, so links in emails keep working.

## D-088 Setup wizard replaces the one-question welcome — Decided
`/app/setup` reuses the same code as the regular pages (form templates, `createTier`, storefront sync). It offers Show/Hide prices only; the wholesale-only store stays a deliberate choice on the Storefront access page. It never loosens a store that is already wholesale-only.

## D-089 Approvals need B2B on the plan — Decided
On a store without B2B the approval stops before any Shopify call with a plain explanation; applications keep coming in and can be approved once B2B is available. Flow gets a final 422 with the same message.

## D-090 Strings added on 2026-10-30 are English until translated — Decided
They live in `app/locales/en/pending.json`; the runtime falls back to English and the i18n test allows exactly those keys to be missing elsewhere. Navigation labels and every applicant-facing storefront string were translated into all 36 languages.

## D-091 Tradepass sends no email — Decided (2026-11-01)
Brevo no longer sends from free addresses (Gmail and similar) on any plan, so sending needs a purchased, authenticated domain. That breaks the zero-running-cost rule, so all email sent by Tradepass is gone: the Brevo client, queue, daily caps, templates and editor, the Notifications page, merchant alerts and the daily/weekly digest, the "Application received" email, renewal reminder emails, test emails, the email-quota alert on Home and the `EmailLog` table (migration `20261101000000_remove_email`, which also drops `Certificate.remindedAt` and the `Shop.email`/`contactEmail` columns that only fed email).

What replaces each email:
- **Approval**: Shopify's own B2B welcome email (`companyContactSendWelcomeEmail`, D-005), still chosen per approval, in bulk approve (now with its own switch), automation rules and the Flow action. A Shopify failure shows a plain message on the email step with Retry; there is no fallback. `customerSendAccountInviteEmail` is not used (legacy customer accounts only).
- **Ask for more information**: the request (with its signed, single-use link that expires in 14 days) is saved, then the merchant sees a ready-made message in the applicant's language with **Copy message** and **Open in email** (mailto). The link is shown only then, because only its hash is stored; asking again makes a new link and cancels the old one.
- **Reject**: the reason is now stored on the application (`rejectReason`) and the same copy / open-in-email message is offered after rejecting, and later from the application page. Bulk and automatic rejections keep the reason, so their message can be copied from each application.
- **Certificate renewal**: **Copy renewal link** on one certificate makes a new signed, single-use upload link (60 days, D-057) inside the translated renewal message. Bulk renewal and the 30/7-day/expiry reminder emails are gone; the daily job still refreshes statuses, fires the Flow triggers and applies "remove the exemption when expired".
- **Merchant alerts**: pending work stays on Home and in the queue. Help and the Automation page explain Flow's "Send internal email" action with the "Wholesale application submitted" trigger (it emails fixed staff addresses only).
- **"Application received"**: the storefront success screen confirms the submission; the "We've sent you a confirmation email" line is removed in every language.

The message texts reuse the translated email texts (renamed `email.*` → `message.*`, all 36 languages kept), and merchants can still change them per language under Settings → Languages → Change texts ("Messages to applicants and buyers"). The email-only "Email branding" settings are removed. Stored settings from before load as usual; the old `notifications` and `branding` keys are ignored. Plans, prices and feature gating are unchanged.


## D-092 Shopify's B2B welcome email when the API refuses it — Decided (2026-11-07)
Evidence: the Admin GraphQL schemas bundled with Shopify's dev toolkit (`@shopify/dev-mcp` 1.18.0: 2026-01, -04, -07, -10, 2027-01, unstable) contain no `companyContactSendWelcomeEmail` (532 mutations, none with "Welcome"); its `validate` tool rejects our operation ("Cannot query field … on type Mutation"). shopify.dev still has a reference page for it, and a Shopify staff reply in the developer community (thread "Missing send email for B2B contact create mutation") says there is no public API for apps to send the B2B access email and points to Flow's "Send B2B access email" action. So the call may work for some apps and fail for others.
Decision: keep calling it (it is Shopify's own email, the only email route the rules allow) but treat "Shopify doesn't know or allow this field" as **skipped** (`email_unavailable`), not failed: the approval finishes, nothing retries hourly, and the application page offers a ready-made **"you're approved"** message (copy / mail app / WhatsApp …) with the store's sign-in link and the buyer-facing tier name, plus a hint to send Shopify's B2B access email from the contact in Shopify admin or with a Flow workflow ("Company contact assigned permission" → "Send B2B access email", see docs/flow-templates.md). The message texts are the former "You're approved" email texts, restored from git history in all 36 languages. Plan: every plan (approvals are on every plan). Needs a dev store: whether the mutation is accepted, and that the Flow action exists on non-Plus plans.

## D-093 A state resale exemption never sets "exempt from all taxes" — Decided (2026-11-07)
`CompanyLocationTaxSettings.taxExempt` is documented as "whether the location is exempt from taxes"; specific exemptions are `taxExemptions`. Approval used to set both, which also stopped tax in every state the certificate doesn't cover. Now specific exemptions are assigned alone, and the blanket flag is a separate checkbox, off by default, explained in the dialog. Existing buyers keep what Shopify has (we never change tax settings silently); Help tells merchants how to check. Verify on a dev store how Shopify combines the two.

## D-094 Paused buyers are marked on the company for the checkout lock — Decided (2026-11-07)
App-owned metafield `$app:tradepass.paused` (`boolean`, value `true`) on the Company, written with `metafieldsSet` / removed with `metafieldsDelete` (validated against Admin 2026-10), read by the checkout Function as `purchasingCompany.company.metafield(namespace: "$app:tradepass", key: "paused")` (validated against the 2026-10 Function schema). No personal data, only a flag. Failed writes become a `buyer_marker` job retried hourly without a limit (like `storefront_sync`), and `afterAuth` rewrites all markers after a reinstall (Shopify removes app-owned metafields on uninstall). Plan: wholesale-only mode needs Starter; pausing is on every plan, so the marker is written on every plan.

## D-095 Offline check digits for tax IDs — Decided (2026-11-07)
`app/lib/tax-checksums.js` (ES5, copied into the storefront form by `scripts/sync-tax-ids.mjs`) implements the published algorithms for 34 countries (list and sources in API_NOTES.md). Each was confirmed against real, publicly listed numbers (tests). A wrong check digit blocks submission only for countries already marked strict in `tax-ids.json`; a country whose algorithm couldn't be confirmed (Türkiye's 10-digit VKN, Spain, the Netherlands' post-2020 numbers, Mexico) is not checked. No network call, so it runs on every plan (the live registry checks stay Starter).

## D-096 Theme locale files are written minified — Decided (2026-11-07)
Shopify caps each theme-extension locale file at 15 KB. Thai and Hindi were at 11.4 KB pretty-printed; minified they are ~10 KB, which leaves room for the new storefront strings. `scripts/theme-form-texts.mjs` regenerates the form-texts snippet from `en.default.json`; tests keep every file under 15 KB.

## D-097 New storefront strings live in theme assets, not the locale files — Decided (2026-11-07)
Each theme-extension locale file is capped at 15 KB (enforced by Shopify); Thai and Hindi would pass it with this pass's strings. New storefront strings go into `extensions/tradepass-theme/assets/tradepass-texts.<locale>.json` (36 files, flat keys, no per-file cap; the extension's 10 MB total applies). The form block passes the visitor's, the base language's and the English file's CDN URLs; the script loads the first that exists (3-second cap) before rendering, merchant overrides still win. The hosted pages and the admin preview merge the same files on the server. `scripts/i18n-check.mjs` checks them like the other catalogs. Existing strings stay where they are.

## D-098 US certificates: one row per state — Decided (2026-11-07)
The applicant chooses the certificate (state's own, SST, MTC, tax-exempt organisation) and adds one seller's permit / sales tax ID per state (up to 12). Each state becomes its own Certificate row (`form`, `region`, encrypted number), sharing the uploaded file and its expiry date, so expiry tracking, the Flow triggers and "remove the exemption when expired" keep working per state with no change. Numbers are encrypted in the application (`answers.usPermits[].numberEnc`) like the main tax number. Approval suggests `US_<STATE>_RESELLER_EXEMPTION` only for the **location's** state (shipping address, else billing) when a certificate covers it; other covered states are shown with "Add these exemptions" and never applied by default (Shopify taxes by ship-to). States without a statewide sales tax (DE, MT, NH, OR) get no suggestion; Alaska is still offered (local taxes). This replaces the old "any certificate's state" rule (acceptance test 10 still holds for a Texas buyer). Plan: every plan (it's intake and approval); the live Texas check is Starter, like VIES.

## D-099 State permit lookups: links, a staff mark and one live dataset — Decided (2026-11-07)
`app/lib/us-states.ts` lists only lookups confirmed on the states' own sites (10 states, API_NOTES). Web forms get "Check on the <state> website" plus what to type there; nothing is scraped. "Mark as checked" stores who and when on the certificate and in the activity log. Texas gets the automatic check against the Comptroller's open dataset (data.texas.gov, public domain, no key) at intake and with "Check again" (5 s per call, 6 s total, never blocks). Plan: links and the mark on every plan (they cost nothing); the live check on Starter (same gate as VIES/HMRC/ABN). New host: `data.texas.gov`.

## D-100 US form fields and the "US retailers" template — Decided (2026-11-07)
New standard questions, hidden until a template or the merchant turns them on: store type (physical / online / both), store URL or marketplace, years in business, EIN (format only), D-U-N-S (format only), trade references. "How did you hear about us?" reuses the existing `referral` question. US addresses need a state and a ZIP / ZIP+4 (form and server). Phones get a country-code picker and are stored in E.164 (`+15125550123`); older form scripts still in browser caches send free text, which is accepted as before. Forms saved earlier get the new questions as hidden (`withAllStandardFields`), so nothing changes on a live form. Templates "US retailers" and "Nonprofits" added; business type "Nonprofit or tax-exempt organisation" added. Plan: every plan (form questions aren't gated today).

## D-101 Nonprofits: no IRS import — Decided (2026-11-07)
The IRS bulk files are free but hold over a million organisations; importing them would use a large share of Neon's free 0.5 GB and need monthly refreshes. Tradepass links to the IRS Tax Exempt Organization Search instead (the EIN is on the application) and shows that Shopify has no specific exemption value for nonprofits, so the merchant decides (the explicit "Don't collect any tax" choice exists, D-093). Plan: every plan.

## D-102 Where applicants come from — Decided (2026-11-07)
The app embed stores the first touch of the visit (UTM source/medium/campaign, the referring site's host, the landing path) in `sessionStorage` (this tab only, no cookie); the form sends it with the submission and the server keeps only those five short values (`Application.attribution`). The referrer's full URL is never kept (it can carry personal data). Shown on the application and in the CSV export; top sources on Home. Plan: every plan.

## D-103 Messages go out through the merchant's own apps — Decided (2026-11-07)
Every ready-made message (more info, reject, renewal, "you're approved") offers Copy plus links that open the merchant's own app with the text filled in: mail app (`mailto:`), Gmail web compose, Outlook on the web, WhatsApp (`wa.me`), the phone's texts (`sms:`), Telegram and LINE (`app/lib/message-links.ts`). Links only: no API, no account, no cost, nothing is sent by Tradepass. When a message is longer than an app's link allows (limits in `LINK_LIMITS`, kept conservative), the text is copied first and the app opens empty with a "just paste it" toast. WhatsApp and texts need the applicant's phone in E.164 (D-100); without it they open without a recipient. Shopify Messaging is not used: its automations only reach marketing subscribers (Help says so). Plan: every plan. Needs a dev-store/phone check: the Outlook web `deeplink/compose` and `sms:` body formats on iOS and Android.

## D-104 Applicant status page and customer-account block — Decided (2026-11-07)
Every copied message carries a signed, read-only status link (purpose `status`, 90 days, no personal data in the token). The hosted page (`/apps/tradepass/status/:token`) shows the stage, the submitted date, and, when allowed, the update link, the re-apply date, the store's WhatsApp, booking and "start shopping" links. Signed-in customers who applied see a status card instead of the form (`/apps/tradepass/status` via the app proxy's `logged_in_customer_id`), and a customer-account UI extension block (`customer-account.profile.block.render`, `network_access`) calls `/account/status` with the customer-account session token. The extension needs the app's URL at build time (`src/config.js`, default `https://tradepass.onrender.com`). Plan: every plan (it saves the merchant replies). Needs a dev store: the block placement and network access approval in the customer accounts editor.

## D-105 Re-apply cool-down — Decided (2026-11-07)
Settings → Applicants and contact → "Days before a rejected applicant can apply again" (0–730, default 0 = no change in behaviour). Intake answers 409 `cooldown` with the date; the form and status page show it. Matched by customer ID, else email. Plan: every plan.

## D-106 Saved replies — Decided (2026-11-07)
Merchants write their own rejection reasons and "more info" texts once, per language (Settings → Saved replies, up to 30 replies, 2,000 characters per text). Reject, bulk reject and automatic reject rules (`replyId`) offer them next to the built-in suggestions; the applicant gets the text in their language, else the store's primary language, else the first one written. Stored in shop settings (no new table). Plan: every plan; rules that use them stay Pro (auto_rules).

## D-107 Flow trigger "Wholesale application info received" and Flow templates — Decided (2026-11-07)
New trigger fired when an applicant answers a "more info" request, with the same fields as the other application triggers plus Admin URL, contact name, phone and state, so a Flow "Send internal email" or Slack step has everything. All trigger TOMLs are generated by `scripts/flow-triggers.mjs`. Ready-to-copy workflows are documented in `docs/flow-templates.md` (template TOML scaffolds under `docs/flow-templates/`, not deployed: Flow templates need Partner review). Plan: Flow triggers are Pro, as before.

## D-108 Faster review — Decided (2026-11-07)
Waiting-time badges and a "waiting longer than N days" highlight (Settings, default 3), oldest-first default for open queues, a "Mine / Nobody" assignee filter and "Assign to me", previous/next navigation with J/K/A/M/R keyboard shortcuts (`?` shows them; ignored while typing), "Approve with defaults" (suggested tier, terms and tax settings in one click, same approval steps), a printable application page (browser print / save as PDF, tax numbers shortened), 30/90-day numbers on Home, and "Finish the setup in Shopify" links (catalog, payment terms, deposits) instead of rebuilding native B2B. Plan: every plan; the CSV export columns follow the existing export.

## D-109 Risk hints — Decided (2026-11-07)
Hints, never blocks: free email domain, throwaway email domain (Step 3, below), website domain different from the email domain (marketplaces and site builders excluded), registry name that shares no word with the typed company name, P.O. box shipping address. Offline lists only, no lookup service. Shown on the application on every plan; usable as automation conditions on Pro (auto_rules).

## D-110 Customer tags on approval — Decided (2026-11-07)
Optional tags (up to 10) added to the buyer's customer record on approval as a new approval step (`tags`), read back to record exactly what was added so Undo removes only those; optionally removed on pause and re-added on resume. For the merchant's own segments, marketing consent flows and theme rules. Plan: every plan. Scope: `write_customers` (already granted).

## D-111 QR code and form link — Decided (2026-11-07)
The form page shows the public form address with Copy, and a QR code made in the browser by `qrcode-generator` (MIT, no network) as PNG or SVG, optionally tagged `utm_source=qr` so Home counts print sign-ups (D-102). Plan: every plan.

## D-112 Phone-friendly uploads and draft privacy — Decided (2026-11-07)
On phones the file field offers "Take a photo" (`capture="environment"`) next to "Choose a file"; failed uploads say why (type, size, too many uploads, dropped connection) instead of a generic error. The saved draft in the browser never contains files or the tax number (`sanitizeDraft`). Plan: every plan.

## D-113 More free official registries — Decided (2026-11-07)
Norway: Brønnøysund Register Centre's open Enhetsregisteret API (`data.brreg.no`, no key, NLOD licence; 404/410 = not found or removed; bankrupt, dissolving or deleted entities are "not verified"; a number written as `…MVA` must also be in the VAT register). New Zealand: the NZBN API (`api.business.govt.nz`), only when the free `NZBN_API_KEY` is set (MBIE says there is no fee), only for 13-digit NZBNs; the status field name could only be confirmed from third-party clients, so it's read defensively and anything unclear is "unavailable" (needs verification with a key). Switzerland: the UID register's public SOAP service exists (20 calls a minute), but its request format couldn't be confirmed from official pages here (hosts blocked), so it's a "Check it yourself on uid.admin.ch" link plus the offline check digit; live check is on the ROADMAP. Canada: CRA's GST/HST Registry is a web form only, so it's a link. Every checked country also gets its official lookup link on the application whenever the live check didn't verify the number. Same rules as VIES/HMRC/ABN: 5 s per call, 6 s total, never blocks; live checks on Starter, links on every plan.

## D-114 Step 3 ideas built from research — Decided (2026-11-07)
Sources: Shopify App Store listings and reviews of wholesale-approval apps (merchants report "hundreds of applicants that make up their own business"; competitors advertise VIES checks, registry links and duplicate alerts), the Shopify Community thread "How are you verifying tax-exempt certificates or professional licenses for B2B customers?" (manual checks against state sites), and the Shopify changelog (April 2026: non-Plus plans get up to 3 B2B catalogs; customer accounts redesign; legacy accounts deprecated). Built: (1) throwaway-email hint and rule condition (offline list of well-known disposable domains, every plan / rules Pro); (2) official lookup links for every checked country (D-113); (3) the customer-account status block targets the current customer accounts (D-104). Not built (ROADMAP): professional-licence lookups per state and profession (too many boards, mostly web forms), Swiss UID live check, more state permit datasets.
