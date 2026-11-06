# Audit - danh mục chi tiết từng bảng

> **Cập nhật 2026-10-12:** tài liệu này mô tả database `qspro_en` TRƯỚC refactor (mốc audit). Cấu trúc đang chạy: [schema-hien-hanh.md](schema-hien-hanh.md); kết quả triển khai: [ket-qua-trien-khai.md](ket-qua-trien-khai.md).
>
> **Ghi chú 2026-11-06:** viết khi còn app Node (đã gỡ ở commit `5fa5d52`); đường dẫn `server/*.js`, `public/*.js`, `render.yaml` và lệnh `npm ...` trong tài liệu này là mã / cách làm cũ. Hiện nay: migration chạy bằng `go run ./cmd/migrate` (trong `backend/`), `db-map.json` duy nhất ở `backend/internal/platform/database/db-map.json`, bảng tự lọc công ty khai trong `TenantTables` (`backend/internal/platform/database/postgres.go`).

> Sinh tự động từ catalog và dữ liệu của database `qspro_en` (PostgreSQL 17, local) ngày 2026-10-12. Không gõ tay.
> Tên trong ngoặc là tên bảng/cột code đang dùng (tiếng Việt, qua `server/db-map.json`).
> Phần nhận định và đề xuất nằm ở [audit.md](audit.md).

## Tổng quan

| Bảng (tên trong code) | Dòng | Dung lượng | Cột | FK | CHECK | Index | Phân loại | Tenant |
|---|---:|---:|---:|---:|---:|---:|---|---|
| `companies` (`cong_ty`) | 3 | 48 kB | 16 | 0 | 1 | 2 | 1 cốt lõi / 5 cấu hình | Bảng tenant (không có company_id) |
| `users` (`users`) | 9 | 64 kB | 13 | 1 | 2 | 3 | 7 phân quyền | Tenant-owned (super có thể NULL) |
| `audit_logs` (`audit_log`) | 2933 | 1168 kB | 7 | 0 | 0 | 5 | 4 lịch sử / nhật ký | Tenant-owned, NULL khi là dòng hệ thống / super không ngữ cảnh |
| `notifications` (`notifications`) | 26 | 64 kB | 9 | 1 | 0 | 3 | 1 cốt lõi | User-owned + company_id |
| `delete_requests` (`delete_requests`) | 1 | 64 kB | 10 | 1 | 1 | 3 | 1 cốt lõi | Tenant-owned |
| `products` (`db_san_pham`) | 1093 | 1192 kB | 141 | 1 | 10 | 5 | 1 cốt lõi | Tenant-owned; hàng của Dezon được chia sẻ chỉ-đọc cho công ty bật has_dezon_catalog_access |
| `product_histories` (`db_san_pham_history`) | 3002 | 864 kB | 9 | 2 | 0 | 3 | 4 lịch sử | Tenant-owned |
| `product_combos` (`sp_combo`) | 85 | 80 kB | 8 | 3 | 3 | 4 | 3 quan hệ trung gian | Tenant-owned |
| `favorite_products` (`sp_yeu_thich`) | 18 | 64 kB | 6 | 1 | 0 | 3 | 3 quan hệ trung gian | Tenant-owned; cố ý trỏ sang sản phẩm của Dezon |
| `projects` (`du_an`) | 30 | 64 kB | 23 | 1 | 4 | 3 | 1 cốt lõi | Tenant-owned |
| `project_data_entries` (`du_an_data`) | 23 | 208 kB | 6 | 1 | 1 | 2 | 5 cấu hình + dữ liệu nghiệp vụ dạng tài liệu | Tenant-owned |
| `quotation_lines` (`db_bao_gia`) | 545 | 456 kB | 38 | 1 | 12 | 3 | 1 cốt lõi | Tenant-owned |
| `cost_estimate_lines` (`khai_toan`) | 104 | 104 kB | 8 | 2 | 3 | 3 | 1 cốt lõi / 6 tổng hợp | Tenant-owned |
| `work_items` (`cong_tac`) | 217 | 136 kB | 29 | 1 | 9 | 2 | 2 danh mục | Tenant-owned |
| `work_item_histories` (`cong_tac_history`) | 1 | 80 kB | 9 | 2 | 0 | 4 | 4 lịch sử | Tenant-owned |
| `purchase_orders` (`don_mua_hang`) | 65 | 128 kB | 20 | 1 | 7 | 5 | 1 cốt lõi | Tenant-owned |
| `purchase_order_items` (`chi_tiet_mua_hang`) | 160 | 120 kB | 13 | 2 | 4 | 3 | 1 cốt lõi | Tenant-owned |
| `purchase_proposals` (`de_xuat`) | 2 | 96 kB | 23 | 2 | 10 | 5 | 1 cốt lõi | Tenant-owned |
| `purchase_proposal_items` (`chi_tiet_de_xuat`) | 0 | 32 kB | 17 | 2 | 5 | 3 | 1 cốt lõi | Tenant-owned |

## `companies` (`cong_ty`)

- **Mục đích:** Công ty (tenant) + gói dịch vụ
- **Phân loại:** 1 cốt lõi / 5 cấu hình
- **Tenant:** Bảng tenant (không có company_id)
- **Code sử dụng:** auth.js: login, me, listCongTy, create/update/deleteCongTy; store: spChungId_
- **Quy mô:** 3 dòng, 48 kB

**Ràng buộc**

- CHECK `ck_companies_user_limit`: `CHECK ((user_limit >= 0))`
- PK `pk_companies`: `PRIMARY KEY (id)`
- UNIQUE `uq_companies_code`: `UNIQUE (code)`
- (không có khoá ngoại)

**Index**

- `UNIQUE INDEX pk_companies (id)`
- `UNIQUE INDEX uq_companies_code (code)`

**Cột**

| Cột (tên trong code) | Kiểu | NULL | Mặc định | Dòng NULL | Dòng rỗng | Số giá trị khác nhau |
|---|---|---|---|---:|---:|---:|
| `id` (`id`) | uuid | KHÔNG | gen_random_uuid() | 0 |  | 3 |
| `name` (`ten`) | text | KHÔNG |  | 0 | 0 | 3 |
| `code` (`ma`) | text | có |  | 0 | 0 | 3 |
| `logo_url` (`logo_url`) | text | có |  | 0 | 1 | 3 |
| `primary_color` (`mau_chinh`) | text | có |  | 3 | 0 | 0 |
| `features` (`tinh_nang`) | text | có | ''::text | 0 | 0 | 1 |
| `user_limit` (`gioi_han_user`) | integer | có | 10 | 0 |  | 3 |
| `is_active` (`active`) | boolean | có | true | 0 |  | 1 |
| `expiry_date` (`han_dung`) | date | có |  | 1 |  | 2 |
| `note` (`ghi_chu`) | text | có |  | 0 | 2 | 2 |
| `created_at` (`ngay_tao`) | timestamp with time zone | có | now() | 0 |  | 3 |
| `email` (`email`) | text | có |  | 0 | 2 | 2 |
| `phone` (`sdt`) | text | có |  | 0 | 2 | 2 |
| `last_reminder_date` (`nhac_lan_cuoi`) | date | có |  | 2 |  | 1 |
| `reminder_milestone` (`nhac_moc`) | integer | có |  | 2 |  | 1 |
| `has_dezon_catalog_access` (`dung_sp_dezon`) | boolean | có | false | 0 |  | 2 |

**Cột chưa từng có dữ liệu (1):** `primary_color`

## `users` (`users`)

- **Mục đích:** Tài khoản đăng nhập, vai trò, quyền
- **Phân loại:** 7 phân quyền
- **Tenant:** Tenant-owned (super có thể NULL)
- **Code sử dụng:** auth.js: login, sessionActor, admin*User, me, setMyPref
- **Quy mô:** 9 dòng, 64 kB

**Ràng buộc**

- CHECK `ck_users_role`: `CHECK ((role = ANY (ARRAY['super'::text, 'admin'::text, 'staff'::text])))`
- CHECK `ck_users_username`: `CHECK ((username = lower(username)))`
- FK `fk_users_company_id`: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- PK `pk_users`: `PRIMARY KEY (id)`

**Index**

- `INDEX idx_users_username (username)`
- `UNIQUE INDEX pk_users (id)`
- `UNIQUE INDEX uq_users_company_id_username (company_id, username)`

**Cột**

| Cột (tên trong code) | Kiểu | NULL | Mặc định | Dòng NULL | Dòng rỗng | Số giá trị khác nhau |
|---|---|---|---|---:|---:|---:|
| `id` (`id`) | uuid | KHÔNG | gen_random_uuid() | 0 |  | 9 |
| `username` (`username`) | text | KHÔNG |  | 0 | 0 | 8 |
| `full_name` (`ho_ten`) | text | có | ''::text | 0 | 0 | 9 |
| `password_hash` (`password_hash`) | text | KHÔNG |  | 0 | 0 | 9 |
| `role` (`role`) | text | KHÔNG | 'staff'::text | 0 | 0 | 3 |
| `is_active` (`active`) | boolean | KHÔNG | true | 0 |  | 1 |
| `created_at` (`created_at`) | timestamp with time zone | KHÔNG | now() | 0 |  | 9 |
| `last_login_at` (`last_login`) | timestamp with time zone | có |  | 2 |  | 7 |
| `permissions` (`perms`) | text | có | ''::text | 0 | 3 | 6 |
| `company_id` (`cong_ty_id`) | uuid | có |  | 1 |  | 3 |
| `email` (`email`) | text | có |  | 2 | 6 | 2 |
| `department` (`phong_ban`) | text | có |  | 5 | 0 | 3 |
| `ui_preferences` (`ui_prefs`) | jsonb | KHÔNG | '{}'::jsonb | 0 |  | 2 |

## `audit_logs` (`audit_log`)

- **Mục đích:** Nhật ký thao tác (chỉ thêm)
- **Phân loại:** 4 lịch sử / nhật ký
- **Tenant:** Tenant-owned, NULL khi là dòng hệ thống / super không ngữ cảnh
- **Code sử dụng:** auth.audit, store.logAudit_, getAuditLog, baoCaoNhapSP
- **Quy mô:** 2933 dòng, 1168 kB

**Ràng buộc**

- PK `pk_audit_logs`: `PRIMARY KEY (id)`
- (không có khoá ngoại)

**Index**

- `INDEX idx_audit_logs_action_id (action, id)`
- `INDEX idx_audit_logs_company_id_created_at_desc (company_id, created_at DESC)`
- `INDEX idx_audit_logs_created_at_desc (created_at DESC)`
- `INDEX idx_audit_logs_user_id (user_id)`
- `UNIQUE INDEX pk_audit_logs (id)`

**Cột**

| Cột (tên trong code) | Kiểu | NULL | Mặc định | Dòng NULL | Dòng rỗng | Số giá trị khác nhau |
|---|---|---|---|---:|---:|---:|
| `id` (`id`) | bigint identity | KHÔNG |  | 0 |  | 2933 |
| `user_id` (`user_id`) | uuid | có |  | 38 |  | 14 |
| `username` (`username`) | text | có |  | 0 | 0 | 22 |
| `action` (`action`) | text | có |  | 0 | 0 | 31 |
| `detail` (`detail`) | text | có |  | 0 | 0 | 1449 |
| `created_at` (`created_at`) | timestamp with time zone | KHÔNG | now() | 0 |  | 2933 |
| `company_id` (`cong_ty_id`) | uuid | có |  | 312 |  | 3 |

## `notifications` (`notifications`)

- **Mục đích:** Thông báo trong app cho từng user
- **Phân loại:** 1 cốt lõi
- **Tenant:** User-owned + company_id
- **Code sử dụng:** auth.js: notify_, notifCount/List/Read/ReadAll
- **Quy mô:** 26 dòng, 64 kB

**Ràng buộc**

- FK `fk_notifications_company_id`: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- PK `pk_notifications`: `PRIMARY KEY (id)`

**Index**

- `INDEX idx_notifications_company_id (company_id)`
- `INDEX idx_notifications_user_id_is_read_created_at_desc (user_id, is_read, created_at DESC)`
- `UNIQUE INDEX pk_notifications (id)`

**Cột**

| Cột (tên trong code) | Kiểu | NULL | Mặc định | Dòng NULL | Dòng rỗng | Số giá trị khác nhau |
|---|---|---|---|---:|---:|---:|
| `id` (`id`) | bigint identity | KHÔNG |  | 0 |  | 26 |
| `user_id` (`user_id`) | uuid | có |  | 0 |  | 3 |
| `kind` (`kind`) | text | có |  | 0 | 0 | 4 |
| `title` (`title`) | text | có |  | 0 | 0 | 4 |
| `body` (`body`) | text | có |  | 0 | 0 | 26 |
| `ref_id` (`ref_id`) | text | có |  | 0 | 0 | 23 |
| `is_read` (`is_read`) | boolean | KHÔNG | false | 0 |  | 2 |
| `created_at` (`created_at`) | timestamp with time zone | KHÔNG | now() | 0 |  | 26 |
| `company_id` (`cong_ty_id`) | uuid | có |  | 4 |  | 1 |

## `delete_requests` (`delete_requests`)

- **Mục đích:** Phiếu yêu cầu xoá sản phẩm chờ admin duyệt
- **Phân loại:** 1 cốt lõi
- **Tenant:** Tenant-owned
- **Code sử dụng:** auth.js: requestDeleteProducts, listDeleteRequests, resolveDeleteRequest
- **Quy mô:** 1 dòng, 64 kB

**Ràng buộc**

- CHECK `ck_delete_requests_status`: `CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))`
- FK `fk_delete_requests_company_id`: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- PK `pk_delete_requests`: `PRIMARY KEY (id)`

**Index**

- `INDEX idx_delete_requests_company_id_created_at_desc (company_id, created_at DESC)`
- `INDEX idx_delete_requests_requester_id (requester_id)`
- `UNIQUE INDEX pk_delete_requests (id)`

**Cột**

| Cột (tên trong code) | Kiểu | NULL | Mặc định | Dòng NULL | Dòng rỗng | Số giá trị khác nhau |
|---|---|---|---|---:|---:|---:|
| `id` (`id`) | bigint identity | KHÔNG |  | 0 |  | 1 |
| `requester_id` (`requester_id`) | uuid | có |  | 0 |  | 1 |
| `requester_name` (`requester_name`) | text | có |  | 0 | 0 | 1 |
| `items` (`items`) | text | có |  | 0 | 0 | 1 |
| `status` (`status`) | text | KHÔNG | 'pending'::text | 0 | 0 | 1 |
| `note` (`note`) | text | có |  | 1 | 0 | 0 |
| `resolver_name` (`resolver_name`) | text | có |  | 0 | 0 | 1 |
| `resolved_at` (`resolved_at`) | timestamp with time zone | có |  | 0 |  | 1 |
| `created_at` (`created_at`) | timestamp with time zone | KHÔNG | now() | 0 |  | 1 |
| `company_id` (`cong_ty_id`) | uuid | có |  | 0 |  | 1 |

**Cột chưa từng có dữ liệu (1):** `note`

## `products` (`db_san_pham`)

- **Mục đích:** Danh mục sản phẩm (đèn, thiết bị vệ sinh, sơn, công tắc - ổ cắm); mỗi dòng là 1 biến thể
- **Phân loại:** 1 cốt lõi
- **Tenant:** Tenant-owned; hàng của Dezon được chia sẻ chỉ-đọc cho công ty bật has_dezon_catalog_access
- **Code sử dụng:** store: getProducts, saveDbProduct, updateDbProductTracked, deleteDbProduct, setSpDuyet, setBienThe, importCommit; index: baoCaoNhapSP
- **Quy mô:** 1093 dòng, 1192 kB

**Ràng buộc**

- CHECK `ck_products_dealer_discount_pct`: `CHECK (((dealer_discount_pct >= (0)::numeric) AND (dealer_discount_pct <= (100)::numeric)))`
- CHECK `ck_products_dealer_price`: `CHECK ((dealer_price >= (0)::numeric))`
- CHECK `ck_products_diameter_mm`: `CHECK ((diameter_mm >= (0)::numeric))`
- CHECK `ck_products_driver_price`: `CHECK ((driver_price >= (0)::numeric))`
- CHECK `ck_products_luminous_efficacy_lm_w`: `CHECK ((luminous_efficacy_lm_w >= (0)::numeric))`
- CHECK `ck_products_luminous_flux_lm`: `CHECK ((luminous_flux_lm >= (0)::numeric))`
- CHECK `ck_products_max_output_current_ma`: `CHECK ((max_output_current_ma >= (0)::numeric))`
- CHECK `ck_products_product_name`: `CHECK ((btrim(product_name) <> ''::text))`
- CHECK `ck_products_retail_price`: `CHECK ((retail_price >= (0)::numeric))`
- CHECK `ck_products_warranty_years`: `CHECK ((warranty_years >= (0)::numeric))`
- FK `fk_products_company_id`: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- PK `pk_products`: `PRIMARY KEY (id)`

**Index**

- `INDEX idx_products_created_at (created_at)`
- `INDEX idx_products_product_code (product_code)`
- `INDEX idx_products_variant_group_part (variant_group) WHERE (variant_group IS NOT NULL)`
- `UNIQUE INDEX pk_products (id)`
- `UNIQUE INDEX uq_products_company_id_product_code_coalesce_color_temp_2a8f830 (company_id, product_code, COALESCE(color_temperature_k, ''::text), COALESCE(power_w, ''::text), COALESCE(beam_angle_deg, ''::text), COALESCE(color, ''::text), COALESCE(size, ''::text))`

**Cột** (bảng rộng: chỉ liệt kê cột có ràng buộc, mặc định, ghi chú hoặc dữ liệu; danh sách đủ ở [data-dictionary.md](data-dictionary.md))

| Cột (tên trong code) | Kiểu | NULL | Mặc định | Dòng NULL | Dòng rỗng | Số giá trị khác nhau |
|---|---|---|---|---:|---:|---:|
| `id` (`id`) | bigint identity | KHÔNG |  | 0 |  | 1093 |
| `product_code` (`ma_sp`) | text | có |  | 1 | 1 | 600 |
| `product_name` (`ten_sp`) | text | KHÔNG |  | 0 | 0 | 391 |
| `product_line` (`dong_sp`) | text | có |  | 1 | 2 | 211 |
| `category` (`hang_muc`) | text | có |  | 3 | 0 | 18 |
| `product_group` (`nhom_sp`) | text | có |  | 797 | 125 | 19 |
| `brand` (`thuong_hieu`) | text | có |  | 4 | 0 | 34 |
| `supplier_name` (`nha_cung_cap`) | text | có |  | 4 | 0 | 28 |
| `power_w` (`cong_suat_w`) | text | có |  | 452 | 3 | 65 |
| `color_temperature_k` (`nhiet_do_mau_k`) | text | có |  | 590 | 9 | 7 |
| `luminous_flux_lm` (`quang_thong_lm`) | numeric | có |  | 739 |  | 55 |
| `beam_angle_deg` (`goc_chieu_deg`) | text | có |  | 617 | 9 | 28 |
| `tilt_angle_deg` (`goc_nghieng_deg`) | text | có |  | 1069 | 11 | 7 |
| `color` (`mau_sac`) | text | có |  | 186 | 19 | 63 |
| `material` (`chat_lieu`) | text | có |  | 546 | 70 | 43 |
| `height_mm` (`chieu_cao_mm`) | numeric | có |  | 570 |  | 72 |
| `diameter_mm` (`duong_kinh_mm`) | numeric | có |  | 557 |  | 58 |
| `cutout_mm` (`cutout_mm`) | text | có |  | 528 | 4 | 112 |
| `ip_rating` (`chi_so_ip`) | text | có |  | 682 | 36 | 11 |
| `cri` (`cri`) | text | có |  | 458 | 14 | 23 |
| `luminous_efficacy_lm_w` (`hieu_suat_lm_w`) | numeric | có |  | 846 |  | 21 |
| `ugr` (`ugr`) | text | có |  | 759 | 34 | 12 |
| `sdcm` (`sdcm`) | text | có |  | 954 | 41 | 9 |
| `lifespan` (`tuoi_tho`) | text | có |  | 998 | 39 | 14 |
| `led_chip_type` (`loai_chip_led`) | text | có |  | 736 | 16 | 22 |
| `protection_class` (`class_rating`) | text | có |  | 1014 | 42 | 3 |
| `has_separate_driver` (`lap_nguon_roi`) | boolean | có |  | 966 |  | 2 |
| `driver_name` (`ten_bo_nguon`) | text | có |  | 1014 | 38 | 11 |
| `driver_code` (`ma_bo_nguon`) | text | có |  | 1015 | 38 | 9 |
| `driver_brand` (`hang_bo_nguon`) | text | có |  | 1016 | 38 | 4 |
| `driver_mounting_position` (`vi_tri_lap_nguon`) | text | có |  | 1049 | 42 | 3 |
| `control_compatibility` (`dieu_khien`) | text | có |  | 1032 | 24 | 5 |
| `max_output_current_ma` (`dong_ra_max_ma`) | numeric | có |  | 1063 |  | 6 |
| `warranty_years` (`bao_hanh_nam`) | numeric | có |  | 632 |  | 7 |
| `unit` (`dvt`) | text | có |  | 0 | 0 | 7 |
| `retail_price` (`gia_ban_le`) | numeric | có |  | 41 |  | 520 |
| `dealer_discount_pct` (`ck_dai_ly_pct`) | numeric | có |  | 273 |  | 30 |
| `dealer_price` (`gia_dai_ly`) | numeric | có |  | 0 |  | 559 |
| `image_urls` (`anh_sp`) | text | có |  | 10 | 1 | 685 |
| `datasheet_url` (`link_datasheet`) | text | có |  | 752 | 67 | 129 |
| `status` (`trang_thai`) | text | có |  | 0 | 1 | 2 |
| `note` (`ghi_chu`) | text | có |  | 829 | 135 | 72 |
| `updated_at` (`ngay_cap_nhat`) | timestamp with time zone | có | now() | 0 |  | 1093 |
| `company_id` (`cong_ty_id`) | uuid | có |  | 144 |  | 1 |
| `is_approved` (`da_duyet`) | boolean | có | false | 0 |  | 2 |
| `approved_by` (`nguoi_duyet`) | text | có |  | 676 | 0 | 1 |
| `approved_at` (`ngay_duyet`) | timestamp with time zone | có |  | 676 |  | 273 |
| `created_by` (`nguoi_tao`) | text | có |  | 535 | 0 | 1 |
| `created_at` (`ngay_tao`) | timestamp with time zone | có | now() | 0 |  | 559 |
| `updated_by` (`nguoi_sua`) | text | có |  | 778 | 0 | 2 |
| `led_chip_name` (`ten_chip_led`) | text | có |  | 1077 | 10 | 3 |
| `driver_price` (`gia_ban_bo_nguon`) | numeric | có |  | 1092 |  | 1 |
| `variant_group` (`nhom_bt`) | text | có |  | 1075 | 0 | 4 |
| `sector` (`nganh`) | text | có |  | 0 | 0 | 3 |
| `size` (`kich_thuoc`) | text | có |  | 711 | 2 | 134 |
| `flush_system` (`he_thong_xa`) | text | có |  | 1050 | 16 | 10 |
| `flush_volume` (`luong_nuoc_xa`) | text | có |  | 1046 | 14 | 18 |
| `design` (`thiet_ke`) | text | có |  | 1038 | 13 | 22 |
| `rough_in_distance` (`tam_xa`) | text | có |  | 1066 | 15 | 7 |
| `water_pressure` (`ap_luc_nuoc`) | text | có |  | 1005 | 12 | 26 |
| `caution` (`luu_y`) | text | có |  | 899 | 34 | 50 |
| `features` (`tinh_nang`) | text | có |  | 886 | 11 | 86 |
| `installation_type` (`kieu_lap_dat`) | text | có |  | 839 | 2 | 21 |
| `lid_type` (`loai_nap`) | text | có |  | 1067 | 15 | 7 |
| `faucet_type` (`loai_voi`) | text | có |  | 1031 | 12 | 2 |
| `shower_type` (`loai_sen`) | text | có |  | 1014 | 16 | 6 |
| `control_type` (`kieu_dieu_khien`) | text | có |  | 1075 | 17 | 2 |
| `massage_function` (`massage`) | text | có |  | 1075 | 17 | 2 |
| `flow_rate` (`luu_luong`) | text | có |  | 1000 | 12 | 22 |
| `valve_cartridge` (`loi_van`) | text | có |  | 1067 | 14 | 6 |
| `shower_head_size` (`bat_sen`) | text | có |  | 1014 | 16 | 20 |
| `spray_modes` (`che_do_phun`) | text | có |  | 1038 | 17 | 4 |
| `overflow_hole` (`xa_tran`) | text | có |  | 1073 | 16 | 5 |
| `capacity` (`dung_tich`) | text | có |  | 1074 | 17 | 2 |
| `power_supply` (`nguon_dien`) | text | có |  | 1075 | 17 | 2 |
| `compatible_toilet` (`bon_cau_tuong_thich`) | text | có |  | 1075 | 17 | 2 |
| `surface_finish` (`be_mat`) | text | có |  | 913 | 17 | 12 |
| `spec_sheet_url` (`thong_so_file`) | text | có |  | 943 | 117 | 22 |
| `installation_guide_url` (`huong_dan_lap_dat`) | text | có |  | 855 | 104 | 74 |
| `drawing_file_url` (`file_ban_ve`) | text | có |  | 897 | 104 | 60 |
| `coverage` (`do_phu`) | text | có |  | 944 | 0 | 31 |
| `drying_time` (`thoi_gian_kho`) | text | có |  | 944 | 2 | 16 |
| `coat_count` (`so_lop`) | text | có |  | 944 | 0 | 3 |
| `physical_state` (`trang_thai_vat_ly`) | text | có |  | 948 | 4 | 3 |
| `odor` (`mui`) | text | có |  | 957 | 7 | 8 |
| `odor_threshold` (`nguong_mui`) | text | có |  | 951 | 15 | 3 |
| `ph_value` (`do_ph`) | text | có |  | 962 | 22 | 8 |
| `melting_freezing_point` (`diem_dong`) | text | có |  | 949 | 15 | 4 |
| `boiling_point` (`diem_soi`) | text | có |  | 949 | 5 | 9 |
| `flash_point` (`diem_bung_chay`) | text | có |  | 952 | 15 | 7 |
| `flammability` (`kha_nang_chay`) | text | có |  | 951 | 13 | 3 |
| `explosive_limits` (`gioi_han_no`) | text | có |  | 953 | 15 | 7 |
| `vapor_pressure` (`ap_suat_hoa_hoi`) | text | có |  | 951 | 14 | 10 |
| `vapor_density` (`mat_do_hoi`) | text | có |  | 963 | 12 | 3 |
| `water_solubility` (`do_hoa_tan`) | text | có |  | 949 | 7 | 8 |
| `viscosity` (`tinh_deo`) | text | có |  | 959 | 22 | 33 |
| `relative_density` (`mat_do_tuong_doi`) | text | có |  | 959 | 22 | 37 |

**Cột chưa từng có dữ liệu (44):** `coi`, `bowl_count`, `faucet_hole_count`, `thickness`, `particle_characteristics`, `component_type`, `socket_count`, `plug_type`, `gang_count`, `circuit_type`, `operation_type`, `indicator_light`, `safety_shutter`, `pack_quantity`, `rated_current_a`, `rated_voltage_v`, `max_power_w`, `max_load_power_w`, `min_load_power_w`, `load_type`, `operation_cycles`, `frequency_hz`, `contact_material`, `flame_resistance`, `standards`, `certifications`, `usb_a_port_count`, `usb_c_port_count`, `usb_charging_power_w`, `usb_output`, `signal_connector_type`, `smart_integration`, `connectivity_protocol`, `compatible_ecosystem`, `neutral_wire`, `sensor_type`, `smart_features`, `module_count`, `face_width_mm`, `face_height_mm`, `face_depth_mm`, `mounting_box_type`, `min_box_depth_mm`, `max_wire_cross_section`

## `product_histories` (`db_san_pham_history`)

- **Mục đích:** Lịch sử thay đổi sản phẩm (chỉ thêm), khoá theo MÃ sản phẩm dạng chữ
- **Phân loại:** 4 lịch sử
- **Tenant:** Tenant-owned
- **Code sử dụng:** store: logHistory (nhiều chỗ), getProductHistory
- **Quy mô:** 3002 dòng, 864 kB

**Ràng buộc**

- FK `fk_product_histories_changed_by_id`: `FOREIGN KEY (changed_by_id) REFERENCES users(id) ON DELETE SET NULL`
- FK `fk_product_histories_company_id`: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- PK `pk_product_histories`: `PRIMARY KEY (id)`

**Index**

- `INDEX idx_product_histories_changed_by_id (changed_by_id)`
- `INDEX idx_product_histories_company_id_product_code_changed_at_desc (company_id, product_code, changed_at DESC)`
- `UNIQUE INDEX pk_product_histories (id)`

**Cột**

| Cột (tên trong code) | Kiểu | NULL | Mặc định | Dòng NULL | Dòng rỗng | Số giá trị khác nhau |
|---|---|---|---|---:|---:|---:|
| `id` (`id`) | bigint identity | KHÔNG |  | 0 |  | 3002 |
| `product_code` (`ma_sp`) | text | có |  | 0 | 9 | 567 |
| `field` (`field`) | text | có |  | 0 | 0 | 49 |
| `old_value` (`old_value`) | text | có |  | 0 | 1630 | 146 |
| `new_value` (`new_value`) | text | có |  | 0 | 147 | 474 |
| `changed_by_id` (`changed_by`) | uuid | có |  | 0 |  | 3 |
| `changed_by_name` (`changed_by_name`) | text | có |  | 0 | 0 | 3 |
| `changed_at` (`changed_at`) | timestamp with time zone | KHÔNG | now() | 0 |  | 2439 |
| `company_id` (`cong_ty_id`) | uuid | có |  | 210 |  | 1 |

## `product_combos` (`sp_combo`)

- **Mục đích:** Sản phẩm đi kèm (quan hệ N-N giữa 2 sản phẩm, có số lượng)
- **Phân loại:** 3 quan hệ trung gian
- **Tenant:** Tenant-owned
- **Code sử dụng:** store: getCombo, setCombo, stampCombo_, deleteDbProduct
- **Quy mô:** 85 dòng, 80 kB

**Ràng buộc**

- CHECK `ck_product_combos_product_id`: `CHECK ((product_id <> companion_product_id))`
- CHECK `ck_product_combos_quantity`: `CHECK ((quantity > (0)::numeric))`
- CHECK `ck_product_combos_sort_order`: `CHECK ((sort_order >= 0))`
- FK `fk_product_combos_companion_product_id`: `FOREIGN KEY (companion_product_id) REFERENCES products(id) ON DELETE CASCADE`
- FK `fk_product_combos_company_id`: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- FK `fk_product_combos_product_id`: `FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE`
- PK `pk_product_combos`: `PRIMARY KEY (id)`

**Index**

- `INDEX idx_product_combos_companion_product_id (companion_product_id)`
- `INDEX idx_product_combos_company_id (company_id)`
- `UNIQUE INDEX pk_product_combos (id)`
- `UNIQUE INDEX uq_product_combos_product_id_companion_product_id (product_id, companion_product_id)`

**Cột**

| Cột (tên trong code) | Kiểu | NULL | Mặc định | Dòng NULL | Dòng rỗng | Số giá trị khác nhau |
|---|---|---|---|---:|---:|---:|
| `id` (`id`) | bigint identity | KHÔNG |  | 0 |  | 85 |
| `company_id` (`cong_ty_id`) | uuid | có |  | 0 |  | 1 |
| `product_id` (`sp_id`) | bigint | KHÔNG |  | 0 |  | 39 |
| `companion_product_id` (`sp_kem_id`) | bigint | KHÔNG |  | 0 |  | 66 |
| `quantity` (`so_luong`) | numeric | có | 1 | 0 |  | 1 |
| `note` (`ghi_chu`) | text | có |  | 0 | 85 | 1 |
| `sort_order` (`sort_no`) | integer | có | 0 | 0 |  | 6 |
| `created_at` (`created_at`) | timestamp with time zone | KHÔNG | now() | 0 |  | 39 |

**Cột chưa từng có dữ liệu (1):** `note`

## `favorite_products` (`sp_yeu_thich`)

- **Mục đích:** Sản phẩm yêu thích theo CÔNG TY (không theo user)
- **Phân loại:** 3 quan hệ trung gian
- **Tenant:** Tenant-owned; cố ý trỏ sang sản phẩm của Dezon
- **Code sử dụng:** store: setYeuThich, ytIds_
- **Quy mô:** 18 dòng, 64 kB

**Ràng buộc**

- FK `fk_favorite_products_company_id`: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- PK `pk_favorite_products`: `PRIMARY KEY (id)`

**Index**

- `INDEX idx_favorite_products_product_id (product_id)`
- `UNIQUE INDEX pk_favorite_products (id)`
- `UNIQUE INDEX uq_favorite_products_company_id_product_id (company_id, product_id)`

**Cột**

| Cột (tên trong code) | Kiểu | NULL | Mặc định | Dòng NULL | Dòng rỗng | Số giá trị khác nhau |
|---|---|---|---|---:|---:|---:|
| `id` (`id`) | bigint identity | KHÔNG |  | 0 |  | 18 |
| `company_id` (`cong_ty_id`) | uuid | có |  | 4 |  | 1 |
| `product_id` (`sp_id`) | bigint | KHÔNG |  | 0 |  | 17 |
| `product_code` (`ma_sp`) | text | có |  | 0 | 0 | 16 |
| `created_by` (`nguoi_tao`) | text | có |  | 0 | 0 | 1 |
| `created_at` (`created_at`) | timestamp with time zone | KHÔNG | now() | 0 |  | 18 |

## `projects` (`du_an`)

- **Mục đích:** Dự án — thực chất mỗi dòng là 1 BẢN NHÁP; giao diện gom các dòng cùng tên thành 1 dự án
- **Phân loại:** 1 cốt lõi
- **Tenant:** Tenant-owned
- **Code sử dụng:** store: getProjects, createProject, updateProject, deleteProject, duplicateProject
- **Quy mô:** 30 dòng, 64 kB

**Ràng buộc**

- CHECK `ck_projects_progress_pct`: `CHECK (((progress_pct >= (0)::numeric) AND (progress_pct <= (100)::numeric)))`
- CHECK `ck_projects_project_code`: `CHECK ((project_code <> ''::text))`
- CHECK `ck_projects_status`: `CHECK ((status = ANY (ARRAY['Bản nháp'::text, 'Đang thực hiện'::text, 'Hoàn thành'::text])))`
- CHECK `ck_projects_vat_pct`: `CHECK (((vat_pct >= (0)::numeric) AND (vat_pct <= (100)::numeric)))`
- FK `fk_projects_company_id`: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- PK `pk_projects`: `PRIMARY KEY (id)`
- UNIQUE `uq_projects_project_code`: `UNIQUE (project_code)`

**Index**

- `INDEX idx_projects_company_id_created_at (company_id, created_at)`
- `UNIQUE INDEX pk_projects (id)`
- `UNIQUE INDEX uq_projects_project_code (project_code)`

**Cột**

| Cột (tên trong code) | Kiểu | NULL | Mặc định | Dòng NULL | Dòng rỗng | Số giá trị khác nhau |
|---|---|---|---|---:|---:|---:|
| `id` (`id`) | bigint identity | KHÔNG |  | 0 |  | 30 |
| `project_code` (`ma_da`) | text | có |  | 0 | 0 | 30 |
| `project_name` (`ten_du_an`) | text | có |  | 0 | 0 | 22 |
| `customer_name` (`khach_hang`) | text | có |  | 3 | 0 | 19 |
| `address` (`dia_chi`) | text | có |  | 5 | 0 | 16 |
| `phone` (`sdt`) | text | có |  | 21 | 0 | 3 |
| `status` (`trang_thai`) | text | có |  | 0 | 0 | 1 |
| `vat_pct` (`vat_pct`) | numeric | có | 0 | 0 |  | 3 |
| `progress_pct` (`tien_do_pct`) | numeric | có | 0 | 0 |  | 1 |
| `note` (`ghi_chu`) | text | có |  | 29 | 1 | 1 |
| `project_scale` (`quy_mo`) | text | có |  | 29 | 1 | 1 |
| `total_area` (`tong_dt`) | text | có |  | 29 | 1 | 1 |
| `quoted_area` (`dt_bao_gia`) | text | có |  | 29 | 1 | 1 |
| `requirements` (`nhu_cau`) | text | có |  | 29 | 1 | 1 |
| `segment` (`phan_khuc`) | text | có |  | 29 | 1 | 1 |
| `quotation_code` (`ma_bao_gia`) | text | có |  | 29 | 1 | 1 |
| `custom_groups` (`nhom_tu_tao`) | text | có |  | 29 | 1 | 1 |
| `custom_floors` (`tang_tu_tao`) | text | có |  | 19 | 0 | 11 |
| `created_at` (`ngay_tao`) | timestamp with time zone | có | now() | 0 |  | 30 |
| `updated_at` (`cap_nhat`) | timestamp with time zone | có | now() | 0 |  | 30 |
| `draft_name` (`ten_ban_nhap`) | text | có |  | 28 | 1 | 2 |
| `company_id` (`cong_ty_id`) | uuid | có |  | 5 |  | 1 |
| `dezon_url` (`link_dezon`) | text | có |  | 24 | 0 | 6 |

**Cột chưa từng có dữ liệu (8):** `note`, `project_scale`, `total_area`, `quoted_area`, `requirements`, `segment`, `quotation_code`, `custom_groups`

## `project_data_entries` (`du_an_data`)

- **Mục đích:** Kho khoá/giá trị JSON theo dự án (phần thô, cấu hình báo giá, lịch sử phiên bản...) và theo công ty (mã giả __cty:<id>)
- **Phân loại:** 5 cấu hình + dữ liệu nghiệp vụ dạng tài liệu
- **Tenant:** Tenant-owned
- **Code sử dụng:** store: getProjData, setProjData, duplicateProject, deleteProject
- **Quy mô:** 23 dòng, 208 kB

**Ràng buộc**

- CHECK `ck_project_data_entries_project_code`: `CHECK ((project_code <> ''::text))`
- FK `fk_project_data_entries_company_id`: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- PK `pk_project_data_entries`: `PRIMARY KEY (project_code, data_key)`

**Index**

- `INDEX idx_project_data_entries_company_id (company_id)`
- `UNIQUE INDEX pk_project_data_entries (project_code, data_key)`

**Cột**

| Cột (tên trong code) | Kiểu | NULL | Mặc định | Dòng NULL | Dòng rỗng | Số giá trị khác nhau |
|---|---|---|---|---:|---:|---:|
| `project_code` (`ma_da`) | text | KHÔNG |  | 0 | 0 | 8 |
| `data_key` (`khoa`) | text | KHÔNG |  | 0 | 0 | 7 |
| `data_value` (`gia_tri`) | jsonb | có |  | 0 |  | 20 |
| `company_id` (`cong_ty_id`) | uuid | có |  | 0 |  | 1 |
| `updated_at` (`cap_nhat`) | timestamp with time zone | KHÔNG | now() | 0 |  | 23 |
| `updated_by` (`nguoi_sua`) | text | có |  | 0 | 0 | 1 |

## `quotation_lines` (`db_bao_gia`)

- **Mục đích:** Dòng bóc tách / báo giá của dự án (bản chụp sản phẩm + giá tại lúc thêm)
- **Phân loại:** 1 cốt lõi
- **Tenant:** Tenant-owned
- **Code sử dụng:** store: getLines, addLine, updateLine, deleteLine, getQuote, buildCoverFromTemplate; export.js
- **Quy mô:** 545 dòng, 456 kB

**Ràng buộc**

- CHECK `ck_quotation_lines_amount`: `CHECK ((amount >= (0)::numeric))`
- CHECK `ck_quotation_lines_customer_discount_pct`: `CHECK (((customer_discount_pct >= (0)::numeric) AND (customer_discount_pct <= (100)::numeric)))`
- CHECK `ck_quotation_lines_dealer_discount_pct`: `CHECK (((dealer_discount_pct >= (0)::numeric) AND (dealer_discount_pct <= (100)::numeric)))`
- CHECK `ck_quotation_lines_dealer_price`: `CHECK ((dealer_price >= (0)::numeric))`
- CHECK `ck_quotation_lines_is_manual_entry`: `CHECK ((is_manual_entry = ANY (ARRAY[(0)::bigint, (1)::bigint])))`
- CHECK `ck_quotation_lines_is_saved_to_catalog`: `CHECK ((is_saved_to_catalog = ANY (ARRAY[(0)::bigint, (1)::bigint])))`
- CHECK `ck_quotation_lines_project_code`: `CHECK ((project_code <> ''::text))`
- CHECK `ck_quotation_lines_quantity`: `CHECK ((quantity >= (0)::numeric))`
- CHECK `ck_quotation_lines_retail_price`: `CHECK ((retail_price >= (0)::numeric))`
- CHECK `ck_quotation_lines_selling_price`: `CHECK ((selling_price >= (0)::numeric))`
- CHECK `ck_quotation_lines_supplier_discount_pct`: `CHECK (((supplier_discount_pct >= (0)::numeric) AND (supplier_discount_pct <= (100)::numeric)))`
- CHECK `ck_quotation_lines_unit_price`: `CHECK ((unit_price >= (0)::numeric))`
- FK `fk_quotation_lines_company_id`: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- PK `pk_quotation_lines`: `PRIMARY KEY (id)`

**Index**

- `INDEX idx_quotation_lines_company_id (company_id)`
- `INDEX idx_quotation_lines_project_code_sort_order (project_code, sort_order)`
- `UNIQUE INDEX pk_quotation_lines (id)`

**Cột**

| Cột (tên trong code) | Kiểu | NULL | Mặc định | Dòng NULL | Dòng rỗng | Số giá trị khác nhau |
|---|---|---|---|---:|---:|---:|
| `id` (`id`) | bigint identity | KHÔNG |  | 0 |  | 545 |
| `project_code` (`ma_du_an`) | text | có |  | 0 | 0 | 21 |
| `line_no` (`stt`) | text | có |  | 0 | 0 | 135 |
| `zone` (`khu_vuc`) | text | có |  | 545 | 0 | 0 |
| `room` (`phong`) | text | có |  | 0 | 540 | 5 |
| `drawing_code` (`ma_so_ban_ve`) | text | có |  | 0 | 545 | 1 |
| `product_code` (`ma_sp`) | text | có |  | 0 | 25 | 330 |
| `product_name` (`ten_sp`) | text | có |  | 0 | 1 | 213 |
| `brand` (`thuong_hieu`) | text | có |  | 0 | 23 | 30 |
| `unit` (`dvt`) | text | có |  | 0 | 0 | 9 |
| `quantity` (`so_luong`) | numeric | có | 0 | 0 |  | 19 |
| `dealer_price` (`gia_dai_ly`) | numeric | có | 0 | 0 |  | 317 |
| `profit_pct` (`loi_nhuan_pct`) | numeric | có | 0 | 0 |  | 9 |
| `selling_price` (`gia_ban`) | numeric | có | 0 | 0 |  | 324 |
| `customer_discount_pct` (`ck_khach_hang_pct`) | numeric | có | 0 | 0 |  | 2 |
| `unit_price` (`don_gia`) | numeric | có | 0 | 0 |  | 325 |
| `amount` (`thanh_tien`) | numeric | có | 0 | 0 |  | 385 |
| `markup_pct` (`markup_pct`) | numeric | có | 0 | 0 |  | 14 |
| `margin_pct` (`margin_pct`) | numeric | có | 0 | 0 |  | 14 |
| `profit_amount` (`loi_nhuan_vnd`) | numeric | có | 0 | 0 |  | 84 |
| `status` (`trang_thai`) | text | có |  | 0 | 545 | 1 |
| `note` (`ghi_chu`) | text | có |  | 0 | 545 | 1 |
| `sort_order` (`sort_no`) | numeric | có | 0 | 0 |  | 135 |
| `created_at` (`created_at`) | timestamp with time zone | có | now() | 0 |  | 545 |
| `group_code` (`nhom`) | text | có |  | 0 | 1 | 5 |
| `category` (`loai`) | text | có |  | 0 | 1 | 7 |
| `floor` (`tang`) | text | có |  | 0 | 310 | 20 |
| `supplier_name` (`nha_cung_cap`) | text | có |  | 0 | 24 | 24 |
| `description` (`mo_ta`) | text | có |  | 0 | 190 | 190 |
| `size` (`kich_thuoc`) | text | có |  | 0 | 216 | 156 |
| `image_urls` (`hinh_anh`) | text | có |  | 0 | 28 | 345 |
| `retail_price` (`gia_ban_le`) | numeric | có |  | 0 |  | 317 |
| `dealer_discount_pct` (`ck_dai_ly_pct`) | numeric | có |  | 0 |  | 10 |
| `is_manual_entry` (`tu_nhap`) | bigint | có |  | 0 |  | 1 |
| `is_saved_to_catalog` (`da_luu_dm`) | bigint | có |  | 0 |  | 1 |
| `extra` (`extra`) | jsonb | có |  | 13 |  | 137 |
| `supplier_discount_pct` (`giam_gia_ncc_pct`) | numeric | có |  | 0 |  | 2 |
| `company_id` (`cong_ty_id`) | uuid | có |  | 165 |  | 1 |

**Cột chưa từng có dữ liệu (4):** `zone`, `drawing_code`, `status`, `note`

## `cost_estimate_lines` (`khai_toan`)

- **Mục đích:** Tờ bìa / khái toán của dự án; mỗi lần lưu là thay toàn bộ
- **Phân loại:** 1 cốt lõi / 6 tổng hợp
- **Tenant:** Tenant-owned
- **Code sử dụng:** store: getCover, saveCover, getCoverOrInit; export.js
- **Quy mô:** 104 dòng, 104 kB

**Ràng buộc**

- CHECK `ck_cost_estimate_lines_cost`: `CHECK ((cost >= (0)::numeric))`
- CHECK `ck_cost_estimate_lines_project_code`: `CHECK ((project_code <> ''::text))`
- CHECK `ck_cost_estimate_lines_sort_order`: `CHECK ((sort_order >= (0)::numeric))`
- FK `fk_cost_estimate_lines_company_id`: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- FK `fk_cost_estimate_lines_project_code`: `FOREIGN KEY (project_code) REFERENCES projects(project_code) ON DELETE CASCADE`
- PK `pk_cost_estimate_lines`: `PRIMARY KEY (id)`

**Index**

- `INDEX idx_cost_estimate_lines_company_id (company_id)`
- `INDEX idx_cost_estimate_lines_project_code_sort_order (project_code, sort_order)`
- `UNIQUE INDEX pk_cost_estimate_lines (id)`

**Cột**

| Cột (tên trong code) | Kiểu | NULL | Mặc định | Dòng NULL | Dòng rỗng | Số giá trị khác nhau |
|---|---|---|---|---:|---:|---:|
| `id` (`id`) | bigint identity | KHÔNG |  | 0 |  | 104 |
| `project_code` (`ma_da`) | text | có |  | 0 | 0 | 4 |
| `item_no` (`stt`) | text | có |  | 0 | 0 | 26 |
| `item_name` (`hang_muc`) | text | có |  | 0 | 0 | 26 |
| `description` (`mo_ta`) | text | có |  | 0 | 24 | 17 |
| `cost` (`chi_phi`) | numeric | có | 0 | 0 |  | 10 |
| `sort_order` (`sort_no`) | numeric | có | 0 | 0 |  | 26 |
| `company_id` (`cong_ty_id`) | uuid | có |  | 0 |  | 1 |

## `work_items` (`cong_tac`)

- **Mục đích:** Thư viện công tác / đơn giá phần thô theo công ty
- **Phân loại:** 2 danh mục
- **Tenant:** Tenant-owned
- **Code sử dụng:** store: ctList, ctSave, ctUpdate, ctDelete, ctDuyet, ctFav
- **Quy mô:** 217 dòng, 136 kB

**Ràng buộc**

- CHECK `ck_work_items_area`: `CHECK ((area >= (0)::numeric))`
- CHECK `ck_work_items_calculation_mode`: `CHECK ((calculation_mode = ANY (ARRAY['item'::text, 'area'::text, 'area0'::text, 'none'::text])))`
- CHECK `ck_work_items_coefficient`: `CHECK ((coefficient >= (0)::numeric))`
- CHECK `ck_work_items_contractor_unit_price`: `CHECK ((contractor_unit_price >= (0)::numeric))`
- CHECK `ck_work_items_name`: `CHECK ((name <> ''::text))`
- CHECK `ck_work_items_quantity`: `CHECK ((quantity >= (0)::numeric))`
- CHECK `ck_work_items_quotation_type`: `CHECK ((quotation_type = ANY (ARRAY['kt_chitiet'::text, 'kt_sobo'::text, 'dt_nhancong'::text, 'dt_vattu'::text])))`
- CHECK `ck_work_items_sort_order`: `CHECK ((sort_order >= 0))`
- CHECK `ck_work_items_unit_price`: `CHECK ((unit_price >= (0)::numeric))`
- FK `fk_work_items_company_id`: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- PK `pk_work_items`: `PRIMARY KEY (id)`

**Index**

- `INDEX idx_work_items_company_id_quotation_type_sort_order_created_at (company_id, quotation_type, sort_order, created_at)`
- `UNIQUE INDEX pk_work_items (id)`

**Cột**

| Cột (tên trong code) | Kiểu | NULL | Mặc định | Dòng NULL | Dòng rỗng | Số giá trị khác nhau |
|---|---|---|---|---:|---:|---:|
| `id` (`id`) | uuid | KHÔNG | gen_random_uuid() | 0 |  | 217 |
| `company_id` (`cong_ty_id`) | uuid | có |  | 0 |  | 1 |
| `quotation_type` (`loai`) | text | KHÔNG | 'kt_chitiet'::text | 0 | 0 | 4 |
| `calculation_mode` (`che_do`) | text | KHÔNG | 'item'::text | 0 | 0 | 4 |
| `group_code` (`ma_nhom`) | text | có |  | 0 | 0 | 16 |
| `category` (`hang_muc`) | text | KHÔNG | ''::text | 0 | 0 | 24 |
| `name` (`ten`) | text | KHÔNG | ''::text | 0 | 0 | 178 |
| `unit` (`dvt`) | text | có |  | 0 | 5 | 16 |
| `quantity` (`khoi_luong`) | numeric | có |  | 52 |  | 14 |
| `area` (`dien_tich`) | numeric | có |  | 174 |  | 17 |
| `coefficient` (`he_so`) | numeric | có |  | 174 |  | 9 |
| `contractor_unit_price` (`don_gia_nha_thau`) | numeric | có |  | 52 |  | 109 |
| `unit_price` (`don_gia`) | numeric | có |  | 9 |  | 111 |
| `note` (`ghi_chu`) | text | có |  | 0 | 72 | 109 |
| `image_urls` (`hinh_anh`) | text | có |  | 0 | 217 | 1 |
| `specifications` (`thong_so`) | text | có |  | 0 | 217 | 1 |
| `scope` (`pham_vi`) | text | có |  | 0 | 217 | 1 |
| `document_url` (`link_tai_lieu`) | text | có |  | 0 | 217 | 1 |
| `is_approved` (`da_duyet`) | boolean | KHÔNG | false | 0 |  | 1 |
| `approved_by` (`nguoi_duyet`) | text | có |  | 217 | 0 | 0 |
| `approved_at` (`ngay_duyet`) | timestamp with time zone | có |  | 217 |  | 0 |
| `created_by` (`nguoi_tao`) | text | có |  | 0 | 0 | 1 |
| `created_at` (`ngay_tao`) | timestamp with time zone | KHÔNG | now() | 0 |  | 2 |
| `updated_by` (`nguoi_sua`) | text | có |  | 214 | 0 | 1 |
| `updated_at` (`ngay_cap_nhat`) | timestamp with time zone | có |  | 214 |  | 3 |
| `sort_order` (`thu_tu`) | integer | KHÔNG | 0 | 0 |  | 217 |
| `supplier_name` (`nha_cung_cap`) | text | có |  | 0 | 217 | 1 |
| `is_favorite` (`yeu_thich`) | boolean | KHÔNG | false | 0 |  | 2 |
| `takeoff_section` (`de_muc`) | text | có |  | 217 | 0 | 0 |

**Cột chưa từng có dữ liệu (8):** `image_urls`, `specifications`, `scope`, `document_url`, `approved_by`, `approved_at`, `supplier_name`, `takeoff_section`

## `work_item_histories` (`cong_tac_history`)

- **Mục đích:** Lịch sử thay đổi công tác (chỉ thêm)
- **Phân loại:** 4 lịch sử
- **Tenant:** Tenant-owned
- **Code sử dụng:** store: ctGetHistory, ctLogHistory
- **Quy mô:** 1 dòng, 80 kB

**Ràng buộc**

- FK `fk_work_item_histories_changed_by_id`: `FOREIGN KEY (changed_by_id) REFERENCES users(id) ON DELETE SET NULL`
- FK `fk_work_item_histories_company_id`: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- PK `pk_work_item_histories`: `PRIMARY KEY (id)`

**Index**

- `INDEX idx_work_item_histories_changed_by_id (changed_by_id)`
- `INDEX idx_work_item_histories_company_id (company_id)`
- `INDEX idx_work_item_histories_work_item_id_changed_at (work_item_id, changed_at)`
- `UNIQUE INDEX pk_work_item_histories (id)`

**Cột**

| Cột (tên trong code) | Kiểu | NULL | Mặc định | Dòng NULL | Dòng rỗng | Số giá trị khác nhau |
|---|---|---|---|---:|---:|---:|
| `id` (`id`) | bigint identity | KHÔNG |  | 0 |  | 1 |
| `work_item_id` (`cong_tac_id`) | uuid | KHÔNG |  | 0 |  | 1 |
| `field` (`field`) | text | có |  | 0 | 0 | 1 |
| `old_value` (`old_value`) | text | có |  | 0 | 0 | 1 |
| `new_value` (`new_value`) | text | có |  | 0 | 0 | 1 |
| `changed_by_id` (`changed_by`) | uuid | có |  | 0 |  | 1 |
| `changed_by_name` (`changed_by_name`) | text | có |  | 0 | 0 | 1 |
| `changed_at` (`changed_at`) | timestamp with time zone | có | now() | 0 |  | 1 |
| `company_id` (`cong_ty_id`) | uuid | có |  | 0 |  | 1 |

## `purchase_orders` (`don_mua_hang`)

- **Mục đích:** Yêu cầu / đơn mua hàng gửi theo nhà cung cấp
- **Phân loại:** 1 cốt lõi
- **Tenant:** Tenant-owned
- **Code sử dụng:** index: sendPurchaseRequest; store: savePurchaseOrder, getPurchaseOrders; auth: list/get/resolvePurchaseRequest, setPurchaseStatus
- **Quy mô:** 65 dòng, 128 kB

**Ràng buộc**

- CHECK `ck_purchase_orders_order_code`: `CHECK ((order_code <> ''::text))`
- CHECK `ck_purchase_orders_product_count`: `CHECK ((product_count >= 0))`
- CHECK `ck_purchase_orders_status`: `CHECK ((status = ANY (ARRAY['Chờ duyệt'::text, 'Đã duyệt'::text, 'Từ chối'::text, 'Đã đặt hàng'::text, 'Đã nhận hàng'::text, 'Đã gửi'::text])))`
- CHECK `ck_purchase_orders_subtotal_before_vat`: `CHECK ((subtotal_before_vat >= (0)::numeric))`
- CHECK `ck_purchase_orders_total_amount`: `CHECK ((total_amount >= (0)::numeric))`
- CHECK `ck_purchase_orders_vat_amount`: `CHECK ((vat_amount >= (0)::numeric))`
- CHECK `ck_purchase_orders_vat_pct`: `CHECK (((vat_pct >= (0)::numeric) AND (vat_pct <= (100)::numeric)))`
- FK `fk_purchase_orders_company_id`: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- PK `pk_purchase_orders`: `PRIMARY KEY (id)`
- UNIQUE `uq_purchase_orders_order_code`: `UNIQUE (order_code)`

**Index**

- `INDEX idx_purchase_orders_company_id_sent_at (company_id, sent_at)`
- `INDEX idx_purchase_orders_project_code (project_code)`
- `INDEX idx_purchase_orders_requester_id (requester_id)`
- `UNIQUE INDEX pk_purchase_orders (id)`
- `UNIQUE INDEX uq_purchase_orders_order_code (order_code)`

**Cột**

| Cột (tên trong code) | Kiểu | NULL | Mặc định | Dòng NULL | Dòng rỗng | Số giá trị khác nhau |
|---|---|---|---|---:|---:|---:|
| `id` (`id`) | bigint identity | KHÔNG |  | 0 |  | 65 |
| `order_code` (`ma_don`) | text | có |  | 0 | 0 | 65 |
| `project_code` (`ma_du_an`) | text | có |  | 0 | 0 | 14 |
| `project_name` (`ten_du_an`) | text | có |  | 0 | 0 | 15 |
| `category` (`hang_muc`) | text | có |  | 0 | 2 | 3 |
| `supplier_name` (`nha_cung_cap`) | text | có |  | 0 | 0 | 17 |
| `product_count` (`so_sp`) | integer | có | 0 | 0 |  | 8 |
| `subtotal_before_vat` (`tong_truoc_vat`) | numeric | có | 0 | 0 |  | 43 |
| `vat_pct` (`vat_pct`) | numeric | có | 0 | 0 |  | 2 |
| `vat_amount` (`vat`) | numeric | có | 0 | 0 |  | 20 |
| `total_amount` (`tong_cong`) | numeric | có | 0 | 0 |  | 44 |
| `status` (`trang_thai`) | text | có | 'Đã gửi'::text | 0 | 0 | 3 |
| `send_channel` (`kenh_gui`) | text | có | 'Lark'::text | 0 | 0 | 1 |
| `send_result` (`ket_qua_gui`) | text | có |  | 0 | 0 | 2 |
| `sender_name` (`nguoi_gui`) | text | có |  | 0 | 2 | 17 |
| `department` (`phong_ban`) | text | có |  | 1 | 1 | 14 |
| `note` (`ghi_chu`) | text | có |  | 0 | 45 | 8 |
| `sent_at` (`ngay_gui`) | timestamp with time zone | có | now() | 0 |  | 65 |
| `requester_id` (`requester_id`) | uuid | có |  | 32 |  | 3 |
| `company_id` (`cong_ty_id`) | uuid | có |  | 4 |  | 1 |

## `purchase_order_items` (`chi_tiet_mua_hang`)

- **Mục đích:** Dòng hàng của đơn mua (bản chụp, không bao giờ sửa)
- **Phân loại:** 1 cốt lõi
- **Tenant:** Tenant-owned
- **Code sử dụng:** store: savePurchaseOrder, getPurchaseOrders; auth: getPurchaseOrder
- **Quy mô:** 160 dòng, 120 kB

**Ràng buộc**

- CHECK `ck_purchase_order_items_amount`: `CHECK ((amount >= (0)::numeric))`
- CHECK `ck_purchase_order_items_quantity`: `CHECK ((quantity >= (0)::numeric))`
- CHECK `ck_purchase_order_items_sort_order`: `CHECK ((sort_order >= 0))`
- CHECK `ck_purchase_order_items_unit_price`: `CHECK ((unit_price >= (0)::numeric))`
- FK `fk_purchase_order_items_company_id`: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- FK `fk_purchase_order_items_order_code`: `FOREIGN KEY (order_code) REFERENCES purchase_orders(order_code) ON DELETE CASCADE`
- PK `pk_purchase_order_items`: `PRIMARY KEY (id)`

**Index**

- `INDEX idx_purchase_order_items_company_id (company_id)`
- `INDEX idx_purchase_order_items_order_code_sort_order (order_code, sort_order)`
- `UNIQUE INDEX pk_purchase_order_items (id)`

**Cột**

| Cột (tên trong code) | Kiểu | NULL | Mặc định | Dòng NULL | Dòng rỗng | Số giá trị khác nhau |
|---|---|---|---|---:|---:|---:|
| `id` (`id`) | bigint identity | KHÔNG |  | 0 |  | 160 |
| `order_code` (`ma_don`) | text | có |  | 0 | 0 | 65 |
| `product_code` (`ma_sp`) | text | có |  | 0 | 6 | 45 |
| `product_name` (`ten_sp`) | text | có |  | 0 | 0 | 44 |
| `brand` (`thuong_hieu`) | text | có |  | 0 | 9 | 16 |
| `room` (`phong`) | text | có |  | 0 | 144 | 10 |
| `unit` (`dvt`) | text | có |  | 0 | 0 | 3 |
| `quantity` (`so_luong`) | numeric | có | 0 | 0 |  | 11 |
| `unit_price` (`don_gia`) | numeric | có | 0 | 0 |  | 62 |
| `amount` (`thanh_tien`) | numeric | có | 0 | 0 |  | 77 |
| `image_urls` (`hinh_anh`) | text | có |  | 0 | 34 | 35 |
| `sort_order` (`sort_no`) | integer | có | 0 | 0 |  | 10 |
| `company_id` (`cong_ty_id`) | uuid | có |  | 7 |  | 1 |

## `purchase_proposals` (`de_xuat`)

- **Mục đích:** Phiếu đề xuất: ck = xin chiết khấu NCC, tt = đề xuất thanh toán theo đợt
- **Phân loại:** 1 cốt lõi
- **Tenant:** Tenant-owned
- **Code sử dụng:** index: sendDeXuat; store: saveDeXuat, getDeXuatList; auth: listDeXuat, getDeXuat, resolveDeXuat
- **Quy mô:** 2 dòng, 96 kB

**Ràng buộc**

- CHECK `ck_purchase_proposals_discount_amount`: `CHECK ((discount_amount >= (0)::numeric))`
- CHECK `ck_purchase_proposals_line_count`: `CHECK ((line_count >= 0))`
- CHECK `ck_purchase_proposals_original_total`: `CHECK ((original_total >= (0)::numeric))`
- CHECK `ck_purchase_proposals_proposal_code`: `CHECK ((proposal_code <> ''::text))`
- CHECK `ck_purchase_proposals_proposal_type`: `CHECK ((proposal_type = ANY (ARRAY['ck'::text, 'tt'::text])))`
- CHECK `ck_purchase_proposals_proposed_total`: `CHECK ((proposed_total >= (0)::numeric))`
- CHECK `ck_purchase_proposals_status`: `CHECK ((status = ANY (ARRAY['Chờ duyệt'::text, 'Đã duyệt'::text, 'Từ chối'::text])))`
- CHECK `ck_purchase_proposals_total_amount`: `CHECK ((total_amount >= (0)::numeric))`
- CHECK `ck_purchase_proposals_vat_amount`: `CHECK ((vat_amount >= (0)::numeric))`
- CHECK `ck_purchase_proposals_vat_pct`: `CHECK (((vat_pct >= (0)::numeric) AND (vat_pct <= (100)::numeric)))`
- FK `fk_purchase_proposals_company_id`: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- FK `fk_purchase_proposals_requester_id`: `FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE SET NULL`
- PK `pk_purchase_proposals`: `PRIMARY KEY (id)`
- UNIQUE `uq_purchase_proposals_proposal_code`: `UNIQUE (proposal_code)`

**Index**

- `INDEX idx_purchase_proposals_company_id_sent_at (company_id, sent_at)`
- `INDEX idx_purchase_proposals_project_code (project_code)`
- `INDEX idx_purchase_proposals_requester_id (requester_id)`
- `UNIQUE INDEX pk_purchase_proposals (id)`
- `UNIQUE INDEX uq_purchase_proposals_proposal_code (proposal_code)`

**Cột**

| Cột (tên trong code) | Kiểu | NULL | Mặc định | Dòng NULL | Dòng rỗng | Số giá trị khác nhau |
|---|---|---|---|---:|---:|---:|
| `id` (`id`) | bigint identity | KHÔNG |  | 0 |  | 2 |
| `proposal_code` (`ma_de_xuat`) | text | KHÔNG |  | 0 | 0 | 2 |
| `proposal_type` (`loai`) | text | KHÔNG | 'ck'::text | 0 | 0 | 2 |
| `project_code` (`ma_du_an`) | text | có |  | 0 | 0 | 1 |
| `project_name` (`ten_du_an`) | text | có |  | 0 | 0 | 1 |
| `category` (`hang_muc`) | text | có |  | 0 | 0 | 1 |
| `supplier_name` (`nha_cung_cap`) | text | có |  | 0 | 0 | 1 |
| `line_count` (`so_dong`) | integer | có | 0 | 0 |  | 2 |
| `original_total` (`tong_goc`) | numeric | có | 0 | 0 |  | 2 |
| `proposed_total` (`tong_de_xuat`) | numeric | có | 0 | 0 |  | 2 |
| `discount_amount` (`tien_giam`) | numeric | có | 0 | 0 |  | 2 |
| `vat_pct` (`vat_pct`) | numeric | có | 0 | 0 |  | 1 |
| `vat_amount` (`vat`) | numeric | có | 0 | 0 |  | 1 |
| `total_amount` (`tong_cong`) | numeric | có | 0 | 0 |  | 2 |
| `status` (`trang_thai`) | text | có | 'Chờ duyệt'::text | 0 | 0 | 1 |
| `sender_name` (`nguoi_gui`) | text | có |  | 0 | 0 | 1 |
| `department` (`phong_ban`) | text | có |  | 0 | 0 | 1 |
| `note` (`ghi_chu`) | text | có |  | 0 | 2 | 1 |
| `resolver_name` (`nguoi_duyet`) | text | có |  | 2 | 0 | 0 |
| `resolved_at` (`ngay_duyet`) | timestamp with time zone | có |  | 2 |  | 0 |
| `requester_id` (`requester_id`) | uuid | có |  | 0 |  | 1 |
| `company_id` (`cong_ty_id`) | uuid | có |  | 0 |  | 1 |
| `sent_at` (`ngay_gui`) | timestamp with time zone | có | now() | 0 |  | 2 |

**Cột chưa từng có dữ liệu (3):** `note`, `resolver_name`, `resolved_at`

## `purchase_proposal_items` (`chi_tiet_de_xuat`)

- **Mục đích:** Dòng của phiếu đề xuất — ĐA HÌNH: dòng sản phẩm (ck) hoặc đợt thanh toán (tt)
- **Phân loại:** 1 cốt lõi
- **Tenant:** Tenant-owned
- **Code sử dụng:** store: saveDeXuat, dxItem_
- **Quy mô:** 0 dòng, 32 kB

**Ràng buộc**

- CHECK `ck_purchase_proposal_items_amount`: `CHECK ((amount >= (0)::numeric))`
- CHECK `ck_purchase_proposal_items_original_unit_price`: `CHECK ((original_unit_price >= (0)::numeric))`
- CHECK `ck_purchase_proposal_items_quantity`: `CHECK ((quantity >= (0)::numeric))`
- CHECK `ck_purchase_proposal_items_sort_order`: `CHECK ((sort_order >= 0))`
- CHECK `ck_purchase_proposal_items_unit_price`: `CHECK ((unit_price >= (0)::numeric))`
- FK `fk_purchase_proposal_items_company_id`: `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- FK `fk_purchase_proposal_items_proposal_code`: `FOREIGN KEY (proposal_code) REFERENCES purchase_proposals(proposal_code) ON DELETE CASCADE`
- PK `pk_purchase_proposal_items`: `PRIMARY KEY (id)`

**Index**

- `INDEX idx_purchase_proposal_items_company_id (company_id)`
- `INDEX idx_purchase_proposal_items_proposal_code_sort_order (proposal_code, sort_order)`
- `UNIQUE INDEX pk_purchase_proposal_items (id)`

**Cột**

| Cột (tên trong code) | Kiểu | NULL | Mặc định | Dòng NULL | Dòng rỗng | Số giá trị khác nhau |
|---|---|---|---|---:|---:|---:|
| `id` (`id`) | bigint identity | KHÔNG |  | 0 |  | 0 |
| `proposal_code` (`ma_de_xuat`) | text | KHÔNG |  | 0 | 0 | 0 |
| `sort_order` (`sort_no`) | integer | có | 0 | 0 |  | 0 |
| `product_code` (`ma_sp`) | text | có |  | 0 | 0 | 0 |
| `product_name` (`ten_sp`) | text | có |  | 0 | 0 | 0 |
| `brand` (`thuong_hieu`) | text | có |  | 0 | 0 | 0 |
| `room` (`phong`) | text | có |  | 0 | 0 | 0 |
| `unit` (`dvt`) | text | có |  | 0 | 0 | 0 |
| `quantity` (`so_luong`) | numeric | có | 0 | 0 |  | 0 |
| `original_unit_price` (`don_gia_goc`) | numeric | có | 0 | 0 |  | 0 |
| `rate_pct` (`ty_le_pct`) | numeric | có | 0 | 0 |  | 0 |
| `unit_price` (`don_gia`) | numeric | có | 0 | 0 |  | 0 |
| `amount` (`thanh_tien`) | numeric | có | 0 | 0 |  | 0 |
| `expected_payment_date` (`ngay_du_kien`) | date | có |  | 0 |  | 0 |
| `note` (`ghi_chu`) | text | có |  | 0 | 0 | 0 |
| `image_urls` (`hinh_anh`) | text | có |  | 0 | 0 | 0 |
| `company_id` (`cong_ty_id`) | uuid | có |  | 0 |  | 0 |
