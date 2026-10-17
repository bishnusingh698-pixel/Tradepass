# Dansk (da) translation notes

## Register

du – Shopifys danske standard for administratoren og kundemails; formel »De« bruges ikke i moderne erhvervssoftware.

## Glossary

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

## Back-translation check

Første udkast oversatte »Status«, »Type« og »Banner« ordret, hvilket gav strenge identiske med engelsk; de er omformuleret (»Certifikatstatus«, »Certifikattype«, »Som banner«). »Hver virksomhed får en virksomhed i Shopify« (bulk-godkendelse) blev tilbageoversat som en tautologi og er rettet. Plannavne fik suffikset »-abonnement«, så Starter/Pro ikke er identiske med engelsk, og »{plan}«-sætninger er tilpasset.

## Low-confidence strings

- `plans.name.starter` / `plans.name.pro` / `certificates.plan.*` / `tiers.plan.*` – plannavne med »-abonnement(et)« for at undgå engelsk-identiske strenge; tjek, at de læses naturligt i alle {plan}-sætninger.
- `storefront.mode.wholesaleOnly` vs. tilstandsnavnet »Kun engros« i andre strenge – to formuleringer af samme tilstand.
- `tiers.editor.checkout` – »Betaling« som etiket for checkout; kan forveksles med betalingsbetingelser.
