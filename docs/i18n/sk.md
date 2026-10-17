# Slovenčina (sk) – poznámky k prekladu

## Register

Vykanie (vy, vaše) s malým písmenom ako v slovenskej administrácii Shopify; e-maily a hostované stránky sú zdvorilé, ale priateľské.

## Glossary

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

## Back-translation check

Spätný preklad odhalil reťazce zhodné s angličtinou (napríklad „Starter“, „Pro“, „Text“); boli preformulované na „Plán Starter“, „Plán Pro“ a „Text bloku“. Vety so zástupným symbolom {plan} boli upravené, aby názov plánu správne nadväzoval („k dispozícii v pláne Starter a vyššom“). Skontrolované reťazce schvaľovania, e-mailov a formulára významovo zodpovedajú originálu.

## Low-confidence strings

- `plans.name.starter`, `plans.name.pro`, `tiers.plan.*`, `certificates.plan.*` – názvy plánov s predponou „Plán“ kvôli zákazu zhody s angličtinou; overte prirodzenosť vo všetkých vetách s {plan}.
- Plurály v kategórii `many` (desatinné čísla) – zriedkavý tvar, overte v rozhraní.
- `tiers.editor.section.defaults` – skrátené na „Predvolené pre nových kupujúcich“, aby sa zmestilo do limitu.
- `storefront` ako „výklad“ – Shopify niekedy používa „online obchod“.
