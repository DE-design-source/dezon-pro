# Schema đề xuất

> **Cập nhật 2026-10-12:** đề xuất này ĐÃ được triển khai trên database local `qspro_en2`, có điều chỉnh. Cấu trúc đang chạy: [schema-hien-hanh.md](schema-hien-hanh.md). Những gì đã làm và khác gì so với bản dưới đây: [ket-qua-trien-khai.md](ket-qua-trien-khai.md). Nội dung bên dưới là bản đề xuất gốc, giữ lại để tra lý do.
>
> **Ghi chú 2026-11-06:** viết khi còn app Node (đã gỡ ở commit `5fa5d52`); đường dẫn `server/*.js`, `public/*.js`, `render.yaml` và lệnh `npm ...` trong tài liệu này là mã / cách làm cũ. Hiện nay: migration chạy bằng `go run ./cmd/migrate` (trong `backend/`), `db-map.json` duy nhất ở `backend/internal/platform/database/db-map.json`, bảng tự lọc công ty khai trong `TenantTables` (`backend/internal/platform/database/postgres.go`).

- Trạng thái: **ĐỀ XUẤT - chờ duyệt** (2026-10-12). Chưa có gì được tạo trong database.
- Điểm xuất phát: schema hiện tại của `qspro_en` (xem [audit-catalog.md](audit-catalog.md)). Tài liệu này chỉ mô tả **phần thay đổi**; mọi bảng, cột không nhắc tới giữ nguyên.
- Lý do từng thay đổi: [decisions.md](decisions.md). Cách chuyển dữ liệu: [migration-plan.md](migration-plan.md). Sơ đồ: [erd.md](erd.md).

## 1. Nguyên tắc

1. **Giữ hợp đồng API.** Mọi hàm `/api/*` trả đúng hình dạng cũ. Client không đổi.
2. **Database là nơi bảo vệ toàn vẹn.** Quan hệ sở hữu có khoá ngoại; quan hệ nội bộ công ty dùng khoá kép; bất biến số học có CHECK.
3. **Một nơi biết cấu trúc database:** `server/supa.js` + `server/db-map.json`.
4. **Không đổi nghiệp vụ.** Chỗ nào chuẩn hoá sẽ đổi hành vi thì không làm (D-10).
5. **Chỉ thêm ràng buộc khi 100% dòng hiện có thoả**, hoặc sau khi dòng sai được xử lý có phê duyệt.

## 2. Tóm tắt thay đổi theo đợt

| Đợt | Nội dung | Đổi code | Rủi ro |
|---|---|---|---|
| 0 - sửa lỗi | `products.dealer_price` thành cột tự tính | Không | Thấp |
| 1 - toàn vẹn | Khoá ngoại, khoá kép theo công ty, unique username, CHECK công thức, bảng `company_settings`, cơ chế migration | `store_supa.js`: 2 hàm; `db-map.json` | Thấp-vừa |
| 2 - cấu trúc | Tách thông số sản phẩm theo ngành; tách dòng đề xuất; transaction | `supa.js`, `db-map.json`, `store_supa.js` (phần đề xuất và 6 thao tác nhiều bước), `auth.js` (2 chỗ đọc dòng đề xuất) | Vừa-cao |
| 3 - thu gọn | Xoá 12 cột không dùng | `supa.js` (bỏ qua cột khi ghi) | Thấp |

Sau đợt 2: 24 bảng (19 hiện có + `company_settings` + 4 bảng thông số ngành + tách 1 bảng dòng đề xuất thành 2, tức +5 và 1 bảng đổi thành 2).

## 3. Đợt 0 - sửa lỗi

```sql
alter table products drop column dealer_price;
alter table products add column dealer_price numeric
  generated always as (round(coalesce(retail_price, 0) * (1 - coalesce(dealer_discount_pct, 0) / 100.0))) stored;
```

Biểu thức chép nguyên từ `db/schema.sql:46`. Xoá rồi thêm lại làm cột chuyển xuống cuối bảng; không ảnh hưởng vì lớp dữ liệu luôn đọc theo tên.

## 4. Đợt 1 - toàn vẹn

### 4.1 Bảng mới `company_settings`

Thay cho mã giả `'__cty:<id>'` trong `project_data_entries` (D-03).

| Cột | Kiểu | NULL | Ghi chú |
|---|---|---|---|
| `company_id` | uuid | không | PK (1/2); FK -> `companies(id)` ON DELETE CASCADE |
| `setting_key` | text | không | PK (2/2); CHECK trong (`ptInfo`, `bgOrg`) |
| `setting_value` | jsonb | không | Cấu trúc: xem [data-dictionary.md](data-dictionary.md) mục JSON |
| `updated_at` | timestamptz | không | mặc định `now()` |
| `updated_by` | text | có | username người sửa cuối |

- Loại: cấu hình, tenant-owned.
- **Cần xác nhận:** super admin chưa chọn công ty hiện ghi cấu hình này vào mã `'__cty:0'` (không thuộc công ty nào). Bảng mới bắt buộc có `company_id`, nên trường hợp này sẽ bị từ chối với thông báo "hãy chọn công ty trước". Đây là thay đổi hành vi duy nhất của đợt 1. Dữ liệu hiện tại không có dòng `'__cty:0'` nào.

### 4.2 Khoá ngoại và unique

Bảng cha thêm unique kép làm đích cho khoá ngoại kép:

| Bảng | Unique thêm |
|---|---|
| `projects` | `(company_id, project_code)` |
| `purchase_orders` | `(company_id, order_code)` |
| `purchase_proposals` | `(company_id, proposal_code)` |
| `products` | `(company_id, id)` |
| `users` | `(lower(username))` |

Khoá ngoại (thay FK đơn hiện có nếu trùng quan hệ):

| Bảng con | Cột | Tham chiếu | ON DELETE | Mới / thay |
|---|---|---|---|---|
| `quotation_lines` | `(company_id, project_code)` | `projects (company_id, project_code)` | CASCADE | mới |
| `cost_estimate_lines` | `(company_id, project_code)` | `projects` | CASCADE | thay FK đơn |
| `project_data_entries` | `(company_id, project_code)` | `projects` | CASCADE | mới |
| `purchase_order_items` | `(company_id, order_code)` | `purchase_orders` | CASCADE | thay FK đơn |
| `purchase_proposal_items` | `(company_id, proposal_code)` | `purchase_proposals` | CASCADE | thay FK đơn |
| `product_combos` | `(company_id, product_id)` | `products (company_id, id)` | CASCADE | thay FK đơn |
| `favorite_products` | `product_id` | `products (id)` | CASCADE | mới |
| `notifications` | `user_id` | `users (id)` | CASCADE | mới |
| `purchase_orders` | `requester_id` | `users (id)` | SET NULL | mới |
| `delete_requests` | `requester_id` | `users (id)` | SET NULL | mới |

Ghi chú về khoá kép với `company_id` NULL: PostgreSQL bỏ qua kiểm tra khi một cột của khoá ngoại là NULL (`MATCH SIMPLE`). Dòng không công ty vì thế không được bảo vệ; số dòng này được theo dõi bằng truy vấn kiểm tra trong [migration-test-plan.md](migration-test-plan.md).

Tham chiếu mềm, **cố ý không có khoá ngoại** (ghi vào chú thích cột): `purchase_orders.project_code`, `purchase_proposals.project_code`, mọi `product_code` trên dòng báo giá / mua hàng / lịch sử, `audit_logs.user_id`, `audit_logs.company_id`, `work_item_histories.work_item_id`, `notifications.ref_id`.

### 4.3 CHECK công thức (D-07)

| Bảng | Ràng buộc |
|---|---|
| `quotation_lines` | `amount = round(quantity * unit_price)` |
| `quotation_lines` | `dealer_price = round(retail_price * (1 - dealer_discount_pct / 100))` |
| `quotation_lines` | `unit_price = round(selling_price * (1 - customer_discount_pct / 100))` |
| `purchase_orders` | `total_amount = subtotal_before_vat + vat_amount` |

Mỗi CHECK chỉ được thêm nếu truy vấn đếm vi phạm trên dữ liệu thật trả 0. Nếu có vi phạm: không thêm, ghi lại trong báo cáo đợt 1.

### 4.4 Chú thích

- Đánh dấu `DEPRECATED` 12 cột ở D-09 (từ 2026-10-15 danh sách còn 8 cột: 4 cột được dùng lại, migration 0010 / 0012 / 0013 đổi chú thích).
- Ghi "soft reference - no FK by design" cho các cột ở 4.2.
- Bổ sung chú thích tiếng Anh có nghĩa cho 39 cột Công tắc - Ổ cắm (hiện chỉ ghi tên cũ).

### 4.5 Cơ chế migration

Bảng `schema_migrations (version text primary key, name text not null, checksum text not null, applied_at timestamptz not null default now())` và `infra/scripts/migrate.js` (D-12).

## 5. Đợt 2 - cấu trúc

### 5.1 Sản phẩm: bảng lõi + bảng thông số theo ngành (D-06)

**`products` (lõi)** giữ:

- Định danh và phân loại: `id, company_id, product_code, product_name, product_line, category, product_group, brand, supplier_name, sector, variant_group, status`.
- Thương mại: `unit, retail_price, dealer_discount_pct, dealer_price (generated), warranty_years`.
- 5 trục biến thể (thuộc unique index): `color_temperature_k, power_w, beam_angle_deg, color, size`.
- Thuộc tính dùng từ 2 ngành trở lên: `material, ip_rating, installation_type, surface_finish, caution, features`.
- Tài liệu và ảnh: `image_urls, datasheet_url, spec_sheet_url, installation_guide_url, drawing_file_url, note`.
- Duyệt và dấu vết: `is_approved, approved_by, approved_at, created_by, created_at, updated_by, updated_at`.

**Bảng thông số** (mỗi bảng: `product_id bigint primary key references products(id) on delete cascade`, còn lại là cột thông số `text`/`numeric` đúng kiểu hiện có):

| Bảng | Ngành | Số cột thông số | Nguồn định nghĩa |
|---|---|---:|---|
| `product_lighting_specs` | `den` | khoảng 23 | `DB_LABEL2COL` trong `store_supa.js:444-454` |
| `product_sanitary_specs` | `vs` | khoảng 20 | `public/vs-spec.js` |
| `product_paint_specs` | `son` | khoảng 17 | `public/son-spec.js` |
| `product_switch_socket_specs` | `ct` | khoảng 37 | `public/ct-spec.js` |

Danh sách cột chính xác của từng bảng được chốt bằng script đối chiếu spec file với dữ liệu thật ở đầu đợt 2 (cột nào đang có dữ liệu ở 2 ngành trở lên thì ở lại bảng lõi).

**View `product_catalog`:** `products` nối trái 4 bảng thông số, trả đủ 141 cột với tên như hiện tại. Lớp dữ liệu đọc `db_san_pham` từ view này.

**Ghi:** `supa.js` tách các cột của một lệnh insert/update theo bảng sở hữu, chạy trong một transaction; dòng thông số chỉ được tạo khi có ít nhất một cột thông số khác NULL.

**Không đổi:** unique index biến thể, mọi CHECK hiện có trên `products`, cách ly theo `company_id` (bảng thông số không có `company_id` riêng; quyền theo bảng lõi).

### 5.2 Dòng đề xuất (D-11)

Thay `purchase_proposal_items` bằng:

**`proposal_discount_items`** (phiếu `ck`): `id, company_id, proposal_code, sort_order, product_code, product_name, brand, room, unit, quantity, original_unit_price, rate_pct, unit_price, amount, image_urls`.

**`proposal_payment_installments`** (phiếu `tt`): `id, company_id, proposal_code, sort_order, label, rate_pct, amount, due_date, note`.

Cả hai: FK kép `(company_id, proposal_code)` -> `purchase_proposals`, CASCADE; giữ các CHECK không âm hiện có. Mapper `dxItem_` trả đúng đối tượng cũ.

### 5.3 Transaction (D-13)

`supa.tx(fn)`; bọc: `savePurchaseOrder`, `saveDeXuat`, `deleteProject`, `duplicateProject`, `saveCover`, `deleteCongTy`, và lệnh ghi sản phẩm nhiều bảng.

**Đã làm 2026-10-15 trên backend Go** (app Node đã gỡ): `database.DB.Tx` thay cho `supa.tx`. Bọc đủ danh sách trên, thêm `createCongTy`, `setCombo`, `setBienThe`, `deleteDbProduct`; lệnh ghi một sản phẩm vào nhiều bảng vốn đã chạy trong 1 transaction (khoá dòng lõi). `savePurchaseOrder` bọc từng đơn, chưa bọc cả lần gửi. Chi tiết: `backend/docs/ARCHITECTURE.md` mục 3.5.

## 6. Đợt 3 - thu gọn

`DROP COLUMN` 8 cột còn trong danh sách D-09, sau khi: (1) đã chạy ổn định ít nhất một chu kỳ phát hành; (2) `supa.js` đã bỏ qua các cột này khi ghi; (3) có bản sao lưu đã thử khôi phục.

## 7. Module và bảng sở hữu (sau đợt 2)

| Module | Bảng sở hữu | Dùng chung từ module khác |
|---|---|---|
| Công ty, tài khoản | `companies`, `company_settings`, `users` | mọi module đọc `companies`, `users` |
| Nhật ký, thông báo | `audit_logs`, `notifications` | mọi module ghi |
| Danh mục sản phẩm | `products`, 4 bảng `product_*_specs`, `product_histories`, `product_combos`, `favorite_products`, `delete_requests` | Bóc tách chép sản phẩm thành bản chụp |
| Dự án, bóc tách, báo giá | `projects`, `quotation_lines`, `cost_estimate_lines`, `project_data_entries` | Mua hàng đọc dòng bóc tách ở client |
| Thư viện công tác | `work_items`, `work_item_histories` | Dự án chép công tác thành bản chụp |
| Mua hàng | `purchase_orders`, `purchase_order_items`, `purchase_proposals`, `proposal_discount_items`, `proposal_payment_installments` | - |

## 8. So sánh cũ - mới

| Hạng mục | Hiện tại (`qspro_en`) | Sau đợt 1 | Sau đợt 2 |
|---|---|---|---|
| Bảng | 19 | 20 | 24 |
| Khoá ngoại | 25 | 31 (4 thay bằng khoá kép, 6 mới) | + khoá của 4 bảng thông số và 2 bảng dòng đề xuất |
| Quan hệ cha-con được database chặn liên kết chéo công ty | 0 | 6 | 7 |
| Cột của `products` | 141 | 141 | khoảng 44 + 4 bảng thông số |
| Thao tác nhiều bước có transaction | 0 / 6 | 0 / 6 | 6 / 6 |
| Giá đại lý sản phẩm | cột thường (lỗi) | tự tính | tự tính |
| Hình dạng dữ liệu trả về client | - | không đổi | không đổi |

## 9. Tác động tới API và code

| File | Đợt 1 | Đợt 2 |
|---|---|---|
| `public/*` | không đổi | không đổi |
| `server/index.js`, `export.js`, `shared.js` | không đổi | không đổi |
| `server/store_supa.js` | `getProjData`, `setProjData` | `saveDeXuat`, `dxItem_`, `getDeXuatList`; 6 thao tác bọc transaction |
| `server/auth.js` | không đổi | `getDeXuat` (đọc dòng), `deleteCongTy` |
| `server/supa.js` | bỏ qua cột generated khi ghi | đọc qua view, tách cột theo bảng khi ghi, `tx()` |
| `server/db-map.json` | thêm `company_settings` | khai báo bảng vệ tinh, 2 bảng dòng đề xuất |
| `infra/scripts/` | `migrate.js`; cập nhật `sync-from-supabase.js` | cập nhật `sync-from-supabase.js` |
