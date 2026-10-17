# Lietuvių (lt)

## Register
Mandagus „Jūs“ (sakiniuose „jūs“, „jūsų“ mažąja raide, kaip Shopify administratoriaus sąsajoje). Mygtukai – bendratimi („Patvirtinti paraišką“), patarimai ir klaidos – pilnais sakiniais. Laiškai ir pareiškėjų puslapiai (email.*, hosted.*, renew.*) – draugiškesnio tono, bet su „jūs“.

## Glossary
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

## Back-translation check
Atgalinis pagalbos, planų, masinių veiksmų ir laiškų tekstų vertimas atitiko anglišką prasmę. Visos daugiskaitos eilutės turi one/few/many/other formas, tai patvirtino scripts/i18n-check.mjs. Temos bloko pavadinimas „Didmeninės prekybos paraiška“ vienodas schemoje, pagalboje ir pradžios puslapyje.

## Low-confidence strings
- `plans.name.*`, `tiers.plan.*`, `certificates.plan.*`: planų pavadinimai kabutėse („Starter“, „Pro“, „Nemokamas“), kad nesutaptų su anglų kalba.
- Daugiskaitos `many` formos (kilmininkas, pvz., „pirkėjų“, „paraiškų“) ir trupmeniniai skaičiai: verta patikrinti gimtakalbiui.
- `help.*` meniu keliai: lietuviški Shopify administratoriaus meniu pavadinimai nesutikrinti su gyva sąsaja.
- `email.sample.*`: pavyzdinės reikšmės parinktos rankiniu būdu.
