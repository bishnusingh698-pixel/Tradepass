# Test checklist (for Bishnu)

Click-by-click checks for your development stores, in the same order as the spec's acceptance tests 1–22 (tests 23–25 are at the end). Tick each box. If something looks wrong, take a screenshot and paste it in the project thread with the step number.

## Before you start

You need two development stores:

| Store | Plan | Used for |
|---|---|---|
| **Store A** | Grow (or Basic/Advanced), **not Plus**, B2B on | Every test |
| **Store B** | Plus (development) | Re-run tests 1, 7, 8, 13 and 22 |

Also have ready: a second email address you can read (for the "applicant" and "buyer"), a phone, a small PDF (under 5 MB), a 6 MB file and a .docx file.

Development stores get every paid feature for free, so plan-gated tests (Starter/Pro) work without paying. For test 20 you need a store that isn't a development store, or ask the agent to switch the plan check off temporarily.

Each test says **[A]** (non-Plus store) or **[A + B]** (also re-run on the Plus store).

---

## 0. Phase 0 spike (do this first) [A]
- [ ] 0.1 In the app, go to **Help** → **B2B compatibility test** → **Run test**. Wait up to a minute.
- [ ] 0.2 Click **Copy results** and paste them in the project thread.
- [ ] 0.3 The test company's "Main" location now sits in the −20% test market. Its contact has a fake @example.com email, so in Shopify admin open **Customers** → **Companies** → "Tradepass spike …" → **Main**, click **Add customer** and add yourself with your own email. Open your store in a private window, click the account icon, sign in with your email and the code you receive, and check that prices are 20% below normal. Tell me what you see.
- [ ] 0.4 Click **Remove test data**.

## Test 1. Fresh install, welcome and Home [A + B]
- [ ] 1.1 Partner Dashboard → **Apps** → **Tradepass** → **Test your app** → choose the store → **Install**.
- [ ] 1.2 The app opens inside Shopify admin with the welcome question "Who do you sell wholesale to?". Choose **Salons & professionals**. (Skip also works; you can reopen it from **Help**.)
- [ ] 1.3 The left menu shows: Home, Applications, Buyers, Tiers, Form, Storefront, Certificates, Notifications, Automation, Import, Settings, Help. Click each one: every page opens, none is blank.
- [ ] 1.4 Home → **Plan and readiness** shows your plan, "B2B is available on your plan" (green), whether B2B markets are on, and "0 of 3 B2B catalogs used". On store B (Plus) it says catalogs are assigned directly and there's no 3-catalog limit.
- [ ] 1.5 Click **Check again**: the card reloads without errors.
- [ ] 1.6 The **Setup checklist** shows six steps. As you do tests 3, 4 and 13, come back and check each step turns green: tier created, form reviewed (save the Form page once), embed on, form block on a page, storefront mode chosen (save the Storefront page once), test application received.
- [ ] 1.7 Change your admin language (profile picture → **Preferences** → **Language**, e.g. Deutsch), reopen the app: menu and Home are in German. Try Arabic: the layout flips right-to-left. Switch back.

## Test 2. Reinstall [A]
- [ ] 2.1 Shopify admin → **Settings** → **Apps** → Tradepass → **⋯** → **Uninstall**.
- [ ] 2.2 Install again right away (as in 1.1). It opens straight to Home with no loop and no error.
- [ ] 2.3 Your tiers and settings from before are still there, and there's only one "Wholesale application" form in **Form** (no duplicate).

## Test 3. Tiers and the 3-catalog budget [A]
- [ ] 3.1 **Tiers** → **Create tier**. Name "Retailer", **20% off**, **All products**, payment terms **Net 30** → **Create tier**. The list shows "20% off retail", 0 buyers, "Net 30", Active.
- [ ] 3.2 Shopify admin → **Markets**: a B2B market "Tradepass Retailer" exists with a catalog.
- [ ] 3.3 Create "Distributor" (30% off) and "VIP" (40% off). Home and Tiers show "3 of 3 B2B catalogs used", and **Create tier** is greyed out with an explanation.
- [ ] 3.4 Delete "VIP" (it has no buyers): tick "Also delete the market and catalog in Shopify" → confirm. Then in Shopify admin create a B2B catalog yourself. Back in Tradepass, the budget again shows 3 of 3: your own catalog counts.
- [ ] 3.5 Open "Retailer", change 20% to 25% and save. Then change it to 30% in Shopify admin. After the hourly job (or within an hour) Tiers shows **Changed in Shopify**. Click **Fix**: it's back to 25% and Active.
- [ ] 3.6 Try to delete a tier that has buyers (after test 7): it's blocked with **View buyers**.
- [ ] 3.7 (Assisted mode, only if the spike says automatic moving doesn't work.) Ask the agent to switch tier assignment to **Assisted** (there's no button for it yet), then approve someone. Home and Tiers show "1 tier assignment needs your action". Click **Open market in Shopify**, add the location, then **Check**: it's marked done.

## Test 4. Form on the store, mobile submission with a certificate [A]
- [ ] 4.1 **Storefront** → **Open theme editor** (or Online Store → Themes → Customize → App embeds icon) → switch **Tradepass** on → **Save**. Back in Tradepass click **Check again**: the embed shows On.
- [ ] 4.2 Online Store → **Pages** → **Add page**, title "Wholesale", save. In Tradepass → **Form** → "Add the form to a page", follow the links: the theme editor opens with the **Wholesale application** block being added. Save the theme.
- [ ] 4.3 **Form builder checks:** open **Form** → the form. Change "Website" to Required: the save bar appears. Click a menu item: you're asked to save or discard. Try to hide "Email": the option isn't offered. Add a Short text question without a label and click Save: a red banner lists the problem; click it to jump to the field. Give it a label and "Only show if Business type = Salon or spa", Save → "Saved". In the preview, the question appears only after choosing Salon. Switch the preview to Mobile and to Deutsch: labels change.
- [ ] 4.4 On your phone, open /pages/wholesale. The form is one column; tapping email/phone/number fields opens the right keyboard.
- [ ] 4.5 Press **Send application** with everything empty: a red box at the top lists the problems and the cursor jumps to the first field. Type a bad email and leave the field: an error shows under it.
- [ ] 4.6 Fill a few fields, close the tab, reopen the page: "We restored the answers you entered earlier." and your answers are back.
- [ ] 4.7 Billing country **United States**: a State list and ZIP code appear; the tax field says "Resale certificate number" with a state. Change to **Germany**: it says "VAT number".
- [ ] 4.8 Add the PDF: it shows as uploaded, with an optional expiry date. Try the 6 MB file and the .docx: a clear error, nothing uploaded.
- [ ] 4.9 Submit. "Thank you, your application has been sent". In Tradepass → **Applications** it's there. In Shopify **Content** → **Files** the certificate is there with a random name.
- [ ] 4.10 In the application, click **View file**: it opens in a new tab. Copy the address of that tab, log into Store B's admin and open the same `/app/files/<id>` there: you get "Not found".

## Test 5. Submitting while the server restarts [A]
- [ ] 5.1 Fill the form, turn on airplane mode, press Send, and turn airplane mode off within a minute. The button says "Sending…", then the success screen appears.
- [ ] 5.2 Applications shows only **one** new application. (The agent can also restart the Render service while you submit.)

## Test 6. Spam [A]
- [ ] 6.1 Ask the agent to send a submission with the hidden field filled, and one sent in under 3 seconds. Both see "Thank you", and **nothing** appears in Applications.
- [ ] 6.2 Submit 4 real applications with the same email within an hour: the 4th is refused with a "try later" message.
- [ ] 6.3 Submit again with an email you already used: "You've already applied. We'll be in touch." In Applications the new one has a **Duplicate** flag.

## Test 7. Approve to "Retailer", buyer sees Retailer prices [A + B]
- [ ] 7.1 **Applications** → open the application → **Approve**. Tier, payment terms, addresses and "Tax exempt" are prefilled.
- [ ] 7.2 Click **Approve** and watch Company ✓ → Location ✓ → Contact ✓ → Terms and tax ✓ → Tier ✓ → Welcome email ✓.
- [ ] 7.3 Shopify admin → **Customers** → **Companies**: the company, its location (Net 30, tax settings) and contact exist. On store A the location is in the "Tradepass Retailer" market; on store B the Retailer catalog is assigned directly to the location.
- [ ] 7.4 The applicant's inbox has Shopify's B2B welcome email. In a private window, sign in with that email and the one-time code: products show Retailer prices.
- [ ] 7.5 Approve an applicant whose email is already a customer: the modal offers "Link existing customer", and says so if they already belong to another company.

## Test 8. Two approvals at the same moment [A + B]
- [ ] 8.1 Open two different pending applications in two browser tabs. Click **Approve** in both within a second of each other (one to Retailer, one to Distributor).
- [ ] 8.2 Both finish. In Shopify each location is in the right market (store B: right catalog).

## Test 9. Failure at the tier step, Retry and Undo [A]
- [ ] 9.1 In Shopify admin delete the "Tradepass Retailer" market. Approve someone to Retailer: the Tier step shows a plain-language error.
- [ ] 9.2 Tiers → **Fix** on Retailer, then on the application click **Retry**: it finishes and there is still only one company for it in Shopify.
- [ ] 9.3 Repeat 9.1 with another application, then click **Undo what was created**: the company disappears from Shopify. (The customer stays as a normal customer; Tradepass never deletes customers.)

## Test 10. Tax exemptions and VAT checks [A]
- [ ] 10.1 Submit as a US applicant in Texas with a resale certificate number. On Approve, "US reseller exemption (TX)" is suggested. Approve and check the location's tax settings in Shopify show the Texas exemption.
- [ ] 10.2 (Store address in France.) Submit with a real German VAT number. The application shows "VIES: <company name> ✓", and Approve suggests EU reverse charge.
- [ ] 10.3 Submit with a VAT number when VIES is down (ask the agent to simulate it): the application shows "Couldn't check" and is still saved.

## Test 11. Ask for more info [A]
- [ ] 11.1 On a pending application click **Needs info**, tick "Phone", write a message, send.
- [ ] 11.2 The applicant email has a link. Open it: only the phone field shows. Submit: "Thank you, your application has been updated". The application is back in Pending with the new phone.
- [ ] 11.3 Open the link again: "This link has already been used".
- [ ] 11.4 Ask the agent for an expired link (older than 14 days): it shows a friendly "expired" message.

## Test 12. Reject, emails and caps [A]
- [ ] 12.1 **Reject** an application with a reason and "Email the applicant" on: the email arrives with the reason.
- [ ] 12.2 **Notifications**: the quota line reads "N of 25 emails used today". Turn "Not approved" off → Save (save bar → **Save** → "Saved"). Reject another: no email arrives.
- [ ] 12.3 Switch the language to French, change the "Application received" subject: the preview updates. **Send test to me**: the subject starts with "Test:", there's a plain-text part, and replying goes to the store email. Switch to Arabic: the preview and test email are right-to-left.
- [ ] 12.4 Type `{nope}` in a subject and Save: a red error next to the field and a summary banner. Click **Use built-in text** and Save.
- [ ] 12.5 Set alerts to "Email me for each new application" and submit: the alert arrives.
- [ ] 12.6 Ask the agent to fill today's quota (25 rows). Trigger another email: Notifications says "1 email is waiting for tomorrow", and it goes out the next day.

## Test 13. Hide prices (access mode 2) on four themes [A + B]
Repeat on **Dawn**, **Horizon** and two other free themes (e.g. Sense, Craft). Online Store → Themes → add theme → **Publish** each in turn.
- [ ] 13.1 **Storefront** → "Hide prices from non-wholesale visitors" → **Whole store** → Save.
- [ ] 13.2 In a private window: product page, collection page, search results, predictive search (type in the search box), quick add, cart drawer and sticky add-to-cart show no prices or Add to cart, and show **Log in** / **Apply for wholesale**. Nothing looks broken.
- [ ] 13.3 Sign in as the approved buyer: prices and Add to cart are back everywhere; buy something.
- [ ] 13.4 Change the scope to **Chosen collections** → pick one → Save, wait a minute: only that collection's products are hidden.
- [ ] 13.5 The Storefront preview shows Log in / Apply in the retail and logged-in columns and prices in the wholesale column.
- [ ] 13.6 Texts: pick Français, change "Log in button", Save; check it on the French storefront. "Reset to default" removes it. Colours: set a button colour, the preview changes; "Use theme colour" clears it.
- [ ] 13.7 Mode **Show prices to everyone** with the banner on: "Buying for a business? Apply for wholesale" shows for retail visitors. Add the **Apply for wholesale** block to the footer as a **Banner**: it links to /pages/wholesale.
- [ ] 13.8 Report any theme where something still shows; the agent adds selectors.

## Test 14. Wholesale-only checkout lock [A]
- [ ] 14.1 **Storefront** → "Wholesale-only store" → confirm → Save.
- [ ] 14.2 Shopify admin → Settings → **Checkout** → **Checkout rules**: "Tradepass wholesale-only checkout" is listed and active.
- [ ] 14.3 In a private window add a product and open `/checkout` directly: "This store sells to approved wholesale customers only. Log in or apply for an account." You can't pay.
- [ ] 14.4 Switch the storefront to German (if published) and repeat: the message is in German.
- [ ] 14.5 Log in as the approved buyer and check out: it works.
- [ ] 14.6 Logged out, buy only a gift card: it works.
- [ ] 14.7 Draft orders: create a draft order for the B2B company in Shopify admin: it works. For a retail customer it's blocked. Add the exempt tag "staff" under Storefront, tag that customer "staff", try again: it works.
- [ ] 14.8 Switch back to "Show prices to everyone" → Save. Retail checkout works again and the checkout rule shows inactive.

## Test 15. Move, Pause and Resume [A]
- [ ] 15.1 **Buyers** → filter by tier → select two → **Move to tier** → Distributor → **Move**. Their tier changes, and Shopify shows them in the Distributor market. Signed in, the buyer sees Distributor prices.
- [ ] 15.2 Open a buyer → **Pause access** → **Pause**: the buyer sees retail prices (or is blocked in wholesale-only mode). **Resume access** restores the tier. Tier history lists both.

## Test 16. Certificates and renewals [A]
- [ ] 16.1 **Certificates**: give a certificate an expiry date 30 days from today. Ask the agent to run the daily job (`POST /jobs/daily`). The buyer gets a renewal email with an upload link. Run it again: no second email.
- [ ] 16.2 Open the link, upload a PDF: "Thank you". The certificate shows "Waiting for review". Open the link again: "This link was already used".
- [ ] 16.3 Set the expiry to yesterday and run the daily job: status Expired with "Decide about the tax exemption". **Manage** → **Remove tax exemption** → confirm, and check the location's tax settings in Shopify.
- [ ] 16.4 A certificate without an expiry date is flagged "No expiry date".

## Test 17. Automation rules [A]
- [ ] 17.1 **Automation** → **Add approval rule** → Country is "US" and Business type is "salon" → Tier "Retailer" → Save ("Saved").
- [ ] 17.2 Submit a matching application: within seconds it's Approved, and **Automatic decisions** lists it.
- [ ] 17.3 Click **Reverse** → confirm: the buyer is paused (Buyers shows Paused).
- [ ] 17.4 Turn on **Pause all automation** → Save → submit another match: it stays Pending.
- [ ] 17.5 Set the daily limit to 0 → Save → turn Pause off → submit: it stays Pending, and the activity log shows "limit reached".
- [ ] 17.6 Add a rejection rule "Email domain is spam.test", submit with x@spam.test: it's Rejected automatically.

## Test 18. CSV import and tag conversion [A]
- [ ] 18.1 **Import** → **Download the CSV template**. Fill 200 rows (or ask the agent for the test file) → upload.
- [ ] 18.2 Check the column mapping (pre-filled) → choose "Tier for rows without one" → **Check rows**. The dry run shows ready, errors, skipped and warnings. **Download error report**: row numbers and problems.
- [ ] 18.3 **Import N companies** → confirm. The progress bar moves.
- [ ] 18.4 Close the tab halfway, wait, reopen Import → the run: it continues (or the hourly job finished it). No company is duplicated in Shopify → Companies.
- [ ] 18.5 Tag 3 customers "wholesale" (with default addresses) → Import → Customer tags "wholesale" → **Count customers** → **Convert 3 customers** → confirm. Three companies appear in Shopify and in Buyers.

## Test 19. Shopify Flow [A]
- [ ] 19.1 Install Shopify Flow. **Create workflow** → **Select a trigger** → search "Wholesale application submitted".
- [ ] 19.2 Add the action "Approve wholesale application to tier". Set Application ID to the trigger's Application ID and Tier to "Retailer" → **Turn on**.
- [ ] 19.3 Submit an application. Flow → **Recent runs**: success. In Tradepass it's Approved by "flow".
- [ ] 19.4 A second workflow on "Wholesale application approved" sends an internal email with Company name and Tier. Approve one: the email has the right values. Also check "Certificate expiring" appears as a trigger.

## Test 20. Free plan limits and downgrade [A, not a development store]
- [ ] 20.1 On the Free plan, approve 10 applications this month. Home shows a banner at 8.
- [ ] 20.2 The 11th: "You've used this month's free approvals" with **See plans**. New applications still arrive in Applications.
- [ ] 20.3 Free plan: Certificates shows "Available on Starter" with Manage disabled; Form → "Add form" says "Available on Pro"; Storefront → "Wholesale-only store" is disabled ("Available on Starter").
- [ ] 20.4 **Plans** → Starter → approve the charge (14-day trial). Turn on wholesale-only. Then **Plans** → Free: the screen lists what turns off and asks you to tick that wholesale-only will switch to "Hide prices". Without the tick you can't continue. After it, the store is in "Hide prices", not open. Any automation rules are switched off.

## Test 21. All 36 languages [A]
- [ ] 21.1 Switch the admin language to a few languages (Deutsch, 日本語, العربية, עברית, اردو): no English leftovers in the app; Arabic, Hebrew and Urdu are right-to-left.
- [ ] 21.2 Publish a few store languages (Online Store → Settings → Languages): the form, price-hiding messages, checkout-lock message, more-info page and emails appear in that language.
- [ ] 21.3 Ask the agent to confirm `npx vitest run` passes the translation checks and that TRANSLATION_REVIEW.md lists the strings for a native speaker.

## Test 22. Keyboard and screen reader [A + B]
- [ ] 22.1 Fill the whole form with the keyboard only (Tab, Shift+Tab, Space, Enter, arrow keys). Focus is always visible.
- [ ] 22.2 With VoiceOver (Mac: Cmd+F5) or NVDA (Windows), submit with errors: the errors are read out and focus moves to the first one.
- [ ] 22.3 Run the browser's Lighthouse accessibility check on the form page: no contrast errors.

## Tests 23–25 (the agent runs these, you confirm)
- [ ] 23. Performance: the agent measures admin LCP/CLS/INP and storefront Lighthouse with the embed on and off, and reports the numbers. Storefront scripts are 2.9 KB (embed) and 10.6 KB (form page only) gzipped.
- [ ] 24. Uninstall with wholesale-only on: theme code is unchanged, retail checkout works again, companies remain in Shopify. 48 hours later Tradepass data is gone (ask the agent to check).
- [ ] 25. `GET /healthz` answers while the database is asleep; PLAN.md has the 100-store estimate.

## Acceptance test → steps

| Test | Steps | Store |
|---|---|---|
| 1 | 1.1–1.7 | A + B |
| 2 | 2.1–2.3 | A |
| 3 | 3.1–3.7 | A |
| 4 | 4.1–4.10 | A |
| 5 | 5.1–5.2 | A |
| 6 | 6.1–6.3 | A |
| 7 | 7.1–7.5 | A + B |
| 8 | 8.1–8.2 | A + B |
| 9 | 9.1–9.3 | A |
| 10 | 10.1–10.3 | A |
| 11 | 11.1–11.4 | A |
| 12 | 12.1–12.6 | A |
| 13 | 13.1–13.8 | A + B |
| 14 | 14.1–14.8 | A |
| 15 | 15.1–15.2 | A |
| 16 | 16.1–16.4 | A |
| 17 | 17.1–17.6 | A |
| 18 | 18.1–18.5 | A |
| 19 | 19.1–19.4 | A |
| 20 | 20.1–20.4 | A (not a development store) |
| 21 | 21.1–21.3 | A |
| 22 | 22.1–22.3 | A + B |
