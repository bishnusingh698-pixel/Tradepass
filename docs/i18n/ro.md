# Romanian (ro)

## Register
Formal, cu „dumneavoastră” și imperativul de politețe („Alegeți”, „Introduceți”) în aplicație, temă și e-mailuri. În spațiile înguste se folosește abrevierea „dvs.”. E-mailurile, paginile găzduite și textele de reînnoire au un ton mai prietenos, dar rămân formale.

## Glossary
| English | Română |
| --- | --- |
| wholesale | en-gros |
| tier | nivel |
| application | cerere |
| approve | aprobare (a aproba) |
| reject | respingere (a respinge) |
| buyer | cumpărător |
| company | companie |
| location | locație |
| catalog | catalog |
| B2B market | piață B2B |
| payment terms | termene de plată |
| net 30 | net 30 de zile |
| tax exemption | scutire de taxe |
| resale certificate | certificat de revânzare |
| VAT number | cod de TVA |
| sign in | conectare |
| one-time code | cod unic |
| checkout | finalizarea comenzii |
| storefront | vitrină online |
| theme editor | editorul de teme |
| app embed | încorporarea aplicației |

## Back-translation check
„Contact” era identic cu engleza în câteva locuri (`approval.step.contact`, `applications.col.contact`) și a devenit „Persoană de contact”; „Import” a devenit „Importare”. Formele de plural folosesc categoriile one/few/other, iar „other” include „de” („20 de cereri”). Retroversiunea pentru „Solicitați acces en-gros” dă „Request wholesale access”, apropiat de „Apply for wholesale” și folosit identic în temă și în aplicație.

## Low-confidence strings
- `plans.name.starter`, `plans.name.pro` („Plan Starter”, „Plan Pro”) și `tiers.plan.*`, `certificates.plan.*` („„Starter””): dacă `{plan}` primește numele tradus, `applications.detail.taxCheckPlan` poate afișa „planul Plan Starter”.
- `email.sample.terms` („Net 30 de zile”): de verificat cu denumirea din Shopify în română.
- `storefront.scope.tagsHelp`: etichete de exemplu fără diacritice (doar-revanzatori, vrac).
- Tema `form.error.too_long`: „{{ max }} de caractere” este corect doar pentru valori ≥ 20.
