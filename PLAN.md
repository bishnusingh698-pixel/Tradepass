# Plan

Final architecture as built on 2026-10-17. What's tested and what still needs a dev store: `feature_list.json` and `progress.md`.

## Architecture

```
Shopify admin (iframe) ──App Bridge + Polaris web components (React 19)──▶ React Router 7 app on Render (free)
Storefront ── theme app extension "tradepass-theme" (Liquid + app-owned metafields)
          │     app embed "Tradepass"  ·  app block "Wholesale application"  ·  app block "Apply for wholesale"
          │     works with our server asleep (price hiding, Apply buttons)
          └── /apps/tradepass/* (app proxy, HMAC-checked) ──▶ same Render app: submit, upload, prefill, more-info, renewal
Checkout ── validation Function "tradepass-checkout-lock" (wholesale-only) — runs on Shopify, not on us
Flow ── 5 trigger extensions + 1 action extension (POST /flow/approve, HMAC-checked)
Render app ──Prisma──▶ Neon Postgres (free, sleeps when idle)
cron-job.org ──▶ GET /healthz every 10 min (no DB) · POST /jobs/hourly · POST /jobs/daily (X-Tradepass-Job-Secret)
Emails ──▶ Brevo free API (caps: 25/store/day, 250/day total; overflow → next day)
Certificates ──▶ merchant's own Shopify Files (staged uploads); admin views them via /app/files/:id
Tax checks ──▶ EU VIES (free), UK HMRC and AU ABN Lookup (optional, free keys)
```

How the pieces talk:
- **Storefront config** (access mode, scope, texts per language, selectors, form definitions, gated product handles) is written by `syncStorefrontConfig` into app-owned metafields on the app installation. Liquid reads them, so the storefront never calls our server for price hiding.
- **Checkout-lock config** (messages per language, exempt tags) lives in metafields on the Validation object, written by `ensureCheckoutLock`.
- **Tier assignment** on non-Plus moves company locations in and out of B2B markets (`marketUpdate`) under a per-shop lock (`ShopLock`), with read-back after each write and retry. On Plus, catalogs are attached to locations directly (`catalogContextUpdate`). An "assisted" mode turns the move into a checklist for the merchant if the spike shows automatic moves don't work.
- **Approval engine** (`app/lib/approval.server.ts`) runs company → location → contact → terms and tax → tier → finalise → email. Progress per step is stored on `Application.approvalState`, so Retry continues and Undo removes only what it created.

## Code map

| Path | What |
|---|---|
| `app/shopify.server.ts` | Shopify app config, billing plans; `afterAuth` runs plan detection and creates defaults. |
| `app/lib/shop.server.ts` | Plan, B2B, Markets and catalog-budget detection. |
| `app/lib/context.server.ts` | `adminContext`: session, shop row, settings, effective plan, actor. |
| `app/lib/settings.ts`, `settings.server.ts` | Versioned settings JSON with defaults. |
| `app/lib/plans.ts`, `billing.server.ts` | Plan features and gates; Billing API sync, trial, downgrade. |
| `app/lib/tiers.ts`, `tiers.server.ts` | Tier objects in Shopify, assignment, sync, assisted mode, placeholder (D-004). |
| `app/lib/approval.server.ts` | Approval engine with read-back, Retry, Undo. |
| `app/lib/applications*.ts` | Queue, filters, CSV export, notes, needs-info, reject. |
| `app/lib/buyers*.ts` | Buyers list, move, pause/resume, create buyer from import. |
| `app/lib/certificates*.ts` | Certificate statuses, renewal links, expiry decisions. |
| `app/lib/intake.server.ts`, `spam.server.ts`, `uploads.server.ts`, `taxcheck.server.ts` | Form submission, spam and rate limits, file uploads, VIES/HMRC/ABN. |
| `app/lib/forms.server.ts`, `form-defaults.ts`, `app/components/form-builder/*` | Form storage and builder. |
| `app/lib/storefront-sync.server.ts`, `app/components/storefront/*` | Storefront settings, preview-as, metafield sync. |
| `app/lib/checkout-lock.server.ts` | Creates/enables/disables the checkout validation. |
| `app/lib/rules*.ts`, `flow.server.ts` | Automation rules; Flow triggers and action. |
| `app/lib/import*.ts` | CSV import and tag conversion. |
| `app/lib/email/*` | Templates, rendering, queue and caps, Brevo client. |
| `app/lib/home.server.ts` | Home checklist, pending work, alerts, 30-day numbers. |
| `app/lib/jobs.server.ts`, `app/lib/tasks/*` | Hourly and daily task runner and area tasks. |
| `app/lib/privacy.server.ts` | One place that deletes or reports our data. |
| `app/lib/crypto.server.ts`, `proxy.server.ts`, `lock.server.ts`, `gql.server.ts`, `activity.server.ts` | Encryption and link tokens; app proxy signature; per-shop lock; GraphQL helpers; activity log. |
| `app/lib/i18n/*`, `app/locales/<locale>/*.json` | ICU runtime, 36 locales in namespaces, `_context/` notes per key. |
| `app/lib/spike.server.ts` | Phase 0 B2B market spike (dev stores only). |
| `extensions/tradepass-theme` | App embed, form block, Apply block, storefront scripts (embed 2.9 KB gz, form 10.6 KB gz on the form page only). |
| `extensions/tradepass-checkout-lock` | Validation Function (JS). |
| `extensions/tradepass-flow-*` | Flow triggers and action. |
| `tests/` | Vitest (26 files). Playwright tests come once a dev store exists. |

## Database schema (final, `prisma/schema.prisma`)

Three migrations: `init`, `phase2_fields`, `billing_trial`. Every table except Session and RateHit carries `shop`, and every query filters by it.

| Table | Purpose | Notes |
|---|---|---|
| Session | Shopify sessions | Template table. Deleted on uninstall. |
| Shop | One row per store: plan facts (plan name, Plus, dev store, B2B, B2B markets, catalog limit, direct catalogs), billing plan, subscription, trial start, settings JSON (versioned), primary language, contact email, placeholder company | `uninstalledAt` until shop/redact. |
| Form | Form definitions (JSON: sections, fields, conditions, texts per language), default flag, suggested tier | Default created on install. |
| Application | One application: status, company name, email, country, business type, language, answers JSON, encrypted tax number, tax-check result, flags, notes, needs-info request, approval progress, source, rule that decided it, IP hash | `(shop, idempotencyKey)` unique; indexes `(shop, status, submittedAt)`, `(shop, email)`. |
| ApplicationFile | Shopify File IDs per application | No file contents. |
| Tier | Market, catalog, price list and publication IDs, discount, defaults (terms, checkout, tax), sync state, mode (market/direct), placeholder location, position | `createdByUs` guards deletes. |
| Buyer | Company, location and contact IDs, tier, status (active/paused), paused tier, tax exemptions, country, source, company name | `(shop, companyGid)` unique. |
| Certificate | Buyer/application, type, country, region, encrypted number, issue/expiry dates, status, file ID, reminders sent, reject reason, expiry decision | Indexes `(shop, expiresOn)`, `(shop, buyerId)`. |
| EmailLog | Email queue, log and quota counter (by `quotaDay`) | Recipient stored as a hash; payload cleared after sending. |
| ActivityLog | Who, what, when, result | Only IDs, never personal data. |
| Job | Deferred work; assisted tier assignments wait here | Index `(state, runAfter)`. |
| ShopLock | Per-shop mutex for market writes | Expires. |
| ImportRun | CSV and tag-conversion runs: mapping (holds row data while open), totals, resume cursor, errors | Row data cleared when the run ends. |
| TokenUse | Single-use link tokens (hash only), purpose, expiry, used time | |
| Rule | Auto-approve and auto-reject rules | |
| RateHit | Public endpoint rate limits (salted hash key, hour window) | Pruned hourly. |

## Route map

**Admin (embedded, `/app/*`, session-token auth)**

| Route | Page |
|---|---|
| `/app` | Home: welcome, readiness, setup checklist, pending work, alerts, numbers |
| `/app/stats` | Home's 30-day numbers (loaded after the page shows) |
| `/app/applications`, `/app/applications/:id` | Queue (tabs, filters, bulk, CSV export) and detail |
| `/app/applications/:id/approve` | Approval engine actions (approve, retry, undo, resend email) |
| `/app/buyers`, `/app/buyers/:id` | Buyers list and detail (move, pause/resume, renewal request) |
| `/app/tiers`, `/app/tiers/:id` | Tiers list and editor |
| `/app/form`, `/app/form/:id` | Forms list and builder with preview |
| `/app/storefront` | Access mode, scope, texts, colours, exempt tags, preview-as |
| `/app/certificates` | Certificates table and actions |
| `/app/notifications` | Emails, merchant alerts, quota |
| `/app/automation` | Rules, pause, daily limit, automatic decisions, Flow |
| `/app/import`, `/app/import/:id`, `/app/import/:id/errors`, `/app/import/template` | Import upload/tag conversion, run, error report, CSV template |
| `/app/settings`, `/app/settings/texts` | Settings (retention, branding, plan link, danger zone) and Languages (text overrides) |
| `/app/plans` | Plans and billing |
| `/app/help`, `/app/diagnostics` | Help (guide, FAQ, diagnostics, debug, contact) and the B2B compatibility test |
| `/app/files/:id` | Streams a certificate/application file to signed-in staff of the same store |

**Storefront (app proxy `https://{shop}/apps/tradepass/*` → `/proxy/*`, signature checked)**

| Route | What |
|---|---|
| `POST /proxy/submit` | Application submission (idempotency key, spam checks, tax check) |
| `POST /proxy/upload` | File upload to Shopify Files, returns a signed reference |
| `GET /proxy/prefill` | Logged-in customer's name and email |
| `/proxy/update/:token` | Hosted more-info page |
| `/proxy/renew/:token` | Hosted certificate renewal page |
| `GET /proxy/assets/:file` | Form script, styles and country data for the hosted pages |

**Server endpoints**

| Route | What |
|---|---|
| `GET /healthz` | Returns `ok`, never touches the database |
| `POST /jobs/hourly`, `POST /jobs/daily` | Scheduled work (needs `X-Tradepass-Job-Secret`) |
| `POST /flow/approve` | Flow action (HMAC-checked) |
| `/webhooks/app/uninstalled`, `/webhooks/app/scopes_update`, `/webhooks/app/subscriptions_update` | App webhooks |
| `/webhooks/customers/data_request`, `/webhooks/customers/redact`, `/webhooks/shop/redact` | Privacy webhooks |
| `/auth/*`, `/auth/login`, `/` | Template login and OAuth |

## Background jobs

cron-job.org calls the two endpoints. Each run has a 100-second budget; tasks run in order, work in small batches and are safe to run twice. The response lists each task with how many items it processed.

| Run | Task | What |
|---|---|---|
| Hourly | `tiers-sync` | Compare tiers with their markets/catalogs in Shopify; mark "Changed in Shopify" |
| Hourly | `approval-retry` | Retry failed approval steps that can be retried |
| Hourly | `import-runs` | Continue open CSV/tag import runs (Pro only) |
| Hourly | `storefront-refresh-gated` | Refresh the gated product list for collection/tag scopes |
| Hourly | `send-queued-emails` | Send emails queued for today within the caps |
| Hourly | `prune-rate-limits`, `expire-link-tokens`, `release-stale-locks` | Housekeeping |
| Daily | `certificate-expiry` | Update statuses; renewal emails at 30 and 7 days; expiry email and decision (Starter+) |
| Daily | `merchant-digest` | Daily summary email to the merchant |
| Daily | `retention-cleanup` | Delete rejected/withdrawn applications past the retention setting (and their Shopify files if chosen) |
| Daily | `prune-activity`, `prune-email-log` | Activity older than 24 months, email log older than 90 days |

## Capacity estimate for 100 stores (acceptance 25)

These are inferred from row sizes, not measured, and get re-checked with real data in P8.

- **Neon storage (0.5 GB):** a generous 500 applications per store × 100 stores = 50,000 applications at ~2 KB each (answers JSON) ≈ 100 MB. Certificates, buyers and tiers add < 10 MB. The activity log is ~20 rows per application ≈ 1M rows × ~250 B ≈ 250 MB worst case. That's the largest table, so it's pruned at 24 months (D-010), and a further cap per shop can be added if needed. Expected total is under 300 MB.
- **Neon compute:** the database only wakes for admin use, form submissions and the job runs (24 hourly plus 1 daily). /healthz never wakes it. Each hourly run is short, so the database suspends again after Neon's idle timeout. 🔲 Compare against Neon's current free compute allowance when you create the project.
- **Render:** one service kept awake by /healthz every 10 min uses ~744 h/month, inside the 750 free hours. Only one service may be awake, so there's no staging service on the free tier.
- **Brevo (300/day):** our cap is 250/day globally and 25 per store per day. Overflow is queued for the next day and the merchant sees a notice. Shopify's own welcome email (D-005) doesn't count against Brevo.

## Phase status

- **P0** (spike): code ready at Help → B2B compatibility test; needs a non-Plus dev store to run.
- **P1–P8**: code-complete with unit tests, except the items listed in `progress.md` → Gaps. Everything that touches Shopify for real (install, markets, storefront themes, checkout, Flow, emails) still needs the dev-store checks in CHECKLIST.md.
