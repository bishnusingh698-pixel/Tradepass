# Polski (pl) translation notes

## Register

Forma bezpośrednia jak w polskim panelu Shopify (tryb rozkazujący, „Twój” wielką literą), bez form „Pan/Pani”; w e-mailach do wnioskodawców zwroty uprzejme „Dzień dobry”, „Prosimy…”.

## Glossary

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

## Back-translation check

Pierwsza wersja e-maila z zatwierdzeniem mieszała tryb rozkazujący z „Prosimy”; ujednolicono na formy bezosobowe. Pytanie „Skąd się o nas dowiedziałeś?” miało formę rodzaju męskiego i zostało zastąpione neutralnym. Kolumny „Status” (identyczne z angielskim) zmieniono na „Stan”, a nazwy planów na „Plan Pro”/„Plan Starter”.

## Low-confidence strings

- `certificates.plan.*`, `tiers.plan.*` – nazwy w cudzysłowie („Pro”) wstawiane do „Dostępne w planie {plan}”.
- `*.col.status` / `*.filter.status` – „Stan” zamiast „Status”; sprawdź, czy brzmi naturalnie.
- Odmiany liczebników w kategorii `other` (ułamki) – np. „# wniosku”; warto sprawdzić kilka wybranych.
