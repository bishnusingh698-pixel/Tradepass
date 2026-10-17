# Hungarian (hu)

## Register
Önözés (formális): következetesen „Ön” és felszólító mód E/3-ban („Válassza”, „Adja meg”) az alkalmazásban, a témában és az e-mailekben. Az e-mailek, a hosztolt oldalak és a megújítási szövegek barátságosabb hangvételűek, de szintén önözők.

## Glossary
| English | Magyar |
| --- | --- |
| wholesale | nagykereskedelmi |
| tier | szint (árszint) |
| application | jelentkezés |
| approve | jóváhagy |
| reject | elutasít |
| buyer | vásárló |
| company | vállalat |
| location | helyszín |
| catalog | katalógus |
| B2B market | B2B-piac |
| payment terms | fizetési feltételek |
| net 30 | nettó 30 nap |
| tax exemption | adómentesség |
| resale certificate | viszonteladói igazolás |
| VAT number | közösségi adószám |
| sign in | bejelentkezés |
| one-time code | egyszer használatos kód |
| checkout | pénztár |
| storefront | áruházi felület |
| theme editor | témaszerkesztő |
| app embed | alkalmazásbeágyazás |

## Back-translation check
A „Free” csomag „Ingyenes” lett, a Starter és Pro nevek „Starter csomag” / „Pro csomag” formában szerepelnek, hogy ne egyezzenek az angollal. Visszafordítva az „Automatizálások szüneteltetése” és a „Csomagja nem ellenőrzi” jelentése megegyezik az eredetivel, csak a maxLength miatt rövidebbek. A témaszerkesztőben a blokkok neve („Nagykereskedelmi jelentkezési űrlap”, „Jelentkezés nagykereskedelmi vásárlónak”) megegyezik a Súgóban és az Áruházi felület oldalon hivatkozott névvel.

## Low-confidence strings
- `plans.name.starter`, `plans.name.pro`, `tiers.plan.*`, `certificates.plan.*`: a „csomag” szó hozzáadva; ha a kód a lefordított csomagnevet illeszti be a `{plan}` helyére (pl. `applications.detail.taxCheckPlan`, `flow.action.planRequired`), a „csomag” szó kétszer szerepelhet.
- `email.sample.terms` („Nettó 30 nap”): ellenőrizni kell a Shopify magyar fizetési feltétel elnevezésével.
- `storefront.scope.tagsHelp`: a példacímkék ékezet nélküliek (csak-viszonteladoknak, nagytetel), mert a címkék gyakran így szerepelnek.
- `import.options.noDefaultTier`: 4%-kal hosszabb a maxLength-nél.
