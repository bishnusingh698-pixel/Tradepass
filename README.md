# Tradepass: Wholesale Signup

A public Shopify app that lets businesses apply for wholesale and puts approved buyers into the right B2B price tier automatically. It's built for Shopify's native B2B on Basic, Grow, Advanced and Plus.

Built on Shopify's React Router app template (React Router 7, React 19, Polaris web components), Prisma + Postgres (Neon), hosted on Render's free plan, with scheduled jobs from cron-job.org and email through Brevo.

- What's done and what's next: `progress.md` and `feature_list.json`
- Design, schema, routes and jobs: `PLAN.md`. Choices and open questions: `DECISIONS.md`. Verified APIs: `API_NOTES.md`
- Tests for you to click through: `CHECKLIST.md`. Data handling: `PRIVACY.md`. App Store: `LISTING_DRAFT.md`, `REVIEWER_NOTES.md`

Everything below is free. Do the sections in order. Where it says "the agent", the coding agent does that step for you.

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
5. Each deploy runs `npm run render-build`: install, build, `prisma generate` and `prisma migrate deploy` (database migrations run automatically).

Only one free service can stay awake all month, so there's no separate staging service.

## 4. Database: Neon
1. Go to https://neon.tech → **Sign up** (GitHub is easiest).
2. **Create project**: name `tradepass`, Postgres 16, region closest to Render (**US West (Oregon)**, or Frankfurt if you moved Render to Frankfurt).
3. On the project dashboard click **Connect**. With **Connection pooling** ON, copy the string → `DATABASE_URL`. Switch pooling OFF and copy again → `DIRECT_DATABASE_URL`. Paste both into Render.
4. Nothing else: tables are created by the first Render deploy. The database sleeps when idle; `/healthz` never wakes it.

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

## 6. Email: Brevo
1. Sign up at https://www.brevo.com (free plan: 300 emails per day; Tradepass uses at most 250).
2. **Senders, domains & dedicated IPs** → **Senders** → **Add a sender**. Use an address you own (e.g. `no-reply@yourdomain.com`), and click the confirmation link Brevo emails you. Better: also verify your **domain** there (add the DNS records Brevo shows) so emails don't land in spam.
3. **SMTP & API** → **API keys** → **Generate a new API key**, name it `tradepass`.
4. In Render: `BREVO_API_KEY` = the key, `BREVO_SENDER_EMAIL` = the verified sender address. The sender **name** is each store's name and replies go to the store's email automatically.

Without these two values the app still works, but emails stay in the queue until both are set.

## 7. Environment variables

All of these are in `.env.example`. On Render, set them in the service's **Environment** tab. Never commit real values.

| Variable | What to put | Where it comes from |
|---|---|---|
| `SHOPIFY_API_KEY` | App client ID | Partner Dashboard → Apps → Tradepass → Client credentials |
| `SHOPIFY_API_SECRET` | App client secret (also checks webhooks, the app proxy and Flow requests) | Same place |
| `SHOPIFY_APP_URL` | Public URL of the app, e.g. `https://tradepass.onrender.com` | Render (the CLI sets it during `shopify app dev`) |
| `SCOPES` | `write_companies,write_customers,write_markets,write_products,write_publications,write_files,write_validations,read_orders,read_locales` | Already filled in; must match `shopify.app.toml` |
| `DATABASE_URL` | Neon **pooled** connection string (host contains `-pooler`) | Neon → Connect |
| `DIRECT_DATABASE_URL` | Neon **direct** connection string (used for migrations) | Neon → Connect, pooling off |
| `ENCRYPTION_KEY` | 32 random bytes, base64: `openssl rand -base64 32`. Encrypts tax numbers. **Never change it** once there's data (old numbers would become unreadable) | The agent generates it |
| `LINK_TOKEN_SECRET` | Long random string: `openssl rand -hex 32`. Signs more-info and renewal links, and salts spam-protection hashes | The agent generates it |
| `JOB_SECRET` | Long random string. cron-job.org sends it as `X-Tradepass-Job-Secret` | The agent generates it |
| `BREVO_API_KEY` | Brevo API key | Brevo → SMTP & API |
| `BREVO_SENDER_EMAIL` | Verified sender address | Brevo → Senders |
| `BILLING_TEST` | `false` in production; `true` on a staging app so charges are test charges | — |
| `SUPPORT_EMAIL` | The support address shown in Help | Your email |

`render.yaml` also sets `NODE_VERSION=22.12.0` and `NODE_ENV=production`.

Optional variables the code reads that aren't in `.env.example` yet:
- `HMRC_CLIENT_ID`, `HMRC_CLIENT_SECRET`: UK VAT checks. Register an application on the HMRC Developer Hub (https://developer.service.hmrc.gov.uk) and subscribe it to "Check a UK VAT number". Without them, UK numbers show "Couldn't check".
- `ABN_GUID`: Australian ABN checks. Register for a free GUID at https://abr.business.gov.au/Tools/WebServices. Without it, a mistyped ABN is still caught by a local checksum, and valid-looking ones show "Couldn't check".
- `SHOP_CUSTOM_DOMAIN`: template option for a custom shop domain; not needed.

## Endpoints
- `GET /healthz` returns `ok` instantly and never uses the database.
- `POST /jobs/hourly` and `POST /jobs/daily` need the `X-Tradepass-Job-Secret` header and return JSON with a result per task.
- `POST /flow/approve` is the Flow action (HMAC-checked).
- `/proxy/*` is reached through the app proxy `/apps/tradepass/*` (signature-checked).
- `/webhooks/*` handles uninstall, scope and subscription updates, and the three privacy webhooks.
- `/app/*` is the embedded admin.
