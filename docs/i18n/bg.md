# Bulgarian (bg)

## Register
Официално обръщение с „Вие“ (с главна буква, включително „Ви“, „Вашия“) и учтив повелителен начин („Изберете“, „Въведете“). Имейлите, хостваните страници и текстовете за подновяване са по-приятелски, но запазват учтивата форма.

## Glossary
| English | Български |
| --- | --- |
| wholesale | на едро |
| tier | ниво |
| application | заявка |
| approve | одобряване |
| reject | отхвърляне |
| buyer | купувач |
| company | фирма |
| location | местоположение |
| catalog | каталог |
| B2B market | B2B пазар |
| payment terms | условия на плащане |
| net 30 | нето 30 дни |
| tax exemption | данъчно освобождаване |
| resale certificate | сертификат за препродажба |
| VAT number | ДДС номер |
| sign in | вход |
| one-time code | еднократен код |
| checkout | плащане |
| storefront | витрина |
| theme editor | редактор на теми |
| app embed | вграждане на приложение |

## Back-translation check
„Кандидатствайте за покупки на едро“ се превежда обратно като „Apply for wholesale purchasing“ и се използва еднакво в темата, банера и страницата „Витрина“. „С помощ“ (Assisted) е избрано вместо „Асистирано“, защото е по-разбираемо за търговци. Обратният превод на имейл текстовете запазва дружелюбния тон без загуба на учтивата форма.

## Low-confidence strings
- `plans.name.starter`, `plans.name.pro` („План Starter“, „План Pro“), `tiers.plan.*`, `certificates.plan.*` („„Starter““): възможно е двойно „план“, ако `{plan}` получава преведеното име.
- `email.sample.terms` („Нето 30 дни“): да се сравни с българското име в Shopify.
- `storefront.scope.tagsHelp`: примерните етикети са на латиница (samo-za-targovci, na-edro).
- Тема `form.field.consent.label`: използва „Съгласен/съгласна“, тъй като родът на подателя е неизвестен.
