# Notes for Shopify app reviewers

Tradepass lets businesses apply for wholesale on a store, and turns approved applicants into native Shopify B2B companies placed in the right price tier (a B2B market with its own catalog on Basic, Grow and Advanced; a catalog assigned directly on Plus).

**Test store:** `<dev-store>.myshopify.com` (Grow plan, B2B on, new Markets on). Staff login: `<provided in the submission form>`.
**Test applicant inbox:** use any email address you can read; the buyer signs in with Shopify customer accounts (email + one-time code).
**Plan:** development stores get every feature free, so no charge is created. Billing uses the Shopify Billing API only.

The app uses only the GraphQL Admin API, session-token auth, Polaris web components with App Bridge, a theme app extension (no theme files are edited), one cart and checkout validation Function, and Flow extensions. The first request after a quiet period can take up to a minute while our free host wakes; the storefront is unaffected.

## Step-by-step test

### 1. Install and Home (2 min)
1. Install the app from the submission link. It opens on Home with a one-question welcome ("Who do you sell wholesale to?"). Pick any answer.
2. Home → **Plan and readiness** shows the plan, B2B availability, Markets status and "0 of 3 B2B catalogs used".
3. The **Setup checklist** lists six steps. They turn green as you do the steps below.

### 2. Create a tier (1 min)
1. **Tiers** → **Create tier**. Name "Retailer", **Percentage off retail** 20, **All products**, payment terms **Net 30** → **Create tier**.
2. Shopify admin → **Markets** shows a B2B market "Tradepass Retailer" with a catalog at −20%.

### 3. Turn on the storefront pieces (2 min)
1. **Storefront** → **Open theme editor**. The theme editor opens on **App embeds** with "Tradepass" selected. Switch it on → **Save**.
2. Create a page: Online Store → **Pages** → **Add page** → title "Wholesale" → **Save**.
3. **Form** → "Add the form to a page" → follow the link. The theme editor opens with the **Wholesale application** block being added on the page template. Assign the template to the "Wholesale" page if asked → **Save**.
4. Back in Tradepass → **Storefront** → **Check again**: the embed shows On.

### 4. Submit an application (2 min)
1. Open `https://<dev-store>.myshopify.com/pages/wholesale` in a private window.
2. Fill the form (company, name, your email, a US billing address in Texas, any resale certificate number), attach a small PDF, tick consent → **Send application**. The button shows "Sending…", then a thank-you screen.
3. The applicant receives "Application received". The certificate is in Shopify admin → **Content** → **Files** with a random name.

### 5. Approve (2 min)
1. **Applications** → open the new application. The tax section shows the certificate; **View file** opens it (staff only).
2. **Approve**. The modal has the tier "Retailer", Net 30 and "US reseller exemption (TX)" prefilled. Click **Approve**.
3. Progress: Company ✓ → Location ✓ → Contact ✓ → Terms and tax ✓ → Tier ✓ → Email ✓.
4. Shopify admin → **Customers** → **Companies**: the company, its location (Net 30, Texas exemption) and contact exist; the location is in the "Tradepass Retailer" market.
5. The applicant receives Shopify's B2B welcome email. In a private window, sign in with that email and the one-time code: prices are 20% lower.

### 6. Price hiding and wholesale-only (2 min)
1. **Storefront** → **Hide prices from non-wholesale visitors** → **Whole store** → **Save**. In a private window, product and collection pages show "Log in" / "Apply for wholesale" instead of prices. Signed in as the buyer, prices show.
2. **Storefront** → **Wholesale-only store** → confirm → **Save**. In a private window, add a product to the cart and open `/checkout`: checkout is blocked with "This store sells to approved wholesale customers only…". The buyer can check out. The rule appears under Settings → Checkout → Checkout rules.
3. Switch back to **Show prices to everyone** → **Save**.

### 7. Other areas (optional)
- **Applications** → **Needs info**: the applicant gets a single-use link to a page showing only the requested fields.
- **Buyers**: move between tiers, pause and resume access.
- **Certificates**: expiry tracking and renewal requests.
- **Automation**: auto-approve rules; Flow triggers ("Wholesale application submitted", etc.) and the action "Approve wholesale application to tier".
- **Import**: CSV template and tag conversion.
- **Help**: guide, FAQ, "Copy diagnostic info".
- Change the admin language (e.g. Deutsch or العربية): the whole app follows it; Arabic is right-to-left.

### Uninstall
Uninstalling leaves no theme code. Price hiding and the checkout rule stop immediately. Companies, customers, markets and catalogs stay in Shopify. Our data is deleted when `shop/redact` arrives 48 hours later. The three privacy webhooks are implemented.

### Scopes
`write_companies`, `write_customers`, `write_markets`, `write_products`, `write_publications`, `write_files`, `write_validations`, `read_orders`, `read_locales`. Each is explained in the listing's data section and in our DECISIONS (D-007, D-016). Protected customer data (name, email, phone, address) is used only for applicants and buyers.

---

## Screencast script (about 3 minutes)

Record at 1280×800, admin language English. Narration in quotes; actions in brackets.

**0:00–0:15 — Intro**
[Shopify admin, Tradepass Home open]
"This is Tradepass. It lets businesses apply for wholesale on your store and turns approved applicants into Shopify B2B buyers in the right price tier. This store is on the Grow plan."

**0:15–0:35 — Home**
[Point at Plan and readiness, then the setup checklist]
"Home checks the plan, B2B and Markets, and shows the 3-catalog budget Shopify allows below Plus. The checklist walks through setup."

**0:35–0:55 — Tier**
[Tiers → Create tier → Retailer, 20%, All products, Net 30 → Create]
"A tier is a price level. Tradepass creates the B2B market, catalog and price list for it. Here, Retailer gets 20% off with Net 30 terms."

**0:55–1:15 — Storefront setup**
[Storefront → Open theme editor → App embeds → Tradepass on → Save; then the Wholesale page with the application block]
"Everything on the storefront runs from a theme app extension. We switch on the app embed and add the application form block to a page. No theme code is changed."

**1:15–1:40 — Application**
[Private window: fill the form on mobile size, attach a PDF, Send application, thank-you screen]
"A business fills in the form in its own language, with a resale certificate. If the connection drops, the form keeps the answers and retries."

**1:40–2:15 — Approve**
[Applications → open → Approve modal → Approve → progress ticks]
"The merchant reviews the application. Tradepass suggests the Texas resale exemption from the certificate. One click creates the company, location and contact, sets Net 30 and the exemption, and puts the location in the Retailer market. Each step is checked by reading it back from Shopify."
[Shopify admin → Companies → the new company]
"Here it is in Shopify."

**2:15–2:35 — Buyer sees prices**
[Private window: sign in with the one-time code; product page with the lower price]
"The buyer signs in with a one-time code and sees Retailer prices straight away."

**2:35–2:55 — Access modes**
[Storefront → Hide prices → Save; private window shows Log in / Apply; switch to Wholesale-only and show the blocked checkout]
"Retail visitors can see prices, see a Log in or Apply message instead, or the store can be wholesale-only, where checkout is blocked for non-wholesale buyers."

**2:55–3:05 — Close**
[Help page]
"Tradepass also tracks certificate expiry, supports Flow, auto-approve rules and CSV import, and works in 36 languages. Thanks for reviewing."
