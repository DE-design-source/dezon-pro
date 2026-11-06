# Naming Conventions - QS Pro

> Quy ước đặt tên ĐANG DÙNG trong repo. Code mới theo đúng, không đổi tên hàng loạt cái cũ.
> Hệ thống: `backend/` (Go + Gin) và `frontend/` (React + Vite). Không có hàng đợi / message broker
> (chat dùng gateway WebSocket một tiến trình); Redis chỉ tuỳ chọn (`REDIS_URL`, rate limit) - không áp quy ước của các thứ đó.

## Ngôn ngữ

- Tên nghiệp vụ TRONG CODE (tên bảng / cột truyền cho `*database.DB`, khoá object trả về của hàm chuyển từ bản cũ) là
  **tiếng Việt không dấu**; chú thích và chuỗi hiển thị là tiếng Việt có dấu. Giữ nguyên, không dịch sang tiếng Anh.
- Tên gói, kiểu, file Go và route REST `/api/v1` là **tiếng Anh**.
- Tên bảng / cột TRONG DATABASE PostgreSQL là **tiếng Anh**; `backend/internal/platform/database/db-map.json` ánh xạ hai chiều,
  gói `database` tự dịch khi đọc/ghi. Quy tắc database: `docs/02-ky-thuat/database/database-rules.md`.

## Cơ sở dữ liệu (PostgreSQL)

Cột "Code" là tên dùng trong code (khoá của `db-map.json`); cột "Database" là tên thật trong PostgreSQL.

| Thứ | Code | Database | Ví dụ (code -> database) |
|---|---|---|---|
| Bảng | `snake_case`, tiếng Việt không dấu, **số ít**; bảng của module mới có tiền tố module | `snake_case`, tiếng Anh, **số nhiều**, tiền tố module nếu có | `du_an` -> `projects`, `db_san_pham` -> `products`, `hr_dinh_phi` -> `hr_unit_budgets`, `kd_khach_hang` -> `sales_leads` |
| Bảng lịch sử | `<bảng>_history` | `<bảng số ít>_histories` | `db_san_pham_history` -> `product_histories`, `cong_tac_history` -> `work_item_histories` |
| Cột | `snake_case` | `snake_case`, tiếng Anh | `ma_du_an` -> `project_code`, `ten_sp` -> `product_name`, `gia_ban_le` -> `retail_price` |
| Khoá công ty | luôn là `cong_ty_id` | luôn là `company_id` | - |
| Phần trăm / thời điểm | hậu tố `_pct` / `created_at`, `changed_at` | `_pct` / `_at`; ngày `_date`; boolean `is_` / `has_` | `loi_nhuan_pct` -> `profit_pct`, `ck_dai_ly_pct` -> `dealer_discount_pct` |
| Index | - | `idx_<bảng>_<cột>[_<cột>...]` | `idx_proposal_discount_items_proposal_code_sort_order` |
| Ràng buộc | - | `pk_` / `fk_` / `uq_` / `ck_` + `<bảng>_<cột>` | `pk_company_settings`, `uq_company_settings_company_id_setting_key`, `ck_products_dealer_price` |
| File migration | - | `infra/db/migrations/<NNNN>_<snake_case>.sql`, số tăng dần | `0002_company_settings.sql`, `0007_proposal_items_split.sql` |

Bảng / cột mới: thêm vào `backend/internal/platform/database/db-map.json` (bản duy nhất) cùng lúc với migration.
Cột thông số theo ngành khai báo trong `backend/internal/shared/specs/js/{vs,son,ct,dl}-spec.js`; nhãn trùng
giữa các spec phải trỏ cùng một cột.

## Server Go (`backend/`)

| Thứ | Quy ước | Ví dụ |
|---|---|---|
| Gói module | tên thư mục = tên gói, chữ thường một từ, tiếng Anh, trong `internal/modules/` | `takeoff`, `materials`, `purchasing`, `quotations` |
| Gói tiện ích test | `<gói>test` | `users/userstest` |
| File | chữ thường, nhiều từ nối `_`; tách nghiệp vụ dài thành `service_<việc>.go` | `handler.go`, `service_export.go`, `service_delete_requests.go`, `rate_limit.go` |
| File test | `<file>_test.go`; test cần database thường đặt hậu tố `_db_test.go` | `service_test.go`, `service_db_test.go`, `tx_db_test.go` |
| Kiểu chính của module | `Service`, `Deps`, interface `Repository`; bản cài repository không xuất | `type Service struct`, `type Deps struct`, `type pgRepo struct` |
| Hàm dựng | `New(d Deps) *Service`, `NewRepository(db *database.DB) Repository` | `takeoff.New(takeoff.Deps{...})` |
| Phương thức nghiệp vụ | PascalCase; hàm chuyển từ bản cũ giữ tên cũ viết hoa chữ đầu | `getLines` -> `GetLines`, `updateLine` -> `UpdateLine` |
| Cửa ngõ kiểm quyền | hậu tố `Gated`, nhận `*actor.Actor` | `UpdateProductGated`, `CtSaveGated`, `SaveLineAsProductGated` |
| Hàm nội bộ / helper | camelCase không xuất, không hậu tố `_` | `calc` (từ `calc_`), `lineToObj` |
| Interface gọi chéo (`internal/shared/contracts`) | danh từ đuôi `-er` / `-or` theo việc | `Auditor`, `UserReader`, `Notifier`, `ProductSaver`, `LineReader` |
| Tên hàm rpc (`reg.Register`, đóng băng) | camelCase, duy nhất; hàm quản lý user có tiền tố `admin` | `getProjects`, `ctSave`, `adminCreateUser`, `adminSetActive` |
| Tên route chỉ bản Go (`GoRoute.Name`) | camelCase, duy nhất, thường có tiền tố module | `hrSaveOrg`, `hrAttendance`, `mauNhapDienLanh`, `nhacGiaHan` |
| Quyền | `rpc.Login` / `rpc.Public` / `rpc.Admin` / `rpc.Super` / `rpc.Admin\|rpc.Super` / `rpc.SelfAuth`; REST: `middleware.RequireLogin()` / `RequireAdmin()` / `RequireSuper()` / `RequireAdminSuper()` | - |
| Khoá object trả về client | camelCase; hàm chuyển từ bản cũ giữ khoá tiếng Việt, module chỉ bản Go (hr, sales, delivery) dùng tiếng Anh | `donGiaVon`, `maDA`, `thanhTienBan`; `startDate`, `valueVnd` |
| Import gói lỗi | bí danh `apperr` | `apperr "qspro-backend/internal/shared/errors"` |
| Biến môi trường | `UPPER_SNAKE_CASE`, khai ở `internal/config/config.go` + `backend/.env.example` | `AUTH_SECRET`, `REPORT_WEBHOOK`, `UPLOAD_DIR`, `CORS_ORIGINS` |

## Client React (`frontend/src/`)

| Thứ | Quy ước | Ví dụ |
|---|---|---|
| Thư mục trang | PascalCase tiếng Việt không dấu, trong `pages/`; file chính cùng tên | `pages/KinhDoanh/KinhDoanh.jsx`, `pages/ChamCong/ChamCong.jsx`, `pages/QS/QS.jsx` |
| Component | PascalCase, đuôi `.jsx`, 1 component chính / file; tab có hậu tố `Tab` | `BreakdownTab.jsx`, `CostTab.jsx`, `SheetGrid.jsx`, `ConfirmDialog.jsx` |
| Module JS không phải component | camelCase, đuôi `.js` | `catalogModel.js`, `bocActions.js`, `qsApi.js`, `navigation.js` |
| Hook | `use<Tên>`, file cùng tên | `useLocalStorage.js`, `useSpecs.js`, `useLinesSheet.js` |
| Context | `<Tên>Context.jsx` | `context/ThemeContext.jsx` |
| File gọi API | `api.js` trong thư mục trang, hoặc `api/<tên>Api.js` | `pages/KinhDoanh/api.js`, `pages/QS/api/qsApi.js`, `pages/Chat/api/chatApi.js` |
| Dịch vụ trình duyệt dùng chung | `services/<tên>Service.js` | `storageService.js`, `kdRequestService.js` |
| Dữ liệu mẫu | `data/<trang>Data.js` (camelCase) | `kinhDoanhData.js`, `qsData.js` |
| CSS | cạnh component: cùng tên component (`<Trang>.css`) hoặc tên thư mục chữ thường | `QS.css`, `DatePicker.css`, `breakdown/sheet/sheet.css` |
| Hàm thuần chuyển từ giao diện cũ (`pages/QS/lib/`) | giữ tên cũ, kể cả hậu tố `_` | `tkNum_`, `safeUrl_`, `recalcLine_`, `giaDaiLy_`, `donGiaCK_` |
| Hàm mới | camelCase, không hậu tố `_` | `selectProject`, `nodeName`, `fmtDate` |
| Hằng toàn cục của module | `UPPER_SNAKE_CASE` | `TREE`, `DEFAULT_NODE`, `PERM_TABS`, `API_BASE` |
| Biến môi trường Vite | `VITE_<TÊN>` | `VITE_API_URL` |

## Đường dẫn

- REST: `/api/v1/<tài-nguyên>` - tiếng Anh, số nhiều, kebab-case (`/projects/:id/lines`, `/lines/save-as-product`,
  `/companies/expiry-reminders`, `/product-templates/dien-lanh`); module mới đặt dưới tiền tố của mình (`/hr/...`, `/chat/...`).
- Cổng cũ `POST /api/<tênHàm>` và 9 route lẻ ở gốc (kebab-case tiếng Việt không dấu: `/export/san-pham`, `/export/cong-tac`,
  `/export/bang`, `/upload/file`, `/media`, `/healthz`, `/mau-nhap-<ngành>.xlsx`) đã đóng băng - không thêm.
- Route giao diện React (`App.jsx`): kebab-case tiếng Việt không dấu (`/kinh-doanh`, `/quan-ly-thiet-ke`, `/cham-cong`, `/cai-dat`).

## Tài liệu

- File trong `docs/`: kebab-case không dấu (xem [docs-placement.md](../docs/docs-placement.md)).
- Quy trình nghiệp vụ: `docs/03-san-pham/flows/QT-<nn>-<slug>.md`.
- Tài liệu riêng của backend: `backend/docs/<TÊN>.md` chữ hoa (`API.md`, `ARCHITECTURE.md`, `DATABASE.md`).
