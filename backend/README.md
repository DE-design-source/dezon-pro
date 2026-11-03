# QS Pro backend (Go + Gin)

Bản chuyển của `server/` (Node + Express, đã gỡ khỏi repo) sang Go, chạy độc lập: giữ cổng `POST /api/<tênHàm>`
và có REST dưới `/api/v1` (giao diện React `frontend/src/pages/QS` dùng REST). Không cần app Node hay thư mục `public/`:
6 file giao diện tải thẳng từ server (`/vs-spec.js`, `/son-spec.js`, `/ct-spec.js`, `/logo.svg`, `/mau-nhap-hang-loat.xlsx`,
`/mau-nhap-cong-tac.xlsx`)
được nhúng vào binary (go:embed), xem mục "File nhúng" bên dưới.

- Kiến trúc, hợp đồng viết module, khác biệt so với bản Node (mục 10): [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Database, migration: [docs/DATABASE.md](docs/DATABASE.md)
- API: [docs/API.md](docs/API.md) (tính năng mới = route REST "chỉ bản Go", mục 2.1)
- Bảng đối chiếu hàm Node -> module Go (bảng làm việc lúc chuyển mã, tiếng Anh): [docs/PORTING_MAP.md](docs/PORTING_MAP.md)

## Cấu hình

Chép `.env.example` thành `.env` rồi điền. Tối thiểu cần `DATABASE_URL`.

Mọi đường dẫn tương đối tính từ THƯ MỤC ĐANG ĐỨNG (không phải vị trí file chạy), nên luôn chạy từ `backend/`:

- `STATIC_DIR` (TUỲ CHỌN, mặc định trống = tắt): thư mục giao diện cũ kiểu `public/` của app Node, kèm thư viện bảng tính
  dưới `/vendor` lấy từ `VENDOR_DIR` (mặc định `../node_modules`). Chỉ khi đặt `STATIC_DIR` server mới phục vụ hai thư mục đó và
  lúc khởi động ghi log `thiếu <đường dẫn> ...` nếu thiếu `index.html` / thư viện. Không đặt thì không có log nào.

### File nhúng (thay cho `public/`)

| Đường dẫn | Nguồn trong `backend/` | Content-Type | Cache-Control |
|---|---|---|---|
| `/vs-spec.js`, `/son-spec.js`, `/ct-spec.js` | `internal/shared/specs/js/*-spec.js` | `application/javascript; charset=UTF-8` | `no-cache` |
| `/mau-nhap-hang-loat.xlsx` | `internal/modules/categories/assets/` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `public, max-age=0` |
| `/mau-nhap-cong-tac.xlsx` | `internal/modules/estimates/assets/` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `public, max-age=0` |
| `/logo.svg` | `internal/server/assets/` | `image/svg+xml` | `public, max-age=0` |

- Khôi phục nguyên văn từ `public/` của commit cuối còn app Node (test `TestEmbeddedAssets` kiểm mã blob git từng file).
- Header như `express.static` trước đây (GET / HEAD, Range, ETag yếu -> 304); ETag tính theo nội dung, không có `Last-Modified`.
  Bản nhúng đứng trước `STATIC_DIR`, nên luôn thắng nếu thư mục đó cũng có file cùng tên.
- Ba file `*-spec.js` là NGUỒN DUY NHẤT của thông số ngành: sửa xong chạy `node backend/scripts/gen-specs.js` để sinh lại
  `internal/shared/specs/data/*.json`, `testdata/golden.json`, `testdata/sources.json` (test Go báo nếu quên).

### Quy tắc kế thừa `.env` (đọc kỹ trước khi chạy thử)

Server đọc `backend/.env` rồi `../.env` - file cấu hình THẬT của bản Node. Với TỪNG biến, giá trị lấy theo thứ tự:

1. biến đã có trong môi trường (kể cả đặt rỗng) - không bao giờ bị file đè;
2. `backend/.env`;
3. `../.env` của bản Node;
4. mặc định trong code.

Hệ quả: chỉ truyền `PORT` và `DATABASE_URL` thì `AUTH_SECRET`, webhook Lark, khoá Lark vẫn lấy từ `../.env`,
và job báo cáo vẫn BẬT. Một lượt chạy thử trên database thử vẫn có thể gửi tin vào group Lark thật.

Khi đích là database THỬ, LUÔN truyền đủ bộ biến an toàn sau (giá trị phải KHÁC RỖNG: `PURCHASE_WEBHOOK` rỗng nghĩa là
webhook Lark thật ghi sẵn trong code):

| Biến | Giá trị an toàn | Chặn việc gì |
|---|---|---|
| `REPORT_JOB` | `0` | job nền gửi báo cáo lên Lark |
| `PURCHASE_WEBHOOK` | `http://127.0.0.1:9/x` | tin yêu cầu mua hàng / đề xuất |
| `REPORT_WEBHOOK` | `http://127.0.0.1:9/x` | tin báo cáo (hàm `baoCaoNhapSP` gọi tay) |

### Biến của chat (module `chat`, chỉ bản Go)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `CHAT_JWT_SECRET` | trống = `hex(HMAC-SHA256(AUTH_SECRET, "qspro-chat-jwt"))` | khoá ký access token chat (và suy ra khoá băm OTP). Đổi khoá = mọi access token chat hết hiệu lực (refresh token vẫn dùng được) |
| `CHAT_ACCESS_TTL_MIN` | 15 | hạn access token (phút); trống / sai / ≤ 0 = 15 |
| `CHAT_REFRESH_TTL_DAYS` | 30 | hạn refresh token (ngày); trống / sai / ≤ 0 = 30 |
| `CHAT_OTP_DEV` | trống (tắt) | CHỈ giá trị `1` mới bật: API trả luôn mã OTP (`dev_code`), cổng đăng nhập hiện nút "Điền mã". CHỈ dùng khi thử ở máy, không bao giờ bật trên server thật |
| `CHAT_VAPID_PUBLIC_KEY` / `CHAT_VAPID_PRIVATE_KEY` | trống = tắt push | cặp khoá VAPID của Web Push; sinh bằng `go run ./cmd/vapid` (từ `backend/`, in 2 dòng chép vào `.env`). Khoá riêng là bí mật; đổi khoá thì người dùng phải bật lại thông báo |
| `CHAT_VAPID_SUBJECT` | trống = tắt push | `https://<tên miền>` hoặc `mailto:<email>` của bên gửi push (sai dạng -> tắt push, ghi log lúc khởi động) |
| `SMTP_HOST` | trống = tắt email | máy chủ SMTP gửi mã OTP đăng nhập chat bằng email (`platform/mailer`, chỉ thư viện chuẩn) |
| `SMTP_PORT` | 587 | trống / sai / ≤ 0 = 587. Cổng `465` = TLS ngay; cổng khác = kết nối thường rồi STARTTLS nếu máy chủ hỗ trợ |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | trống = không đăng nhập | tài khoản AUTH PLAIN; có `SMTP_USERNAME` thì bắt buộc kết nối đã TLS (trừ `localhost` / `127.0.0.1`). Mật khẩu là bí mật |
| `SMTP_FROM` | trống | địa chỉ người gửi, vd `Dezon Chat <no-reply@dezon.vn>`; phải hợp lệ (sai -> tắt email, ghi log lúc khởi động) |
| `CHAT_S3_ENDPOINT` | trống = tắt tệp chat | địa chỉ MinIO / S3 mà backend gọi, có scheme (`http://minio:9000` trong compose, `http://qspro-minio:9000` ở máy); scheme quyết định SSL (`platform/objstore`, minio-go v7) |
| `CHAT_S3_PUBLIC_URL` | = `CHAT_S3_ENDPOINT` | host trình duyệt dùng cho URL ký sẵn (`https://<S3_DOMAIN>`, ở máy `http://127.0.0.1:9000`). Chữ ký SigV4 gắn host: phải đúng y hệt host trình duyệt gọi |
| `CHAT_S3_ACCESS_KEY` / `CHAT_S3_SECRET_KEY` | bắt buộc khi có endpoint | user ứng dụng (production: `minio-init` tạo, chỉ có quyền trên bucket), không dùng user root. Khoá bí mật |
| `CHAT_S3_BUCKET` / `CHAT_S3_REGION` | `chat-media` / `us-east-1` | bucket riêng tư (không policy ẩn danh), region dùng để ký offline |
| `CHAT_MEDIA_MAX_IMAGE_MB` | 25 | giới hạn 1 ảnh (MB) |
| `CHAT_MEDIA_MAX_FILE_MB` | 100 | giới hạn 1 video / tệp (MB); trên 200 thì hạ về 200 (giới hạn băm SHA-256 ở trình duyệt, khớp `ck_chat_media_size_bytes`) |
| `CHAT_MEDIA_DAILY_MB` | 2048 | tổng MB một người được khai tải lên trong 24 giờ trượt |
| `CHAT_MEDIA_URL_TTL_MIN` | 60 | hạn URL xem / tải tệp (phút), kẹp trong 5..720 |

- Thiếu một trong ba biến `CHAT_VAPID_*` thì push tắt (1 dòng log lúc khởi động), chat realtime vẫn chạy.
- Không đặt `CHAT_S3_ENDPOINT` thì tệp chat (ảnh / video / tệp / thoại) tắt: route `/chat/media/*` và tin nhắn có tệp trả 503 `MEDIA_DISABLED`,
  `GET /chat/media/config` trả `{enabled:false}`, chat chữ vẫn chạy (1 dòng log lúc khởi động `tệp chat tắt: chưa đặt CHAT_S3_ENDPOINT`).
  Cần migration 0020. Bucket cần CORS cho origin của app (`MINIO_API_CORS_ALLOW_ORIGIN` của MinIO) và ILM xoá `chat/in/` sau 1 ngày.
- Chưa có nhà cung cấp SMS: mã OTP được GHI VÀO LOG server (`[chat] OTP cho +84...: 123456`, `logSender`). Server thật chưa gửi được OTP cho
  người dùng cho tới khi nối SMS (roadmap N8.1).
- Không đặt `SMTP_HOST` (hoặc cấu hình SMTP sai) thì mã OTP email cũng GHI VÀO LOG server (`OTP email cho <email>: 123456`, `logMailer`;
  1 dòng log lúc khởi động `email chat tắt: chưa đặt SMTP_HOST, mã OTP email ghi vào log`). Đăng nhập bằng email cần migration 0019.
- `CORS_ORIGINS` (có sẵn) cũng là danh sách origin được mở WebSocket chat (`/api/v1/chat/ws`, bỏ scheme); cùng host với API luôn được.
- Route, token, mã lỗi, giao thức WebSocket: [docs/API.md](docs/API.md) mục 2.1 "Chat".

## Chạy song song / thay bản Node

| Điểm | Chi tiết |
|---|---|
| Cổng | Cả hai mặc định 3000. Chạy cạnh nhau thì đặt `PORT` khác cho bản Go (ví dụ 3998). |
| Database | Không có `backend/.env` thì bản Go lấy `DATABASE_URL` từ `../.env` - CÙNG database với bản Node (trên máy phát triển là database thật). Muốn dùng database khác phải đặt `DATABASE_URL` trong `backend/.env` hoặc trong môi trường. |
| Job báo cáo | `REPORT_JOB` mặc định BẬT: 70 giây sau khi chạy server kiểm tra gửi bù, rồi gửi Lark lúc 8h00 thứ 4 và thứ 7. Hai server cùng database sẽ gửi hai báo cáo (chống trùng qua `audit_log` không chặn được hai tiến trình). Đặt `REPORT_JOB=0` ở ĐÚNG MỘT bên; bản Node không có công tắc này nên khi chạy song song thì tắt ở bản Go. |
| Webhook | `PURCHASE_WEBHOOK` trống = webhook Lark thật ghi sẵn trong code (giống bản Node); `REPORT_WEBHOOK` trống = dùng chung. Chạy thử thì đặt cả hai thành địa chỉ giả. |
| Phiên đăng nhập | Token được ký bằng `AUTH_SECRET` (trống = cùng một khoá mặc định ở cả hai bản). Hai bản cùng `AUTH_SECRET` và cùng database thì token đang dùng ở bản Node có hiệu lực ngay trên bản Go, người dùng không phải đăng nhập lại. |

Chuyển hẳn sang bản Go (`render.yaml` đã gỡ khỏi repo cùng app Node; cấu hình triển khai bản Go chưa có trong repo):

1. Chạy migration nếu còn file chưa áp dụng (xem [docs/DATABASE.md](docs/DATABASE.md)).
2. Dựng image (mục Docker bên dưới), đặt biến môi trường giống bản Node, cùng `AUTH_SECRET`.
3. Tắt bản Node, bật bản Go với `REPORT_JOB` để mặc định (chỉ còn một bên gửi báo cáo).

## Chạy bằng Go cài trên máy (Go 1.25+)

Dùng cấu hình thật của bản Node (database, webhook lấy từ `../.env`; file tải lên ghi vào `UPLOAD_DIR`, mặc định `backend/uploads/`; chỉ dùng khi đã tắt bản Node hoặc đã đặt `REPORT_JOB=0`):

```
cd backend
go run ./cmd/api                 # http://localhost:3000
go run ./cmd/migrate --status    # xem migration
```

Chạy cạnh bản Node trên database thử (PowerShell):

```
cd backend
$env:PORT = '3998'; $env:DATABASE_URL = 'postgresql://qspro:<mật khẩu>@localhost:5434/qspro_gotest'
$env:REPORT_JOB = '0'; $env:PURCHASE_WEBHOOK = 'http://127.0.0.1:9/x'; $env:REPORT_WEBHOOK = 'http://127.0.0.1:9/x'
go run ./cmd/api
```

## Thử chat ở máy

Dùng database thử RIÊNG `qspro_chattest` (container `qspro-postgres`), KHÔNG dùng `.env` / `backend/.env` (trỏ database thật và Lark thật):
`DOTENV=0` rồi truyền đủ biến.

1. Tạo database nếu chưa có (từ gốc repo; `schema.sql` đã gồm 0019 và sổ `schema_migrations`):
   `docker exec qspro-postgres createdb -U qspro qspro_chattest`, `docker cp infra/db/schema.sql qspro-postgres:/tmp/schema.sql`,
   `docker exec qspro-postgres psql -q -U qspro -d qspro_chattest -f /tmp/schema.sql`. Database đã có từ trước: `go run ./cmd/migrate --url=...`.
2. Chạy server (PowerShell, từ `backend/`):

   ```
   $env:DOTENV = '0'; $env:PORT = '3998'
   $env:DATABASE_URL = 'postgresql://qspro:<mật khẩu>@localhost:5434/qspro_chattest'
   $env:AUTH_SECRET = 'test-secret'; $env:REPORT_JOB = '0'
   $env:PURCHASE_WEBHOOK = 'http://127.0.0.1:9/x'; $env:REPORT_WEBHOOK = 'http://127.0.0.1:9/x'
   $env:CORS_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173'
   $env:CHAT_OTP_DEV = '1'
   go run ./cmd/migrate "--url=$env:DATABASE_URL" --status
   go run ./cmd/api
   ```

3. Chạy giao diện (từ `frontend/`): `$env:VITE_API_URL = 'http://localhost:3998'; npm run dev` (biến môi trường thắng
   `frontend/.env.development`, file đó trỏ cổng 3000). Mở `/chat`.
4. Nhiều người dùng = mỗi tab một tài khoản, ngay trong cùng một cửa sổ: tab 1 đăng nhập số thứ nhất, mở tab 2 (cùng
   `http://localhost:5173/chat`), bấm ảnh đại diện cạnh chữ "Chat" (bộ chuyển tài khoản) -> "Thêm tài khoản" rồi đăng nhập số thứ hai
   (vd `0901234567`, `0912345678`): mã OTP hiện ngay ở cổng đăng nhập (`dev_code`) và trong log server. Mọi tài khoản đã đăng nhập nằm
   trong bộ chuyển của mọi tab; mỗi tab nhớ tài khoản của mình (tải lại tab vẫn giữ), đổi tài khoản ở tab này không ảnh hưởng tab khác.
   "Đăng xuất tài khoản này" chỉ đăng xuất tài khoản đang chọn, các tài khoản khác vẫn đăng nhập.
5. Thử push (tuỳ chọn): đặt thêm 3 biến `CHAT_VAPID_*` (`go run ./cmd/vapid`), bấm bật thông báo trong trang Chat. Người nhận chỉ nhận push khi
   KHÔNG có kết nối WebSocket (đã rời trang Chat quá 3 giây hoặc đóng tab). Nhiều tài khoản trong một trình duyệt: mỗi tài khoản bật
   thông báo riêng (cùng một subscription của trình duyệt), thông báo mở đúng tài khoản nhận.
6. Thử tệp chat (ảnh / video / tệp / thoại, tuỳ chọn) với MinIO ở máy. Image chính thức `minio/minio`, `minio/mc` không còn phát hành:
   dựng image `qspro-minio` từ mã nguồn (có cả `minio` lẫn `mc`). Lệnh Git Bash, từ gốc repo, mạng Docker `qspro-net`
   (`MSYS_NO_PATHCONV=1` để Git Bash không đổi đường dẫn `/data`, `/init.sh`):

   ```
   docker build -f infra/docker/minio.Dockerfile -t qspro-minio .
   # trình duyệt dùng 127.0.0.1:9000, backend dùng qspro-minio:9000; console quản trị ở http://127.0.0.1:9001
   # MINIO_API_CORS_ALLOW_ORIGIN phải liệt kê MỌI origin mở giao diện chat (vd thêm http://localhost:5199 nếu dùng cổng đó),
   # thiếu origin thì preflight của PUT từ trình duyệt bị chặn; đổi = docker rm -f qspro-minio rồi chạy lại lệnh dưới (dữ liệu ở volume)
   MSYS_NO_PATHCONV=1 docker run -d --name qspro-minio --network qspro-net -p 127.0.0.1:9000:9000 -p 127.0.0.1:9001:9001 \
     -e MINIO_ROOT_USER=qsprominio -e MINIO_ROOT_PASSWORD=<mật khẩu root, >= 8 ký tự> \
     -e MINIO_API_CORS_ALLOW_ORIGIN=http://localhost:5173,http://127.0.0.1:5173 \
     -v qspro-minio-data:/data qspro-minio
   # bucket + user ứng dụng + ILM chat/in/ (chạy lại được)
   MSYS_NO_PATHCONV=1 docker run --rm --network qspro-net -v "$PWD/infra/deploy/minio-init.sh:/init.sh:ro" --entrypoint sh \
     -e MINIO_URL=http://qspro-minio:9000 -e MINIO_ROOT_USER=qsprominio -e MINIO_ROOT_PASSWORD=<mật khẩu root> \
     -e CHAT_S3_ACCESS_KEY=qspro-chat -e CHAT_S3_SECRET_KEY=<khoá ứng dụng, >= 8 ký tự> qspro-minio /init.sh
   ```

   Rồi chạy server với thêm `CHAT_S3_ENDPOINT=http://qspro-minio:9000` (server chạy NGOÀI Docker: `http://127.0.0.1:9000`),
   `CHAT_S3_PUBLIC_URL=http://127.0.0.1:9000`, `CHAT_S3_ACCESS_KEY=qspro-chat`, `CHAT_S3_SECRET_KEY=<khoá ứng dụng>`, và database đã chạy
   migration 0020 (`go run ./cmd/migrate --url=...`, luôn ghi rõ `--url`, không để mặc định đọc `.env`).
   Container `qspro-api` (image `qspro-backend`) KHÔNG đọc `backend/.env`, chỉ nhận biến `-e`: muốn bật tệp chat thì build lại image,
   xem biến / cổng đang dùng bằng `docker inspect qspro-api` (`.Config.Env`, `.HostConfig.PortBindings`), `docker rm -f qspro-api`, rồi
   `docker run -d --name qspro-api --network qspro-net <đủ -e cũ> -e CHAT_S3_ENDPOINT=... -e CHAT_S3_PUBLIC_URL=... -e CHAT_S3_ACCESS_KEY=...
   -e CHAT_S3_SECRET_KEY=... -v qspro-uploads:/app/uploads <-p cũ> qspro-backend`.
   Trang phải mở từ `localhost` / `127.0.0.1` (hoặc HTTPS): mở bằng IP LAN qua HTTP thì trình duyệt không có `crypto.subtle`, nút đính kèm hiện mờ với chú thích "Cần HTTPS để gửi tệp" (chỉ khi máy chủ đã bật tệp), nút ghi âm ẩn.

## Chạy bằng Docker

Dựng image từ GỐC repo (image cần migration ở `infra/db/migrations`; không cần app Node, `public/` hay `npm`):

```
docker build -f infra/docker/backend.Dockerfile -t qspro-backend .
docker run --rm -p 3000:3000 -e DATABASE_URL=postgresql://user:pass@host:5432/db -e AUTH_SECRET=... qspro-backend
docker run --rm -e DATABASE_URL=postgresql://user:pass@host:5432/db qspro-backend /app/qspro-migrate --status
```

- Image có sẵn `/app/qspro-api`, `/app/qspro-migrate`, `/app/migrations`; spec ngành, logo, file mẫu nằm trong binary.
  Không có file `.env`, chạy bằng user `app`.
- Image đặt sẵn `NODE_ENV=production`: tài liệu API (`/api-docs`, `/api-docs.json`) TẮT; thêm `-e SWAGGER_DOCS=1` để bật.
- Build context được thu gọn bằng `infra/docker/backend.Dockerfile.dockerignore` (BuildKit tự đọc; cần Docker 23+ hoặc `DOCKER_BUILDKIT=1`):
  `.env*`, `.git`, `node_modules`, kết quả test không được gửi vào build.
- Biến cần cho triển khai thật: `DATABASE_URL`, `AUTH_SECRET`, `PURCHASE_WEBHOOK` / `REPORT_WEBHOOK` (trống = webhook thật trong code),
  `UPLOAD_DIR` (kho ảnh / tài liệu trên đĩa, phục vụ công khai tại `/files/<path>`; image đặt `/app/uploads`, gắn volume để giữ file),
  `LARK_APP_ID` / `LARK_APP_SECRET` (ảnh cũ qua `/media`), `CHAT_S3_*` (tệp chat trên MinIO, trống = tắt; compose production
  tự đặt, xem `infra/deploy/docker-compose.yml`),
  `REPORT_JOB=0` nếu còn một server khác gửi báo cáo. Danh sách đầy đủ: `.env.example`.
- Chạy image trên database thử: thêm bộ biến an toàn ở mục Cấu hình (image không có `.env` nhưng webhook mặc định trong code vẫn là webhook thật).

Không cài Go trên máy: dùng container để phát triển.

```
docker run -d --name qspro-go -v <gốc repo>:/repo -w /repo/backend -p 3998:3998 golang:1.25 sleep infinity
docker exec qspro-go go build ./...
docker exec qspro-go go vet ./...
docker exec -e PORT=3998 -e DATABASE_URL=postgresql://qspro:<mật khẩu>@host.docker.internal:5434/qspro_gotest -e REPORT_JOB=0 -e PURCHASE_WEBHOOK=http://127.0.0.1:9/x -e REPORT_WEBHOOK=http://127.0.0.1:9/x qspro-go go run ./cmd/api
```

- Container `qspro-go` đã có thì bỏ dòng `docker run` (dùng `docker start qspro-go` nếu nó đang dừng).
- Trong container, `localhost` là chính container: database chạy trên máy phải gọi qua `host.docker.internal`.
- Repo được gắn vào `/repo` nên quy tắc kế thừa ở mục Cấu hình áp dụng nguyên vẹn: biến nào không truyền bằng `-e` được lấy từ
  `/repo/backend/.env` rồi `/repo/.env` (file thật của bản Node).
- Chạy nền: build ra file rồi chạy bằng `docker exec -d ... qspro-go sh -c "go build -o /tmp/qsapi ./cmd/api && /tmp/qsapi > /tmp/qsapi.log 2>&1"`;
  dừng bằng `docker exec qspro-go pkill qsapi`.

## Kiểm thử

Test Go (trong container; chạy trên máy có Go thì bỏ `docker exec ... qspro-go`):

```
docker exec qspro-go sh -c "go build ./... && go vet ./... && gofmt -l ."     # gofmt -l phải in rỗng
docker exec qspro-go go test -count=1 ./...          # không có TEST_DATABASE_URL: test cần database tự bỏ qua
docker exec -e TEST_DATABASE_URL=postgresql://qspro:<mật khẩu>@host.docker.internal:5434/qspro_gotest qspro-go go test -race -count=1 -p 1 ./...
```

> **Công cụ đối chiếu với bản Node đã gỡ (2026-10-15).** Bộ so vi sai `tests/e2e/diff/`, `smoke.js`, `http-diff.sh`,
> `check-node-sync.sh`, `sync-api-docs.js`, `sync-test-sequences.sh`, `tests/fixtures/{gen-registry,gen-swagger,db-diff-node,db-diff-compare}.js`
> và các script `gen*.js` / `noderef.js` trong `internal/**/testdata/` chỉ chạy được cùng app Node (commit cuối còn Node: `83d264e`)
> nên đã chuyển khỏi repo. Bản sao để khôi phục: `C:/demo/qs-unused-backup-2026-10-15/` (xem `MANIFEST.txt` trong đó), hoặc
> `git show 83d264e:<đường dẫn>` với file đã commit. Dữ liệu mong đợi các script đó đã sinh vẫn nằm trong repo nên `go test` không cần Node.

Hai bộ kiểm tra dùng ở lượt nghiệm thu, theo đúng thứ tự (mỗi bộ bắt đầu từ `qspro_gotest` vừa đặt lại về seed, xem lệnh đặt lại ở mục
"Hạ tầng thử"):

1. Lệnh `go test -race -count=1 -p 1 ./...` ở trên.
2. E2E trên server Go chạy nền với bộ biến an toàn (lệnh "Chạy nền" ở mục Docker, thêm `-e AUTH_SECRET=<giá trị thử>`), rồi từ gốc repo:
   `$env:BASE_URL = 'http://localhost:3998'; $env:TEST_DATABASE_URL = 'postgresql://qspro:<mật khẩu>@localhost:5434/qspro_gotest'; node backend/tests/e2e/test-api-go.js`.
   Đúng: `KẾT QUẢ test-api (http://localhost:3998): 96 đạt, 0 lỗi`. Script cần gói npm `pg` và `bcryptjs`; repo không còn `package.json`
   ở gốc nên phải cài riêng (vd `npm install --no-save pg bcryptjs` trong một thư mục tạm rồi đặt `NODE_PATH` trỏ `node_modules` của thư mục đó).

- `-p 1` BẮT BUỘC khi có database: các gói dùng chung `qspro_gotest`, chạy song song thì gói này thấy dòng tạm của gói kia
  (đã gặp ở `estimates`, `notifications`, `purchasing`).
- `-race` chạy thẳng trên Windows (không qua container) cần gcc 64-bit: gcc mặc định trên PATH của máy phát triển (`C:\MinGW`, 32-bit) báo
  `cc1.exe: sorry, unimplemented: 64-bit mode not compiled in`. Dùng bản MSYS2 (Git Bash):
  `PATH=/c/Users/ADMIN/MSYS2/mingw64/bin:$PATH CC=/c/Users/ADMIN/MSYS2/mingw64/bin/gcc.exe CGO_ENABLED=1 go test -race -count=1 ./internal/modules/chat/...`
  (hoặc chạy trong container `golang:1.25` như trên).
- Test có database của chat (`internal/modules/chat`) cần database đã chạy migration 0018: đặt `DOTENV=0` và
  `TEST_DATABASE_URL=postgresql://qspro:<mật khẩu>@localhost:5434/qspro_chattest` (hoặc `qspro_gotest` sau khi migrate tới 0018); test tự dọn dòng thử.
  Test tệp chat cần thêm migration 0020 (`go run ./cmd/migrate --url=<TEST_DATABASE_URL>`).
- Test `platform/objstore` nói chuyện với MinIO thật, chỉ chạy khi có `TEST_S3_ENDPOINT` / `TEST_S3_ACCESS_KEY` / `TEST_S3_SECRET_KEY`
  (không có thì bỏ qua). Chạy trong container cùng mạng `qspro-net` (Go không cài trên máy):
  `MSYS_NO_PATHCONV=1 docker run --rm --network qspro-net -v <gốc repo>:/src -w /src/backend -v qspro-gomod:/go/pkg/mod -e DOTENV=0
  -e TEST_DATABASE_URL=postgresql://qspro:<mật khẩu>@qspro-db:5432/qspro_chattest -e TEST_S3_ENDPOINT=http://qspro-minio:9000
  -e TEST_S3_ACCESS_KEY=<user> -e TEST_S3_SECRET_KEY=<khoá> golang:1.25-alpine go test -count=1 -p 1 ./internal/modules/chat/... ./internal/server/ ./internal/platform/... ./internal/config/`.
- `./...` gồm cả `tests/integration/server_test.go`; `./internal/...` thì bỏ sót gói này.
- `TEST_DATABASE_URL` chỉ được trỏ tới database THỬ: test có ghi và xoá dữ liệu đánh dấu.
- Mật khẩu database thử: `docker exec qspro-postgres printenv POSTGRES_PASSWORD`.

E2E trên server đang chạy: `node backend/tests/e2e/test-api-go.js` (từ gốc repo) với biến `BASE_URL` (mặc định `http://localhost:3998`)
và `TEST_DATABASE_URL` (chỉ nhận `qspro_gotest` / `qspro_nodetest`); để lại dữ liệu thử trong database.
PowerShell không nhận dạng `BIEN=giatri lenh`; đặt biến trước: `$env:BASE_URL = 'http://localhost:3998'; $env:TEST_DATABASE_URL = '...'; node backend/tests/e2e/test-api-go.js`.

### Hạ tầng thử

- Container Postgres tên `qspro-postgres`, user `qspro`, mật khẩu lấy từ biến `POSTGRES_PASSWORD` của container, mở cổng `5434` trên máy.
- Database `qspro_gotest`. Đặt lại bằng tay (đã tắt server đang nối vào):
  `docker exec qspro-postgres sh -c "dropdb -U qspro --if-exists --force qspro_gotest && createdb -U qspro qspro_gotest && psql -q -U qspro -d qspro_gotest -f /tmp/qspro_seed.sql >/dev/null"`.
- File seed `/tmp/qspro_seed.sql` nằm TRONG container `qspro-postgres` (mất khi tạo lại container). Bản sao bền trong repo:
  `infra/export/qspro_seed.sql` (cùng md5); chép lại bằng `docker cp infra/export/qspro_seed.sql qspro-postgres:/tmp/qspro_seed.sql`.
  `TestDiffGolden` chỉ khớp trên database vừa đặt lại từ file seed này.
- Container `qspro-go` (lệnh ở mục Docker) để build và chạy server Go ở cổng 3998.

### File do test sinh ra

Các biến sau bật việc ghi file kết quả; giá trị phải là đường dẫn TUYỆT ĐỐI
(`go test` đứng ở thư mục của từng gói), nên trỏ vào một thư mục `.out/` (mọi thư mục `.out/` trong `backend/` đã được git bỏ qua):
`DIFF_OUT`, `DIFF_GOLDEN` (platform/database), `CATEGORIES_XLSX_OUT`, `MATERIALS_XLSX_OUT`, `QUOT_XLSX_OUT`, `ESTIMATES_XLSX_OUT`,
`ESTIMATES_DIFF_OUT`, `PURCHASING_DIFF_OUT`, `INTEROP_OUT` (auth), `E2E_OUT`, `E2E_DUMP` (test-api-go.js).

### Dữ liệu mong đợi (golden)

Dữ liệu mong đợi trong `internal/**/testdata/` (khoảng 6 MB) và `tests/fixtures/` được sinh từ mã Node thật và ĐƯỢC LƯU trong repo
để `go test` chạy không cần Node. App Node đã gỡ nên các file này ĐÓNG BĂNG: không sinh lại, không sửa tay (xem `docs/ARCHITECTURE.md`
mục 12.1); các script sinh cũ đã chuyển khỏi repo (ghi chú đầu mục Kiểm thử). Còn dùng được:

- `node backend/scripts/gen-specs.js` (cần Node.js, không cần gói nào): sinh lại `internal/shared/specs/data/*.json` và golden của gói
  `specs` từ `internal/shared/specs/js/*-spec.js`. Sửa một file spec thì chạy lệnh này rồi `go test ./internal/shared/specs ./internal/server`.
- `internal/modules/quotations/testdata/gen-case.js` (không cần gói nào): sinh `case-node.txt` cho `model_test.go`.

## Thư mục

```
cmd/api, cmd/migrate     điểm khởi chạy server và công cụ migration
cmd/vapid                in cặp khoá VAPID cho Web Push của chat (CHAT_VAPID_*)
internal/config          biến môi trường, đọc file .env
internal/server          gin engine, route, file tĩnh, bảng route REST (rest.go), Swagger, cổng /api/:fn (rpc)
internal/middleware      auth, tenant, rbac, cors, rate limit, đọc thân JSON
internal/platform        database (PostgreSQL), storage (kho file trên đĩa, UPLOAD_DIR), redis, logger, webpush (Web Push của chat), mailer (email OTP),
                         objstore (MinIO / S3 cho tệp chat, CHAT_S3_*)
internal/shared          omap, jsval, tenant, actor, response, errors, validator, contracts, qscore, specs, httpx
internal/modules         nghiệp vụ theo module (17 gói kể cả system; chat có gói con realtime = gateway WebSocket)
internal/jobs            job nền (báo cáo nhập sản phẩm)
scripts                  gen-specs.js: sinh specs/data từ *-spec.js
tests/fixtures           dữ liệu đối chiếu tầng dữ liệu, registry, swagger (đóng băng) + jsref.js
tests/integration        test Go trên server đã nối đủ module
tests/e2e                test-api-go.js (E2E trên server Go đang chạy)
docs                     tài liệu
```

Migration và Dockerfile nằm ngoài `backend/`: `infra/db/migrations/` (dùng chung với bản Node), `infra/docker/backend.Dockerfile`.
