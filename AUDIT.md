# Tradepass audit (2026-10-30)

Source of truth for this pass. Status: ✅ done · 🔧 in progress · ⏳ planned · ➖ won't do (reason given) · 🗑️ superseded (the feature was removed later; see D-091).

**2026-11-01:** Tradepass no longer sends email (DECISIONS D-091). Rows below that only concerned email are marked 🗑️; REVIEW.md lists what was removed and what replaced it.

## How the app works today (summary of the read-through)

- **Install / auth**: Shopify React Router template, Prisma session storage, expiring offline tokens. `afterAuth` → `refreshShopFacts` (plan, Plus, dev store, B2B + B2B-markets entitlements, catalog cap, published locales, catalogs used) and `ensureDefaults` (default form). Uninstall keeps data until `shop/redact` (48 h), so a quick reinstall restores everything.
- **Plan / B2B check**: `shop.server.ts` reads `shop.plan`, `entitlements.b2b`, `entitlements.markets.b2b.catalogs.limit`, `features.directConnectionCatalogAssignmentEnabled`. Tier creation is blocked with plain reasons (`no_b2b`, `markets_unavailable`, `catalog_limit`, `plan_limit`).
- **Tiers**: non-Plus = B2B market + catalog + price list (+ publication); Plus = catalog attached directly to locations. Per-shop lock, read-back, retry on concurrent modification. "Assisted" fallback (checklist jobs) if automatic moves turn out not to work — SPIKE_RESULTS.md is still pending, default stays **Automatic** with the Assisted switch in Settings (D-079).
- **Form + storefront**: theme app extension (embed + form block + Apply block) reads app-owned metafields; app proxy `/apps/tradepass/*` verified by HMAC on every request; uploads go to the merchant's Shopify Files with signed references; honeypot/min-time/rate limits; duplicates by email/company/tax hash; VIES/HMRC/ABN checks with 5 s timeouts. Access modes: show / hide prices / wholesale-only (+ checkout validation Function).
- **Applications → approval**: step machine company → location → contact → terms & tax → tier → (finalise) → email, state saved after each step, read-back verification, Retry continues, Undo removes only what it created, hourly auto-retry of transient failures.
- **Emails** (removed 2026-11-01, D-091): Brevo free API, quota 25/store/day and 250/day total with next-day overflow, rendered at send time per recipient language, daily merchant digest. Now: Shopify's own B2B welcome email on approval; copyable messages for everything else.
- **Automation**: auto-approve/auto-reject rules (Pro) with pause + daily limit + reverse; 5 Flow triggers + 1 Flow action; CSV import and tag conversion with resume.
- **Billing**: Billing API, 14-day trial once per store, dev stores get Pro, downgrade confirmation for wholesale-only.
- **Privacy**: three compliance webhooks, retention cleanup, "Delete all data".

Baseline checks on a fresh Postgres 16: `prisma migrate deploy` ✅, `tsc` ✅, `eslint` ✅, `vitest` 333/333 ✅, `react-router build` ✅. So the bugs below are logic/behaviour bugs the tests didn't cover.

## Bugs

| # | Severity | Where | Root cause | Fix | Status |
|---|---|---|---|---|---|
| B1 | critical | `app/lib/shop.server.ts:84` (`refreshShopFacts`) | `Shop.name`, `Shop.email`, `Shop.country`, `Shop.currency` are read all over the app but **never written** (only currency, lazily, on tier create). Effects: every email is signed with the myshopify handle and has **no reply-to**; the merchant digest/instant alerts never send unless an address is typed in Notifications (`merchantAddress` → null); `suggestExemption` always sees an empty store country, so **EU reverse charge is never suggested**. | Query `shop { name email contactEmail currencyCode billingAddress { countryCodeV2 } primaryDomain { url } }` in the facts query and store it (new `domainUrl` column). | ✅ (email parts 🗑️ D-091: Shop.email/contactEmail dropped; name, country, currency and domain stay) |
| B2 | critical | `webhooks.app.uninstalled.tsx`, `shop.server.ts` | Shopify cancels app subscriptions on uninstall, but `Shop.billingPlan` survives in our DB until shop/redact. Reinstalling within 48 h gave **paid features with no subscription**; if the cancel webhook raced the uninstall, nothing corrected it (billing is only re-synced on the Plans page). | Uninstall resets `billingPlan`/`subscriptionGid`; facts refresh (install + every Home load) reads `currentAppInstallation.activeSubscriptions` and stores the real plan. | ✅ |
| B3 | critical | `app/lib/lock.server.ts:35`, `approval.server.ts:621` | `withLock` always takes a **30 s** lock; an approval (6 steps, read-backs, market lock wait up to 25 s) can run longer, so the lock expires mid-run and a second click / staff member / hourly retry runs the same approval concurrently (duplicate contacts, double tier writes). Same for the market lock. | `withLock` takes a TTL; approval lock 10 min, market lock 2 min, and the holder is released in `finally`. | ✅ |
| B4 | major | `applications.server.ts:197-245` | Reject and "needs more info" use find-then-update without a status guard and don't check for an approval in progress: a reject during an approval leaves a **half-created company in Shopify** and a "rejected" application; two staff could reject + approve at once. | Atomic `updateMany` guarded by status **and** "no approval started" (`approvalStatus` null); the UI shows "Undo the partial approval first". Both take the same per-application lock as approval. | ✅ |
| B5 | major | `approval.server.ts:861-866` | `retryStuckApprovals` loads the first 50 applications with any `approvalState` — finished approvals included, no ordering — so once a store has 50 approved buyers **stuck approvals are never retried**. | New indexed column `Application.approvalStatus` (`running` / `failed` / `done`); retry queries only `running`/`failed`. Also powers a new "Approval incomplete" filter. | ✅ |
| B6 | major | `intake.server.ts:351-403` | The storefront submit request **awaits** merchant alerts, Flow, and auto-approval rules (which can run a full approval: 10–40 s). App proxy requests time out after ~10 s, so applicants saw errors/retries and the server did the work twice in parallel. | Respond as soon as the application is stored; follow-ups run in the background, backed by a durable `Job` (`intake_followup`) that the hourly run finishes if the process dies. | ✅ |
| B7 | major | `approval.server.ts:441`, `certificates.server.ts` | The "You're approved" email's **login link is relative** (`/account/login`), which is a dead link in every mail client. More-info and renewal links used the myshopify domain instead of the store's own domain. | Links are built from the store's primary domain (`Shop.domainUrl`, fallback myshopify). | ✅ (emails 🗑️ D-091; the more-info and renewal links in the copyable messages still use the store's domain) |
| B8 | major | `privacy.server.ts` | `customers/redact` deleted our rows but left the applicant's **uploaded documents** in the merchant's Shopify Files; `customers/data_request` was only logged, with no way for the merchant to export the data. | Redact queues a `delete_files` job (runs hourly; webhook stays fast). New Settings → "Privacy requests" lists data requests with a JSON export. | ✅ |
| B9 | major | `taxcheck.server.ts`, `tradepass-form.js:200` | Tax IDs are only labelled for EU/UK/AU/CA/US and never format-checked outside VIES/HMRC/ABN; India GSTIN, NZ GST, CH UID, NO MVA, BR CNPJ, MX RFC, SG UEN/GST, etc. show "Tax ID" with no hint, and typos sail through. | Country tax-ID table (label, example, pattern) shared by the storefront form and the server; format errors are shown inline and re-checked on the server. | ✅ |
| B10 | major | `tiers.server.ts:579` | Changing a tier's collections creates a **new publication every save** and never deletes the old one (orphans pile up in the merchant's store). | Delete the previous publication when Tradepass created it. | ✅ |
| B11 | minor | `prisma/schema.prisma` | Missing indexes for real queries: certificates by application, jobs by shop/type/state, tokens by subject, email log by recipient hash (redact), activity by subject (application timeline). | Added in the rewritten initial migration. | ✅ (email-log index 🗑️ D-091 with the table) |
| B12 | minor | `package.json` `render-build` | `prisma generate` ran after the build; README didn't mention Neon cold-start `connect_timeout`, so the first request after Neon sleeps could fail with P1001. | Generate → migrate → build; docs add `connect_timeout=15`. | ✅ |
| B13 | minor | `intake.server.ts:427` | When an applicant sends the requested information the merchant isn't told; the application silently returns to Pending. | Instant alert / digest line "sent the information you asked for". | ✅ (🗑️ D-091: no alert email; the reply is in the activity log and the application is back under Pending on Home) |
| B14 | minor | `flow.server.ts`, `approval.server.ts` | Flow "approved" trigger could fire twice if the process died between finalise and save. | Finalise records `flowSent` before emitting. | ✅ |
| B15 | minor | `spam.server.ts:36` | Rate-limit IP is the **left-most** `X-Forwarded-For` entry, which a client can set itself, so per-IP limits can be dodged by rotating fake IPs. | The hop layout between Shopify's proxy and Render isn't documented, so guessing a "trusted" hop could lump real applicants together. Kept the IP key and added a per-store hourly cap (120) as a flood backstop; per-email limits, honeypot and minimum time still apply. | ✅ |
| B16 | minor | `app/routes/app.tsx` | 12 top-level nav items plus a hidden Plans page; Certificates/Import/Notifications/Automation are separate top-level pages for one job each. | Navigation redesign below. | ✅ |
| B17 | minor | Free-plan approvals | Two simultaneous fresh approvals can both pass the 10/month check. | Accepted (documented): one extra approval at worst, never a charge. | ➖ |

## UX problems

Admin
- Too many top-level sections (12) with overlapping jobs; Plans hidden behind Settings. → 9 sections with in-page tabs (below).
- No guided first run: Home asks one "what do you sell" question, then a checklist with 6 steps across 5 pages. → Setup wizard (5 short steps, < 5 min), with a plain-language "what your Shopify plan supports" check up front.
- No way to see approvals that stopped half way, except opening each application. → "Approval incomplete" filter + Home card.
- Country lists are plain long selects. → Searchable, scrollable country picker for country rules.
- No report beyond 30-day numbers. → Monthly report (6 months): applications, approval rate, average time to decide, buyers per tier.
- Privacy data requests invisible. → Settings → Privacy requests with export.

Storefront form
- Tax field label is generic outside 5 regions and has no example. → Country-specific label + example + inline format check.
- Merchants can't stop applications from countries they don't ship to; applicants find out only by rejection. → Allow/block countries; the form says so before the applicant fills everything in, and the server enforces it.

## Navigation (new)

| Nav item | Route | Contains (tabs) |
|---|---|---|
| Home | `/app` | Setup card/wizard link, pending work, alerts, numbers, monthly report |
| Applications | `/app/applications` | Queue (+ "Approval incomplete" filter), detail |
| Wholesale buyers | `/app/buyers` | Buyers · Certificates · Import |
| Tiers | `/app/tiers` | Tiers, assisted tasks |
| Application form | `/app/form` | Forms, builder with live preview, templates |
| Storefront access | `/app/storefront` | Modes, texts, preview-as |
| Automation | `/app/automation` | Automation rules, Shopify Flow (the Notifications page was removed in D-091) |
| Settings | `/app/settings` | Countries, languages, retention, branding, tier assignment, privacy requests, **Plan & billing** link, danger zone |
| Help | `/app/help` | Guide, FAQ, diagnostics |

## Features

Added
- ✅ F1 Setup wizard `/app/setup` (plan check → business type & form template → first tier → storefront access → add to theme → done).
- ✅ F2 Form templates by business type: retailer, distributor, salon, restaurant, reseller (+ general). Picker in the form builder; the live preview updates instantly.
- ✅ F3 Country tax-ID table (≈45 countries) for label, example and validation (storefront + server).
- ✅ F4 Allow / block applications by country (Settings), enforced in the form and on the server.
- ✅ F5 Searchable country picker component (Settings).
- 🗑️ F6 Digest frequency: daily or weekly (Mondays). Removed with all email (D-091); Help explains Flow alerts.
- ✅ F7 Monthly report on Home (6 months: received, approved, approval rate, average days to decide; buyers per tier).
- ✅ F8 Privacy requests list + JSON export (Settings).
- ✅ F9 "Approval incomplete" filter in Applications + Home count.
- ✅ F10 Merchant alert when an applicant sends requested info.
- ✅ F11 Section tabs component for grouped pages.

Changed
- Nav regrouped (above). Plans reached from Settings → Plan & billing and from every "Available on …" label.
- Home: the one-question Welcome is replaced by the Setup wizard card (the question lives on in the wizard).

Removed
- The standalone nav entries for Certificates, Import, Notifications, Automation (pages stay, reached via tabs; URLs unchanged). Notifications was removed later (D-091); Automation is a top-level item again.
- Nothing else is removed: every other feature works and is worth keeping.

Already present and kept (checked against the brief): live form preview, auto-approve/reject rules with daily limit + pause + log, buyers list with tier/terms/documents/expiry + quick actions, certificate expiry reminders + merchant alerts, daily digest, 36 admin languages with RTL.

## Translations

New admin strings are written in English. The runtime already falls back (store language → primary → English), so nothing shows a raw key. Keys not yet translated are listed in `app/locales/_pending.json`; the i18n test allows exactly those to be missing and fails on anything else. Navigation labels and every new **storefront** (applicant-facing) string are translated into all 36 languages.

## Order of work

1. B1, B2 (shop profile + billing truth) — schema change, migration rewrite.
2. B3, B4, B5 (approval concurrency + retry) — new `approvalStatus` column.
3. B6, B13 (intake follow-ups in background + job).
4. B7, B8, B11, B12, B14, B15, B10.
5. B9 + F3, F4, F5 (country-aware form).
6. Navigation (B16, F11), F1 wizard, F2 templates.
7. F6, F7, F8, F9.
8. Docs (README deploy, env vars), verification pass.

## Verification log

Environment: fresh Postgres 16, `prisma migrate deploy` from the single init migration, Node 22.

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `npm run lint` | clean |
| `vitest run` | 354 / 354 pass (20+1 new in `tests/audit-fixes.test.ts`; test shops now set `b2bEnabled`) |
| `react-router build` | builds |
| Production server (`react-router-serve`) | `/healthz` 200; `/jobs/hourly` 401 without secret, 200 with; `/jobs/daily` 200; unsigned `/proxy/submit` 401 |
| Signed app-proxy submissions on the built server | FR with valid VAT → 200 in 114 ms; FR with `FR12` → 400 `tax_format`; RU with RU blocked → 400 `country_blocked`; IN GSTIN → 200; `intake_followup` jobs created and completed in the background |
| Approval fails half way, then Retry | covered by `tiers-approval` (acceptance 9) + hourly retry now reaches stuck rows behind 55 finished ones (`audit-fixes` B5) |
| Two approvals / decisions at once | concurrent rejects: exactly one wins (`audit-fixes` B4); lock with 10-min TTL can't be taken over (B3); approval vs reject guarded by `approvalStatus` |
| Different countries / tax IDs | DE, GR (EL), CH, IN, BR accepted; malformed DE/IN refused; SG/US never blocked (`audit-fixes` F3) |
| Expired / used secure links | unchanged behaviour, covered by existing `storefront-intake` and `certificates` tests (claim, release on validation error, 410 when used/expired) |
| Plan without B2B | approval refused before any Shopify call (`audit-fixes`) ; wizard explains what's missing |
| Downgrade from paid | existing `billing` tests; plan now also corrected from Shopify on Home load (`audit-fixes` B2) |
| Uninstall → reinstall | uninstall resets the cached plan; `afterAuth` re-syncs storefront + checkout lock (needs a live store to observe end-to-end) |

Needs a real store (cannot be run here): installing, the embedded admin screens (wizard, tabs, country picker), theme rendering, Shopify B2B calls, Flow, Shopify's welcome email. ROADMAP.md → "Needs live verification" lists them.
