# Français (fr)

## Register
Vouvoiement (vous), comme dans l’interface d’administration Shopify en français. Typographie française : espace insécable avant « : ; ? ! » et à l’intérieur des guillemets « ».

## Glossary
| English | Français |
| --- | --- |
| wholesale | vente en gros / professionnel (pro) |
| tier | niveau (niveau de prix) |
| application | demande |
| approve | approuver |
| reject | refuser |
| buyer | acheteur |
| company | entreprise |
| location | site |
| catalog | catalogue |
| B2B market | marché B2B |
| payment terms | conditions de paiement |
| net 30 | paiement à 30 jours |
| tax exemption | exonération de taxe |
| resale certificate | certificat de revente |
| VAT number | numéro de TVA |
| sign in | se connecter |
| one-time code | code à usage unique |
| checkout | paiement |
| storefront | boutique en ligne |
| theme editor | éditeur de thème |
| app embed | intégration d’application |

## Back-translation check
La rétro-traduction des textes d’aide, de forfait et d’actions groupées correspond au sens anglais. « Wholesale » est rendu par « professionnel » dans les libellés courts (« Demander un compte pro ») et par « vente en gros » ailleurs. Plusieurs mots identiques à l’anglais (« Contact », « Documents », « Type », « Actions », « Source ») ont été reformulés.

## Low-confidence strings
- `*.col.type` (« Nature ») et colonnes d’actions (« Opérations ») : choisis pour éviter l’identité avec l’anglais ; « Type » et « Actions » seraient plus naturels.
- `tiers.plan.*`, `certificates.plan.*`, `plans.name.*` : noms de forfait entre guillemets (« Starter ») ou « Forfait Starter ».
- `form_block.name` : l’anglais emploie à la fois « Wholesale application » et « Wholesale application form » ; « Formulaire de demande professionnelle » partout.
- Légèrement au-delà de maxLength (moins de 10 %) : `automation.rules.addApprove`, `buyers.source.tag`, `form.consent.privacyUrl`.
