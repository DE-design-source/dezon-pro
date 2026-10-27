# QS Pro (Dezon Pro) - hướng dẫn cho người mới

QS Pro là web app bóc tách khối lượng, báo giá, mua hàng cho nhiều công ty dùng chung (multi-tenant).
Làm lần lượt từ bước 1 đến bước 6 là chạy được đầy đủ trên máy của bạn: database có dữ liệu, backend, frontend.

## 0. Tổng quan

```
Trình duyệt  --->  Frontend (React + Vite)  --->  Backend (Go + Gin)  --->  Database (PostgreSQL 17)
                   http://localhost:5173           http://localhost:3000     localhost:5432 (chạy trong Docker)
                   thư mục frontend/               thư mục backend/          dữ liệu: infra/export/qspro_dev.sql
```

| Thư mục | Nội dung |
|---|---|
| `backend/` | Server Go. `cmd/api` là máy chủ API, `cmd/migrate` là công cụ chạy migration, `internal/` là nghiệp vụ chia theo module. Tài liệu riêng: `backend/README.md`, `backend/docs/` |
| `frontend/` | App React + Vite tên "SiteFlow". Module QS Pro nằm ở `frontend/src/pages/QS`, mở ở đường dẫn `/qs` |
| `infra/db/migrations/` | Các file thay đổi cấu trúc database, đánh số `NNNN_ten.sql`. Nguồn duy nhất, backend đọc thẳng thư mục này |
| `infra/db/schema.sql` | Cấu trúc database hiện hành (không có dữ liệu), dùng khi muốn dựng database trống |
| `infra/export/qspro_dev.sql` | **Bản dữ liệu dùng để phát triển** (cấu trúc + dữ liệu: sản phẩm, dự án, công ty, tài khoản) |
| `infra/export/qspro_seed.sql` | Bản dữ liệu cũ hơn (13/10), chỉ dùng để đặt lại database thử `qspro_gotest` cho test Go (xem `backend/README.md` mục Kiểm thử). Phát triển thì dùng `qspro_dev.sql` |
| `infra/docker/` | Dockerfile của backend |
| `infra/scripts/` | Script vận hành: `migrate.js` (chạy migration bằng Node), `backup-db.sh` / `restore-db.sh` (sao lưu / khôi phục database + kho file trên máy chủ), `create-super.sh` (tạo tài khoản super). Không cần để chạy dự án |
| `docs/` | Tài liệu: `03-san-pham/roadmap.md` (lộ trình, trạng thái tính năng), `03-san-pham/flows/` (quy trình nghiệp vụ), `02-ky-thuat/` (kỹ thuật, database) |

Bản Node.js cũ (`server/`, `public/`) đã gỡ khỏi repo; backend Go thay thế hoàn toàn.

> **Dữ liệu thật:** các file trong `infra/export/` chứa thông tin khách hàng và mật khẩu đã băm. Chỉ dùng trong repo private,
> không gửi ra ngoài, và luôn chạy máy phát triển với webhook giả như bước 4.

## 1. Cài công cụ

Cài 4 công cụ sau, rồi mở terminal MỚI và kiểm tra bằng lệnh bên phải:

| Công cụ | Phiên bản | Kiểm tra |
|---|---|---|
| Git | bất kỳ | `git --version` |
| Docker Desktop | bản mới, đang chạy (biểu tượng cá voi không báo lỗi) | `docker info` |
| Go | 1.25 trở lên | `go version` |
| Node.js (kèm npm) | 18 trở lên (đã chạy với 22) | `node -v` và `npm -v` |

Mọi lệnh trong hướng dẫn chạy được trong cả **PowerShell** lẫn **Git Bash**, trừ chỗ ghi rõ.

## 2. Lấy code

```
git clone <địa chỉ repo>
cd QS-pro
```

Từ đây gọi thư mục `QS-pro` là **thư mục gốc repo**. Các lệnh ghi "từ thư mục gốc" thì chạy ở đó.

## 3. Dựng database

### 3.1 Tạo container PostgreSQL

Từ thư mục gốc:

```
docker run -d --name qspro-db -e POSTGRES_USER=qspro -e POSTGRES_PASSWORD=qspro_local -e POSTGRES_DB=qspro -p 5432:5432 -v qspro-db-data:/var/lib/postgresql/data postgres:17-alpine
```

- Lệnh này tạo database `qspro`, user `qspro`, mật khẩu `qspro_local`, mở ở cổng 5432 của máy bạn.
- Báo lỗi cổng 5432 đã bị dùng (thường do đã cài PostgreSQL khác): đổi `-p 5432:5432` thành `-p 5434:5432`
  và ở MỌI chỗ bên dưới thay `localhost:5432` bằng `localhost:5434`.
- Kiểm tra: `docker ps` có dòng `qspro-db ... Up`.

### 3.2 Nạp dữ liệu

Từ thư mục gốc, chạy 2 lệnh:

```
docker cp infra/export/qspro_dev.sql qspro-db:/tmp/data.sql
docker exec qspro-db psql -U qspro -d qspro -v ON_ERROR_STOP=1 -q -f /tmp/data.sql
```

Lệnh thứ hai chạy vài giây và không in gì là thành công.

Kiểm tra dữ liệu đã vào:

```
docker exec qspro-db psql -U qspro -d qspro -c "select (select count(*) from products) as san_pham, (select count(*) from projects) as du_an, (select count(*) from companies) as cong_ty, (select count(*) from users) as tai_khoan;"
```

Kết quả phải là các con số khác 0 (khoảng 1.000 sản phẩm, vài chục dự án).

Muốn làm lại từ đầu (xoá sạch rồi nạp lại):

```
docker exec qspro-db sh -c "dropdb -U qspro --force qspro && createdb -U qspro qspro"
```

rồi chạy lại 2 lệnh nạp ở trên.

### 3.3 Áp migration mới hơn bản dữ liệu

Bản dữ liệu được xuất tại một thời điểm; sau đó có thể đã có thêm migration. Từ thư mục gốc:

```
cd backend
go run ./cmd/migrate --url=postgresql://qspro:qspro_local@localhost:5432/qspro
go run ./cmd/migrate --status --url=postgresql://qspro:qspro_local@localhost:5432/qspro
```

Lần đầu `go run` sẽ tải thư viện, mất 1-2 phút. Lệnh `--status` phải in mọi dòng là `đã chạy`.

### 3.4 Đặt mật khẩu để đăng nhập

Bản dữ liệu mang theo tài khoản của hệ thống gốc, bạn không biết mật khẩu của chúng. Xem danh sách:

```
docker exec qspro-db psql -U qspro -d qspro -c "select username, role, is_active, company_id is not null as co_cong_ty from users order by role, username;"
```

Đặt mật khẩu `DoiMatKhau@123` cho mọi tài khoản trên máy của bạn (chỉ ảnh hưởng database trên máy bạn):

```
docker exec qspro-db psql -U qspro -d qspro -c "update users set password_hash = 'DoiMatKhau@123', is_active = true;"
```

- Mật khẩu ghi thẳng như trên được server chấp nhận ở lần đăng nhập đầu và tự đổi sang dạng băm bcrypt.
- Vai trò: `super` là quản trị hệ thống (thấy mọi công ty, có tab Công ty), `admin` là quản trị một công ty (có tab Admin),
  `staff` là nhân viên. Thử nghiệp vụ thường thì đăng nhập bằng một tài khoản `admin`; quản lý công ty thì dùng `super`.

### 3.5 (Không bắt buộc) Database trống, không có dữ liệu

Chỉ làm khi bạn cần database sạch thay cho bước 3.2-3.4. Từ thư mục gốc:

```
docker exec qspro-db sh -c "dropdb -U qspro --force qspro && createdb -U qspro qspro"
docker cp infra/db/schema.sql qspro-db:/tmp/schema.sql
docker exec qspro-db psql -U qspro -d qspro -v ON_ERROR_STOP=1 -q -f /tmp/schema.sql
docker exec qspro-db psql -U qspro -d qspro -c "insert into users (username, full_name, password_hash, role, is_active) values ('admin', 'Quan tri he thong', 'DoiMatKhau@123', 'super', true);"
```

Sau đó chạy bước 3.3. Đăng nhập bằng `admin` / `DoiMatKhau@123` (vai trò `super`), vào tab **Công ty** để tạo công ty
và tài khoản admin của công ty; admin công ty tạo nhân viên ở tab **Admin**. `username` luôn viết thường.

## 4. Chạy backend (Go)

### 4.1 Tạo file cấu hình

Từ thư mục gốc:

```
cd backend
cp .env.example .env
```

(PowerShell: `Copy-Item .env.example .env`)

Mở `backend/.env`, sửa các dòng sau (các dòng khác giữ nguyên):

```
PORT=3000
DATABASE_URL=postgresql://qspro:qspro_local@localhost:5432/qspro
AUTH_SECRET=chuoi-bi-mat-bat-ky-cua-may-ban
CORS_ORIGINS=http://localhost:5173,http://localhost:5174

REPORT_JOB=0
PURCHASE_WEBHOOK=http://127.0.0.1:9/x
REPORT_WEBHOOK=http://127.0.0.1:9/x
```

Ý nghĩa:

| Biến | Vì sao |
|---|---|
| `DATABASE_URL` | trỏ tới database ở bước 3 |
| `AUTH_SECRET` | khoá ký token đăng nhập; mỗi máy tự đặt một chuỗi bất kỳ |
| `CORS_ORIGINS` | địa chỉ trang frontend được phép gọi API; phải trùng ĐÚNG giao thức + host + cổng của Vite |
| `REPORT_JOB=0` | tắt job tự gửi báo cáo lên group Lark |
| `PURCHASE_WEBHOOK`, `REPORT_WEBHOOK` | địa chỉ giả. Để trống thì backend dùng webhook Lark THẬT ghi sẵn trong code, tin sẽ vào group thật |
| `UPLOAD_DIR` (để trống) | thư mục lưu ảnh / tài liệu tải lên, phục vụ ở `/files/...`. Trống = `uploads` tính từ thư mục chạy, tức `backend/uploads` (đã có trong `.gitignore`, không commit) |

Danh sách đầy đủ các biến: `backend/.env.example`. File `.env` không được commit (đã có trong `.gitignore`).

### 4.2 Chạy

Từ thư mục `backend/`:

```
go run ./cmd/api
```

Thành công khi terminal in `QS Pro chạy tại http://localhost:3000` và không có dòng lỗi màu đỏ. Để nguyên terminal này
(tắt server bằng `Ctrl+C`).

Kiểm tra trên trình duyệt:

- http://localhost:3000/healthz hiện `{"ok":true}`
- http://localhost:3000/api-docs hiện Swagger (danh sách API, thử gọi được ngay)

## 5. Chạy frontend (React)

Mở một terminal MỚI (backend vẫn đang chạy ở terminal cũ).

### 5.1 Cài thư viện và cấu hình

Từ thư mục gốc:

```
cd frontend
npm install
```

Tạo file `frontend/.env.development` với đúng một dòng:

```
VITE_API_URL=http://localhost:3000
```

Đây là địa chỉ backend ở bước 4, không có dấu `/` ở cuối.

### 5.2 Chạy

Từ thư mục `frontend/`:

```
npm run dev -- --port 5173 --strictPort
```

Thành công khi terminal in `Local: http://localhost:5173/`.

### 5.3 Mở app

1. Mở http://localhost:5173/qs
2. Đăng nhập bằng một tài khoản ở bước 3.4 và mật khẩu `DoiMatKhau@123`.
3. Thấy Bảng điều khiển với danh sách dự án là chạy đủ cả 3 phần.

Các trang khác của SiteFlow (http://localhost:5173/) chạy độc lập, không cần backend.

## 6. Những lần sau

Mỗi lần mở máy làm việc:

```
docker start qspro-db                      # database
cd backend  && go run ./cmd/api            # terminal 1: backend
cd frontend && npm run dev -- --port 5173 --strictPort   # terminal 2: frontend
```

Sau khi `git pull` code mới:

1. Từ `backend/`: `go run ./cmd/migrate --url=postgresql://qspro:qspro_local@localhost:5432/qspro` (áp migration người khác vừa thêm).
2. Từ `frontend/`: `npm install` (nếu `package.json` thay đổi).
3. Khởi động lại backend và frontend.

## 7. Kiểm thử trước khi gửi code

Backend, từ `backend/`:

```
go build ./...
go vet ./...
gofmt -l .
go test -count=1 -p 1 ./...
```

`gofmt -l .` không in gì là đạt. Test cần database tự bỏ qua khi không có `TEST_DATABASE_URL`. Muốn chạy đủ:

1. Tạo database thử (tên PHẢI có chữ `test`):
   `docker exec qspro-db createdb -U qspro qspro_test`, rồi nạp dữ liệu vào nó như bước 3.2 (thay `-d qspro` bằng `-d qspro_test`).
2. Đặt biến `TEST_DATABASE_URL=postgresql://qspro:qspro_local@localhost:5432/qspro_test` (PowerShell: `$env:TEST_DATABASE_URL = "..."`),
   rồi chạy lại `go test -count=1 -p 1 ./...`.

Không bao giờ trỏ `TEST_DATABASE_URL` vào database đang dùng: test có ghi và xoá dữ liệu. `-p 1` là bắt buộc vì các gói test
dùng chung một database.

Frontend, từ `frontend/`: `npm run build` phải chạy không lỗi.

## 8. Quy tắc làm việc nhóm

- **Nhánh:** mỗi việc một nhánh, gửi pull request; không đẩy thẳng lên `main`.
- **Không commit** `backend/.env`, `frontend/.env.development` hay bất kỳ file `.env` nào; chỉ commit `.env.example` khi thêm biến mới.
- **Đổi cấu trúc database:**
  1. Viết file MỚI `infra/db/migrations/NNNN_ten.sql` với số kế tiếp. Không sửa file đã có (công cụ migrate kiểm checksum và sẽ từ chối).
  2. Chạy `go run ./cmd/migrate` trên database của bạn.
  3. Cập nhật lại `infra/db/schema.sql`.
  4. Nếu thêm cột mà code dùng: thêm cặp tên vào `backend/internal/platform/database/db-map.json`
     (code dùng tên tiếng Việt không dấu, database dùng tên tiếng Anh).
  Quy tắc thiết kế bảng: `docs/02-ky-thuat/database/database-rules.md`.
- **Thêm API:** theo quy ước module trong `backend/docs/ARCHITECTURE.md`; route REST khai ở `backend/internal/server/rest.go`;
  bảng route: `backend/docs/API.md`.
- **Giao diện QS:** sửa trong `frontend/src/pages/QS`; không sửa các module khác của SiteFlow khi việc không liên quan.
- **Lộ trình:** mỗi việc gắn với một mã trong `docs/03-san-pham/roadmap.md` (M... / N...). Làm xong và đã kiểm thử thì cập nhật
  roadmap theo `.claude/rules/docs/roadmap-sync.md`.
- **Ngôn ngữ:** tên nghiệp vụ trong code là tiếng Việt không dấu; chú thích và chữ trên giao diện là tiếng Việt có dấu.
- `CLAUDE.md` và `.claude/rules/` còn một phần mô tả bản Node cũ (lệnh `npm test`, thư mục `server/`, `public/`).
  Khi khác với README này thì theo README này.

## 9. Sự cố thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `docker: ... port is already allocated` ở bước 3.1 | cổng 5432 bận: dùng `-p 5434:5432` và đổi `localhost:5432` thành `localhost:5434` ở mọi chỗ |
| `docker: Error ... Conflict. The container name "/qspro-db" is already in use` | container đã có từ trước: dùng `docker start qspro-db` |
| Lỗi khi nạp `qspro_dev.sql` (`already exists`) | database không trống: chạy lệnh "làm lại từ đầu" ở bước 3.2 rồi nạp lại |
| Backend báo không kết nối được database | `docker start qspro-db`; kiểm tra cổng trong `DATABASE_URL` |
| Lỗi nhắc chạy `npm run migrate` / thiếu cột | database thiếu migration: chạy lệnh ở bước 3.3 (bản Go thay cho lệnh npm cũ), khởi động lại backend |
| Trang QS hiện "Chưa cấu hình VITE_API_URL" | thiếu `frontend/.env.development` (bước 5.1); tạo xong phải khởi động lại `npm run dev` |
| Trang QS hiện "Không kết nối được máy chủ QS" | backend chưa chạy, hoặc cổng trong `VITE_API_URL` sai |
| Trình duyệt báo lỗi CORS (F12 > Console) | `CORS_ORIGINS` trong `backend/.env` thiếu đúng địa chỉ trang đang mở (vd `http://localhost:5173`); sửa rồi khởi động lại backend |
| Đăng nhập báo sai tài khoản hoặc mật khẩu | chạy lại lệnh đặt mật khẩu ở bước 3.4; `username` viết thường |
| `Port 5173 is in use` khi chạy frontend | tắt chương trình đang dùng cổng 5173, hoặc chạy cổng khác (`--port 5174`) và bảo đảm cổng đó có trong `CORS_ORIGINS` |
| `go: ... requires go >= 1.25` | cập nhật Go (bước 1) |

## 10. Tài liệu thêm

- `backend/README.md`: chạy backend bằng Docker, biến môi trường, các bộ test của backend.
- `backend/docs/ARCHITECTURE.md`: kiến trúc backend, quy ước viết module.
- `backend/docs/API.md`: bảng route REST `/api/v1`.
- `docs/03-san-pham/roadmap.md`: lộ trình và trạng thái từng tính năng.
- `docs/03-san-pham/flows/`: quy trình nghiệp vụ (QT-01 đến QT-18).
- `docs/02-ky-thuat/database/`: thiết kế database, quy tắc, từ điển dữ liệu.
