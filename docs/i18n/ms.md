# Malay (ms)

## Register
Formal dan mesra perniagaan dengan sapaan "anda" (huruf kecil), seperti dalam pentadbir Shopify Bahasa Melayu.

## Glossary
| English | Bahasa Melayu |
| --- | --- |
| wholesale | borong |
| tier | peringkat harga |
| application | permohonan |
| approve | luluskan |
| reject | tolak |
| buyer | pembeli |
| company | syarikat |
| location | lokasi |
| catalog | katalog |
| B2B market | pasaran B2B |
| payment terms | terma pembayaran |
| net 30 | bayar dalam 30 hari (Net 30) |
| tax exemption | pengecualian cukai |
| resale certificate | sijil jualan semula |
| VAT number | nombor VAT |
| sign in | log masuk |
| one-time code | kod sekali guna |
| checkout | daftar keluar |
| storefront | kedai dalam talian |
| theme editor | editor tema |
| app embed | benaman aplikasi |

## Back-translation check
Beberapa string sama persis dengan bahasa Inggeris ("Status", "Edit {name}", "Import"), jadi saya tukar kepada "Keadaan", "Sunting {name}" dan "Jenis import". Saya juga membetulkan bentuk bahasa Indonesia yang terbawa ("menemukan" kepada "menemui" dalam `errors.notFound`). Nama pelan dalam "Tersedia pada pelan {plan}" sempat menjadi "pelan Pelan Starter", jadi `tiers.plan.*` kini hanya nama dalam tanda petik. Nama blok dalam panduan diseragamkan dengan nama blok dalam editor tema ("Permohonan borong").

## Low-confidence strings
- `help.debug.*`: "nyahpepijat" untuk debug mungkin terlalu teknikal; mungkin "mod debug" lebih biasa.
- `form.type.select`: "Senarai juntai bawah" untuk dropdown.
- `help.addForm.step1`, `help.addForm.step2`: nama menu pentadbir Shopify (Kedai Dalam Talian → Tema → Sesuaikan).
- `tiers.plan.starter`, `tiers.plan.pro`: nama pelan dalam tanda petik supaya tidak sama dengan bahasa Inggeris.
- Theme `form.address.zone.emirate`, `form.address.zone.governorate`: label pentadbiran luar negara.
