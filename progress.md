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
1. Bishnu's accounts (below). Then: link the app with Shopify CLI, deploy to Render, install on the dev store, run CHECKLIST A–C.
2. Run the spike and fill in SPIKE_RESULTS.md. Decide automatic or assisted assignment, and settle D-004.
3. P1 leftovers: verify install/reinstall live, the app.extensions() checklist, and a Playwright end-to-end smoke test against the dev store.
4. P2: tiers and the approval engine.

### Known issues
- The start-of-session e2e check (install → Home → test application) can't run until a dev store and deploy exist.
- Nothing yet uses `write_publications`, `write_files` or `read_orders`; they're added in their phases.
- LISTING_DRAFT.md and REVIEWER_NOTES.md are outlines only (P8).

### What I need from you (Bishnu)
See the reply in the project thread. The same steps are in README.md → "Accounts setup".
