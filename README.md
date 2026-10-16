# Tradepass: Wholesale Signup

A public Shopify app that lets businesses apply for wholesale and puts approved buyers into the right B2B price tier automatically. It's built for Shopify's native B2B on Basic, Grow, Advanced and Plus.

Built on Shopify's React Router app template, with Polaris web components, Prisma + Postgres (Neon), Render (free) and cron-job.org.

- What's done and what's next: `progress.md` and `feature_list.json`
- Design and schema: `PLAN.md`. Choices and open questions: `DECISIONS.md`. Verified APIs: `API_NOTES.md`
- Tests for you to click through: `CHECKLIST.md`

## Local development (for the coding agent)

Requirements: Node 22.12+, Postgres 16, and a Shopify Partner account for `shopify app dev`.

```bash
cp .env.example .env          # fill in values (local Postgres is fine)
./init.sh                     # install, migrate, typecheck, lint, tests, then `shopify app dev`
./init.sh --no-dev            # same without starting the dev server
npm test                      # unit tests (Vitest)
```

## Accounts setup (one time, all free)

### 1. Shopify Partner account, app and development store
1. Go to https://partners.shopify.com and click **Join now**. Sign up with your email.
2. Create a development store: in the Partner Dashboard (or Dev Dashboard), go to **Stores**, click **Add store**, then **Create development store**. If you're offered a choice of plan, pick **Grow** (not Plus). Tick the option to start with test data if offered.
3. The app itself is created from the command line by the coding agent with `shopify app config link`. When it shows a login link and code, open the link, sign in to your Partner account and confirm the code. That fills in `client_id` in `shopify.app.toml`.
4. In the app's settings (Partner Dashboard → **Apps** → **Tradepass** → **API access**), request **Protected customer data access**. Choose **Name, Email, Phone, Address** and give the reason "Wholesale applicants and buyers: review applications and create B2B companies". This is needed before the app works on real (non-development) stores.
5. The app proxy is configured in `shopify.app.toml` (`/apps/tradepass` → `/proxy`) and is deployed with `shopify app deploy`.

### 2. Neon (database)
1. Go to https://neon.tech and click **Sign up** (GitHub sign-in is easiest).
2. Click **Create project**. Name it `tradepass`, use Postgres 16, and pick the region closest to Render's (US West/Oregon by default, or Frankfurt if you choose Render Frankfurt).
3. On the project dashboard, click **Connect**. Copy the connection string with **Connection pooling** ON, which is `DATABASE_URL`. Then switch pooling OFF and copy that one, which is `DIRECT_DATABASE_URL`.

### 3. Render (hosting)
1. Go to https://render.com and sign up with GitHub.
2. Click **New** → **Blueprint**, choose the `tradepass` repository and click **Apply**. Render reads `render.yaml` and creates one **free** web service.
3. Open the service → **Environment** and fill in each value marked "sync: false". Shopify keys come from Partner Dashboard → Apps → Tradepass → **Client credentials**. Neon gives you the two URLs. Generate `ENCRYPTION_KEY`, `LINK_TOKEN_SECRET` and `JOB_SECRET` as described in `.env.example` (the agent can generate them for you).
4. Set `SHOPIFY_APP_URL` to the service URL Render shows, for example `https://tradepass.onrender.com`. The agent then runs `shopify app deploy` so Shopify uses that URL.

### 4. cron-job.org (keep-awake and scheduled jobs)
1. Sign up at https://cron-job.org and click **Create cronjob** three times:
   - **Title** `tradepass healthz`, **URL** `https://<your-render-url>/healthz`, **Schedule** every 10 minutes, method GET.
   - **Title** `tradepass hourly`, **URL** `https://<your-render-url>/jobs/hourly`, **Schedule** every hour. Under **Advanced**, set **Request method** to POST and add the header `X-Tradepass-Job-Secret` with your `JOB_SECRET`.
   - **Title** `tradepass daily`, **URL** `https://<your-render-url>/jobs/daily`, **Schedule** daily at 03:00. Use POST and the same header.
2. Each job should show status 200 after its first run. A 401 means the secret header is wrong.

### 5. Brevo (email, needed from phase P4)
1. Sign up at https://www.brevo.com (free plan).
2. Go to **Senders, domains & dedicated IPs** → **Senders** → **Add a sender**, and verify the address emails will come from.
3. Go to **SMTP & API** → **API keys** → **Generate a new API key**. Put it in Render as `BREVO_API_KEY`, and the sender address as `EMAIL_FROM_ADDRESS`.

### Optional: UK VAT checks
Register an application on the HMRC Developer Hub (https://developer.service.hmrc.gov.uk) and subscribe it to "Check a UK VAT number". Without it, UK numbers show "Couldn't verify — check manually".

## Endpoints
- `GET /healthz` returns `ok` instantly and never uses the database.
- `POST /jobs/hourly` and `POST /jobs/daily` need the `X-Tradepass-Job-Secret` header. They return JSON with a result per task.
- `/webhooks/*` handles uninstall, scope updates and the three privacy webhooks.
- `/app/*` is the embedded admin.
