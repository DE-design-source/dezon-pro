# Audit database QS Pro - hiện trạng

> **Cập nhật 2026-10-12:** tài liệu này mô tả database `qspro_en` TRƯỚC refactor (mốc audit). Cấu trúc đang chạy: [schema-hien-hanh.md](schema-hien-hanh.md); kết quả triển khai: [ket-qua-trien-khai.md](ket-qua-trien-khai.md).
>
> **Ghi chú 2026-11-06:** viết khi còn app Node (đã gỡ ở commit `5fa5d52`); đường dẫn `server/*.js`, `public/*.js`, `render.yaml` và lệnh `npm ...` trong tài liệu này là mã / cách làm cũ. Hiện nay: migration chạy bằng `go run ./cmd/migrate` (trong `backend/`), `db-map.json` duy nhất ở `backend/internal/platform/database/db-map.json`, bảng tự lọc công ty khai trong `TenantTables` (`backend/internal/platform/database/postgres.go`).

- **Ngày audit:** 2026-10-12. **Nhánh code:** `ed_data` (commit `83d264e`).
- **Giai đoạn:** 1 - chỉ đọc. Không lệnh nào trong đợt audit này làm thay đổi database hay code.
- **Chi tiết từng bảng** (cột, kiểu, ràng buộc, index, số liệu): [audit-catalog.md](audit-catalog.md), sinh tự động từ database.

## 1. Nguồn thông tin và mức độ xác minh

| Nguồn | Đã xác minh bằng cách nào | Giới hạn |
|---|---|---|
| Database `qspro_en` (PostgreSQL 17, Docker local, tên tiếng Anh) - app local đang chạy trên database này | Đọc trực tiếp catalog (`information_schema`, `pg_constraint`, `pg_indexes`) và chạy truy vấn đếm trên dữ liệu | Dữ liệu chép từ Supabase lúc 2026-10-12; ràng buộc và index là bản tôi dựng lại ngày 2026-10-07, KHÔNG phải bản sao của Supabase |
| Supabase production (tên tiếng Việt) | Chỉ qua REST với publishable key: đọc được dữ liệu, tên cột, kiểu cột (qua thông báo lỗi ép kiểu) | **Không đọc được** catalog: index, ràng buộc, trigger, RLS, function thật trên Supabase là UNKNOWN. Suy ra từ `db/*.sql` |
| `db/*.sql` (37 file migration cũ) | Đọc file | Không có thứ tự chạy, không biết file nào đã chạy trên production. 14 cột đang dùng không có trong file nào |
| Source code `server/`, `public/`, `scripts/` | 4 lượt truy vết độc lập theo nhóm bảng, mọi nhận định kèm `file:dòng` | `server/export.js` và các script test chưa truy vết sâu |

## 2. Kiến trúc hiện tại (đã xác minh)

- **Backend:** Node.js + Express, CommonJS, một tiến trình. Điểm vào `server/index.js`: `POST /api/:fn` tra bảng `REGISTRY` (khoảng 80 hàm), cộng `/export/*`, `/upload/file`, `/media`, 3 file mẫu, `/healthz`.
- **Truy cập dữ liệu:** DUY NHẤT qua `server/supa.js` (4 hàm `select / insert / update / remove`, chuỗi lọc kiểu PostgREST). Không có raw SQL, RPC, view, trigger, function hay stored procedure nào. Không có transaction: mỗi lệnh là một truy vấn riêng.
- **Đổi tên:** code dùng tên tiếng Việt; database dùng tên tiếng Anh; `server/db-map.json` ánh xạ hai chiều.
- **Frontend:** script thuần trong `public/`, gọi `api('tênHàm', ...)`. **Trình duyệt không truy cập database trực tiếp** và không nhận secret nào (`public/` không có URL/key Supabase).
- **Multi-tenant:** cột `cong_ty_id` (`company_id`) trên 18/19 bảng. Cách ly 100% nằm ở `server/supa.js` (tự thêm bộ lọc công ty theo `TENANT_TABLES`) + ngữ cảnh request trong `server/tenant.js`. Database không có RLS.
- **Xác thực:** token tự ký HMAC-SHA256, hạn 7 ngày, không lưu phiên trong database. Mỗi request đối chiếu lại dòng `users` (cache 30 giây).
- **Tác vụ nền:** một bộ hẹn giờ gửi báo cáo nhập sản phẩm lên Lark (thứ 4, thứ 7, 8h). Không có cron khác.
- **Tích hợp ngoài:** Lark webhook (chỉ gửi đi), Lark Drive (ảnh cũ), Supabase Storage (file tải lên).
- **Migration:** không có công cụ. `db/*.sql` chạy tay; `infra/db/schema.sql` là bản chụp schema tiếng Anh.

## 3. Bảng và module

19 bảng, 8.317 dòng, khoảng 5 MB. Bảng lớn nhất 3.002 dòng.

| Module | Bảng (tên trong code) | Dòng |
|---|---|---:|
| Công ty, tài khoản | `companies` (`cong_ty`), `users` | 3, 9 |
| Nhật ký, thông báo | `audit_logs` (`audit_log`), `notifications` | 2.933, 26 |
| Danh mục sản phẩm | `products` (`db_san_pham`), `product_histories`, `product_combos` (`sp_combo`), `favorite_products` (`sp_yeu_thich`), `delete_requests` | 1.093, 3.002, 85, 18, 1 |
| Dự án, bóc tách, báo giá | `projects` (`du_an`), `quotation_lines` (`db_bao_gia`), `cost_estimate_lines` (`khai_toan`), `project_data_entries` (`du_an_data`) | 30, 545, 104, 23 |
| Thư viện công tác (phần thô) | `work_items` (`cong_tac`), `work_item_histories` | 217, 1 |
| Mua hàng | `purchase_orders` (`don_mua_hang`), `purchase_order_items`, `purchase_proposals` (`de_xuat`), `purchase_proposal_items` | 65, 160, 2, 0 |

Không phát hiện bảng "không rõ mục đích" hay bảng trùng lặp. Bảng `phien_dang_nhap` (phiên đăng nhập) từng xuất hiện ở nhánh khác nhưng không tồn tại trên Supabase và không được dùng ở nhánh này.

## 4. Vấn đề phát hiện

Mức độ: **P0** = đang gây sai dữ liệu hoặc lỗ hổng, **P1** = rủi ro toàn vẹn rõ ràng, **P2** = nợ thiết kế, **P3** = dọn dẹp.

### 4.1 Lỗi và lỗ hổng (P0)

| # | Vấn đề | Bằng chứng | Hệ quả |
|---|---|---|---|
| A1 | **`products.dealer_price` mất tính tự tính.** Ở Supabase `gia_dai_ly` là cột `GENERATED ALWAYS AS (round(gia_ban_le*(1-ck_dai_ly_pct/100)))`. Trong `qspro_en` nó là cột thường, và code không bao giờ ghi cột này cho sản phẩm. Lỗi do lần chuyển đổi 2026-10-12 gây ra. | `db/schema.sql:46`; catalog `qspro_en`: `is_generated = NEVER`; `store_supa.js:132` đọc làm `donGiaVon` | Sản phẩm tạo/sửa giá qua app trên `qspro_en` sẽ có giá đại lý NULL hoặc cũ. Hiện 0 dòng lệch vì chưa ai sửa giá từ sau lần nạp dữ liệu |
| A2 | **Khoá ký token có giá trị dự phòng nằm trong source.** `AUTH_SECRET` không khai báo trong `render.yaml` hay `.env`. Nếu production không đặt biến này, ai biết uuid của user là giả mạo được token. | `auth.js:14`; `render.yaml` | Chiếm quyền tài khoản. Production có đặt hay không: UNKNOWN |
| A3 | **Project Supabase cũ vẫn mở cho mọi người.** RLS tắt, `anon` có toàn quyền; publishable key nằm trong repo. Đọc được cả `users.password_hash` và dữ liệu mọi công ty, ghi cũng được. | `infra/scripts/sync-from-supabase.js` đọc hết mọi bảng chỉ bằng key đó; `db/auth.sql:30-35` | Lộ và sửa dữ liệu từ bên ngoài, chừng nào project Supabase còn sống |
| A4 | **Đọc sản phẩm chéo công ty qua "sản phẩm đi kèm".** `setCombo` không kiểm tra `sp_kem_id` thuộc công ty nào; `getCombo` nạp các id đó với `noScope` và `select *`. | `store_supa.js:858-895`, `:828` | User có quyền sửa SP (mặc định có) đọc được trọn dòng sản phẩm của công ty khác nếu biết id |
| A5 | **Mọi công ty gửi đơn mua hàng, đề xuất, báo cáo vào cùng một nhóm Lark của Dezon**, kèm tên và số điện thoại khách hàng. | `index.js:138-139,153` | Lộ dữ liệu khách hàng giữa các tenant |

### 4.2 Toàn vẹn dữ liệu (P1)

| # | Vấn đề | Số liệu thật (2026-10-12) |
|---|---|---|
| B1 | **Quan hệ tham chiếu bằng mã dạng chữ, thiếu khoá ngoại.** Trên Supabase không có FK nào. `qspro_en` có 25 FK, còn thiếu ở các quan hệ có dòng mồ côi. | Xem bảng mồ côi bên dưới |
| B2 | **Dòng con khác công ty với dòng cha.** | 17 dòng bóc tách (13 dòng không công ty trong dự án của Dezon, 4 dòng Dezon trong dự án không công ty); 4 đơn mua không công ty thuộc dự án Dezon |
| B3 | **Dòng không thuộc công ty nào** do super admin thao tác khi chưa chọn công ty: `supa.js` không lọc và ghi `company_id = NULL`. | products 144, quotation_lines 165, product_histories 210, audit_logs 312, projects 5, purchase_orders 4, purchase_order_items 7, favorite_products 4, notifications 4, users 1 |
| B4 | **Username không duy nhất ở mức database.** Code coi là duy nhất toàn hệ thống (kiểm tra rồi mới chèn, không nguyên tử); index chỉ là `(company_id, username)` và NULL không đụng nhau. | `tuannguyen` x2 (một dòng thuộc Dezon, một dòng không công ty; cả hai chưa từng đăng nhập) |
| B5 | **Không có transaction.** Các thao tác nhiều bước tự bù bằng tay và nuốt lỗi: tạo đơn mua + dòng hàng, đề xuất + dòng, xoá dự án (4 bảng), nhân bản dự án, lưu tờ bìa (chèn mới rồi xoá cũ), xoá công ty (18 bảng). | 2 phiếu đề xuất có `so_dong` 3 và 4 nhưng 0 dòng chi tiết: di chứng của lần chèn dòng thất bại ngày 2026-09-16 |
| B6 | **`db/de_xuat.sql` sai kiểu cột.** File khai báo `chi_tiet_de_xuat.cong_ty_id bigint`; cột thật là `uuid`. Chạy lại file trên database mới là mọi phiếu đề xuất hỏng. | Xác minh kiểu thật qua lỗi ép kiểu của Supabase REST |
| B7 | **Mã sản phẩm không phải khoá** nhưng lịch sử, dòng bóc tách, dòng mua hàng và nhiều chỗ ở client tham chiếu sản phẩm bằng mã. API nhận "id nếu toàn chữ số, ngược lại là mã": một mã toàn số sẽ bị hiểu nhầm là id. | 178 mã lặp trong cùng công ty (668 dòng, đúng thiết kế biến thể); 1 mã NULL, 1 mã rỗng |

**Dòng mồ côi theo từng quan hệ**

| Quan hệ (con -> cha) | Dòng mồ côi | Nguyên nhân từ code |
|---|---:|---|
| `product_histories.product_code` -> products | 366 (86 mã) | Lịch sử cố ý giữ lại sau khi xoá SP; đổi mã SP cũng làm mồ côi lịch sử cũ |
| `purchase_order_items.product_code` -> products | 113 / 154 | Bản chụp; SP đã xoá hoặc đổi mã |
| `purchase_orders.project_code` -> projects | 55 (10 mã) | `deleteProject` không đụng tới bảng mua hàng; phần lớn là dữ liệu thử |
| `audit_logs.user_id` -> users | 13 (7 user) | `adminDeleteUser` chỉ xoá dòng `users` |
| `favorite_products.product_id` -> products | 4 | Xoá SP chỉ dọn yêu thích của công ty hiện tại |
| `quotation_lines.product_code` -> products | 4 / 520 | Bản chụp |
| `quotation_lines.project_code` -> projects | 3 (2 mã, một mã là chuỗi `<maDA>`) | Dữ liệu thử |
| `audit_logs.company_id` -> companies | 3 | Dòng `delete_company` đóng dấu id công ty vừa xoá |
| `notifications.user_id` -> users | 2 | User đã xoá; thông báo không ai đọc được nữa |
| `purchase_proposals.project_code` -> projects | 2 | Dự án đã xoá |
| `delete_requests.requester_id`, `purchase_orders.requester_id` -> users | 1, 1 | User đã xoá |

Các quan hệ còn lại (users->companies, combo->products, tờ bìa->dự án, dòng đơn->đơn, lịch sử công tác->công tác...) có 0 dòng mồ côi.

### 4.3 Thiết kế (P2)

| # | Vấn đề | Bằng chứng |
|---|---|---|
| C1 | **`products` có 141 cột, phần lớn chỉ áp dụng cho một ngành.** 44 cột chưa từng có dữ liệu (37 cột Công tắc - Ổ cắm mới thêm). Mỗi ngành chỉ dùng 47-52 cột. Mỗi ngành mới thêm 20-40 cột text vào bảng lõi. | Cột chỉ riêng một ngành: đèn 26, vệ sinh 20, sơn 17, công tắc 37; 32 cột dùng chung từ 2 ngành trở lên |
| C2 | **"Dự án" không có bảng riêng.** Mỗi dòng `projects` là một bản nháp; giao diện gom theo `lower(trim(tên dự án))`. Thông tin chung được ghi lặp vào từng bản nháp. | `public/app.js:2107-2113`, `:2303-2315` |
| C3 | **`project_data_entries` chứa 5 tập dữ liệu quan hệ dưới dạng JSON**, khoá bằng tên, vị trí mảng hoặc id dòng: phần thô (`phanTho`), lịch sử phiên bản báo giá (`bgHist`, tới 200 KB/giá trị), lịch thanh toán theo NCC (`mhPay`), định dạng ô theo id dòng (`btFmt`), thông tin công tác theo tên (`ptInfo`). | Xem [data-dictionary.md](data-dictionary.md) mục JSON |
| C4 | **Mã giả trong cột tham chiếu.** `project_data_entries.project_code` chứa cả `'__cty:<company_id>'` cho dữ liệu cấp công ty, nên không đặt được FK tới `projects`. | `store_supa.js:1104,1112-1120` |
| C5 | **`purchase_proposal_items` đa hình.** Cùng cột mang nghĩa khác nhau theo loại phiếu: `rate_pct` là % chiết khấu (ck) hoặc % đợt (tt); `product_name` chứa nhãn "Đợt N"; 8 cột chỉ dùng cho ck, 2 cột chỉ dùng cho tt. | `store_supa.js:1238-1249` |
| C6 | **Cột đa nghĩa và đa trị.** `quotation_lines.takeoff_group` là mã cây, hoặc tên nhóm tự tạo, hoặc tiêu đề mục công tác. Danh sách nối chuỗi: `companies.features`, `users.permissions` (dấu phẩy), `projects.custom_groups / custom_floors` (dấu `|`), `products.image_urls` (xuống dòng, 393 dòng nhiều ảnh), `purchase_order_items.room` (dấu phẩy). | Truy vết code |
| C7 | **Tham chiếu theo tên.** `quotation_lines.floor` phải khớp tên trong `projects.custom_floors`; đổi tên tầng phải cập nhật từng dòng. Người duyệt, người tạo lưu bằng username dạng chữ, không phải id. | `public/boc.js:655-675` |
| C8 | **Số tổng lưu sẵn không tính lại.** Tổng đơn mua do client tính, server không kiểm. `cost_estimate_lines.cost` chỉ được làm mới lúc xuất Excel. Hiện dữ liệu khớp 100% (0 đơn lệch tổng). | `store_supa.js:1155`; `public/baogia.js:908-913` |
| C9 | **Trạng thái cũ không có lối ra.** 31/65 đơn mua ở trạng thái `Đã gửi` (mặc định cũ): không code nào ghi, không chuyển đi đâu được; trang admin vẫn hiện nút Duyệt rồi server từ chối. | `db/schema.sql:135`; `auth.js:648-649` |
| C10 | **Quyền chỉ kiểm ở trình duyệt.** Module theo gói (`features`) và quyền theo tab (`permissions`) không được server kiểm; user đăng nhập gọi được mọi API không thuộc nhóm admin. | `public/app.js:2486-2501` |

### 4.4 Dọn dẹp (P3)

| Cột | Tình trạng | Bằng chứng |
|---|---|---|
| `quotation_lines.zone` (`khu_vuc`) | Không nơi nào tham chiếu; API `khuVuc` ánh xạ vào cột `room` | grep toàn bộ `server/`, `public/` |
| `quotation_lines.line_no` (`stt`) | Luôn bằng `String(sort_order)`; chỉ ghi | `store_supa.js:355,385,319` |
| `quotation_lines.markup_pct`, `margin_pct`, `profit_amount` | Dẫn xuất, chỉ ghi, không đọc; client tự tính lại | `store_supa.js:362,399` |
| `quotation_lines.is_manual_entry`, `is_saved_to_catalog` | Luôn 0; client không đọc không ghi | 545/545 dòng bằng 0 |
| `companies.last_reminder_date`, `reminder_milestone` | Tính năng nhắc hạn đã gỡ khỏi code. Cập nhật 2026-10-15: dùng lại cho nhắc gia hạn trong ứng dụng (M17.3, migration 0012), ra khỏi danh sách xoá D-09 | commit `42af44d` |
| `delete_requests.note`, `product_combos.note`, `favorite_products.product_code` | Không đọc; hai cột đầu cũng không ghi giá trị thật | truy vết code |
| `work_items.sort_order` (`thu_tu`) | Dùng để sắp xếp nhưng client không bao giờ gửi; luôn 0 | `public/sanpham.js:1230-1234` |
| Index | 64 index trên 5 MB dữ liệu. Với kích thước này planner chủ yếu quét tuần tự | [query-performance.md](query-performance.md) |

Không cột nào trong danh sách này được đề xuất xoá ngay; xem lộ trình ở [migration-plan.md](migration-plan.md).

## 5. Thông tin còn thiếu

1. Catalog thật của Supabase production (index, ràng buộc, RLS, trigger). Cần quyền SQL Editor hoặc chuỗi kết nối Postgres.
2. `AUTH_SECRET`, `PURCHASE_WEBHOOK`, `REPORT_WEBHOOK` có được đặt trên Render không.
3. Project Supabase cũ còn hoạt động không, và production hiện chạy trên database nào.
4. Đơn mua hàng có được phép tồn tại sau khi xoá dự án không (hiện tại: có, do code không xoá).
5. Dòng không công ty (mục B3) là dữ liệu thử hay dữ liệu thật cần gán về công ty nào.
6. Hai tài khoản `tuannguyen`: giữ dòng nào.
7. Khối lượng dữ liệu dự kiến sau 1-2 năm (quyết định có cần phân trang phía server không).

## 6. Rủi ro nếu thay đổi ngay

- **Không có bộ test tích hợp trên database thật.** `npm test` dùng database giả trong bộ nhớ; chỉ kiểm thử được luồng nhập sản phẩm.
- **Client phụ thuộc trực tiếp tên cột tiếng Việt** ở một số chỗ: `getDbProduct` trả nguyên dòng database, `prodToObj().raw` dùng tên cột làm khoá, form sản phẩm dùng `data-col="<tên cột>"`.
- **Hai dạng đối tượng đơn mua** (trang admin và tab Mua hàng) dùng tên trường khác nhau; cả hai phải giữ nguyên.
- **Chuỗi trạng thái tiếng Việt** được so sánh trực tiếp ở cả server và client.
- **Mã dạng chữ là định danh công khai** (`ma_da`, `ma_don`, `ma_de_xuat`): nằm trong thông báo, nhật ký, thẻ Lark, khoá localStorage.
- **Thêm ràng buộc trước khi xử lý dữ liệu sai** sẽ thất bại hoặc chặn thao tác đang chạy được (ví dụ super admin ghi dòng không công ty).
- **Production (Render) chưa có đường tới database mới.** Mọi thay đổi hiện chỉ ảnh hưởng bản local.
