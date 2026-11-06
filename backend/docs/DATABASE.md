# Database

PostgreSQL, kết nối bằng `DATABASE_URL`. Tầng truy cập là `internal/platform/database` - bản chuyển 1:1 của `server/supa.js` ở app Node cũ (đã gỡ khỏi repo).

## Tên tiếng Việt trong code, tên tiếng Anh trong database

Code gọi bảng / cột bằng tên tiếng Việt không dấu (`du_an`, `ma_da`, `db_san_pham`...). Database dùng tên tiếng Anh
(`projects`, `project_code`, `products`...). File `internal/platform/database/db-map.json` (bản DUY NHẤT,
nhúng vào binary bằng `go:embed`) là bảng đối chiếu hai chiều: tầng dữ liệu dịch tên khi gửi truy vấn và dịch ngược khi trả kết quả.

Thêm bảng / cột thì sửa thẳng `internal/platform/database/db-map.json`, cùng lúc với migration.

Mỗi mục trong db-map.json:

| Khoá | Ý nghĩa |
|---|---|
| `table` | bảng thật |
| `columns` | cột Việt -> cột Anh (cột không khai báo dùng nguyên tên) |
| `view` + `parts` | bảng tách: đọc qua view nối sẵn, ghi thì tách cột về bảng lõi và các bảng vệ tinh 1-1 (`db_san_pham` = `products` + `product_*_specs`, đọc qua `product_catalog`) |
| `tenant` | bảng con không có `company_id`: `cong_ty_id` là cột ảo tra theo dòng cha (`via` -> `parent`.`key`) |

Danh mục bảng / cột thật được nạp từ `information_schema` ở truy vấn đầu tiên và nạp lại khi gặp bảng / cột lạ
(vừa chạy migration lúc server đang chạy).

## Ngữ cảnh công ty (multi-tenant)

Các bảng trong `database.TenantTables` tự được lọc theo công ty của người đăng nhập (`tenant.TenantID(ctx)`):

`du_an, db_bao_gia, khai_toan, db_san_pham, db_san_pham_history, don_mua_hang, chi_tiet_mua_hang, notifications,
delete_requests, audit_log, users, sp_combo, sp_yeu_thich, cong_tac, de_xuat, chi_tiet_de_xuat_ck, chi_tiet_de_xuat_tt,
cong_tac_history, du_an_data, cai_dat_cong_ty`

- Không có ngữ cảnh (đang login, job nền) hoặc super chưa chọn công ty: không lọc.
- Người không phải super mà không có công ty: lỗi `Tài khoản chưa gắn với công ty nào`.
- `NoScope: true`: bỏ lọc cho lệnh gọi đó.
- INSERT tự gắn `cong_ty_id` cho dòng chưa có; bảng con thì kiểm tra dòng cha thuộc công ty (sai -> lỗi 409 / 23503, không chèn dòng nào).
- 9 bảng `chat_*` (migration 0018, Chat MVP) KHÔNG thuộc công ty và không nằm trong `TenantTables`: tài khoản chat theo số điện thoại HOẶC
  email (0019: `chat_users.email` unique chữ thường, `phone` thôi NOT NULL; `chat_otp_codes` ghi `phone` hoặc `email`, đúng một trong hai), dùng
  chung mọi công ty. Module chat không đi qua tầng này mà viết SQL thô qua `DB.Pool()` (ngoại lệ duy nhất, lý do ở `ARCHITECTURE.md` mục 10.4);
  9 mục `chat_*` trong `db-map.json` chỉ để danh mục tên, không khai `tenant`.

## Chuỗi lọc kiểu PostgREST

`cot=eq.x&cot2=in.(1,2)&or=(a.eq.1,b.is.null)`

Toán tử: `eq neq gt gte lt lte like ilike` (`*` là ký tự đại diện), `is.null|true|false`, `in.(...)`, tiền tố `not.`,
nhóm `and=(...)` / `or=(...)` / `not.and=(...)` lồng nhau được. Giá trị mã hoá bằng `encodeURIComponent` (`database.Eq`).
Sắp xếp: `cot.asc|desc[.nullsfirst|nullslast]`, nhiều cột cách nhau dấu phẩy; tầng dữ liệu tự thêm `id.asc` làm khoá phụ.
UPDATE / DELETE không có điều kiện lọc bị từ chối.

## Lỗi

Lỗi database giữ dạng của PostgREST vì nghiệp vụ nhận biết lỗi theo mã / chuỗi:

```
DB <GET|POST|PATCH|DELETE> <bảng> -> <status> {"code":"...","details":...,"hint":...,"message":"..."}
```

`database.CodeOf(err)` trả mã (`23505`, `42703`, `PGRST100`, `PGRST204`, `PGRST205`...), `database.StatusOf(err)` trả status
(23xxx -> 409, 42501 -> 401, 42P01 -> 404, còn lại 400).

## Kiểu dữ liệu trả về

Kết quả do Postgres dựng thành JSON (`json_agg`) rồi đọc về `[]*omap.Map`: số là `float64`, boolean là `bool`,
`timestamptz` là chuỗi `2026-10-13T04:45:22.349392+00:00` (phiên làm việc đặt `timezone=UTC`), `date` là `YYYY-MM-DD`,
`jsonb` là `*omap.Map` / `[]any`, `uuid` là chuỗi. Thứ tự khoá = thứ tự cột trong database (hoặc thứ tự trong `Select`).

Pool chạy ở chế độ simple protocol của pgx: tham số gửi dạng chữ để Postgres tự suy kiểu theo cột, giống thư viện `pg` mà bản Node cũ dùng.

## Migration

- Bản Go KHÔNG giữ bản sao migration: đọc thẳng `infra/db/migrations/NNNN_ten.sql` ở gốc repo (nguồn duy nhất).
  Bảng `schema_migrations` và cách tính checksum giữ như công cụ migrate cũ của bản Node (`infra/scripts/migrate.js`, đã gỡ),
  nên database từng migrate bằng bản Node chạy tiếp được bằng `go run ./cmd/migrate`.
  Chưa có file `.down.sql`: các migration hiện tại chỉ quay lui được bằng bản sao lưu.
- `infra/db/schema.sql`: toàn bộ cấu trúc hiện tại, dùng để dựng database mới.

```
go run ./cmd/migrate --status      # liệt kê
go run ./cmd/migrate               # chạy các file chưa áp dụng (mỗi file 1 transaction)
go run ./cmd/migrate --baseline    # database dựng từ schema.sql: đánh dấu mọi file là đã áp dụng
go run ./cmd/migrate --url=postgresql://...   # không dùng DATABASE_URL trong .env
go run ./cmd/migrate --dir=duong/dan          # thư mục file SQL (mặc định "../infra/db/migrations", tính từ thư mục đang đứng; biến môi trường MIGRATIONS_DIR đổi mặc định, --dir thắng cả hai; image Docker đặt MIGRATIONS_DIR=/app/migrations)
```

Chạy từ `backend/`. Trong image Docker: `/app/qspro-migrate [--status|--baseline]` (thư mục làm việc `/app` đã có `migrations/`).
Không truyền `--url=` (hoặc truyền rỗng) thì công cụ đọc `.env` rồi `../.env` để lấy `DATABASE_URL`.

Thông báo lỗi thiếu cột / bảng (`HDMig` trong `internal/shared/errors`) vẫn giữ nguyên câu cũ của bản Node:
`Hãy chạy "npm run migrate" rồi khởi động lại server.` Lệnh `npm run migrate` không còn (app Node đã gỡ); lệnh thật là
`go run ./cmd/migrate` (từ `backend/`) hoặc `/app/qspro-migrate` trong image Docker.

Migration mới nhất: `0020_chat_media.sql` (chat gửi ảnh / video / tệp / tin thoại: bảng `chat_media` + cột `chat_messages.media_id` /
`file_name`, `message_type` thêm `image` / `video` / `file` / `voice`), trước đó `0019_chat_email.sql` (chat đăng nhập / tìm bạn bằng email:
cột `email` của `chat_users` / `chat_otp_codes`) và `0018_chat.sql` (9 bảng `chat_*`). Database chưa chạy 0018 thì lúc nạp danh mục server ghi log
`Database thiếu bảng của: chat_... — có vẻ CHƯA chạy migration` (QS vẫn chạy, route chat lỗi 500); chưa chạy 0019 thì đăng nhập / tra bằng email
lỗi 500 (cột `email` chưa có); chưa chạy 0020 thì route `/chat/media/*` và tin có tệp lỗi 500 (bảng `chat_media` chưa có).
`qspro_gotest` / `qspro_chattest` phải migrate tới 0020 trước lượt `go test ./...` đầy đủ.

Thêm thay đổi cấu trúc: viết file mới `infra/db/migrations/NNNN_ten.sql` (không sửa file đã chạy), chạy `go run ./cmd/migrate`, sinh lại `infra/db/schema.sql`,
thêm tên vào `internal/platform/database/db-map.json` (bảng theo công ty: thêm vào `TenantTables` trong `postgres.go`); nếu thêm cột vào
`products` / `product_*_specs` thì tạo lại view `product_catalog` trong cùng migration.

## Đồng bộ với bản Node (lịch sử)

Migration và `schema.sql` dùng chung ở `infra/db/`, không còn phải chép tay. `db-map.json` của bản Go vốn là bản sao chép tay
của bản Node; app Node đã gỡ khỏi repo nên bản Go nay là bản DUY NHẤT (script so `check-node-sync.sh` đã gỡ ngày 2026-10-15).
Bản gốc cũ lấy bằng `git show 83d264e:server/db-map.json`:

| Bản gốc (Node) | Bản sao (Go) |
|---|---|
| `server/db-map.json` | `backend/internal/platform/database/db-map.json` |

## Database thử

Test tích hợp dùng database `qspro_gotest` trong container `qspro-postgres` (cổng 5434 trên máy), đặt lại từ file seed
`/tmp/qspro_seed.sql` trong container (bản sao bền: `infra/export/qspro_seed.sql`). Test Go có database phải chạy với `-p 1` vì mọi gói dùng chung `qspro_gotest`.
Chi tiết: mục Kiểm thử của `backend/README.md`.

## Đối chiếu với bản Node (lịch sử)

`tests/fixtures/db-diff-cases.json` có 110 ca (bảng thường, bảng thuộc công ty có / không lọc, bảng tách kể cả cột vệ tinh,
bảng con với `cong_ty_id` ảo, mọi toán tử lọc, sắp xếp + giới hạn, các ca lỗi). Hồi app Node còn trong repo, các ca này đã chạy qua
`server/supa.js` và qua bản Go, kết quả giống nhau từng byte sau khi che id và thời điểm sinh tự động; kết quả của bản Node lưu thành
golden `tests/fixtures/db-diff-golden.txt`, nay chỉ so bản Go với golden đó (`TestDiffGolden`). Cách chạy: mục 9 của `ARCHITECTURE.md`
(đường dẫn `DIFF_OUT` / `DIFF_GOLDEN` phải tuyệt đối; `TestDiffGolden` chỉ khớp trên database vừa đặt lại về seed).
