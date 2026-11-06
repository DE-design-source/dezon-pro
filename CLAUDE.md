# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

QS Pro (Dezon Pro): web app bóc tách khối lượng / báo giá, nhiều công ty dùng chung (multi-tenant).
Backend Go + Gin (`backend/`, go.mod riêng), giao diện React + Vite (`frontend/`, `siteflow-ui`), dữ liệu trên PostgreSQL qua `DATABASE_URL`;
file ảnh / tài liệu lưu trên ổ đĩa máy chủ (`UPLOAD_DIR`, phục vụ ở `/files/...`), tệp chat trên MinIO (`CHAT_S3_*`).
Tên trong code, chú thích, chuỗi giao diện là tiếng Việt: giữ nguyên khi sửa. `export/` và `infra/export/` chứa dump dữ liệu thật,
đã gitignore, không commit.
Sửa thông số theo ngành (`backend/internal/shared/specs/js/*-spec.js`): dùng skill `thiet-bi-ve-sinh`; sửa xong chạy
`node backend/scripts/gen-specs.js` rồi `go test ./internal/shared/specs ./internal/server` (từ `backend/`).

## Lệnh

```bash
# backend (chạy từ backend/; Go 1.25+, hoặc trong container golang:1.25 - xem backend/README.md)
go run ./cmd/api                          # http://localhost:3000
go run ./cmd/migrate --status             # xem migration; bỏ --status = chạy file chưa áp dụng
go run ./cmd/migrate --url=postgresql://...   # chỉ định database, không đọc .env
go run ./cmd/vapid                        # sinh cặp khoá VAPID cho Web Push của chat
go build ./... && go vet ./... && gofmt -l .  # gofmt -l phải in rỗng
go test -count=1 ./...                    # không có TEST_DATABASE_URL: test cần database tự bỏ qua
TEST_DATABASE_URL=postgresql://.../qspro_gotest go test -race -count=1 -p 1 ./...   # -p 1 BẮT BUỘC khi có database

# frontend (chạy từ frontend/)
npm install
npm run dev                               # Vite; VITE_API_URL trỏ backend (frontend/.env.development, mẫu .env.example)
npm run build
npm run test:hr                           # node scripts/check-hr-summary.mjs

node backend/scripts/gen-specs.js         # sinh lại specs/data + golden sau khi sửa *-spec.js
```

- `backend/` đọc `backend/.env` rồi `../.env`; hai file này ở máy phát triển có thể trỏ database THẬT và webhook Lark thật.
  Chạy thử luôn đặt `REPORT_JOB=0`, `PURCHASE_WEBHOOK` / `REPORT_WEBHOOK` về địa chỉ giả khác rỗng (vd `http://127.0.0.1:9/x`;
  rỗng = webhook thật ghi sẵn trong code), hoặc `DOTENV=0` rồi truyền đủ biến. Xem `backend/README.md` mục Cấu hình.
- `TEST_DATABASE_URL` chỉ trỏ database THỬ (`qspro_gotest`, `qspro_chattest` trong container `qspro-postgres`): test ghi và xoá dữ liệu.
  Không verify bằng cách ghi dữ liệu qua server đang chạy với `.env` thật.
- Backend phải liệt kê origin của frontend trong `CORS_ORIGINS`.
- E2E trên server Go đang chạy: `node backend/tests/e2e/test-api-go.js` (cần gói `pg`, `bcryptjs` cài riêng, xem `backend/README.md` mục Kiểm thử).

## Kiến trúc

**Backend (`backend/`, chi tiết: `backend/docs/ARCHITECTURE.md`, `API.md`, `DATABASE.md`):**
- `cmd/api` (server), `cmd/migrate` (migration), `cmd/vapid`. `internal/config` (biến môi trường, đọc `.env`).
- `internal/server/routes.go`: NƠI DUY NHẤT nối các module (khối "MODULE WIRING"). `internal/server/rest.go`: bảng `RestRoutes` /
  `RootRoutes`. `internal/server/rpc/`: cổng tương thích `POST /api/:fn` (body `{args:[...]}`) + Registry với quyền
  `Login` / `Public` / `Admin` / `Super` / `SelfAuth`.
- `internal/modules/<module>/`: nghiệp vụ, mỗi module 1 gói (`service.go`, `repository.go`, `postgres.go`, `dto.go`, `handler.go`, `*_test.go`).
  Module không import gói module khác (ngoại lệ: gói dữ liệu thuần `categories`): gọi chéo qua interface trong `internal/shared/contracts`, nối trong `routes.go`.
- Tính năng mới là route REST "chỉ bản Go" dưới `/api/v1` (`reg.RegisterGoRoute` + gắn route gin cùng middleware quyền, `backend/docs/API.md` mục 2.1).
  KHÔNG thêm hàm `/api/:fn`, không thêm dòng vào `RestRoutes` / `RootRoutes`, không sửa tay fixture / golden đóng băng
  (`tests/fixtures/*`, `internal/**/testdata/*`, `internal/server/apidocs/*`, `tests/e2e/**`; `backend/docs/ARCHITECTURE.md` mục 12.1).
- `internal/middleware/` (auth, tenant, rbac, cors, rate limit, body). Phiên: token `Authorization: Bearer`, lưu phía máy chủ (`user_sessions`).
  Super không có công ty, thấy mọi công ty trừ khi gửi header `x-view-company`.
- `internal/platform/database/`: tầng dữ liệu duy nhất (`Select` / `Insert` / `Update` / `Remove` + chuỗi lọc PostgREST như `ma_du_an=eq.X`,
  `Tx` cho transaction). Dịch tên bảng/cột **tiếng Việt trong code -> tiếng Anh trong DB** theo `db-map.json` (bản duy nhất, nhúng go:embed),
  và **tự lọc theo công ty** với bảng trong `TenantTables` (`postgres.go`). Bảng mới theo công ty PHẢI thêm vào `TenantTables`,
  nếu không dữ liệu lộ sang công ty khác. `NoScope` bỏ lọc, chỉ dùng cho truy cập xuyên công ty thật sự (đăng nhập, phiên).
  Ngoại lệ có chủ ý: module `chat` viết SQL thô qua `DB.Pool()` (bảng `chat_*` không thuộc công ty).
- `internal/platform/` còn có `storage` (kho file `UPLOAD_DIR`), `objstore` (MinIO), `webpush`, `mailer`, `redis`, `logger`.
  `internal/shared/` (omap, jsval, tenant, actor, response, errors, validator, contracts, qscore, specs, httpx). `internal/jobs/` (job nền).
- Sản phẩm (`db_san_pham` trong code) = bảng lõi `products` + bảng thông số theo ngành `product_*_specs`, đọc qua view `product_catalog`.
  Thêm cột thông số phải tạo lại view trong cùng migration.
- File nhúng go:embed phục vụ ở gốc: `/vs-spec.js`, `/son-spec.js`, `/ct-spec.js`, `/dl-spec.js`, `/logo.svg`, `/mau-nhap-hang-loat.xlsx`, `/mau-nhap-cong-tac.xlsx`.
- Swagger UI ở `/api-docs` (`SWAGGER_DOCS=0/1`; `NODE_ENV=production` thì mặc định tắt).

**Giao diện (`frontend/src/`):** `App.jsx`, `main.jsx`, `pages/<Trang>/` (QS, Chat, DuAn, MuaHang, ChamCong, ...), `components/` (layout, ui, hr, kanban),
`services/`, `context/`. QS Pro ở `pages/QS/`: `api/` (gọi REST `/api/v1`, `http.js`), `lib/` (hàm thuần: `calc.js`, `format.js`, `tree.js`...),
`state/`, `session/`, `components/`.

**Bất biến dễ vỡ:**
- Công thức giá 1 dòng có 2 bản: server `calc` (`backend/internal/modules/takeoff/service.go`) và client `recalcLine_()` / `giaDaiLy_()` /
  `donGiaCK_()` (`frontend/src/pages/QS/lib/calc.js`). Sửa bên này phải sửa bên kia.
- Đọc số người dùng gõ: client `tkNum_()` (`frontend/src/pages/QS/lib/format.js`), server `qscore.ToNumber`; hai hàm phải cho cùng kết quả.
- Mã tờ bìa = mã cây hạng mục `TREE` (`frontend/src/pages/QS/lib/tree.js`).
- JSON ra client qua `response` / `omap` (giữ thứ tự khoá, không dùng `c.JSON`), ép kiểu qua `jsval`,
  thông báo lỗi tiếng Việt giữ nguyên từng byte (`backend/docs/ARCHITECTURE.md` mục 2).
- Thông số ngành chỉ có một nguồn: `backend/internal/shared/specs/js/{vs,son,ct,dl}-spec.js` (golden kiểm sau gen-specs);
  `TestEmbeddedAssets` kiểm mã blob git của file nhúng.

## Database / migration

- Hạ tầng gom ở `infra/`: `infra/db/` (migration, `schema.sql`, `baseline.sql`), `infra/docker/` (Dockerfile backend / frontend / minio),
  `infra/deploy/` (triển khai VPS), `infra/scripts/` (sao lưu / khôi phục database + kho file, `create-super.sh`, seed demo).
- Thêm cột / bảng: file mới `infra/db/migrations/NNNN_ten.sql` (không sửa file đã chạy, migrate kiểm checksum)
  -> `go run ./cmd/migrate --url=<database>` (từ `backend/`) -> sinh lại `infra/db/schema.sql` (bản `pg_dump`) -> thêm cặp
  `"ten_trong_code": "name_in_db"` vào `backend/internal/platform/database/db-map.json` -> bảng theo công ty thêm vào `TenantTables`.
- Server Go KHÔNG tự migrate: migrate trước rồi mới khởi động bản mới; server đang chạy phải khởi động lại để nạp lại danh mục cột.
  Trong image Docker: `/app/qspro-migrate [--status|--baseline]`. Thông báo lỗi thiếu cột (`HDMig`, `internal/shared/errors/colerr.go`)
  còn ghi lệnh cũ `npm run migrate`: lệnh thật là `go run ./cmd/migrate`.
- Bảng con không có `company_id`: công ty lấy qua bảng cha (khoá `tenant` trong `db-map.json`).
- Quy tắc thiết kế bảng: `docs/02-ky-thuat/database/database-rules.md`. Schema đang chạy: `docs/02-ky-thuat/database/schema-hien-hanh.md`.

## Deploy

- Production: VPS CloudFly, https://dezon.tech. Docker Compose ở `infra/deploy/` (`docker-compose.yml`, `Caddyfile`, `.env` từ `.env.example`).
- Máy chủ mới: `bash infra/deploy/setup-server.sh` (1 lần). Cập nhật: `bash infra/deploy/deploy.sh` (git pull + build + sao lưu database +
  migration + khởi động lại) hoặc `--no-pull`. Hướng dẫn đầy đủ: `docs/04-van-hanh/trien-khai-vps-cloudfly.md`.

Roadmap: `docs/03-san-pham/roadmap.md` (cập nhật theo `roadmap-sync.md`).
