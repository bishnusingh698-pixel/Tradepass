# Hrvatski (hr) – bilješke o prijevodu

## Register

Persiranje (vi, vaš) malim slovom kao u hrvatskoj administraciji Shopifyja; e-poruke i hostirane stranice su uljudne, ali prijateljske.

## Glossary

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

## Back-translation check

Povratni prijevod otkrio je nizove jednake engleskima („Status“, „Problem“, „Starter“, „Pro“); preoblikovani su u „Stanje“, „Opis problema“, „Paket Starter“ i „Paket Pro“, a rečenice s {plan} prilagođene su padežu („dostupno u paketu Starter i višem“). Pozdrav u e-porukama promijenjen je u „Dobar dan, {first_name},“ jer zvuči prirodnije od doslovnog „Pozdrav“. Provjereni nizovi odobrenja, e-pošte i obrasca značenjem odgovaraju izvorniku.

## Low-confidence strings

- `plans.name.starter`, `plans.name.pro`, `tiers.plan.*`, `certificates.plan.*` – nazivi paketa s prefiksom „Paket“; provjerite prirodnost u svim rečenicama s {plan}.
- `email.*.body` – pozdrav „Dobar dan, {first_name},“ uz ime u nominativu; provjerite ton.
- `applications.taxCheck.skipped` – skraćeno na „Nije provjereno u vašem paketu“ zbog ograničenja od 30 znakova.
- `tiers.col.status` – „Stanje“ umjesto uobičajenog „Status“ (izbjegnuta jednakost s engleskim).
