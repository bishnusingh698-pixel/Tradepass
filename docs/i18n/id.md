# Indonesian (id)

## Register
Formal dan sopan dengan sapaan "Anda" (huruf kapital), seperti di admin Shopify berbahasa Indonesia.

## Glossary
| English | Bahasa Indonesia |
| --- | --- |
| wholesale | grosir |
| tier | tingkat harga |
| application | pengajuan |
| approve | menyetujui |
| reject | menolak |
| buyer | pembeli |
| company | perusahaan |
| location | lokasi |
| catalog | katalog |
| B2B market | pasar B2B |
| payment terms | ketentuan pembayaran |
| net 30 | jatuh tempo 30 hari (Net 30) |
| tax exemption | pembebasan pajak |
| resale certificate | sertifikat penjualan kembali |
| VAT number | nomor PPN (VAT) |
| sign in | masuk |
| one-time code | kode sekali pakai |
| checkout | checkout |
| storefront | etalase |
| theme editor | editor tema |
| app embed | penyematan aplikasi |

## Back-translation check
Beberapa string sama persis dengan bahasa Inggris ("Edit {name}", "Checkout", "Valid", "Spreadsheet", "Distributor"), jadi saya ubah menjadi "Ubah {name}", "Proses checkout", "Berlaku", "File spreadsheet" dan "Distributor grosir". Nama paket di "Tersedia di paket {plan}" sempat menjadi "paket Paket Starter", jadi `tiers.plan.*` sekarang hanya nama dalam tanda kutip. Nama blok di panduan sudah diseragamkan dengan nama blok di editor tema ("Pengajuan grosir").

## Low-confidence strings
- `approval.exemption.euReverseCharge`, `approval.tax.reason.*`, `help.faq.taxExemptions.a`: "reverse charge UE" dibiarkan sebagai istilah pajak; perlu dicek apakah ada padanan yang lebih umum.
- `help.addForm.step1`, `help.addForm.step2`: nama menu admin Shopify (Toko Online → Tema → Sesuaikan, Tambahkan blok → Aplikasi).
- `tiers.plan.starter`, `tiers.plan.pro`: nama paket dalam tanda kutip agar tidak sama dengan bahasa Inggris.
- Theme `form.tax.tax_id` ("NPWP / ID pajak") dan `form.address.zone.county`.
