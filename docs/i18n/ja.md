# 日本語 (ja)

## Register

です・ます調（丁寧語）。メールとホスト型ページでは「〜いたします」「〜ください」などの敬語を使用。

## Glossary

| English | 日本語 |
| --- | --- |
| wholesale | 卸売 |
| tier | 価格ランク |
| application | 申請 |
| approve | 承認 |
| reject | 却下 |
| buyer | バイヤー |
| company | 会社 |
| location | ロケーション |
| catalog | カタログ |
| B2B market | B2Bマーケット |
| payment terms | 支払条件 |
| net 30 | 支払期限30日 |
| tax exemption | 免税 |
| resale certificate | 再販証明書 |
| VAT number | VAT番号 |
| sign in | ログイン |
| one-time code | ワンタイムコード |
| checkout | チェックアウト |
| storefront | ストアフロント |
| theme editor | テーマエディター |
| app embed | アプリ埋め込み |

## Back-translation check

Existing catalogs used 価格ランク for tier, so it is kept everywhere instead of ティア. Back-translating the Flow plan message showed "Starterプランプラン" (plan name already carries プラン), so messages that embed {plan} no longer add プラン. Merchant-facing "Reject" is 却下 (not 拒否) consistently; the rejection email avoids the word and uses a softer 承認いたしかねます. Block name in Help, Home and Form now matches the translated theme block name 卸売申請フォーム.

## Low-confidence strings

- email.sample.firstName / email.received.body etc.: {first_name}様 uses the given name with 様; some merchants may prefer the family name.
- email.sample.terms / glossary net 30: 支払期限30日 chosen; Shopify admin may show a different Net 30 label.
- applications.detail.submitted: 送信日： precedes a relative time; word order depends on how the UI renders it.
- brand.powered_by (theme): Tradepassで作成 is a free rendering of Powered by Tradepass.
