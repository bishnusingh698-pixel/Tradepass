# Svenska (sv)

## Register
du (svensk standard för affärstext, som i Shopifys svenska admin; "ni" används inte)

## Glossary
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

## Back-translation check
"Email" översattes omväxlande som "e-post" och "mejl"; nu används "e-post" för fält och adresser och "mejl" för enskilda meddelanden. Några strängar var identiska med engelskan ("Status", "Problem", "Import") och formulerades om ("Läge", "Beskrivning", "Importerad"). Blocknamnet "Grossistansökan" är samordnat mellan temat och hjälptexterna.

## Low-confidence strings
- `certificates.plan.*`, `tiers.plan.*`, `plans.name.starter`, `plans.name.pro`: abonnemangsnamn inom citattecken (”Starter”) så att de inte är identiska med engelskan; kontrollera i "Tillgänglig med {plan}".
- `nav.storefront` / "butiksfront" (befintlig): Shopify använder "Webbutik" för Online Store; bekräfta att termen känns naturlig.
- `applications.col.status` ("Läge"): omformulerat för att inte vara lika med engelskan; "Status" vore mer naturligt.
- `import.report.message` ("Beskrivning"): samma skäl som ovan.
