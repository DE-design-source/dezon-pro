# Kế hoạch kiểm thử và nghiệm thu migration

> **Cập nhật 2026-10-12:** đề xuất này ĐÃ được triển khai trên database local `qspro_en2`, có điều chỉnh. Cấu trúc đang chạy: [schema-hien-hanh.md](schema-hien-hanh.md). Những gì đã làm và khác gì so với bản dưới đây: [ket-qua-trien-khai.md](ket-qua-trien-khai.md). Nội dung bên dưới là bản đề xuất gốc, giữ lại để tra lý do.
>
> **Ghi chú 2026-11-06:** viết khi còn app Node (đã gỡ ở commit `5fa5d52`); đường dẫn `server/*.js`, `public/*.js`, `render.yaml` và lệnh `npm ...` trong tài liệu này là mã / cách làm cũ. Hiện nay: migration chạy bằng `go run ./cmd/migrate` (trong `backend/`), `db-map.json` duy nhất ở `backend/internal/platform/database/db-map.json`, bảng tự lọc công ty khai trong `TenantTables` (`backend/internal/platform/database/postgres.go`).

- Trạng thái: **ĐỀ XUẤT** (2026-10-12). Các bộ test dưới đây chưa được viết vào repo, trừ ghi chú "đã chạy" ở mục 1.
- Áp dụng cho từng đợt trong [migration-plan.md](migration-plan.md). Một đợt chỉ được coi là xong khi mọi mục bắt buộc của đợt đó đạt.

## 1. Hiện có gì

| Bộ test | Phạm vi | Ghi chú |
|---|---|---|
| `npm test` (`test-core.js`, `check-load.js`, `test-vs.js`) | Hàm thuần, thứ tự nạp script, luồng nhập sản phẩm trên **database giả trong bộ nhớ** | 1.341 ca đạt (2026-10-12). Không chạm PostgreSQL |
| Đối chiếu đọc Supabase <-> PostgreSQL | 150 truy vấn giống nhau trên hai nguồn | Đã chạy 2026-10-12, 150/150 khớp. Script nằm ngoài repo |
| Ghi qua lớp dữ liệu trên database tạm | 31 ca thêm/sửa/xoá, cách ly công ty | Đã chạy 2026-10-12, đạt. Script nằm ngoài repo |
| Chạy server thật trên database tạm | 47 lệnh gọi API | Đã chạy 2026-10-12, đạt. Script nằm ngoài repo |

Việc đầu tiên của đợt 1: đưa ba script sau vào repo thành `scripts/test-db-*.js`, chạy bằng biến `TEST_DATABASE_URL` trỏ tới một database tạm (không bao giờ là database đang dùng).

## 2. Kiểm tra dữ liệu (chạy trước và sau mỗi đợt)

Lưu kết quả thành bảng; mọi chênh lệch phải giải thích được bằng một bước trong kế hoạch.

| # | Kiểm tra | Baseline 2026-10-12 | Sau đợt 1 mong đợi |
|---|---|---|---|
| V1 | Số dòng từng bảng | xem [audit-catalog.md](audit-catalog.md) | Bằng baseline, trừ dòng chuyển sang `quarantine` (tổng dòng bảng + quarantine = baseline) |
| V2 | Đối soát nội dung: `md5` của từng dòng (mọi cột, sắp theo khoá chính) giữa nguồn và đích | - | Khớp 100%, trừ các ô có trong `fix_log` |
| V3 | Dòng mồ côi theo 19 quan hệ | bảng ở audit mục 4.2 | 0 ở quan hệ có khoá ngoại; không đổi ở tham chiếu mềm |
| V4 | Dòng con lệch công ty với cha | 17 + 4 | 0 |
| V5 | Dòng `company_id` NULL theo bảng | audit B3 | Không tăng |
| V6 | Username trùng | 1 cặp | 0 (nếu X7 được duyệt) |
| V7 | `products.dealer_price` lệch công thức | 0 | 0, và `is_generated = ALWAYS` |
| V8 | Vi phạm từng CHECK công thức | 0 | 0 |
| V9 | Tổng đơn mua khớp dòng chi tiết | 0 đơn lệch | 0 |
| V10 | Bộ đếm identity: `nextval` lớn hơn `max(id)` ở mọi bảng | - | Đạt |

## 3. Kiểm thử schema

Mỗi ràng buộc mới có một ca "bị từ chối" và một ca "được chấp nhận":

| Ràng buộc | Ca bị từ chối | Mã lỗi mong đợi |
|---|---|---|
| FK kép `quotation_lines -> projects` | Chèn dòng với `project_code` của công ty B nhưng `company_id` của A | 23503 |
| FK kép các bảng con còn lại | Tương tự | 23503 |
| `ON DELETE CASCADE` | Xoá dự án: dòng bóc tách, tờ bìa, dữ liệu dự án biến mất; đơn mua còn nguyên | - |
| `ON DELETE SET NULL` | Xoá user: `requester_id` của đơn về NULL, tên người gửi còn | - |
| `UNIQUE (lower(username))` | Tạo `ABC` khi đã có `abc` | 23505 |
| CHECK công thức | `UPDATE quotation_lines SET amount = amount + 1` | 23514 |
| Cột generated | `UPDATE products SET dealer_price = 1` | 428C9 |
| `company_settings` | Khoá ngoài danh sách; `company_id` không tồn tại | 23514, 23503 |
| Mặc định và NULL | Chèn dòng tối thiểu vào từng bảng như code đang làm | Thành công, mặc định đúng |

## 4. Kiểm thử nghiệp vụ (qua API thật, trên database tạm)

Tài khoản thử được tạo trong database tạm. Không gọi `sendPurchaseRequest`, `sendDeXuat`, `baoCaoNhapSP` với webhook thật: đặt `PURCHASE_WEBHOOK` / `REPORT_WEBHOOK` về một địa chỉ giả cục bộ.

| Luồng | Ca |
|---|---|
| Đăng nhập | Sai mật khẩu; đúng; công ty hết hạn; tài khoản khoá |
| Sản phẩm | Tạo từng ngành (đèn, vs, son, ct); tạo trùng khoá biến thể -> cập nhật; sửa có lịch sử; **giá đại lý tự tính sau khi đổi giá bán lẻ và % chiết khấu**; duyệt / tự bỏ duyệt khi sửa; combo hai chiều; nhóm biến thể; yêu thích; xin xoá và duyệt xoá; nhập hàng loạt 3 file mẫu |
| Dự án | Tạo; thêm dòng từ sản phẩm (kiểm bản chụp); sửa giá và kiểm 7 cột tính toán theo `calc_`; đồng bộ giá từ danh mục; lưu tờ bìa 2 lần liên tiếp (không nhân đôi); dữ liệu dự án từng khoá; nhân bản; xoá |
| Bản chụp | Sửa sản phẩm trong danh mục: dòng bóc tách và dòng đơn mua cũ không đổi |
| Công tác | Tạo, sửa (về chưa duyệt), duyệt, yêu thích, xoá (có dòng lịch sử "XOÁ") |
| Mua hàng | Tạo đơn nhiều NCC; duyệt; từ chối; `Đã duyệt -> Đã đặt hàng -> Đã nhận hàng`; chuyển sai thứ tự bị chặn; duyệt hai lần: lần hai báo "đã được xử lý" |
| Đề xuất | Phiếu ck có dòng; phiếu tt có đợt; duyệt / từ chối |
| Quản trị | Tạo/sửa/khoá/xoá user; giữ admin cuối; giới hạn số user; tạo/sửa/xoá công ty |
| Xuất file | Xuất Excel báo giá, danh sách sản phẩm, công tác: mở được, số dòng đúng |

**So sánh hình dạng:** với mỗi hàm đọc, lưu JSON trả về trên database trước migration, so với sau migration (bỏ qua id và thời điểm mới sinh). Khác một khoá hay một kiểu giá trị là không đạt.

## 5. Kiểm thử multi-tenant

Hai công ty A, B và công ty `dezon` trong database tạm.

| # | Ca | Mong đợi |
|---|---|---|
| M1 | A đọc từng bảng tenant-owned | Không có dòng của B |
| M2 | A sửa / xoá dòng của B theo id | 0 dòng bị ảnh hưởng; dữ liệu B nguyên vẹn |
| M3 | A chèn dòng con trỏ cha của B (bỏ qua lớp ứng dụng, chèn thẳng SQL) | Database từ chối (23503) |
| M4 | A bật kho chung: đọc được sản phẩm Dezon; sửa / xoá / duyệt bị chặn; đánh dấu yêu thích được | Như mô tả |
| M5 | A chưa bật kho chung | Không thấy sản phẩm Dezon |
| M6 | User không phải super, không có công ty | Mọi truy vấn bị chặn |
| M7 | Super chọn "xem như" A | Chỉ thấy dữ liệu A; dòng tạo ra mang `company_id` của A |
| M8 | Xoá công ty B | Dữ liệu B biến mất; A và Dezon nguyên vẹn (so số dòng) |

Ghi nhận trong báo cáo, không tính là lỗi của migration: 4 điểm rò ở code (T3, T9, T10 trong [tenant-security.md](tenant-security.md)) vẫn tồn tại cho tới khi được quyết định sửa.

## 6. Kiểm thử hiệu năng

- Chạy 9 truy vấn ở [query-performance.md](query-performance.md) mục 2 trước và sau, cùng máy, cùng dữ liệu, mỗi truy vấn 5 lần, lấy trung vị.
- Đo thời gian đầu-cuối `getProducts` (không cache) và kích thước JSON.
- **Không đặt ngưỡng tuyệt đối.** Tiêu chí: không truy vấn nào chậm hơn quá 2 lần baseline mà không có giải thích; đợt 2 phải ghi kích thước JSON danh mục trước/sau.
- Đếm số truy vấn SQL cho một lần mở dự án (bootstrap) trước/sau: không được tăng.

## 7. Kiểm thử migration

| # | Ca | Mong đợi |
|---|---|---|
| G1 | Chạy toàn bộ migration trên bản sao dữ liệu thật | Không lỗi; `schema_migrations` đủ dòng |
| G2 | Chạy lại `migrate.js` lần hai | Không làm gì |
| G3 | Sửa nội dung một file đã áp dụng rồi chạy | Bị từ chối vì lệch checksum |
| G4 | Chèn lỗi giả vào giữa một file | Cả file bị huỷ; database như trước file đó |
| G5 | Dựng database trống từ `infra/db/schema.sql` rồi nạp dữ liệu | Thành công; schema giống database đã migrate (`pg_dump --schema-only` so sánh) |
| G6 | Khôi phục từ `pg_dump` trước migration | Số dòng và V2 khớp baseline |
| G7 | Quay lui: trỏ app về database cũ | App chạy bình thường |
| G8 | Import bộ `sql-en2` vào database trống | Thành công; V1, V2 khớp |

## 8. Tiêu chí nghiệm thu theo đợt

| Đợt | Bắt buộc |
|---|---|
| 0 | V7; ca "giá đại lý tự tính" ở mục 4; `npm test` |
| 1 | Mục 2 (V1-V10), mục 3, mục 4, mục 5, G1-G8; `npm test`; một phiên dùng thử thủ công trên trình duyệt qua các tab chính |
| 2 | Như đợt 1, cộng: đối chiếu 1.093 x 141 ô sản phẩm; giả lập lỗi giữa 6 thao tác nhiều bước; mục 6 có số trước/sau |
| 3 | grep không còn chỗ đọc cột bị xoá; mục 4; G6 |

## 9. Ngoài khả năng kiểm thử tự động

- Giao diện: cần người dùng thử trên trình duyệt (in báo giá, bảng tính, kéo thả tầng).
- Gửi Lark thật.
- Hành vi trên Render và với dữ liệu production tại thời điểm cắt chuyển.

Các mục này phải có người xác nhận bằng tay và ghi tên trong báo cáo đợt.
