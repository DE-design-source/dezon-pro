# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

QS Pro (Dezon Pro): web app bóc tách khối lượng / báo giá, nhiều công ty dùng chung (multi-tenant).
Node.js + Express (CommonJS, không TypeScript, không bundler), dữ liệu trên PostgreSQL qua `DATABASE_URL`;
file ảnh / tài liệu lưu trên ổ đĩa máy chủ (thư mục `UPLOAD_DIR`, phục vụ ở `/files/...`). Quy tắc chi tiết trong `.claude/rules/` (tự nạp).
Tên trong code, chú thích, chuỗi giao diện là tiếng Việt: giữ nguyên khi sửa. `export/` chứa dump dữ liệu thật, đã gitignore, không commit.
Sửa thông số theo ngành (`backend/internal/shared/specs/js/*-spec.js`): dùng skill `thiet-bi-ve-sinh`; sửa xong chạy
`node backend/scripts/gen-specs.js` rồi `go test ./internal/shared/specs ./internal/server` (từ `backend/`).

## Lệnh

```bash
npm install
npm start                      # http://localhost:3000 (cần .env có DATABASE_URL)
npm run dev                    # node --watch
npm test                       # test-core + check-load + test-vs: hàm thuần, thứ tự nạp script, luồng nhập VS/sơn (DB giả)
node scripts/test-core.js      # chạy riêng 1 test: gọi thẳng file trong scripts/
node --check public/<file>.js  # kiểm cú pháp file giao diện vừa sửa

TEST_DATABASE_URL=postgresql://.../qspro_test npm run test:db    # tầng dữ liệu trên Postgres THẬT (database tạm)
TEST_DATABASE_URL=postgresql://.../qspro_test npm run test:api   # server thật + gọi API qua HTTP

npm run migrate                # chạy migration chưa áp dụng trên DATABASE_URL
node infra/scripts/migrate.js --status
```

- `test:db` / `test:api` từ chối chạy nếu `TEST_DATABASE_URL` trùng `DATABASE_URL` hoặc tên DB không chứa `test`/`tmp`.
  `test:api` để lại dữ liệu rác, chỉ dùng bản sao bỏ đi được.
- `.env` ở máy phát triển trỏ tới database THẬT và webhook Lark thật. Không verify bằng cách ghi dữ liệu qua server đang chạy với `.env` đó.
- Không có linter / build cho phần Node.

## Kiến trúc

**Server (`server/`, file phẳng - KHÔNG có `server/components/`):**
- `index.js`: toàn bộ route. Cổng nghiệp vụ duy nhất là `POST /api/:fn`: `fn` phải có trong `REGISTRY`,
  phân quyền bằng các tập `PUBLIC_FNS` / `ACTOR_FNS` / `ADMIN_FNS` / `SUPER_FNS`, rồi handler chạy trong
  `tenant.run(...)`. Route lẻ (`/export/*`, `/upload/file`, `/media`, file mẫu `.xlsx`) tự gọi `actorOf_` + `tenant.run`.
  Thêm hàm API: viết hàm trong `store_supa.js` / `auth.js`, đăng ký vào `REGISTRY` + đúng tập quyền. Tên hàm phải duy nhất.
  Client gửi body `{args:[...]}`; hàm trong `ACTOR_FNS` nhận thêm actor `{uid, u, r, ct, ...}` làm tham số ĐẦU.
  Phiên: token `Authorization: Bearer`. Super không có công ty, thấy mọi công ty trừ khi gửi header `x-view-company`.
  Swagger UI ở `/api-docs` (bật khi chạy ở máy, `SWAGGER_DOCS=0/1` để tắt/bật).
- `store_supa.js`: nghiệp vụ (sản phẩm, dự án, dòng bóc tách, tờ bìa, công tác, mua hàng). `auth.js`: đăng nhập, phiên, tài khoản, công ty, duyệt.
- `supa.js`: tầng dữ liệu trên `pg` nhưng giữ giao diện kiểu PostgREST (`select/insert/update/remove` + chuỗi lọc PostgREST như `ma_du_an=eq.X`).
  Nó dịch tên bảng/cột **tiếng Việt trong code -> tiếng Anh trong DB** theo `db-map.json`, và **tự lọc theo công ty**
  với bảng trong `TENANT_TABLES` (ngữ cảnh lấy từ `tenant.js` - AsyncLocalStorage). Bảng mới theo công ty PHẢI thêm vào
  `TENANT_TABLES`, nếu không dữ liệu lộ sang công ty khác. `noScope` bỏ lọc, chỉ dùng cho truy cập xuyên công ty thật sự (đăng nhập, phiên).
- Sản phẩm (`db_san_pham` trong code) = bảng lõi `products` + 5 bảng thông số theo ngành (đèn, vệ sinh, sơn, công tắc, điện lạnh), đọc qua view `product_catalog`.
  Thêm cột thông số phải tạo lại view (docs/02-ky-thuat/database/ket-qua-trien-khai.md mục 7).
- `shared.js`: hàm thuần dùng chung (mẫu tờ bìa, đọc số VN, đọc file nhập). `export.js`: xuất Excel (ExcelJS).
  `*-template.js`: sinh file mẫu nhập hàng loạt theo ngành.

**Giao diện (`public/`):** script thuần dùng chung biến toàn cục, nạp theo thứ tự thẻ `<script>` trong `index.html`:
`app.js` (lõi: object trạng thái `S`, `api()`, quyền, công thức giá, cây hạng mục `TREE`) -> mỗi tab 1 file -> `main.js` cuối cùng.
Code chạy ngay lúc nạp chỉ được gọi file nạp trước (`scripts/check-load.js` kiểm). Hàm dùng từ 2 tab trở lên đặt ở `app.js`.
`*-spec.js` (vs, son, ct, dl) là UMD, dùng cả client lẫn server.

**Bất biến dễ vỡ:**
- Công thức giá 1 dòng có 2 bản: server `calc_()` (store_supa.js) và client `recalcLine_()` / `giaDaiLy_()` / `donGiaCK_()`. Sửa bên này phải sửa bên kia.
- Đọc số người dùng gõ bằng `tkNum_()` (client) / `toNumber_()` (server), hai hàm phải cho cùng kết quả (test-core kiểm).
- Chèn dữ liệu vào `onclick` bằng `escJs_()`, vào `href` bằng `safeUrl_()`.
- Đổi dự án chỉ qua `openProject_()`. Mã tờ bìa = mã cây hạng mục `TREE`.
- `scripts/test-core.js` trích hàm client bằng regex: hàm đó phải là `function tên(` ở cấp cao nhất.

## Database / migration

- Hạ tầng gom ở `infra/`: `infra/db/` (migration, `schema.sql`, `baseline.sql`), `infra/docker/` (Dockerfile bản Go),
  `infra/scripts/` (migrate, sao lưu / khôi phục database + kho file). `render.yaml` giữ ở gốc vì Render đọc Blueprint ở gốc.
- Thêm cột / bảng: file mới `infra/db/migrations/NNNN_ten.sql` (không sửa file đã chạy, migrate kiểm checksum)
  -> `go run ./cmd/migrate` (từ `backend/`) -> sinh lại `infra/db/schema.sql` -> thêm cặp `"ten_trong_code": "name_in_db"` vào
  `backend/internal/platform/database/db-map.json` (bản duy nhất; bản Node `server/db-map.json` đã gỡ).
- Bảng con không có `company_id`: công ty lấy qua bảng cha (khoá `tenant` trong `db-map.json`).
- Quy tắc thiết kế bảng: `docs/02-ky-thuat/database/database-rules.md`. Schema đang chạy: `docs/02-ky-thuat/database/schema-hien-hanh.md`.

## Thư mục khác

- `backend/`: bản chuyển server sang Go + Gin, chạy độc lập, dùng lại `public/`. Có README và `backend/docs/ARCHITECTURE.md` riêng;
  chạy từ `backend/` (`go run ./cmd/api`, `go test -count=1 -p 1 ./...`). Nó kế thừa `../.env` - khi chạy thử phải đặt
  `REPORT_JOB=0`, `PURCHASE_WEBHOOK`/`REPORT_WEBHOOK` về địa chỉ giả (xem backend/README.md).
- `frontend/`: app React + Vite riêng (`siteflow-ui`), không được server Node phục vụ.
- Deploy: Render (`render.yaml`, vẫn là bản Node), tự deploy khi push `main`.

## Lưu ý về nhánh

`.claude/rules/` mô tả layout của nhánh `ed_data` (server phẳng, PostgreSQL). Nhánh `refactor/Dung` đã tách server thành
`server/components/<domain>/` + `server/libraries/`; khi gộp hai nhánh phải sửa lại `folder-structure.md`, `naming-conventions.md` và mục Server ở trên.
Roadmap: `docs/03-san-pham/roadmap.md` (cập nhật theo `roadmap-sync.md`).
