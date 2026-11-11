# Folder Structure - QS Pro

> **Level:** MANDATORY.
> **Rule:** File mới phải đặt đúng vị trí theo layout HIỆN CÓ của repo. Không tự chế layout riêng,
> không refactor layout chỉ để khớp một chuẩn bên ngoài (trừ khi user yêu cầu rõ).

Stack: server Go + Gin (`backend/`, module `qspro-backend`) · giao diện React 18 + Vite 5 + react-router-dom 6
(`frontend/`, gói `siteflow-ui`) · dữ liệu trên **PostgreSQL** (nối qua `DATABASE_URL`); file ảnh / tài liệu lưu trên ổ đĩa
máy chủ (`UPLOAD_DIR`, phục vụ ở `/files/...`); tệp chat trên MinIO / S3 (`CHAT_S3_*`). Hợp đồng viết module Go: [backend/docs/ARCHITECTURE.md](../../../backend/docs/ARCHITECTURE.md);
danh sách route: [backend/docs/API.md](../../../backend/docs/API.md).

---

## Layout

```
backend/                         # server Go (go.mod riêng), chạy mọi lệnh Go từ đây
├── cmd/
│   ├── api/main.go              # server HTTP + job nền
│   ├── migrate/main.go          # chạy migration trong ../infra/db/migrations
│   └── vapid/main.go            # in cặp khoá VAPID cho push chat
├── internal/
│   ├── config/                  # đọc biến môi trường (config.go, dotenv.go)
│   ├── jobs/worker.go           # job nền (báo cáo, nhắc gia hạn; tắt bằng REPORT_JOB=0)
│   ├── middleware/              # appver, auth, body, cors, rate_limit, rbac (Require*), tenant
│   ├── modules/<module>/        # 1 gói / 1 nghiệp vụ: auth, categories, chat (+ realtime/), companies, delivery,
│   │                            #   estimates, files, hr, materials, notifications, projects, purchasing, quotations,
│   │                            #   reports, sales, system, takeoff, users
│   │   ├── handler.go           #   RegisterRPC + RegisterRoutes (+ RegisterRoot nếu có route lẻ); không chứa nghiệp vụ
│   │   ├── service.go           #   Deps, Service, New(d Deps) + nghiệp vụ; tách thêm service_<việc>.go khi dài
│   │   ├── repository.go        #   interface Repository (cái service cần từ kho dữ liệu)
│   │   ├── postgres.go          #   cài Repository bằng *database.DB
│   │   ├── model.go, dto.go     #   kiểu nghiệp vụ / struct request-response REST
│   │   ├── *_test.go            #   test cạnh code
│   │   └── testdata/            #   golden / fixture của gói
│   ├── platform/                # hạ tầng: database/ (tầng dữ liệu + db-map.json), logger, mailer, objstore, redis,
│   │                            #   storage (UPLOAD_DIR), webpush, deps.go
│   ├── server/                  # routes.go (khối MODULE WIRING), rest.go (RestRoutes, RootRoutes), server.go, static.go,
│   │                            #   assets.go (AssetModule), swagger.go, uploads.go (/files), rpc/ (cổng /api/:fn),
│   │                            #   apidocs/ (mô tả API, đóng băng), assets/logo.svg
│   └── shared/                  # gói dùng chung không phụ thuộc module: actor, contracts (interface gọi chéo), errors
│                                #   (colerr.go), goonly, httpx, jsval, omap, qscore (số, đọc file nhập), response,
│                                #   specs (js/*-spec.js = nguồn thông số ngành), tenant, validator
├── scripts/gen-specs.js         # sinh lại dữ liệu specs từ js/*-spec.js (chỉ cần Node.js)
├── tests/                       # integration/ (Go), e2e/ + chat-e2e/ (script Node gọi server thật), fixtures/ (đóng băng)
├── docs/                        # API.md, ARCHITECTURE.md, DATABASE.md (tài liệu riêng của backend)
├── uploads/                     # UPLOAD_DIR mặc định
└── .env.example                 # danh sách biến môi trường
frontend/                        # app React + Vite (package.json riêng), chạy npm từ đây
├── index.html, vite.config.js, .env.example   # .env.example chỉ có VITE_API_URL
├── public/chat-sw.js            # service worker push chat
├── scripts/check-hr-summary.mjs # `npm run test:hr`
└── src/
    ├── App.jsx, main.jsx        # khai route react-router
    ├── assets/                  # fonts/, styles/ (global.css...)
    ├── components/              # component dùng chung nhiều trang: hr/, kanban/, layout/ (AppShell, Sidebar...), ui/
    ├── context/, hooks/, services/   # ThemeContext, useXxx dùng chung, dịch vụ trình duyệt (storageService...)
    ├── data/                    # dữ liệu mẫu theo trang (<trang>Data.js) + navigation.js (menu)
    └── pages/<Trang>/           # 1 thư mục / 1 trang: <Trang>.jsx + <Trang>.css + components/ (+ api.js nếu gọi server)
        └── QS/                  # trang QS (bóc tách / báo giá):
            ├── QS.jsx, QsSettingsPanels.jsx
            ├── api/             # http.js (request, token, VITE_API_URL), qsApi.js (hàm gọi REST /api/v1), specs.js, files.js
            ├── components/      # <Ten>Tab.jsx + thư mục con theo tab (breakdown/, cost/, admin/, congty/, common/...)
            ├── lib/             # hàm thuần: calc.js (công thức giá), format.js (tkNum_, safeUrl_), tree.js (TREE)...
            ├── session/         # đăng nhập, phiên
            └── state/           # store.js (getState / setState / useQsStore / selectProject), hook dữ liệu
infra/                           # hạ tầng dùng chung
├── db/
│   ├── migrations/NNNN_ten.sql  # migration đánh số, nguồn DUY NHẤT; chạy bằng `go run ./cmd/migrate` (có checksum)
│   ├── schema.sql               # schema hiện hành (bản pg_dump, tên tiếng Anh) - sinh lại sau mỗi migration
│   └── baseline.sql, baseline-map.json   # schema gốc trước migration (bản lưu tham khảo)
├── docker/                      # backend / frontend / minio Dockerfile + *.dockerignore cạnh nó
├── deploy/                      # docker-compose.yml, Caddyfile, deploy.sh, setup-server.sh, minio-init.sh (VPS)
├── scripts/                     # vận hành: backup-db.sh, restore-db.sh, create-super.sh, seed-*.mjs, reset-demo-4tab.sql
└── export/                      # dump dữ liệu thật - gitignore, KHÔNG commit
docs/                            # tài liệu cho người đọc - xem ../docs/docs-placement.md
```

Ở gốc repo chỉ có `.claude/`, `CLAUDE.md`, `backend/`, `frontend/`, `infra/`, `docs/` (+ file ẩn). Không có `package.json` ở gốc.

---

## Đặt file mới ở đâu

| Việc | Vị trí |
|---|---|
| Tính năng / API mới | route REST "chỉ bản Go" trong module phù hợp: khai `reg.RegisterGoRoute(rpc.GoRoute{Name, Method, Path, Perm, Tag, Summary, Fields})` trong `RegisterRPC`, gắn route gin cùng method + path trong `RegisterRoutes` với middleware khớp `Perm` (`middleware.RequireLogin()` / `RequireAdmin()` / `RequireSuper()` / `RequireAdminSuper()`; `rpc.Public` không gắn). Nghiệp vụ ở `service*.go`, handler chỉ đọc tham số rồi gọi service. Cách viết: `backend/docs/API.md` mục 2.1 + ARCHITECTURE mục 12.1 |
| Hàm `/api/:fn` mới, dòng mới trong `RestRoutes` / `RootRoutes` | KHÔNG thêm (đóng băng ở 80 hàm / 80 route / 9 route lẻ; `TestRegistryParity`, `TestRestRoutes`, `TestRootRoutes` kiểm) |
| Kiểm quyền chi tiết của 1 thao tác | phương thức `...Gated` trên `*Service` của module (vd `materials.UpdateProductGated`, `estimates.CtSaveGated`), handler gọi bản Gated |
| Module nghiệp vụ mới | `backend/internal/modules/<module>/` theo khuôn `handler.go` + `service.go` (+ `repository.go`, `postgres.go`, `model.go`, `dto.go`); khuôn tối thiểu: `modules/system`. Dựng `New(Deps{...})` và thêm vào danh sách trả về trong khối MODULE WIRING (`func (s *Server) modules()`, `internal/server/routes.go`) |
| Module này cần gọi module khác | interface khai MỘT lần trong `backend/internal/shared/contracts`, trường `Deps` dùng interface đó, nối trong khối MODULE WIRING. Gói module không import lẫn nhau (ngoại lệ: `categories`) |
| Route lẻ ở gốc (tải / upload file, không dưới `/api`) | đóng băng ở 9 route; tính năng mới dùng route `/api/v1` chỉ bản Go như trên |
| File tĩnh giao diện tải ở gốc (xlsx mẫu, spec...) | module cài `AssetModule` (`Assets() map[string][]byte`, nhúng bằng `go:embed`), như `categories/assets.go`, `estimates/assets.go` |
| Hàm thuần dùng chung server (không đụng DB) | gói phù hợp trong `backend/internal/shared/` (số, đọc file nhập: `qscore`; giá trị kiểu JS: `jsval`) |
| Hạ tầng mới (client dịch vụ ngoài, kho file...) | `backend/internal/platform/<tên>/` |
| Job nền | `backend/internal/jobs/` |
| Biến môi trường mới | trường trong `backend/internal/config/config.go` (module đọc qua `Deps.Cfg`, không gọi `os.Getenv`) + thêm vào `backend/.env.example` (và `infra/deploy/.env.example` nếu production cần) |
| Thông số ngành | `backend/internal/shared/specs/js/<ngành>-spec.js` (skill `thiet-bi-ve-sinh`), rồi `node backend/scripts/gen-specs.js` + `go test ./internal/shared/specs ./internal/server` (từ `backend/`) |
| Thêm cột / bảng | file mới `infra/db/migrations/NNNN_ten.sql` (số tiếp theo, không sửa file đã chạy) -> `go run ./cmd/migrate --url=<db>` (từ `backend/`) -> sinh lại `infra/db/schema.sql` -> thêm cặp `"ten_trong_code": "name_in_db"` vào `backend/internal/platform/database/db-map.json`; bảng theo công ty thêm vào `TenantTables` (`backend/internal/platform/database/postgres.go`); bảng con không có `company_id` khai khoá `tenant` trong db-map; cột thuộc `products` / `product_*_specs` phải tạo lại view `product_catalog` trong cùng migration; cột cần báo lỗi đích danh thêm vào `colSQL` (`backend/internal/shared/errors/colerr.go`). Quy tắc: `docs/02-ky-thuat/database/database-rules.md` |
| Test Go | `*_test.go` cạnh code trong gói; test cần database tự bỏ qua khi thiếu `TEST_DATABASE_URL`; golden / fixture của gói ở `testdata/`; test xuyên module ở `backend/tests/integration/` |
| Test gọi server thật bằng HTTP | `backend/tests/e2e/` (đóng băng: không sửa tay) / `backend/tests/chat-e2e/` |
| Trang giao diện mới | `frontend/src/pages/<Trang>/<Trang>.jsx` (+ `<Trang>.css`, `components/`) -> thêm `<Route>` trong `frontend/src/App.jsx` -> thêm mục menu trong `frontend/src/data/navigation.js` |
| Tab / component của trang QS | `frontend/src/pages/QS/components/` (`<Ten>Tab.jsx` hoặc thư mục con theo tab); dùng chung trong QS: `components/common/` |
| Component dùng từ 2 trang trở lên | `frontend/src/components/<nhóm>/` (`layout/`, `ui/`...) |
| Hàm gọi API | trang QS: `frontend/src/pages/QS/api/qsApi.js`; trang khác: `api.js` (hoặc `api/<ten>Api.js`) trong thư mục trang. Luôn đi qua `request` / `enc` của `pages/QS/api/http.js` (token, `VITE_API_URL`, xử lý lỗi) |
| Hàm thuần của QS (công thức, định dạng, cây hạng mục) | `frontend/src/pages/QS/lib/` |
| Trạng thái dùng chung của QS | `frontend/src/pages/QS/state/store.js` (hoặc hook trong `state/`) |
| Hook / context / dịch vụ trình duyệt dùng chung | `frontend/src/hooks/`, `frontend/src/context/`, `frontend/src/services/` |
| Script kiểm tra giao diện | `frontend/scripts/<ten>.mjs` + script trong `frontend/package.json` (như `test:hr`) |
| Dockerfile / triển khai | `infra/docker/` (Dockerfile), `infra/deploy/` (Compose, Caddy, script triển khai VPS) |
| Script vận hành database (sao lưu, khôi phục, seed...) | `infra/scripts/` |
| Tài liệu | `docs/<nhóm>/` theo `../docs/docs-placement.md`; tài liệu riêng của backend ở `backend/README.md`, `backend/CHAT.md`, `backend/docs/` |

---

## Anti-patterns

- Gọi `pgx` / viết SQL thô trong module thay vì qua `*database.DB` (`Select` / `InsertOne` / `Insert` / `Update` / `Remove`)
  -> mất dịch tên và lọc công ty. `DB.Pool()` chỉ là ngoại lệ có sẵn (module chat, `users/postgres.go`), không nhân rộng.
- Dùng tên bảng / cột tiếng Anh trong code Go - code dùng tên tiếng Việt, `db-map.json` lo phần dịch.
- Bảng mới theo công ty mà quên `TenantTables` -> dữ liệu lộ sang công ty khác. `NoScope: true` chỉ cho truy cập xuyên công ty thật sự.
- Thêm hàm `/api/:fn`, dòng `RestRoutes` / `RootRoutes`; khai `GoRoute` mà không gắn route gin (hoặc ngược lại) - test wiring báo lỗi.
- Gói module import gói module khác; nối module ngoài khối MODULE WIRING của `routes.go`.
- Đặt nghiệp vụ trong `handler.go`.
- Sửa tay golden / fixture đóng băng: `internal/**/testdata/*`, `tests/fixtures/*`, `internal/server/apidocs/*`, `tests/e2e/**`.
- Trả JSON bằng `c.JSON` của gin thay vì gói `response`; đọc `os.Getenv` trong module thay vì `Deps.Cfg`.
- Sửa `go.mod` / chạy `go mod tidy` khi user không yêu cầu.
- Sửa `internal/shared/specs/data/*.json` / `testdata` bằng tay thay vì chạy `gen-specs.js`.
- Tạo bản sao thứ hai của `db-map.json` hoặc của migration (vd `backend/migrations/`) - `infra/db/migrations/` là nguồn DUY NHẤT.
- Viết file `.sql` chạy tay trên database, sửa migration đã chạy (checksum báo lệch), hoặc thêm file `.down.sql`.
- Đặt file hạ tầng (Dockerfile, Compose, script vận hành DB, migration) ngoài `infra/`.
- Commit `infra/export/`, `export/` hoặc file `.env` có khoá thật.
- Gọi API `/api/v1` bằng `fetch` thẳng trong component React thay vì qua `pages/QS/api/http.js`; ghi cứng địa chỉ API thay vì `VITE_API_URL`.
- Trộn code giữa `backend/` (Go) và `frontend/` (React) - mỗi thư mục là một dự án riêng, công cụ riêng; thêm framework / thư viện
  giao diện mới vào `frontend/` khi user không yêu cầu.
- Tạo `package.json` hoặc thư mục code mới ở gốc repo (ngoài `backend/`, `frontend/`, `infra/`, `docs/`).
