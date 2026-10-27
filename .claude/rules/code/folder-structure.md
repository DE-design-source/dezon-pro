# Folder Structure — QS Pro

> **Level:** MANDATORY.
> **Rule:** File mới phải đặt đúng vị trí theo layout HIỆN CÓ của repo. Không tự chế layout riêng,
> không refactor layout chỉ để khớp một chuẩn bên ngoài (trừ khi user yêu cầu rõ).

Stack: Node.js + Express (CommonJS, không TypeScript, không bundler) · giao diện là script thuần
dùng chung biến toàn cục · dữ liệu trên **PostgreSQL** (thư viện `pg`, nối qua `DATABASE_URL`); file ảnh /
tài liệu lưu trên ổ đĩa máy chủ (`UPLOAD_DIR`, phục vụ ở `/files/...`). Sơ đồ file chi tiết: [README.md](../../../README.md) mục Kiến trúc.

---

## Layout

```
server/                      # file PHẲNG, không có thư mục con
├── index.js                 # Express: static public/, POST /api/:fn (whitelist REGISTRY + tập quyền
│                            #   PUBLIC_FNS / ACTOR_FNS / ADMIN_FNS / SUPER_FNS), route lẻ /export/*, /upload/file,
│                            #   /media, file mẫu /mau-nhap-*.xlsx (tự gọi actorOf_ + tenant.run), /healthz, lịch báo cáo
├── auth.js                  # đăng nhập, phiên, tài khoản, công ty, duyệt đơn / đề xuất / yêu cầu xoá (hàm ...Gated)
├── store_supa.js            # nghiệp vụ: sản phẩm, dự án, dòng bóc tách, tờ bìa, công tác, mua hàng; COL_SQL
├── supa.js                  # tầng dữ liệu pg DUY NHẤT: dịch tên VN (code) <-> EN (DB) theo db-map.json,
│                            #   tự lọc công ty theo TENANT_TABLES
├── db-map.json              # đối chiếu tên bảng / cột tiếng Việt -> tiếng Anh
├── tenant.js                # ngữ cảnh công ty theo request (AsyncLocalStorage)
├── shared.js                # hàm thuần: mẫu tờ bìa, NCC 3.2, đọc số VN, đọc file nhập hàng loạt
├── export.js                # xuất Excel báo giá (ExcelJS)
├── vs-template.js, son-template.js, ct-template.js   # sinh file mẫu nhập hàng loạt theo ngành
├── lark.js                  # tải ảnh cũ trên Lark cho /media
├── config.js                # biến môi trường
├── swagger.js               # Swagger UI /api-docs
└── api-docs.json            # mô tả tham số API (viết tay) cho swagger.js
public/
├── index.html               # markup + toàn bộ CSS + thứ tự thẻ <script>
├── app.js                   # lõi dùng chung (S, api(), quyền, openProject_, công thức giá, cây hạng mục…)
├── <tab>.js                 # boc, sanpham, nhap, phantho, bangtinh (chế độ bảng tính), chiphi, duan,
│                            #   muahang, baogia, dash, admin, congty
├── main.js                  # khởi động — luôn nạp SAU CÙNG
└── vs-spec.js, son-spec.js, ct-spec.js   # thông số theo ngành, dùng cả client lẫn server (module.exports)
infra/                       # hạ tầng: database, Docker, script vận hành — dùng chung cho app Node và bản Go
├── db/
│   ├── migrations/NNNN_ten.sql  # migration đánh số, chạy bằng `npm run migrate` (có checksum, không sửa file đã chạy);
│   │                            #   bản Go đọc thẳng thư mục này, KHÔNG có bản sao
│   ├── schema.sql               # schema hiện hành (bản chụp, tên tiếng Anh) — sinh lại sau mỗi migration
│   └── baseline.sql, baseline-map.json   # schema gốc trước migration (bản lưu tham khảo, không script nào dùng)
├── docker/                  # backend.Dockerfile + .dockerignore cạnh nó
└── scripts/                 # script vận hành: migrate.js (`npm run migrate`), backup-db.sh / restore-db.sh, create-super.sh
render.yaml                  # ở GỐC vì Render đọc Blueprint ở gốc repo
db/                          # chỉ còn bao-gia-phan-tho.xlsx (file mẫu, không phải migration)
scripts/                     # test-core.js, check-load.js, test-vs.js (`npm test`); test-db.js, test-api.js
                             #   (cần TEST_DATABASE_URL)
docs/                        # tài liệu cho người đọc — xem ../docs/docs-placement.md
backend/                     # bản port Go + Gin (go.mod riêng, tài liệu riêng ở backend/docs/) — tách khỏi server Node
frontend/                    # app React + Vite riêng (siteflow-ui) — server Node KHÔNG phục vụ thư mục này
```

Khác layout `nodebestpractices`: thư mục là `server/` (không phải `src/`), **không chia domain thành
thư mục**, không có lớp routes / controller / service / repository riêng — `index.js` khai báo thẳng
hàm của `store_supa.js` / `auth.js` vào `REGISTRY`. Không có thư mục `test/`.

---

## Đặt file mới ở đâu

| Việc | Vị trí |
|---|---|
| Hàm API mới (`POST /api/<tên>`) | viết hàm trong `server/store_supa.js` (nghiệp vụ) hoặc `server/auth.js` (tài khoản / công ty / duyệt) + `module.exports`; đăng ký vào `REGISTRY` trong `server/index.js` + thêm tên vào tập quyền phù hợp (`PUBLIC_FNS` / `ACTOR_FNS` / `ADMIN_FNS` / `SUPER_FNS`); mô tả tham số trong `server/api-docs.json` nếu cần |
| Kiểm quyền chi tiết của 1 hàm | hàm `...Gated` trong `auth.js` (bọc hàm của `store_supa.js`), đăng ký bản Gated vào `REGISTRY` |
| Route tải file / upload (không phải `/api/:fn`) | `server/index.js` — tự gọi `actorOf_` + `tenant.run` như các route `/export/*` có sẵn |
| File mẫu nhập hàng loạt ngành mới | `server/<ngành>-template.js` + route `/mau-nhap-*.xlsx` trong `index.js` |
| Hàm thuần dùng chung server (không đụng DB) | `server/shared.js` |
| Hàm giao diện dùng cho 1 tab | file của tab đó |
| Hàm giao diện dùng từ 2 tab trở lên | `public/app.js` |
| File script giao diện mới | `public/` + thêm thẻ `<script>` vào `index.html` đúng thứ tự (sau `app.js`, trước `main.js`) |
| Thông số ngành mới | `public/<ngành>-spec.js` (export `module.exports` để server dùng) + thẻ `<script>` trước `app.js` |
| Thêm cột / bảng | file mới `infra/db/migrations/NNNN_ten.sql` (số tiếp theo, không sửa file đã chạy) → `npm run migrate` → sinh lại `infra/db/schema.sql` → thêm cặp `"ten_trong_code": "name_in_db"` vào `server/db-map.json` và đồng bộ sang `backend/internal/platform/database/db-map.json`; cột thêm sau báo lỗi đích danh qua `COL_SQL` trong `server/store_supa.js`; bảng theo công ty thêm vào `TENANT_TABLES` trong `server/supa.js`. Quy tắc: `docs/02-ky-thuat/database/database-rules.md` |
| Test | `scripts/test-<ten>.js`; chạy không cần DB thật → nối vào script `test` trong `package.json`; cần PostgreSQL thật → theo mẫu `test-db.js` / `test-api.js` (`TEST_DATABASE_URL`). Test vẫn ở `scripts/`, không vào `infra/` |
| File triển khai / Docker / CI mới | `infra/docker/` (hoặc `infra/<công cụ>/`); riêng `render.yaml` giữ ở gốc vì Render đọc Blueprint ở gốc |
| Script vận hành database (migrate, đồng bộ, sao lưu…) | `infra/scripts/` |

---

## Anti-patterns

- Gọi `pg` / viết SQL trực tiếp ngoài `server/supa.js` — mọi đọc/ghi đi qua `supa.*` để được dịch tên và lọc công ty.
- Dùng tên bảng / cột tiếng Anh trong code server — code dùng tên tiếng Việt, `db-map.json` lo phần dịch.
- Thêm hàm API mà quên `REGISTRY` hoặc tập quyền → client không gọi được hoặc hở quyền.
- Tạo `server/components/`, `server/libraries/`, `server/app.js`, `src/`, `controllers/`, `models/`, `utils/`
  khi user chưa yêu cầu refactor — repo đang dùng file phẳng trong `server/`.
- Viết file `db/<ten>.sql` chạy tay trên database, hoặc sửa migration đã chạy (checksum sẽ báo lệch).
- Đặt file hạ tầng (Dockerfile, cấu hình CI/triển khai, script vận hành DB, migration) ngoài `infra/` — trừ `render.yaml` ở gốc.
- Chép migration sang chỗ khác (vd `backend/migrations/`) — `infra/db/migrations/` là nguồn DUY NHẤT cho cả Node lẫn Go.
- Thêm bundler / module ES / framework giao diện vào `public/` khi user không yêu cầu.
- Trộn code giữa `backend/` (Go), `frontend/` (React) và app Node — mỗi thư mục là một dự án riêng.
- Code chạy ngay lúc nạp ở một file tab mà gọi hàm của file nạp sau (`node scripts/check-load.js` báo lỗi).
