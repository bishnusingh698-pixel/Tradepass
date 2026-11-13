# Flow templates for Tradepass alerts

Tradepass sends no email or chat messages itself (D-091). Merchants get alerts through **Shopify Flow**, which
is free on every Shopify plan, using Tradepass's triggers. Four ready-made templates are planned as
`flow_template` app extensions:

| Folder in `docs/flow-templates/` | Trigger | Action |
|---|---|---|
| `new-application-email` | Wholesale application submitted | Send internal email |
| `info-received-email` | Wholesale application info received | Send internal email |
| `new-application-slack` | Wholesale application submitted | Slack → Send message (Slack app for Flow) |
| `certificate-expiring-email` | Certificate expiring | Send internal email |

## Why they aren't in `extensions/` yet

A `flow_template` extension needs a `template.flow` file. That file is a Flow export with a checksum, so it can
only be made in the Flow editor (the Shopify dev toolkit's guidance says to pass `.flow` contents unchanged,
checksum included). The `shopify.extension.toml` format for `flow_template` couldn't be checked against
shopify.dev from the build session (blocked), so the scaffolds below live in `docs/` where they can't break
`shopify app deploy`. **Needs verification on a dev store.**

Each folder has a `shopify.extension.toml` scaffold:

```toml
[[extensions]]
name = "…"
type = "flow_template"
handle = "tradepass-template-…"
description = "…"

  [extensions.template]
  categories = ["customers"]
  module = "./template.flow"
  require_app = true
  discoverable = true
  enabled = true
```

Check the keys against https://shopify.dev/docs/apps/build/flow/templates (reference for `flow_template`)
before moving a folder into `extensions/`.

## Build and export each template (dev store, about 5 minutes each)

Before you start: install the app on the dev store with `shopify app dev` (so the Tradepass triggers exist in
Flow), and make sure the store has a test application (submit one on the storefront form).

### 1. Email staff when an application is submitted
1. Shopify admin → **Apps** → **Flow** → **Create workflow**.
2. **Select a trigger** → search "Wholesale application submitted" → choose it (app: Tradepass).
3. Click **+** under the trigger → **Action** → search "Send internal email".
4. **To**: type the staff address (Flow only accepts fixed addresses here, not variables).
5. **Subject**: `New wholesale application: {{ companyName }}` — insert the variable with **Add a variable** →
   *Company name* (Flow shows the exact variable name; use what it inserts).
6. **Message**: insert *Contact name*, *Contact email*, *Phone*, *Country*, *State*, *Tier* and *Admin URL*
   with **Add a variable**, one per line, e.g. "Open it in Tradepass: {{ adminUrl }}".
7. Name the workflow "Tradepass: email staff about new applications" → **Turn on workflow** → submit a test
   application and check the email arrives.
8. Workflow menu (**⋯**) → **Export** → save the file as `template.flow`.
9. Copy `docs/flow-templates/new-application-email/` to `extensions/tradepass-template-new-application-email/`
   and put `template.flow` next to its `shopify.extension.toml`.

### 2. Email staff when an applicant sends more info
Same as 1 with the trigger **Wholesale application info received**; subject
`{{ companyName }} sent the information you asked for`. Export to `info-received-email/template.flow`.

### 3. Post to Slack when an application is submitted
1. Install the free **Slack** app for Flow from the Shopify App Store if it isn't installed, and connect it.
2. Trigger **Wholesale application submitted** → action **Slack: Send message**.
3. Channel: your team channel; Message: company, contact, country and *Admin URL* variables.
4. Turn on, test, **Export** to `new-application-slack/template.flow`.

### 4. Email staff when a certificate is about to expire
1. Trigger **Certificate expiring** → action **Send internal email** to the staff address.
2. Subject `Certificate expiring: {{ companyName }} ({{ state }})`; message with *Expiry date*, *Contact email*,
   *Tier* and *Admin URL* (opens the buyer in Tradepass).
3. Turn on, wait for the daily run or ask the agent to move a certificate's date, **Export** to
   `certificate-expiring-email/template.flow`.

Then run `shopify app deploy`. Each template appears in Flow's template library under Tradepass.

## Shopify's own B2B access email (approval)

Shopify's API may refuse `companyContactSendWelcomeEmail` for apps (D-092). Shopify's own Flow template does
the same job without Tradepass: **Flow → Templates → search "B2B access email"**, or build it: trigger
**Company contact assigned permission** (Shopify) → action **Send B2B access email**. Tradepass assigns the
contact a role on the location during approval, which fires that trigger. Check on a dev store that the action
is available on your plan.

## Limits to know (also in Help → Automation)
- "Send internal email" only sends to fixed staff addresses typed in the action; it can't email the applicant.
- Shopify Messaging automations only reach customers subscribed to email marketing, so applicant messages stay
  "copy / open in your mail app / WhatsApp" from Tradepass.
