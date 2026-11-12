# Privacy and data handling

Tradepass collects wholesale applications for a merchant. The merchant is the controller, and Tradepass processes the data on their behalf. We store only what the merchant's form asks for, keep Shopify data in Shopify (we store its IDs, not copies), and never sell or share data.

## Where data lives

- **Our database:** Neon Postgres (region chosen at setup: US West/Oregon by default, or Frankfurt). Encrypted in transit (TLS) and at rest by Neon.
- **Our server:** Render (one web service). Nothing personal is written to its disk, and server logs never contain personal data.
- **The merchant's Shopify store:** companies, locations, contacts, customers and uploaded files. These belong to the merchant and stay there.

## What we store, and for how long

| Data | Where | Why | Kept until |
|---|---|---|---|
| Applicant answers: company name, first and last name, email, phone, job title, website, addresses, business details, custom answers, message, chosen language; the merchant's rejection reason | Our database (`Application`) | Review and approve the application, and build the message the merchant sends the applicant | Rejected/withdrawn: deleted after the retention setting (default **12 months**). Otherwise until customers/redact, shop/redact or "Delete all Tradepass data" |
| Tax, VAT, ABN or resale numbers | Our database, **encrypted** (AES-256-GCM) on the application and certificate | Verification and tax exemptions | Same as the application or certificate |
| Tax-number fingerprint (SHA-256 of the normalised number) | Inside the application's answers | Spotting duplicate applications without decrypting | Same as the application |
| Tax-check result and the name the registry returned (e.g. "ACME GMBH") | Our database | Shown to the merchant when reviewing | Same as the application |
| Certificates and documents | The **merchant's own Shopify Files**. We store only the file ID, type, country/state, encrypted number, dates and status | Proof of tax-exempt status | Our record: with the application/buyer, or on redact. The file: deleted with rejected applications by the retention job when "delete files" is on (default on); otherwise it stays in the merchant's Files (their data) |
| Approved buyers | Shopify companies, locations and contacts (the merchant's data). We store their IDs, the company name, country, tier, status and tax exemptions | Tier management | shop/redact or "Delete all". We never delete Shopify companies or customers |
| Activity log | Who did what, when, result, with our IDs or Shopify IDs only (never names, emails or numbers) | Audit trail | **24 months**, or shop/redact |
| Import runs | Uploaded CSV rows (may include names, emails, addresses) while the run is open; afterwards row numbers and problem codes only | Resumable imports | Row data cleared when the run finishes or is cancelled; the run record until shop/redact |
| Spam protection | Salted hashes of IP addresses and emails, counted per hour; a salted IP hash on each application | Rate limiting | Counters deleted after 2 hours; the application's hash with the application |
| Link tokens | Hash of each more-info or renewal link token, purpose, expiry, used time (tokens contain no personal data). Status links (90 days, read-only) are signed but not stored | Single-use links | 7 days after expiry |
| Where the applicant came from | Five short values: UTM source, medium and campaign, the referring site's **host only** (never the full URL) and the landing path. Kept in the visitor's tab (`sessionStorage`, no cookie) until they apply | The merchant's "where applications come from" numbers (D-102) | Same as the application |
| US seller's permits | Per state: the state and the permit number, **encrypted**; the result of a live check (Texas open data) or who marked it as checked and when | Tax exemptions per state (D-098, D-099) | Same as the certificate |
| Saved replies, applicant/contact settings | The merchant's own texts and links (WhatsApp, booking, shopping), customer tags to add | Messages and approval | Until changed, or shop/redact |
| Staff sessions | Shopify session data (template), which can include the staff member's name and email | Admin sign-in | Deleted on uninstall |
| Store details | Store name, primary domain, country, currency, plan facts, settings | Running the app | shop/redact |

Applicants who are already logged in are linked to their Shopify customer ID. For imported buyers, the contact's email address (filled into the renewal message the merchant sends) is read live from Shopify each time and never stored.

**Tradepass sends no email** (DECISIONS D-091). When a buyer is approved with "Send welcome email" on, Tradepass asks Shopify to send its own B2B welcome email (`companyContactSendWelcomeEmail`); Shopify sends it. For "more information", "not approved", "you're approved" and certificate renewal, the merchant sees a ready-made message and sends it themselves: copied, or opened in their own mail app, Gmail, Outlook, WhatsApp, their phone's text messages, Telegram or LINE through an ordinary link (D-103). Nothing about it passes through Tradepass's servers beyond showing it in the admin, and Tradepass uses no SMS or messaging gateway.

**The browser draft.** The storefront form saves an unfinished application in the visitor's own browser (`localStorage`) so a reload doesn't lose it. Files and the tax number are never saved there (D-112).

**Status for applicants.** A signed-in customer who applied sees their status on the form, on a status page and, if the merchant adds the block, in their customer account. Only the stage, dates and the merchant's own links are shown (D-104).

## Encryption and other protections
- Tax numbers are encrypted with AES-256-GCM using `ENCRYPTION_KEY`, which exists only in the server's environment. They're decrypted only to show to the store's own staff (lists show them masked).
- More-info links (14 days) and renewal links (60 days) are signed, single-use and contain no personal data.
- App proxy requests, webhooks and Flow requests are checked with Shopify's HMAC signatures (constant-time compare); stale proxy requests (older than 5 minutes) are rejected.
- Uploaded files are checked by content (PDF, JPG, PNG only, max 5 MB each, up to 3 per upload question) and stored with random names. They're never shown as web pages.
- Every database query is limited to the signed-in store.
- Merchant-entered texts are cleaned before they reach the storefront.

## Certificate file access (DECISIONS D-006, proposed)
Files live in the merchant's Shopify Files. Tradepass never shows a file's link on the storefront or in the messages merchants send. In the admin, files open through `/app/files/:id`, which checks the signed-in store and streams the file, so the Shopify link isn't sent to the browser. Shopify file links are unguessable but not access-controlled, so anyone who already had a link could open it.

## Privacy webhooks
- `customers/data_request`: we find the applications linked to the customer (by email or customer ID) and record a "data request" entry in the activity log with the application IDs only. The merchant downloads everything we hold about that customer from Settings → Privacy requests (JSON).
- `customers/redact`: we delete that customer's applications, their file references, application certificates and link tokens, and queue deletion of their uploaded documents from the merchant's Shopify Files (done within the hour, so the webhook answers fast). Buyer rows (company IDs and company name, which is business data) stay because the company belongs to the merchant.
- `shop/redact`: we delete every row for the store in every table, including the store record and sessions.

All three live in `app/lib/privacy.server.ts`, which also powers "Delete all Tradepass data".

## Uninstall
- Right away: staff sessions are deleted, price hiding stops (the theme extension is switched off by Shopify), and Shopify removes the checkout-lock Function and our app metafields. No theme code is ever changed, so nothing is left in the theme.
- **48 hours later:** Shopify sends `shop/redact` and we delete all of the store's data. If the merchant reinstalls before then, their tiers, settings and applications are restored.
- Companies, customers, markets, catalogs and files in Shopify stay; they're the merchant's.

## "Delete all Tradepass data" (Settings → Danger zone)
The merchant types the store name to confirm. We delete all our rows for the store (applications, files references, certificates, buyers, tiers, forms, activity, jobs, imports, tokens, rules) and reset settings, but keep the store record, plan and sessions so the app stays installed (DECISIONS D-020). Shopify companies, markets, catalogs and files stay.

## Sub-processors
Render (hosting), Neon (database), Shopify. Tradepass uses no email provider (Brevo was removed in D-091; no personal data was ever sent to it in production because the app was not yet deployed). Official registries receive only the number being checked: EU VIES (`ec.europa.eu`), Norway's Brønnøysund Register Centre (`data.brreg.no`), the Texas Comptroller's open data (`data.texas.gov`), and, only when the merchant's operator sets a key, UK HMRC (`api.service.hmrc.gov.uk`), Australian ABN Lookup (`abr.business.gov.au`) and the New Zealand Business Number register (`api.business.govt.nz`). All are free government services; links to other official lookups (Switzerland, Canada, US states, IRS) are opened by the merchant in their own browser.
