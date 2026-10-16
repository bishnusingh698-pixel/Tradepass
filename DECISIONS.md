# Decisions

Each entry gives the decision, why, and its status. **Proposed** entries change scope, cost, billing, data handling or merchant-facing behaviour, so they wait for Bishnu's OK before being built.

## D-001 Start from Shopify's React Router app template — Decided
Cloned `Shopify/shopify-app-template-react-router` (HEAD on 2026-10-16), which uses `@shopify/shopify-app-react-router` 3.0.x, React Router 7.18, Admin API `2026-10`, Prisma 6 and Polaris web components. Template-repo files (CI for the template itself, CLA bot, editor configs, Dockerfile) were removed. We don't use Docker because Render runs Node natively.

## D-002 Polaris web components 1.x, not the 2.0 RC — Decided
Polaris 2.0 for App Home is still a release candidate. Built for Shopify review shouldn't depend on an RC. The template's default script serves 1.x. Moving to 2.0 later means changing `polarisUrl` in two places plus the types package, and needs no component changes.

## D-003 Postgres from day one (Neon), no SQLite — Decided
Production is Neon Postgres, so dev and tests use Postgres too (`DATABASE_URL` pooled, `DIRECT_DATABASE_URL` for migrations). This avoids SQLite/Postgres drift such as arrays, JSON and dates.

## D-004 Placeholder company location per tier market — Proposed (depends on spike)
The API lists `SPECIFIED_CONDITIONS_CANNOT_BE_EMPTY`. If the spike confirms that a B2B market can't be empty, every Tradepass tier market will contain one hidden placeholder location under a company named "Tradepass (do not delete)". That company would appear in the merchant's Companies list. The alternative is to create the market only when the first buyer is approved, but then a tier can't exist before it has buyers, and we'd have to delete the market when the last buyer leaves (which loses the catalog link). **I'll decide after the spike and tell you which one; it's visible to merchants.**

## D-005 Use Shopify's own B2B welcome email — Decided
`companyContactSendWelcomeEmail` exists in 2026-10, so "Send welcome email" calls it. Our own "You're approved" email (all 36 languages) is used only if that call fails or the merchant turns Shopify's email off. This also saves Brevo quota.

## D-006 Certificate files: admin-only viewing through the app — Proposed
Files go to the merchant's Shopify Files, as required. A Shopify `GenericFile` URL is a public CDN link, though, so "opens only for staff" can't be guaranteed by Shopify alone. The plan is to never expose the URL anywhere outside the admin, give uploads random file names, and have the admin open files through an authenticated Tradepass route. **Residual risk:** anyone who already has the exact CDN link can open it. The real alternative, storing files ourselves, breaks the zero-cost and no-files-on-our-server rules. Recommended: accept this and say so in PRIVACY.md.

## D-007 Access scopes (minimal, added per phase) — Decided
| Scope | Why | Phase |
|---|---|---|
| `write_companies` | Create companies, locations, contacts and tax settings on approval. | P1 (spike), P2 |
| `write_markets` | Create B2B markets for tiers and move company locations between them. | P1 (spike), P2 |
| `write_products` | `catalogCreate` / `priceListCreate` for tier pricing. | P1 (spike), P2 |
| `read_locales` | Read the store's published languages and primary language. | P1 |
| `write_publications` | Restrict a tier's catalog to chosen collections. | P2 |
| `write_files` | Upload certificates into the merchant's Shopify Files. | P3 |
| `read_orders` | Home: orders placed by Tradepass buyers (last 60 days only). | P4 |
Every write scope implies its read scope. Customer scopes are only added if linking an existing customer can't be done with company scopes (to check in P2).

## D-008 Admin language travels in the URL — Decided
Shopify sends `locale` on the first embedded load. Tradepass keeps `?locale=` on its own nav links and falls back to Accept-Language, then the store's primary language, then English. Only the active language's strings are sent to the browser, which keeps the admin's load time (LCP) small.

## D-009 Uninstall keeps data for 48 hours — Decided
`app/uninstalled` deletes sessions and marks the shop uninstalled. All data is deleted when `shop/redact` arrives (Shopify sends it 48 h later). A quick reinstall restores tiers and settings, and defaults are never duplicated (`ensureDefaults` is create-if-missing).

## D-010 Data retention defaults (within the prompt's settings) — Decided
Rejected or withdrawn applications are deleted after 12 months (merchant setting). The activity log is pruned after 24 months, and sent-email log rows after 90 days. These keep Neon well under 0.5 GB (see PLAN.md §Capacity).

## D-011 Translation of example tag names — Decided
Translators localised the illustrative "wholesale" tag in the Import empty state (for example Danish "engros", Russian «опт»). Merchants type their real tag themselves, so this is only an example. Flagged in TRANSLATION_REVIEW.md.

## D-012 Repository — Pending your action
GitHub repo creation isn't available from this workspace. The work is committed locally and mirrored to the project files folder until you create an empty `tradepass` repository (see progress.md → What I need from you).
