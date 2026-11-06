# Hiệu năng truy vấn

> **Cập nhật 2026-10-12:** tài liệu này mô tả database `qspro_en` TRƯỚC refactor (mốc audit). Cấu trúc đang chạy: [schema-hien-hanh.md](schema-hien-hanh.md); kết quả triển khai: [ket-qua-trien-khai.md](ket-qua-trien-khai.md).
>
> **Ghi chú 2026-11-06:** viết khi còn app Node (đã gỡ ở commit `5fa5d52`); đường dẫn `server/*.js`, `public/*.js`, `render.yaml` và lệnh `npm ...` trong tài liệu này là mã / cách làm cũ. Hiện nay: migration chạy bằng `go run ./cmd/migrate` (trong `backend/`), `db-map.json` duy nhất ở `backend/internal/platform/database/db-map.json`, bảng tự lọc công ty khai trong `TenantTables` (`backend/internal/platform/database/postgres.go`).

- Đo trên `qspro_en` (PostgreSQL 17, Docker local, máy phát triển) ngày 2026-10-12 bằng `EXPLAIN (ANALYZE, BUFFERS)`, chỉ với câu `SELECT`.
- Dữ liệu là bản chép đầy đủ của production: 8.317 dòng, khoảng 5 MB.
- Đây là **baseline**, không phải cam kết. Số đo trên máy khác sẽ khác; chỉ dùng để so sánh trước/sau trên cùng máy.

## 1. Kết luận

1. **Database không phải điểm nghẽn.** Truy vấn nặng nhất mất 11 ms. Toàn bộ dữ liệu nằm gọn trong bộ nhớ.
2. **Chi phí thật nằm ở tầng ứng dụng:** kích thước dữ liệu trả về và số lượt truy vấn, không phải kế hoạch thực thi.
3. **Không đề xuất thêm index để tăng tốc.** Index mới chỉ thêm khi cần cho ràng buộc (unique, khoá ngoại).
4. Ở quy mô này planner chọn quét tuần tự cho phần lớn truy vấn dù có index; đó là lựa chọn đúng.

## 2. Truy vấn quan trọng và số đo

| # | Truy vấn (hàm) | Điều kiện / sắp xếp | Dòng trả về | Kế hoạch | Thời gian chạy |
|---|---|---|---:|---|---:|
| Q1 | Danh mục sản phẩm (`getProducts`) - gọi khi mở app, cache 5 phút theo công ty | `company_id = ?` ; `ORDER BY product_name COLLATE "en-US-x-icu", id` | 949 | Seq Scan + quicksort (1,1 MB) | 11,3 ms |
| Q2 | Dòng bóc tách của dự án (`getLines`) | `project_code = ?` ; `ORDER BY sort_order, id` | 139 | Bitmap scan `idx_quotation_lines_project_code_sort_order` | 4,4 ms |
| Q3 | Tìm trùng biến thể khi lưu SP (`saveDbProduct`) | `company_id, product_code` + 4-5 trục biến thể | 0-1 | Index scan trên unique index biến thể | 0,8 ms |
| Q4 | Lịch sử sản phẩm (`getProductHistory`) | `company_id, product_code` ; `ORDER BY changed_at DESC` ; 200 | 76 | Index scan `idx_product_histories_company_id_product_code_changed_at_desc` | 1,8 ms |
| Q5 | Nhật ký (`getAuditLog`) | `company_id = ?` ; `ORDER BY created_at DESC` ; 1000 | 1.000 | Seq Scan + top-N sort | 1,1 ms |
| Q6 | Đếm combo (`stampCombo_`) - chạy mỗi lần nạp danh mục | không lọc (cả bảng, mọi công ty) | 85 | Seq Scan | 0,05 ms |
| Q7 | Kiểm phiên (`sessionActor`) - mỗi request, cache 30 giây | `id = ?` | 1 | Index scan `pk_users` | 0,05 ms |
| Q8 | Báo cáo nhập SP (`baoCaoNhapSP`) | `created_at >= ?` ; `ORDER BY created_at DESC` | 21 | Index scan `idx_products_created_at` | 0,09 ms |
| Q9 | Dòng của một đơn mua | `order_code = ?` ; `ORDER BY sort_order` | 4 | Seq Scan (160 dòng) | 0,08 ms |

## 3. Chi phí ở tầng ứng dụng

| Vấn đề | Số liệu / bằng chứng | Hướng xử lý (ngoài phạm vi đợt database này) |
|---|---|---|
| Danh mục sản phẩm trả `SELECT *` 141 cột | 3,4 MB JSON cho 949 sản phẩm của Dezon (đo bằng `row_to_json`); client còn nhận thêm bản `raw` lặp lại các cột | Khi tách bảng theo ngành (D-06), cột trống không còn chiếm chỗ trong JSON nếu chỉ nối bảng của ngành tương ứng |
| N+1 truy vấn | `getPurchaseOrders`, `getDeXuatList`: mỗi đơn/phiếu thêm 1 truy vấn dòng chi tiết (`store_supa.js:1183, 1275`) | Gom bằng `in.(...)`; hiện 65 đơn nên chưa đáng kể |
| Ghi từng dòng | Đổi tên tầng cập nhật từng dòng bóc tách (`public/boc.js:655-675`); `updateLine` luôn ghi lại 12 cột giá | Giữ nguyên |
| Không phân trang phía server | Danh mục tối đa 20.000 dòng, dòng bóc tách 20.000, nhật ký 1.000 | Cần khi một công ty vượt vài chục nghìn sản phẩm |
| Đọc cả bảng combo mỗi lần nạp danh mục | Q6 | Lọc theo công ty (cũng là sửa lỗi T10) |
| Giá trị JSON lớn | `bgHist` tới 200 KB/giá trị, ghi lại toàn bộ mỗi lần lưu | Theo dõi; tách bảng nếu vượt vài MB |

## 4. Index hiện có

`qspro_en` có 64 index (19 khoá chính, 4 unique constraint, 41 index phụ). Bộ đếm `pg_stat_user_indexes` từ lúc tạo database (chủ yếu là lượt chạy kiểm thử, chưa phải tải thật):

| Index | Lượt dùng | Nhận xét |
|---|---:|---|
| `idx_products_product_code` | 485 | Tra theo mã SP |
| `pk_products` | 189 | |
| `idx_quotation_lines_project_code_sort_order` | 15 | Đúng truy vấn Q2 |
| `uq_products_..._variant` | 6 | Vừa là ràng buộc, vừa phục vụ Q3 |
| `idx_audit_logs_action_id` | 0 | Phục vụ kiểm trùng báo cáo nền; chưa chạy trong lúc đo |

**Chưa đủ dữ liệu để đề xuất xoá index nào.** Cần ít nhất một tuần chạy thật rồi đọc lại `pg_stat_user_indexes`; index có 0 lượt dùng và không gắn với ràng buộc mới là ứng viên xoá.

## 5. Index cần cho schema đề xuất

Chỉ những index đi kèm ràng buộc; không index nào thêm vì tốc độ.

| Index | Lý do |
|---|---|
| `UNIQUE (lower(username))` trên `users` | Ràng buộc duy nhất (D-05) |
| `UNIQUE (company_id, project_code)` trên `projects`; `(company_id, order_code)` trên `purchase_orders`; `(company_id, proposal_code)` trên `purchase_proposals`; `(company_id, id)` trên `products` | Đích của khoá ngoại kép theo công ty (D-04) |
| Index trên cột khoá ngoại mới ở bảng con | Để xoá/sửa bảng cha không phải quét bảng con |
| Khoá chính của các bảng thông số theo ngành (`product_id`) | Nối 1-1 với `products` (D-06) |

## 6. Cách đo lại sau mỗi thay đổi

1. Khôi phục cùng một bản dữ liệu vào database trước và sau thay đổi.
2. Chạy 9 truy vấn ở mục 2 bằng `EXPLAIN (ANALYZE, BUFFERS)`, mỗi truy vấn 5 lần, lấy trung vị.
3. Đo thêm kích thước JSON của Q1 và thời gian `getProducts` đầu-cuối qua API (không cache).
4. Ghi kết quả vào bảng mục 2 kèm ngày và cấu hình máy. Không tuyên bố "nhanh hơn" nếu chưa có hai cột số.

Không chạy đo tải trên production khi chưa được phép.
