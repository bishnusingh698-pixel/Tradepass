# Form builder and Storefront admin pages

Code: `app/routes/app.form._index.tsx` (list of forms), `app/routes/app.form.$id.tsx` (builder), `app/routes/app.storefront.tsx`, `app/components/form-builder/*`, `app/components/storefront/*`, `app/lib/forms.server.ts`. Tests: `tests/form-admin-forms.test.ts`, `tests/form-admin-storefront.test.ts`.

## API notes

- ✅ **Theme editor deep links** (shopify.dev, theme app extensions → configuration): embed `https://{shop}/admin/themes/current/editor?context=apps&template={t}&activateAppId={api_key}/{handle}`; block `...?template={t}&addAppBlockId={api_key}/{handle}&target=newAppsSection`. `api_key` = the app's client id (`SHOPIFY_API_KEY`), `handle` = Liquid file name. We keep the `/` literal. Handles come from `shopify.app.extensions()` at runtime; fallbacks are `tradepass-embed` and `application-form` (current block files).
- ✅ **Save bar**: shopify.dev says `<form data-save-bar>` does not see React state changes, and not to mix it with `shopify.saveBar` calls. The builder state is React state, so we use App Bridge React `<SaveBar open discardConfirmation>` (wraps `<ui-save-bar>`; Save = `<button variant="primary">`, Discard = `<button>`). In-app navigation is blocked with React Router `useBlocker`, which calls `shopify.saveBar.leaveConfirmation()` and only navigates once the merchant confirms.
- ✅ **Resource picker**: `shopify.resourcePicker({ type: 'collection' | 'product', multiple, action, selectionIds })` resolves to the selection or `undefined` on cancel (docs + `@shopify/app-bridge-types`: Collection/Product have `id`, `title`, `handle`).
- ✅ **`shopify.app.extensions()`**: statuses are lowercase (`active` / `available` / `unavailable`); embeds have target `head`/`body`, blocks `section`. Only the published theme is checked, so the page has "Check again".
- ✅ `shopLocales { locale primary published }` (read_locales). `nodes(ids:)` with `... on Collection { title }` / `... on Product { title }` for chosen scope titles.
- ⚠️ **React 18 + Polaris web components**: React 18 doesn't attach `onChange` to custom elements and writes `false` booleans as the string `"false"`. `app/components/form-builder/wc.tsx` sets properties and listens to native `input`/`change`/`hide` events directly, and only spreads boolean attributes when true (`flag()`). Other areas using `disabled={x}` on `s-*` elements may render disabled when `x` is false.

## Decisions

- Forms list at `/app/form`, builder at `/app/form/:id`. The default form can't be deleted (the form block falls back to it); "Make default" moves the flag.
- One language switcher drives both editing and the preview. Store languages come first (primary, published), then every built-in language so texts can be prepared before publishing.
- Merchant field texts live in the FormDefinition (`texts[locale]`); empty = built-in translation from the theme extension's locale files. Built-in keys used: `form.field.<id>.<label|placeholder|help>`, `form.section.<id>`, `form.business_type.<v>`, `form.order_value.<v>`, consent `def.consent.texts` (falls back to `form.field.consent.label`, so the consent field has no separate label editor), success `form.success.body`.
- Validation (shared client/server, `model.ts`): Company name, Email, First/Last name, Billing address, Consent can't be hidden, removed or made conditional; custom ids `custom_<n>` (never reused); custom types limited to the 10 in the spec; choice fields need unique slug values; "show if" must point at an earlier, visible dropdown/checkbox question and one of its options; URLs must be https/http or a store path (`/…`, not `//…`); length caps.
- Errors for empty inputs appear after blur or a save attempt; errors caused by a deliberate choice (e.g. a condition) show at once. Save with errors shows a summary banner linking to each field.
- Storefront text overrides are stored in `Settings.texts[locale][key]` using the theme locale keys: `gate.message`, `gate.login`, `gate.apply`, `gate.cart`, `banner.text`, `banner.link`, `hint.text`, `wall.heading`, `wall.message`, plus **`checkout.message`** for the checkout lock (the Function's messages). `syncStorefrontConfig` must read these.
- Preview-as runs the real embed script (`window.Tradepass.applyGating`) on a mock product page and collection card in three sandboxed iframes; the wholesale column shows the chosen tier's `discountPct` price.
- **Proposed**: wholesale-only stays allowed for a shop that already has it after a downgrade (we don't silently reopen a store); turning it on needs Starter. Both directions need a confirmation modal.

## Needs live verification

- Theme editor deep links open with the embed preselected / block added on the page template (needs the real client id and deployed extension).
- `shopify.app.extensions()` returns our handles and statuses; "Check again" picks up a change.
- SaveBar shows on edit, Discard confirmation works, nav menu clicks are blocked until save/discard, `leaveConfirmation()` resolves after Discard.
- Resource picker returns collections/products with titles; scope chips persist after save.
- Polaris web components accept property-set values (`value`, `values`, `checked`) and emit `input`/`change` as assumed (s-choice-list `values`, s-color-field `change`).
- The srcdoc preview iframes run under the admin's CSP (inline scripts, `sandbox="allow-scripts"`).

## Checklist

1. Open Tradepass → Form. The table lists "Wholesale application" with a Default badge. On Free, "Add form" is disabled and says "Available on Pro".
2. Click the form. Change "Website" to Required → the save bar appears. Click a nav item → you are asked to save or discard.
3. Try to set "Email" to hidden → the option isn't offered.
4. Add a question: type Short text, section Tax and documents, Add. Click Save without a label → a red banner lists "Give Untitled question a label…"; click it to jump to the field.
5. Enter a label, tick "Only show this question for a certain answer", choose Business type = Salon or spa. Save → "Saved" toast. The preview shows the question only after choosing Salon in the preview.
6. Drag a question to another place, and use the up/down arrows with the keyboard. Switch the preview between Desktop and Mobile, and the language to Deutsch: labels change to German; type a German label and see it in the preview.
7. Turn on the spam question without an answer → error; fill both → saves.
8. "Add the form to a page": follow the three links; the theme editor opens on the page template with the block being added, then with the Tradepass embed selected.
9. Storefront: the embed card shows On/Off; click "Open theme editor", turn the embed on, save the theme, click "Check again" → On.
10. Choose "Hide prices…" → scope "Chosen collections" → Choose collections → pick two → Save. The preview shows Log in / Apply for the retail and logged-in columns and prices for the wholesale column.
11. On Free, "Wholesale-only store" is disabled ("Available on Starter"). On Starter, choosing it opens a confirmation; confirm, Save. Choosing another mode later asks "Turn off wholesale-only?".
12. Texts: pick Français, change "Log in button", Save; "Reset to default" removes it after saving.
13. Colours: set a button colour → preview buttons change; "Use theme colour" clears it.
