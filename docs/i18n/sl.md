# Slovenščina (sl) – opombe k prevodu

## Register

Vikanje (vi, vaš) z malo začetnico kot v slovenski administraciji Shopify; e-poštna sporočila in gostujoče strani so vljudne, a prijazne.

## Glossary

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

## Back-translation check

Povratni prevod je pokazal nizi, enake angleščini (npr. „Starter“, „Pro“); preoblikovani so v „Paket Starter“ in „Paket Pro“, stavki z {plan} pa so prilagojeni sklonu („na voljo v paketu Starter in višjem“). Ker je „Prijava“ že gumb za vpis, je blok za vlogo v motivu poimenovan „Poziv k veleprodajni vlogi“, da se ne zamenja z obrazcem „Vloga za veleprodajo“. Preverjeni nizi odobritve, e-pošte in obrazca pomensko ustrezajo izvirniku.

## Low-confidence strings

- `plans.name.starter`, `plans.name.pro`, `tiers.plan.*`, `certificates.plan.*` – imena paketov s predpono „Paket“; preverite naravnost v vseh stavkih s {plan}.
- `applications.businessType.distributor`, `form.option.businessType.distributor`, motiv `form.business_type.distributor` – „Distributer“; preverite, ali je zaželen zapis „distributor“.
- Motiv `apply_block.name` – „Poziv k veleprodajni vlogi“ je opisno ime, ne dobesedni prevod.
- Dvojina (`two`) v plural nizih – preverite v vmesniku.
