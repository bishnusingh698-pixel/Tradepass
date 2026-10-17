# Čeština (cs) – poznámky k překladu

## Register

Vykání (vy, vaše) s malým písmenem jako v české administraci Shopify; e-maily a hostované stránky jsou zdvořilé, ale přátelské.

## Glossary

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

## Back-translation check

Zpětný překlad odhalil řetězce shodné s angličtinou (například „Distributor“, „Import“, „Starter“, „Pro“); byly přeformulovány na „Distribuční firma“, „Importováno“, „Tarif Starter“ a „Tarif Pro“. Věty se zástupným symbolem {plan} byly upraveny tak, aby se název tarifu správně skloňoval („k dispozici v tarifu Starter a vyšším“). Ostatní kontrolované řetězce (schválení, e-maily, formulář) významově odpovídají originálu.

## Low-confidence strings

- `plans.name.starter`, `plans.name.pro`, `tiers.plan.*`, `certificates.plan.*` – názvy tarifů s předponou „Tarif“ kvůli zákazu shody s angličtinou; ověřte, že znějí přirozeně ve všech větách s {plan}.
- Plurály v kategorii `many` (desetinná čísla) – málo používaný tvar, ověřte v uživatelském rozhraní.
- Motiv `form.field.website.placeholder` – „https://…“ místo „https://“, aby se řetězec lišil od angličtiny.
- `storefront` jako „výloha“ – Shopify někdy používá „online obchod“; zvoleno kvůli odlišení od celého obchodu.
