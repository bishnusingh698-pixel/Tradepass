# Vietnamese (vi)

## Register
Lịch sự, chuyên nghiệp với ngôi "bạn" và các từ lịch sự như "vui lòng", "hãy" (giống trang quản trị Shopify tiếng Việt); không dùng "mày/tôi" thân mật và không dùng "Quý khách".

## Glossary
| English | Tiếng Việt |
| --- | --- |
| wholesale | bán buôn |
| tier | cấp giá |
| application | đơn đăng ký |
| approve | phê duyệt |
| reject | từ chối |
| buyer | người mua |
| company | công ty |
| location | địa điểm |
| catalog | danh mục |
| B2B market | thị trường B2B |
| payment terms | điều khoản thanh toán |
| net 30 | thanh toán trong 30 ngày (Net 30) |
| tax exemption | miễn thuế |
| resale certificate | giấy chứng nhận bán lại |
| VAT number | mã số VAT |
| sign in | đăng nhập |
| one-time code | mã dùng một lần |
| checkout | thanh toán |
| storefront | cửa hàng trực tuyến |
| theme editor | trình chỉnh sửa chủ đề |
| app embed | nhúng ứng dụng |

## Back-translation check
Một số chuỗi ban đầu trùng tiếng Anh ("Email", "{company}: {reason}", "{country}, {region}"), nên tôi đổi thành "Địa chỉ email" và dùng dấu gạch ngang "–". Tên gói dùng trong "Có trên gói {plan}" bị lặp thành "gói Gói Starter", nên `tiers.plan.*` giờ chỉ là tên đặt trong ngoặc kép. Tên khối trong hướng dẫn (help, home, form) đã được thống nhất với tên khối trong trình chỉnh sửa chủ đề ("Đơn đăng ký bán buôn").

## Low-confidence strings
- `help.addForm.step1`, `help.addForm.step2`, `help.faq.documents.a`, `settings.branding.logoHelp`: tên menu của trang quản trị Shopify (Cửa hàng trực tuyến → Chủ đề → Tùy chỉnh, Nội dung → Tệp) cần đối chiếu với giao diện Shopify tiếng Việt hiện tại.
- `tiers.plan.starter`, `tiers.plan.pro`: tên gói được đặt trong ngoặc kép để không trùng tiếng Anh.
- `approval.exemption.euReverseCharge`, `approval.tax.reason.*`: thuật ngữ "đảo ngược thuế" cho EU reverse charge.
- Theme `form.address.zone.county`, `form.address.zone.governorate`, `form.address.zone.prefecture`: nhãn đơn vị hành chính nước ngoài.
