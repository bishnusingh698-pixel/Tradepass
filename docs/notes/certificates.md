Merged into API_NOTES / DECISIONS / CHECKLIST on 2026-10-17. Email parts removed on 2026-11-01 (D-091): Tradepass sends no email.

# Certificates — area notes

## API notes

Checked on 2026-10-16.

- `companyLocationTaxSettingsUpdate(companyLocationId!, exemptionsToRemove: [TaxExemption!], …)` ✅ returns `companyLocation`, `userErrors { field message }`. Needs `write_companies` (or `write_customers`) and B2B. It is not deprecated.
- `GenericFile { url mimeType fileStatus … }` and `MediaImage { mimeType image { url } }` ✅. Both are read through `node(id:)` (Node interface). Needs `read_files` or one of several read scopes (`read_products` qualifies, so it's already covered by `write_products`).
- `CompanyContact { locale company { name } customer: Customer! }` and `Customer { firstName locale defaultEmailAddress { emailAddress } }` ✅. ⚠️ `Customer.email` is **deprecated**, so we use `defaultEmailAddress.emailAddress`.
- App Bridge Save Bar ✅: `<form data-save-bar data-discard-confirmation>`. Save fires `submit` and Discard fires `reset`.
- The app proxy renewal link is `https://{shop}/apps/tradepass/renew/{token}?lang=xx`, which maps to `/proxy/renew/:token`. The signature check uses `verifyProxyRequest`.

## Decisions

- **Statuses.** Review state (`pending`, `rejected`) is stored. `valid`, `expiring` and `expired` are derived from `expiresOn` and refreshed daily. The expiry day itself still counts as valid. The Flow triggers fire on the change of status, so a rerun fires nothing twice.
- **Renewal links** (Copy renewal link on one certificate) are valid for 60 days and single-use (TokenUse). A newer link invalidates older unused ones. The link is consumed only after the upload succeeds. A new upload sets the certificate to `pending` and clears the rejection and the after-expiry decision. The merchant sends the ready-made message (buyer's language) themselves.
- **Expiry → tax exemption.** With `onExpiry: "ask"` (the default), the certificate shows "Decide about the tax exemption" with Keep or Remove (an s-modal confirmation). With `"remove"` (Settings → Certificates), the daily job removes the exemption automatically. Removal only takes off the exemption *this* certificate backs: US resale maps to `US_<state>_RESELLER_EXEMPTION`, and EU VAT maps to `EU_REVERSE_CHARGE_EXEMPTION_RULE`. It is applied to every company location of the buyer, and skipped when another valid certificate covers the same exemption. Certificates we can't map (CA, licence, other) are never removed automatically.
- **Recipient for buyer-only certificates** (imported, no application): read live from Shopify (`companyContact.customer.defaultEmailAddress`) to fill in the renewal message, and never stored.
- **Files** (D-006): `/app/files/:id` looks up the Certificate or ApplicationFile by id **and** session shop, reads the URL through the shop's Admin API, and streams the bytes with `nosniff`, a sandbox CSP and `no-store`. The admin page fetches it with App Bridge's authenticated `fetch` and opens a blob URL.
- **Plan gate.** The Certificates page stays visible on Free with actions disabled and an "Available on Starter" banner. The daily certificate job only runs for plans with `certificate_vault`.

## Needs live verification

- Whether App Bridge adds the session-token `Authorization` header to `fetch("/app/files/:id")` from the embedded page, and whether the blob-URL window opens without being blocked as a popup.
- App proxy: that a multipart POST up to 5 MB is forwarded to `/proxy/renew/:token`, and that `?lang=` survives.
- `unauthenticated.admin(shop)` in the daily job (offline token with expiring tokens enabled).
- Reading `companyContact.customer.defaultEmailAddress` with the current scopes. If it needs more, only buyer-only certificates (no application) miss the address in the renewal message (the merchant types it).
- `companyLocationTaxSettingsUpdate` removing the exemption on a dev store with B2B.

## Checklist

See CHECKLIST.md Test 16.
