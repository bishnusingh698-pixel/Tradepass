Merged into API_NOTES / DECISIONS / CHECKLIST on 2026-10-17

# Emails, notifications, certificates — area notes

## API notes

Checked on 2026-10-16.

- **Brevo transactional email** ✅ (https://developers.brevo.com/reference/send-transac-email): `POST https://api.brevo.com/v3/smtp/email`, header `api-key`, JSON `sender {name ≤70, email}`, `to [{email}]`, `replyTo {email}`, `subject`, `htmlContent`, `textContent`, `headers` (non-standard only; we send `IdempotencyKey` = EmailLog id), `tags`. 201 → `{ messageId }`. Errors are documented only as 400 `{ code, message }`. Codes such as `unauthorized` and `Insufficient credits` appear inside the 400. We treat 5xx, 429, 401/403 and account-type codes as "retry later" and other 4xx as permanent.
  - ⚠️ The sender **email** must be a verified sender or domain in *our* Brevo account (`BREVO_SENDER_EMAIL`). Only the sender **name** is the store name. Reply-to is `Shop.email`.
- `companyLocationTaxSettingsUpdate(companyLocationId!, exemptionsToRemove: [TaxExemption!], …)` ✅ returns `companyLocation`, `userErrors { field message }`. Needs `write_companies` (or `write_customers`) and B2B. It is not deprecated.
- `GenericFile { url mimeType fileStatus … }` and `MediaImage { mimeType image { url } }` ✅. Both are read through `node(id:)` (Node interface). Needs `read_files` or one of several read scopes (`read_products` qualifies, so it's already covered by `write_products`).
- `CompanyContact { locale company { name } customer: Customer! }` and `Customer { firstName locale defaultEmailAddress { emailAddress } }` ✅. ⚠️ `Customer.email` is **deprecated**, so we use `defaultEmailAddress.emailAddress`.
- App Bridge Save Bar ✅: `<form data-save-bar data-discard-confirmation>`. Save fires `submit` and Discard fires `reset`. `shopify.saveBar.leaveConfirmation()` is called before programmatic navigation (we use it for the language switcher).
- The app proxy renewal link is `https://{shop}/apps/tradepass/renew/{token}?lang=xx`, which maps to `/proxy/renew/:token`. The signature check uses `verifyProxyRequest`.

## Decisions

- **Caps.** Every queued email reserves a slot on a UTC `quotaDay` (25 per shop, 250 in total). Reservations take a Postgres advisory transaction lock, so concurrent requests and jobs can't overshoot. Overflow reserves the next day with room. It is never dropped, and the merchant sees "N emails are waiting for tomorrow" on Notifications and in the digest. Leftovers from an earlier day (for example while Brevo was down) re-reserve today's quota before sending. `skipped` rows don't count. `failed` rows do, because Brevo may have counted them.
- **Instant merchant alerts** count toward the shop's 25. When today is full, the alert isn't queued (`reason: "quota_deferred"`) because the daily digest lists every pending application. In effect it switches to the digest automatically. Use `notifyMerchantNewApplication(shop, { applicationId, company })` from intake.
- **Digest.** It is sent once per UTC day when the mode is instant or digest and there's something to report (pending applications, expiring certificates, expired certificates awaiting a decision, failed activity in the last 24 h, deferred emails). It goes to `settings.notifications.merchant.email` or else `Shop.email`, in the store's primary language.
- **Rendering at send time.** It uses the recipient's language and falls back to the store primary, then English. Merchant overrides are `settings.texts[locale]["email.<type>.subject"|"body"]`. A broken override falls back to the built-in text and never blocks sending. The `{reason}`, `{message}` and `{terms}` extras (from the lead) are appended as their own paragraph only when they have a value and the body doesn't already use them. An empty `{first_name}` falls back to the company name.
- **Status `sending`** (new string value on EmailLog.status) claims a row so overlapping job runs never send twice. Rows stuck in it for more than 15 minutes return to `queued`, and Brevo's IdempotencyKey guards the retry.
- **Immediate send.** After queueing for today we try to send at once, fire-and-forget, so "Application received" doesn't wait an hour. The hourly job is the safety net.
- **Certificates.** Review state (`pending`, `rejected`) is stored. `valid`, `expiring` and `expired` are derived from `expiresOn` and refreshed daily. The expiry day itself still counts as valid. Reminders at 30 and 7 days and the expiry email are each claimed atomically in `remindedAt` (`"30"`, `"7"`, `"expired"`) before queueing, so reruns never double-send. Setting a new expiry date resets the reminders.
- **Renewal links** are valid for 60 days and single-use (TokenUse). A newer link invalidates older unused ones. The link is consumed only after the upload succeeds. A new upload sets the certificate to `pending` and clears the reminders, rejection and expiry decision.
- **Expiry → tax exemption** (Proposed: merchant-facing). With `onExpiry: "ask"` (the default), the certificate shows "Decide about the tax exemption" with Keep or Remove (an s-modal confirmation). With `"remove"`, the daily job removes the exemption automatically. Removal only takes off the exemption *this* certificate backs: US resale maps to `US_<state>_RESELLER_EXEMPTION`, and EU VAT maps to `EU_REVERSE_CHARGE_EXEMPTION_RULE`. It is applied to every company location of the buyer, and skipped when another valid certificate covers the same exemption. Certificates we can't map (CA, licence, other) are never removed automatically.
- **Recipient for buyer-only certificates** (imported, no application): read live from Shopify (`companyContact.customer.defaultEmailAddress`) and never stored.
- **Files** (D-006): `/app/files/:id` looks up the Certificate or ApplicationFile by id **and** session shop, reads the URL through the shop's Admin API, and streams the bytes with `nosniff`, a sandbox CSP and `no-store`. The admin page fetches it with App Bridge's session token and opens a blob URL, so the CDN link never reaches the browser.
- **Plan gate.** The Certificates page stays visible on Free with actions disabled and an "Available on Starter" banner. The daily certificate job only runs for plans with `certificate_vault`.
- **Proposed:** we don't add a "Sent with Tradepass" footer to Free-plan emails (the `no_branding` feature). Say if you want it.

## Needs live verification

- Brevo: a real send with a verified sender, plus RTL and font rendering for ar, he, ur, hi, th, zh, ja and ko in Gmail, Outlook and Apple Mail.
- Whether Polaris web components inside `<form data-save-bar>` trigger the Save Bar on input (we track state and submit our own FormData), and whether `leaveConfirmation()` blocks the language switch while unsaved.
- Whether App Bridge adds the session-token `Authorization` header to `fetch("/app/files/:id")` from the embedded page, and whether the blob-URL window opens without being blocked as a popup.
- App proxy: that a multipart POST up to 5 MB is forwarded to `/proxy/renew/:token`, and that `?lang=` survives.
- `unauthenticated.admin(shop)` in the daily job (offline token with expiring tokens enabled).
- Reading `companyContact.customer.defaultEmailAddress` with the current scopes. It may need `read_customers`. If so, only buyer-only certificates (no application) lose renewal emails.
- `companyLocationTaxSettingsUpdate` removing the exemption on a dev store with B2B.

## Checklist

1. Notifications: check that the quota line reads "0 of 25 emails used today". Turn "Not approved" off and save (the Save bar appears; click Save and see the "Saved" toast). Reject an application and check that no email arrives.
2. Notifications: switch the language to French, change the "Application received" subject, and check the preview updates. Click "Send test to me" and check the inbox: the subject starts with "Test:", there's a plain-text part (view source), and replying goes to the store email.
3. Switch to Arabic and check the preview is right-aligned and the test email reads right-to-left.
4. Type `{nope}` in a subject and click Save. A red error appears next to the field, with a summary banner at the top. Click "Use built-in text" and Save.
5. Set alerts to "Email me for each new application", submit a test application, and check the alert arrives. In the database, add 25 EmailLog rows for today and submit again: no alert is sent and it appears in the next daily summary.
6. Certificates: with a certificate expiring in 30 days, run `POST /jobs/daily`. The renewal email arrives with an upload link. Run it again: no second email.
7. Open the link, upload a PDF and see "Thank you". The certificate shows "Waiting for review". Open the link again and see "This link was already used".
8. Set the expiry date to yesterday and run the daily job. The status is Expired with "Decide about the tax exemption". Choose Manage, then Remove tax exemption, confirm, and check the company location's tax settings in Shopify.
9. Click "View file" on a certificate: the file opens in a new tab. Log into another store and try the same `/app/files/<id>`: you get Not found.
10. On the Free plan, check that Certificates shows the "Available on Starter" banner and Manage is disabled.
