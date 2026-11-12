# Tradepass: Wholesale Signup

A public Shopify app that lets businesses apply for wholesale and puts approved buyers into the right B2B price tier automatically. It's built for Shopify's native B2B on Basic, Grow, Advanced and Plus.

Built on Shopify's React Router app template (React Router 7, React 19, Polaris web components), Prisma + Postgres (Neon), hosted on Render's free plan, with scheduled jobs from cron-job.org. Tradepass sends no email of its own (DECISIONS D-091): approval uses Shopify's own B2B welcome email, and for everything else the merchant copies a ready-made message (or opens it in their email app).

- What's done and what's next: `progress.md` and `feature_list.json`
- Design, schema, routes and jobs: `PLAN.md`. Choices and open questions: `DECISIONS.md`. Verified APIs: `API_NOTES.md`
- Tests for you to click through: `CHECKLIST.md`. Data handling: `PRIVACY.md`. App Store: `LISTING_DRAFT.md`, `REVIEWER_NOTES.md`

Everything below is free. Do the sections in order. Where it says "the agent", the coding agent does that step for you.

## First deployment at a glance

1. **Neon** (§4): create the project, copy the pooled and direct connection strings.
2. **Shopify Partner app** (§2.1–2.2): create/link the app; copy the client ID and secret.
3. **Render** (§3): Blueprint from this repo, paste every environment variable (§7). The first build creates the database tables.
4. **Point Shopify at Render** (§2.6): put the Render URL in `shopify.app.toml` (`application_url`, `auth.redirect_urls`, `app_proxy.url`) and run `npm run deploy`.
5. **Protected customer data** (§2.4): request access in the Partner Dashboard (needed for real stores).
6. **cron-job.org** (§5): health check every 10 minutes, hourly and daily jobs.
7. **Install** on a development store, open the app and follow **Set up Tradepass** (the setup wizard on Home): it checks the plan, sets up the form, creates the first tier and adds the form to the theme.

## 1. Local development (for the coding agent)

Requirements: Node 22.12+, Postgres 16, Shopify CLI (comes with `npm install`), and a Shopify Partner account.

```bash
cp .env.example .env          # fill in values (a local Postgres URL is fine for both DATABASE_URL and DIRECT_DATABASE_URL)
service postgresql start      # if Postgres isn't running
./init.sh                     # install, migrate, typecheck, lint, tests, then `shopify app dev`
./init.sh --no-dev            # same without starting the dev server
npx vitest run                # unit tests
npx react-router build        # production build
```

`shopify app dev` opens a tunnel, updates the app URLs, and serves the theme extension, Function and Flow extensions to your development store as previews.

## 2. Shopify Partner app setup

### 2.1 Partner account and development stores
1. Go to https://partners.shopify.com → **Join now**, and sign up.
2. **Stores** → **Add store** → **Create development store**. Pick **Grow** (not Plus) and tick "Start with test data" if offered. This is **store A**.
3. Create a second development store on **Plus** for the Plus checks. This is **store B**.
4. In each store: **Settings** → **Markets**: make sure the new Markets experience is on (needed for B2B catalogs below Plus).

### 2.2 Create and link the app
1. The agent runs `npm run config:link` (`shopify app config link`). When it shows a login link and code, open the link, sign in to your Partner account and confirm. Choose **Create a new app**, name it **Tradepass: Wholesale Signup**. This fills `client_id` in `shopify.app.toml`.
2. Partner Dashboard → **Apps** → **Tradepass** → **Client credentials**: copy the **Client ID** (`SHOPIFY_API_KEY`) and **Client secret** (`SHOPIFY_API_SECRET`). Send them to the agent privately or paste them into Render yourself (section 3).

### 2.3 Access scopes
These are set in `shopify.app.toml` and requested when a store installs the app. You don't need to click anything; this is what merchants will see:

| Scope | Why |
|---|---|
| `write_companies` | Create companies, locations, contacts and tax settings on approval |
| `write_customers` | Find an existing customer by email and link them; tag conversion. Includes read access, so `read_customers` isn't requested |
| `write_markets` | B2B markets for tiers; moving buyers between tiers |
| `write_products` | Catalogs and price lists for tier pricing |
| `write_publications` | Limit a tier to chosen collections |
| `write_files` | Save certificates in the merchant's Shopify Files |
| `write_validations` | Wholesale-only checkout lock |
| `read_orders` | Orders placed by Tradepass buyers (Home numbers, Buyers list) |
| `read_locales` | The store's languages |

### 2.4 Protected customer data (you must do this)
Without it, the app works on development stores but not on real stores.
1. Partner Dashboard → **Apps** → **Tradepass** → **API access** → **Protected customer data access** → **Request access**.
2. Under **Select your data use and reasons**, tick: *Customer service*, *Store management*, *App functionality*. Reason: "Wholesale applicants and buyers: review applications, create B2B companies and contacts, link existing customers."
3. Under **Protected customer fields**, tick **Name**, **Email**, **Phone** and **Address**, each with the same reason.
4. Fill in the data protection questions (answers are in PRIVACY.md: encryption of tax numbers, retention, deletion on request, no data sold, sub-processors) and **Save**.

### 2.5 App proxy
Already set in `shopify.app.toml`: storefront URLs `https://{shop}/apps/tradepass/...` go to `{app URL}/proxy/...`. It's applied by `shopify app deploy` (2.6). Check afterwards in Partner Dashboard → **Apps** → **Tradepass** → **Configuration** → **App proxy**: prefix `apps`, subpath `tradepass`, URL ending in `/proxy`. Don't change the subpath: the form expects `/apps/tradepass`.

### 2.6 Extensions and deploy
The app has 8 extensions in `extensions/`:
- `tradepass-theme`: theme app extension (app embed "Tradepass", app blocks "Wholesale application" and "Apply for wholesale").
- `tradepass-checkout-lock`: the cart and checkout validation Function for wholesale-only mode.
- Flow triggers: `tradepass-flow-application-submitted`, `-application-approved`, `-application-rejected`, `-certificate-expiring`, `-certificate-expired`.
- Flow action: `tradepass-flow-approve-application` (calls `POST /flow/approve` on the app).

To publish the app configuration and all extensions:
1. Make sure `application_url`, the `auth.redirect_urls` and the `app_proxy.url` in `shopify.app.toml` point to your Render URL (the agent sets them after section 3).
2. The agent runs `npm run deploy` (`shopify app deploy`) and confirms the release. This uploads the config (scopes, webhooks, app proxy) and every extension as a new app version.
3. Check Partner Dashboard → **Apps** → **Tradepass** → **Versions**: the new version is **Active** and lists the 8 extensions.
4. Flow: the triggers and the action appear in Shopify Flow for any store with the app installed. Nothing else to configure.
5. Checkout lock: Tradepass creates the checkout rule itself when a merchant picks "Wholesale-only store". It then shows in Shopify admin → Settings → Checkout → Checkout rules.

### 2.7 Billing
Plans are created through Shopify's Billing API when a merchant picks one. No Partner Dashboard setup is needed. Development stores always get test charges and all features free.

## 3. Hosting: Render
1. Go to https://render.com → sign up with GitHub.
2. **New** → **Blueprint** → choose the `tradepass` repository → **Apply**. Render reads `render.yaml` and creates one **free** web service named `tradepass` (region Oregon, health check `/healthz`).
3. Open the service → **Environment** and fill in every value marked "sync: false" (see section 7 for each one).
4. Copy the service URL Render shows (e.g. `https://tradepass.onrender.com`) into `SHOPIFY_APP_URL`. Tell the agent, who updates `shopify.app.toml` and runs `shopify app deploy` again.
5. Each deploy runs `npm run render-build`: install, `prisma generate`, `prisma migrate deploy` (migrations run automatically, before the new code starts) and the production build. Start command: `npm run start` (listens on Render's `PORT`).

Only one free service can stay awake all month, so there's no separate staging service.

## 4. Database: Neon
1. Go to https://neon.tech → **Sign up** (GitHub is easiest).
2. **Create project**: name `tradepass`, Postgres 16, region closest to Render (**US West (Oregon)**, or Frankfurt if you moved Render to Frankfurt).
3. On the project dashboard click **Connect**. With **Connection pooling** ON, copy the string → `DATABASE_URL`. Switch pooling OFF and copy again → `DIRECT_DATABASE_URL`. Paste both into Render.
4. Add `&connect_timeout=15` to the end of **both** strings (after `?sslmode=require`). Neon's free database sleeps when idle and takes a few seconds to wake; without this the first request after a quiet spell can fail with "Can't reach database server" (Prisma P1001).
5. Nothing else: tables are created by the first Render deploy from one migration (`prisma/migrations/20261030000000_init`). `/healthz` never touches the database, so the keep-awake ping doesn't use Neon compute.

## 5. Scheduled jobs: cron-job.org
1. Sign up at https://cron-job.org → **Dashboard** → **Create cronjob**. Make three:

| Title | URL | Schedule | Method / header |
|---|---|---|---|
| `tradepass healthz` | `https://<your-render-url>/healthz` | Every 10 minutes | GET, no header |
| `tradepass hourly` | `https://<your-render-url>/jobs/hourly` | Every hour (minute 5) | **Advanced** → Request method **POST**; Headers → add `X-Tradepass-Job-Secret` = your `JOB_SECRET` |
| `tradepass daily` | `https://<your-render-url>/jobs/daily` | Every day at 03:00 | POST, same header |

2. Set **Request timeout** to the maximum offered (jobs can take up to ~2 minutes; the first call after a sleep also waits for Render to wake).
3. After the first run each job shows **200**. A **401** means the header name or secret is wrong; **405** means the method isn't POST.

The healthz job keeps the free Render service awake (about 744 of the 750 free hours per month).

## 6. Email
Nothing to set up. Tradepass doesn't send email, so there is no email provider, API key or domain to buy:
- **Approvals** use Shopify's own B2B welcome email (`companyContactSendWelcomeEmail`), sent by Shopify for free when "Send welcome email" is on.
- **Ask for more information**, **Reject** and **Copy renewal link** show a ready-made message in the applicant's language, with **Copy message** and **Open in email**.
- **Alerts for new applications**: in Shopify Flow, use the Tradepass trigger "Wholesale application submitted" with Flow's "Send internal email" action (it emails fixed staff addresses only). Help in the app explains it.

## 7. Environment variables

All of these are in `.env.example`. On Render, set them in the service's **Environment** tab. Never commit real values.

| Variable | What to put | Where it comes from |
|---|---|---|
| `SHOPIFY_API_KEY` | App client ID | Partner Dashboard → Apps → Tradepass → Client credentials |
| `SHOPIFY_API_SECRET` | App client secret (also checks webhooks, the app proxy and Flow requests) | Same place |
| `SHOPIFY_APP_URL` | Public URL of the app, e.g. `https://tradepass.onrender.com` | Render (the CLI sets it during `shopify app dev`) |
| `SCOPES` | `write_companies,write_customers,write_markets,write_products,write_publications,write_files,write_validations,read_orders,read_locales` | Already filled in; must match `shopify.app.toml` |
| `DATABASE_URL` | Neon **pooled** connection string (host contains `-pooler`), ending in `?sslmode=require&connect_timeout=15` | Neon → Connect |
| `DIRECT_DATABASE_URL` | Neon **direct** connection string (used for migrations), same ending | Neon → Connect, pooling off |
| `ENCRYPTION_KEY` | 32 random bytes, base64: `openssl rand -base64 32`. Encrypts tax numbers. **Never change it** once there's data (old numbers would become unreadable) | The agent generates it |
| `LINK_TOKEN_SECRET` | Long random string: `openssl rand -hex 32`. Signs more-info and renewal links, and salts spam-protection hashes | The agent generates it |
| `JOB_SECRET` | Long random string. cron-job.org sends it as `X-Tradepass-Job-Secret` | The agent generates it |
| `BILLING_TEST` | `false` in production; `true` on a staging app so charges are test charges | — |
| `SUPPORT_EMAIL` | The support address shown in Help | Your email |
| `SUPPORT_WHATSAPP_URL` | Optional. Your own `https://wa.me/<number>` link; Help then shows "Chat with us on WhatsApp". A plain link, no WhatsApp Business API | Your WhatsApp number |
| `TRUSTED_PROXY_HOPS` | Optional, default `0`. How many proxies at the end of `X-Forwarded-For` are ours (Shopify's app proxy + Render = `2` once confirmed on the live deploy, REVIEW N2), so per-IP spam limits use the real visitor | Check one request's headers after deploy |

| `HMRC_CLIENT_ID`, `HMRC_CLIENT_SECRET` | Optional. UK VAT checks: register an application on the HMRC Developer Hub (https://developer.service.hmrc.gov.uk) and subscribe it to "Check a UK VAT number". Without them, UK numbers show "Couldn't check" (the format is still checked) | HMRC Developer Hub |
| `ABN_GUID` | Optional. Australian ABN checks: free GUID from https://abr.business.gov.au/Tools/WebServices. Without it a mistyped ABN is still caught by the checksum | ABN Lookup |
| `NZBN_API_KEY` | Optional. New Zealand NZBN checks: free subscription key from https://portal.api.business.govt.nz (MBIE says there is no fee; subscriptions are reviewed). Without it NZ numbers get the offline check digit and a link | NZBN API portal |
| `SOCRATA_APP_TOKEN` | Optional. Higher rate limit for the Texas sales-tax permit check on data.texas.gov (works without it) | data.texas.gov → Developer settings |

Norway's Brønnøysund register (`data.brreg.no`) and the EU's VIES need no key.

**Outbound hosts** the server calls (all free government services, each 5 s per call, 6 s per check, never blocking an application): `ec.europa.eu`, `data.brreg.no`, `data.texas.gov`, and with the keys above `api.service.hmrc.gov.uk`, `abr.business.gov.au`, `api.business.govt.nz`. Plus Shopify. No email, SMS or messaging service is called (tests/email-removal.test.ts checks this).

`render.yaml` also sets `NODE_VERSION=22.12.0` and `NODE_ENV=production`. `SHOP_CUSTOM_DOMAIN` (template option for a custom shop domain) is not needed.

Generate the three secrets on your own computer:

```bash
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -hex 32      # LINK_TOKEN_SECRET
openssl rand -hex 32      # JOB_SECRET
```

## Endpoints
- `GET /healthz` returns `ok` instantly and never uses the database.
- `POST /jobs/hourly` and `POST /jobs/daily` need the `X-Tradepass-Job-Secret` header and return JSON with a result per task.
- `POST /flow/approve` is the Flow action (HMAC-checked).
- `/proxy/*` is reached through the app proxy `/apps/tradepass/*` (signature-checked).
- `/webhooks/*` handles uninstall, scope and subscription updates, and the three privacy webhooks.
- `/app/*` is the embedded admin.
