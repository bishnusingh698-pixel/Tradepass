# Dutch (nl)

## Register
u (formeel, consequent "u" en "uw" in de app, e-mails en webshopteksten)

## Glossary
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

## Back-translation check
De generieke "tax number" werd eerst als "btw-nummer" vertaald; dat is te smal (ook EIN, ABN enz.), dus is het overal "belastingnummer" geworden en blijft "btw-nummer" voor VAT. "Assisted tier assignment" stond in de bestaande vertaling als "ondersteunde" (supported) toewijzing en is gecorrigeerd naar "begeleide". Het app-blok heet in de thema-editor "Groothandelsaanvraag"; alle verwijzingen in Hulp, Startpagina en Formulier gebruiken nu exact die naam.

## Low-confidence strings
- `certificates.plan.starter`, `certificates.plan.pro`, `tiers.plan.*`, `plans.name.starter`, `plans.name.pro`: plannamen staan tussen aanhalingstekens (‘Starter’) omdat ze niet gelijk aan het Engels mogen zijn; controleer of dit er goed uitziet in "Beschikbaar met abonnement {plan}".
- `email.sample.terms` ("Netto 30 dagen"): controleer tegen de exacte naam die Shopify in het Nederlands voor Net 30 gebruikt.
- `common.discard` ("Negeren", bestaand): Shopify gebruikt in de opslagbalk mogelijk een andere term.
- `storefront.wall.pagesHelp`: "handles" is onvertaald gelaten zoals in Shopify; controleer.
