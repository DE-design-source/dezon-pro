# Naming Conventions - QS Pro

> Quy ước đặt tên ĐANG DÙNG trong repo. Code mới theo đúng, không đổi tên hàng loạt cái cũ.
> Hệ thống: `backend/` (Go + Gin) và `frontend/` (React + Vite). Không có hàng đợi / message broker
> (chat dùng gateway WebSocket một tiến trình); Redis chỉ tuỳ chọn (`REDIS_URL`, rate limit) - không áp quy ước của các thứ đó.

## Ngôn ngữ

- Tên nghiệp vụ TRONG CODE (tên bảng / cột truyền cho `database.DB` - `Select` / `Insert` / `Update` / `Remove`, nhiều hàm)
  là **tiếng Việt không dấu**; chú thích và chuỗi hiển thị là tiếng Việt có dấu. Giữ nguyên, không dịch sang tiếng Anh.
- Tên bảng / cột TRONG DATABASE PostgreSQL là **tiếng Anh** (từ 2026-10-07); `backend/internal/platform/database/db-map.json`
  ánh xạ hai chiều, tầng `backend/internal/platform/database` tự dịch khi đọc/ghi. Quy tắc database: `docs/02-ky-thuat/database/database-rules.md`.

## Cơ sở dữ liệu (PostgreSQL)

Cột "Code" là tên dùng trong code (khoá của `db-map.json`); cột "Database" là tên thật trong PostgreSQL.

| Thứ | Code | Database | Ví dụ (code -> database) |
|---|---|---|---|
| Bảng | `snake_case`, tiếng Việt không dấu, **số ít** | `snake_case`, tiếng Anh, **số nhiều** | `du_an` -> `projects`, `db_san_pham` -> `products` |
| Bảng lịch sử | `<bảng>_history` | `<bảng số ít>_histories` | `db_san_pham_history` -> `product_histories`, `cong_tac_history` -> `work_item_histories` |
| Cột | `snake_case` | `snake_case`, tiếng Anh | `ma_du_an` -> `project_code`, `ten_sp` -> `product_name`, `gia_ban_le` -> `retail_price` |
| Khoá công ty | luôn là `cong_ty_id` | luôn là `company_id` | - |
| Phần trăm / thời điểm | hậu tố `_pct` / `created_at`, `changed_at` | `_pct` / `_at`; ngày `_date`; boolean `is_` / `has_` | `loi_nhuan_pct` -> `profit_pct`, `ck_dai_ly_pct` -> `dealer_discount_pct` |
| Index | - | `idx_<bảng>_<cột>[_<cột>...]` | `idx_proposal_discount_items_proposal_code_sort_order` |
| Ràng buộc | - | `pk_` / `fk_` / `uq_` / `ck_` + `<bảng>_<cột>` | `pk_company_settings`, `uq_company_settings_company_id_setting_key`, `ck_products_dealer_price` |
| File migration | - | `infra/db/migrations/<NNNN>_<snake_case>.sql`, số tăng dần | `0002_company_settings.sql`, `0007_proposal_items_split.sql` |

Bảng / cột mới: thêm vào `backend/internal/platform/database/db-map.json` (bản duy nhất) cùng lúc với migration;
bảng theo công ty thêm vào `TenantTables` trong `backend/internal/platform/database/postgres.go`.
Cột thông số theo ngành khai báo trong `backend/internal/shared/specs/js/*-spec.js` (`vs-spec.js`, `son-spec.js`, `ct-spec.js`,
`dl-spec.js`), sửa xong chạy `node backend/scripts/gen-specs.js`; nhãn trùng giữa các spec phải trỏ cùng một cột.

## Backend (`backend/`, Go)

| Thứ | Quy ước | Ví dụ |
|---|---|---|
| Module Go | `qspro-backend` | `qspro-backend/internal/modules/takeoff` |
| Gói module nghiệp vụ | `internal/modules/<tên>`: chữ thường, một từ, tiếng Anh | `auth`, `projects`, `takeoff`, `materials`, `purchasing`, `quotations`, `hr`, `chat` |
| File trong module | theo vai trò (`backend/docs/ARCHITECTURE.md` mục 4); tách nhỏ bằng tiền tố `service_` | `service.go`, `repository.go`, `postgres.go`, `model.go`, `dto.go`, `handler.go`, `service_test.go`, `service_edit_requests.go` |
| Hàm `/api/:fn` (rpc) | `camelCase`, khai bằng `reg.Register(tên, quyền, handler)`, **duy nhất**; quyền `rpc.Login` / `Public` / `Admin` / `Super`. Đóng băng 80 hàm, KHÔNG thêm mới | `getProjects`, `ctSave`, `adminCreateUser`, `sendDeXuat` |
| Route chỉ bản Go | `GoRoute.Name` `camelCase`, duy nhất (không trùng tên hàm rpc); khai bằng `reg.RegisterGoRoute` (`backend/docs/API.md` mục 2.1) | `hrLoad`, `hrCreateEmployee`, `copySharedProduct`, `mauNhapDienLanh` |
| Phương thức service công khai | tên hàm rpc viết PascalCase | `getProjects` -> `GetProjects`, `getLines` -> `GetLines` |
| Cửa ngõ kiểm quyền | hậu tố `Gated` trên phương thức service | `SaveLineAsProductGated`, `SetSpDuyetGated` |
| Hàm / phương thức nội bộ | camelCase chữ đầu thường (không còn hậu tố `_`: `calc_` -> `calc`) | `tx`, `copyChildren`, `readAddLineBody` |
| Interface gọi chéo module | khai một lần trong `internal/shared/contracts`, tên danh từ tác nhân | `Notifier`, `Auditor`, `UserReader`, `PurchaseNotifier` |
| Object trả về client | khoá `camelCase` (đổi từ cột `snake_case`), thứ tự khoá qua `omap.Of(...)` / struct tag `json` | `donGiaVon`, `maDA`, `thanhTienBan` |
| Biến môi trường | `UPPER_SNAKE_CASE`, đọc trong `internal/config` | `AUTH_SECRET`, `REPORT_WEBHOOK`, `UPLOAD_DIR`, `REDIS_URL` |

## Frontend (`frontend/src`, React)

| Thứ | Quy ước | Ví dụ |
|---|---|---|
| Trang | thư mục `pages/<Tên>/` PascalCase, file `<Tên>.jsx` + `<Tên>.css` cùng tên | `pages/DuAn/DuAn.jsx`, `pages/MuaHang/MuaHang.css`, `pages/QS/QS.jsx` |
| Component | file `.jsx` PascalCase | `components/layout/Sidebar.jsx`, `pages/QS/components/BreakdownTab.jsx`, `WorkGate.jsx` |
| Hook | `use<Tên>.js` camelCase | `hooks/useLocalStorage.js`, `pages/QS/state/useLinesSheet.js` |
| Module JS thường (api, lib, data, service) | `.js` camelCase | `pages/QS/api/qsApi.js`, `pages/QS/lib/calc.js`, `data/duAnData.js`, `services/storageService.js` |
| Hàm gọi API | `camelCase`, trùng tên hàm rpc tương ứng, gọi REST `/api/v1` | `getProjects`, `createProject`, `notifReadAll` |
| Hàm chuyển từ giao diện cũ (`pages/QS/lib`) | giữ hậu tố `_` | `recalcLine_`, `giaDaiLy_`, `donGiaCK_`, `spMaMap_` |
| Lớp lỗi | PascalCase hậu tố `Error` | `QsApiError`, `QsAuthError`, `ChatApiError` |
| Biến môi trường | tiền tố `VITE_` | `VITE_API_URL` |

## Đường dẫn

- REST: `/api/v1/<tài-nguyên>` số nhiều, tiếng Anh, kebab-case (`backend/docs/ARCHITECTURE.md` mục 5) - `/api/v1/projects`,
  `/api/v1/projects/:id/lines`, `/api/v1/work-items`, `/api/v1/product-approvals`. Bảng route ứng với hàm rpc: `RestRoutes` trong
  `backend/internal/server/rest.go` (đóng băng); route mới là route chỉ bản Go.
- Cổng tương thích `POST /api/<tênHàm>` giữ đúng 80 hàm cũ, không thêm.
- Route lẻ (bảng `RootRoutes`, giữ đường dẫn cũ): kebab-case tiếng Việt không dấu - `/export/san-pham`, `/export/cong-tac`,
  `/export/bang`, `/upload/file`, `/media`, `/healthz`; file mẫu `/mau-nhap-<ngành>.xlsx`
  (`/mau-nhap-thiet-bi-ve-sinh.xlsx`, `/mau-nhap-son-nuoc.xlsx`, `/mau-nhap-cong-tac-o-cam.xlsx`).
- Route trang React: kebab-case tiếng Việt không dấu - `du-an`, `kinh-doanh`, `quan-ly-thiet-ke`, `qs-pro`.

## Tài liệu

- File trong `docs/`: kebab-case không dấu (xem [docs-placement.md](../docs/docs-placement.md)).
- Quy trình nghiệp vụ: `docs/03-san-pham/flows/QT-<nn>-<slug>.md`.
