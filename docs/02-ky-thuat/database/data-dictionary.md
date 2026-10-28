# Data dictionary - từ điển dữ liệu

> **Cập nhật 2026-10-12:** tài liệu này mô tả database `qspro_en` TRƯỚC refactor (mốc audit). Cấu trúc đang chạy: [schema-hien-hanh.md](schema-hien-hanh.md); kết quả triển khai: [ket-qua-trien-khai.md](ket-qua-trien-khai.md).

> Sinh từ catalog `qspro_en` ngày 2026-10-12 (kiểu, NULL, mặc định, ràng buộc, chú thích cột trong DB) + chú giải từ truy vết code.
> Cột "Ý nghĩa" lấy nguyên văn `COMMENT ON COLUMN` trong database (tiếng Anh, viết khi đổi tên 2026-10-07; 39 cột Công tắc - Ổ cắm chỉ ghi tên cũ).
> Cột "Tên trong code" là khoá mà `server/*.js` dùng; API trả về client bằng khoá camelCase riêng (xem [database-dependencies.md](database-dependencies.md)).
> Đây là từ điển của schema HIỆN TẠI. Thay đổi đề xuất ghi ở cột "Phân loại / ghi chú" và ở [proposed-schema.md](proposed-schema.md).

**Phân loại dư thừa:** A = dữ liệu gốc, B = snapshot tại thời điểm, C = dẫn xuất / tổng lưu sẵn, D = dư thừa không có lý do. Cột không ghi gì = A.

## `companies` (`cong_ty`)

Công ty (tenant) + gói dịch vụ. 3 dòng.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | uuid | không | gen_random_uuid() | PK | Company (tenant) primary key |  |
| `name` | `ten` | text | không |  |  | Company display name |  |
| `code` | `ma` | text | có |  | UNIQUE | Unique lowercase slug of the company (e.g. 'dezon'); generated from the name on creation |  |
| `logo_url` | `logo_url` | text | có |  |  | URL of the company logo |  |
| `primary_color` | `mau_chinh` | text | có |  |  | Brand primary color (CSS value) applied to the UI theme |  |
| `features` | `tinh_nang` | text | có | ''::text |  | Comma-separated list of feature modules enabled by the service plan (dash,boc,chiphi,...) | **Đa trị**: Danh sách module cách nhau dấu phẩy; chỉ trình duyệt kiểm tra. |
| `user_limit` | `gioi_han_user` | integer | có | 10 | CHECK | Maximum number of user accounts allowed by the plan (0 = unlimited) |  |
| `is_active` | `active` | boolean | có | true |  | Whether the company account is active |  |
| `expiry_date` | `han_dung` | date | có |  |  | Subscription expiry date (NULL = no expiry) |  |
| `note` | `ghi_chu` | text | có |  |  | Internal note written by the system administrator | **NHẠY CẢM nội bộ**: Ghi chú của super admin nhưng đang trả về cho mọi user của công ty qua login/me. |
| `created_at` | `ngay_tao` | timestamp with time zone | có | now() |  | When the company was created |  |
| `email` | `email` | text | có |  |  | Contact / billing email | **NHẠY CẢM (PII)** |
| `phone` | `sdt` | text | có |  |  | Contact phone number | **NHẠY CẢM (PII)** |
| `last_reminder_date` | `nhac_lan_cuoi` | date | có |  |  | Date (Vietnam time) the most recent in-app expiry reminder was sent | Từ migration 0012 (M17.3, giả định): nhắc gia hạn trong ứng dụng ghi cột này (server Go `companies.NhacGiaHan`); đổi `han_dung` thì xoá. Thôi DEPRECATED, ra khỏi danh sách xoá D-09. |
| `reminder_milestone` | `nhac_moc` | integer | có |  |  | Days-before-expiry milestone already reminded (30/14/7/3/1/0); values outside that set (legacy -1, 5) = not reminded | Từ migration 0012 (M17.3): mỗi mốc gửi 1 lần cho admin đang hoạt động; không CHECK vì dữ liệu cũ có -1. Đổi `han_dung` thì xoá. Ra khỏi danh sách xoá D-09. |
| `has_dezon_catalog_access` | `dung_sp_dezon` | boolean | có | false |  | Whether the company may use Dezon's shared product catalog |  |

## `users` (`users`)

Tài khoản đăng nhập, vai trò, quyền. 9 dòng.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | uuid | không | gen_random_uuid() | PK | User primary key |  |
| `username` | `username` | text | không |  | CHECK | Login name, always lowercase | **Khoá nghiệp vụ**: Code coi là duy nhất TOÀN HỆ THỐNG nhưng DB chỉ unique theo (company_id, username). Đang có 1 cặp trùng. |
| `full_name` | `ho_ten` | text | có | ''::text |  | Full name of the user ('' when not provided) |  |
| `password_hash` | `password_hash` | text | không |  |  | bcrypt hash of the password | **NHẠY CẢM**: bcrypt; không trả về client (userOut). Thu hẹp các select * đang nạp cột này. |
| `role` | `role` | text | không | 'staff'::text | CHECK | Access role: super (system admin), admin (company owner), staff |  |
| `is_active` | `active` | boolean | không | true |  | False when the account is locked |  |
| `created_at` | `created_at` | timestamp with time zone | không | now() |  | When the account was created |  |
| `last_login_at` | `last_login` | timestamp with time zone | có |  |  | Time of the most recent successful login |  |
| `permissions` | `perms` | text | có | ''::text |  | Comma-separated permission keys for staff ('' for admin/super = unrestricted) | **Đa trị**: Danh sách khoá quyền cách nhau dấu phẩy; server chỉ kiểm sp_edit / sp_duyet. |
| `company_id` | `cong_ty_id` | uuid | có |  | FK | Company the user belongs to (NULL only for legacy unassigned accounts) |  |
| `email` | `email` | text | có |  |  | User email; can be used to log in instead of the username | **NHẠY CẢM (PII)**: Dùng đăng nhập thay username; không có ràng buộc duy nhất. |
| `department` | `phong_ban` | text | có |  |  | Department of the user (shown in the new-product Lark report) |  |
| `ui_preferences` | `ui_prefs` | jsonb | không | '{}'::jsonb |  | Per-user UI preferences (saved column sets etc.); inner keys are not renamed |  |

## `user_sessions` (`phien_dang_nhap`)

Phiên đăng nhập lưu phía máy chủ - thêm bằng migration 0014 (2026-10-15, M1.2), không có trong mốc audit `qspro_en`.
Mỗi lần đăng nhập 1 dòng; token ký HMAC mang `id` (khoá `sid`). Đăng xuất xoá dòng -> token hết hiệu lực ngay; tự đổi mật khẩu
xoá các phiên khác của tài khoản; admin đặt lại mật khẩu xoá mọi phiên của tài khoản đó; xoá tài khoản xoá phiên (CASCADE). Dòng quá hạn bị bỏ qua và được dọn ở lần đăng nhập kế tiếp
của tài khoản. **Xếp loại (quy tắc 25): bảng hệ thống, xuyên công ty** - kiểm phiên chạy trước khi biết công ty nên mọi truy vấn
`noScope` (`backend/internal/modules/auth/postgres.go`), luôn lọc tường minh theo `id` / `user_id`; không có `company_id`
(công ty của phiên = công ty của `users`), không khai `tenant` trong `db-map.json` và không vào `TenantTables` (super không có
công ty; thêm vào `TenantTables` sẽ đổi thứ tự xoá dữ liệu khi xoá công ty). Thay cho lọc dự phòng: chỉ module auth được chạm bảng
(test `TestPhienChiTruyCapQuaAuth` trong `backend/internal/modules/auth`); module khác thu hồi phiên qua
`contracts.SessionInvalidator.RevokeUserSessions`. Ghi chú: chú thích trong file migration 0014 viết `RemoveSessions` - tên hàm
thật là `RemoveSession` (đăng xuất) / `RemoveUserSessions` (thu hồi theo tài khoản); không sửa file migration vì đã áp (checksum).

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | uuid | không | gen_random_uuid() | PK | Session id, embedded in the token payload as "sid" | Không phải bí mật: token còn cần chữ ký `AUTH_SECRET`. |
| `user_id` | `user_id` | uuid | không |  | FK CASCADE | Account that logged in; sessions are deleted with the account | Index `idx_user_sessions_user_id`: thu hồi theo tài khoản + dọn phiên quá hạn. |
| `created_at` | `tao_luc` | timestamp with time zone | không | now() |  | Login time |  |
| `expires_at` | `het_han` | timestamp with time zone | không |  | CHECK > `created_at` | Same as the token expiry (login time + 7 days) | **C (dẫn xuất)**: = `exp` của token; nguồn chuẩn là lúc server ký token. |

## `sales_leads` (`kd_khach_hang`)

Khách hàng tiềm năng / cơ hội của trang Kinh doanh - migration 0015 (2026-10-28), module `backend/internal/modules/sales`. **Xếp loại (quy tắc 25): tenant-owned, bảng gốc** (`company_id`, có trong `TenantTables`). Kéo khách sang `thiet-ke` / `thi-cong` tự tạo dòng `delivery_projects` trong cùng transaction (`contracts.DeliveryFromLead`).

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Primary key. |  |
| `company_id` | `cong_ty_id` | uuid | không |  | FK CASCADE | Owning company; set from the login session, never from the client. |  |
| `customer_name` | `ten_khach` | text | không |  | CHECK | Customer (person or company) name shown on the card. |  |
| `phone` | `sdt` | text | không | '' |  | Customer phone, free text. |  |
| `email` | `email` | text | không | '' |  | Customer email, free text. |  |
| `address` | `dia_chi` | text | không | '' |  | Project / customer address. |  |
| `lead_source` | `nguon` | text | không | '' |  | Where the lead came from (Giới thiệu, Website, ...). Open list, no CHECK. |  |
| `sales_unit` | `phong_kd` | text | không | 'dan-dung' | CHECK | Sales department: dan-dung (residential) / du-an (projects). |  |
| `stage` | `giai_doan` | text | không | 'tiep-can' | CHECK | Pipeline stage key (frontend STAGES in kinhDoanhData.js). |  |
| `board_stage` | `giai_doan_con` | text | có |  | CHECK | Sub-stage on the Thiết kế / Thi công boards; null = not placed on a board yet. |  |
| `project_type` | `loai_cong_trinh` | text | không | '' |  | Building type (Nhà phố, Biệt thự, ...). |  |
| `scale_note` | `quy_mo` | text | không | '' |  | Free-text scale, e.g. "200m2 x 3 tầng". |  |
| `estimated_value_vnd` | `gia_tri_vnd` | numeric(18,0) | không | 0 | CHECK | Value typed by sales, VND. Ignored for display when project_code is set (quote total wins). | Giao diện hiển thị tổng báo giá QS (thanhTienBan, chưa VAT) thay cho cột này khi `project_code` có giá trị. |
| `categories` | `hang_muc` | text[] | không | '{}' |  | Work categories requested (display only, never filtered on). | Danh sách chỉ để hiển thị (quy tắc 6); mảng `text[]`, không lọc theo phần tử. |
| `concept_note` | `concept` | text | không | '' |  | Design concept / style wishes. |  |
| `note` | `ghi_chu` | text | không | '' |  | General note. |  |
| `is_partner_handover` | `doi_tac` | boolean | không | false |  | True when the signed job is handed to a partner company. |  |
| `creator_name` | `nguoi_tao_ten` | text | không | '' |  | Display name of the salesperson who created the lead (free text, may differ from created_by). | Tên hiển thị tự do (danh bạ nhân sự chưa có trong database). |
| `manager_name` | `quan_ly` | text | không | '' |  | Display name of the managing salesperson (free text). |  |
| `assignees` | `phu_trach` | jsonb | không | '[]' | CHECK | Document read/written whole: [{"name": text, "role": text}] - people on the card. | jsonb tài liệu nguyên khối (quy tắc 19): `[{"name": text, "role": text}]`, tối đa 50 phần tử. |
| `handoff` | `ban_giao` | jsonb | có |  | CHECK | Document read/written whole: last handoff slip {"status","dept","requestedAt","assignee"}; null = none. | jsonb tài liệu nguyên khối: `{"status","dept","requestedAt","assignee"}` (giá trị chuỗi hoặc null). |
| `boq_file_name` | `file_boq` | text | không | '' |  | Name of the BOQ file the customer sent (name only, no upload yet). |  |
| `project_code` | `ma_da` | text | có |  | FK SET NULL | Linked QS project (projects.project_code); its quote total is shown as the lead value. |  |
| `won_at` | `ngay_chot` | timestamp with time zone | có |  |  | Set by the service when the lead first enters a won stage (chot-hd, thiet-ke, thi-cong, bao-gia-thi-cong); cleared when moved back. | **C (dẫn xuất)**: nguồn chuẩn là `stage`; service đặt khi lần đầu vào nhóm đã chốt, xoá khi quay lại. |
| `created_by` | `nguoi_tao` | uuid | có |  | FK SET NULL | User who created the row; set null if the user is deleted. |  |
| `created_at` | `ngay_tao` | timestamp with time zone | không | now() |  | Row creation time. |  |
| `updated_at` | `cap_nhat` | timestamp with time zone | không | now() |  | Last change time (set by the service). |  |

## `sales_lead_activities` (`kd_cham_soc`)

Lịch sử chăm sóc khách hàng - migration 0015. **Bảng con** của `sales_leads` (không có `company_id`; db-map `tenant` qua `lead_id`).

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Primary key. |  |
| `lead_id` | `khach_hang_id` | bigint | không |  | FK CASCADE | Owning lead; rows are deleted with it. |  |
| `activity_date` | `ngay` | date | không |  |  | Business date of the contact. |  |
| `activity_kind` | `loai` | text | không |  | CHECK | call / meeting / site / zalo / email / quote / note. |  |
| `title` | `tieu_de` | text | không |  | CHECK | Short title. |  |
| `content` | `noi_dung` | text | không | '' |  | What happened. |  |
| `outcome` | `ket_qua` | text | không | '' | CHECK | Customer reaction: good / neutral / bad, empty for plain notes. |  |
| `next_follow_up_date` | `hen_tiep` | date | có |  |  | Planned next contact date; null = none. |  |
| `next_note` | `ghi_chu_hen` | text | không | '' |  | What to do at the next contact. |  |
| `author_name` | `nguoi_viet` | text | không | '' |  | Display name of the writer at the time (snapshot). | **B (snapshot)**: tên người viết tại thời điểm ghi. |
| `created_by` | `nguoi_tao` | uuid | có |  | FK SET NULL | User who wrote the row; set null if the user is deleted. |  |
| `created_at` | `ngay_tao` | timestamp with time zone | không | now() |  | Row creation time. |  |

## `delivery_projects` (`tk_du_an`)

Dự án triển khai sau Kinh doanh: `kind = design` (trang Quản lý thiết kế, quyền tab `thietke`) / `construction` (Quản lý dự án, quyền `thicong`) - migration 0016, module `backend/internal/modules/delivery`. **Tenant-owned, bảng gốc**.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Primary key. |  |
| `company_id` | `cong_ty_id` | uuid | không |  | FK CASCADE | Owning company; set from the login session. |  |
| `kind` | `loai` | text | không |  | CHECK | design = Quản lý thiết kế page, construction = Quản lý dự án page. |  |
| `lead_id` | `khach_hang_id` | bigint | có |  | FK SET NULL | Sales lead it came from; null when created by hand. Unique per kind. | Unique cùng `kind` (`uq_delivery_projects_lead_id_kind`, chỉ khi khác NULL): 1 dự án thiết kế + 1 thi công / khách. |
| `project_code` | `ma_da` | text | có |  | FK SET NULL | Linked QS project (copied from the lead when created, editable). |  |
| `name` | `ten` | text | không |  | CHECK | Project display name. |  |
| `client_name` | `khach` | text | không | '' |  | Customer name (copied from the lead at creation, then independent). | **B (snapshot)** lúc tạo từ khách hàng Kinh doanh, sau đó sửa độc lập. |
| `contact_name` | `lien_he` | text | không | '' |  | Customer contact person. |  |
| `phone` | `sdt` | text | không | '' |  | Customer phone. |  |
| `email` | `email` | text | không | '' |  | Customer email. |  |
| `address` | `dia_chi` | text | không | '' |  | Site address. |  |
| `project_type` | `loai_cong_trinh` | text | không | '' |  | Building type (Nhà phố, Biệt thự, ...). |  |
| `status` | `trang_thai` | text | không | 'nhap' | CHECK | nhap (draft) / dang-lam (in progress) / tam-dung (paused) / hoan-tat (done). |  |
| `start_date` | `ngay_bat_dau` | date | có |  | CHECK | Planned start date. |  |
| `handover_date` | `ngay_ban_giao` | date | có |  | CHECK | Planned handover date. |  |
| `contract_value_vnd` | `gia_tri_hd` | numeric(18,0) | không | 0 | CHECK | Contract value, VND. Snapshot of the lead value at creation, then edited here. | **B (snapshot)** giá trị khách hàng lúc tạo (tổng báo giá QS nếu đã gắn), sau đó sửa độc lập. |
| `approved_budget_vnd` | `ngan_sach` | numeric(18,0) | không | 0 | CHECK | Approved cost budget, VND. |  |
| `note` | `ghi_chu` | text | không | '' |  | General note. |  |
| `created_by` | `nguoi_tao` | uuid | có |  | FK SET NULL | User who created the row (or moved the lead); set null if deleted. |  |
| `created_at` | `ngay_tao` | timestamp with time zone | không | now() |  | Row creation time. |  |
| `updated_at` | `cap_nhat` | timestamp with time zone | không | now() |  | Last change of the project header (set by the service). |  |

## `delivery_project_members` (`tk_thanh_vien`)

Thành viên dự án triển khai - migration 0016. **Bảng con** (tenant qua `project_id`).

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Primary key. |  |
| `project_id` | `du_an_id` | bigint | không |  | FK CASCADE | Owning project. |  |
| `member_name` | `ten` | text | không |  | CHECK | Display name (free text; staff directory is not in the database yet). |  |
| `role` | `vai_tro` | text | không | '' |  | Role on the project. |  |
| `dept_key` | `bo_phan` | text | không | 'general' |  | Department / org-chart node key the person sits in (open list). |  |
| `created_at` | `ngay_tao` | timestamp with time zone | không | now() |  | Row creation time. |  |

## `delivery_subcontractors` (`tk_thau_phu`)

Thầu phụ của dự án triển khai - migration 0016. **Bảng con** (tenant qua `project_id`).

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Primary key. |  |
| `project_id` | `du_an_id` | bigint | không |  | FK CASCADE | Owning project. |  |
| `name` | `ten` | text | không |  | CHECK | Subcontractor company name. |  |
| `scope` | `pham_vi` | text | không | '' |  | Work scope. |  |
| `contact_name` | `lien_he` | text | không | '' |  | Contact person. |  |
| `phone` | `sdt` | text | không | '' |  | Contact phone. |  |
| `contract_value_vnd` | `gia_tri` | numeric(18,0) | không | 0 | CHECK | Subcontract value, VND. |  |
| `status` | `trang_thai` | text | không | 'pending' | CHECK | active / pending / done. |  |
| `created_at` | `ngay_tao` | timestamp with time zone | không | now() |  | Row creation time. |  |

## `delivery_phases` (`tk_giai_doan`)

Đề mục (giai đoạn) tiến độ Gantt - migration 0016. **Bảng con** (tenant qua `project_id`).

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK, UNIQUE | Primary key. |  |
| `project_id` | `du_an_id` | bigint | không |  | FK CASCADE, UNIQUE | Owning project. |  |
| `name` | `ten` | text | không |  | CHECK | Phase name. |  |
| `sort_order` | `thu_tu` | integer | không | 0 |  | Display order (ascending). |  |
| `members` | `thanh_vien` | jsonb | không | '[]' | CHECK | Document read/written whole: [{"name": text, "role": text}] in charge of the phase. | jsonb tài liệu nguyên khối: `[{"name": text, "role": text}]`. |
| `created_at` | `ngay_tao` | timestamp with time zone | không | now() |  | Row creation time. |  |

## `delivery_tasks` (`tk_cong_viec`)

Công việc / cột mốc / mốc thu chi trên tiến độ - migration 0016. **Bảng con** (tenant qua `project_id`).

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK, UNIQUE | Primary key. |  |
| `project_id` | `du_an_id` | bigint | không |  | FK CASCADE, FK CASCADE, UNIQUE | Owning project (tenant path; must equal the phase project, enforced by fk_delivery_tasks_phase). | Đường tenant (db-map `tenant` qua `delivery_projects`); khoá ngoại ghép `(phase_id, project_id)` bảo đảm cùng dự án với giai đoạn. |
| `phase_id` | `giai_doan_id` | bigint | không |  | FK CASCADE | Phase the task sits in. |  |
| `name` | `ten` | text | không |  | CHECK | Task name. |  |
| `start_date` | `bat_dau` | date | không |  | CHECK | Start date (actual date once a payment milestone is confirmed). |  |
| `end_date` | `ket_thuc` | date | không |  | CHECK | End date. |  |
| `progress_pct` | `tien_do` | numeric(5,2) | không | 0 | CHECK | Progress 0-100 entered by the team. |  |
| `is_critical` | `quan_trong` | boolean | không | false |  | On the critical path (drawn red). |  |
| `is_milestone` | `cot_moc` | boolean | không | false |  | Milestone (drawn as a diamond). |  |
| `description` | `mo_ta` | text | không | '' |  | Task description. |  |
| `depts` | `bo_phan` | text[] | không | '{}' |  | Departments in charge (display only, never filtered on). | Danh sách chỉ để hiển thị (quy tắc 6). |
| `owners` | `phu_trach` | text[] | không | '{}' |  | People in charge (display only; first one shown as assignee). | Danh sách chỉ để hiển thị (quy tắc 6); phần tử đầu hiện ở cột "Phụ trách". |
| `finance_kind` | `loai_tien` | text | có |  | CHECK | Payment milestone: thu (money in) / chi (money out); null = normal task. |  |
| `planned_date` | `ngay_ke_hoach` | date | có |  |  | Planned date of a payment milestone (start_date holds the actual date once confirmed). |  |
| `amount_vnd` | `so_tien` | numeric(18,0) | có |  | CHECK | Amount of a payment milestone, VND. |  |
| `is_confirmed` | `da_xac_nhan` | boolean | không | false |  | Payment milestone confirmed as paid / received. |  |
| `sort_order` | `thu_tu` | integer | không | 0 |  | Order inside the phase (ascending). |  |
| `created_at` | `ngay_tao` | timestamp with time zone | không | now() |  | Row creation time. |  |
| `updated_at` | `cap_nhat` | timestamp with time zone | không | now() |  | Last change (set by the service). |  |

## `delivery_task_comments` (`tk_binh_luan`)

Bình luận công việc - migration 0016. **Bảng con** (tenant qua `project_id`).

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Primary key. |  |
| `project_id` | `du_an_id` | bigint | không |  | FK CASCADE, FK CASCADE | Owning project (tenant path; must equal the task project, enforced by fk_delivery_task_comments_task). | Đường tenant; khoá ngoại ghép `(task_id, project_id)` bảo đảm cùng dự án với công việc. |
| `task_id` | `cong_viec_id` | bigint | không |  | FK CASCADE | Task commented on. |  |
| `author_name` | `nguoi_viet` | text | không | '' |  | Display name of the writer at the time (snapshot). | **B (snapshot)**: tên người viết tại thời điểm ghi. |
| `body` | `noi_dung` | text | không |  | CHECK | Comment text (may contain @mentions). |  |
| `created_by` | `nguoi_tao` | uuid | có |  | FK SET NULL | User who wrote it; set null if deleted. |  |
| `created_at` | `ngay_tao` | timestamp with time zone | không | now() |  | Row creation time. |  |

## `product_hvac_specs` (phần của `db_san_pham`)

Thông số ngành Điện lạnh (đề mục 3.2.7, nguồn `backend/internal/shared/specs/js/dl-spec.js`, chép từ QS Pro ea787b6) - migration 0017 (2026-10-28).
Bảng 1-1 với `products`, chỉ có dòng khi SP có ít nhất 1 thông số; đọc qua view `product_catalog` (cột s4), ghi tách theo `parts` của `db_san_pham` trong `db-map.json`.
**Xếp loại (quy tắc 25):** bảng con của `products` (công ty lấy qua sản phẩm, như các bảng thông số khác). 2 cột đổi tên so với QS Pro vì trùng cột ngành vệ sinh trong view: `hvac_power_supply` (nhãn ĐIỆN NGUỒN), `hvac_control_type` (nhãn ĐIỀU KHIỂN (REMOTE / WIFI)).

| Cột | Tên trong code | Kiểu | NULL | Ràng buộc | Ý nghĩa |
|---|---|---|---|---|---|
| `product_id` | `—` | bigint | không | PK, FK CASCADE | Product (products.id); row deleted with the product. |
| `unit_type` | `loai_may` | text | có |  | HVAC spec (code: loai_may) |
| `cooling_capacity_kw` | `cs_lanh_kw` | text | có |  | HVAC spec (code: cs_lanh_kw) |
| `capacity_hp` | `cs_hp` | text | có |  | HVAC spec (code: cs_hp) |
| `capacity_btu` | `cs_btu` | text | có |  | HVAC spec (code: cs_btu) |
| `operation_mode` | `che_do_van_hanh` | text | có |  | HVAC spec (code: che_do_van_hanh) |
| `compressor_type` | `may_nen` | text | có |  | HVAC spec (code: may_nen) |
| `refrigerant` | `moi_chat_lanh` | text | có |  | HVAC spec (code: moi_chat_lanh) |
| `hvac_power_supply` | `dien_nguon_dl` | text | có |  | HVAC spec (code: dien_nguon_dl) |
| `origin_country` | `xuat_xu` | text | có |  | HVAC spec (code: xuat_xu) |
| `power_input_kw` | `cs_dien_kw` | text | có |  | HVAC spec (code: cs_dien_kw) |
| `energy_efficiency` | `hieu_suat_nl` | text | có |  | HVAC spec (code: hieu_suat_nl) |
| `energy_label` | `nhan_nang_luong` | text | có |  | HVAC spec (code: nhan_nang_luong) |
| `airflow_m3h` | `luu_luong_gio` | text | có |  | HVAC spec (code: luu_luong_gio) |
| `indoor_noise_db` | `do_on_dan_lanh` | text | có |  | HVAC spec (code: do_on_dan_lanh) |
| `outdoor_noise_db` | `do_on_dan_nong` | text | có |  | HVAC spec (code: do_on_dan_nong) |
| `cooling_area` | `pham_vi_lam_lanh` | text | có |  | HVAC spec (code: pham_vi_lam_lanh) |
| `air_filtration` | `loc_khi` | text | có |  | HVAC spec (code: loc_khi) |
| `hvac_control_type` | `dk_dieu_hoa` | text | có |  | HVAC spec (code: dk_dieu_hoa) |
| `liquid_pipe` | `ong_long` | text | có |  | HVAC spec (code: ong_long) |
| `gas_pipe` | `ong_hoi` | text | có |  | HVAC spec (code: ong_hoi) |
| `max_pipe_length_m` | `ong_dai_max` | text | có |  | HVAC spec (code: ong_dai_max) |
| `max_height_diff_m` | `chenh_cao_max` | text | có |  | HVAC spec (code: chenh_cao_max) |
| `drain_pipe` | `ong_thoat_nuoc` | text | có |  | HVAC spec (code: ong_thoat_nuoc) |
| `power_cable` | `day_nguon` | text | có |  | HVAC spec (code: day_nguon) |
| `control_cable` | `day_dieu_khien` | text | có |  | HVAC spec (code: day_dieu_khien) |
| `panel_model` | `mat_na` | text | có |  | HVAC spec (code: mat_na) |
| `max_indoor_units` | `so_dan_lanh_max` | text | có |  | HVAC spec (code: so_dan_lanh_max) |
| `refrigerant_charge` | `gas_nap` | text | có |  | HVAC spec (code: gas_nap) |
| `indoor_unit_dimensions` | `kt_dan_lanh` | text | có |  | HVAC spec (code: kt_dan_lanh) |
| `indoor_unit_weight_kg` | `kl_dan_lanh` | text | có |  | HVAC spec (code: kl_dan_lanh) |
| `outdoor_unit_dimensions` | `kt_dan_nong` | text | có |  | HVAC spec (code: kt_dan_nong) |
| `outdoor_unit_weight_kg` | `kl_dan_nong` | text | có |  | HVAC spec (code: kl_dan_nong) |
| `panel_cutout_size` | `kt_mat_na` | text | có |  | HVAC spec (code: kt_mat_na) |
| `installation_location` | `vi_tri_lap_dat` | text | có |  | HVAC spec (code: vi_tri_lap_dat) |
| `outdoor_bracket` | `gia_do_dan_nong` | text | có |  | HVAC spec (code: gia_do_dan_nong) |
| `min_clearance` | `kc_lap_min` | text | có |  | HVAC spec (code: kc_lap_min) |
| `installation_note` | `gc_lap_dat` | text | có |  | HVAC spec (code: gc_lap_dat) |
| `material_spec` | `quy_cach_vt` | text | có |  | HVAC spec (code: quy_cach_vt) |

## `audit_logs` (`audit_log`)

Nhật ký thao tác (chỉ thêm). 2933 dòng.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Audit entry primary key (identity) |  |
| `user_id` | `user_id` | uuid | có |  |  | User who performed the action (NULL for failed logins and system jobs) | **Tham chiếu mềm**: 13 dòng trỏ user đã xoá. |
| `username` | `username` | text | có |  |  | Snapshot of the actor's username at the time of the action ('hệ thống' for system jobs) | **Snapshot**: login_fail lưu nguyên chuỗi người dùng gõ. |
| `action` | `action` | text | có |  |  | Action key (login, them_sp, sua_sp, create_user, ...); values are stored as written by the app |  |
| `detail` | `detail` | text | có |  |  | Human-readable description of what happened |  |
| `created_at` | `created_at` | timestamp with time zone | không | now() |  | When the action happened |  |
| `company_id` | `cong_ty_id` | uuid | có |  |  | Company context of the action (NULL for system-wide / super admin actions) |  |

## `notifications` (`notifications`)

Thông báo trong app cho từng user. 26 dòng.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Notification primary key (identity) |  |
| `user_id` | `user_id` | uuid | có |  |  | Recipient user |  |
| `kind` | `kind` | text | có |  |  | Notification kind (delete_request, delete_approved, delete_rejected, purchase_request, purchase_approved, purchase_rejected, de_xuat, de_xuat_approved, de_xuat_rejected) |  |
| `title` | `title` | text | có |  |  | Short title shown in the notification list |  |
| `body` | `body` | text | có |  |  | Notification message text |  |
| `ref_id` | `ref_id` | text | có |  |  | Polymorphic reference to the related record, depending on kind: delete request id (as text), purchase order code or purchase proposal code | **Tham chiếu đa hình (text)**: id phiếu xoá, mã đơn, hoặc mã đề xuất tuỳ kind. |
| `is_read` | `is_read` | boolean | không | false |  | Whether the recipient has read the notification |  |
| `created_at` | `created_at` | timestamp with time zone | không | now() |  | When the notification was created |  |
| `company_id` | `cong_ty_id` | uuid | có |  | FK | Company the notification belongs to (tenant scope) |  |

## `delete_requests` (`delete_requests`)

Phiếu yêu cầu xoá sản phẩm chờ admin duyệt. 1 dòng.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Product delete request primary key (identity) |  |
| `requester_id` | `requester_id` | uuid | có |  |  | User who submitted the request |  |
| `requester_name` | `requester_name` | text | có |  |  | Snapshot of the requester's full name or username |  |
| `items` | `items` | text | có |  |  | JSON array (stored as text) of the products to delete: [{maSP, id, ten}] | **JSON trong cột text**: Mảng [{maSP, id, ten}]. |
| `status` | `status` | text | không | 'pending'::text | CHECK | Request status: pending, approved or rejected |  |
| `note` | `note` | text | có |  |  | Reason for the deletion given by the requester (optional, at most 500 characters); NULL = none given | Từ migration 0010 (M15.2): thôi DEPRECATED, ra khỏi danh sách xoá D-09. |
| `resolver_name` | `resolver_name` | text | có |  |  | Name of the admin who approved or rejected the request |  |
| `resolved_at` | `resolved_at` | timestamp with time zone | có |  |  | When the request was approved or rejected |  |
| `resolution_note` | `resolution_note` | text | có |  |  | Reason given by the admin when rejecting the request (optional); NULL = none given | **Chỉ bản Go**, migration 0010 (M15.2); ghi bằng lệnh riêng, chỉ khi có giá trị. |
| `created_at` | `created_at` | timestamp with time zone | không | now() |  | When the request was submitted |  |
| `company_id` | `cong_ty_id` | uuid | có |  | FK | Company the request belongs to (tenant scope) |  |

## `products` (`db_san_pham`)

Danh mục sản phẩm (đèn, thiết bị vệ sinh, sơn, công tắc - ổ cắm); mỗi dòng là 1 biến thể. 1093 dòng.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Surrogate primary key (identity); one row per product variant |  |
| `product_code` | `ma_sp` | text | có |  |  | Product code; NOT unique - variants share one code | **Khoá nghiệp vụ (không duy nhất)**: Dùng chung cho mọi biến thể; có thể NULL/rỗng. Không dùng làm khoá tham chiếu được. |
| `product_name` | `ten_sp` | text | không |  | CHECK | Product name (required by the entry form) |  |
| `product_line` | `dong_sp` | text | có |  |  | Product line / series |  |
| `category` | `hang_muc` | text | có |  |  | Category within the sector (e.g. toilet, interior paint, downlight) |  |
| `product_group` | `nhom_sp` | text | có |  |  | Product group (catalog sheet); falls back to product line when empty |  |
| `brand` | `thuong_hieu` | text | có |  |  | Brand |  |
| `supplier_name` | `nha_cung_cap` | text | có |  |  | Supplier name |  |
| `power_w` | `cong_suat_w` | text | có |  |  | Power in watts; free text (e.g. '2x5W'), variant axis | **Trục biến thể** |
| `color_temperature_k` | `nhiet_do_mau_k` | text | có |  |  | Color temperature in kelvin; text so lists like '3000, 4000' are allowed, variant axis | **Trục biến thể**: Thuộc unique index biến thể. |
| `luminous_flux_lm` | `quang_thong_lm` | numeric | có |  | CHECK | Luminous flux in lumens |  |
| `beam_angle_deg` | `goc_chieu_deg` | text | có |  |  | Beam angle in degrees; free text (e.g. '24/38'), variant axis | **Trục biến thể** |
| `tilt_angle_deg` | `goc_nghieng_deg` | text | có |  |  | Tilt angle in degrees; free text |  |
| `color` | `mau_sac` | text | có |  |  | Color / finish color, variant axis | **Trục biến thể (dùng chung mọi ngành)** |
| `material` | `chat_lieu` | text | có |  |  | Material |  |
| `height_mm` | `chieu_cao_mm` | numeric | có |  |  | Height in millimetres |  |
| `diameter_mm` | `duong_kinh_mm` | numeric | có |  | CHECK | Diameter in millimetres |  |
| `cutout_mm` | `cutout_mm` | text | có |  |  | Ceiling cut-out size in millimetres; free text |  |
| `ip_rating` | `chi_so_ip` | text | có |  |  | Ingress protection (IP) rating |  |
| `cri` | `cri` | text | có |  |  | Color rendering index; free text |  |
| `luminous_efficacy_lm_w` | `hieu_suat_lm_w` | numeric | có |  | CHECK | Luminous efficacy in lm/W |  |
| `ugr` | `ugr` | text | có |  |  | Unified glare rating |  |
| `sdcm` | `sdcm` | text | có |  |  | Color consistency (SDCM / MacAdam steps) |  |
| `coi` | `coi` | text | có |  |  | COI lighting index as entered on the form |  |
| `lifespan` | `tuoi_tho` | text | có |  |  | Rated lifespan; free text |  |
| `led_chip_type` | `loai_chip_led` | text | có |  |  | LED chip package type (COB / SMD / module) |  |
| `protection_class` | `class_rating` | text | có |  |  | Electrical protection class (Class I/II/III) |  |
| `has_separate_driver` | `lap_nguon_roi` | boolean | có |  |  | True when the luminaire uses a separately mounted driver |  |
| `driver_name` | `ten_bo_nguon` | text | có |  |  | Driver (power supply) name |  |
| `driver_code` | `ma_bo_nguon` | text | có |  |  | Driver model code |  |
| `driver_brand` | `hang_bo_nguon` | text | có |  |  | Driver manufacturer |  |
| `driver_mounting_position` | `vi_tri_lap_nguon` | text | có |  |  | Where the driver is mounted |  |
| `control_compatibility` | `dieu_khien` | text | có |  |  | Compatible control / dimming protocols |  |
| `max_output_current_ma` | `dong_ra_max_ma` | numeric | có |  | CHECK | Maximum driver output current in mA |  |
| `warranty_years` | `bao_hanh_nam` | numeric | có |  | CHECK | Warranty period in years |  |
| `unit` | `dvt` | text | có |  |  | Unit of measure (app shows 'Cái' when empty) |  |
| `retail_price` | `gia_ban_le` | numeric | có |  | CHECK | Retail list price (VND) |  |
| `dealer_discount_pct` | `ck_dai_ly_pct` | numeric | có |  | CHECK | Dealer discount percent off the retail price |  |
| `dealer_price` | `gia_dai_ly` | numeric | có |  | CHECK | Dealer (cost) price = round(retail_price * (1 - dealer_discount_pct/100)); never written by the app | **C - dẫn xuất**: Ở Supabase là cột GENERATED = round(retail_price*(1-dealer_discount_pct/100)). Trong qspro_en đang là cột thường -> LỖI cần sửa. |
| `image_urls` | `anh_sp` | text | có |  |  | Image URLs, newline separated; the first one is the main image | **Đa trị**: Nhiều URL cách nhau xuống dòng; URL đầu là ảnh chính. |
| `datasheet_url` | `link_datasheet` | text | có |  |  | Link to the datasheet / catalogue |  |
| `status` | `trang_thai` | text | có |  |  | Sales status (e.g. 'Đang kinh doanh') |  |
| `note` | `ghi_chu` | text | có |  |  | Free-form note, appended to the product description |  |
| `updated_at` | `ngay_cap_nhat` | timestamp with time zone | có | now() |  | Last update time (DEFAULT now(); inserts rely on the default) |  |
| `company_id` | `cong_ty_id` | uuid | có |  | FK | Owning company (tenant); NULL when the row was inserted without a company context (super admin session) |  |
| `is_approved` | `da_duyet` | boolean | có | false |  | True when the product has been approved; reset on content edits (DEFAULT false; inserts rely on the default) | **Trạng thái**: Tự về false khi nội dung bị sửa. |
| `approved_by` | `nguoi_duyet` | text | có |  |  | Username of the approver |  |
| `approved_at` | `ngay_duyet` | timestamp with time zone | có |  |  | Approval time |  |
| `created_by` | `nguoi_tao` | text | có |  |  | Username of the creator |  |
| `created_at` | `ngay_tao` | timestamp with time zone | có | now() |  | Creation time (DEFAULT now()) |  |
| `updated_by` | `nguoi_sua` | text | có |  |  | Username of the last editor |  |
| `led_chip_name` | `ten_chip_led` | text | có |  |  | LED chip maker / model (Bridgelux, Cree, ...) |  |
| `driver_price` | `gia_ban_bo_nguon` | numeric | có |  | CHECK | Selling price of the driver (VND) |  |
| `variant_group` | `nhom_bt` | text | có |  |  | User-defined variant group key (e.g. BT-1412); NULL = group by product code | **Khoá tổng hợp**: Chuỗi 'BT-<id sản phẩm>' gom biến thể khác mã. |
| `sector` | `nganh` | text | có |  |  | Product sector: 'den' lighting (assumed when NULL), 'vs' sanitary ware, 'son' paint | **Phân loại**: den / vs / son / ct; quyết định nhóm cột thông số áp dụng. |
| `size` | `kich_thuoc` | text | có |  |  | Dimensions or pack size (e.g. 'L580 x W380 x H335', '18L'); variant axis | **Trục biến thể (vs, son)** |
| `flush_system` | `he_thong_xa` | text | có |  |  | Sanitary: flush system (e.g. Tornado) |  |
| `flush_volume` | `luong_nuoc_xa` | text | có |  |  | Sanitary: flush water volume (e.g. 4.5/3L) |  |
| `design` | `thiet_ke` | text | có |  |  | Sanitary: design description |  |
| `rough_in_distance` | `tam_xa` | text | có |  |  | Sanitary: drain rough-in distance (e.g. 305 mm) |  |
| `water_pressure` | `ap_luc_nuoc` | text | có |  |  | Sanitary: working water pressure range |  |
| `caution` | `luu_y` | text | có |  |  | Usage / installation caution shown on the spec sheet |  |
| `features` | `tinh_nang` | text | có |  |  | Feature list, one bullet per line |  |
| `installation_type` | `kieu_lap_dat` | text | có |  |  | Installation / mounting type |  |
| `lid_type` | `loai_nap` | text | có |  |  | Sanitary: toilet lid / seat type |  |
| `faucet_type` | `loai_voi` | text | có |  |  | Sanitary: faucet type |  |
| `shower_type` | `loai_sen` | text | có |  |  | Sanitary: shower type |  |
| `control_type` | `kieu_dieu_khien` | text | có |  |  | Sanitary: control type (e.g. remote, side panel) |  |
| `massage_function` | `massage` | text | có |  |  | Sanitary: massage function (yes/no text) |  |
| `bowl_count` | `so_ho` | text | có |  |  | Sanitary: number of sink bowls (text option) |  |
| `flow_rate` | `luu_luong` | text | có |  |  | Sanitary: water flow rate (e.g. 6 L/min) |  |
| `valve_cartridge` | `loi_van` | text | có |  |  | Sanitary: valve cartridge |  |
| `shower_head_size` | `bat_sen` | text | có |  |  | Sanitary: shower head size |  |
| `spray_modes` | `che_do_phun` | text | có |  |  | Sanitary: spray modes |  |
| `faucet_hole_count` | `so_lo_voi` | text | có |  |  | Sanitary: number of faucet holes (text option) |  |
| `overflow_hole` | `xa_tran` | text | có |  |  | Sanitary: overflow hole (yes/no text) |  |
| `capacity` | `dung_tich` | text | có |  |  | Sanitary: capacity (e.g. 220 L) |  |
| `power_supply` | `nguon_dien` | text | có |  |  | Sanitary: electrical supply (e.g. 220V/50Hz) |  |
| `compatible_toilet` | `bon_cau_tuong_thich` | text | có |  |  | Sanitary: toilets the electronic seat fits |  |
| `thickness` | `do_day` | text | có |  |  | Material thickness (e.g. 1.2 mm) |  |
| `surface_finish` | `be_mat` | text | có |  |  | Surface finish (shared by sanitary ware and paint) |  |
| `spec_sheet_url` | `thong_so_file` | text | có |  |  | Link to the technical specification file |  |
| `installation_guide_url` | `huong_dan_lap_dat` | text | có |  |  | Link to the installation guide |  |
| `drawing_file_url` | `file_ban_ve` | text | có |  |  | Link to the drawing file |  |
| `coverage` | `do_phu` | text | có |  |  | Paint: coverage (e.g. 13 m2/litre/coat) |  |
| `drying_time` | `thoi_gian_kho` | text | có |  |  | Paint: drying time |  |
| `coat_count` | `so_lop` | text | có |  |  | Paint: recommended number of coats (text option 1/2/3) |  |
| `physical_state` | `trang_thai_vat_ly` | text | có |  |  | Paint SDS: physical state (liquid / powder / paste) |  |
| `odor` | `mui` | text | có |  |  | Paint SDS: odor |  |
| `odor_threshold` | `nguong_mui` | text | có |  |  | Paint SDS: odor threshold |  |
| `ph_value` | `do_ph` | text | có |  |  | Paint SDS: pH |  |
| `melting_freezing_point` | `diem_dong` | text | có |  |  | Paint SDS: melting / freezing point |  |
| `boiling_point` | `diem_soi` | text | có |  |  | Paint SDS: boiling point and range |  |
| `flash_point` | `diem_bung_chay` | text | có |  |  | Paint SDS: flash point |  |
| `flammability` | `kha_nang_chay` | text | có |  |  | Paint SDS: flammability |  |
| `explosive_limits` | `gioi_han_no` | text | có |  |  | Paint SDS: lower and upper explosive limits |  |
| `vapor_pressure` | `ap_suat_hoa_hoi` | text | có |  |  | Paint SDS: vapor pressure |  |
| `vapor_density` | `mat_do_hoi` | text | có |  |  | Paint SDS: relative vapor density |  |
| `water_solubility` | `do_hoa_tan` | text | có |  |  | Paint SDS: solubility in water |  |
| `viscosity` | `tinh_deo` | text | có |  |  | Paint SDS: viscosity (e.g. 2477 mm2/s) |  |
| `particle_characteristics` | `dac_tinh_hat` | text | có |  |  | Paint SDS: particle characteristics |  |
| `relative_density` | `mat_do_tuong_doi` | text | có |  |  | Paint SDS: relative density (distinct from vapor density) |  |
| `component_type` | `thanh_phan` | text | có |  |  | Switch/socket spec (was: thanh_phan) |  |
| `socket_count` | `so_o_cam` | text | có |  |  | Switch/socket spec (was: so_o_cam) |  |
| `plug_type` | `kieu_chau` | text | có |  |  | Switch/socket spec (was: kieu_chau) |  |
| `gang_count` | `so_nut` | text | có |  |  | Switch/socket spec (was: so_nut) |  |
| `circuit_type` | `kieu_mach` | text | có |  |  | Switch/socket spec (was: kieu_mach) |  |
| `operation_type` | `kieu_thao_tac` | text | có |  |  | Switch/socket spec (was: kieu_thao_tac) |  |
| `indicator_light` | `den_bao` | text | có |  |  | Switch/socket spec (was: den_bao) |  |
| `safety_shutter` | `man_che` | text | có |  |  | Switch/socket spec (was: man_che) |  |
| `pack_quantity` | `quy_cach` | text | có |  |  | Switch/socket spec (was: quy_cach) |  |
| `rated_current_a` | `dong_dm_a` | text | có |  |  | Switch/socket spec (was: dong_dm_a) |  |
| `rated_voltage_v` | `dien_ap_v` | text | có |  |  | Switch/socket spec (was: dien_ap_v) |  |
| `max_power_w` | `cong_suat_max_w` | text | có |  |  | Switch/socket spec (was: cong_suat_max_w) |  |
| `max_load_power_w` | `cong_suat_tai_max_w` | text | có |  |  | Switch/socket spec (was: cong_suat_tai_max_w) |  |
| `min_load_power_w` | `cong_suat_tai_min_w` | text | có |  |  | Switch/socket spec (was: cong_suat_tai_min_w) |  |
| `load_type` | `loai_tai` | text | có |  |  | Switch/socket spec (was: loai_tai) |  |
| `operation_cycles` | `tuoi_tho_lan` | text | có |  |  | Switch/socket spec (was: tuoi_tho_lan) |  |
| `frequency_hz` | `tan_so_hz` | text | có |  |  | Switch/socket spec (was: tan_so_hz) |  |
| `contact_material` | `vat_lieu_tiep_diem` | text | có |  |  | Switch/socket spec (was: vat_lieu_tiep_diem) |  |
| `flame_resistance` | `chong_chay` | text | có |  |  | Switch/socket spec (was: chong_chay) |  |
| `standards` | `tieu_chuan` | text | có |  |  | Switch/socket spec (was: tieu_chuan) |  |
| `certifications` | `chung_nhan` | text | có |  |  | Switch/socket spec (was: chung_nhan) |  |
| `usb_a_port_count` | `so_usb_a` | text | có |  |  | Switch/socket spec (was: so_usb_a) |  |
| `usb_c_port_count` | `so_usb_c` | text | có |  |  | Switch/socket spec (was: so_usb_c) |  |
| `usb_charging_power_w` | `cong_suat_sac_w` | text | có |  |  | Switch/socket spec (was: cong_suat_sac_w) |  |
| `usb_output` | `usb_ra` | text | có |  |  | Switch/socket spec (was: usb_ra) |  |
| `signal_connector_type` | `loai_tin_hieu` | text | có |  |  | Switch/socket spec (was: loai_tin_hieu) |  |
| `smart_integration` | `thong_minh` | text | có |  |  | Switch/socket spec (was: thong_minh) |  |
| `connectivity_protocol` | `giao_thuc` | text | có |  |  | Switch/socket spec (was: giao_thuc) |  |
| `compatible_ecosystem` | `he_sinh_thai` | text | có |  |  | Switch/socket spec (was: he_sinh_thai) |  |
| `neutral_wire` | `day_trung_tinh` | text | có |  |  | Switch/socket spec (was: day_trung_tinh) |  |
| `sensor_type` | `loai_cam_bien` | text | có |  |  | Switch/socket spec (was: loai_cam_bien) |  |
| `smart_features` | `tinh_nang_tm` | text | có |  |  | Switch/socket spec (was: tinh_nang_tm) |  |
| `module_count` | `so_module` | text | có |  |  | Switch/socket spec (was: so_module) |  |
| `face_width_mm` | `rong_mm` | text | có |  |  | Switch/socket spec (was: rong_mm) |  |
| `face_height_mm` | `cao_mm` | text | có |  |  | Switch/socket spec (was: cao_mm) |  |
| `face_depth_mm` | `sau_mm` | text | có |  |  | Switch/socket spec (was: sau_mm) |  |
| `mounting_box_type` | `loai_de` | text | có |  |  | Switch/socket spec (was: loai_de) |  |
| `min_box_depth_mm` | `sau_hop_am_mm` | text | có |  |  | Switch/socket spec (was: sau_hop_am_mm) |  |
| `max_wire_cross_section` | `tiet_dien_day` | text | có |  |  | Switch/socket spec (was: tiet_dien_day) |  |

## `product_histories` (`db_san_pham_history`)

Lịch sử thay đổi sản phẩm (chỉ thêm), khoá theo MÃ sản phẩm dạng chữ. 3002 dòng.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Surrogate primary key (identity) |  |
| `product_code` | `ma_sp` | text | có |  |  | Product code the change belongs to (product name when the product has no code; may be empty); soft reference kept after the product is deleted | **Tham chiếu mềm**: Mã SP, hoặc TÊN SP khi sản phẩm không có mã. 366 dòng trỏ tới mã không còn. |
| `field` | `field` | text | có |  |  | Label of the changed field or event (e.g. 'GIÁ BÁN LẺ', 'TẠO SẢN PHẨM') |  |
| `old_value` | `old_value` | text | có |  |  | Value before the change, as text ('' when none) |  |
| `new_value` | `new_value` | text | có |  |  | Value after the change, as text ('' when none) |  |
| `changed_by_id` | `changed_by` | uuid | có |  | FK | users.id of the person who made the change; NULL when there is no actor |  |
| `changed_by_name` | `changed_by_name` | text | có |  |  | Username snapshot of the person who made the change ('ẩn danh' when unknown) |  |
| `changed_at` | `changed_at` | timestamp with time zone | không | now() |  | When the change happened (DEFAULT now(); never written by the app) |  |
| `company_id` | `cong_ty_id` | uuid | có |  | FK | Owning company (tenant); NULL when logged without a company context (super admin session) |  |

## `product_combos` (`sp_combo`)

Sản phẩm đi kèm (quan hệ N-N giữa 2 sản phẩm, có số lượng). 85 dòng.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Surrogate primary key (identity) |  |
| `company_id` | `cong_ty_id` | uuid | có |  | FK | Owning company (tenant); NULL when written by a super admin without company context |  |
| `product_id` | `sp_id` | bigint | không |  | FK, CHECK | Main product (products.id) |  |
| `companion_product_id` | `sp_kem_id` | bigint | không |  | FK, CHECK | Companion product sold/installed with the main one (products.id) |  |
| `quantity` | `so_luong` | numeric | có | 1 | CHECK | Companion units needed per one main product (DEFAULT 1) |  |
| `note` | `ghi_chu` | text | có |  |  | Note on the link, set by the product that owns the link (M10.2) | Từ 2026-10-15 (M10.2): React ghi ở form Cập nhật sản phẩm và hiện ở hộp xem sản phẩm; ra khỏi danh sách xoá D-09. Migration 0013 đổi chú thích cột (thôi `DEPRECATED`). |
| `sort_order` | `sort_no` | integer | có | 0 | CHECK | Display order of the companion within the main product's combo (DEFAULT 0) |  |
| `created_at` | `created_at` | timestamp with time zone | không | now() |  | Creation time (DEFAULT now()) |  |

## `favorite_products` (`sp_yeu_thich`)

Sản phẩm yêu thích theo CÔNG TY (không theo user). 18 dòng.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Surrogate primary key (identity) |  |
| `company_id` | `cong_ty_id` | uuid | có |  | FK | Company that marked the favorite; NULL when marked by a super admin without company context |  |
| `product_id` | `sp_id` | bigint | không |  |  | Favorited product (products.id); may belong to the shared Dezon catalog of another company |  |
| `product_code` | `ma_sp` | text | có |  |  | Product code copied at marking time for easy lookup | **D - dư thừa**: Bản sao mã SP lúc đánh dấu; không nơi nào đọc lại. |
| `created_by` | `nguoi_tao` | text | có |  |  | Username of the person who marked the favorite ('ẩn danh' when unknown) |  |
| `created_at` | `created_at` | timestamp with time zone | không | now() |  | When the favorite was marked (DEFAULT now()) |  |

## `projects` (`du_an`)

Dự án — thực chất mỗi dòng là 1 BẢN NHÁP; giao diện gom các dòng cùng tên thành 1 dự án. 30 dòng.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Surrogate primary key |  |
| `project_code` | `ma_da` | text | có |  | UNIQUE, CHECK | Natural project/draft code generated by the app (DA-YYYYMMDD-HHMMSS plus 2 random chars), globally unique; referenced by child tables | **Khoá nghiệp vụ**: DA-YYYYMMDD-HHMMSS + 2 ký tự; bất biến; mọi bảng con tham chiếu bằng mã này. |
| `project_name` | `ten_du_an` | text | có |  |  | Project name | **Khoá gom nhóm ngầm**: Giao diện gom các bản nháp thành 1 dự án theo lower(trim(tên)). |
| `customer_name` | `khach_hang` | text | có |  |  | Customer name |  |
| `address` | `dia_chi` | text | có |  |  | Project / customer address |  |
| `phone` | `sdt` | text | có |  |  | Customer phone number |  |
| `status` | `trang_thai` | text | có |  | CHECK | Project status: 'Bản nháp' (draft, default) \| 'Đang thực hiện' (in progress) \| 'Hoàn thành' (done) - list from public/app.js:2229 |  |
| `vat_pct` | `vat_pct` | numeric | có | 0 | CHECK | VAT rate in percent applied to the quotation | **Trùng lặp có chủ ý**: Đồng bộ 2 chiều với project_data_entries khoá ptVat. |
| `progress_pct` | `tien_do_pct` | numeric | có | 0 | CHECK | Project progress in percent (0-100) |  |
| `note` | `ghi_chu` | text | có |  |  | Free-text note |  |
| `project_scale` | `quy_mo` | text | có |  |  | Building scale / size description shown on the quotation cover (free text) |  |
| `total_area` | `tong_dt` | text | có |  |  | Total floor area in m2 (free text typed by the user) | **Gõ tay hoặc chép từ máy tính diện tích**: Kiểu text. |
| `quoted_area` | `dt_bao_gia` | text | có |  |  | Area used for the quotation in m2 (free text) | **Gõ tay hoặc chép từ máy tính diện tích**: Kiểu text. |
| `requirements` | `nhu_cau` | text | có |  |  | Customer needs / requirements shown on the cover |  |
| `segment` | `phan_khuc` | text | có |  |  | Market segment of the project shown on the cover |  |
| `quotation_code` | `ma_bao_gia` | text | có |  |  | Quotation number printed on the quotation |  |
| `custom_groups` | `nhom_tu_tao` | text | có |  |  | User-defined takeoff groups, '\|'-separated list | **Đa trị**: Tên nhóm tự tạo, nối bằng '\|'. |
| `custom_floors` | `tang_tu_tao` | text | có |  |  | User-defined floors / rooms in display order, '\|'-separated list (e.g. 'TẦNG 1\|TẦNG 2') | **Đa trị**: Tên tầng theo thứ tự, nối bằng '\|'; quotation_lines.floor phải khớp theo TÊN. |
| `created_at` | `ngay_tao` | timestamp with time zone | có | now() |  | Creation time |  |
| `updated_at` | `cap_nhat` | timestamp with time zone | có | now() |  | Last update time (set by the app on every update) |  |
| `draft_name` | `ten_ban_nhap` | text | có |  |  | Custom name of this draft |  |
| `company_id` | `cong_ty_id` | uuid | có |  | FK | Owning company (tenant); NULL on 5 legacy rows created before multi-tenancy |  |
| `dezon_url` | `link_dezon` | text | có |  |  | URL of the project article on dezon.vn |  |
| `current_condition` | `hien_trang` | text | có |  |  | Current condition of the site / building shown on the quotation cover (free text); NULL = not entered | **Chỉ bản Go**, migration 0011 (M8.3); client `hienTrang`, chỉ ghi khi client gửi khoá. |

## `project_data_entries` (`du_an_data`)

Kho khoá/giá trị JSON theo dự án (phần thô, cấu hình báo giá, lịch sử phiên bản...) và theo công ty (mã giả __cty:<id>). 23 dòng.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `project_code` | `ma_da` | text | không |  | PK, CHECK | Scope of the entry: a project code (projects.project_code), or the sentinel '__cty:<company id>' (legacy '__cty') for company-wide entries. Part of the primary key | **Tham chiếu + mã giả**: Mã dự án, hoặc '__cty:<company_id>' cho dữ liệu cấp công ty. |
| `data_key` | `khoa` | text | không |  | PK | Kind of data stored: phanTho (rough-construction estimate), area (area table), ptInfo (work-item info, company-wide), ptVat (VAT of the rough-construction estimate), cpCfg (cost tab settings), bgCfg (quotation summary and terms), bgHist (finalised quotation versions), bgOrg (company info printed on the quotation, company-wide), mhPay (purchase payments), btFmt (sheet cell formats). Part of the primary key |  |
| `data_value` | `gia_tri` | jsonb | có |  |  | JSON payload for the key (array, object or number depending on data_key) | **Tài liệu JSON**: Cấu trúc từng khoá: xem data dictionary mục JSON. |
| `company_id` | `cong_ty_id` | uuid | có |  | FK | Owning company (tenant) |  |
| `updated_at` | `cap_nhat` | timestamp with time zone | không | now() |  | Last update time |  |
| `updated_by` | `nguoi_sua` | text | có |  |  | Username of the user who last saved this entry ('' when unknown) |  |

## `quotation_lines` (`db_bao_gia`)

Dòng bóc tách / báo giá của dự án (bản chụp sản phẩm + giá tại lúc thêm). 545 dòng.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Surrogate primary key (line id used by the UI) |  |
| `project_code` | `ma_du_an` | text | có |  | CHECK | Code of the project/draft this takeoff line belongs to (projects.project_code) |  |
| `line_no` | `stt` | text | có |  |  | Displayed ordinal of the line (text copy of sort_no) |  |
| `zone` | `khu_vuc` | text | có |  |  | Legacy area column from the first schema; never written by the app (all NULL) - the UI field 'Khu vực' is stored in room | **D - bỏ được**: Không nơi nào tham chiếu; khuVuc của API ánh xạ vào cột room. |
| `room` | `phong` | text | có |  |  | Room / area where the item is installed (app field khuVuc) |  |
| `drawing_code` | `ma_so_ban_ve` | text | có |  |  | Reference code of the item on the design drawing |  |
| `product_code` | `ma_sp` | text | có |  |  | Product code copied from the catalog (snapshot; empty for manual lines) | **B - snapshot / tham chiếu mềm**: Người dùng sửa được; không xác định duy nhất 1 sản phẩm. |
| `product_name` | `ten_sp` | text | có |  |  | Product / item name (snapshot) | **B - snapshot** |
| `brand` | `thuong_hieu` | text | có |  |  | Brand (snapshot) | **B - snapshot** |
| `unit` | `dvt` | text | có |  |  | Unit of measure (default 'Cái') | **B - snapshot** |
| `quantity` | `so_luong` | numeric | có | 0 | CHECK | Quantity |  |
| `dealer_price` | `gia_dai_ly` | numeric | có | 0 | CHECK | Cost price = list_price * (1 - dealer_discount_pct/100), rounded to VND | **C - dẫn xuất**: = round(retail_price*(1-dealer_discount_pct/100)). |
| `profit_pct` | `loi_nhuan_pct` | numeric | có | 0 |  | Profit percent applied on list price to get selling price (can be negative) | **C - bán dẫn xuất**: Làm tròn số nguyên, tính trên giá niêm yết. |
| `selling_price` | `gia_ban` | numeric | có | 0 | CHECK | Selling price per unit before customer discount | **A - giá trị gốc**: PHẢI lưu: profit_pct bị làm tròn nên không suy ngược được. |
| `customer_discount_pct` | `ck_khach_hang_pct` | numeric | có | 0 | CHECK | Discount percent given to the customer |  |
| `unit_price` | `don_gia` | numeric | có | 0 | CHECK | Net unit price = selling_price * (1 - customer_discount_pct/100) | **C - dẫn xuất**: = round(selling_price*(1-customer_discount_pct/100)); server đọc lại. |
| `amount` | `thanh_tien` | numeric | có | 0 | CHECK | Line total = quantity * unit_price (VND) | **C - dẫn xuất**: = round(quantity*unit_price); server đọc lại cho báo giá, tờ bìa. |
| `markup_pct` | `markup_pct` | numeric | có | 0 |  | Markup percent = (unit_price - dealer_price) / dealer_price * 100 | **D - dẫn xuất chỉ ghi**: Không nơi nào đọc. |
| `margin_pct` | `margin_pct` | numeric | có | 0 |  | Margin percent = (unit_price - dealer_price) / unit_price * 100 | **D - dẫn xuất chỉ ghi**: Không nơi nào đọc. |
| `profit_amount` | `loi_nhuan_vnd` | numeric | có | 0 |  | Profit in VND = (unit_price - dealer_price) * quantity (can be negative) | **D - dẫn xuất chỉ ghi**: Không nơi nào đọc. |
| `status` | `trang_thai` | text | có |  |  | Free-text status of the line (currently always empty) |  |
| `note` | `ghi_chu` | text | có |  |  | Free-text note |  |
| `sort_order` | `sort_no` | numeric | có | 0 |  | Sort position of the line inside the project (app field stt) |  |
| `created_at` | `created_at` | timestamp with time zone | có | now() |  | Creation time |  |
| `group_code` | `nhom` | text | có |  |  | Takeoff tree node of the line: cover-sheet item code such as '3.2.6.1' or a user-defined group name |  |
| `category` | `loai` | text | có |  |  | Product category / work item of the line, copied from the product's hang_muc (e.g. 'Thiết bị đèn', 'Thiết bị vệ sinh', 'Sơn nước') |  |
| `floor` | `tang` | text | có |  |  | Floor / room section the line is placed under (e.g. 'TẦNG 1', 'WC MASTER') | **Tham chiếu theo tên**: Phải khớp 1 phần tử của projects.custom_floors. |
| `supplier_name` | `nha_cung_cap` | text | có |  |  | Supplier name (snapshot) | **B - snapshot** |
| `description` | `mo_ta` | text | có |  |  | Product description / technical info (snapshot) | **B - snapshot**: Văn bản ghép từ thông số SP. |
| `size` | `kich_thuoc` | text | có |  |  | Dimensions / specification text (snapshot) | **B - snapshot** |
| `image_urls` | `hinh_anh` | text | có |  |  | Product image URLs (snapshot); one or several URLs separated by newlines | **B - snapshot**: Chỉ ảnh đầu của SP. |
| `retail_price` | `gia_ban_le` | numeric | có |  | CHECK | Supplier list / retail price per unit before dealer discount (app field donGiaVon) | **B - snapshot (giá gốc)**: API gọi là donGiaVon. |
| `dealer_discount_pct` | `ck_dai_ly_pct` | numeric | có |  | CHECK | Dealer discount percent received from the supplier | **B - snapshot** |
| `is_manual_entry` | `tu_nhap` | bigint | có |  | CHECK | 1 = line typed in manually (not picked from the catalog), 0 otherwise | **D - chết**: Luôn 0; client không đọc/ghi. |
| `is_saved_to_catalog` | `da_luu_dm` | bigint | có |  | CHECK | 1 = manual line already saved into the product catalog, 0 otherwise | **D - chết**: Luôn 0; client không đọc/ghi. |
| `extra` | `extra` | jsonb | có |  |  | Extra per-line attributes as JSON object (keys seen: nganh = trade, dxGiam) | **JSON**: Khoá: nganh, sheet (nc\|vt), dxGiam. |
| `supplier_discount_pct` | `giam_gia_ncc_pct` | numeric | có |  | CHECK | Extra discount percent from the supplier at purchase time |  |
| `company_id` | `cong_ty_id` | uuid | có |  | FK | Owning company (tenant); NULL on 165 legacy rows |  |

## `cost_estimate_lines` (`khai_toan`)

Tờ bìa / khái toán của dự án; mỗi lần lưu là thay toàn bộ. 104 dòng.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Surrogate primary key |  |
| `project_code` | `ma_da` | text | có |  | FK, CHECK | Code of the project this cover-sheet row belongs to (projects.project_code) |  |
| `item_no` | `stt` | text | có |  |  | Hierarchical item number of the cover-sheet row (e.g. '3.2.1'); matches takeoff group codes | **Mã phân cấp**: Chuỗi chấm '3.2.6'; cha/con xác định bằng tiền tố; trùng với mã cây bóc tách. |
| `item_name` | `hang_muc` | text | có |  |  | Work item / cost category name |  |
| `description` | `mo_ta` | text | có |  |  | Description of what the item covers |  |
| `cost` | `chi_phi` | numeric | có | 0 | CHECK | Estimated cost of the item in VND | **C - lai**: Dòng lá: tổng sống từ quotation_lines trừ khi bị đánh dấu nhập tay (bgCfg.tay); giá trị lưu chỉ được làm mới lúc xuất Excel. |
| `sort_order` | `sort_no` | numeric | có | 0 | CHECK | Row position on the cover sheet (0-based array index) |  |
| `company_id` | `cong_ty_id` | uuid | có |  | FK | Owning company (tenant) |  |

## `work_items` (`cong_tac`)

Thư viện công tác / đơn giá phần thô theo công ty. 217 dòng.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | uuid | không | gen_random_uuid() | PK | Primary key |  |
| `company_id` | `cong_ty_id` | uuid | có |  | FK | Owning company (tenant) |  |
| `quotation_type` | `loai` | text | không | 'kt_chitiet'::text | CHECK | Quotation library the work item belongs to: kt_chitiet (detailed estimate), kt_sobo (preliminary estimate), dt_nhancong (labour budget), dt_vattu (material budget) |  |
| `calculation_mode` | `che_do` | text | không | 'item'::text | CHECK | How the line is computed: item (direct quantity x price), area (quantity = area x coefficient), area0 (quantity = area x coefficient but not included in the quote, amount 0), none (listed only, not included) |  |
| `group_code` | `ma_nhom` | text | có |  |  | Group number, normally Roman numerals (I, II, III...) |  |
| `category` | `hang_muc` | text | không | ''::text |  | Work category / section heading the item is listed under |  |
| `name` | `ten` | text | không | ''::text | CHECK | Work item name |  |
| `unit` | `dvt` | text | có |  |  | Unit of measure |  |
| `quantity` | `khoi_luong` | numeric | có |  | CHECK | Default work quantity (volume) for item mode |  |
| `area` | `dien_tich` | numeric | có |  | CHECK | Default area for area modes |  |
| `coefficient` | `he_so` | numeric | có |  | CHECK | Multiplier applied to the area (quantity = area x coefficient) |  |
| `contractor_unit_price` | `don_gia_nha_thau` | numeric | có |  | CHECK | Contractor (cost) unit price |  |
| `unit_price` | `don_gia` | numeric | có |  | CHECK | Selling unit price |  |
| `note` | `ghi_chu` | text | có |  |  | Note / material description |  |
| `image_urls` | `hinh_anh` | text | có |  |  | Image URLs, one per line (several images allowed) |  |
| `specifications` | `thong_so` | text | có |  |  | Technical specifications |  |
| `scope` | `pham_vi` | text | có |  |  | Scope of work |  |
| `document_url` | `link_tai_lieu` | text | có |  |  | Link to reference documents |  |
| `is_approved` | `da_duyet` | boolean | không | false |  | Whether the work item is approved; reset to false on every edit |  |
| `approved_by` | `nguoi_duyet` | text | có |  |  | Username of the approver (cleared when approval is revoked or the item is edited) |  |
| `approved_at` | `ngay_duyet` | timestamp with time zone | có |  |  | When the item was approved |  |
| `created_by` | `nguoi_tao` | text | có |  |  | Username of the creator |  |
| `created_at` | `ngay_tao` | timestamp with time zone | không | now() |  | Creation time |  |
| `updated_by` | `nguoi_sua` | text | có |  |  | Username of the last editor |  |
| `updated_at` | `ngay_cap_nhat` | timestamp with time zone | có |  |  | Last update time |  |
| `sort_order` | `thu_tu` | integer | không | 0 | CHECK | Display order within the quotation type | **Chết thực tế**: Client không bao giờ gửi; luôn 0. |
| `supplier_name` | `nha_cung_cap` | text | có |  |  | Contractor / supplier name |  |
| `is_favorite` | `yeu_thich` | boolean | không | false |  | Marked as favourite for the company | **Theo công ty**: Không theo user. |
| `takeoff_section` | `de_muc` | text | có |  |  | Pinned take-off section code: empty = auto-detect from the category name, '0' = rough-work section (3.1) only, e.g. '3.2.2' = also shown under that section |  |

## `work_item_histories` (`cong_tac_history`)

Lịch sử thay đổi công tác (chỉ thêm). 1 dòng.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Surrogate primary key |  |
| `work_item_id` | `cong_tac_id` | uuid | không |  |  | Work item the change belongs to (work_items.id); intentionally not a foreign key because a 'deleted' entry is written after the work item is removed |  |
| `field` | `field` | text | có |  |  | Human-readable (Vietnamese) label of the changed field or event, e.g. 'GHI CHÚ', 'TẠO CÔNG TÁC', 'XOÁ CÔNG TÁC' |  |
| `old_value` | `old_value` | text | có |  |  | Value before the change |  |
| `new_value` | `new_value` | text | có |  |  | Value after the change |  |
| `changed_by_id` | `changed_by` | uuid | có |  | FK | User who made the change (users.id) |  |
| `changed_by_name` | `changed_by_name` | text | có |  |  | Username snapshot of who made the change |  |
| `changed_at` | `changed_at` | timestamp with time zone | có | now() |  | When the change was made (default now()) |  |
| `company_id` | `cong_ty_id` | uuid | có |  | FK | Owning company (tenant) |  |

## `purchase_orders` (`don_mua_hang`)

Yêu cầu / đơn mua hàng gửi theo nhà cung cấp. 65 dòng.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Surrogate primary key |  |
| `order_code` | `ma_don` | text | có |  | UNIQUE, CHECK | Generated purchase order code (MH-...), unique; natural key referenced by order items | **Khoá nghiệp vụ**: MH-<base36>-<rand>; duy nhất toàn hệ thống; dùng trong thông báo, Lark. |
| `project_code` | `ma_du_an` | text | có |  |  | Code of the project draft the order was raised from (projects.project_code); kept after the project is deleted | **Tham chiếu mềm**: Đơn SỐNG SÓT sau khi dự án bị xoá (55/65 dòng). |
| `project_name` | `ten_du_an` | text | có |  |  | Project name snapshot at send time | **B - snapshot** |
| `category` | `hang_muc` | text | có |  |  | Name of the take-off category (node) the order was raised from, e.g. lighting equipment |  |
| `supplier_name` | `nha_cung_cap` | text | có |  |  | Supplier name (one order per supplier) |  |
| `product_count` | `so_sp` | integer | có | 0 | CHECK | Number of product lines in the order | **C - tổng lưu sẵn** |
| `subtotal_before_vat` | `tong_truoc_vat` | numeric | có | 0 | CHECK | Order total before VAT | **C - tổng lưu sẵn**: Tính lúc tạo, không bao giờ tính lại; khớp 100% chi tiết. |
| `vat_pct` | `vat_pct` | numeric | có | 0 | CHECK | VAT rate in percent |  |
| `vat_amount` | `vat` | numeric | có | 0 | CHECK | VAT amount | **C - tổng lưu sẵn** |
| `total_amount` | `tong_cong` | numeric | có | 0 | CHECK | Grand total = subtotal_before_vat + vat_amount | **C - tổng lưu sẵn**: Client tính, server không kiểm. |
| `status` | `trang_thai` | text | có | 'Đã gửi'::text | CHECK | Workflow status: Chờ duyệt (pending) -> Đã duyệt (approved) / Từ chối (rejected) -> Đã đặt hàng (ordered) -> Đã nhận hàng (received); 'Đã gửi' (sent) is the legacy column default |  |
| `send_channel` | `kenh_gui` | text | có | 'Lark'::text |  | Channel the request was sent through (Lark) | **Chỉ ghi**: Luôn 'Lark'. |
| `send_result` | `ket_qua_gui` | text | có |  |  | Result of sending to the channel (ok / pending) | **Chỉ ghi**: lưu đơn ghi 'pending' (hoặc `ketQua` client gửi); sau khi gửi thẻ Lark, server Go ghi bằng lệnh riêng 'ok' (đã gửi) / 'loi' (gửi lỗi) - M9.1. GIẢ ĐỊNH M9.1: các dòng 'ok' tạo trước bản này là giá trị mặc định lúc lưu (`strOr(ketQua,'ok')` cũ), không phải xác nhận đã tới Lark. Chú thích cột (COMMENT) đổi ở migration 0013 (nhắc cả 'loi'). |
| `sender_name` | `nguoi_gui` | text | có |  |  | Free-text name of the person who sent the order | **Gõ tay**: Không lấy từ tài khoản. |
| `department` | `phong_ban` | text | có |  |  | Sender's department |  |
| `note` | `ghi_chu` | text | có |  |  | Note |  |
| `sent_at` | `ngay_gui` | timestamp with time zone | có | now() |  | When the order was sent / created (default now()) |  |
| `requester_id` | `requester_id` | uuid | có |  |  | User who requested the order (users.id); notified on approval or rejection |  |
| `company_id` | `cong_ty_id` | uuid | có |  | FK | Owning company (tenant) |  |
| `resolver_name` | `nguoi_duyet` | text | có |  |  | Snapshot of the name of the admin who approved or rejected the order; NULL = not resolved yet, or resolved before migration 0009 | **Chỉ bản Go**, migration 0009 (M15.1); ghi bằng lệnh riêng sau khi đổi trạng thái. |
| `resolved_at` | `ngay_duyet` | timestamp with time zone | có |  |  | When the order was approved or rejected; NULL = not resolved yet, or resolved before migration 0009 | **Chỉ bản Go**, migration 0009 (M15.1). |

## `purchase_order_items` (`chi_tiet_mua_hang`)

Dòng hàng của đơn mua (bản chụp, không bao giờ sửa). 160 dòng.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Surrogate primary key |  |
| `order_code` | `ma_don` | text | có |  | FK | Parent purchase order code (purchase_orders.order_code) |  |
| `product_code` | `ma_sp` | text | có |  |  | Product code snapshot at send time (may be empty or no longer exist in products) | **B - snapshot**: 113/154 mã không còn trong danh mục. |
| `product_name` | `ten_sp` | text | có |  |  | Product name snapshot |  |
| `brand` | `thuong_hieu` | text | có |  |  | Brand snapshot |  |
| `room` | `phong` | text | có |  |  | Room(s) / location(s) in the project the product is for, comma-separated when merged from several lines | **Đa trị**: Danh sách vị trí nối bằng dấu phẩy. |
| `unit` | `dvt` | text | có |  |  | Unit of measure (app falls back to 'Cái') |  |
| `quantity` | `so_luong` | numeric | có | 0 | CHECK | Ordered quantity |  |
| `unit_price` | `don_gia` | numeric | có | 0 | CHECK | Purchase unit price |  |
| `amount` | `thanh_tien` | numeric | có | 0 | CHECK | Line amount = quantity * unit_price |  |
| `image_urls` | `hinh_anh` | text | có |  |  | Product image URL snapshot (first image only) |  |
| `sort_order` | `sort_no` | integer | có | 0 | CHECK | Zero-based position of the line within the order |  |
| `company_id` | `cong_ty_id` | uuid | có |  | FK | Owning company (tenant) |  |

## `purchase_proposals` (`de_xuat`)

Phiếu đề xuất: ck = xin chiết khấu NCC, tt = đề xuất thanh toán theo đợt. 2 dòng.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Surrogate primary key |  |
| `proposal_code` | `ma_de_xuat` | text | không |  | UNIQUE, CHECK | Generated proposal code (CK-... discount, TT-... payment), unique |  |
| `proposal_type` | `loai` | text | không | 'ck'::text | CHECK | Proposal type: 'ck' = discount proposal to supplier, 'tt' = instalment payment proposal |  |
| `project_code` | `ma_du_an` | text | có |  |  | Code of the project draft the proposal belongs to (projects.project_code) |  |
| `project_name` | `ten_du_an` | text | có |  |  | Project name snapshot |  |
| `category` | `hang_muc` | text | có |  |  | Name of the take-off category (node) the proposal was raised from |  |
| `supplier_name` | `nha_cung_cap` | text | có |  |  | Supplier name |  |
| `line_count` | `so_dong` | integer | có | 0 | CHECK | Number of detail lines (products for 'ck', instalments for 'tt') |  |
| `original_total` | `tong_goc` | numeric | có | 0 | CHECK | Value before the proposal is applied | **C - đa nghĩa**: ck: trước VAT; tt: đã gồm VAT. |
| `proposed_total` | `tong_de_xuat` | numeric | có | 0 | CHECK | Value after the proposal is applied, before VAT ('tt': sum of instalments) |  |
| `discount_amount` | `tien_giam` | numeric | có | 0 | CHECK | Amount saved = max(0, original_total - proposed_total) | **C - đa nghĩa**: tt: phần chưa phân bổ, không phải giảm giá. |
| `vat_pct` | `vat_pct` | numeric | có | 0 | CHECK | VAT rate in percent |  |
| `vat_amount` | `vat` | numeric | có | 0 | CHECK | VAT amount (0 for payment proposals) |  |
| `total_amount` | `tong_cong` | numeric | có | 0 | CHECK | Grand total = proposed_total + vat_amount |  |
| `status` | `trang_thai` | text | có | 'Chờ duyệt'::text | CHECK | Approval status: Chờ duyệt (pending), Đã duyệt (approved), Từ chối (rejected) |  |
| `sender_name` | `nguoi_gui` | text | có |  |  | Free-text name of the person who sent the proposal |  |
| `department` | `phong_ban` | text | có |  |  | Sender's department |  |
| `note` | `ghi_chu` | text | có |  |  | Note |  |
| `resolver_name` | `nguoi_duyet` | text | có |  |  | Display name of the admin who resolved the proposal; written on approval AND on rejection (de-xuat.service.js:44-45) | **Tên chép**: Không phải id người duyệt. |
| `resolved_at` | `ngay_duyet` | timestamp with time zone | có |  |  | When the proposal was approved or rejected |  |
| `requester_id` | `requester_id` | uuid | có |  | FK | User who submitted the proposal (users.id); notified of the decision |  |
| `company_id` | `cong_ty_id` | uuid | có |  | FK | Owning company (tenant) |  |
| `sent_at` | `ngay_gui` | timestamp with time zone | có | now() |  | When the proposal was sent / created (default now()) |  |

## `purchase_proposal_items` (`chi_tiet_de_xuat`)

Dòng của phiếu đề xuất — ĐA HÌNH: dòng sản phẩm (ck) hoặc đợt thanh toán (tt). 0 dòng.

| Cột | Tên trong code | Kiểu | NULL | Mặc định | Ràng buộc | Ý nghĩa | Phân loại / ghi chú |
|---|---|---|---|---|---|---|---|
| `id` | `id` | bigint | không |  | PK | Surrogate primary key |  |
| `proposal_code` | `ma_de_xuat` | text | không |  | FK | Parent proposal code (purchase_proposals.proposal_code) |  |
| `sort_order` | `sort_no` | integer | có | 0 | CHECK | Zero-based position of the line within the proposal |  |
| `product_code` | `ma_sp` | text | có |  |  | Product code snapshot ('ck' lines only) |  |
| `product_name` | `ten_sp` | text | có |  |  | Product name for 'ck' lines; instalment label ('Đợt n') for 'tt' lines | **Đa nghĩa**: tt: nhãn 'Đợt N'. |
| `brand` | `thuong_hieu` | text | có |  |  | Brand snapshot ('ck' lines) |  |
| `room` | `phong` | text | có |  |  | Room(s) / location(s) in the project the product is for ('ck' lines) |  |
| `unit` | `dvt` | text | có |  |  | Unit of measure ('ck' lines) |  |
| `quantity` | `so_luong` | numeric | có | 0 | CHECK | Quantity ('ck' lines) |  |
| `original_unit_price` | `don_gia_goc` | numeric | có | 0 | CHECK | Unit price before the proposed discount |  |
| `rate_pct` | `ty_le_pct` | numeric | có | 0 |  | 'ck': proposed discount percent; 'tt': percent of the total paid in this instalment | **Đa nghĩa**: ck: % chiết khấu; tt: % đợt thanh toán. |
| `unit_price` | `don_gia` | numeric | có | 0 | CHECK | Unit price after the proposed discount |  |
| `amount` | `thanh_tien` | numeric | có | 0 | CHECK | 'ck': quantity * unit_price; 'tt': instalment amount | **Đa nghĩa** |
| `expected_payment_date` | `ngay_du_kien` | date | có |  |  | Expected payment date of the instalment ('tt' lines only) |  |
| `note` | `ghi_chu` | text | có |  |  | Note (instalment note for 'tt' lines) |  |
| `image_urls` | `hinh_anh` | text | có |  |  | Product image URL snapshot (first image only) |  |
| `company_id` | `cong_ty_id` | uuid | có |  | FK | Owning company (tenant) |  |

## Cấu trúc JSON trong `project_data_entries.data_value`

Khoá hợp lệ do server kiểm (`PROJ_DATA_KEYS`, store_supa.js:1117). Mỗi lần ghi thay toàn bộ giá trị. Số dòng thực tế ngày 2026-10-12 trong ngoặc.

| Khoá | Phạm vi | Kiểu | Cấu trúc | Quan hệ ngầm |
|---|---|---|---|---|
| `phanTho` (5) | dự án | mảng | Mục `{t, mode, loai, note, up, items[]}`; item theo mode: `{n, dvt, kl, dg, gc, dgnt}` / `{n, dvt, dt, hs, gc}` / `{n, dvt, gc}` | Bản sao công tác, KHÔNG có id; khớp lại thư viện bằng tên |
| `ptVat` (6) | dự án | số | % VAT phần thô | Trùng `projects.vat_pct` (đồng bộ 2 chiều) |
| `area` (0) | dự án | object | 9 khoá cố định, mỗi khoá `{count, dai, rong}` | Nguồn của `projects.total_area / quoted_area` khi bấm áp dụng |
| `bgCfg` (2) | dự án | object | `ck, ckKieu, ngay, hieuLuc, dot[[text,pct]], ghiChu, tay{stt:1}, an{stt:1}, mau, noiBo` | `tay`, `an` tham chiếu `cost_estimate_lines.item_no`; `dot` là lịch thanh toán |
| `bgHist` (5) | dự án | mảng (tối đa 20) | Phiên bản báo giá `{ver, ma, at, by, lyDo, tong, sub, n, key, snap}`; `snap` chứa bản sao dòng, tờ bìa, phần thô | Lịch sử phiên bản; 1 giá trị tới ~200 KB |
| `cpCfg` (2) | dự án | object | `{minBien, bienMT}` | Không |
| `mhPay` (1) | dự án | object | Khoá = TÊN nhà cung cấp, giá trị = mảng đợt `{pct, tien, ngay, gc, tay?}` | Lịch thanh toán theo NCC (khoá là chuỗi tự do) |
| `btFmt` (2) | dự án | object | `{<rowKey>: {<cột>: {b,i,u,wrap,c,bg,al}}}` | `rowKey` = `quotation_lines.id` hoặc vị trí `pt:<mục>:<dòng>` |
| `ptInfo` (0) | CÔNG TY (`__cty:<id>`) | object | Khoá = tên công tác viết thường; `{model, anh, ts, gc, pv, tl}` | Chồng lấn với cột của `work_items` |
| `bgOrg` (0) | CÔNG TY | object | `{ten, logo, diaChi, sdt, email, web, xuong}` | Hồ sơ công ty in trên báo giá |

`users.ui_preferences`: khoá cho phép `tkCols, cpCols, daCols, spCols` (auth.js:270-279); dữ liệu thực có thêm khoá cũ `tkColSets`.

