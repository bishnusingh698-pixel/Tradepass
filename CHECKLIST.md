# Test checklist (for Bishnu)

Click-by-click checks you can do in your development store. Tick each box. If something looks wrong, take a screenshot and paste it in the project thread.

## A. Install and Home (after the app is deployed)
- [ ] 1. In the Partner Dashboard, open **Apps** → **Tradepass** → **Test your app**, choose your development store and click **Install**.
- [ ] 2. The app opens inside Shopify admin. The left menu shows: Home, Applications, Buyers, Tiers, Form, Storefront, Certificates, Notifications, Automation, Import, Settings, Help.
- [ ] 3. Home shows **Plan and readiness**:
  - "Shopify plan: Grow" (or the plan you picked).
  - "B2B is available on your plan." with a green tick.
  - "B2B markets are turned on." or an amber explanation.
  - "0 of 3 B2B catalogs used" (the number may differ if you made catalogs yourself).
- [ ] 4. Click **Check again**. The card reloads without errors.
- [ ] 5. Click each item in the left menu. Every page opens and shows a short explanation and one button. None is blank.
- [ ] 6. Change your admin language (your profile picture → **Preferences** → **Language**, e.g. Deutsch), reopen the app and check the menu and Home are in that language. Try Arabic: the layout should flip right-to-left. Switch back afterwards.

## B. Reinstall
- [ ] 7. Go to **Settings** (bottom left of Shopify admin) → **Apps** → Tradepass → **⋯** → **Uninstall**.
- [ ] 8. Install it again as in step 1. It should open straight to Home with no loop and no error.

## C. Spike: B2B compatibility test (Phase 0)
- [ ] 9. In the app, go to **Help** → **B2B compatibility test** → **Run test**. Wait up to a minute.
- [ ] 10. Click **Copy results** and paste them in the project thread.
- [ ] 11. Storefront price check. After the test, the test company's "Main" location sits in the −20% test market. The test contact's email is a fake @example.com address, so in Shopify admin open **Customers** → **Companies** → "Tradepass spike …" → **Main**, click **Add customer** (or "Assign contact") and add yourself with your own email. Then open your store in a private window, click the account icon, sign in with your email and the code you receive, and check that product prices are 20% below normal. Tell me what you see in the thread.
- [ ] 12. Click **Remove test data** when we're done.
