# Translation review list

Strings a native speaker should check, per language. Everything else passed the automated checks (`node scripts/i18n-check.mjs`, `tests/i18n.test.ts`) and a back-translation check. Ask a reviewer to look only at these. (All admin, email, storefront and listing strings, 2026-10-17.)

## Arabic (ar)

- `*.plural` (فروع zero): صياغات مثل "لا توجد مشكلات" أُضيفت لأن الإنجليزية لا تحتوي على حالة الصفر.
- `plans.name.*`، `tiers.plan.*`، `certificates.plan.*`: أسماء الخطط بين «» ("خطة Starter"، «Pro»، "الخطة المجانية") حتى لا تطابق الإنجليزية.
- `applications.flag.possible_spam`: أطول من النص الإنجليزي لكنه ضمن الحد المسموح.
- `help.*`، `settings.*` مع مسارات القوائم: أسماء قوائم مسؤول Shopify بالعربية لم تُراجع على الواجهة الفعلية.
- `applications.detail.taxCheckPlan`: صيغة "ضمن {plan} والخطط الأعلى" لتجنب تكرار كلمة "خطة".

## Bulgarian (bg)

- `plans.name.starter`, `plans.name.pro` („План Starter“, „План Pro“), `tiers.plan.*`, `certificates.plan.*` („„Starter““): възможно е двойно „план“, ако `{plan}` получава преведеното име.
- `email.sample.terms` („Нето 30 дни“): да се сравни с българското име в Shopify.
- `storefront.scope.tagsHelp`: примерните етикети са на латиница (samo-za-targovci, na-edro).
- Тема `form.field.consent.label`: използва „Съгласен/съгласна“, тъй като родът на подателя е неизвестен.

## Czech (cs)

- `plans.name.starter`, `plans.name.pro`, `tiers.plan.*`, `certificates.plan.*` – názvy tarifů s předponou „Tarif“ kvůli zákazu shody s angličtinou; ověřte, že znějí přirozeně ve všech větách s {plan}.
- Plurály v kategorii `many` (desetinná čísla) – málo používaný tvar, ověřte v uživatelském rozhraní.
- Motiv `form.field.website.placeholder` – „https://…“ místo „https://“, aby se řetězec lišil od angličtiny.
- `storefront` jako „výloha“ – Shopify někdy používá „online obchod“; zvoleno kvůli odlišení od celého obchodu.

## Danish (da)

- `plans.name.starter` / `plans.name.pro` / `certificates.plan.*` / `tiers.plan.*` – plannavne med »-abonnement(et)« for at undgå engelsk-identiske strenge; tjek, at de læses naturligt i alle {plan}-sætninger.
- `storefront.mode.wholesaleOnly` vs. tilstandsnavnet »Kun engros« i andre strenge – to formuleringer af samme tilstand.
- `tiers.editor.checkout` – »Betaling« som etiket for checkout; kan forveksles med betalingsbetingelser.

## German (de)

- `applications.col.status`, `buyers.col.status` u. a. („Zustand“): nur gewählt, weil „Status“ dem Englischen gleicht; „Status“ wäre natürlicher.
- `tiers.plan.*`, `certificates.plan.*`, `plans.name.*`: Tarifnamen in Anführungszeichen („Starter“) bzw. „Starter-Tarif“, damit sie nicht dem Englischen gleichen.
- `form_block.name` / Hilfetexte: Im Englischen heißt der Block „Wholesale application“, in einigen Hilfetexten aber „Wholesale application form“; einheitlich „Großhandels-Antragsformular“ verwendet.
- Leicht über maxLength (unter 10 %): `automation.settings.paused`, `automation.recent.reverseFailed`, `import.dry.note`, `renew.error.upload`.

## Greek (el)

- `plans.name.starter`, `plans.name.pro` («Πρόγραμμα Starter», «Πρόγραμμα Pro»), `tiers.plan.*`, `certificates.plan.*` («Starter» σε εισαγωγικά): πιθανή διπλή λέξη «πρόγραμμα» αν το `{plan}` λαμβάνει το μεταφρασμένο όνομα.
- `email.sample.terms` («Πληρωμή σε 30 ημέρες»): να ελεγχθεί έναντι της ελληνικής ονομασίας του Shopify για το Net 30.
- `storefront.scope.tagsHelp`: παραδείγματα ετικετών σε λατινικούς χαρακτήρες (mono-emporoi, xondriki).
- `import.issue.unknown_tier`: 6% πάνω από το maxLength.

## Spanish (es)

- `applications.detail.no` («No.»): el punto solo evita la identidad con el inglés.
- `import.level.error` («Con error»): «Error» sería más natural.
- `tiers.plan.*`, `certificates.plan.*`, `plans.name.*`: nombres de plan entre comillas («Starter») o «Plan Starter».
- `form_block.name`: el inglés usa «Wholesale application» y «Wholesale application form»; se usa «Formulario de solicitud mayorista» en todo.
- Ligeramente por encima de maxLength (menos del 10 %): `buyers.source.tag`.

## Finnish (fi)

- `certificates.plan.*`, `tiers.plan.*` – lainausmerkeissä ”Starter”/”Pro” ydinlauseeseen ”Saatavilla paketissa {plan}”; tarkista luontevuus.
- `email.*` – teksteissä on paikoin sinä-muotoa (”hakemuksesi”); tarkista, sopiiko tyyliin.
- `storefront.mode.wholesaleOnly` – ”Vain tukkuasiakkaille”, muualla tilan nimi ”Vain tukku”.

## French (fr)

- `*.col.type` (« Nature ») et colonnes d’actions (« Opérations ») : choisis pour éviter l’identité avec l’anglais ; « Type » et « Actions » seraient plus naturels.
- `tiers.plan.*`, `certificates.plan.*`, `plans.name.*` : noms de forfait entre guillemets (« Starter ») ou « Forfait Starter ».
- `form_block.name` : l’anglais emploie à la fois « Wholesale application » et « Wholesale application form » ; « Formulaire de demande professionnelle » partout.
- Légèrement au-delà de maxLength (moins de 10 %) : `automation.rules.addApprove`, `buyers.source.tag`, `form.consent.privacyUrl`.

## Hebrew (he)

- `plans.name.*`, `tiers.plan.*`, `certificates.plan.*`: שמות התוכניות במירכאות (״Starter״, ״Pro״, ״חינם״) כדי שלא יהיו זהים לאנגלית.
- `help.*`, `settings.*` עם נתיבי תפריט: חץ ← במקום →, ושמות התפריטים של Shopify בעברית לא נבדקו מול הממשק החי.
- מגדר של Shopify (נקבה) ושל Tradepass (זכר) בכל המחרוזות.
- `email.sample.*`: ערכי דוגמה שנבחרו ידנית.

## Hindi (hi)

- `certificates.jurisdiction`: "{country} ({region})" क्रम, ताकि यह अंग्रेज़ी के बराबर न हो।
- `plans.name.*`, `tiers.plan.*`, `certificates.plan.*`: प्लान के नाम “Starter” / “Pro” और “मुफ़्त प्लान”।
- `form.list.fieldCount`: one और other दोनों में "# सवाल" (हिन्दी में संज्ञा नहीं बदलती)।
- `home.numbers.tierLine`: बहुवचन की बनावट थोड़ी अलग है।

## Croatian (hr)

- `plans.name.starter`, `plans.name.pro`, `tiers.plan.*`, `certificates.plan.*` – nazivi paketa s prefiksom „Paket“; provjerite prirodnost u svim rečenicama s {plan}.
- `email.*.body` – pozdrav „Dobar dan, {first_name},“ uz ime u nominativu; provjerite ton.
- `applications.taxCheck.skipped` – skraćeno na „Nije provjereno u vašem paketu“ zbog ograničenja od 30 znakova.
- `tiers.col.status` – „Stanje“ umjesto uobičajenog „Status“ (izbjegnuta jednakost s engleskim).

## Hungarian (hu)

- `plans.name.starter`, `plans.name.pro`, `tiers.plan.*`, `certificates.plan.*`: a „csomag” szó hozzáadva; ha a kód a lefordított csomagnevet illeszti be a `{plan}` helyére (pl. `applications.detail.taxCheckPlan`, `flow.action.planRequired`), a „csomag” szó kétszer szerepelhet.
- `email.sample.terms` („Nettó 30 nap”): ellenőrizni kell a Shopify magyar fizetési feltétel elnevezésével.
- `storefront.scope.tagsHelp`: a példacímkék ékezet nélküliek (csak-viszonteladoknak, nagytetel), mert a címkék gyakran így szerepelnek.
- `import.options.noDefaultTier`: 4%-kal hosszabb a maxLength-nél.

## Indonesian (id)

- `approval.exemption.euReverseCharge`, `approval.tax.reason.*`, `help.faq.taxExemptions.a`: "reverse charge UE" dibiarkan sebagai istilah pajak; perlu dicek apakah ada padanan yang lebih umum.
- `help.addForm.step1`, `help.addForm.step2`: nama menu admin Shopify (Toko Online → Tema → Sesuaikan, Tambahkan blok → Aplikasi).
- `tiers.plan.starter`, `tiers.plan.pro`: nama paket dalam tanda kutip agar tidak sama dengan bahasa Inggris.
- Theme `form.tax.tax_id` ("NPWP / ID pajak") dan `form.address.zone.county`.

## Italian (it)

- `applications.detail.no` («No.»): il punto serve solo a evitare l’identità con l’inglese.
- `tiers.plan.*`, `certificates.plan.*`, `plans.name.*`: nomi dei piani tra virgolette (“Starter”) o «Piano Starter».
- `form_block.name`: l’inglese usa sia «Wholesale application» sia «Wholesale application form»; ovunque «Modulo di richiesta all’ingrosso».
- Leggermente oltre maxLength (meno del 10 %): `applications.taxCheck.skipped`, `approval.field.sameShipping`, `automation.settings.dailyLimit`, `automation.rules.addApprove`, `import.tag.taxCharge`, `import.run.csvTitle`, `import.issue.unknown_terms`.

## Japanese (ja)

- email.sample.firstName / email.received.body etc.: {first_name}様 uses the given name with 様; some merchants may prefer the family name.
- email.sample.terms / glossary net 30: 支払期限30日 chosen; Shopify admin may show a different Net 30 label.
- applications.detail.submitted: 送信日： precedes a relative time; word order depends on how the UI renders it.
- brand.powered_by (theme): Tradepassで作成 is a free rendering of Powered by Tradepass.

## Korean (ko)

- approval.exemption.euReverseCharge / approval.tax.reason.*: 역발행 for EU reverse charge is the common term but a tax-literate reviewer should confirm.
- buyers.bulk.failedLine, applications.bulk.skippedLine: "{company} - {reason}" uses a dash instead of a colon only to differ from English.
- certificates.jurisdiction: "{country} {region}" without a comma.
- automation.condition.is / isNot: 다음과 일치 / 다음과 일치하지 않음 read as operators; check in the UI.

## Lithuanian (lt)

- `plans.name.*`, `tiers.plan.*`, `certificates.plan.*`: planų pavadinimai kabutėse („Starter“, „Pro“, „Nemokamas“), kad nesutaptų su anglų kalba.
- Daugiskaitos `many` formos (kilmininkas, pvz., „pirkėjų“, „paraiškų“) ir trupmeniniai skaičiai: verta patikrinti gimtakalbiui.
- `help.*` meniu keliai: lietuviški Shopify administratoriaus meniu pavadinimai nesutikrinti su gyva sąsaja.
- `email.sample.*`: pavyzdinės reikšmės parinktos rankiniu būdu.

## Malay (ms)

- `help.debug.*`: "nyahpepijat" untuk debug mungkin terlalu teknikal; mungkin "mod debug" lebih biasa.
- `form.type.select`: "Senarai juntai bawah" untuk dropdown.
- `help.addForm.step1`, `help.addForm.step2`: nama menu pentadbir Shopify (Kedai Dalam Talian → Tema → Sesuaikan).
- `tiers.plan.starter`, `tiers.plan.pro`: nama pelan dalam tanda petik supaya tidak sama dengan bahasa Inggeris.
- Theme `form.address.zone.emirate`, `form.address.zone.governorate`: label pentadbiran luar negara.

## Norwegian Bokmål (nb)

- `plans.name.*`, `certificates.plan.*`, `tiers.plan.*` – plannavn med «-abonnement(et)»; sjekk flyt i {plan}-setninger.
- `help.addForm.step2`, `home.checklist.block.body` – blokknavnet «Engrossøknad» må samsvare med navnet i temaredigeringsprogrammet.
- `automation.condition.spam` – «søppelpost» for spam; noen foretrekker «spam».

## Dutch (nl)

- `certificates.plan.starter`, `certificates.plan.pro`, `tiers.plan.*`, `plans.name.starter`, `plans.name.pro`: plannamen staan tussen aanhalingstekens (‘Starter’) omdat ze niet gelijk aan het Engels mogen zijn; controleer of dit er goed uitziet in "Beschikbaar met abonnement {plan}".
- `email.sample.terms` ("Netto 30 dagen"): controleer tegen de exacte naam die Shopify in het Nederlands voor Net 30 gebruikt.
- `common.discard` ("Negeren", bestaand): Shopify gebruikt in de opslagbalk mogelijk een andere term.
- `storefront.wall.pagesHelp`: "handles" is onvertaald gelaten zoals in Shopify; controleer.

## Polish (pl)

- `certificates.plan.*`, `tiers.plan.*` – nazwy w cudzysłowie („Pro”) wstawiane do „Dostępne w planie {plan}”.
- `*.col.status` / `*.filter.status` – „Stan” zamiast „Status”; sprawdź, czy brzmi naturalnie.
- Odmiany liczebników w kategorii `other` (ułamki) – np. „# wniosku”; warto sprawdzić kilka wybranych.

## Brazilian Portuguese (pt-BR)

- `certificates.plan.*`, `tiers.plan.*`, `plans.name.starter`, `plans.name.pro`: nomes de plano entre aspas (“Starter”) para não ficarem idênticos ao inglês; confira a aparência em "Disponível no plano {plan}".
- `email.sample.terms` ("30 dias líquidos"): conferir o termo exato que a Shopify usa para Net 30.
- `approval.exemption.euReverseCharge` / `approval.tax.reason.*` ("autoliquidação da UE"): conceito europeu pouco usado no Brasil; conferir com um contador.
- E-mails usam "na {store_name}" (feminino, "a loja"); nomes de loja masculinos podem soar estranhos.

## European Portuguese (pt-PT)

- `certificates.plan.*`, `tiers.plan.*`, `plans.name.starter`, `plans.name.pro`: nomes de plano entre aspas angulares («Starter») para não serem idênticos ao inglês; confirmar a aparência em "Disponível no plano {plan}".
- `email.sample.terms` ("A 30 dias"): confirmar com o termo da Shopify para Net 30.
- `storefront.mode.wholesaleOnly` e afins ("exclusiva para grosso"): abreviado para caber no limite; um nativo deve confirmar que soa natural.
- `form.option.monthlyOrderValue.*`: números sem separador de milhares abaixo de 10 000 (norma portuguesa); confirmar.

## Romanian (ro)

- `plans.name.starter`, `plans.name.pro` („Plan Starter”, „Plan Pro”) și `tiers.plan.*`, `certificates.plan.*` („„Starter””): dacă `{plan}` primește numele tradus, `applications.detail.taxCheckPlan` poate afișa „planul Plan Starter”.
- `email.sample.terms` („Net 30 de zile”): de verificat cu denumirea din Shopify în română.
- `storefront.scope.tagsHelp`: etichete de exemplu fără diacritice (doar-revanzatori, vrac).
- Tema `form.error.too_long`: „{{ max }} de caractere” este corect doar pentru valori ≥ 20.

## Russian (ru)

- `plans.name.*`, `tiers.plan.*`, `certificates.plan.*`: названия тарифов в кавычках («Starter», «Pro», «Бесплатный»), чтобы строки не совпадали с английскими.
- `help.addForm.*`, `help.*` с путями меню («Интернет-магазин → Темы → Настроить»): названия пунктов русского админ-интерфейса Shopify не сверены с живым интерфейсом.
- `email.sample.*`: условные примеры (название компании, имя), подобраны вручную.
- `schema embed.name`: «Tradepass — встраивание» вместо простого «Tradepass».

## Slovak (sk)

- `plans.name.starter`, `plans.name.pro`, `tiers.plan.*`, `certificates.plan.*` – názvy plánov s predponou „Plán“ kvôli zákazu zhody s angličtinou; overte prirodzenosť vo všetkých vetách s {plan}.
- Plurály v kategórii `many` (desatinné čísla) – zriedkavý tvar, overte v rozhraní.
- `tiers.editor.section.defaults` – skrátené na „Predvolené pre nových kupujúcich“, aby sa zmestilo do limitu.
- `storefront` ako „výklad“ – Shopify niekedy používa „online obchod“.

## Slovenian (sl)

- `plans.name.starter`, `plans.name.pro`, `tiers.plan.*`, `certificates.plan.*` – imena paketov s predpono „Paket“; preverite naravnost v vseh stavkih s {plan}.
- `applications.businessType.distributor`, `form.option.businessType.distributor`, motiv `form.business_type.distributor` – „Distributer“; preverite, ali je zaželen zapis „distributor“.
- Motiv `apply_block.name` – „Poziv k veleprodajni vlogi“ je opisno ime, ne dobesedni prevod.
- Dvojina (`two`) v plural nizih – preverite v vmesniku.

## Swedish (sv)

- `certificates.plan.*`, `tiers.plan.*`, `plans.name.starter`, `plans.name.pro`: abonnemangsnamn inom citattecken (”Starter”) så att de inte är identiska med engelskan; kontrollera i "Tillgänglig med {plan}".
- `nav.storefront` / "butiksfront" (befintlig): Shopify använder "Webbutik" för Online Store; bekräfta att termen känns naturlig.
- `applications.col.status` ("Läge"): omformulerat för att inte vara lika med engelskan; "Status" vore mer naturligt.
- `import.report.message` ("Beskrivning"): samma skäl som ovan.

## Thai (th)

- `email.sample.terms` และเงื่อนไข net 30: "เครดิต 30 วัน" แทน net 30 ซึ่งเป็นคำที่ใช้กันทั่วไปในไทย
- `approval.exemption.euReverseCharge`, `approval.tax.reason.*`: คงคำว่า "Reverse Charge" เป็นภาษาอังกฤษ
- `plans.name.*`, `tiers.plan.*`, `certificates.plan.*`: “Starter” / “Pro” และ “แพ็กเกจฟรี”
- `home.numbers.tierLine`: โครงสร้างประโยคต่างจากต้นฉบับเล็กน้อย

## Turkish (tr)

- `plans.name.*`, `tiers.plan.*`, `certificates.plan.*`: plan adları tırnak içinde (“Starter”, “Pro”, “Ücretsiz”), İngilizceyle aynı olmasın diye.
- `applications.filter.form`: "Form" İngilizceyle aynı olacağından "Başvuru formu" kullanıldı.
- `import.progress.count`: maxLength için "{done}/{total} tamamlandı" biçimine kısaltıldı.
- `help.*` menü yolları ve `email.sample.*` örnek değerleri canlı arayüzle karşılaştırılmadı.

## Urdu (ur)

- `help.*`، `settings.*`: Shopify ایڈمن کے مینو راستے انگریزی میں رکھے گئے کیونکہ Shopify ایڈمن اردو میں دستیاب نہیں۔
- `plans.name.*`، `tiers.plan.*`، `certificates.plan.*`: پلان کے نام “Starter” / “Pro” اور “مفت پلان”۔
- `settings.assignment.assisted`: “معاونت کے ساتھ” ایک نئی اصطلاح ہے۔
- `home.numbers.tierLine`: جمع اور ترتیب کی ساخت قدرے مختلف ہے۔

## Vietnamese (vi)

- `help.addForm.step1`, `help.addForm.step2`, `help.faq.documents.a`, `settings.branding.logoHelp`: tên menu của trang quản trị Shopify (Cửa hàng trực tuyến → Chủ đề → Tùy chỉnh, Nội dung → Tệp) cần đối chiếu với giao diện Shopify tiếng Việt hiện tại.
- `tiers.plan.starter`, `tiers.plan.pro`: tên gói được đặt trong ngoặc kép để không trùng tiếng Anh.
- `approval.exemption.euReverseCharge`, `approval.tax.reason.*`: thuật ngữ "đảo ngược thuế" cho EU reverse charge.
- Theme `form.address.zone.county`, `form.address.zone.governorate`, `form.address.zone.prefecture`: nhãn đơn vị hành chính nước ngoài.

## Chinese (China) (zh-CN)

- help.faq.taxExemptions.a / approval.exemption.euReverseCharge: 反向征税 for EU reverse charge.
- storefront.wall.pagesHelp: handle rendered as 标识; Shopify zh-CN sometimes shows 句柄.
- brand.powered_by (theme): 由 Tradepass 提供支持.

## Chinese (Taiwan) (zh-TW)

- certificates.* uses 證明文件 for certificate (from the existing nav) while resale certificate is 轉售證明; a reviewer may prefer 證書.
- approval.exemption.euReverseCharge: 歐盟反向課稅.
- storefront.wall.pagesHelp: handle rendered as 代碼.
