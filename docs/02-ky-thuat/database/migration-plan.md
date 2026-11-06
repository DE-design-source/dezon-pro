# Kế hoạch migration

> **Cập nhật 2026-10-12:** đề xuất này ĐÃ được triển khai trên database local `qspro_en2`, có điều chỉnh. Cấu trúc đang chạy: [schema-hien-hanh.md](schema-hien-hanh.md). Những gì đã làm và khác gì so với bản dưới đây: [ket-qua-trien-khai.md](ket-qua-trien-khai.md). Nội dung bên dưới là bản đề xuất gốc, giữ lại để tra lý do.
>
> **Ghi chú 2026-11-06:** viết khi còn app Node (đã gỡ ở commit `5fa5d52`); đường dẫn `server/*.js`, `public/*.js`, `render.yaml` và lệnh `npm ...` trong tài liệu này là mã / cách làm cũ. Hiện nay: migration chạy bằng `go run ./cmd/migrate` (trong `backend/`), `db-map.json` duy nhất ở `backend/internal/platform/database/db-map.json`, bảng tự lọc công ty khai trong `TenantTables` (`backend/internal/platform/database/postgres.go`).

- Trạng thái: **ĐỀ XUẤT - chờ duyệt** (2026-10-12). Chưa bước nào được chạy.
- Schema đích: [proposed-schema.md](proposed-schema.md). Kiểm thử và tiêu chí nghiệm thu: [migration-test-plan.md](migration-test-plan.md).

## 1. Môi trường

| Môi trường | Database | Trạng thái |
|---|---|---|
| Local | `qspro_en` trong container `qspro-postgres` (cổng 5434) - app local đang dùng | Dữ liệu chép từ Supabase 2026-10-12 |
| Local, đối chiếu | `qspro` (tên tiếng Việt, bản 2026-10-07) | Chỉ để so sánh |
| Staging | Chưa có | Cần tạo trước khi đụng production |
| Production | Supabase (tên tiếng Việt), app trên Render | Chưa chuyển; không thuộc phạm vi các đợt dưới đây |

Mọi bước trong kế hoạch này chạy trên **local**. Đưa lên production là một kế hoạch cắt chuyển riêng, viết sau khi đợt 1 đã nghiệm thu.

## 2. Chiến lược

Hệ thống nhỏ (8.317 dòng, 5 MB) và chấp nhận dừng vài phút, nên **không dùng expand-and-contract trực tuyến**. Thay vào đó:

1. **Dựng database mới bên cạnh** (`qspro_en2`) từ dữ liệu của database đang chạy, áp migration lên đó.
2. Kiểm thử trên database mới.
3. **Chuyển app** bằng cách đổi `DATABASE_URL`. Database cũ giữ nguyên.
4. **Quay lui** = đổi `DATABASE_URL` về database cũ. Dữ liệu ghi sau lúc chuyển sẽ không có ở database cũ, nên chỉ quay lui trong khoảng thời gian chưa có thao tác thật, hoặc chấp nhận nhập lại.

Riêng việc xoá cột (đợt 3) theo kiểu expand-and-contract: ngừng ghi trước, xoá sau.

## 3. Sản phẩm bàn giao của mỗi đợt

- File migration đánh số trong `infra/db/migrations/`, được Git quản lý.
- `infra/db/schema.sql` sinh lại.
- Bộ SQL đầy đủ (schema + dữ liệu) xuất ra `export/supabase-2026-10-07/sql-en2/` theo yêu cầu, để import vào một database trống (nay thay bằng `infra/export/qspro_dev.sql`; bộ cũ đã chuyển khỏi repo ngày 2026-10-15). Thư mục `export/` không commit vì chứa dữ liệu khách hàng.
- Báo cáo đợt: số dòng trước/sau từng bảng, ràng buộc đã thêm, ràng buộc không thêm được và lý do, kết quả test.

## 4. Việc phải làm trước mọi đợt

1. `pg_dump` database nguồn; khôi phục thử vào database tạm và so số dòng. Chưa khôi phục thử được thì chưa coi là có sao lưu.
2. Lưu `infra/db/schema.sql` hiện tại làm mốc "schema cũ".
3. `git status` sạch; làm trên nhánh riêng.
4. Chạy bộ kiểm tra dữ liệu ở [migration-test-plan.md](migration-test-plan.md) mục 2 trên database nguồn, lưu kết quả làm baseline.

## 5. Đợt 0 - sửa lỗi giá đại lý

| Bước | Nội dung | Kiểm tra |
|---|---|---|
| 0.1 | Đếm dòng `products` có `dealer_price` khác công thức | Phải bằng 0 (hiện bằng 0) |
| 0.2 | Xoá cột, thêm lại dạng `GENERATED` (mục 3 của schema đề xuất) | `is_generated = ALWAYS` |
| 0.3 | So `dealer_price` mọi dòng với giá trị trước bước 0.2 | 0 dòng khác |
| 0.4 | `supa.js`: bỏ cột generated khỏi lệnh ghi (đọc `is_generated` từ catalog) | Test ghi sản phẩm |

- **Quay lui:** thêm lại cột thường, `UPDATE` theo công thức.
- **Có thể làm ngay trên `qspro_en`**, không cần database mới, vì không đổi dữ liệu và sửa đúng lỗi đang có.

## 6. Đợt 1 - toàn vẹn

### 6.1 Xử lý dữ liệu (mỗi dòng cần được duyệt trước)

| # | Dữ liệu | Số dòng | Cách xử lý đề xuất | Quay lui |
|---|---|---:|---|---|
| X1 | Dòng bóc tách lệch công ty so với dự án cha | 17 | `UPDATE` `company_id` theo dự án | Bảng `quarantine.fix_log` giữ giá trị cũ |
| X2 | Đơn mua lệch công ty so với dự án cha (và dòng của đơn) | 4 (+7) | Như X1 | Như X1 |
| X3 | Dòng bóc tách trỏ tới dự án không tồn tại | 3 | Chuyển sang `quarantine.quotation_lines` | Chèn lại |
| X4 | Yêu thích trỏ tới sản phẩm không tồn tại | 4 | Chuyển sang `quarantine` | Chèn lại |
| X5 | Thông báo của user đã xoá | 2 | Chuyển sang `quarantine` | Chèn lại |
| X6 | `requester_id` trỏ tới user đã xoá | 2 | Đặt NULL (tên người gửi vẫn còn) | `fix_log` |
| X7 | Tài khoản `tuannguyen` trùng | 1 | **Chờ quyết định**: đổi tên hoặc cách ly dòng không công ty | - |
| X8 | Dữ liệu không thuộc công ty nào (5 dự án, 144 sản phẩm, ...) | xem audit B3 | **Chờ quyết định**: giữ nguyên (mặc định) hoặc gán về Dezon | - |

Nguyên tắc: không `DELETE`. Schema `quarantine` chứa bản sao nguyên vẹn của dòng bị chuyển đi, kèm lý do và thời điểm. `quarantine.fix_log (table_name, row_id, column_name, old_value, new_value, reason, fixed_at)` ghi mọi lệnh `UPDATE` sửa dữ liệu.

Nếu một mục không được duyệt: bỏ qua mục đó và **không tạo ràng buộc phụ thuộc vào nó**; ghi rõ trong báo cáo.

### 6.2 Thứ tự migration

| File | Nội dung | Chạy lại được | Quay lui |
|---|---|---|---|
| `0001_schema_migrations.sql` | Bảng `schema_migrations` | Có | Xoá bảng |
| `0002_dealer_price_generated.sql` | Đợt 0 (nếu chưa làm) | Không | Mục 5 |
| `0003_quarantine_and_fixes.sql` | Schema `quarantine`, X1-X6 đã duyệt | Không (có kiểm tra điều kiện đầu vào) | Từ `quarantine` và `fix_log` |
| `0004_company_settings.sql` | Bảng mới; chuyển dòng `__cty:<uuid>` (hiện 0 dòng) | Có | Chuyển ngược, xoá bảng |
| `0005_unique_keys.sql` | Unique kép ở bảng cha; `UNIQUE (lower(username))` nếu X7 đã xử lý | Có (`if not exists`) | Xoá index |
| `0006_foreign_keys.sql` | 10 khoá ngoại ở mục 4.2 của schema đề xuất; xoá 4 FK đơn bị thay | Không | Tạo lại FK đơn, xoá FK mới |
| `0007_formula_checks.sql` | 4 CHECK công thức, mỗi cái chỉ thêm khi đếm vi phạm = 0 | Có | Xoá constraint |
| `0008_comments.sql` | Chú thích DEPRECATED, tham chiếu mềm, 39 cột công tắc | Có | Không cần |

- Mỗi file một transaction. Lỗi là huỷ cả file, database giữ nguyên trạng thái trước file đó.
- Khoá ngoại được thêm trực tiếp ở dạng đã kiểm (`VALID`): bảng lớn nhất 3.002 dòng, thời gian khoá bảng không đáng kể. Không cần `NOT VALID` + `VALIDATE`, không cần `CREATE INDEX CONCURRENTLY`.
- Không tắt ràng buộc để migration chạy qua.

### 6.3 Đổi code

| File | Thay đổi |
|---|---|
| `server/db-map.json` | Thêm `company_settings` |
| `server/store_supa.js` | `getProjData`: đọc 2 khoá cấp công ty từ `company_settings`; `setProjData`: ghi `ptInfo`, `bgOrg` vào đó |
| `server/supa.js` | Bỏ cột generated khi ghi |
| `infra/scripts/migrate.js` | Mới |
| `infra/scripts/sync-from-supabase.js` | Sau khi nạp, chạy lại các bước sửa dữ liệu đã duyệt |

Client không đổi.

### 6.4 Điều kiện hoàn thành đợt 1

Toàn bộ mục 3-6 của [migration-test-plan.md](migration-test-plan.md) đạt; báo cáo đợt có chữ ký duyệt; app local chạy trên `qspro_en2` ít nhất một phiên làm việc không lỗi.

## 7. Đợt 2 - cấu trúc

| Bước | Nội dung | Kiểm tra chính |
|---|---|---|
| 2.1 | `supa.tx()` và bọc 6 thao tác nhiều bước | Giả lập lỗi giữa chừng: không còn dữ liệu dở dang |
| 2.2 | Chốt danh sách cột từng bảng thông số bằng script đối chiếu spec file và dữ liệu | Mọi cột thông số thuộc đúng một bảng |
| 2.3 | Tạo 4 bảng thông số; chép dữ liệu; tạo view `product_catalog` | View trả 1.093 dòng x 141 cột giống hệt `products` trước khi tách |
| 2.4 | `supa.js`: đọc qua view, tách cột khi ghi | Đối chiếu đọc 100%; luồng tạo/sửa/nhập/duyệt/xoá |
| 2.5 | Xoá các cột thông số khỏi `products` | Chỉ sau khi 2.3 và 2.4 đạt |
| 2.6 | Tách `purchase_proposal_items` thành 2 bảng (0 dòng dữ liệu) | Tạo phiếu ck và tt, đọc lại đúng hình dạng cũ |

- **Quay lui đợt 2:** đổi `DATABASE_URL` về database của đợt 1 và hoàn code về tag đợt 1. Vì thế đợt 2 dựng trên một database mới nữa (`qspro_en3`), không sửa đè `qspro_en2`.
- Bước 2.5 là điểm không quay lui bằng SQL đơn giản; bắt buộc có `pg_dump` ngay trước đó.
- Nếu D-06 chọn phương án A (giữ bảng rộng): bỏ 2.2-2.5.

## 8. Đợt 3 - thu gọn

1. `supa.js` bỏ qua 8 cột DEPRECATED còn trong danh sách D-09 khi ghi; phát hành; chạy ổn định ít nhất một chu kỳ.
2. `pg_dump`; kiểm tra lại bằng grep rằng không code nào đọc các cột này.
3. `DROP COLUMN`. Quay lui chỉ bằng khôi phục từ bản sao lưu (các cột đều là dẫn xuất, rỗng hoặc đã chết, nên mất mát thực tế bằng không).

## 9. Cắt chuyển production (phác thảo, sẽ viết riêng)

Chưa lên kế hoạch chi tiết vì còn thiếu: máy chủ PostgreSQL mà Render truy cập được, môi trường staging, quyền đọc catalog Supabase. Các bước dự kiến: (1) dựng PostgreSQL production và staging; (2) diễn tập trên staging bằng bản sao production; (3) khoá ghi trên app cũ; (4) `sync-from-supabase.js` + toàn bộ migration; (5) chạy bộ nghiệm thu; (6) đổi `DATABASE_URL` trên Render; (7) khoá project Supabase cũ (bật RLS hoặc tạm dừng), không xoá trong ít nhất 30 ngày.

## 10. Rủi ro và cách giảm

| Rủi ro | Giảm thiểu |
|---|---|
| Ràng buộc mới chặn một thao tác đang chạy được | Mỗi ràng buộc có test gọi API thật; CHECK chỉ thêm khi dữ liệu hiện có thoả 100%; chạy app trên database mới trước khi coi là xong |
| Lớp `supa.js` trả dữ liệu khác trước | Bộ đối chiếu: cùng một truy vấn chạy trên database trước và sau, so từng dòng từng cột |
| Sửa dữ liệu sai chỗ | Không `DELETE`; `quarantine` + `fix_log`; từng mục cần duyệt |
| Dữ liệu ghi sau khi chuyển bị mất khi quay lui | Quy định khoảng thời gian thử; sau đó quay lui bằng sửa tiến |
| Production và local lệch schema | Chỉ thay đổi schema qua file migration; `schema_migrations` ghi lại đã áp dụng gì |
