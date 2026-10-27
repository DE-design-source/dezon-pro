# Naming Conventions — QS Pro

> Quy ước đặt tên ĐANG DÙNG trong repo. Code mới theo đúng, không đổi tên hàng loạt cái cũ.
> Repo không có cache/Redis, hàng đợi, sự kiện hay REST có phiên bản — không áp quy ước của các thứ đó.

## Ngôn ngữ

- Tên nghiệp vụ TRONG CODE (tên bảng / cột truyền cho `supa.*`, nhiều hàm) là **tiếng Việt không dấu**;
  chú thích và chuỗi hiển thị là tiếng Việt có dấu. Giữ nguyên, không dịch sang tiếng Anh.
- Tên bảng / cột TRONG DATABASE PostgreSQL là **tiếng Anh** (từ 2026-10-07); `server/db-map.json` ánh xạ hai chiều,
  `server/supa.js` tự dịch khi đọc/ghi. Quy tắc database: `docs/02-ky-thuat/database/database-rules.md`.

## Cơ sở dữ liệu (PostgreSQL)

Cột "Code" là tên dùng trong code (khoá của `db-map.json`); cột "Database" là tên thật trong PostgreSQL.

| Thứ | Code | Database | Ví dụ (code -> database) |
|---|---|---|---|
| Bảng | `snake_case`, tiếng Việt không dấu, **số ít** | `snake_case`, tiếng Anh, **số nhiều** | `du_an` -> `projects`, `db_san_pham` -> `products` |
| Bảng lịch sử | `<bảng>_history` | `<bảng số ít>_histories` | `db_san_pham_history` -> `product_histories`, `cong_tac_history` -> `work_item_histories` |
| Cột | `snake_case` | `snake_case`, tiếng Anh | `ma_du_an` -> `project_code`, `ten_sp` -> `product_name`, `gia_ban_le` -> `retail_price` |
| Khoá công ty | luôn là `cong_ty_id` | luôn là `company_id` | — |
| Phần trăm / thời điểm | hậu tố `_pct` / `created_at`, `changed_at` | `_pct` / `_at`; ngày `_date`; boolean `is_` / `has_` | `loi_nhuan_pct` -> `profit_pct`, `ck_dai_ly_pct` -> `dealer_discount_pct` |
| Index | — | `idx_<bảng>_<cột>[_<cột>…]` | `idx_proposal_discount_items_proposal_code_sort_order` |
| Ràng buộc | — | `pk_` / `fk_` / `uq_` / `ck_` + `<bảng>_<cột>` | `pk_company_settings`, `uq_company_settings_company_id_setting_key`, `ck_products_dealer_price` |
| File migration | — | `infra/db/migrations/<NNNN>_<snake_case>.sql`, số tăng dần | `0002_company_settings.sql`, `0007_proposal_items_split.sql` |

Bảng / cột mới: thêm vào `server/db-map.json` cùng lúc với migration, rồi đồng bộ sang `backend/internal/platform/database/db-map.json`.
Cột thông số theo ngành khai báo trong `public/vs-spec.js` / `public/son-spec.js` / `public/ct-spec.js`; nhãn trùng
giữa các spec phải trỏ cùng một cột.

## Server

| Thứ | Quy ước | Ví dụ |
|---|---|---|
| Thư mục | không có thư mục domain — `server/` là file phẳng | — |
| File | chữ thường; tên nhiều từ dùng `-` (file cũ có `_`) | `index.js`, `auth.js`, `store_supa.js`, `supa.js`, `tenant.js`, `shared.js`, `export.js`, `lark.js`, `vs-template.js`, `ct-template.js` |
| Hàm API | `camelCase`, là khoá trong `REGISTRY` (`server/index.js`), **duy nhất**; quyền khai trong `PUBLIC_FNS` / `ACTOR_FNS` / `ADMIN_FNS` / `SUPER_FNS` | `getProjects`, `ctSave`, `adminCreateUser`, `sendDeXuat` |
| Hàm API quản lý user (admin) | tiền tố `admin` (không phải mọi hàm trong `ADMIN_FNS` đều có tiền tố) | `adminSetActive`, `adminListUsers` |
| Cửa ngõ kiểm quyền (`server/auth.js`) | hậu tố `Gated`; `REGISTRY` trỏ tên API tới hàm này | `ctSave: auth.ctSaveGated`, `updateDbProductTracked: auth.updateProductGated` |
| Hàm nội bộ / helper | hậu tố `_` | `calc_`, `tblErr_`, `spPerms_`, `toNumber_` |
| Object trả về client | khoá `camelCase` (đổi từ cột `snake_case` trong `server/store_supa.js`) | `donGiaVon`, `maDA`, `thanhTienBan` |
| Biến môi trường | `UPPER_SNAKE_CASE` | `AUTH_SECRET`, `REPORT_WEBHOOK`, `UPLOAD_DIR` |

## Client (`public/`)

| Thứ | Quy ước | Ví dụ |
|---|---|---|
| File tab | chữ thường viết liền, không gạch | `sanpham.js`, `muahang.js`, `baogia.js`, `bangtinh.js` |
| File thông số ngành (UMD) | `<viết tắt ngành>-spec.js` | `vs-spec.js`, `son-spec.js`, `ct-spec.js` |
| Hàm helper dùng chung | hậu tố `_` | `tkNum_`, `escJs_`, `safeUrl_`, `openProject_` |
| Hàm theo tab | tiền tố viết tắt của tab / tính năng | `imp*` (nhập), `sp*` (sản phẩm), `ct*` (công tác), `hm*` (hạng mục), `vs*` (vệ sinh) |
| Trạng thái toàn cục | trong object `S`; trường tạm có tiền tố `_` | `S.cur`, `S.lines`, `S._pending`, `S._viewAs` |
| Hằng toàn cục | `UPPER_SNAKE_CASE` | `TREE`, `DB_GROUPS_VS`, `VS_SPEC` |

Hàm client được `scripts/test-core.js` trích bằng regex phải là khai báo `function tên(` ở cấp cao nhất.

## Đường dẫn

- API nghiệp vụ: `POST /api/<tênHàm>` — không thêm REST `/api/v1/...`.
- Route lẻ (khai trong `server/index.js`): kebab-case tiếng Việt không dấu — `/export/san-pham`, `/export/cong-tac`,
  `/export/bang`, `/upload/file`, `/media`, `/healthz`; file mẫu `/mau-nhap-<ngành>.xlsx`
  (`/mau-nhap-thiet-bi-ve-sinh.xlsx`, `/mau-nhap-son-nuoc.xlsx`, `/mau-nhap-cong-tac-o-cam.xlsx`).

## Tài liệu

- File trong `docs/`: kebab-case không dấu (xem [docs-placement.md](../docs/docs-placement.md)).
- Quy trình nghiệp vụ: `docs/03-san-pham/flows/QT-<nn>-<slug>.md`.
