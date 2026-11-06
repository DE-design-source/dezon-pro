# Tenant ownership và bảo mật dữ liệu

> **Cập nhật 2026-10-12:** tài liệu này mô tả database `qspro_en` TRƯỚC refactor (mốc audit). Cấu trúc đang chạy: [schema-hien-hanh.md](schema-hien-hanh.md); kết quả triển khai: [ket-qua-trien-khai.md](ket-qua-trien-khai.md).
>
> **Ghi chú 2026-11-06:** viết khi còn app Node (đã gỡ ở commit `5fa5d52`); đường dẫn `server/*.js`, `public/*.js`, `render.yaml` và lệnh `npm ...` trong tài liệu này là mã / cách làm cũ. Hiện nay: migration chạy bằng `go run ./cmd/migrate` (trong `backend/`), `db-map.json` duy nhất ở `backend/internal/platform/database/db-map.json`, bảng tự lọc công ty khai trong `TenantTables` (`backend/internal/platform/database/postgres.go`).

- Hiện trạng xác minh từ code commit `83d264e` và database `qspro_en` ngày 2026-10-12.
- Phần 5 là đề xuất, chưa triển khai.

## 1. Mô hình tenant hiện tại

- **Tenant = một dòng `companies`.** User thuộc một công ty qua `users.company_id`.
- **Xác định tenant của request:** server lấy từ dòng `users` trong database (không tin token, không tin client). Super admin có thể "xem như" một công ty qua header `x-view-company` (`index.js:622`).
- **Cách ly:** chỉ ở tầng ứng dụng. `server/supa.js` tự thêm `cong_ty_id = <tenant>` vào mọi select/update/delete của 18 bảng trong `TENANT_TABLES`, và tự gắn `cong_ty_id` khi insert.
- **Database không tham gia cách ly:** không RLS, không policy, một tài khoản database duy nhất cho mọi tenant.
- **Trình duyệt không chạm database.** Không có secret nào gửi xuống client.

## 2. Phân loại bảng

| Loại | Bảng | Ghi chú |
|---|---|---|
| Bảng tenant | `companies` | Không có `company_id` |
| Tenant-owned | `projects`, `quotation_lines`, `cost_estimate_lines`, `project_data_entries`, `products`, `product_combos`, `delete_requests`, `work_items`, `purchase_orders`, `purchase_order_items`, `purchase_proposals`, `purchase_proposal_items` | Luôn lọc theo công ty |
| Tenant-owned, có chia sẻ có chủ ý | `products` (hàng của Dezon), `favorite_products` | Công ty bật `has_dezon_catalog_access` đọc được sản phẩm của công ty `dezon` (chỉ đọc) và đánh dấu yêu thích chúng |
| User-owned | `users`, `notifications` | Có `company_id`; thông báo lọc thêm theo `user_id` |
| Lịch sử / nhật ký | `audit_logs`, `product_histories`, `work_item_histories` | `audit_logs` có dòng hệ thống không thuộc công ty nào |
| Global / system | (không có) | Mẫu tờ bìa, cây hạng mục, danh sách ngành nằm trong code, không trong database |

## 3. Điểm yếu đã xác minh

| # | Điểm yếu | Bằng chứng | Mức |
|---|---|---|---|
| T1 | `AUTH_SECRET` có giá trị dự phòng trong source; không khai báo ở `render.yaml` | `auth.js:14` | P0 |
| T2 | Project Supabase cũ: RLS tắt, `anon` toàn quyền, key nằm trong repo; đọc được cả `password_hash` | `db/auth.sql:30-35`; `infra/scripts/sync-from-supabase.js` | P0 |
| T3 | Đọc sản phẩm chéo công ty qua combo (`setCombo` không kiểm chủ sở hữu `sp_kem_id`; `getCombo` nạp `noScope`, `select *`) | `store_supa.js:858-895`, `:828` | P0 |
| T4 | Một webhook Lark dùng chung cho mọi công ty, gửi kèm tên và số điện thoại khách hàng | `index.js:138-139,153` | P0 |
| T5 | Super admin chưa chọn công ty: đọc mọi tenant, ghi dòng `company_id = NULL`, thông báo gửi tới admin của mọi công ty | `supa.js:50,266`; `auth.js:450` | P1 |
| T6 | Module theo gói và quyền theo tab chỉ kiểm ở trình duyệt | `public/app.js:2486-2501` | P1 |
| T7 | `supa.insert` giữ nguyên `cong_ty_id` nếu dòng đã có (`r.cong_ty_id ? r : ...`). Hiện không có đường nào để client truyền giá trị này, nhưng là bẫy cho code mới | `supa.js:268` | P2 |
| T8 | Các lệnh sửa/xoá `users` lọc theo `id` với `noScope`; cách ly dựa hoàn toàn vào `targetUser_` gọi trước đó | `auth.js:364-371,402-430` | P2 |
| T9 | `findSpAny_` và `guardSpChung_` tra theo mã SP trên mọi công ty, lấy dòng đầu: có thể gắn yêu thích vào sản phẩm công ty khác hoặc báo nhầm "sản phẩm dùng chung" | `store_supa.js:758`, `:204-205` | P2 |
| T10 | `stampCombo_` đọc toàn bộ `sp_combo` của mọi công ty mỗi lần nạp danh mục | `store_supa.js:735` | P2 |
| T11 | `companies.note` (ghi chú nội bộ của super admin) trả về mọi user của công ty qua `login` / `me` | `auth.js:104,255,262` | P2 |
| T12 | Đăng xuất, đổi mật khẩu không vô hiệu token; khoá công ty chậm tối đa 30 giây | `auth.js:288` | P2 |
| T13 | Không giới hạn số lần đăng nhập sai; mật khẩu tối thiểu 4 ký tự; so sánh chữ ký không constant-time | `auth.js:28,292` | P2 |
| T14 | File tải lên Supabase Storage là URL công khai, không chia thư mục theo công ty | `store_supa.js:974,998` | P2 |
| T15 | `deleteCongTy` không transaction, nuốt lỗi từng bảng; dòng `company_id = NULL` không bao giờ bị xoá | `auth.js:199-211` | P2 |

**Đã kiểm tra và không có vấn đề:** `password_hash` không trả về client ở bất kỳ API nào; không đường nào cho client tự chọn `cong_ty_id` khi insert (trừ super admin tạo user); user không phải super mà không có công ty bị chặn ở cả `login`, `sessionActor` và `assertTenant_`.

## 4. Danh sách `noScope` (42 chỗ theo grep; bảng dưới liệt kê 36 chỗ đã truy vết, 6 chỗ còn lại chưa phân loại)

| Nhóm | Chỗ gọi | Đánh giá |
|---|---|---|
| Đăng nhập, kiểm phiên, tự sửa | `auth.js:48, 84, 87, 213, 253, 279, 293` | Hợp lệ: chưa có ngữ cảnh công ty hoặc lọc theo `actor.uid` |
| Quản trị công ty (super) | `auth.js:96, 109, 115, 116, 130, 143, 146, 160, 195, 206, 208` | Hợp lệ: đã kiểm vai trò super; `195` kiểm thêm "công ty của mình" |
| Quản trị user | `auth.js:315, 336, 342, 355, 357, 377, 402, 404, 414, 421, 430` | Hợp lệ nhưng phụ thuộc `targetUser_` (T8) |
| Báo cáo nền | `index.js:461, 472, 478, 548, 558` | Hợp lệ; `472` nạp `password_hash` không cần thiết |
| Kho SP chung Dezon | `store_supa.js:171, 173, 185` | Có chủ ý, chỉ đọc |
| Yêu thích | `store_supa.js:776, 788` | Hợp lệ: tự ghi điều kiện công ty trong bộ lọc |
| Cần xem lại | `store_supa.js:205` (T9), `:735` (T10), `:758` (T9), `:828` (T3) | Rò hoặc lỏng |

## 5. Đề xuất (chưa triển khai)

### 5.1 Ở database - đưa vào schema mới

1. **Khoá ngoại kép theo công ty** cho quan hệ cha-con nội bộ tenant, để database từ chối liên kết chéo:
   `quotation_lines (company_id, project_code) -> projects (company_id, project_code)`, tương tự cho `cost_estimate_lines`, `project_data_entries`, `purchase_order_items -> purchase_orders`, `purchase_proposal_items -> purchase_proposals`, `product_combos.product_id -> products`.
   Cần trước: `UNIQUE (company_id, <khoá>)` ở bảng cha, và sửa 17 + 4 dòng lệch công ty (mục B2 trong audit).
2. **Không áp khoá kép** cho `favorite_products.product_id` và `product_combos.companion_product_id`: hai quan hệ này được phép trỏ sang sản phẩm của Dezon. Giữ FK đơn theo `id`.
3. **`company_id` vẫn cho phép NULL** trong đợt này. Lý do: super admin chưa chọn công ty đang ghi NULL (T5); chuyển sang `NOT NULL` là đổi hành vi, cần quyết định riêng.
4. **Unique username** toàn hệ thống: `UNIQUE (lower(username))`, sau khi xử lý cặp `tuannguyen`.

### 5.2 Ở code - nằm ngoài phạm vi "không đổi chức năng", cần quyết định riêng

- T1: bắt buộc `AUTH_SECRET`, bỏ giá trị dự phòng.
- T2: khoá project Supabase cũ (bật RLS hoặc tạm dừng project) ngay sau khi cắt chuyển.
- T3, T9, T10: thêm điều kiện công ty (hoặc "thuộc Dezon và công ty được chia sẻ") vào 4 truy vấn.
- T4: webhook theo công ty, hoặc bỏ thông tin khách hàng khỏi thẻ Lark.
- T7: `supa.insert` ghi đè `cong_ty_id` thay vì giữ nguyên.

### 5.3 RLS

Không đề xuất bật RLS trong đợt này. Lý do:
- App dùng một tài khoản database và một pool kết nối; RLS theo tenant cần `SET LOCAL app.company_id` trong transaction cho mỗi truy vấn, mà lớp dữ liệu hiện không dùng transaction.
- 42 chỗ `noScope` và kho SP chung cần policy riêng; viết sai là khoá luôn chức năng đang chạy.

Nếu sau này cần lớp phòng thủ thứ hai, làm theo thứ tự: (1) đưa mọi truy vấn vào transaction có `SET LOCAL`; (2) viết policy cho từng bảng kèm test cách ly; (3) bật `FORCE ROW LEVEL SECURITY` từng bảng một.

## 6. Kiểm thử cách ly bắt buộc

Mọi thay đổi liên quan tenant phải qua các ca sau (chi tiết ở [migration-test-plan.md](migration-test-plan.md)):

1. Công ty A không đọc được dòng riêng của B (mỗi bảng tenant-owned).
2. A không sửa, không xoá được dòng của B (kết quả 0 dòng, dữ liệu B nguyên vẹn).
3. Chèn dòng con của A trỏ vào cha của B bị database từ chối.
4. Công ty bật chia sẻ đọc được sản phẩm Dezon nhưng không sửa được.
5. User không có công ty (không phải super) bị chặn mọi truy vấn.
