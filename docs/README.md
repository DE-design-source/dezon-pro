# Tài liệu QS Pro

Mục lục mọi tài liệu trong `docs/`. Cập nhật file này mỗi khi thêm hoặc đổi tên tài liệu.

## 02-ky-thuat / kien-truc

| Tài liệu | Nội dung | Loại |
|---|---|---|
| [kien-truc-he-thong.md](02-ky-thuat/kien-truc/kien-truc-he-thong.md) | Ảnh chụp kiến trúc hiện tại: khối hệ thống, tầng backend, 18 module, trang gọi server, dữ liệu, triển khai, điểm đáng chú ý. Sinh bằng lệnh `/architecture`, chạy lại để cập nhật | **Hiện hành** |
| [phan-quyen.md](02-ky-thuat/kien-truc/phan-quyen.md) | Phân quyền: vai trò super / admin / staff, luồng một request, tách dữ liệu theo công ty, quản lý tài khoản, quyền theo tab, lớp quyền HR, quyền riêng từng module, điểm cần lưu ý (sơ đồ Mermaid) | **Hiện hành** |

## 02-ky-thuat / database

Bộ tài liệu audit và tái thiết kế database (2026-10-12). Refactor **đã triển khai trên database local `qspro_en2`**; 2026-10-24 đã nạp `qspro_en2` lên PostgreSQL của VPS CloudFly (backend Go, https://dezon.tech - xem roadmap N2). Đọc hai tài liệu đầu bảng trước.
Các tài liệu loại "Mốc audit" / "Đề xuất gốc" viết khi còn app Node (đã gỡ ở commit `5fa5d52`): đường dẫn `server/*.js`, `public/*.js` trong đó là mã cũ; bản đang chạy là backend Go (`backend/`) + giao diện React (`frontend/`).

| Tài liệu | Nội dung | Loại |
|---|---|---|
| [tach-du-lieu-cong-ty.md](02-ky-thuat/database/tach-du-lieu-cong-ty.md) | Thiết kế tách dữ liệu theo công ty: bảng cha có `company_id`, bảng con lấy theo dòng cha, `TenantTables`, luồng đọc / ghi, trường hợp đặc biệt, ràng buộc khi thêm bảng (sơ đồ Mermaid) | **Hiện hành** |
| [luong-truy-van-theo-cong-ty.md](02-ky-thuat/database/luong-truy-van-theo-cong-ty.md) | Ví dụ cụ thể: đăng nhập Super / admin đi qua bảng nào, câu SQL thật khi đọc / sửa / xoá / thêm, vì sao công ty này không đụng dữ liệu công ty khác, truy cập thẳng database (sơ đồ Mermaid) | **Hiện hành** |
| [schema-hien-hanh.md](02-ky-thuat/database/schema-hien-hanh.md) | Cấu trúc ĐANG CHẠY: bảng, nhiệm vụ, khoá, sơ đồ quan hệ, cột (sinh từ database) | **Hiện hành** |
| [ket-qua-trien-khai.md](02-ky-thuat/database/ket-qua-trien-khai.md) | Đã làm gì, khác gì đề xuất, kết quả kiểm thử, dữ liệu cách ly, cách vận hành | **Hiện hành** |
| [database-rules.md](02-ky-thuat/database/database-rules.md) | 40 quy tắc khi thêm hoặc sửa bảng | **Hiện hành** |
| [audit.md](02-ky-thuat/database/audit.md) | Kiến trúc và vấn đề TRƯỚC refactor, có bằng chứng | Mốc audit |
| [audit-catalog.md](02-ky-thuat/database/audit-catalog.md) | Từng bảng trước refactor: cột, kiểu, ràng buộc, index, số liệu | Mốc audit |
| [database-dependencies.md](02-ky-thuat/database/database-dependencies.md) | Bảng/cột nào được hàm nào đọc, ghi; hình dạng dữ liệu trả về client | Mốc audit |
| [data-dictionary.md](02-ky-thuat/database/data-dictionary.md) | Từ điển dữ liệu từng cột + cấu trúc các giá trị JSON | Mốc audit |
| [status-model.md](02-ky-thuat/database/status-model.md) | Các trường trạng thái, giá trị, chuyển trạng thái | Mốc audit |
| [tenant-security.md](02-ky-thuat/database/tenant-security.md) | Mô hình tenant, điểm yếu, danh sách `noScope`, đề xuất | Mốc audit + đề xuất |
| [query-performance.md](02-ky-thuat/database/query-performance.md) | Truy vấn quan trọng, số đo baseline, index | Mốc audit + đề xuất |
| [erd.md](02-ky-thuat/database/erd.md) | Sơ đồ quan hệ hiện tại và đề xuất (Mermaid) | Mốc audit + đề xuất |
| [decisions.md](02-ky-thuat/database/decisions.md) | 14 quyết định thiết kế, phương án đã cân nhắc, mục cần duyệt | Đề xuất gốc (đã triển khai có điều chỉnh) |
| [proposed-schema.md](02-ky-thuat/database/proposed-schema.md) | Schema đích theo từng đợt | Đề xuất gốc (đã triển khai có điều chỉnh) |
| [migration-plan.md](02-ky-thuat/database/migration-plan.md) | Các đợt migration, xử lý dữ liệu sai, quay lui | Đề xuất gốc (đã triển khai có điều chỉnh) |
| [migration-test-plan.md](02-ky-thuat/database/migration-test-plan.md) | Kiểm thử và tiêu chí nghiệm thu | Đề xuất gốc (đã triển khai có điều chỉnh) |

### Đối chiếu với tên file trong yêu cầu gốc

Yêu cầu ghi `docs/database/<TÊN>.md`; quy tắc của repo (`.claude/rules/docs/docs-placement.md`) buộc tài liệu kỹ thuật nằm trong `docs/02-ky-thuat/` với tên kebab-case.

| Yêu cầu | File |
|---|---|
| `AUDIT.md` | `audit.md` + `audit-catalog.md` |
| `DATABASE_DEPENDENCIES.md` | `database-dependencies.md` |
| `PROPOSED_SCHEMA.md` | `proposed-schema.md` |
| `ERD.md` | `erd.md` |
| `DATA_DICTIONARY.md` | `data-dictionary.md` |
| `QUERY_PERFORMANCE.md` | `query-performance.md` |
| `TENANT_SECURITY.md` | `tenant-security.md` |
| `MIGRATION_PLAN.md` | `migration-plan.md` |
| `DATABASE_RULES.md` | `database-rules.md` |
| `MIGRATION_TEST_PLAN.md` | `migration-test-plan.md` |
| `DECISIONS.md` | `decisions.md` |
| `STATUS_MODEL.md` | `status-model.md` |

## 03-san-pham

| Tài liệu | Nội dung | Loại |
|---|---|---|
| [roadmap.md](03-san-pham/roadmap.md) | Tiến độ theo module (M) và tính năng mới (N), backlog, ưu tiên, danh sách đã xong; cập nhật theo `.claude/rules/docs/roadmap-sync.md` | **Hiện hành** |

## 04-van-hanh

| Tài liệu | Nội dung | Loại |
|---|---|---|
| [trien-khai-vps-cloudfly.md](04-van-hanh/trien-khai-vps-cloudfly.md) | Đưa backend Go + giao diện React + PostgreSQL lên VPS (Docker Compose + Caddy HTTPS): từng bước từ trỏ tên miền, chuyển dữ liệu, sao lưu / khôi phục, vận hành, xử lý sự cố | **Hiện hành** |

## 06-design / kien-truc

| Tài liệu | Nội dung | Loại |
|---|---|---|
| [index.html](06-design/kien-truc/index.html) | 5 sơ đồ kiến trúc HTML/SVG (tổng quan, tầng backend, bản đồ module, frontend gọi backend, triển khai), mở bằng trình duyệt. Sinh bằng lệnh `/architecture` | **Hiện hành** |
