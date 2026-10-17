# App Store listing draft (English)

The English source for the subtitle and description is `docs/listing/en.json`; the text below is copied from it. Before publishing: 🔲 confirm the name is free on the App Store.

## Name
**Tradepass: Wholesale Signup** (27 characters)

## Subtitle (≤ 100 characters)
Approve wholesale buyers into the right price tier automatically, built on Shopify's native B2B.

## Description
Tradepass turns wholesale signups into Shopify B2B buyers in one click.

Businesses apply through a form on your store, in their own language. They can upload resale certificates, and EU, UK and Australian tax numbers are checked automatically. You review each application, then approve, reject or ask for more information.

Approving creates the company, location and contact in Shopify, applies payment terms and tax exemptions, and puts the buyer in the right price tier. On Basic, Grow and Advanced plans, Tradepass places the buyer in the right B2B market for you and keeps track of your 3-catalog limit. On Plus, catalogs are assigned directly.

Tradepass also tracks certificate expiry dates and asks buyers for a new certificate before the old one runs out. You choose what retail visitors see: show prices, hide them until sign-in, or make your store wholesale-only. No theme code is changed.

Includes 36 languages, auto-approve rules, Shopify Flow, CSV import and a free plan.

## Feature bullets
- **Wholesale application form** on your store, in 36 languages, with certificate upload, automatic EU, UK and Australian tax-number checks, and spam protection without captchas.
- **One-click approval** creates the B2B company, location and contact, with payment terms and tax exemptions (US state resale, EU reverse charge).
- **Automatic price tiers** on Basic, Grow and Advanced: the buyer lands in the right B2B market, and your 3-catalog limit is tracked for you. Direct catalog assignment on Plus.
- **Certificate vault** with expiry tracking and automatic renewal requests by email.
- **Storefront access control**: show prices, hide them until sign-in, or lock checkout to wholesale buyers. No theme code edits.
- **Automation**: auto-approve rules, Shopify Flow triggers and an approval action, CSV import and conversion of tagged customers.

## Screenshot plan (1600 × 900, English admin)

| # | Screen | Caption | Alt text |
|---|---|---|---|
| 1 | Application detail with the Approve modal open, exemption suggested | Approve a wholesale buyer in one click | Tradepass approve dialog showing the Retailer tier, Net 30 payment terms and a suggested Texas resale tax exemption |
| 2 | Approval progress with all steps ticked | Company, terms, tax and tier set up for you | Approval progress list with company, location, contact, terms and tax, tier and email steps all completed |
| 3 | Storefront application form on mobile (two phones: English and Arabic) | A mobile-friendly form in 36 languages | Wholesale application form on two phones, one in English and one in Arabic laid out right to left |
| 4 | Tiers list showing "2 of 3 B2B catalogs used" | Price tiers that respect Shopify's catalog limit | Tiers page listing Retailer and Distributor tiers with discounts, buyer counts and a 2 of 3 catalogs used indicator |
| 5 | Storefront page with access modes and Preview as (three columns) | Choose what retail visitors see | Storefront settings with the hide prices option selected and a preview of a retail visitor, a signed-in customer and a wholesale buyer |
| 6 | Product page on Dawn with "Log in / Apply for wholesale" instead of price | Hide prices until buyers sign in | Product page where the price and add to cart button are replaced by log in and apply for wholesale buttons |
| 7 | Certificates page with Valid, Expiring soon and Expired badges | Track certificate expiry and request renewals | Certificates table with resale and VAT certificates, expiry dates and status badges |
| 8 | Home with readiness card, checklist and 30-day numbers | See setup status and results at a glance | Tradepass Home showing plan readiness, a setup checklist and application and approval numbers for the last 30 days |

## FAQ (for the listing)

**Do I need Shopify Plus?**
No. Tradepass works on Basic, Grow, Advanced and Plus. Home shows whether B2B is available on your current plan.

**Why can I only have 3 tiers?**
On plans below Plus, Shopify allows 3 B2B catalogs per store, and each tier needs one. Catalogs you made outside Tradepass count too. Plus stores don't have this limit.

**How do buyers sign in?**
With Shopify customer accounts: they enter their email and get a one-time code. After approval they get an email explaining this.

**Where are uploaded documents stored?**
In your own Shopify Files (Content → Files). Tradepass keeps only a reference to each file.

**Can I hide prices completely?**
Yes. Choose to hide prices until a wholesale buyer signs in, or make the whole store wholesale-only.

**Does it work with my theme?**
Tradepass works with Online Store 2.0 themes through an app embed and an app block, without changing theme code. For unusual themes you can tell Tradepass where your theme shows prices.

**What happens if I uninstall?**
Companies, customers, markets and catalogs stay in Shopify because they're yours. Price hiding and the wholesale-only checkout stop right away. Tradepass deletes its own data 48 hours later.

**Does it work with Shopify POS?**
Buyers and tiers are standard Shopify B2B, so they work wherever Shopify supports B2B. The wholesale-only checkout lock doesn't apply to POS sales.

**How are tax exemptions applied?**
When you approve, Tradepass suggests the right exemption (for example a US state resale exemption or EU reverse charge) and saves it on the buyer's company location. Shopify applies it at checkout.

**What if a VAT number check fails?**
The application shows "Couldn't check". Nothing is blocked: you decide whether to approve, ask for more information or reject.

**Can I import my existing wholesale customers?**
Yes, on the Pro plan. Upload a CSV file, or convert customers that already have a tag such as "wholesale".

**Which languages are supported?**
36 languages. The form, storefront messages and emails appear in each visitor's language, and you can change any text.

## Pricing text

| Plan | Price | Includes |
|---|---|---|
| **Free** | $0 | Unlimited applications, 10 approvals per month, 1 tier, show or hide prices, standard emails in 36 languages |
| **Starter** | $9.99/month | Unlimited approvals, up to 3 tiers with automatic tier assignment, wholesale-only mode, certificate vault with expiry tracking and renewal emails, tax-number checks |
| **Pro** | $19.99/month | Everything in Starter, plus auto-approve rules, multiple forms, CSV import and tag conversion, Shopify Flow triggers and action, priority support |

Paid plans include a 14-day free trial (once per store). Charges are billed by Shopify in USD. Applications are always collected, even when the Free plan's approvals are used up.

> Before publishing, confirm the App Store address used by the Free plan's "Powered by Tradepass" link (DECISIONS D-077).

## Translations
The translated subtitle and description for all 36 languages are in `docs/listing/<locale>.json` (for example `docs/listing/de.json`, `docs/listing/pt-BR.json`), one file per locale with the same `subtitle` and `description` keys as `en.json`. All 35 translations are done and checked (`node scripts/i18n-check.mjs`); `en.json` is the source. Paste each language's subtitle and description into the matching Partner Dashboard listing language.
