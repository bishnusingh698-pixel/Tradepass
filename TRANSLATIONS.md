# Translations

Tradepass ships built-in text in the 36 languages of the Shopify admin. English (`app/locales/en.json`) is the source, and `app/locales/_context.json` notes where each string appears, its max length and its placeholders. Merchants can override any string, or add text for languages their store publishes that aren't built in. The fallback order is merchant override → built-in language → store's primary language → English.

## Rules
- Formal business register, consistent per language (below).
- Meaning, not word-for-word. Full sentences with named placeholders, never concatenated fragments.
- ICU plurals with exactly the categories `Intl.PluralRules` gives for the locale (checked in tests).
- Dates, numbers and currency via `Intl`. RTL (ar, he, ur) uses `dir="rtl"` and logical CSS properties.
- "Tradepass", "Shopify", "Shopify Flow" and "B2B" stay untranslated.

## Automated checks (`tests/i18n.test.ts`)
Every key exists in every locale, placeholders match English, ICU parses, plural categories are complete, and no string is identical to English unless whitelisted (`app.name`). There's also a pseudo-localization round-trip. The overflow/RTL snapshot tests in a browser come in P8.

## Process per batch of strings
1. Write the English string and its context note. 2. Translate all 35 languages. 3. Back-translate and fix drift. 4. List low-confidence strings in TRANSLATION_REVIEW.md.

## Register and glossary per language

### Arabic (ar)

**Register:** Formal Modern Standard Arabic, addressing the merchant directly in the second person ("متجرك"، "خطتك") with verbal-noun labels for buttons ("حفظ"، "إنشاء قاعدة") as in Shopify's Arabic admin.

| English | Arabic |
| --- | --- |
| wholesale | البيع بالجملة / الجملة |
| tier | مستوى |
| application | طلب |
| approve | الموافقة على |
| payment terms | شروط الدفع |
| net 30 | الدفع خلال 30 يومًا (Net 30) |
| tax exemption | الإعفاء الضريبي |
| resale certificate | شهادة إعادة البيع |
| VAT number | رقم ضريبة القيمة المضافة |
| log in | تسجيل الدخول |
| company | شركة |
| location | موقع |
| catalog | كتالوج |
| buyer | مشترٍ (المشترون) |
| B2B market | سوق B2B |

### Bulgarian (bg)

**Register:** Formal "Вие", capitalised in direct address ("Вашия", "Ви"), with verbal nouns on buttons ("Запазване", "Създаване на ниво") as in Shopify's Bulgarian admin.

| English | Bulgarian |
| --- | --- |
| wholesale | търговия на едро / на едро |
| tier | ниво |
| application | заявка |
| approve | одобряване |
| payment terms | условия на плащане |
| net 30 | плащане до 30 дни (Net 30) |
| tax exemption | данъчно освобождаване |
| resale certificate | сертификат за препродажба |
| VAT number | ДДС номер |
| log in | вход |
| company | фирма |
| location | местоположение |
| catalog | каталог |
| buyer | купувач |
| B2B market | B2B пазар |

### Czech (cs)

**Register:** Formal "vykání" (vy), written lowercase in UI text. Buttons use infinitives ("Uložit", "Vytvořit úroveň").

| English | Čeština |
|---|---|
| wholesale | velkoobchod / velkoobchodní |
| tier | úroveň |
| application | žádost |
| approve | schválit |
| payment terms | platební podmínky |
| net 30 | splatnost 30 dní |
| tax exemption | osvobození od daně |
| resale certificate | certifikát pro další prodej |
| VAT number | DIČ (daňové identifikační číslo) |
| log in | přihlásit se |
| company | firma |
| location | pobočka |
| catalog | katalog |
| buyer | kupující |
| B2B market | trh B2B |

### Register

**Register:** Danish "du". This is the standard business register in Danish, and Shopify's Danish admin uses it too. Formal "De" is obsolete in UI text. Buttons use the imperative (Gem, Opret niveau).

| English | Dansk |
|---|---|
| wholesale | engros |
| tier | niveau |
| application | ansøgning |
| approve | godkend |
| payment terms | betalingsbetingelser |
| net 30 | netto 30 dage |
| tax exemption | momsfritagelse |
| resale certificate | videresalgscertifikat |
| VAT number | momsnummer (CVR-nummer) |
| log in | log ind |
| company | virksomhed |
| location | lokation |
| catalog | katalog |
| buyer | køber |
| B2B market | B2B-marked |

### German (de)

**Register:** Formal "Sie" throughout (imperatives as "Legen Sie fest", possessives "Ihr/Ihre"); buttons use the neutral infinitive ("Stufe erstellen") as in the Shopify admin.

| English | German |
|---|---|
| wholesale | Großhandel |
| tier | Stufe |
| application | Antrag |
| approve | genehmigen |
| payment terms | Zahlungsbedingungen |
| net 30 | Netto 30 |
| tax exemption | Steuerbefreiung |
| resale certificate | Wiederverkaufszertifikat |
| VAT number | USt-IdNr. |
| log in | anmelden |
| company | Unternehmen |
| location | Standort |
| catalog | Katalog |
| buyer | Käufer |
| B2B market | B2B-Markt |

### Greek (el)

**Register:** Formal plural "εσείς" ("Δοκιμάστε ξανά", "το πρόγραμμά σας"), with nominal forms on buttons ("Αποθήκευση", "Δημιουργία κανόνα") as in Shopify's Greek admin.

| English | Greek |
| --- | --- |
| wholesale | χονδρική |
| tier | επίπεδο |
| application | αίτηση |
| approve | έγκριση / εγκρίνω |
| payment terms | όροι πληρωμής |
| net 30 | πληρωμή σε 30 ημέρες (Net 30) |
| tax exemption | φορολογική απαλλαγή |
| resale certificate | πιστοποιητικό μεταπώλησης |
| VAT number | ΑΦΜ / αριθμός ΦΠΑ |
| log in | σύνδεση |
| company | εταιρεία |
| location | τοποθεσία |
| catalog | κατάλογος |
| buyer | αγοραστής |
| B2B market | αγορά B2B |

### Spanish (es)

**Register:** Formal "usted" throughout (e.g. "Elija", "su tienda"); buttons use the infinitive ("Crear nivel").

| English | Spanish |
|---|---|
| wholesale | mayorista / venta al por mayor |
| tier | nivel |
| application | solicitud |
| approve | aprobar |
| payment terms | condiciones de pago |
| net 30 | neto 30 |
| tax exemption | exención de impuestos |
| resale certificate | certificado de reventa |
| VAT number | número de IVA |
| log in | iniciar sesión |
| company | empresa |
| location | sucursal |
| catalog | catálogo |
| buyer | comprador |
| B2B market | mercado B2B |

### Register

**Register:** Finnish neutral business register: passive and impersonal constructions, with no "sinä"/"te" pronouns or possessive suffixes in running text (for example "nykyisessä paketissa" rather than "paketissasi"). Buttons use the standard UI imperative (Tallenna, Luo taso).

| English | Suomi |
|---|---|
| wholesale | tukku (tukkukauppa) |
| tier | taso (hintataso) |
| application | hakemus |
| approve | hyväksy |
| payment terms | maksuehdot |
| net 30 | netto 30 päivää |
| tax exemption | verovapaus |
| resale certificate | jälleenmyyntitodistus |
| VAT number | ALV-tunniste (ALV-numero) |
| log in | kirjaudu sisään |
| company | yritys |
| location | sijainti |
| catalog | luettelo |
| buyer | ostaja |
| B2B market | B2B-markkina-alue |

### French (fr)

**Register:** Formal "vous" throughout; buttons use the infinitive ("Créer un niveau") as in the Shopify admin.

| English | French |
|---|---|
| wholesale | vente en gros |
| tier | niveau |
| application | demande |
| approve | approuver |
| payment terms | conditions de paiement |
| net 30 | Net 30 jours |
| tax exemption | exonération de taxes |
| resale certificate | certificat de revente |
| VAT number | numéro de TVA |
| log in | se connecter |
| company | entreprise |
| location | site |
| catalog | catalogue |
| buyer | acheteur |
| B2B market | marché B2B |

### Hebrew (he)

**Register:** Formal, gender-neutral Hebrew in the style of Shopify's Hebrew admin: buttons and headings use infinitive or verbal-noun forms ("שמירה"، "יצירת רמה"), and instructions use impersonal phrasing ("יש לנסות שוב"، "כאן אפשר לבחור") rather than gendered imperatives.

| English | Hebrew |
| --- | --- |
| wholesale | סיטונאות / סיטונאי |
| tier | רמה |
| application | בקשה |
| approve | אישור / לאשר |
| payment terms | תנאי תשלום |
| net 30 | שוטף + 30 |
| tax exemption | פטור ממס |
| resale certificate | אישור מכירה חוזרת |
| VAT number | מספר עוסק (מע״מ) |
| log in | התחברות |
| company | חברה |
| location | מיקום |
| catalog | קטלוג |
| buyer | קונה |
| B2B market | שוק B2B |

### Hindi (hi)

**Register:** Formal "आप" with polite imperatives ("सेव करें"، "चुनें"), written in the everyday Hinglish-leaning Hindi that Shopify's Hindi admin uses (प्लान، स्टोर، ईमेल، सेटिंग).

| English | Hindi |
| --- | --- |
| wholesale | होलसेल |
| tier | टियर |
| application | आवेदन |
| approve | स्वीकृत करें |
| payment terms | भुगतान की शर्तें |
| net 30 | नेट 30 (30 दिन में भुगतान) |
| tax exemption | टैक्स छूट |
| resale certificate | रीसेल सर्टिफ़िकेट |
| VAT number | VAT नंबर |
| log in | लॉग इन करें |
| company | कंपनी |
| location | लोकेशन |
| catalog | कैटलॉग |
| buyer | खरीदार |
| B2B market | B2B मार्केट |

### Croatian (hr)

**Register:** Formal "Vi", written lowercase "vi/vaš" in UI text, as in Shopify's admin. Buttons use the short imperative ("Spremi", "Izradi razinu").

| English | Hrvatski |
|---|---|
| wholesale | veleprodaja / veleprodajni |
| tier | razina |
| application | zahtjev |
| approve | odobriti |
| payment terms | uvjeti plaćanja |
| net 30 | plaćanje u roku od 30 dana |
| tax exemption | porezno oslobođenje |
| resale certificate | potvrda o preprodaji |
| VAT number | PDV identifikacijski broj |
| log in | prijava / prijaviti se |
| company | tvrtka |
| location | lokacija |
| catalog | katalog |
| buyer | kupac |
| B2B market | B2B tržište |

### Register

**Register:** Hungarian formal "Ön" (magázás), with "Ön" written out where the possessor would otherwise be ambiguous. Buttons use noun forms (Mentés, Szint létrehozása) as Shopify's Hungarian admin does.

| English | Magyar |
|---|---|
| wholesale | nagykereskedelmi (nagyker) |
| tier | szint (árszint) |
| application | jelentkezés |
| approve | jóváhagyás |
| payment terms | fizetési feltételek |
| net 30 | nettó 30 nap |
| tax exemption | adómentesség |
| resale certificate | viszonteladói igazolás |
| VAT number | közösségi adószám |
| log in | bejelentkezés |
| company | vállalat |
| location | helyszín |
| catalog | katalógus |
| buyer | vásárló |
| B2B market | B2B-piac |

### Indonesian (id)

**Register:** Formal "Anda" (capitalised), with polite imperatives such as "Silakan" in the standard Shopify admin style.

| English | Indonesian |
|---|---|
| wholesale | grosir |
| tier | tingkat harga |
| application | pengajuan |
| approve | setujui |
| payment terms | ketentuan pembayaran |
| net 30 | Net 30 (jatuh tempo 30 hari) |
| tax exemption | pembebasan pajak |
| resale certificate | sertifikat penjualan kembali |
| VAT number | nomor PPN |
| log in | masuk |
| company | perusahaan |
| location | lokasi |
| catalog | katalog |
| buyer | pembeli |
| B2B market | pasar B2B |

### Italian (it)

**Register:** Formal "Lei" throughout (third-person forms "Scelga", "Imposti"; possessive "suo" written lowercase per modern UI style); buttons use the imperative ("Crea regola") as in the Shopify admin.

| English | Italian |
|---|---|
| wholesale | ingrosso |
| tier | livello |
| application | richiesta |
| approve | approvare |
| payment terms | termini di pagamento |
| net 30 | netto 30 |
| tax exemption | esenzione fiscale |
| resale certificate | certificato di rivendita |
| VAT number | partita IVA |
| log in | accedere |
| company | azienda |
| location | sede |
| catalog | catalogo |
| buyer | acquirente |
| B2B market | mercato B2B |

### Japanese (ja)

**Register:** です/ます調 (polite business form); merchant addressed with honorific phrasing such as ご利用 and お問い合わせ, no second-person pronoun.

| English | Japanese |
|---|---|
| wholesale | 卸売 |
| tier | 価格ランク |
| application | 申請 |
| approve | 承認 |
| payment terms | 支払条件 |
| net 30 | 30日以内の支払い (Net 30) |
| tax exemption | 免税 |
| resale certificate | 再販証明書 |
| VAT number | VAT番号 |
| log in | ログイン |
| company | 会社 |
| location | ロケーション |
| catalog | カタログ |
| buyer | バイヤー |
| B2B market | B2Bマーケット |

### Korean (ko)

**Register:** 합니다체 (formal polite). Requests use 해 주십시오, and button and heading labels use plain noun forms.

| English | Korean |
|---|---|
| wholesale | 도매 |
| tier | 등급 |
| application | 신청서 |
| approve | 승인 |
| payment terms | 결제 조건 |
| net 30 | 30일 후 결제 (Net 30) |
| tax exemption | 면세 |
| resale certificate | 재판매 증명서 |
| VAT number | VAT 번호 |
| log in | 로그인 |
| company | 회사 |
| location | 위치 |
| catalog | 카탈로그 |
| buyer | 구매자 |
| B2B market | B2B 마켓 |

### Lithuanian (lt)

**Register:** Formal "Jūs", written lowercase "jūs/jūsų" in UI text. Buttons use infinitives ("Išsaugoti", "Sukurti lygį").

| English | Lietuvių |
|---|---|
| wholesale | didmeninė prekyba / didmeninis |
| tier | lygis |
| application | paraiška |
| approve | patvirtinti |
| payment terms | mokėjimo sąlygos |
| net 30 | apmokėjimas per 30 dienų |
| tax exemption | atleidimas nuo mokesčių |
| resale certificate | perpardavimo pažyma |
| VAT number | PVM mokėtojo kodas |
| log in | prisijungti |
| company | įmonė |
| location | vieta |
| catalog | katalogas |
| buyer | pirkėjas |
| B2B market | B2B rinka |

### Malay (ms)

**Register:** Formal standard Malay (Bahasa Melayu), addressing the merchant as "anda" in lowercase as Shopify MS does, with polite "Sila" for requests.

| English | Malay |
|---|---|
| wholesale | borong |
| tier | peringkat harga |
| application | permohonan |
| approve | luluskan |
| payment terms | terma pembayaran |
| net 30 | Net 30 (bayar dalam tempoh 30 hari) |
| tax exemption | pengecualian cukai |
| resale certificate | sijil jualan semula |
| VAT number | nombor VAT |
| log in | log masuk |
| company | syarikat |
| location | lokasi |
| catalog | katalog |
| buyer | pembeli |
| B2B market | pasaran B2B |

### Register

**Register:** Norwegian Bokmål "du". This is the standard business register and is used by Shopify's Norwegian admin. "De" is obsolete. Buttons use the imperative (Lagre, Opprett nivå).

| English | Norsk bokmål |
|---|---|
| wholesale | engros |
| tier | nivå |
| application | søknad |
| approve | godkjenn |
| payment terms | betalingsbetingelser |
| net 30 | netto 30 dager |
| tax exemption | avgiftsfritak (MVA-fritak) |
| resale certificate | videresalgssertifikat |
| VAT number | MVA-nummer (organisasjonsnummer) |
| log in | logg inn |
| company | bedrift |
| location | lokasjon |
| catalog | katalog |
| buyer | kjøper |
| B2B market | B2B-marked |

### Dutch (nl)

**Register:** Formal "u" throughout ("uw winkel", "U ziet"); buttons use the infinitive ("Niveau maken") as in the Shopify admin.

| English | Dutch |
|---|---|
| wholesale | groothandel |
| tier | niveau |
| application | aanvraag |
| approve | goedkeuren |
| payment terms | betalingsvoorwaarden |
| net 30 | netto 30 |
| tax exemption | belastingvrijstelling |
| resale certificate | wederverkoopcertificaat |
| VAT number | btw-nummer |
| log in | inloggen |
| company | bedrijf |
| location | locatie |
| catalog | catalogus |
| buyer | koper |
| B2B market | B2B-markt |

### Polish (pl)

**Register:** Impersonal, Pan/Pani-neutral forms in body text ("Prosimy spróbować ponownie", "Tutaj pojawią się…"), with no "Ty" or "Twój". Buttons use the imperative, as in Shopify's Polish admin ("Zapisz", "Utwórz poziom").

| English | Polski |
|---|---|
| wholesale | sprzedaż hurtowa / hurtowy |
| tier | poziom |
| application | wniosek |
| approve | zatwierdzić |
| payment terms | warunki płatności |
| net 30 | płatność w ciągu 30 dni |
| tax exemption | zwolnienie z podatku |
| resale certificate | zaświadczenie o odsprzedaży |
| VAT number | numer VAT (NIP) |
| log in | zalogować się |
| company | firma |
| location | lokalizacja |
| catalog | katalog |
| buyer | kupujący |
| B2B market | rynek B2B |

### Portuguese, Brazil (pt-BR)

**Register:** "Você" with a polite, professional tone (standard for Brazilian business software, Shopify BR included); buttons use the infinitive ("Criar nível").

| English | Portuguese (Brazil) |
|---|---|
| wholesale | atacado |
| tier | nível |
| application | solicitação |
| approve | aprovar |
| payment terms | condições de pagamento |
| net 30 | líquido 30 |
| tax exemption | isenção de impostos |
| resale certificate | certificado de revenda |
| VAT number | número de identificação fiscal (IVA) |
| log in | fazer login |
| company | empresa |
| location | local |
| catalog | catálogo |
| buyer | comprador |
| B2B market | mercado B2B |

### Portuguese, Portugal (pt-PT)

**Register:** Formal European Portuguese: third-person forms without "você" ("Escolha", "o seu plano", "contacte"), AO1990 spelling (respetivo, ação); buttons use the infinitive.

| English | Portuguese (Portugal) |
|---|---|
| wholesale | venda por grosso / grossista |
| tier | nível |
| application | candidatura |
| approve | aprovar |
| payment terms | condições de pagamento |
| net 30 | 30 dias líquidos |
| tax exemption | isenção de impostos |
| resale certificate | certificado de revenda |
| VAT number | número de IVA (NIF) |
| log in | iniciar sessão |
| company | empresa |
| location | localização |
| catalog | catálogo |
| buyer | comprador |
| B2B market | mercado B2B |

### Register

**Register:** Romanian formal "dumneavoastră", with second-person plural imperatives everywhere (Salvați, Creați un nivel), matching Shopify's Romanian admin.

| English | Română |
|---|---|
| wholesale | en-gros |
| tier | nivel |
| application | cerere |
| approve | aprobați |
| payment terms | termene de plată |
| net 30 | plată la 30 de zile (net 30) |
| tax exemption | scutire de taxe |
| resale certificate | certificat de revânzare |
| VAT number | cod de TVA |
| log in | conectați-vă |
| company | companie |
| location | locație |
| catalog | catalog |
| buyer | cumpărător |
| B2B market | piață B2B |

### Russian (ru)

**Register:** Formal "вы" (written lowercase, as in Shopify's Russian admin); buttons use infinitives ("Сохранить", "Создать уровень").

| English | Русский |
|---|---|
| wholesale | оптовые продажи / оптовый |
| tier | уровень |
| application | заявка |
| approve | одобрить |
| payment terms | условия оплаты |
| net 30 | оплата в течение 30 дней |
| tax exemption | освобождение от налогов |
| resale certificate | сертификат перепродажи |
| VAT number | номер плательщика НДС |
| log in | войти |
| company | компания |
| location | местоположение |
| catalog | каталог |
| buyer | покупатель |
| B2B market | рынок B2B |

### Slovak (sk)

**Register:** Formal "vykanie" (vy), written lowercase in UI text. Buttons use infinitives ("Uložiť", "Vytvoriť úroveň").

| English | Slovenčina |
|---|---|
| wholesale | veľkoobchod / veľkoobchodný |
| tier | úroveň |
| application | žiadosť |
| approve | schváliť |
| payment terms | platobné podmienky |
| net 30 | splatnosť 30 dní |
| tax exemption | oslobodenie od dane |
| resale certificate | certifikát na ďalší predaj |
| VAT number | IČ DPH |
| log in | prihlásiť sa |
| company | firma |
| location | pobočka |
| catalog | katalóg |
| buyer | kupujúci |
| B2B market | trh B2B |

### Slovenian (sl)

**Register:** Formal "vikanje" (vi), written lowercase in UI text. Buttons use the short imperative common in Slovenian software ("Shrani", "Ustvari raven").

| English | Slovenščina |
|---|---|
| wholesale | veleprodaja / veleprodajni |
| tier | raven |
| application | vloga |
| approve | odobriti |
| payment terms | plačilni pogoji |
| net 30 | plačilo v 30 dneh |
| tax exemption | davčna oprostitev |
| resale certificate | potrdilo za nadaljnjo prodajo |
| VAT number | ID za DDV |
| log in | prijava / prijaviti se |
| company | podjetje |
| location | lokacija |
| catalog | katalog |
| buyer | kupec |
| B2B market | trg B2B |

### Register

**Register:** Swedish "du". This is the standard business register in Swedish and is what Shopify's Swedish admin uses. "Ni" sounds dated or stiff. Buttons use the imperative (Spara, Skapa nivå).

| English | Svenska |
|---|---|
| wholesale | grossist (grossistköp) |
| tier | nivå |
| application | ansökan |
| approve | godkänn |
| payment terms | betalningsvillkor |
| net 30 | netto 30 dagar |
| tax exemption | skattebefrielse (momsbefrielse) |
| resale certificate | återförsäljarintyg |
| VAT number | momsregistreringsnummer |
| log in | logga in |
| company | företag |
| location | plats |
| catalog | katalog |
| buyer | köpare |
| B2B market | B2B-marknad |

### Thai (th)

**Register:** Polite, formal business Thai with "คุณ" and "โปรด" and no gendered particles (ครับ/ค่ะ), following the Thai Shopify admin style.

| English | Thai |
| --- | --- |
| wholesale | ขายส่ง |
| tier | ระดับ |
| application | ใบสมัคร |
| approve | อนุมัติ |
| payment terms | เงื่อนไขการชำระเงิน |
| net 30 | ชำระภายใน 30 วัน (Net 30) |
| tax exemption | การยกเว้นภาษี |
| resale certificate | ใบรับรองการขายต่อ |
| VAT number | เลขประจำตัวผู้เสียภาษี (VAT) |
| log in | เข้าสู่ระบบ |
| company | บริษัท |
| location | ตำแหน่งที่ตั้ง |
| catalog | แคตตาล็อก |
| buyer | ผู้ซื้อ |
| B2B market | ตลาด B2B |

### Register

**Register:** Turkish formal "siz", used in all sentences (for example "planınız", "deneyin"). Buttons use the short imperative common in Shopify's Turkish admin (Kaydet, Seviye oluştur).

| English | Türkçe |
|---|---|
| wholesale | toptan |
| tier | seviye |
| application | başvuru |
| approve | onayla |
| payment terms | ödeme koşulları |
| net 30 | net 30 gün |
| tax exemption | vergi muafiyeti |
| resale certificate | yeniden satış sertifikası |
| VAT number | KDV numarası (vergi numarası) |
| log in | giriş yap |
| company | şirket |
| location | konum |
| catalog | katalog |
| buyer | alıcı |
| B2B market | B2B pazarı |

### Urdu (ur)

**Register:** Formal "آپ" with polite imperatives ("محفوظ کریں"، "منتخب کریں"), using the English loanwords common in Pakistani e-commerce software (پلان، اسٹور، کیٹلاگ، ای میل).

| English | Urdu |
| --- | --- |
| wholesale | ہول سیل |
| tier | درجہ |
| application | درخواست |
| approve | منظور کریں |
| payment terms | ادائیگی کی شرائط |
| net 30 | نیٹ 30 (30 دن میں ادائیگی) |
| tax exemption | ٹیکس استثنیٰ |
| resale certificate | ری سیل سرٹیفکیٹ |
| VAT number | VAT نمبر |
| log in | لاگ ان |
| company | کمپنی |
| location | مقام |
| catalog | کیٹلاگ |
| buyer | خریدار |
| B2B market | B2B مارکیٹ |

### Vietnamese (vi)

**Register:** Polite and businesslike, following Shopify admin's convention of addressing the merchant as "bạn". Pronouns are kept to a minimum, and requests use "Vui lòng".

| English | Vietnamese |
|---|---|
| wholesale | bán buôn |
| tier | cấp giá |
| application | đơn đăng ký |
| approve | phê duyệt |
| payment terms | điều khoản thanh toán |
| net 30 | thanh toán trong 30 ngày (Net 30) |
| tax exemption | miễn thuế |
| resale certificate | giấy chứng nhận bán lại |
| VAT number | mã số VAT |
| log in | đăng nhập |
| company | công ty |
| location | địa điểm |
| catalog | danh mục |
| buyer | người mua |
| B2B market | thị trường B2B |

### Simplified Chinese (zh-CN)

**Register:** Formal 您 throughout, in the neutral, concise style of the Shopify admin.

| English | Chinese (Simplified) |
|---|---|
| wholesale | 批发 |
| tier | 等级 |
| application | 申请 |
| approve | 批准 |
| payment terms | 付款条款 |
| net 30 | 30 天内付款 (Net 30) |
| tax exemption | 免税 |
| resale certificate | 转售证明 |
| VAT number | 增值税号 |
| log in | 登录 |
| company | 公司 |
| location | 地点 |
| catalog | 目录 |
| buyer | 买家 |
| B2B market | B2B 市场 |

### Traditional Chinese (zh-TW)

**Register:** Formal 您 throughout, using Taiwan admin vocabulary (方案, 型錄, 匯入, 設定).

| English | Chinese (Traditional) |
|---|---|
| wholesale | 批發 |
| tier | 等級 |
| application | 申請 |
| approve | 核准 |
| payment terms | 付款條件 |
| net 30 | 30 天內付款 (Net 30) |
| tax exemption | 免稅 |
| resale certificate | 轉售證明 |
| VAT number | VAT 號碼 |
| log in | 登入 |
| company | 公司 |
| location | 地點 |
| catalog | 型錄 |
| buyer | 買家 |
| B2B market | B2B 市場 |

