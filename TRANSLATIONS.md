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

Source: `docs/i18n/<locale>.md`, written by each language's translator. Regenerate this file and TRANSLATION_REVIEW.md after a translation batch.

### Arabic (ar)

**Register.** عربية فصحى حديثة بأسلوب رسمي: مخاطبة المفرد المذكر المحايد ("أنت")، وأفعال الأمر في الأزرار والتعليمات ("أدخل"، "اختر")، و"يُرجى" في الرسائل الموجهة إلى المشترين في واجهة المتجر. رسائل البريد الإلكتروني والصفحات المستضافة (email.*، hosted.*، renew.*) بنبرة ودّية مع الحفاظ على الرسمية. أسماء العلامات التجارية (Shopify، Tradepass، Shopify Flow) بالإنجليزية، ولا تُستخدم علامات الاتجاه.

| English | العربية |
| --- | --- |
| wholesale | الجملة |
| tier | مستوى |
| application | طلب |
| approve | موافقة / وافق |
| reject | رفض / ارفض |
| buyer | مشترٍ |
| company | شركة |
| location | موقع |
| catalog | كتالوج |
| B2B market | سوق B2B |
| payment terms | شروط الدفع |
| net 30 | صافي 30 يومًا |
| tax exemption | إعفاء ضريبي |
| resale certificate | شهادة إعادة البيع |
| VAT number | رقم ضريبة القيمة المضافة |
| sign in | تسجيل الدخول |
| one-time code | رمز لمرة واحدة |
| checkout | الدفع / إتمام الطلب |
| storefront | واجهة المتجر |
| theme editor | محرر السمة |
| app embed | تضمين التطبيق |

### Bulgarian (bg)

**Register.** Официално обръщение с „Вие“ (с главна буква, включително „Ви“, „Вашия“) и учтив повелителен начин („Изберете“, „Въведете“). Имейлите, хостваните страници и текстовете за подновяване са по-приятелски, но запазват учтивата форма.

| English | Български |
| --- | --- |
| wholesale | на едро |
| tier | ниво |
| application | заявка |
| approve | одобряване |
| reject | отхвърляне |
| buyer | купувач |
| company | фирма |
| location | местоположение |
| catalog | каталог |
| B2B market | B2B пазар |
| payment terms | условия на плащане |
| net 30 | нето 30 дни |
| tax exemption | данъчно освобождаване |
| resale certificate | сертификат за препродажба |
| VAT number | ДДС номер |
| sign in | вход |
| one-time code | еднократен код |
| checkout | плащане |
| storefront | витрина |
| theme editor | редактор на теми |
| app embed | вграждане на приложение |

### Czech (cs)

**Register.** Vykání (vy, vaše) s malým písmenem jako v české administraci Shopify; e-maily a hostované stránky jsou zdvořilé, ale přátelské.

| English | Čeština |
| --- | --- |
| wholesale | velkoobchod |
| tier | úroveň |
| application | žádost |
| approve | schválit |
| reject | zamítnout |
| buyer | kupující |
| company | firma |
| location | pobočka |
| catalog | katalog |
| B2B market | trh B2B |
| payment terms | platební podmínky |
| net 30 | splatnost 30 dní |
| tax exemption | osvobození od daně |
| resale certificate | certifikát pro další prodej |
| VAT number | DIČ |
| sign in | přihlásit se |
| one-time code | jednorázový kód |
| checkout | pokladna |
| storefront | výloha |
| theme editor | editor motivu |
| app embed | vložení aplikace |

### Danish (da)

**Register.** du – Shopifys danske standard for administratoren og kundemails; formel »De« bruges ikke i moderne erhvervssoftware.

| English | Dansk |
| --- | --- |
| wholesale | engros |
| tier | niveau |
| application | ansøgning |
| approve | godkend |
| reject | afvis |
| buyer | køber |
| company | virksomhed |
| location | lokation |
| catalog | katalog |
| B2B market | B2B-marked |
| payment terms | betalingsbetingelser |
| net 30 | netto 30 dage |
| tax exemption | afgiftsfritagelse |
| resale certificate | videresalgscertifikat |
| VAT number | momsnummer |
| sign in | log ind |
| one-time code | engangskode |
| checkout | betaling (gå til betaling) |
| storefront | butiksfacade |
| theme editor | temaeditor |
| app embed | app-integrering |

### German (de)

**Register.** Sie (formelle Anrede, wie im deutschen Shopify-Admin). Schaltflächen im Infinitiv („Antrag genehmigen“), Hinweise und Fehlermeldungen in ganzen Sätzen mit „Sie“.

| English | Deutsch |
| --- | --- |
| wholesale | Großhandel |
| tier | Stufe (Preisstufe) |
| application | Antrag |
| approve | genehmigen |
| reject | ablehnen |
| buyer | Käufer |
| company | Unternehmen |
| location | Standort |
| catalog | Katalog |
| B2B market | B2B-Markt |
| payment terms | Zahlungsbedingungen |
| net 30 | Netto 30 Tage |
| tax exemption | Steuerbefreiung |
| resale certificate | Wiederverkäuferbescheinigung |
| VAT number | USt-IdNr. |
| sign in | anmelden |
| one-time code | Einmalcode |
| checkout | Checkout |
| storefront | Onlineshop |
| theme editor | Theme-Editor |
| app embed | App-Einbettung |

### Greek (el)

**Register.** Επίσημος πληθυντικός ευγενείας («εσείς», «σας») και προστακτική β΄ πληθυντικού («Επιλέξτε», «Εισαγάγετε») σε εφαρμογή, θέμα και email. Τα email, οι φιλοξενούμενες σελίδες και τα κείμενα ανανέωσης έχουν πιο φιλικό τόνο, αλλά παραμένουν στον πληθυντικό.

| English | Ελληνικά |
| --- | --- |
| wholesale | χονδρική |
| tier | επίπεδο |
| application | αίτηση |
| approve | έγκριση (εγκρίνω) |
| reject | απόρριψη (απορρίπτω) |
| buyer | αγοραστής |
| company | εταιρεία |
| location | τοποθεσία |
| catalog | κατάλογος |
| B2B market | αγορά B2B |
| payment terms | όροι πληρωμής |
| net 30 | πληρωμή σε 30 ημέρες |
| tax exemption | φοροαπαλλαγή |
| resale certificate | πιστοποιητικό μεταπώλησης |
| VAT number | αριθμός ΦΠΑ (ΑΦΜ για «tax number») |
| sign in | σύνδεση |
| one-time code | κωδικός μίας χρήσης |
| checkout | ολοκλήρωση αγοράς |
| storefront | βιτρίνα |
| theme editor | πρόγραμμα επεξεργασίας θέματος |
| app embed | ενσωμάτωση εφαρμογής |

### Spanish (es)

**Register.** Usted (trato formal, como en el panel de Shopify en español). Botones en infinitivo («Aprobar solicitud»); mensajes y ayudas con «usted».

| English | Español |
| --- | --- |
| wholesale | mayorista |
| tier | nivel (nivel de precios) |
| application | solicitud |
| approve | aprobar |
| reject | rechazar |
| buyer | comprador |
| company | empresa |
| location | ubicación |
| catalog | catálogo |
| B2B market | mercado B2B |
| payment terms | condiciones de pago |
| net 30 | neto 30 días |
| tax exemption | exención de impuestos |
| resale certificate | certificado de reventa |
| VAT number | número de IVA |
| sign in | iniciar sesión |
| one-time code | código de un solo uso |
| checkout | pantalla de pago |
| storefront | tienda online |
| theme editor | editor de temas |
| app embed | inserción de aplicación |

### Finnish (fi)

**Register.** Neutraali asiallinen yleiskieli: käskymuodot painikkeissa, passiivi ja persoonaton rakenne teksteissä; ei teitittelyä eikä tuttavallista sinuttelua (Shopifyn suomenkielinen käytäntö).

| English | Suomi |
| --- | --- |
| wholesale | tukku |
| tier | taso |
| application | hakemus |
| approve | hyväksy |
| reject | hylkää |
| buyer | ostaja |
| company | yritys |
| location | sijainti |
| catalog | luettelo |
| B2B market | B2B-markkina-alue |
| payment terms | maksuehdot |
| net 30 | 30 päivää netto |
| tax exemption | verovapaus |
| resale certificate | jälleenmyyntitodistus |
| VAT number | ALV-tunnus |
| sign in | kirjaudu sisään |
| one-time code | kertakäyttökoodi |
| checkout | kassa |
| storefront | kauppanäkymä |
| theme editor | teemaeditori |
| app embed | sovelluksen upotus |

### French (fr)

**Register.** Vouvoiement (vous), comme dans l’interface d’administration Shopify en français. Typographie française : espace insécable avant « : ; ? ! » et à l’intérieur des guillemets « ».

| English | Français |
| --- | --- |
| wholesale | vente en gros / professionnel (pro) |
| tier | niveau (niveau de prix) |
| application | demande |
| approve | approuver |
| reject | refuser |
| buyer | acheteur |
| company | entreprise |
| location | site |
| catalog | catalogue |
| B2B market | marché B2B |
| payment terms | conditions de paiement |
| net 30 | paiement à 30 jours |
| tax exemption | exonération de taxe |
| resale certificate | certificat de revente |
| VAT number | numéro de TVA |
| sign in | se connecter |
| one-time code | code à usage unique |
| checkout | paiement |
| storefront | boutique en ligne |
| theme editor | éditeur de thème |
| app embed | intégration d’application |

### Hebrew (he)

**Register.** ניסוח ניטרלי מגדרית: שמות פעולה בכפתורים ("אישור הבקשה"), ו"יש ל…" / "אפשר ל…" בהנחיות ובשגיאות, בלי צורות עם לוכסן. בטקסטים ללקוחות בחזית החנות ובאימיילים (email.*, hosted.*, renew.*) פנייה ברבים ("שלכם") בטון ידידותי. Shopify בלשון נקבה, Tradepass בלשון זכר. בלי סימני כיווניות.

| English | עברית |
| --- | --- |
| wholesale | סיטונאות |
| tier | רמה (רמת מחיר) |
| application | בקשה |
| approve | אישור |
| reject | דחייה |
| buyer | קונה |
| company | חברה |
| location | מיקום |
| catalog | קטלוג |
| B2B market | שוק B2B |
| payment terms | תנאי תשלום |
| net 30 | שוטף + 30 |
| tax exemption | פטור ממס |
| resale certificate | אישור למכירה חוזרת |
| VAT number | מספר מע״מ |
| sign in | התחברות |
| one-time code | קוד חד-פעמי |
| checkout | קופה |
| storefront | חזית החנות |
| theme editor | עורך ערכות הנושא |
| app embed | הטמעת אפליקציה |

### Hindi (hi)

**Register.** औपचारिक हिन्दी, "आप" के साथ संबोधन, बटन और निर्देशों में आदरसूचक आज्ञार्थ ("डालें", "चुनें"), और स्टोरफ़्रंट संदेशों में "कृपया"। ईमेल और होस्ट किए गए पेज (email.*, hosted.*, renew.*) मित्रवत लहजे में। रोज़मर्रा के कारोबारी शब्द (होलसेल, टियर, चेकआउट) प्रचलित हिंग्लिश रूप में, ब्रांड नाम अंग्रेज़ी में।

| English | हिन्दी |
| --- | --- |
| wholesale | होलसेल |
| tier | टियर |
| application | आवेदन |
| approve | मंज़ूर करें |
| reject | अस्वीकार करें |
| buyer | खरीदार |
| company | कंपनी |
| location | लोकेशन |
| catalog | कैटलॉग |
| B2B market | B2B मार्केट |
| payment terms | पेमेंट की शर्तें |
| net 30 | नेट 30 |
| tax exemption | टैक्स छूट |
| resale certificate | रीसेल सर्टिफ़िकेट |
| VAT number | VAT नंबर |
| sign in | साइन इन |
| one-time code | वन-टाइम कोड |
| checkout | चेकआउट |
| storefront | स्टोरफ़्रंट |
| theme editor | थीम एडिटर |
| app embed | ऐप एम्बेड |

### Croatian (hr)

**Register.** Persiranje (vi, vaš) malim slovom kao u hrvatskoj administraciji Shopifyja; e-poruke i hostirane stranice su uljudne, ali prijateljske.

| English | Hrvatski |
| --- | --- |
| wholesale | veleprodaja |
| tier | razina |
| application | zahtjev |
| approve | odobriti |
| reject | odbiti |
| buyer | kupac |
| company | tvrtka |
| location | lokacija |
| catalog | katalog |
| B2B market | B2B tržište |
| payment terms | uvjeti plaćanja |
| net 30 | plaćanje u roku od 30 dana |
| tax exemption | porezno oslobođenje |
| resale certificate | potvrda za preprodaju |
| VAT number | PDV ID broj |
| sign in | prijaviti se |
| one-time code | jednokratni kod |
| checkout | naplata |
| storefront | izlog |
| theme editor | uređivač teme |
| app embed | ugradnja aplikacije |

### Hungarian (hu)

**Register.** Önözés (formális): következetesen „Ön” és felszólító mód E/3-ban („Válassza”, „Adja meg”) az alkalmazásban, a témában és az e-mailekben. Az e-mailek, a hosztolt oldalak és a megújítási szövegek barátságosabb hangvételűek, de szintén önözők.

| English | Magyar |
| --- | --- |
| wholesale | nagykereskedelmi |
| tier | szint (árszint) |
| application | jelentkezés |
| approve | jóváhagy |
| reject | elutasít |
| buyer | vásárló |
| company | vállalat |
| location | helyszín |
| catalog | katalógus |
| B2B market | B2B-piac |
| payment terms | fizetési feltételek |
| net 30 | nettó 30 nap |
| tax exemption | adómentesség |
| resale certificate | viszonteladói igazolás |
| VAT number | közösségi adószám |
| sign in | bejelentkezés |
| one-time code | egyszer használatos kód |
| checkout | pénztár |
| storefront | áruházi felület |
| theme editor | témaszerkesztő |
| app embed | alkalmazásbeágyazás |

### Indonesian (id)

**Register.** Formal dan sopan dengan sapaan "Anda" (huruf kapital), seperti di admin Shopify berbahasa Indonesia.

| English | Bahasa Indonesia |
| --- | --- |
| wholesale | grosir |
| tier | tingkat harga |
| application | pengajuan |
| approve | menyetujui |
| reject | menolak |
| buyer | pembeli |
| company | perusahaan |
| location | lokasi |
| catalog | katalog |
| B2B market | pasar B2B |
| payment terms | ketentuan pembayaran |
| net 30 | jatuh tempo 30 hari (Net 30) |
| tax exemption | pembebasan pajak |
| resale certificate | sertifikat penjualan kembali |
| VAT number | nomor PPN (VAT) |
| sign in | masuk |
| one-time code | kode sekali pakai |
| checkout | checkout |
| storefront | etalase |
| theme editor | editor tema |
| app embed | penyematan aplikasi |

### Italian (it)

**Register.** Lei (registro formale, come nell’admin Shopify in italiano), con possessivi in minuscolo (suo, sua). Pulsanti all’infinito o all’imperativo breve («Approva richiesta»); messaggi e aiuti con il Lei.

| English | Italiano |
| --- | --- |
| wholesale | all’ingrosso |
| tier | livello (livello di prezzo) |
| application | richiesta |
| approve | approvare |
| reject | rifiutare |
| buyer | acquirente |
| company | azienda |
| location | sede |
| catalog | catalogo |
| B2B market | mercato B2B |
| payment terms | termini di pagamento |
| net 30 | 30 giorni netti |
| tax exemption | esenzione fiscale |
| resale certificate | certificato di rivendita |
| VAT number | partita IVA |
| sign in | accedere |
| one-time code | codice monouso |
| checkout | checkout |
| storefront | negozio online |
| theme editor | editor di temi |
| app embed | incorporamento app |

### Japanese (ja)

**Register.** です・ます調（丁寧語）。メールとホスト型ページでは「〜いたします」「〜ください」などの敬語を使用。

| English | 日本語 |
| --- | --- |
| wholesale | 卸売 |
| tier | 価格ランク |
| application | 申請 |
| approve | 承認 |
| reject | 却下 |
| buyer | バイヤー |
| company | 会社 |
| location | ロケーション |
| catalog | カタログ |
| B2B market | B2Bマーケット |
| payment terms | 支払条件 |
| net 30 | 支払期限30日 |
| tax exemption | 免税 |
| resale certificate | 再販証明書 |
| VAT number | VAT番号 |
| sign in | ログイン |
| one-time code | ワンタイムコード |
| checkout | チェックアウト |
| storefront | ストアフロント |
| theme editor | テーマエディター |
| app embed | アプリ埋め込み |

### Korean (ko)

**Register.** 합니다체(격식체). 신청자용 이메일과 페이지는 "~해 주십시오" 형태의 정중한 표현을 사용.

| English | 한국어 |
| --- | --- |
| wholesale | 도매 |
| tier | 등급 |
| application | 신청서 |
| approve | 승인 |
| reject | 거부 |
| buyer | 구매자 |
| company | 회사 |
| location | 위치 |
| catalog | 카탈로그 |
| B2B market | B2B 마켓 |
| payment terms | 결제 조건 |
| net 30 | 30일 이내 결제 |
| tax exemption | 세금 면제 |
| resale certificate | 재판매 증명서 |
| VAT number | VAT 번호 |
| sign in | 로그인 |
| one-time code | 일회용 코드 |
| checkout | 결제 |
| storefront | 스토어프론트 |
| theme editor | 테마 편집기 |
| app embed | 앱 임베드 |

### Lithuanian (lt)

**Register.** Mandagus „Jūs“ (sakiniuose „jūs“, „jūsų“ mažąja raide, kaip Shopify administratoriaus sąsajoje). Mygtukai – bendratimi („Patvirtinti paraišką“), patarimai ir klaidos – pilnais sakiniais. Laiškai ir pareiškėjų puslapiai (email.*, hosted.*, renew.*) – draugiškesnio tono, bet su „jūs“.

| English | Lietuvių |
| --- | --- |
| wholesale | didmeninė prekyba |
| tier | lygis (kainų lygis) |
| application | paraiška |
| approve | patvirtinti |
| reject | atmesti |
| buyer | pirkėjas |
| company | įmonė |
| location | vieta |
| catalog | katalogas |
| B2B market | B2B rinka |
| payment terms | mokėjimo sąlygos |
| net 30 | apmokėjimas per 30 dienų |
| tax exemption | atleidimas nuo mokesčių |
| resale certificate | perpardavimo pažyma |
| VAT number | PVM mokėtojo kodas |
| sign in | prisijungti |
| one-time code | vienkartinis kodas |
| checkout | atsiskaitymas |
| storefront | vitrina |
| theme editor | temų redaktorius |
| app embed | programėlės įterpimas |

### Malay (ms)

**Register.** Formal dan mesra perniagaan dengan sapaan "anda" (huruf kecil), seperti dalam pentadbir Shopify Bahasa Melayu.

| English | Bahasa Melayu |
| --- | --- |
| wholesale | borong |
| tier | peringkat harga |
| application | permohonan |
| approve | luluskan |
| reject | tolak |
| buyer | pembeli |
| company | syarikat |
| location | lokasi |
| catalog | katalog |
| B2B market | pasaran B2B |
| payment terms | terma pembayaran |
| net 30 | bayar dalam 30 hari (Net 30) |
| tax exemption | pengecualian cukai |
| resale certificate | sijil jualan semula |
| VAT number | nombor VAT |
| sign in | log masuk |
| one-time code | kod sekali guna |
| checkout | daftar keluar |
| storefront | kedai dalam talian |
| theme editor | editor tema |
| app embed | benaman aplikasi |

### Norwegian Bokmål (nb)

**Register.** du – Shopifys norske standard; formell «De» brukes ikke i moderne forretningsprogramvare.

| English | Norsk bokmål |
| --- | --- |
| wholesale | engros |
| tier | nivå |
| application | søknad |
| approve | godkjenn |
| reject | avslå |
| buyer | kjøper |
| company | bedrift |
| location | lokasjon |
| catalog | katalog |
| B2B market | B2B-marked |
| payment terms | betalingsbetingelser |
| net 30 | netto 30 dager |
| tax exemption | avgiftsfritak |
| resale certificate | videresalgssertifikat |
| VAT number | MVA-nummer |
| sign in | logg inn |
| one-time code | engangskode |
| checkout | kassen |
| storefront | butikkfront |
| theme editor | temaredigeringsprogram |
| app embed | appinnbygging |

### Dutch (nl)

**Register.** u (formeel, consequent "u" en "uw" in de app, e-mails en webshopteksten)

| English | Nederlands |
| --- | --- |
| wholesale | groothandel |
| tier | niveau |
| application | aanvraag |
| approve | goedkeuren |
| reject | afwijzen |
| buyer | koper |
| company | bedrijf |
| location | locatie (bedrijfslocatie) |
| catalog | catalogus |
| B2B market | B2B-markt |
| payment terms | betalingsvoorwaarden |
| net 30 | netto 30 dagen |
| tax exemption | belastingvrijstelling |
| resale certificate | wederverkoopcertificaat |
| VAT number | btw-nummer |
| sign in | inloggen |
| one-time code | eenmalige code |
| checkout | checkout (werkwoord: afrekenen) |
| storefront | webshop |
| theme editor | thema-editor |
| app embed | app-insluiting |

### Polish (pl)

**Register.** Forma bezpośrednia jak w polskim panelu Shopify (tryb rozkazujący, „Twój” wielką literą), bez form „Pan/Pani”; w e-mailach do wnioskodawców zwroty uprzejme „Dzień dobry”, „Prosimy…”.

| English | Polski |
| --- | --- |
| wholesale | hurt / hurtowy |
| tier | poziom |
| application | wniosek |
| approve | zatwierdź |
| reject | odrzuć |
| buyer | kupujący |
| company | firma |
| location | lokalizacja |
| catalog | katalog |
| B2B market | rynek B2B |
| payment terms | warunki płatności |
| net 30 | netto 30 dni |
| tax exemption | zwolnienie z podatku |
| resale certificate | zaświadczenie o odsprzedaży |
| VAT number | numer VAT |
| sign in | zaloguj się |
| one-time code | kod jednorazowy |
| checkout | realizacja zakupu (kasa) |
| storefront | witryna sklepu |
| theme editor | edytor szablonu |
| app embed | osadzenie aplikacji |

### Brazilian Portuguese (pt-BR)

**Register.** você (tratamento cordial e profissional; sem gírias, verbos no imperativo formal: "Escolha", "Digite")

| English | Português (BR) |
| --- | --- |
| wholesale | atacado (adj.: atacadista) |
| tier | nível |
| application | solicitação |
| approve | aprovar |
| reject | recusar |
| buyer | comprador |
| company | empresa |
| location | local (local da empresa) |
| catalog | catálogo |
| B2B market | mercado B2B |
| payment terms | condições de pagamento |
| net 30 | 30 dias líquidos |
| tax exemption | isenção fiscal |
| resale certificate | certificado de revenda |
| VAT number | número de IVA |
| sign in | fazer login |
| one-time code | código de uso único |
| checkout | checkout (finalizar a compra) |
| storefront | loja virtual |
| theme editor | editor de temas |
| app embed | incorporação de app |

### European Portuguese (pt-PT)

**Register.** Tratamento formal na 3.ª pessoa sem pronome ("Pode…", "o seu", "para si"), sem "você" explícito

| English | Português (PT) |
| --- | --- |
| wholesale | venda por grosso (adj.: grossista) |
| tier | nível |
| application | candidatura |
| approve | aprovar |
| reject | rejeitar |
| buyer | comprador |
| company | empresa |
| location | localização (localização da empresa) |
| catalog | catálogo |
| B2B market | mercado B2B |
| payment terms | condições de pagamento |
| net 30 | a 30 dias |
| tax exemption | isenção fiscal |
| resale certificate | certificado de revenda |
| VAT number | número de IVA |
| sign in | iniciar sessão |
| one-time code | código de utilização única |
| checkout | checkout (finalizar a compra) |
| storefront | loja online |
| theme editor | editor de temas |
| app embed | incorporação da aplicação |

### Romanian (ro)

**Register.** Formal, cu „dumneavoastră” și imperativul de politețe („Alegeți”, „Introduceți”) în aplicație, temă și e-mailuri. În spațiile înguste se folosește abrevierea „dvs.”. E-mailurile, paginile găzduite și textele de reînnoire au un ton mai prietenos, dar rămân formale.

| English | Română |
| --- | --- |
| wholesale | en-gros |
| tier | nivel |
| application | cerere |
| approve | aprobare (a aproba) |
| reject | respingere (a respinge) |
| buyer | cumpărător |
| company | companie |
| location | locație |
| catalog | catalog |
| B2B market | piață B2B |
| payment terms | termene de plată |
| net 30 | net 30 de zile |
| tax exemption | scutire de taxe |
| resale certificate | certificat de revânzare |
| VAT number | cod de TVA |
| sign in | conectare |
| one-time code | cod unic |
| checkout | finalizarea comenzii |
| storefront | vitrină online |
| theme editor | editorul de teme |
| app embed | încorporarea aplicației |

### Russian (ru)

**Register.** Обращение на «вы» (со строчной буквы в интерфейсе, как в русском админ-интерфейсе Shopify). Кнопки — глагол в инфинитиве («Одобрить заявку»), подсказки и ошибки — полными предложениями. Письма и страницы для заявителей (email.*, hosted.*, renew.*) — дружелюбно, но на «вы».

| English | Русский |
| --- | --- |
| wholesale | оптовая торговля (опт) |
| tier | уровень (ценовой уровень) |
| application | заявка |
| approve | одобрить |
| reject | отклонить |
| buyer | покупатель |
| company | компания |
| location | местоположение |
| catalog | каталог |
| B2B market | рынок B2B |
| payment terms | условия оплаты |
| net 30 | «Оплата в течение 30 дней» |
| tax exemption | освобождение от налогов |
| resale certificate | сертификат для перепродажи |
| VAT number | номер плательщика НДС |
| sign in | войти |
| one-time code | одноразовый код |
| checkout | оформление заказа |
| storefront | витрина |
| theme editor | редактор тем |
| app embed | встраивание приложения |

### Slovak (sk)

**Register.** Vykanie (vy, vaše) s malým písmenom ako v slovenskej administrácii Shopify; e-maily a hostované stránky sú zdvorilé, ale priateľské.

| English | Slovenčina |
| --- | --- |
| wholesale | veľkoobchod |
| tier | úroveň |
| application | žiadosť |
| approve | schváliť |
| reject | zamietnuť |
| buyer | kupujúci |
| company | firma |
| location | pobočka |
| catalog | katalóg |
| B2B market | trh B2B |
| payment terms | platobné podmienky |
| net 30 | splatnosť 30 dní |
| tax exemption | oslobodenie od dane |
| resale certificate | certifikát na ďalší predaj |
| VAT number | IČ DPH |
| sign in | prihlásiť sa |
| one-time code | jednorazový kód |
| checkout | pokladňa |
| storefront | výklad |
| theme editor | editor témy |
| app embed | vloženie aplikácie |

### Slovenian (sl)

**Register.** Vikanje (vi, vaš) z malo začetnico kot v slovenski administraciji Shopify; e-poštna sporočila in gostujoče strani so vljudne, a prijazne.

| English | Slovenščina |
| --- | --- |
| wholesale | veleprodaja |
| tier | raven |
| application | vloga |
| approve | odobriti |
| reject | zavrniti |
| buyer | kupec |
| company | podjetje |
| location | lokacija |
| catalog | katalog |
| B2B market | trg B2B |
| payment terms | plačilni pogoji |
| net 30 | plačilo v 30 dneh |
| tax exemption | davčna oprostitev |
| resale certificate | potrdilo za nadaljnjo prodajo |
| VAT number | ID za DDV |
| sign in | prijava / prijaviti se |
| one-time code | enkratna koda |
| checkout | blagajna |
| storefront | izložba |
| theme editor | urejevalnik teme |
| app embed | vdelava aplikacije |

### Swedish (sv)

**Register.** du (svensk standard för affärstext, som i Shopifys svenska admin; "ni" används inte)

| English | Svenska |
| --- | --- |
| wholesale | grossist (grossistköp) |
| tier | nivå |
| application | ansökan |
| approve | godkänna |
| reject | avslå (certifikat: avvisa) |
| buyer | köpare |
| company | företag |
| location | plats (företagsplats) |
| catalog | katalog |
| B2B market | B2B-marknad |
| payment terms | betalningsvillkor |
| net 30 | netto 30 dagar |
| tax exemption | skattebefrielse (exemption code: undantag) |
| resale certificate | återförsäljarintyg |
| VAT number | momsnummer |
| sign in | logga in |
| one-time code | engångskod |
| checkout | kassa |
| storefront | butiksfront |
| theme editor | temaredigerare |
| app embed | app-inbäddning |

### Thai (th)

**Register.** ภาษาทางการแบบสุภาพ ใช้ "คุณ" และ "โปรด" ในคำแนะนำและข้อความแสดงข้อผิดพลาด ปุ่มใช้คำกริยาสั้นๆ ("บันทึก" "อนุมัติ") อีเมลและหน้าที่โฮสต์ (email.*, hosted.*, renew.*) ใช้น้ำเสียงเป็นมิตร ไม่ใช้คำลงท้าย ครับ/ค่ะ ชื่อแบรนด์คงเป็นภาษาอังกฤษ และไม่ใช้จุดท้ายประโยคตามหลักภาษาไทย

| English | ไทย |
| --- | --- |
| wholesale | ขายส่ง |
| tier | ระดับ |
| application | ใบสมัคร |
| approve | อนุมัติ |
| reject | ปฏิเสธ |
| buyer | ผู้ซื้อ |
| company | บริษัท |
| location | สถานที่ตั้ง |
| catalog | แคตตาล็อก |
| B2B market | ตลาด B2B |
| payment terms | เงื่อนไขการชำระเงิน |
| net 30 | เครดิต 30 วัน |
| tax exemption | การยกเว้นภาษี |
| resale certificate | ใบรับรองการขายต่อ |
| VAT number | หมายเลข VAT |
| sign in | เข้าสู่ระบบ |
| one-time code | รหัสแบบใช้ครั้งเดียว |
| checkout | ชำระเงิน / เช็กเอาต์ |
| storefront | หน้าร้าน |
| theme editor | ตัวแก้ไขธีม |
| app embed | การฝังแอป |

### Turkish (tr)

**Register.** "Siz" hitabı (Shopify'ın Türkçe yönetim panelindeki gibi). Düğmeler emir kipinde ("Başvuruyu onayla"), ipuçları ve hata mesajları tam cümle. Başvuru sahiplerine giden e-postalar ve sayfalar (email.*, hosted.*, renew.*) daha sıcak bir tonda, yine "siz" ile.

| English | Türkçe |
| --- | --- |
| wholesale | toptan satış |
| tier | seviye (fiyat seviyesi) |
| application | başvuru |
| approve | onayla |
| reject | reddet |
| buyer | alıcı |
| company | şirket |
| location | konum |
| catalog | katalog |
| B2B market | B2B pazarı |
| payment terms | ödeme koşulları |
| net 30 | 30 gün vadeli |
| tax exemption | vergi muafiyeti |
| resale certificate | yeniden satış sertifikası |
| VAT number | KDV numarası |
| sign in | oturum aç |
| one-time code | tek kullanımlık kod |
| checkout | ödeme |
| storefront | mağaza vitrini |
| theme editor | tema düzenleyici |
| app embed | uygulama yerleştirme |

### Urdu (ur)

**Register.** رسمی اردو، "آپ" کے ساتھ مخاطب، بٹنوں اور ہدایات میں امر ("درج کریں"، "منتخب کریں")، اور اسٹور فرنٹ کے پیغامات میں "براہ کرم"۔ ای میلز اور ہوسٹڈ صفحات (email.*، hosted.*، renew.*) دوستانہ لہجے میں۔ عام تکنیکی الفاظ (اسٹور فرنٹ، چیک آؤٹ، ایمبیڈ) انگریزی سے ماخوذ رائج صورت میں، برانڈ نام انگریزی میں، اور سمت کے نشانات استعمال نہیں کیے گئے۔

| English | اردو |
| --- | --- |
| wholesale | ہول سیل |
| tier | درجہ |
| application | درخواست |
| approve | منظور کریں |
| reject | مسترد کریں |
| buyer | خریدار |
| company | کمپنی |
| location | لوکیشن |
| catalog | کیٹلاگ |
| B2B market | B2B مارکیٹ |
| payment terms | ادائیگی کی شرائط |
| net 30 | نیٹ 30 |
| tax exemption | ٹیکس استثنیٰ |
| resale certificate | ری سیل سرٹیفکیٹ |
| VAT number | VAT نمبر |
| sign in | سائن ان |
| one-time code | ایک بار استعمال ہونے والا کوڈ |
| checkout | چیک آؤٹ |
| storefront | اسٹور فرنٹ |
| theme editor | تھیم ایڈیٹر |
| app embed | ایپ ایمبیڈ |

### Vietnamese (vi)

**Register.** Lịch sự, chuyên nghiệp với ngôi "bạn" và các từ lịch sự như "vui lòng", "hãy" (giống trang quản trị Shopify tiếng Việt); không dùng "mày/tôi" thân mật và không dùng "Quý khách".

| English | Tiếng Việt |
| --- | --- |
| wholesale | bán buôn |
| tier | cấp giá |
| application | đơn đăng ký |
| approve | phê duyệt |
| reject | từ chối |
| buyer | người mua |
| company | công ty |
| location | địa điểm |
| catalog | danh mục |
| B2B market | thị trường B2B |
| payment terms | điều khoản thanh toán |
| net 30 | thanh toán trong 30 ngày (Net 30) |
| tax exemption | miễn thuế |
| resale certificate | giấy chứng nhận bán lại |
| VAT number | mã số VAT |
| sign in | đăng nhập |
| one-time code | mã dùng một lần |
| checkout | thanh toán |
| storefront | cửa hàng trực tuyến |
| theme editor | trình chỉnh sửa chủ đề |
| app embed | nhúng ứng dụng |

### Chinese (China) (zh-CN)

**Register.** 正式书面语，统一使用“您”。

| English | 简体中文 |
| --- | --- |
| wholesale | 批发 |
| tier | 等级 |
| application | 申请 |
| approve | 批准 |
| reject | 拒绝 |
| buyer | 买家 |
| company | 公司 |
| location | 地点 |
| catalog | 目录 |
| B2B market | B2B 市场 |
| payment terms | 付款条款 |
| net 30 | 30 天内付款 |
| tax exemption | 免税 |
| resale certificate | 转售证明 |
| VAT number | 增值税号 |
| sign in | 登录 |
| one-time code | 一次性验证码 |
| checkout | 结账 |
| storefront | 店面 |
| theme editor | 模板编辑器 |
| app embed | 应用嵌入 |

### Chinese (Taiwan) (zh-TW)

**Register.** 正式書面語，統一使用「您」。

| English | 繁體中文（台灣） |
| --- | --- |
| wholesale | 批發 |
| tier | 等級 |
| application | 申請 |
| approve | 核准 |
| reject | 拒絕 |
| buyer | 買家 |
| company | 公司 |
| location | 地點 |
| catalog | 型錄 |
| B2B market | B2B 市場 |
| payment terms | 付款條件 |
| net 30 | 30 天內付款 |
| tax exemption | 免稅 |
| resale certificate | 轉售證明 |
| VAT number | VAT 號碼 |
| sign in | 登入 |
| one-time code | 一次性驗證碼 |
| checkout | 結帳 |
| storefront | 店面 |
| theme editor | 佈景主題編輯器 |
| app embed | 應用程式嵌入 |
