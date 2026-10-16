# Privacy and data handling

Tradepass collects wholesale applications for a merchant. The merchant is the controller, and Tradepass processes the data on their behalf.

## What we store, and where

| Data | Where | Why | Deleted when |
|---|---|---|---|
| Applicant answers (company, name, email, phone, addresses, custom answers) | Our Postgres (Neon, EU/US region chosen at setup), `Application.answers` | To review and approve the application | customers/redact, shop/redact, retention setting (default 12 months after rejection or withdrawal), "Delete all Tradepass data" |
| Tax / VAT / resale numbers | Our Postgres, **encrypted** (AES-256-GCM) | Verification, exemptions | Same as above |
| Certificates and documents | The **merchant's own Shopify Files**; we store only the file id | Proof of tax-exempt status | We delete our reference. The file stays in the merchant's Files (their data) unless they delete it. |
| Approved buyers | Shopify companies, locations and contacts (the merchant's data); we store only their ids, the company name and the tier | Tier management | shop/redact or "Delete all" (Shopify companies are never deleted by us) |
| Emails sent | Hash of the recipient address, type, status, date | Quota and delivery log | Content is removed after sending; rows are pruned after 90 days |
| Activity log | Action, ids, result (never names, emails or numbers) | Audit trail | Pruned after 24 months; shop/redact |
| Spam protection | Hashed IP and email counters per hour | Rate limiting | Pruned hourly |

We never log personal data to server logs, and error reports are redacted. We store only the fields the merchant's form asks for.

## Privacy webhooks
- `customers/data_request`: we find the applications linked to the customer (by email or customer id) and record a data-request entry so the merchant can export them. The entry holds ids only.
- `customers/redact`: we delete that customer's applications, file references, certificates (application-linked), link tokens and email-log rows.
- `shop/redact` (48 h after uninstall): we delete every row for the shop in every table.

All three live in `app/lib/privacy.server.ts`, which is also used by "Delete all Tradepass data".

## Certificate file access (see DECISIONS D-006, proposed)
Files live in the merchant's Shopify Files. Tradepass never shows a file's link on the storefront or in emails, and the admin opens files only through an authenticated Tradepass page. Shopify file links are unguessable but not access-controlled, so anyone who already has a link could open it.

## Sub-processors
Render (hosting), Neon (database), Brevo (transactional email), Shopify. Official tax registries (EU VIES, optionally UK HMRC and Australian ABN Lookup) receive only the tax number being checked.
