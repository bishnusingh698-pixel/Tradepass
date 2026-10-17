# Progress

## Session 1 — 2026-10-16

### Done
- Read the full build prompt and verified the APIs it relies on against Admin GraphQL 2026-10 (API_NOTES.md). Most beliefs held. Differences and risks:
  - B2B company-location markets are labelled "dev preview" on the `marketCreate` page. This is the biggest risk; the spike settles it.
  - `SPECIFIED_CONDITIONS_CANNOT_BE_EMPTY` may force a placeholder location per tier (D-004, proposed).
  - `companyContactSendWelcomeEmail` exists, so we use Shopify's own welcome email (D-005).
  - The validation Function runs on admin draft orders, so wholesale-only mode needs care there (P5).
  - `app.extensions()` statuses are lowercase.
- Built the app from Shopify's React Router template (P1 skeleton): Postgres schema for the whole data model, install hook (plan/B2B/Markets/catalog-budget detection plus idempotent defaults), uninstall that keeps data until shop/redact, three privacy webhooks, the 12-page nav with empty states, a Home readiness card, /healthz (no DB), /jobs/hourly and /jobs/daily (secret, time budget, idempotent cleanup tasks), Render blueprint, .env.example, init.sh.
- i18n framework: ICU messages, Intl formatting, RTL, fallback chain, merchant overrides, pseudo-localization. All 36 locale files for the 92 P1 strings are translated with a formal register, a glossary per language and a back-translation review (TRANSLATIONS.md, TRANSLATION_REVIEW.md).
- Phase 0 spike implemented as Help → B2B compatibility test (`app/lib/spike.server.ts`), dev stores only, with full call recording and cleanup.
- Tests: 129 Vitest tests pass (i18n checks across 36 locales, app proxy HMAC with Shopify's example, tax exemption mapping, encryption + link tokens, /healthz + jobs, plan detection). Typecheck, lint and build are clean. Smoke-tested the built server: /healthz 200, jobs 401 without the secret and 200 with it.

### Next
1. Bishnu's accounts (GitHub done). Then: link the app with Shopify CLI, deploy to Render, install on the dev store, run CHECKLIST A–C.
2. Run the spike and fill in SPIKE_RESULTS.md. Decide automatic or assisted assignment, and settle D-004.
3. P1 leftovers: verify install/reinstall live, the app.extensions() checklist, and a Playwright end-to-end smoke test against the dev store.
4. P2: tiers and the approval engine.

### Known issues
- The start-of-session e2e check (install → Home → test application) can't run until a dev store and deploy exist.
- Nothing yet uses `write_publications`, `write_files` or `read_orders`; they're added in their phases.
- LISTING_DRAFT.md and REVIEWER_NOTES.md are outlines only (P8).

### What I need from you (Bishnu)
See the reply in the project thread. The same steps are in README.md → "Accounts setup".

## 2026-10-17 — all areas built, docs merged

### What's built
Code-complete for every phase P1–P8 (see `feature_list.json`: 40 built, 51 need a live check, 8 not done, 7 passing):
- **Tiers and approval** (P2, P6): tiers with B2B market + catalog + price list (+ publication), Plus direct catalogs, 3-catalog budget, per-shop lock with read-back and retry, assisted mode, "Changed in Shopify" sync with Fix; approval engine with Retry and Undo; Buyers with Move, Pause and Resume.
- **Form and storefront** (P3, P5): form builder with live preview and languages; theme app extension (app embed, application form block, Apply block); app proxy submit/upload/prefill with retries and idempotency; spam protection and rate limits; uploads to Shopify Files; duplicates; VIES/HMRC/ABN checks; access modes 1–3 with the checkout-lock Function; preview-as.
- **Applications and emails** (P4): queue, detail, approve/reject/needs info, bulk actions, CSV export; emails in every language with caps and next-day overflow; merchant alerts and daily digest.
- **Certificates** (P6): expiry tracking, renewal emails at 30 and 7 days with a single-use upload link, expiry decision on tax exemptions.
- **Automation and import** (P7): auto-approve/reject rules with pause, daily limit and Reverse; 5 Flow triggers and the approval action; CSV import with dry run and resume; tag conversion.
- **Plans, Help, Settings** (P8): Billing API plans with trial once per store, plan gating, downgrade confirmation; Help (guide, 17 FAQs, diagnostics, debug mode); Settings (languages and text overrides, retention, branding, delete all data); Home (welcome, checklist, pending work, alerts, numbers).
- Moved to React 19 (D-013). Scopes final (D-016).
- Accessibility pass under way in the storefront form and hosted pages (error-summary focus, fieldset descriptions, readable button text, screen-reader text for hidden prices, contrast).

### What's tested
- `npx vitest run`: **319 tests in 26 files.** First run today: 284 pass, 35 fail. Latest run (with translators' files half-written): **281 pass, 38 fail**. Every failure is in `tests/i18n.test.ts`: 31 × "has every English key and no extras", 5 × "has no untranslated strings", 1 × "valid ICU, matching placeholders and complete plurals". All other 25 test files pass. Expected until the translators finish; the ICU one should be checked when they do.
- `npx react-router build` passes.
- Storefront scripts: embed 2.9 KB gzipped, form 10.6 KB gzipped (only on the form page).
- Nothing has run against a real store yet: no deploy, no dev store install, no spike.

### Gaps against the spec (not built)
- Free plan: the "Powered by Tradepass" link on the form isn't shown.
- Tax-number checks run on every plan; the spec puts them on Starter.
- Pro: activity export isn't built.
- The 3-files-per-question limit is enforced in the browser only.
- Assisted tier assignment works, but there's no button to switch to it; it's a stored setting (`settings.tiers.assignment`).
- `.env.example` doesn't list the optional `HMRC_CLIENT_ID`, `HMRC_CLIENT_SECRET` and `ABN_GUID` (documented in README instead).
Decide with the owner whether to build these or change the pricing text (LISTING_DRAFT.md).

### Docs updated today
API_NOTES (area sections), DECISIONS (D-013 to D-075), CHECKLIST (full script by acceptance test), PLAN (architecture, schema, routes, jobs), README (full setup), PRIVACY, REVIEWER_NOTES (with screencast script), LISTING_DRAFT (English), ROADMAP, feature_list.json. The `docs/notes/*.md` files are merged and marked as such.

### Next
1. Translators finish the locale files and `docs/listing/<locale>.json`; re-run `npx vitest run` until all pass.
2. Owner decisions on the Proposed items in DECISIONS.md and the gaps above.
3. Accounts and deploy (README §2–6): link the app, request protected customer data, deploy to Render + Neon, set up cron-job.org and Brevo, `shopify app deploy`.
4. Run the spike on a non-Plus dev store and fill in SPIKE_RESULTS.md; settle D-004.
5. Work through CHECKLIST.md on store A (non-Plus) and store B (Plus); fix what fails and add selectors for themes.
6. Finish and measure the accessibility pass, then the performance pass (acceptance 22, 23); Playwright smoke tests against the dev store.

### What I need from you (Bishnu)
The numbered steps are in README.md sections 2–6. The one only you can do: Partner Dashboard → Apps → Tradepass → API access → **Protected customer data access** (README §2.4).
