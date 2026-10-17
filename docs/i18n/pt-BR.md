# Português do Brasil (pt-BR)

## Register
você (tratamento cordial e profissional; sem gírias, verbos no imperativo formal: "Escolha", "Digite")

## Glossary
| English | Português (BR) |
| --- | --- |
| wholesale | atacado (adj.: atacadista) |
| tier | nível |
| application | solicitação |
| approve | aprovar |
| reject | recusar |
| buyer | comprador |
| company | empresa |
| location | local (local da empresa) |
| catalog | catálogo |
| B2B market | mercado B2B |
| payment terms | condições de pagamento |
| net 30 | 30 dias líquidos |
| tax exemption | isenção fiscal |
| resale certificate | certificado de revenda |
| VAT number | número de IVA |
| sign in | fazer login |
| one-time code | código de uso único |
| checkout | checkout (finalizar a compra) |
| storefront | loja virtual |
| theme editor | editor de temas |
| app embed | incorporação de app |

## Back-translation check
Algumas frases voltavam como "download" (enviar/baixar) de forma inconsistente; padronizei "enviar" para uploads e "baixar" para downloads. O plural "many" exigido pelo Intl foi incluído em todas as mensagens com a forma "# de …" (ex.: "1 milhão de solicitações"). O nome do bloco de app ("Solicitação de atacado") foi alinhado entre o esquema do tema e os textos de Ajuda e Início.

## Low-confidence strings
- `certificates.plan.*`, `tiers.plan.*`, `plans.name.starter`, `plans.name.pro`: nomes de plano entre aspas (“Starter”) para não ficarem idênticos ao inglês; confira a aparência em "Disponível no plano {plan}".
- `email.sample.terms` ("30 dias líquidos"): conferir o termo exato que a Shopify usa para Net 30.
- `approval.exemption.euReverseCharge` / `approval.tax.reason.*` ("autoliquidação da UE"): conceito europeu pouco usado no Brasil; conferir com um contador.
- E-mails usam "na {store_name}" (feminino, "a loja"); nomes de loja masculinos podem soar estranhos.
