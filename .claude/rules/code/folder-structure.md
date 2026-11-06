# Folder Structure - QS Pro

> **Level:** MANDATORY.
> **Rule:** File mới phải đặt đúng vị trí theo layout HIỆN CÓ của repo. Không tự chế layout riêng,
> không refactor layout chỉ để khớp một chuẩn bên ngoài (trừ khi user yêu cầu rõ).

Stack: backend Go 1.25 + Gin (`backend/`, module `qspro-backend`) · giao diện React 18 + Vite (`frontend/`, gói `siteflow-ui`,
gọi backend qua `VITE_API_URL`) · dữ liệu trên **PostgreSQL** (pgx, nối qua `DATABASE_URL`); file ảnh / tài liệu lưu trên ổ đĩa máy chủ
(`UPLOAD_DIR`, phục vụ ở `/files/...`); tệp chat trên MinIO / S3. Sơ đồ chi tiết của backend: `backend/docs/ARCHITECTURE.md` mục 1,
vai trò file trong module: mục 4. App Node cũ (`server/`, `public/`, `package.json` gốc) đã gỡ ở commit `5fa5d52`.

---

## Layout

```
backend/                         # Go + Gin, go.mod riêng; chạy mọi lệnh từ backend/
├── cmd/api/main.go              # điểm khởi chạy server (go run ./cmd/api)
├── cmd/migrate/main.go          # chạy migration (go run ./cmd/migrate [--url=... --status --baseline])
├── cmd/vapid/main.go            # in cặp khoá VAPID cho Web Push của chat
├── internal/
│   ├── config/                  # biến môi trường, đọc .env (LoadDotenv)
│   ├── server/
│   │   ├── routes.go            # NƠI DUY NHẤT nối các module (khối "MODULE WIRING", hàm modules())
│   │   ├── rest.go              # RestRoutes / RootRoutes - ĐÓNG BĂNG cùng 80 hàm của Node
│   │   ├── rpc/                 # cổng tương thích POST /api/:fn + Registry, RegisterGoRoute
│   │   ├── server.go, static.go, uploads.go, assets.go (+ assets/), swagger.go
│   │   └── apidocs/             # mô tả API nhúng, đóng băng
│   ├── middleware/              # auth, tenant, rbac, cors, rate_limit, body
│   ├── platform/
│   │   ├── database/            # tầng dữ liệu DUY NHẤT: Select / Insert / Update / Remove, Tx;
│   │   │                        #   db-map.json (tên Việt trong code <-> tên Anh trong DB), TenantTables trong postgres.go
│   │   ├── storage/             # kho file trên đĩa (UPLOAD_DIR), URL /files/<path>
│   │   └── objstore/, mailer/, webpush/, redis/, logger/
│   ├── shared/
│   │   ├── contracts/           # MỌI interface gọi chéo giữa các module
│   │   ├── omap/, jsval/        # object JSON có thứ tự khoá, ép kiểu giống JavaScript
│   │   ├── tenant/, actor/, response/, errors/, validator/, httpx/, goonly/
│   │   ├── qscore/              # số của store, đọc CSV / xlsx, importParse
│   │   └── specs/               # thông số ngành: js/*-spec.js là NGUỒN (nhúng, phục vụ ở /vs-spec.js...), data/ là file sinh
│   ├── modules/<module>/        # nghiệp vụ, mỗi module 1 gói: auth, users, companies, notifications, categories, files,
│   │                            #   materials, takeoff, projects, quotations, estimates, purchasing, reports,
│   │                            #   sales, delivery, chat (+ realtime/), hr, system (khuôn tối thiểu)
│   └── jobs/                    # job nền (báo cáo, nhắc gia hạn; tắt bằng REPORT_JOB=0)
├── scripts/gen-specs.js         # sinh internal/shared/specs/data từ *-spec.js (cần Node.js, không cần gói nào)
├── tests/                       # integration/ (server_test.go), e2e/test-api-go.js, chat-e2e/, fixtures/ (đóng băng)
└── docs/                        # ARCHITECTURE, API, DATABASE, PORTING_MAP (+ README.md, CHAT.md ở backend/)
frontend/                        # React + Vite (npm run dev / build / preview, test:hr)
├── index.html, vite.config.js, .env.example (VITE_API_URL)
├── public/chat-sw.js            # service worker của chat
├── scripts/check-hr-summary.mjs # npm run test:hr
└── src/
    ├── main.jsx, App.jsx        # App.jsx khai báo route (react-router-dom), bọc trong AppShell
    ├── pages/<TenTrang>/        # mỗi trang 1 thư mục PascalCase: <TenTrang>.jsx + .css (+ components/, api.js)
    │                            #   QS/ là trang QS Pro: api/ (http.js = lớp gọi REST /api/v1), lib/, state/, session/, components/
    ├── components/              # layout/ (AppShell, Sidebar, Topbar...), ui/, hr/, kanban/ - dùng từ nhiều trang
    ├── data/                    # navigation.js (menu NAV_MAIN / NAV_BOTTOM) + dữ liệu mẫu từng trang (*Data.js)
    ├── services/, hooks/, context/, assets/ (fonts/, styles/)
infra/                           # hạ tầng: database, Docker, triển khai, script vận hành
├── db/
│   ├── migrations/NNNN_ten.sql  # NGUỒN DUY NHẤT; go run ./cmd/migrate đọc thẳng (checksum, không sửa file đã chạy)
│   ├── schema.sql               # schema hiện hành (bản chụp, tên tiếng Anh) - sinh lại sau mỗi migration
│   └── baseline.sql, baseline-map.json   # schema gốc trước migration (bản lưu tham khảo)
├── docker/                      # backend / frontend / minio Dockerfile; backend và frontend có .dockerignore đặt cạnh
├── deploy/                      # VPS CloudFly (https://dezon.tech): docker-compose.yml, Caddyfile, deploy.sh,
│                                #   setup-server.sh, minio-init.sh, .env.example - xem docs/04-van-hanh/trien-khai-vps-cloudfly.md
├── scripts/                     # backup-db.sh, restore-db.sh, create-super.sh, seed-*.mjs, reset-demo-4tab.sql
└── export/                      # dump dữ liệu thật - gitignore, KHÔNG commit
docs/                            # tài liệu cho người đọc - xem ../docs/docs-placement.md
```

Backend chia theo **module nghiệp vụ** (`internal/modules/<module>/`), mỗi module là 1 gói Go với bộ file cố định
(`service.go`, `repository.go`, `postgres.go`, `model.go`, `dto.go`, `handler.go`, `*_test.go` - `ARCHITECTURE.md` mục 4).
Không có thư mục `controllers/`, `models/`, `utils/` ở gốc `backend/`. `backend/`, `frontend/`, `infra/` là ba phần riêng:
không trộn code giữa chúng.

---

## Đặt file mới ở đâu

| Việc | Vị trí |
|---|---|
| Module Go mới | `backend/internal/modules/<module>/` theo bộ file ở `ARCHITECTURE.md` mục 4 (khuôn tối thiểu: `internal/modules/system`); `handler.go` có `RegisterRPC` + `RegisterRoutes` (tuỳ chọn `RegisterRoot`), không chứa nghiệp vụ. Dựng và nối trong khối MODULE WIRING của `internal/server/routes.go`, thêm vào danh sách `modules()` |
| Gọi chéo giữa 2 module | interface trong `internal/shared/contracts/contracts.go`; module dùng khai trường `Deps` bằng interface đó, module chủ cài bằng phương thức của `*Service`; truyền vào trong `routes.go` (`ARCHITECTURE.md` mục 6, 11) |
| Route / API mới | route REST "chỉ bản Go" dưới `/api/v1`: `reg.RegisterGoRoute(rpc.GoRoute{...})` trong `RegisterRPC` + route gin cùng method / đường dẫn trong `RegisterRoutes`, middleware khớp `Perm` (`RequireLogin` / `RequireAdmin` / `RequireSuper` / `RequireAdminSuper`). Cách viết: `backend/docs/API.md` mục 2.1. KHÔNG thêm hàm `/api/:fn`, KHÔNG thêm dòng vào `RestRoutes` / `RootRoutes` |
| File tĩnh nhúng phục vụ ở gốc (file mẫu `.xlsx`, logo...) | module cài `AssetModule` (`Assets() map[string][]byte`, `go:embed`), như `categories` và `estimates` |
| Hàm thuần dùng chung nhiều module (không đụng DB) | gói trong `backend/internal/shared/` (vd `qscore`, `jsval`); không đặt trong gói module rồi import chéo |
| Thông số ngành | `backend/internal/shared/specs/js/<ngành>-spec.js` (skill `thiet-bi-ve-sinh`) -> `node backend/scripts/gen-specs.js` -> `go test ./internal/shared/specs ./internal/server` (từ `backend/`) |
| Thêm cột / bảng | file mới `infra/db/migrations/NNNN_ten.sql` (số tiếp theo, không sửa file đã chạy; thêm cột vào `products` / `product_*_specs` thì tạo lại view `product_catalog` trong cùng migration) -> `go run ./cmd/migrate --url=<database đích>` (từ `backend/`) -> sinh lại `infra/db/schema.sql` -> thêm cặp `"ten_trong_code": "name_in_db"` vào `backend/internal/platform/database/db-map.json` (bản duy nhất; bảng con không có `company_id` khai khoá `tenant`). Quy tắc: `docs/02-ky-thuat/database/database-rules.md`, `backend/docs/DATABASE.md` |
| Bảng theo công ty | thêm tên bảng (tên trong code) vào `TenantTables` trong `backend/internal/platform/database/postgres.go` - thiếu là dữ liệu lộ sang công ty khác |
| Biến môi trường mới | trường trong `backend/internal/config` (`Config`), module đọc qua `Deps.Cfg`, không gọi `os.Getenv`; ghi vào `backend/.env.example` (và `infra/deploy/.env.example` nếu production cần) |
| Test Go | `*_test.go` cạnh code trong gói (repo giả cho test đơn vị; test cần database tự bỏ qua khi thiếu `TEST_DATABASE_URL`); test trên server đã nối đủ module: `backend/tests/integration/`. Chạy: `go test -count=1 -p 1 ./...` từ `backend/` |
| Trang React mới | `frontend/src/pages/<TenTrang>/<TenTrang>.jsx` + `.css`; route trong `frontend/src/App.jsx`; mục menu trong `frontend/src/data/navigation.js`. Gọi backend bằng `request` của `src/pages/QS/api/http.js` (như `pages/KinhDoanh/api.js`, `pages/ChamCong/api.js`) |
| Component React dùng cho 1 trang | `frontend/src/pages/<TenTrang>/components/` |
| Component / hook dùng từ 2 trang trở lên | `frontend/src/components/<nhóm>/` / `frontend/src/hooks/` |
| File Docker / triển khai mới | `infra/docker/` (Dockerfile + `.dockerignore` cạnh nó) hoặc `infra/deploy/` (compose, Caddy, script VPS) |
| Script vận hành database (sao lưu, khôi phục, seed...) | `infra/scripts/` |
| Tài liệu | `docs/<nhóm>/` theo `../docs/docs-placement.md`; tài liệu riêng của bản Go ở `backend/README.md`, `backend/docs/` |

---

## Anti-patterns

- Tạo lại app Node ở gốc (`server/`, `public/`, `package.json` gốc, `render.yaml`) hoặc viết hướng dẫn dùng `npm start` / `npm test` /
  `npm run migrate` ở gốc - app Node đã gỡ, deploy là VPS CloudFly qua `infra/deploy/`.
- Gói module import gói module khác (ngoại lệ duy nhất: `categories`, được `materials` / `reports` import) - dùng `internal/shared/contracts`.
- Nối module ngoài khối MODULE WIRING của `internal/server/routes.go`.
- Viết SQL / gọi `DB.Pool()` trong module thay vì `Select / Insert / Update / Remove` của `platform/database` - mất dịch tên và lọc công ty
  (ngoại lệ đã ghi: module chat, `ARCHITECTURE.md` mục 10.4).
- Dùng tên bảng / cột tiếng Anh trong code Go - code dùng tên tiếng Việt, `db-map.json` lo phần dịch.
- Thêm bảng theo công ty mà quên `TenantTables`.
- Thêm hàm `/api/:fn` hoặc dòng `RestRoutes` / `RootRoutes`; sửa tay fixture đóng băng (`tests/fixtures/registry.json`, `swagger-node.json`,
  `internal/server/apidocs/*`, `tests/e2e/**`, `testdata/*` do Node sinh).
- Trả JSON bằng `c.JSON` của gin thay vì gói `response`; đọc `os.Getenv` trong module thay vì `Deps.Cfg`.
- Sửa `go.mod` / chạy `go mod tidy` khi user không yêu cầu.
- Sửa `internal/shared/specs/data/*` bằng tay - đó là file sinh từ `js/*-spec.js`.
- Sửa migration đã chạy (checksum báo lệch), chép migration sang chỗ khác (vd `backend/migrations/`), viết file `.sql` chạy tay trên database.
- Đặt file hạ tầng (Dockerfile, compose, cấu hình triển khai, script vận hành DB, migration) ngoài `infra/`.
- Commit `infra/export/` hoặc file `.env` có khoá thật.
- Trộn code giữa `backend/` (Go) và `frontend/` (React); thêm framework / thư viện giao diện mới vào `frontend/` khi user không yêu cầu.
- Trang React tự `fetch` tới backend với địa chỉ cứng thay vì đọc `VITE_API_URL` qua `src/pages/QS/api/http.js`.
