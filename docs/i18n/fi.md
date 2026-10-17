# Suomi (fi) translation notes

## Register

Neutraali asiallinen yleiskieli: käskymuodot painikkeissa, passiivi ja persoonaton rakenne teksteissä; ei teitittelyä eikä tuttavallista sinuttelua (Shopifyn suomenkielinen käytäntö).

## Glossary

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

## Back-translation check

Hakijoille tarkoitetuissa pohjissa oli aluksi tuttavallisia kysymysmuotoja (”Kertoisitko…”); ne muutettiin muotoon ”Pyydämme…”. Paikkamerkki-termi varattiin {muuttujille}, ja kentän placeholder käännettiin ”Kentän vihjeteksti” sekaannuksen välttämiseksi. Pakettinimet muutettiin muotoon ”Pro-paketti”, ja {plan}-lauseet muotoiltiin taivutuksen välttämiseksi (”Ota {plan} käyttöön”).

## Low-confidence strings

- `certificates.plan.*`, `tiers.plan.*` – lainausmerkeissä ”Starter”/”Pro” ydinlauseeseen ”Saatavilla paketissa {plan}”; tarkista luontevuus.
- `email.*` – teksteissä on paikoin sinä-muotoa (”hakemuksesi”); tarkista, sopiiko tyyliin.
- `storefront.mode.wholesaleOnly` – ”Vain tukkuasiakkaille”, muualla tilan nimi ”Vain tukku”.
