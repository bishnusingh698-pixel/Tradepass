# Plan

## Architecture

```
Shopify admin (iframe) ──App Bridge + Polaris web components──▶ React Router app on Render (free)
Storefront ── theme app extension (Liquid + app-owned metafields, ≤20 KB JS) ── works with our server asleep
          └── /apps/tradepass/* (app proxy, HMAC-signed) ──▶ same Render app: form submit, file upload
Checkout ── Cart & checkout validation Function (wholesale-only lock) — runs on Shopify, not on us
Render app ──Prisma──▶ Neon Postgres (free, sleeps when idle)
cron-job.org ──▶ GET /healthz every 10 min (no DB)  ·  POST /jobs/hourly  ·  POST /jobs/daily (secret header)
Emails ──▶ Brevo free API (caps: 25/store/day, 250/day total)
Certificates ──▶ merchant's own Shopify Files (staged uploads), never our disk/DB
```

## Code map

| Path | What |
|---|---|
| `app/shopify.server.ts` | Shopify app config; `afterAuth` runs plan detection and creates defaults. |
| `app/lib/shop.server.ts` | Plan, B2B, Markets and catalog-budget detection. |
| `app/lib/spike.server.ts` | Phase 0 B2B market spike (dev stores only). |
| `app/lib/i18n/*` | Locales, ICU runtime, server locale choice, React provider, pseudo-localization. |
| `app/locales/*.json` | 36 catalogs plus `_context.json` (notes per key). |
| `app/lib/proxy.server.ts` | App proxy signature verification. |
| `app/lib/crypto.server.ts` | AES-GCM for tax numbers; signed single-use link tokens. |
| `app/lib/tax.ts` | Tax exemption suggestion (US reseller, EU reverse charge). |
| `app/lib/jobs.server.ts` | Hourly and daily task runner with time budget. |
| `app/lib/privacy.server.ts` | Single place that deletes or reports our data. |
| `app/routes/app.*.tsx` | Admin pages. `healthz`, `jobs.*`, `webhooks.*` are the server endpoints. |
| `extensions/` | Theme app extension and validation Function (P3/P5). |
| `tests/` | Vitest unit tests. Playwright end-to-end tests are added once a dev store exists. |

## Database schema

The final schema lives in `prisma/schema.prisma`, with comments per table. Summary:

| Table | Purpose | Notes |
|---|---|---|
| Session | Shopify sessions | Template table. |
| Shop | One row per store: plan facts, billing plan, settings JSON (versioned) | `uninstalledAt` until shop/redact. |
| Form | Form definitions (JSON) | Default created on install. |
| Application | One application | `idempotencyKey` is unique per shop; `taxNumberEnc` is encrypted; `approvalState` is per-step progress for Retry/Undo. |
| ApplicationFile | Shopify File GIDs | No file contents. |
| Tier | Market, catalog, price list and publication GIDs plus defaults | `createdByUs` guards deletes. |
| Buyer | Company, location and contact GIDs, tier, status, source | Never copies Shopify data beyond the name. |
| Certificate | Type, jurisdiction, encrypted number, dates, status, file GID | |
| EmailLog | Queue, log and quota counter | Recipient stored as a hash; payload cleared after sending. |
| ActivityLog | Who, what, when, result | Never stores personal data, only ids. |
| Job | Deferred work (imports, retries) | |
| ShopLock | Per-shop mutex for market writes | Expiring. |
| ImportRun | CSV and tag-conversion runs with a resume cursor | |
| TokenUse | Single-use link tokens (hash only) | |
| Rule | Auto-approve and auto-reject rules | |
| RateHit | Public endpoint rate limits | Pruned hourly. |

Indexes only cover the queries the pages run, such as (shop, status, submittedAt) for the queue and (shop, expiresOn) for certificates.

## Capacity estimate for 100 stores (acceptance 25)

These are inferred from row sizes, not measured, and get re-checked with real data in P8.

- **Neon storage (0.5 GB):** a generous 500 applications per store × 100 stores = 50,000 applications at ~2 KB each (answers JSON) ≈ 100 MB. Certificates, buyers and tiers add < 10 MB. The activity log is ~20 rows per application ≈ 1M rows × ~250 B ≈ 250 MB worst case. That's the largest table, so it's pruned at 24 months (D-010), and a further cap per shop can be added if needed. Expected total is under 300 MB.
- **Neon compute:** the database only wakes for admin use, form submissions and the job runs (24 hourly plus 1 daily). /healthz never wakes it. Each hourly run is short, so the database suspends again after Neon's idle timeout. 🔲 Compare against Neon's current free compute allowance when you create the project.
- **Render:** one service kept awake by /healthz every 10 min uses ~744 h/month, inside the 750 free hours. Only one service may be awake, so there's no staging service on the free tier.
- **Brevo (300/day):** our cap is 250/day globally and 25 per store per day. Overflow is queued for the next day and the merchant sees a notice. Shopify's own welcome email (D-005) doesn't count against Brevo.

## Phase order and status

See `feature_list.json` for every item and its status, and `progress.md` for the latest session.

- **P0** (spike): code ready (`/app/diagnostics`), and it needs a non-Plus dev store to run.
- **P1** (skeleton): mostly built. Deploy and live install checks are waiting on accounts.
- **P2–P8**: not started.
