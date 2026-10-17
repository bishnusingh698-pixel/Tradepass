# 한국어 (ko)

## Register

합니다체(격식체). 신청자용 이메일과 페이지는 "~해 주십시오" 형태의 정중한 표현을 사용.

## Glossary

| English | 한국어 |
| --- | --- |
| wholesale | 도매 |
| tier | 등급 |
| application | 신청서 |
| approve | 승인 |
| reject | 거부 |
| buyer | 구매자 |
| company | 회사 |
| location | 위치 |
| catalog | 카탈로그 |
| B2B market | B2B 마켓 |
| payment terms | 결제 조건 |
| net 30 | 30일 이내 결제 |
| tax exemption | 세금 면제 |
| resale certificate | 재판매 증명서 |
| VAT number | VAT 번호 |
| sign in | 로그인 |
| one-time code | 일회용 코드 |
| checkout | 결제 |
| storefront | 스토어프론트 |
| theme editor | 테마 편집기 |
| app embed | 앱 임베드 |

## Back-translation check

Plan names now carry 요금제 ("Starter 요금제"), so core common.availableOn was changed from "{plan} 요금제에서 사용 가능" to "{plan}에서 사용 가능" to avoid "요금제 요금제". Checkout and payment both map to 결제 in Shopify Korean; in tier/checkout options I kept phrasing explicit (구매자가 결제 및 지불) to avoid ambiguity with 결제 조건. Colon-only strings like "{company}: {reason}" use " - " so they are not identical to English.

## Low-confidence strings

- approval.exemption.euReverseCharge / approval.tax.reason.*: 역발행 for EU reverse charge is the common term but a tax-literate reviewer should confirm.
- buyers.bulk.failedLine, applications.bulk.skippedLine: "{company} - {reason}" uses a dash instead of a colon only to differ from English.
- certificates.jurisdiction: "{country} {region}" without a comma.
- automation.condition.is / isNot: 다음과 일치 / 다음과 일치하지 않음 read as operators; check in the UI.
