# Translation review list

Strings a native speaker should check, per language. Everything else passed back-translation review. Ask a reviewer to look only at these. (Batch: P1 admin strings, 92 keys, 2026-10-16.)

## Arabic (ar)

- `home.readiness.catalogBudget`: to avoid noun-number agreement problems, all six plural branches use the neutral pattern "B2B catalogs used: # of {limit}". A native speaker may prefer separate agreement forms for each branch.
- `home.pending.applications` / `home.readiness.catalogUnlimited`: the zero and one branches use a numeral with a singular noun ("0 طلب"، "1 طلب"), which is common in UIs but stiff; check that this is acceptable.
- `spike.failed`: "التعيين المساعَد" (assisted assignment) is a coined term.
- `import.empty.body`: the example tag is translated as «جملة», but merchants may actually use the English tag "wholesale".

## Bulgarian (bg)

- `nav.storefront` / `storefront.title`: "Витрина" was chosen over Shopify's sales-channel name "Онлайн магазин".
- `spike.failed`: "асистирано присвояване на нива" (assisted tier assignment) is a coined term.
- `common.discard`: "Отхвърляне" vs. Shopify's possible "Отмяна на промените"; check against the admin's own save bar.

## Czech (cs)

- nav.storefront / storefront.title: "Výloha" is my own choice. Shopify Czech may use "Online obchod".
- nav.certificates: I chose "Certifikáty" over "Osvědčení". Please check which term Czech merchants expect.
- spike.failed: I translated "assisted tier assignment" as "poloautomaticky" (semi-automatically).

## Register

- `home.readiness.heading`: "klarhed" for "readiness" is an approximation, and "parathed" or "status" may read more naturally.
- `nav.storefront` / `storefront.title`: "Butiksfacade" vs "Webshop", please confirm against the current Shopify Danish admin.
- `import.empty.body`: the localized example tag "engros" assumes merchants tag in Danish.

## German (de)

- nav.storefront / storefront.title: "Onlineshop" follows the Shopify sales channel name. Check whether "Storefront" is preferred.
- nav.import / import.title: "Importieren" (a verb) is used because "Import" would be identical to English.
- import.empty.body: the example tag "Großhandel" is localized. Merchants may actually use the English tag "wholesale".
- spike.failed: "unterstützte Stufenzuweisung" for "assisted tier assignment" may need a better product term.

## Greek (el)

- `spike.failed`: "υποβοηθούμενη ανάθεση επιπέδων" (assisted tier assignment) is a coined term.
- `notifications.empty.heading` / `notifications.empty.action`: these use the loanword "email", which is common in Greek UIs; "μήνυμα ηλεκτρονικού ταχυδρομείου" would be too long.
- `settings.empty.body`: "εταιρική εμφάνιση email" for "email branding".

## Spanish (es)

- home.readiness.catalogBudget: the one-branch uses the plural "catálogos" ("1 de 5 catálogos B2B en uso"). Confirm this reads naturally.
- spike.intro: "sucursal" for company location. Shopify ES may use "ubicación".
- nav.storefront: "Tienda online". Shopify LatAm vs Spain wording may differ.

## Register

- `home.readiness.catalogBudget`: the slash format "# / {limit}" is a workaround for case agreement, so please confirm it reads well.
- `nav.storefront` / `storefront.title`: "Kauppanäkymä" is an approximation, because Shopify Finnish may use "Verkkokauppa".
- `common.discard`: "Hylkää muutokset" is longer than the bare "Hylkää", which was chosen to avoid confusion with "reject".
- `help.contact`: rendered as "Sähköposti: {email}" (label form) rather than a sentence.

## French (fr)

- nav.notifications / notifications.title: "E-mails et alertes" is used because "Notifications" would be identical to English. A native speaker may prefer to accept "Notifications".
- common.discard: "Ignorer" matches Shopify's save bar as far as I know. Verify.
- import.empty.body: the example tag « gros » is localized.
- spike.intro: "site d'entreprise" for company location. Verify it matches Shopify FR B2B wording.

## Hebrew (he)

- `spike.failed`: "שיוך רמות בסיוע ידני" (manually assisted tier assignment) is our wording for "assisted tier assignment"; check that it is clear.
- `home.readiness.catalogUnlimited`: the "one" branch reads "1 קטלוג B2B בשימוש"; some editors prefer "קטלוג B2B אחד".
- `settings.empty.body`: keeps "התוכנית שלך", which is gender-neutral in writing but second person.

## Hindi (hi)

- `spike.failed`: "सहायता-आधारित टियर असाइनमेंट" (assisted tier assignment) is a coined phrase.
- `home.pending.applications`: in Hindi the "one" category also covers 0, so 0 shows "0 आवेदन इंतज़ार में है". This is grammatical but a native speaker may want to check it.
- `nav.tiers` / tier: "टियर" is a loanword. "स्तर" would be more native, but it is also used for "level" inside the tier definition.

## Croatian (hr)

- nav.storefront / storefront.title: "Izlog" is my own choice.
- nav.certificates: I chose "Potvrde". Please check whether "Certifikati" is what Croatian merchants expect.
- spike.failed: I translated "assisted tier assignment" as "poluautomatski" (semi-automatically).

## Register

- `nav.storefront` / `storefront.title`: "Áruházi felület" is descriptive, so please check what Shopify Hungarian uses ("Webáruház", "Online áruház").
- `nav.applications`: "jelentkezés" vs "igénylés" for a wholesale application, please confirm.
- `import.empty.body`: the localized example tag "nagyker" is informal shorthand.

## Indonesian (id)

- nav.storefront / storefront.title : "Etalase" vs "Toko online". Shopify ID's own label may differ.
- certificates.empty.body : "sertifikat penjualan kembali" is a literal rendering, because Indonesia has no exact equivalent.
- storefront.empty.body : "checkout" is left as a loanword, as in Shopify ID; please confirm.

## Italian (it)

- nav.home / home.title: "Pagina iniziale". Shopify IT itself uses "Home", which is excluded here because it is identical to English.
- home.readiness.heading: "operatività" for "readiness".
- tiers.empty.heading / automation.empty.heading: one uses a formal imperative ("Crei") and the other an infinitive-style label ("Approva"). Check for consistency.

## Japanese (ja)

- nav.buyers / buyers.* : バイヤー vs 購入者. Shopify JA B2B screens may use 顧客 or 購入者; check against the current admin.
- nav.tiers / tiers.* : 価格ランク is my own choice; Shopify has no native "tier" term.
- import.empty.body : the tag example 「wholesale」 is left in English because it is a literal tag value.
- spike.failed : the wording of "assisted tier assignment" (補助付きの価格ランク割り当て) needs a native speaker to confirm it sounds natural.

## Korean (ko)

- nav.storefront / storefront.title : 스토어프론트 is a transliteration; 온라인 스토어 may be more familiar to Korean merchants.
- nav.tiers / tiers.* : 등급 could also be read as a customer loyalty grade. 가격 등급 would be clearer but is longer.
- spike.failed : the phrase 보조 등급 할당 방식 ("assisted assignment") needs a native speaker to check it.

## Lithuanian (lt)

- home.pending.none: the meaning shifted slightly, to "nothing needs to be done right now".
- nav.storefront / storefront.title: "Vitrina" is my own choice. Shopify may use "Internetinė parduotuvė".
- Glossary "location": "vieta" is generic. Shopify B2B may use "padalinys" for company locations.

## Malay (ms)

- nav.import / import.title : "Pengimportan" is less common than the loanword "Import".
- nav.storefront / storefront.title : "Kedai dalam talian" vs Shopify MS's own label.
- home.readiness.* (VAT) : Malaysia uses SST rather than VAT, so the "nombor VAT" glossary entry may need local adaptation.

## Register

- `home.readiness.heading`: "klarstatus" is a coined compound, so please check whether it reads naturally.
- `settings.empty.body`: "e-postprofil" for "email branding" is an approximation.
- `nav.storefront`: "Butikkfront", please confirm against the Shopify Norwegian admin.

## Dutch (nl)

- nav.help / help.title: "Hulp" is used because Shopify NL's "Help" would be identical to English.
- spike.failed: "ondersteunde niveautoewijzing" for "assisted tier assignment".
- tiers.empty.body: "niveau" is used both as the term and in the definition.

## Polish (pl)

- common.retry, form.empty.body and other strings that use the imperative singular: this follows Shopify convention, but please check that it fits the impersonal register.
- nav.storefront: I chose "Witryna sklepu". Shopify may use "Sklep online" instead.
- spike.failed: I translated "assisted tier assignment" as "półautomatycznie" (semi-automatically).

## Portuguese, Brazil (pt-BR)

- nav.storefront / storefront.title: "Loja virtual". Shopify BR may use "Loja on-line".
- storefront.empty.body: "se cadastrem" for "apply".
- Glossary "VAT number": Brazil has no VAT. The real fields are CNPJ / Inscrição Estadual.

## Portuguese, Portugal (pt-PT)

- common.comingSoon: 64 characters against a 60-character limit (within tolerance).
- nav.applications: "Candidaturas" for wholesale applications. "Pedidos" is an alternative, but it collides with "orders".
- import.empty.body: the example tag "grosso" is localized.

## Register

- `home.readiness.heading`: "Plan și pregătire" for "Plan and readiness" may read stiffly.
- `nav.storefront`: "Vitrină online", please confirm against the Shopify Romanian admin.
- `common.comingSoon`: 64 characters, slightly over the 60 limit (within tolerance).

## Russian (ru)

- home.readiness.catalogBudget, home.readiness.catalogUnlimited: the `other` branch only covers fractional numbers, so please check the agreement.
- spike.failed: I translated "assisted tier assignment" as "полуавтоматически" (semi-automatically), which may not match the product's meaning.
- import.empty.body: I localized the example tag "wholesale" as «опт». Please confirm that merchants should see a localized tag value here.

## Slovak (sk)

- home.readiness.catalogBudget: please check the `many` branch (fractions), "Využité # katalógu".
- nav.storefront / storefront.title: "Výklad" is my own choice and may not match Shopify's Slovak term.
- Glossary "company": Shopify's Slovak admin may use "spoločnosť" rather than "firma".

## Slovenian (sl)

- home.readiness.catalogBudget, home.readiness.catalogUnlimited, home.pending.applications: fractional numbers fall into `few` (for example "1,5 katalogi"), which reads awkwardly.
- nav.storefront / storefront.title: "Izložba" is my own choice. Shopify may use "Spletna trgovina".
- common.retry: the button uses the imperative "Poskusi znova", while body text uses the formal "Poskusite".

## Register

- `home.readiness.heading`: "beredskap" for "readiness" is slightly formal, and a native speaker may prefer "status".
- `certificates.empty.body`: "återförsäljarintyg" is the descriptive term for resale certificate, and Sweden has no exact legal equivalent.

## Thai (th)

- `spike.failed`: "แบบกึ่งอัตโนมัติ" (semi-automatic) was chosen for "assisted"; check that it matches the product's meaning.
- `storefront.empty.body`: "ผู้เยี่ยมชมทั่วไป" for "retail visitors"; a native speaker might prefer "ลูกค้าปลีก".
- `settings.empty.body`: "แบรนด์ของอีเมล" for "email branding".

## Register

- `storefront.empty.body`: a long "mı ... mı ... yoksa" construction, so please check readability.
- `nav.storefront`: "Mağaza vitrini" vs "Vitrin", please confirm against Shopify Turkish.
- `common.discard`: "Vazgeç" vs Shopify's exact label for discarding unsaved changes.

## Urdu (ur)

- `spike.failed`: "درجوں کی معاون تفویض" (assisted tier assignment) is a coined phrase.
- `settings.empty.body`: "ڈیٹا محفوظ رکھنے کی مدت" for "data retention" should match the term used in the actual settings screen.
- `nav.import` / `import.title`: "امپورٹ" is a loanword; "درآمد" is the more formal alternative.

## Vietnamese (vi)

- Register : "bạn" vs the more formal "Quý khách"/"quý vị". I followed Shopify admin.
- home.readiness.* (catalog) : "danh mục" is Shopify VI's word for catalog, but it can be confused with "collection" or "category".
- nav.storefront : "Cửa hàng trực tuyến" is 19 characters; check that it fits the nav.
- spike.failed : "chỉ định cấp giá có hỗ trợ" ("assisted assignment") needs a native speaker to check it.

## Simplified Chinese (zh-CN)

- nav.certificates / certificates.* : 证书 vs 证明文件. Tax documents are not strictly certificates.
- common.availableOn : "{plan} 套餐可用" depends on {plan} being a bare plan name such as "Basic".
- spike.failed : the phrase 辅助方式分配等级 ("assisted assignment") needs a native speaker to check it.

## Traditional Chinese (zh-TW)

- nav.help / help.* : 說明 follows Shopify TW, but 幫助中心 would also work.
- nav.certificates / certificates.* : 證明文件 is a broad term for "certificates"; please confirm it is acceptable.
- spike.failed : the phrase 輔助方式指派等級 ("assisted assignment") needs a native speaker to check it.

