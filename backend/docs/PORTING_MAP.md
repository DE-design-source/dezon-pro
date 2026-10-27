# PORTING MAP - Node (server/) -> Go (backend/internal/modules/*)

Source of truth: `server/*.js` as read on 2026-10-13 (branch `ed_data`). All line numbers below were read from those files.
File aliases used in tables: **S** = `server/store_supa.js`, **A** = `server/auth.js`, **I** = `server/index.js`, **X** = `server/export.js`, **SH** = `server/shared.js`.

> Bảng làm việc nội bộ của đợt chuyển mã (viết bằng tiếng Anh, giữ nguyên để tra số dòng của mã Node). Tài liệu chính thức là
> `ARCHITECTURE.md`; chỗ nào hai file nói khác nhau thì `ARCHITECTURE.md` đúng. Mục "Open points" ở cuối đã được quyết định
> (bản Go tự phục vụ giao diện, Swagger UI đã chuyển).

Rule for every porter: modules never import each other. Cross-module interfaces are declared ONCE in `internal/shared/contracts` (ARCHITECTURE section 11, which replaces the per-module interfaces sketched in section C below); the implementation is injected in `internal/server/routes.go`. Values crossing module borders use the JS value model (`*omap.Map`, `[]any`, `float64`, `string`, `bool`, `nil`) so no module needs another module's Go types. This is required because the Node call graph has cycles (auth <-> users <-> companies, section D).

---

## A. RPC registry (80 entries) and non-RPC routes

RPC contract (I:603-632): `POST /api/<fn>` body `{"args":[...], "token"?: "..."}`. Call = `handler(actor?, ...args)`. Success `200 {"ok":true,"result":<value or null>}`. Any thrown error `500 {"error":"<message>"}`. See F1 for the full envelope rules.

Perm column: `public` = no login; `login` = any valid session; `admin` = role admin or super (ADMIN_FNS, I:130-135); `super` = role super only (SUPER_FNS, I:129). "Actor" = fn is in ACTOR_FNS (I:118-127) so the session actor is prepended as first argument. Parameter lists below EXCLUDE the injected actor.

REST arg mapping convention: `:id`/`:key`/`:code` path params map to the first RPC parameter; remaining parameters come from the JSON body under the parameter name shown (GET: from query string). REST handlers call the same service method as the RPC adapter.

| # | API name | Handler (file:lines) | Perm | Actor | Parameters | Go module | REST route (/api/v1) |
|---|---|---|---|---|---|---|---|
| 1 | bootstrap | S:1014-1023 | login | no | maDA | projects | GET /bootstrap?maDA= |
| 2 | getProducts | S:177-200 | login | no | (none) | materials | GET /products |
| 3 | getProjects | S:232-235 | login | no | (none) | projects | GET /projects |
| 4 | createProject | S:247-256 | login | no | data | projects | POST /projects |
| 5 | updateProject | S:257-265 | login | no | maDA, fields | projects | PATCH /projects/:id |
| 6 | deleteProject | S:266-273 | login | no | maDA | projects | DELETE /projects/:id |
| 7 | duplicateProject | S:275-312 | login | no | maDA, opts | projects | POST /projects/:id/duplicate |
| 8 | getLines | S:331-334 | login | no | maDA | takeoff | GET /projects/:id/lines |
| 9 | addLine | S:345-370 | login | no | maDA, product, soLuong | takeoff | POST /projects/:id/lines |
| 10 | addBlankLine | S:371-374 | login | no | maDA, opts | takeoff | POST /projects/:id/lines/blank |
| 11 | updateLine | S:378-404 | login | no | lineId, fields | takeoff | PATCH /lines/:id |
| 12 | deleteLine | S:405 | login | no | lineId | takeoff | DELETE /lines/:id |
| 13 | saveLineAsProduct | A:547-551 (gate) -> S:955-964 | login | yes | line | takeoff | POST /lines/save-as-product |
| 14 | saveDbProduct | A:535-539 (gate) -> S:503-560 | login | yes | data | materials | POST /products |
| 15 | uploadImage | S:965-974 | login | no | base64, fileName | materials | POST /uploads/images |
| 16 | uploadFile | S:980-983 | login | no | base64, fileName | materials | POST /uploads/files-base64 |
| 17 | deleteDbProduct | S:561-585 | admin | yes | key | materials | DELETE /products/:key |
| 18 | getDbProduct | S:598-605 | login | no | key | materials | GET /products/:key |
| 19 | updateDbProductTracked | A:529-533 (gate) -> S:635-665 | login | yes | key, data | materials | PATCH /products/:key |
| 20 | setSpDuyet | A:565-569 (gate) -> S:668-718 | login | yes | keys, approve | materials | POST /product-approvals |
| 21 | setYeuThich | A:600-602 -> S:760-797 | login | yes | keys, on | materials | POST /product-favorites |
| 22 | ctList | S:1362-1371 | login | no | (none) | estimates | GET /work-items |
| 23 | ctSave | A:574-578 (gate) -> S:1372-1393 | login | yes | data | estimates | POST /work-items |
| 24 | ctUpdate | A:579-583 (gate) -> S:1440-1456 | login | yes | id, patch | estimates | PATCH /work-items/:id |
| 25 | ctDelete | A:584-588 (gate) -> S:1457-1472 | login | yes | ids | estimates | POST /work-items/delete |
| 26 | ctDuyet | A:589-593 (gate) -> S:1473-1492 | login | yes | ids, approve | estimates | POST /work-items/approval |
| 27 | ctFav | A:594-596 -> S:1494-1508 | login | yes | ids, on | estimates | POST /work-items/favorites |
| 28 | getCombo | S:806-836 | login | no | key | materials | GET /products/:key/combo |
| 29 | setCombo | A:553-557 (gate) -> S:855-896 | login | yes | key, items | materials | PUT /products/:key/combo |
| 30 | getBienThe | S:902-911 | login | no | key | materials | GET /products/:key/variants |
| 31 | setBienThe | A:559-563 (gate) -> S:913-949 | login | yes | key, ids | materials | PUT /products/:key/variants |
| 32 | spMyPerms | A:527 (-> spPerms_ A:517-526) | login | yes | (none) | materials | GET /product-permissions |
| 33 | getProductHistory | S:950-954 | login | no | ma | materials | GET /products/:key/history (key = ma_sp only) |
| 34 | saveCover | S:430-440 | login | no | maDA, rows | quotations | PUT /projects/:id/cover |
| 35 | buildCoverFromTemplate | S:413-424 | login | no | maDA | quotations | GET /projects/:id/cover/template |
| 36 | getCoverOrInit | S:425-429 | login | no | maDA | quotations | GET /projects/:id/cover |
| 37 | importParse | S:1031 -> SH:129-191 | login | no | base64, ext, nganh | materials | POST /product-imports/parse |
| 38 | importCommit | A:541-545 (gate) -> S:1032-1080 | login | yes | products | materials | POST /product-imports/commit |
| 39 | exportBaoGia | X:466-522 | login | no | maDA, cols, format, nodes, phanTho, anMuc, tong, org | quotations | POST /projects/:id/quotation/export |
| 40 | getProjData | S:1106-1120 | login | no | maDA | projects | GET /projects/:id/data |
| 41 | setProjData | S:1122-1153 | login | yes | maDA, khoa, giaTri | projects | PUT /projects/:id/data/:khoa (body `{giaTri}`; :id may be `__cty`) |
| 42 | sendPurchaseRequest | I:295-319 | login | yes | order | purchasing | POST /purchase-orders |
| 43 | getPurchaseOrders | S:1193-1207 | login | no | maDA | purchasing | GET /projects/:id/purchase-orders |
| 44 | setPurchaseStatus | A:660-666 | login | yes | maDon, status | purchasing | PATCH /purchase-orders/:code/status |
| 45 | getDeXuatList | S:1285-1296 | login | no | maDA | purchasing | GET /projects/:id/proposals |
| 46 | ctHistory | S:1430-1439 (ctGetHistory) | login | no | id | estimates | GET /work-items/:id/history |
| 47 | sendDeXuat | I:277-294 | login | yes | dx | purchasing | POST /proposals |
| 48 | login | A:223-256 | public | no | username, password | auth | POST /auth/login |
| 49 | me | A:257-264 | login | yes | (none) | auth | GET /auth/me |
| 50 | setMyPref | A:271-287 | login | yes | key, value | auth | PUT /auth/me/prefs/:key (body `{value}`) |
| 51 | logout | A:288 | login | yes | (none) | auth | POST /auth/logout |
| 52 | changePassword | A:289-296 | login | yes | oldPw, newPw | auth | POST /auth/change-password |
| 53 | adminListUsers | A:311-318 | admin | yes | (none) | users | GET /users |
| 54 | adminCreateUser | A:319-362 | admin | yes | data | users | POST /users |
| 55 | adminUpdateUser | A:380-410 | admin | yes | id, fields | users | PATCH /users/:id |
| 56 | adminSetPassword | A:411-417 | admin | yes | id, newPassword | users | PUT /users/:id/password |
| 57 | adminSetActive | A:418-425 | admin | yes | id, active | users | PUT /users/:id/active |
| 58 | adminDeleteUser | A:426-434 | admin | yes | id | users | DELETE /users/:id |
| 59 | getAuditLog | A:444-447 | admin | **no** | limit | users | GET /audit-log?limit= |
| 60 | notifCount | A:455-458 | login | yes | (none) | notifications | GET /notifications/unread-count |
| 61 | notifList | A:459-462 | login | yes | limit | notifications | GET /notifications?limit= |
| 62 | notifRead | A:463 | login | yes | id | notifications | POST /notifications/:id/read |
| 63 | notifReadAll | A:464 | login | yes | (none) | notifications | POST /notifications/read-all |
| 64 | requestDeleteProducts | A:468-478 | login | yes | items | materials | POST /product-delete-requests |
| 65 | listDeleteRequests | A:479-482 | admin | yes | (none) | materials | GET /product-delete-requests |
| 66 | resolveDeleteRequest | A:483-507 | admin | yes | id, approve | materials | POST /product-delete-requests/:id/resolve |
| 67 | listPurchaseRequests | A:617-623 | admin | yes | (none) | purchasing | GET /purchase-orders |
| 68 | getPurchaseOrder | A:625-642 | admin | yes | maDon | purchasing | GET /purchase-orders/:code |
| 69 | listCongTy | A:113-122 | super | yes | (none) | companies | GET /companies |
| 70 | createCongTy | A:123-155 | super | yes | data | companies | POST /companies |
| 71 | updateCongTy | A:169-198 | admin | yes | id, data | companies | PATCH /companies/:id |
| 72 | deleteCongTy | A:199-211 | super | yes | id | companies | DELETE /companies/:id |
| 73 | listCongTyUsers | A:157-162 | super | yes | congTyId | companies | GET /companies/:id/users |
| 74 | createCongTyUser | A:164-168 | super | yes | congTyId, data | companies | POST /companies/:id/users |
| 75 | resolvePurchaseRequest | A:643-655 | admin | yes | maDon, approve | purchasing | POST /purchase-orders/:code/resolve |
| 76 | listDeXuat | A:681-687 | admin | yes | loai | purchasing | GET /proposals?loai= |
| 77 | getDeXuat | A:688-693 | admin | yes | ma | purchasing | GET /proposals/:code |
| 78 | resolveDeXuat | A:694-709 | admin | yes | ma, approve | purchasing | POST /proposals/:code/resolve |
| 79 | baoCaoNhapSP | I:451-552 | super | yes | opts (`{tuVN?, dryRun?}`) | reports | POST /reports/new-products |
| 80 | logClientError | A:436-443 | login | yes | info | auth | POST /client-errors |

Notes on the REST routes:
- Gin needs one wildcard name per path position: always `:id` under `/projects`, `/users`, `/companies`, `/work-items`, `/lines`, `/notifications`, `/product-delete-requests`; `:key` under `/products`; `:code` under `/purchase-orders` and `/proposals`.
- `POST /notifications/read-all` (static) and `POST /notifications/:id/read` (param) share a method tree; needs gin >= 1.8 (static wins). Same for `POST /projects/:id/lines` vs `/projects/:id/lines/blank` (no conflict, deeper level).
- A product `key` is either a numeric row id or a `ma_sp` (S:600). `ma_sp` values may contain `/`, spaces or `%`; REST clients must percent-encode, and a code containing `/` is only reachable through the RPC route. Document, do not "fix".
- `getAuditLog` is in ADMIN_FNS but NOT in ACTOR_FNS (I:118-135): the RPC adapter must NOT prepend the actor.
- `updateCongTy` is ADMIN (not SUPER) at the gateway; the function itself enforces "own company only" (A:171-175).
- Gated product functions accept only the listed parameters: `opts` of `saveDbProduct` / `updateDbProductTracked` is never reachable from a client (A:532, A:538).

### Non-RPC routes (9)

| Route | Handler (I:lines) | Auth | Tenant ctx | Go module | Notes |
|---|---|---|---|---|---|
| GET /media?token= | 635-646 | none | none | files | 400 text `thiếu token`; 502 text `Không tải được ảnh`; `Cache-Control: public, max-age=86400` |
| POST /export/cong-tac | 728-743 (builder 698-727) | login (header or body.token) | none | estimates | body `{rows}` capped 5000; 400 `{error:'Không có dòng nào để xuất'}`; headers Content-Disposition + `X-Row-Count` |
| POST /export/san-pham | 744-760 (builder 652-687) | login | yes (incl. x-view-company) | materials | body `{keys?}`; `X-Row-Count` |
| POST /upload/file?name= | 763-773, error mw 775-778 | login | none | materials | raw body any content-type, limit 51 MB; errors 400; oversize 413 JSON |
| POST /export/bang | 780-794 (builder X:527-567) | login | none | quotations | 400 `{error:'Không có cột nào để xuất'}`; filename `bang.xlsx` |
| GET /mau-nhap-thiet-bi-ve-sinh.xlsx | 797-805 | none | none | categories | filename `Mau-nhap-thiet-bi-ve-sinh-DezonQS.xlsx`, `Cache-Control: no-cache` |
| GET /mau-nhap-cong-tac-o-cam.xlsx?hm= | 807-816 | none | none | categories | filename `Mau-nhap-cong-tac-o-cam-DezonQS.xlsx` |
| GET /mau-nhap-son-nuoc.xlsx?hm= | 818-829 | none | none | categories | filename computed from hang muc (I:824) |
| GET /healthz | 830 | none | none | server | `{ok:true}` |

All four authenticated non-RPC routes answer `401 {"error":"Chưa đăng nhập"}` WITHOUT the `code:"NOAUTH"` field that `/api/:fn` adds (I:613 vs I:730/746/765/782). Template routes answer `500` plain text `Lỗi tạo file mẫu: <msg>`.

Also owned by `internal/server` (not counted above): static `/vendor/jspreadsheet`, `/vendor/formula`, `/vendor/jsuites` from `node_modules` with `maxAge 7d` (I:21-23); static `public/` with `Cache-Control: no-cache` for `.html/.js/.css` (I:24-29); `express.json` limit 30mb (I:19); Swagger `/api-docs` + `/api-docs.json` (I:833-835, `server/swagger.js:160-171`, on unless `NODE_ENV=production` without `SWAGGER_DOCS=1`). The frontend is served by the Node process today, so the Go server must serve `../public` and the three vendor folders too if it is to replace Node (open point, see end).

---

## B. Every top-level function and constant -> exactly one owner

Node names without a same-named Go symbol (inlined or renamed; the logic is present):

| Node | Go |
|---|---|
| `vnToUtcIso_` (I:360) | inlined: `isoString(tuVN - vnOffsetMs)` in `reports/service.go` |
| `NAVY`, `NAVY2`, `GHEAD`, `STRIPE`, `GOLD`, `LINE`, `WHITE` (X:13-19) | `mauNavy`, `mauNavy2`, `mauGHead`, `mauStripe`, `mauGold`, `mauLine`, `mauWhite` in `quotations/model.go` |
| `setFill` (X:82) | `(*xCell).fill` in `quotations/xlsx.go` |
| `importCell_` (SH) | folded into the CSV / xlsx readers of `shared/qscore` |
| `getUserById` (A:212-215) | `(*users.Service).GetByID` |
| `getAdmins_` (A:450) | `(*notifications.Service).ActiveAdmins` |
| `daGuiBaoCaoHomNay_` (I:554-564) | `(*reports.Service).DaGuiHomNay` |
| `scheduleBaoCaoSP_` + boot timer (I:584-589) | `(*jobs.Worker).run` |
| `_hasWhoCol` (S:488) | field `whoColMissing` of `materials.Service` (inverted meaning) |

### B1. server/store_supa.js

| Name | Lines | Purpose | Owner |
|---|---|---|---|
| nganhCua_ | S:14-20 | industry of a product: explicit `nganh`, else guess son -> ct -> vs -> den | categories |
| specNganh_ | S:21 | spec object for 'vs'/'son'/'ct', else null | categories |
| MUC_NGANH | S:22 | industry -> tree heading label | categories |
| n | S:26 | VN number coercion (number passthrough if finite, else toNumber_) | shared/qscore |
| round0_ (store) | S:27 | `Math.round(n(v))` | shared/qscore |
| s | S:28 | `null/undefined -> ''`, else JS `String(v)` | shared/jsval |
| nowIso | S:29 | `new Date().toISOString()` | shared/jsval |
| firstImg | S:30 | first non-empty line of a multi-line image field | materials |
| fmtUnit | S:31 | append unit unless already suffixed (case-insensitive) | materials |
| fmtList | S:32 | comma list, append unit per item | materials |
| fmtCutout_ | S:35-40 | cut-out formatting (prefix diameter sign / add mm) | materials |
| prodToObj | S:43-140 | DB row -> product object sent to client (key order matters) | materials |
| _rawCols | S:143 | lazy cache of raw column list | materials |
| rawCols_ | S:144-153 | `raw` sub-object: all form columns as strings | materials |
| _cache, _cacheAt | S:157 | per-tenant product catalogue cache (5 min) | materials |
| LIM | S:160 | row limit 20000 | shared/qscore |
| chamTran_ | S:161-165 | warn when a query hits its row limit | shared/qscore |
| _ckey_ | S:166 | cache key = tenant id or `_all` | materials |
| _cacheClear_ | S:167 | drop the whole catalogue cache (all tenants) | materials |
| spChungId_ | S:169-176 | id of company `dezon` when current company may use the shared catalogue | materials |
| getProducts | S:177-200 | catalogue + shared catalogue + favourite/combo stamps, refreshes cache | materials |
| guardSpChung_ | S:202-208 | refuse edit/delete of a product owned by another company | materials |
| getProductsCached | S:209-213 | cached catalogue (used by bootstrap) | materials |
| getCatalogSheets | S:214-219 | distinct `nhom` list (exported, not in REGISTRY) | materials |
| buildCatalog | S:220 | clear cache + reload (exported, not in REGISTRY) | materials |
| PROJ_MAP | S:223-226 | client key -> du_an column | projects |
| projToObj | S:227-231 | du_an row -> object | projects |
| getProjects | S:232-235 | list projects | projects |
| getProject | S:236-239 | one project or null | projects |
| genMaDA_ | S:240-246 | project code `DA-YYYYMMDD-HHMMSS` (VN time) + 2 random chars | projects |
| createProject | S:247-256 | insert project | projects |
| updateProject | S:257-265 | patch project | projects |
| deleteProject | S:266-273 | delete lines, cover, project data, project | projects |
| duplicateProject | S:275-312 | copy project + lines + cover + project data, cleanup on failure | projects |
| lineToObj | S:315-330 | db_bao_gia row -> line object | takeoff |
| getLines | S:331-334 | lines of a project | takeoff |
| calc_ | S:336-344 | derived price columns | takeoff |
| addLine | S:345-370 | insert a line | takeoff |
| addBlankLine | S:371-374 | insert an empty line | takeoff |
| LINE_MAP | S:375-377 | client key -> db_bao_gia text column | takeoff |
| updateLine | S:378-404 | patch a line + recompute prices | takeoff |
| deleteLine | S:405 | delete a line | takeoff |
| getCover | S:408-411 | cover rows of a project | quotations |
| buildCoverFromTemplate | S:413-424 | cover from COVER_TEMPLATE + sums of lines | quotations |
| getCoverOrInit | S:425-429 | stored cover or template | quotations |
| saveCover | S:430-440 | replace cover (insert new, then delete old) | quotations |
| DB_NUM | S:446-448 | labels coerced to number on save | materials |
| DB_LABEL2COL | S:449-472 | form label -> column, extended from VS/SON/CT METRIC (466-472) | categories |
| HD_MIG | S:474 | "run npm run migrate" hint text | shared/errors |
| COL_SQL | S:475-478 | set of late-added columns (incl. all spec METRIC columns) | shared/errors |
| colErr_ | S:479-486 | missing-column DB error -> friendly error | shared/errors |
| _hasWhoCol | S:488 | flag: nguoi_tao/ngay_tao/nguoi_sua columns known missing | materials |
| whoColMissing_ | S:489-492 | detect missing who-columns error | materials |
| spHistory_ | S:494-502 | write product history rows (errors swallowed) | materials |
| saveDbProduct | S:503-560 | create or update product by code + variant axes | materials |
| deleteDbProduct | S:561-585 | delete one product row + links + history + audit | materials |
| logAudit_ | S:587-594 | write audit_log row (errors swallowed) | users |
| COL2LABEL | S:596 | reverse of DB_LABEL2COL (last label wins) | categories |
| getDbProduct | S:598-605 | raw product row by id or code | materials |
| dataToRow_ | S:607-618 | `{label: value}` -> `{column: coerced}` | materials |
| diffDbProduct | S:621-634 | changed fields between payload and stored row | materials |
| updateDbProductTracked | S:635-665 | update + history + audit, resets approval | materials |
| setSpDuyet (store) | S:668-718 | approve / unapprove products | materials |
| ytIds_ | S:723-729 | set of favourite product ids (null on error) | materials |
| stampCombo_ | S:732-746 | add `comboN` to each product | materials |
| stampYeuThich_ | S:747-751 | add `yeuThich` to each product | materials |
| findSpAny_ | S:754-759 | product lookup ignoring tenant scope | materials |
| setYeuThich (store) | S:760-797 | toggle favourites | materials |
| getCombo | S:806-836 | bidirectional combo partners of a product | materials |
| comboMissing_ | S:837 | detect "sp_combo table missing" | materials |
| tblErr_ | S:839-847 | table error -> friendly error | materials |
| setCombo | S:855-896 | overwrite combo list of a product | materials |
| btMissing_ | S:901 | detect error mentioning `nhom_bt` | materials |
| getBienThe | S:902-911 | manual variant group members | materials |
| setBienThe | S:913-949 | overwrite manual variant group | materials |
| getProductHistory | S:950-954 | history rows by product code | materials |
| saveLineAsProduct | S:955-964 | takeoff line -> catalogue product | takeoff |
| uploadImage | S:965-974 | base64 image -> storage | materials |
| DOC_EXT | S:977 | allowed document extensions | materials |
| DOC_MAX_MB | S:978 | 50 | materials |
| uploadFile | S:980-983 | legacy base64 document upload | materials |
| uploadFileBuf | S:985-1003 | binary document upload | materials |
| getQuote | S:1006-1013 | project + lines + totals (used by export) | quotations |
| bootstrap | S:1014-1023 | projects + cached products + lines | projects |
| getCatalogSheetsFrom_ | S:1024-1028 | distinct `nhom` of a product list | projects |
| importParse (store) | S:1031 | delegates to shared.importParse | materials |
| importCommit | S:1032-1080 | bulk create/update products from parsed file | materials |
| daDataThieuBang_ | S:1089-1092 | detect "du_an_data table missing" | projects |
| daDataCamQuyen_ | S:1094-1097 | detect permission error | projects |
| DA_DATA_HD | S:1098 | permission hint text | projects |
| ctyKey_ | S:1101 | `__cty:<tenant or 0>` | projects |
| ctyId_ | S:1102 | tenant id or null | projects |
| khongCoCha_ | S:1104 | detect FK violation 23503 | shared/errors |
| DA_MAT | S:1105 | "draft no longer exists" text | shared/errors |
| getProjData | S:1106-1120 | company settings + project data merged | projects |
| PROJ_DATA_KEYS | S:1121 | allowed data keys | projects |
| setProjData | S:1122-1153 | upsert project data / company setting | projects |
| genMaDon_ | S:1156 | purchase order code | purchasing |
| savePurchaseOrder | S:1158-1191 | one order per supplier + items, cleanup on failure | purchasing |
| getPurchaseOrders | S:1193-1207 | orders of a project with items | purchasing |
| dxThieuBang_ | S:1212-1215 | detect "de_xuat table missing" | purchasing |
| dxBang_ | S:1217 | detail table by type | purchasing |
| genMaDeXuat_ | S:1218-1220 | proposal code | purchasing |
| saveDeXuat | S:1223-1270 | insert proposal head + rows | purchasing |
| dxHead_ | S:1271-1278 | proposal head row -> object | purchasing |
| dxItem_ | S:1279-1283 | proposal detail row -> object | purchasing |
| getDeXuatList | S:1285-1296 | proposals of a project | purchasing |
| ctToObj | S:1301-1317 | cong_tac row -> object | estimates |
| CT_SRC | S:1319-1321 | column -> client key | estimates |
| ctToRow_ | S:1322-1334 | client object -> row | estimates |
| ctMissingCol_ | S:1337-1341 | extract missing column name from PGRST204 text | estimates |
| ctTry_ | S:1342-1353 | retry once without the missing column | estimates |
| ctErr_ | S:1354-1361 | cong_tac error -> friendly error | estimates |
| ctList | S:1362-1371 | list work items | estimates |
| ctSave | S:1372-1393 | bulk insert work items + history + audit | estimates |
| CT_FIELD_LBL | S:1395-1401 | column -> history label | estimates |
| ctHistThieu_ | S:1402-1405 | detect "cong_tac_history missing" | estimates |
| ctHistory_ | S:1407-1415 | write work-item history (errors swallowed) | estimates |
| ctDiff_ | S:1417-1429 | field diff for history | estimates |
| ctGetHistory | S:1430-1439 | history rows of a work item | estimates |
| ctUpdate | S:1440-1456 | patch a work item, reset approval | estimates |
| ctDelete | S:1457-1472 | delete work items | estimates |
| ctDuyet | S:1473-1492 | approve / unapprove work items | estimates |
| ctFav | S:1494-1508 | toggle favourite flag | estimates |

### B2. server/auth.js

| Name | Lines | Purpose | Owner |
|---|---|---|---|
| SECRET | A:14 | `AUTH_SECRET` or dev default | auth |
| TOKEN_TTL_MS | A:15 | 7 days | auth |
| b64url | A:18 | base64url without padding | auth |
| sign_ | A:19 | HMAC-SHA256 of token body | auth |
| makeToken | A:20-24 | build `body.sig` | auth |
| verifyToken | A:25-34 | verify signature + expiry | auth |
| _sess | A:37 | session cache Map(uid -> {at,u}) | auth |
| SESSION_CACHE_MS | A:38 | 30 s | auth |
| forgetSession_ | A:39 | drop one cached session | auth |
| todayVN_ | A:41 | today in VN as YYYY-MM-DD | companies |
| hetHan_ | A:42 | company plan expired? | companies |
| sessionActor | A:43-56 | token -> live actor (DB check, cached) | auth |
| audit | A:59-69 | write audit_log row (errors swallowed) | users |
| permsArr_ | A:72 | csv -> array | users |
| userOut | A:73-77 | users row -> object | users |
| getUsersByName_ | A:78-91 | login lookup by username, then email | auth |
| _shareCol | A:93 | cached "dung_sp_dezon column exists" | companies |
| hasShareCol_ | A:94-99 | probe the column once | companies |
| ctOut_ | A:100-106 | cong_ty row -> object | companies |
| getCongTy | A:107-111 | company by id (noScope) or null | companies |
| listCongTy | A:113-122 | all companies + user count | companies |
| createCongTy | A:123-155 | create company (+ owner account) | companies |
| listCongTyUsers | A:157-162 | users of a company | companies |
| createCongTyUser | A:164-168 | create user in a given company | companies |
| updateCongTy | A:169-198 | patch company | companies |
| deleteCongTy | A:199-211 | delete all tenant data + company | companies |
| getUserById | A:212-215 | raw users row by id (noScope) | users |
| pwOk_ | A:218-222 | bcrypt or plaintext check | auth |
| login | A:223-256 | login | auth |
| me | A:257-264 | current user + prefs + company | auth |
| prefsOf_ | A:268 | ui_prefs object or `{}` | auth |
| PREF_KEYS | A:270 | allowed pref keys | auth |
| setMyPref | A:271-287 | set / delete one pref key | auth |
| logout | A:288 | audit only | auth |
| changePassword | A:289-296 | change own password | auth |
| phongBanColErr_ | A:300-303 | detect missing phong_ban column | users |
| permsColErr_ | A:304-310 | missing perms column -> friendly error | users |
| adminListUsers | A:311-318 | list users | users |
| adminCreateUser | A:319-362 | create user | users |
| targetUser_ | A:364-371 | load target user, enforce company / super rule | users |
| keepLastAdmin_ | A:373-379 | refuse removing the last active admin | users |
| adminUpdateUser | A:380-410 | patch user | users |
| adminSetPassword | A:411-417 | reset password | users |
| adminSetActive | A:418-425 | lock / unlock | users |
| adminDeleteUser | A:426-434 | delete user | users |
| logClientError | A:436-443 | log a browser error into audit_log | auth |
| getAuditLog | A:444-447 | read audit log | users |
| getAdmins_ | A:450 | active admins of the current tenant | notifications |
| notify_ | A:451-454 | insert a notification (errors swallowed) | notifications |
| notifCount | A:455-458 | unread count | notifications |
| notifList | A:459-462 | list notifications | notifications |
| notifRead | A:463 | mark one read | notifications |
| notifReadAll | A:464 | mark all read | notifications |
| parseItems_ | A:467 | tolerant JSON.parse of delete-request items | materials |
| requestDeleteProducts | A:468-478 | staff asks to delete products | materials |
| listDeleteRequests | A:479-482 | list delete requests | materials |
| resolveDeleteRequest | A:483-507 | approve (delete products) / reject | materials |
| spPerms_ | A:517-526 | `{edit, duyet, admin?}` of an actor | materials |
| spMyPerms | A:527 | RPC wrapper of spPerms_ | materials |
| updateProductGated | A:529-533 | gate for updateDbProductTracked | materials |
| createProductGated | A:535-539 | gate for saveDbProduct | materials |
| importGated | A:541-545 | gate for importCommit | materials |
| saveLineAsProductGated | A:547-551 | gate for saveLineAsProduct | takeoff |
| setComboGated | A:553-557 | gate for setCombo | materials |
| setBienTheGated | A:559-563 | gate for setBienThe | materials |
| setSpDuyet (auth) | A:565-569 | gate for store.setSpDuyet (`approve !== false`) | materials |
| ctSaveGated | A:574-578 | gate for ctSave | estimates |
| ctUpdateGated | A:579-583 | gate for ctUpdate | estimates |
| ctDeleteGated | A:584-588 | gate for ctDelete | estimates |
| ctDuyetGated | A:589-593 | gate for ctDuyet (`approve !== false`) | estimates |
| ctFavGated | A:594-596 | wrapper for ctFav (`on !== false`) | estimates |
| setYeuThich (auth) | A:600-602 | wrapper for store.setYeuThich (`on !== false`) | materials |
| notifyPurchaseAdmins | A:605-616 | notify admins of new purchase orders + audit | notifications |
| listPurchaseRequests | A:617-623 | all orders (admin inbox) | purchasing |
| getPurchaseOrder | A:625-642 | one order with items | purchasing |
| resolvePurchaseRequest | A:643-655 | approve / reject an order | purchasing |
| PO_BUOC | A:659 | allowed status steps | purchasing |
| setPurchaseStatus | A:660-666 | advance order status one step | purchasing |
| DX_TEN | A:669 | proposal type -> display name | notifications |
| notifyDeXuatAdmins | A:670-680 | notify admins of a new proposal + audit | notifications |
| listDeXuat | A:681-687 | all proposals (admin inbox) | purchasing |
| getDeXuat | A:688-693 | one proposal with rows | purchasing |
| resolveDeXuat | A:694-709 | approve / reject a proposal | purchasing |

### B3. server/index.js

| Name | Lines | Purpose | Owner |
|---|---|---|---|
| app + json/static middleware | I:18-29 | Express app, body limit, static files | server |
| REGISTRY | I:32-114 | RPC whitelist | server (rpc.go) |
| PUBLIC_FNS | I:116 | no-login functions | server (rpc.go) |
| ACTOR_FNS | I:118-127 | functions receiving the actor | server (rpc.go) |
| SUPER_FNS | I:129 | super-only functions | server (rpc.go) |
| ADMIN_FNS | I:130-135 | admin-only functions | server (rpc.go) |
| PURCHASE_WEBHOOK | I:138-139 | Lark webhook URL (env or hardcoded default) | config |
| fmtVN | I:140 | `Math.round(Number(n) or 0).toLocaleString('vi-VN')` | purchasing |
| buildPurchaseCard | I:141-215 | Lark card for a purchase request | purchasing |
| buildDeXuatCard | I:217-275 | Lark card for a proposal | purchasing |
| sendDeXuat | I:277-294 | save proposal, notify admins, post Lark card | purchasing |
| sendPurchaseRequest | I:295-319 | save orders, notify admins, post Lark card | purchasing |
| VN_OFFSET_MS | I:323 | 7 h in ms | reports |
| nowVN_ | I:324 | Date shifted by +7 h (read with UTC getters) | reports |
| BAO_CAO_GIO_VN | I:333 | 8 | reports |
| BAO_CAO_THU | I:334 | [3, 6] (Wed, Sat) | reports |
| BAO_CAO_ACTION | I:335 | `bao_cao_nhap_sp` | reports |
| REPORT_WEBHOOK | I:340 | env or PURCHASE_WEBHOOK | config |
| s_ | I:341 | `String(v ?? '').trim()` | reports |
| tenNganh_ | I:344-349 | industry display name of a product row | reports |
| moBaoCaoTruoc_ | I:352-359 | start of period = 08:00 of previous schedule day | reports |
| vnToUtcIso_ | I:360 | shifted VN date -> real UTC ISO | reports |
| ddmm_ | I:361-364 | `dd/mm` of a shifted date | reports |
| buildSpReportCard | I:367-449 | Lark card of the new-products report | reports |
| baoCaoNhapSP | I:451-552 | build + send report per company | reports |
| daGuiBaoCaoHomNay_ | I:554-564 | already sent today? (audit_log) | reports |
| autoBaoCaoSP_ | I:565-576 | run report if schedule day, >= 08:00 VN and not yet sent | jobs |
| msToNextBaoCao_ | I:577-583 | ms until next Wed/Sat 08:00 VN | jobs |
| scheduleBaoCaoSP_ | I:584-589 | self re-arming timer | jobs |
| boot timer | I:590-593 | catch-up run 70 s after start + start schedule | jobs |
| actorOf_ | I:596-600 | request -> actor (errors -> null) | middleware (auth.go) |
| APP_VER | I:602 | `RENDER_GIT_COMMIT` or boot timestamp | config |
| POST /api/:fn handler | I:603-632 | RPC gateway | server (rpc.go) |
| GET /media handler | I:635-646 | Lark media proxy | files |
| exportProductsXlsx | I:652-687 | product list workbook | materials |
| CT_COLS | I:692-697 | work-item export columns | estimates |
| exportCongTacXlsx | I:698-727 | work-item workbook | estimates |
| POST /export/cong-tac handler | I:728-743 | route | estimates |
| POST /export/san-pham handler | I:744-760 | route | materials |
| POST /upload/file handler + error mw | I:763-778 | route | materials |
| POST /export/bang handler | I:780-794 | route | quotations |
| 3 x GET /mau-nhap-*.xlsx handlers | I:797-829 | routes | categories |
| GET /healthz | I:830 | route | server |
| SWAGGER_ON / mount | I:833-835 | Swagger UI | server |
| app.listen | I:837-840 | start | cmd/api |

### B4. server/export.js (all -> quotations)

| Name | Lines | Purpose | Owner |
|---|---|---|---|
| NAVY, NAVY2, GHEAD, STRIPE, GOLD, LINE, WHITE | X:13-19 | ARGB colours | quotations |
| EXPORT_STY | X:21-54 | per-column label / width / align / format | quotations |
| nz_ | X:56 | `Number(v) or 0` | quotations |
| cellOfLine_ | X:57-73 | derived cell value of a line | quotations |
| px | X:75 | pixel width -> Excel width | quotations |
| roman_ | X:76-80 | 1..20 -> roman | quotations |
| fill | X:81 | dead no-op (only touches the cell) | quotations |
| setFill | X:82 | solid fill | quotations |
| border | X:83-86 | thin border | quotations |
| buildCoverSheet | X:89-164 | sheet "Tờ bìa" | quotations |
| buildSection32 | X:167-231 | sheet "3.2 Phần hoàn thiện" | quotations |
| buildDetailSheet | X:234-324 | one sheet per `nhom`, grouped by `tang`, images | quotations |
| IMG_MAX | X:326 | 5 MB | quotations |
| fetchImage | X:328-354 | fetch image with SSRF guard, PNG/JPEG signature check | quotations |
| sheetName_ | X:356-359 | sanitize sheet name (30 chars) | quotations |
| buildPhanThoSheet | X:366-448 | sheet "3.1 Phần thô" | quotations |
| buildTongSheet | X:452-463 | sheet "Tổng cộng" | quotations |
| exportBaoGia | X:466-522 | entry: workbook -> `{name, mimeType, base64}` | quotations |
| buildBangXlsx | X:527-567 | generic client-built table -> workbook buffer | quotations |

### B5. Other files (reference)

| Name | Lines | Owner |
|---|---|---|
| lark.js `_token`, tenantToken, mediaDownload | lark.js:8, 9-22, 25-32 | files |
| vs-template.js REQ/OPT/VD_FILL/VD_FONT/LINE, batBuoc, cotMau, dongMau, buildVsTemplate | :10, 13, 15-27, 30-38, 40-123 | categories |
| son-template.js consts, dsHM, batBuoc, cotMau, dongMau, buildSonTemplate | :10, 14, 16, 18-31, 35-45, 47-134 | categories |
| ct-template.js consts, dsHM, batBuoc, cotMau, dongMau, buildCtTemplate | :8, 10, 11, 12-22, 23-32, 33-102 | categories |
| shared.js S32_SUPPLIERS, S32_SUBS, COVER_TEMPLATE, inCode, normalize_, toNumber_, round0_, coverComputed_, IMPORT_ALIAS, importCell_, matchAlias_, oChu_, pick2_, importParse | SH:11-191 | shared/qscore (handled elsewhere) |
| supa.js | whole file | platform/database (handled elsewhere); storage upload supa.js:457-469 -> platform/storage |
| tenant.js | whole file | shared/tenant (handled elsewhere) |
| config.js | :5-10 | config |
| infra/scripts/migrate.js files, run | :22-28, 30-75 | cmd/migrate (handled elsewhere) |
| public/vs-spec.js, son-spec.js, ct-spec.js | exports at vs:208-212, son:135-140, ct:190-194 | shared/specs (handled elsewhere) |

Two different `round0_` exist: SH:71 uses `Number(n) || 0`, S:27 uses the VN parser `n()`. `shared.importParse` uses the SH one (SH:180); everything in store uses the S one. Keep both.

---

## C. Shared helpers (used by 2+ modules): single owner + consumer interface

| Helper | Owner (exported as) | Users (call sites) | Consumer interface to declare |
|---|---|---|---|
| audit (A:59-69) and logAudit_ (S:587-594) - same row shape, both swallow errors; `audit` has an optional 4th arg `congTyId` | users: `Audit(ctx, actor, action, detail string, congTyID any)` | auth (A:237, 254, 288, 294, 441), users (A:360, 408, 415, 423, 432), companies (A:153, 196, 209), notifications (A:615, 679), materials (S:544, 558, 582, 660, 710, 893, 946, 1075; A:476, 500, 504), estimates (S:1390, 1454, 1470, 1489), purchasing (A:653, 664, 707) | `type Auditor interface { Audit(ctx, actor, action, detail string, congTyID any) }` |
| getUserById (A:212-215) | users: `GetByID(ctx, id any) (*omap.Map, error)` (raw row, noScope) | auth (A:258, 275, 290), users (A:365), materials (A:471, 488, 520), notifications (A:607, 671), purchasing (A:697) | `type UserReader interface { GetByID(ctx, id any) (*omap.Map, error) }` |
| userOut (A:73-77), permsArr_ (A:72) | users: `UserOut(row) *omap.Map`, `PermsArr(v any) []string` | auth (A:255, 260), companies (A:161), users; permsArr_ also materials (A:521) | `type UserFormatter interface { UserOut(row *omap.Map) *omap.Map }` |
| adminCreateUser (A:319-362) | users: `AdminCreateUser(ctx, actor, data)` | companies (A:150, 167) | `type UserCreator interface { AdminCreateUser(ctx, actor, data *omap.Map) (*omap.Map, error) }` |
| forgetSession_ (A:39) | auth: `ForgetSession(uid any)` | users (A:407, 422, 431) | `type SessionInvalidator interface { ForgetSession(uid any) }` |
| sessionActor (A:43-56) | auth: `SessionActor(ctx, token string) (*actor.Actor, error)` | middleware/auth (I:599) | `type SessionResolver interface { SessionActor(ctx, token string) (*actor.Actor, error) }` |
| getCongTy (A:107-111), hetHan_ (A:42), todayVN_ (A:41) | companies: `GetCongTy(ctx, id any) (*omap.Map, error)`, `HetHan(ct *omap.Map) bool` | auth (A:51-52, 247-252, 262), users (A:340), companies | `type CompanyReader interface { GetCongTy(ctx, id any) (*omap.Map, error); HetHan(ct *omap.Map) bool }` |
| notify_ (A:451-454) | notifications: `Notify(ctx, userID any, kind, title, body string, refID any)` | materials (A:475, 499, 503), purchasing (A:650, 704), notifications | `type Notifier interface { Notify(...) }` |
| getAdmins_ (A:450) | notifications: `ActiveAdmins(ctx) ([]*omap.Map, error)` | materials (A:474), notifications (A:609, 673) | `type AdminLister interface { ActiveAdmins(ctx) ([]*omap.Map, error) }` |
| notifyPurchaseAdmins (A:605-616), notifyDeXuatAdmins (A:670-680), DX_TEN (A:669) | notifications: `NotifyPurchaseAdmins(ctx, actor, orders)`, `NotifyDeXuatAdmins(ctx, actor, dx)`, `DeXuatTen(loai string) string` | purchasing (I:304, I:281, A:703) | `type PurchaseNotifier interface { ... }` |
| spPerms_ (A:517-526) | materials: `SpPerms(ctx, actor) (edit, duyet, admin bool, err error)` | materials gates, takeoff (A:548), estimates (A:575, 580, 585, 590) | `type ProductPerms interface { SpPerms(ctx, actor) (...) }` |
| saveDbProduct (S:503-560) | materials: `SaveDbProduct(ctx, actor, data, opts)` | takeoff (S:961), materials (S:1071, A:538) | `type ProductSaver interface { SaveDbProduct(...) (*omap.Map, error) }` |
| getProductsCached (S:209-213) | materials: `GetProductsCached(ctx)` | projects bootstrap (S:1018) | `type CatalogReader interface { GetProductsCached(ctx) ([]any, error) }` |
| getProducts (S:177-200) | materials | materials export (I:654) | internal |
| getLines (S:331-334) | takeoff: `GetLines(ctx, maDA)` | projects bootstrap (S:1020), quotations (S:417, S:1007) | `type LineReader interface { GetLines(ctx, maDA any) ([]any, error) }` |
| getProject (S:236-239) | projects: `GetProject(ctx, maDA)` | quotations getQuote (S:1008), projects (S:264) | `type ProjectReader interface { GetProject(ctx, maDA any) (*omap.Map, error) }` |
| nganhCua_, specNganh_, MUC_NGANH (S:14-22) | categories: `NganhCua(nganh, hangMuc any) string`, `SpecNganh(ng string) *specs.Spec`, `MucNganh` | materials (S:71, 73, 112, 519, 1057, 1058), reports (I:346-347) | pure functions; may be imported directly (categories imports no module) |
| DB_LABEL2COL (S:449-472), COL2LABEL (S:596) | categories: ordered `[]LabelCol` + lookup maps | materials (S:145, 513, 610, 631; I:660, 677) | pure data; direct import allowed |
| colErr_, COL_SQL, HD_MIG (S:474-486) | shared/errors: `ColErr(err) error`, `HDMig` | projects (S:254, 263, 1148), materials (S:541, 554, 652, 696, 845, 942), purchasing (S:1250), estimates (S:1357, 1503) | shared package |
| khongCoCha_, DA_MAT (S:1104-1105) | shared/errors: `KhongCoCha(err) bool`, `DAMat` | takeoff (S:368), quotations (S:436), projects (S:1147) | shared package |
| n, round0_ (S:26-27), LIM, chamTran_ (S:160-165) | shared/qscore: `N`, `Round0`, `LIM`, `ChamTran` | materials, projects (S:229, 289), takeoff, quotations, purchasing, estimates | shared package |
| s (S:28), nowIso (S:29) | shared/jsval: `S` (or `String`), `NowISO` | all store-derived modules | shared package |
| lark.mediaDownload (lark.js:25-32) | files: `MediaDownload(ctx, fileToken) (buf []byte, contentType string, err error)` | files /media (I:639), quotations fetchImage (X:333) | `type MediaDownloader interface { MediaDownload(...) }` |
| coverComputed_, COVER_TEMPLATE, S32_SUBS, inCode, toNumber_, importParse (SH) | shared/qscore | quotations (S:416, 421; X:90, 178, 180, 182), materials (S:1031) | shared package |
| uploadToStorage (supa.js:461-469) | platform/storage | materials (S:972, 996) | `type Uploader interface { Upload(ctx, buf []byte, path, contentType string) (url string, err error) }` |
| PURCHASE_WEBHOOK, REPORT_WEBHOOK (I:138, 340) | config | purchasing (I:285, 311), reports (I:534) | config fields |
| baoCaoNhapSP, daGuiBaoCaoHomNay_ (I:451-564) | reports | jobs (I:569, 571), RPC | `type ReportRunner interface { BaoCaoNhapSP(ctx, actor, opts) (*omap.Map, error); DaGuiHomNay(ctx) bool }` |

Dependency order that keeps wiring acyclic at construction time (interfaces satisfied later via setters where a cycle exists): users, companies, auth (auth needs users+companies; users needs auth.ForgetSession + companies.GetCongTy; companies needs users) -> notifications -> categories -> materials -> takeoff -> projects -> quotations -> estimates -> purchasing -> reports -> jobs.

---

## D. Cross-module call graph (call sites)

- **auth** -> companies.getCongTy (A:51, 247, 252, 262); companies.hetHan_ (A:52, 250); users.getUserById (A:258, 275, 290); users.userOut (A:255, 260); users.audit (A:237, 254, 288, 294, 441).
- **users** -> auth.forgetSession_ (A:407, 422, 431); companies.getCongTy (A:340); shared/tenant.tenantId (A:330, 368).
- **companies** -> users.adminCreateUser (A:150, 167); users.userOut (A:161); users.audit (A:153, 196, 209); platform/database TENANT_TABLES list (A:204).
- **notifications** -> users.getUserById (A:607, 671); users.audit (A:615, 679).
- **projects** -> materials.getProductsCached (S:1018); takeoff.getLines (S:1020); shared/errors.colErr_ (S:254, 263); shared/tenant.tenantId (S:1101, 1102, 1141). Deletes/copies rows of `db_bao_gia`, `khai_toan` directly (S:267-268, 289-301), not through takeoff/quotations.
- **takeoff** -> materials.spPerms_ (A:548); materials.saveDbProduct (S:961); shared/errors khongCoCha_/DA_MAT (S:368).
- **materials** -> categories.nganhCua_/specNganh_/MUC_NGANH/DB_LABEL2COL/COL2LABEL (S:71, 73, 112, 145, 513, 519, 610, 631, 1057, 1058; I:660, 677); users.logAudit_/audit (S:544, 558, 582, 660, 710, 893, 946, 1075; A:476, 500, 504); users.getUserById (A:471, 488, 520); notifications.getAdmins_ (A:474); notifications.notify_ (A:475, 499, 503); shared/qscore.importParse (S:1031); platform/storage (S:972, 996); shared/tenant (S:166, 170, 203, 763). Internal: resolveDeleteRequest -> deleteDbProduct (A:498).
- **categories** -> shared/specs only.
- **estimates** -> materials.spPerms_ (A:575, 580, 585, 590); users.logAudit_ (S:1390, 1454, 1470, 1489).
- **quotations** -> takeoff.getLines (S:417, S:1007); projects.getProject (S:1008); files.mediaDownload (X:333); shared/qscore (S:416, 421; X:90, 178, 180, 182); shared/errors (S:436).
- **purchasing** -> notifications.notifyPurchaseAdmins (I:304); notifications.notifyDeXuatAdmins (I:281); notifications.notify_ (A:650, 704); notifications.DX_TEN (A:703); users.getUserById (A:697); users.audit (A:653, 664, 707); config webhooks (I:285, 311).
- **reports** -> categories.nganhCua_/MUC_NGANH (I:346-347); direct noScope reads of `db_san_pham`, `users`, `cong_ty`, `audit_log` (I:460, 472, 478, 557) and write of `audit_log` (I:547).
- **jobs** -> reports.daGuiBaoCaoHomNay_ (I:569); reports.baoCaoNhapSP (I:571).
- **files** -> none (config only).
- **server / middleware** -> auth.sessionActor (I:599); shared/tenant.run (I:626, 751); every module's service through the RPC registry.

Cycles in the Node graph: auth <-> users, users <-> companies, auth -> companies -> users -> auth. Break with the interfaces of section C.

---

## E. Database tables per module (code names as passed to supa.*)

R = select, W = insert/update, D = delete. `noScope` marks calls that bypass the tenant filter.

| Module | Tables |
|---|---|
| auth | users R (A:48 noScope, 84 noScope, 87 noScope) W (A:253, 279, 293 all noScope); audit_log via users |
| users | users R (A:213 noScope, 316 scoped unless super, 336, 342, 375 noScope) W (A:355, 402, 414, 421 noScope) D (A:430 noScope); audit_log R (A:445 scoped) W (A:67, S:589 scoped auto cong_ty_id) |
| notifications | notifications R (A:456, 460) W (A:453, 463, 464); users R (A:450 scoped, no limit) |
| companies | cong_ty R (A:96, 109, 115, 130) W (A:146, 195) D (A:208) all noScope; users R (A:116, 143, 159 noScope); D on every key of TENANT_TABLES (A:204-207 noScope): du_an, db_bao_gia, khai_toan, db_san_pham, db_san_pham_history, don_mua_hang, chi_tiet_mua_hang, notifications, delete_requests, audit_log, sp_combo, sp_yeu_thich, cong_tac, de_xuat, chi_tiet_de_xuat_ck, chi_tiet_de_xuat_tt, cong_tac_history, du_an_data, cai_dat_cong_ty, then users last |
| projects | du_an R (S:233, 237, 279) W (S:253, 262, 285) D (S:271); db_bao_gia D (S:267) R (S:289) W (S:292); khai_toan D (S:268) R (S:297) W (S:300); du_an_data D (S:270) R (S:306, 1110, 1143) W (S:309, 1144, 1145); cai_dat_cong_ty R (S:1115, 1134) W (S:1135, 1136) (noScope + `cong_ty_id=is.null` when no tenant) |
| takeoff | db_bao_gia R (S:332, 351, 380) W (S:367, 402) D (S:405) |
| materials | db_san_pham R (S:178, 184 noScope, 205 noScope, 535, 603, 679, 757 noScope, 827 noScope, 907, 934) W (S:540, 551, 651, 693, 929, 937, 939) D (S:570); cong_ty R (S:171, 173 noScope); db_san_pham_history W (S:497, 578, 656, 705) R (S:952); sp_yeu_thich R (S:725, 773 noScope) W (S:777) D (S:575, 787 noScope); sp_combo R (S:734 noScope, 810, 811, 867, 878) W (S:885, 888) D (S:573, 574, 870, 890); delete_requests R (A:480, 484) W (A:473, 491); kho file (nay: ổ đĩa máy chủ, `/files`) |
| categories | none |
| estimates | cong_tac R (S:1364, 1448, 1462) W (S:1380, 1450, 1482, 1499) D (S:1463); cong_tac_history W (S:1388, 1410) R (S:1434) |
| quotations | khai_toan R (S:409, 432) W (S:435) D (S:438); du_an and db_bao_gia only through projects/takeoff |
| purchasing | don_mua_hang W (S:1168; A:648, 662) D (S:1186) R (S:1194; A:618, 626, 644); chi_tiet_mua_hang W (S:1176) D (S:1186) R (S:1198; A:628); de_xuat W (S:1241; A:700) D (S:1268) R (S:1287; A:684, 689, 695); chi_tiet_de_xuat_ck / chi_tiet_de_xuat_tt W (S:1255, 1263) R (S:1292; A:691) |
| reports | db_san_pham R (I:460); users R (I:472); cong_ty R (I:478); audit_log W (I:547) R (I:557) - all noScope |
| files | none |

---

## F. Gotchas

### F1. RPC gateway (I:596-632)
1. `x-app-ver` header is set on every `/api/:fn` response, including 404/401/403/500 (I:604). Value = `RENDER_GIT_COMMIT` or the boot timestamp string (I:602). The frontend reads it (`public/app.js:59`).
2. Unknown function -> `404 {"error":"Không hỗ trợ hàm: <fn>"}` BEFORE authentication (I:606-609). Node resolves `REGISTRY[fn]` through the prototype chain (`/api/toString`, `/api/hasOwnProperty` pass the `typeof === 'function'` test); do not reproduce, answer 404.
3. Token source: `Authorization` header with `/^Bearer\s+/i` stripped, else `body.token` (I:597). Any exception while resolving the session is logged and treated as "not logged in" (I:599).
4. Check order: 401 `{"error":"Chưa đăng nhập","code":"NOAUTH"}` -> ADMIN_FNS 403 `Không có quyền (chỉ Admin)` -> SUPER_FNS 403 `Chỉ quản trị hệ thống` (I:613-617).
5. `args` is used only when `body.args` is an array, else `[]` (I:619). A MISSING trailing argument is JS `undefined`; an explicit JSON `null` is `null`. They differ at: `saveDbProduct` arg shuffle (S:506), `deleteDbProduct` (S:563), `saveLineAsProduct` (S:956), `importCommit` (S:1033), `giaTri === undefined ? null` (S:1131, 1139 - same result), `approve !== false` / `on !== false` (A:568, 592, 595, 601: both undefined and null mean true). The RPC adapter must hand an "absent" marker to services.
6. `x-view-company` is honoured only for role super (I:622). Tenant ctx = `{uid, role, congTyId: actor.ct or null, viewAs or null}` (I:623).
7. Every thrown error is HTTP 500 with `{error: e.message or 'Lỗi máy chủ'}` (I:630), including validation and permission errors thrown inside functions. `result === undefined` -> `null` (I:627).
8. Malformed payloads produce JS TypeError texts as error message (for example `requestDeleteProducts([null])` -> `Cannot read properties of null (reading 'maSP')`, A:469; `importCommit([null])`, S:1041). Byte-identical reproduction of every engine TypeError is not realistic; reproduce the reachable ones you find and list the rest as known deviations.
9. `/export/cong-tac`, `/upload/file`, `/export/bang` run OUTSIDE `tenant.run` (I:728-794); only `/export/san-pham` builds a tenant ctx (I:747-751).

### F2. Auth / sessions
10. Token = `b64url(JSON.stringify({uid,u,r,ct,exp}))` + `.` + `b64url(HMAC_SHA256(SECRET, body))` (A:18-24). `exp` is epoch ms. `token.split('.')` keeps only the first two segments, extra segments are ignored (A:27). Signature compared as strings. Default secret `qs-pro-dev-secret-change-me` (A:14). Tokens issued by Node must verify in Go and the reverse (same secret, `uid` stays a JSON number).
11. Session cache: per uid, 30 s, negative results cached too (A:37-56). Returned actor = token payload overlaid with live `{r, ct, u}` from the DB (A:47, 55). Non-super users need an existing, active, non-expired company (A:50-53). `forgetSession_` is called only from user update / lock / delete (A:407, 422, 431); company lock or expiry takes up to 30 s.
12. `hetHan_` compares strings: `String(ct.hanDung).slice(0,10) < todayVN_()` where today = UTC now + 7 h (A:41-42).
13. login (A:223-256): lookup by lower-cased username; email fallback only when the key has `@` at index > 0 and no `* % \`; `_` escaped for ilike (A:84-88). Candidate rows are sorted with a STABLE sort by `(active ? 2 : 0) + (cong_ty_id ? 1 : 0)` descending (A:228-232). Password: bcrypt when hash matches `/^\$2[aby]\$/`, else plaintext equality with a non-empty password, then auto-upgrade to bcrypt cost 10 (A:218-222, 243). Failure audit uses `rows[0].cong_ty_id` AFTER sorting (A:237). Check order: password -> `Tài khoản đã bị khóa` -> company missing / locked / expired -> update last_login -> audit. Returned `user.lastLogin` is the value BEFORE this login.
14. bcryptjs truncates passwords at 72 bytes; `golang.org/x/crypto/bcrypt` returns an error above 72 bytes. Truncate to 72 bytes before calling to keep behaviour.
15. `changePassword` uses bcrypt only (A:291): an account still holding a plaintext password cannot change it. Length checks use JS string length (UTF-16 units) (A:292, 323, 412).
16. `setMyPref` (A:271-287): `value == null` deletes the key; for keys ending in `Cols` value must be an array of <= 60 strings each with `.length < 40` (UTF-16). Existing prefs key order is preserved.
17. `adminUpdateUser` (A:380-410): `fields.hasOwnProperty(k)` = presence, even when the value is null. Audit detail embeds `JSON.stringify(patch)` with insertion order `ho_ten, role, perms, phong_ban, cong_ty_id` and prints `undefined` when no row came back (`'Sửa tài khoản ' + (res[0] && res[0].username)`, A:408). If the phong_ban retry runs, the key is removed first (A:404).
18. `adminDeleteUser`: `u.id === actor.uid` strict comparison (A:428). `getAuditLog`: `Math.min(Number(limit) || 200, 1000)` (A:445); `notifList`: `Math.min(Number(limit) || 30, 100)` (A:460); `read` is true only for `is_read === true` (A:461).
19. `spPerms_` returns three shapes: `{edit:false,duyet:false}`, `{edit:true,duyet:true,admin:true}`, `{edit,duyet}` (A:517-526). No perms configured = edit + approve.

### F3. Coercion, numbers, strings
20. Two numeric coercions coexist and must be kept per call site: `n()` = VN parser (S:26, SH:59-70: `"12.500.000"` -> 12500000, `"12,5"` -> 12.5, `"1.234"` -> 1234, `"30%"` -> 30, `true` -> 0) versus `Number(x) || 0` (S:347, 353, 360, 363, 384-393; A:103, 135, 185, 620-621, 629; X:56; I:140, 160-171, 233, 248). Example: `addLine` uses `Number(soLuong) || 1` (0 becomes 1, so `addBlankLine` stores quantity 1) and `Number(product.chietKhau) || 0`, but `n(product.donGiaVon)`.
21. `Math.round` rounds half toward +infinity (`Math.round(-2.5) === -2`); Go `math.Round` rounds half away from zero. Affects calc_ (S:336-344), addLine/updateLine percent (S:349, 395), cellOfLine_ (X:59-69), fmtVN (I:140). Use `jsval.Round`.
22. `s(v)` / `String(v)` on numbers uses JS number formatting (`1e21`, `1e-7`, `0.1`); used for diffs (S:629-630), `rawCols_` (S:150), `stt: String(stt)` (S:355), `String(fields.stt)` (S:387, `null` -> `"null"`), ctDiff_ (S:1422).
23. String length / slice are UTF-16 code unit based: `logClientError` slices 20 / 300 / 120 (A:438-439), org name 120 (X:469), sheet names 30 / 26 (X:357, 508), template row heights `txt.length / 95` (vs-template.js:116, son-template.js:127, ct-template.js:97).
24. DB rows arrive as JSON built by Postgres (supa.js:269-275): numerics are JSON numbers, `timestamptz` is the Postgres JSON text form (not the `...Z` form of `toISOString`), `date` is `YYYY-MM-DD`, jsonb is an object in Postgres key order. Never re-parse or re-format timestamps: `s(r.ngay_tao)` passes the string through (S:136, 228, 1202, 1277).
25. Writes go through `json_populate_record(set)` (supa.js:421-441), so Postgres coerces JSON values to column types (number into text column, `0/1` into boolean, `''` into numeric fails). Go must send the same JSON values, not pre-typed parameters, or coercion and error texts change. Example: `tu_nhap: Number(product.tuNhap) || 0` (S:363).
26. Object key order is observable. Integer-like keys are enumerated first in ascending numeric order, then other keys in insertion order: `theoCT` keyed by company id, `bag` keyed by username, `nccAll` (I:483-517). omap alone does not reproduce this; reports must sort integer-like keys first.
27. All sorts are stable (Node >= 11): login candidates (A:228), shared catalogue re-sort (S:193), report sorts (I:508, 513, 517, 526), cover sort (X:129). Use `sort.SliceStable`.
28. `localeCompare(..., 'vi')` (S:193) needs Vietnamese ICU collation (`golang.org/x/text/collate` with `language.Vietnamese`); it only runs when the shared Dezon catalogue is merged in.

### F4. Products (materials)
29. `prodToObj` (S:43-140) key order is fixed by the literal at S:108-139; later code appends `spChung` (S:190), `yeuThich` (S:749, absent when the table read fails), `comboN` (S:744, absent when sp_combo read fails), `comboSL, comboGhiChu, comboId, comboNguoc, comboBoSL` (S:831-833), and overwrites `nhomBT` (S:910). Truthiness matters: `r.quang_thong_lm ? ... : ''` (0 -> ''), `lap_nguon_roi ? 'Có' : ''`, `daDuyet: r.da_duyet === true`.
30. `nganhCua_` guesses in the order son -> ct -> vs -> den (S:14-20); `VS.nganhOf` (vs-spec.js:200-204) is different and must not be used.
31. `DB_LABEL2COL` insertion order (S:449-472) drives `raw` key order (S:145), the product export columns (I:660-666) and `COL2LABEL` (last label wins for a column shared by several labels, S:596). Spec METRIC labels are added only when the label is not present yet (S:468-472), in the order VS, SON, CT.
32. Module-level mutable state: `_rawCols` (S:143), `_cache/_cacheAt` (S:157, cleared for ALL tenants on any product write), `_hasWhoCol` (S:488, set false and never reset), `_sess` (A:37), `_shareCol` (A:93, never invalidated), Lark `_token` (lark.js:8), APP_VER (I:602). All need mutex protection in Go.
33. Drop-column retries after PGRST204 / missing column: saveDbProduct update path deletes only `nguoi_sua` and does NOT set `_hasWhoCol` (S:541); insert path deletes `nguoi_tao, ngay_tao` and sets it (S:553); updateDbProductTracked (S:652); adminCreateUser / adminUpdateUser drop `phong_ban` (A:357, 404); `ctTry_` drops the one column named in `Could not find the '<col>' column`, one retry (S:1337-1353).
34. Error detectors match on the supa error TEXT `DB <METHOD> <table> -> <status> {json}` (supa.js:62-72): `colErr_` (S:479-486), `whoColMissing_` (S:489-492), `comboMissing_` (S:837), `tblErr_` (S:839-847), `btMissing_` (S:901), `daDataThieuBang_`/`daDataCamQuyen_` (S:1089-1097), `khongCoCha_` (S:1104), `dxThieuBang_` (S:1212), `ctErr_` (S:1354), `ctHistThieu_` (S:1402), `/duplicate|unique/i` (S:780), `/dung_sp_dezon/` (S:195). platform/database must emit the same text or these branches die. `listDeXuat` swallows ANY error whose text contains `de_xuat`, which is every DB error on that table (A:685); `ctList` returns `[]` for any `does not exist` error (S:1368).
35. `saveDbProduct` (S:503-560): iterates the payload keys in client order, skips `null`/`''`; `LẮP NGUỒN RỜI` -> `/^(có|yes|true|1|x)$/i`; DB_NUM labels -> `n()`. Duplicate lookup filter (S:524-534) uses PostgREST syntax `ma_sp=eq.X&and=(or(col.is.null,col.eq.),col.eq."...")` with `"` and `\` escaped, key columns `nhiet_do_mau_k, cong_suat_w, goc_chieu_deg, mau_sac` plus `kich_thuoc` when nganh is vs/son or kich_thuoc is set. Return shapes: `{updated:true,ma,ten,id}` or `{created:true,ma,ten,id}`.
36. `dataToRow_` (S:607-618) coerces differently from saveDbProduct: text `null` -> `''`, numeric `''`/null -> `null`, boolean always computed. `diffDbProduct` drops a column missing from the stored row only when the new value is empty (S:628).
37. `deleteDbProduct` calls `guardSpChung_(key)` BEFORE trimming / the empty-key check (S:564-565); history row uses `actor.u` only (S:580) while `spHistory_` uses `actor.u || actor.username` (S:499).
38. `getDbProduct`: an all-digit key is ALWAYS treated as row id (S:600); an all-digit `ma_sp` cannot be found by code.
39. `setSpDuyet` (S:668-718): code keys expand to all rows with that code (limit 200); "not found" errors are pushed without the 5-item cap (S:687) while caught errors are capped (S:701); `errors` key only when non-empty; audit only when something changed; text ends with `…` (U+2026, the exact character in S:712) when more than 8.
40. `setYeuThich` (S:760-797): super without tenant uses `cong_ty_id=is.null`; duplicate insert counts as success. `stampCombo_` reads the whole `sp_combo` table noScope (S:734).
41. `getCombo` swallows errors only for a missing table (S:812); partners are read noScope (S:827). `setCombo` (S:855-896): `Number(x.id)`, `n(x.soLuong) || 1`, `sort_no` = index in the list AFTER removing kept reverse links; steps are not transactional.
42. `setBienThe` accepts ids as scalars or `{id}` objects, keeps only `/^\d+$/` (S:918-922); group name `BT-<id>` (S:931).
43. `resolveDeleteRequest` (A:483-507): atomic claim by conditional update `status=eq.pending`; each delete error is swallowed, first message kept; result `{ok, deleted, loi}`; items stored as a JSON STRING in `delete_requests.items` (A:473) with key order `maSP, id, ten`.
44. Uploads: Node `Buffer.from(x, 'base64')` is lenient (ignores invalid characters and missing padding) (S:967, 982); Go decoders are strict. `uploadImage` extension = content-type subtype with `jpeg` -> `jpg` (S:970). `uploadFileBuf`: size text uses `toFixed(1)`, a name without a dot makes the whole name the extension (S:990), sanitising chain at S:992-993. Storage URLs use `encodeURIComponent(path)` so `/` becomes `%2F` in both the upload and the public URL (supa.js:462, 468).
45. `importCommit` (S:1032-1080): data starts as a copy of `_raw` (file header order), `GIÁ BÁN LẺ` filled only when `n(p.gia) > 0`, `GIÁ ĐẠI LÝ` deleted, `ẢNH SẢN PHẨM` always overwritten, example rows skipped by `VS.VD` prefix, spec filtering keeps `CHUNG + labelsOf(hm)`; per-row errors `{i, ten, error}`; `errors` key only when non-empty; audit text at S:1075.
46. `importParse` (SH:129-191) depends on ExcelJS cell semantics: rich text joined, formula `result`, hyperlink `text`, Date objects and error cells become `''` (SH:103-113); non-integer numbers get a comma decimal (SH:127); header row searched in the first 15 non-empty rows; first matching column wins (SH:159); cap 2000 products; `_nganh` key omitted when undefined; `HẠNG MỤC` header spliced at index `min(2, len)` (SH:189). The CSV branch uses ExcelJS csv parsing, which auto-converts numeric and date-like text. Highest risk of silent divergence with a Go xlsx/csv library.

### F5. Projects / takeoff / cover
47. `genMaDA_` (S:240-246): VN clock via `Date.now() + 7h` and UTC getters; suffix `Math.random().toString(36).slice(2,4).toUpperCase()` (0-2 chars of `[0-9A-Z]`). `genMaDon_` / `genMaDeXuat_`: `Date.now().toString(36).toUpperCase()` + `-` + `floor(random * 1e4)` unpadded (S:1156, 1218-1220).
48. `createProject` copies PROJ_MAP keys whose value is neither null nor `''`, RAW (no coercion); default `trang_thai = 'Bản nháp'`; `ngay_tao` and `cap_nhat` come from two separate `nowIso()` calls (S:249-251). `updateProject` returns the updated row, else `getProject` (null when missing) (S:264).
49. `deleteProject` is four sequential deletes, the `du_an_data` one swallowed (S:266-273). `duplicateProject` copies raw rows minus `id` / `created_at`, skips `bgHist` and (when `opts.pt === false`) `phanTho`, `ptVat`; on any failure it deletes the new project and rethrows (S:286-310). `opts.boc !== false`, `opts.cover !== false`.
50. `updateLine` (S:378-404): every field test is `hasOwnProperty` (presence, null allowed); text fields `null` -> `''`; price rule: `donGiaBan` present -> ln recomputed; else if neither `lnPct` nor `donGiaVon` present -> keep stored `gia_ban`; else recompute from ln. Returns `null` when the line does not exist.
51. `lineToObj` (S:315-330): `lineId` is a string, `stt = n(sort_no)`, `thanhTienVon = round0_(sl * gia_dai_ly)`, `tuNhap/daLuuDM` are 1/0, `extra` defaults to `{}`.
52. FK violation 23503 is turned into `DA_MAT` in addLine (S:368) and saveCover (S:436) but into a silent `{ok:true}` in setProjData (S:1147).
53. `saveCover` inserts the new rows first, then deletes the old ids with `id=in.(...)` (S:430-440). `buildCoverFromTemplate` sums `thanhTienBan` only for leaf template rows using `inCode` (S:413-424).
54. `getProjData` (S:1106-1120): company settings first (no ORDER BY), then project rows override; missing table / permission errors on `du_an_data` are swallowed, errors on `cai_dat_cong_ty` are not. `setProjData`: `__cty` -> `__cty:<tenant or 0>`; that key routes to `cai_dat_cong_ty` (select-then-update-or-insert, not atomic); allowed keys PROJ_DATA_KEYS; `gia_tri` is arbitrary JSON.
55. `bootstrap` (S:1014-1023): projects and cached products are loaded concurrently; a failure in `getLines` yields `lines: []`; `sheetCols` is always `[]`.

### F6. Purchasing / Lark
56. `sendPurchaseRequest` / `sendDeXuat` merge with `Object.assign({defaults}, payload)`: the client payload can override `kenh`, `ketQua`, `requesterId` (I:279, 299). Notification errors and webhook errors are swallowed; result always `{ok:true, ...}` once the DB save succeeded. Lark success = `code === 0 || StatusCode === 0 || msg === 'success'` (I:290, 315).
57. Card texts (I:141-275, 367-449): `toLocaleString('vi-VN')` (dot thousands separator, `-0` possible), ideographic space U+3000, `×`, `−` (U+2212), `→`, emojis. The date stamp uses the PROCESS LOCAL timezone (`getDate/getMonth/getFullYear`, I:199-200, 260-261), not VN time.
58. `savePurchaseOrder` (S:1158-1191): one order per supplier, `tong_truoc_vat = total - vat`, `thanh_tien = sl * dg` unrounded; on error it deletes everything saved in this call (deletes swallowed) and rethrows. `saveDeXuat` deletes the head if detail rows fail (S:1268).
59. Status changes are conditional updates on the previous status and fail with a specific message when zero rows change: `Đơn đã được xử lý` (A:649), `Đơn phải ở trạng thái "..." mới chuyển sang "..."` (A:663), `Đề xuất đã được xử lý` (A:702). `getPurchaseOrder` uses a local `Number(v) || 0` (A:629), not the VN parser. `listPurchaseRequests` returns raw column values (null stays null) (A:619-622).
60. `getAdmins_` is tenant scoped and unlimited (A:450); with a super actor without `viewAs` it returns admins of ALL companies.

### F7. Work items (estimates)
61. `ctToObj`: `kl/dt/hs` are `''` when null else number; `ngayDuyet/ngayTao/ngayCapNhat` use `value || ''` (S:1301-1317). `ctToRow_` numeric `''`/null -> null; `thu_tu` only when provided (S:1332).
62. `ctUpdate` writes only columns whose client key is present in the patch (S:1446) but ALWAYS resets approval (S:1447). `ctDiff_` treats values equal when `parseFloat` of both are equal (`"5abc"` equals `5`) and skips who/when columns (S:1417-1429).
63. `ctDelete/ctDuyet/ctFav`: per-id loop, errors capped at 5, `errors` key only when non-empty, audit only when `ok > 0`; `ctFav` aborts the whole call when the `yeu_thich` column is missing (S:1502-1503).

### F8. Reports / jobs
64. VN time is modelled as a Date shifted by +7 h and read with UTC getters (I:323-364). `opts.tuVN` is parsed with `new Date(string)` and interpreted as such a shifted clock (I:455); invalid -> `{sent:false,count:0,message:'Mốc thời gian không hợp lệ'}`.
65. Result shapes differ: no rows (I:463), no attributed rows (I:468-469, adds `khuyet`), dryRun (I:528: `sent,count,soThe,khuyet,tu,the` with full per-company detail), sent (I:551: `sent,count,khuyet,the` with `{congTy,soSP,sent}`).
66. User names are resolved through a map keyed by lower-cased username over ALL companies (I:472-476); day comparator is `x.ngay < y.ngay ? 1 : -1` on `dd/mm` strings (I:513).
67. Jobs: a one-shot timer 70 s after boot runs the catch-up check and starts the self re-arming schedule (I:584-593). Guards: weekday in [3,6] VN, hour >= 8 VN, and no `audit_log` row with action `bao_cao_nhap_sp` dated today (VN) among the 5 newest (I:554-576). The audit row is written only when at least one webhook call succeeded (I:545-550). The job runs with actor `{r:'super'}` and no tenant ctx. If Node and Go run at the same time both will send: the Go job needs an on/off switch in config.

### F9. Excel output
68. ExcelJS and a Go library cannot produce byte-identical files. Define parity at the level of sheet names and order, cell values and types, number formats, merges, column widths, fills, fonts, frozen panes, images. `exportBaoGia` returns `{name, mimeType, base64}` inside the JSON envelope (X:517-521).
69. `exportBaoGia` details: `format` is unused; `nodes` filters lines by code prefix (X:471-476); `anMuc` hides cover rows by top-level number (X:489-490); sheet order `Tờ bìa`, `Tổng cộng` (optional), `3.2 Phần hoàn thiện`, `3.1 Phần thô` (optional), then one sheet per `nhom` in first-appearance order, de-duplicated case-insensitively with ` 2`, ` 3` suffixes on a 26-char base (X:496-512); file name = `BaoGia_` + name with combining marks removed and `[^\w\-]+` -> `_` (đ/Đ become `_`) (X:516). `cellOfLine_` default branch uses `l[c.k] || ''` (0 becomes `''`) (X:288).
70. `fetchImage` (X:328-354): `/media?token=` goes to Lark; http(s) URLs are refused for localhost, `.local`, `.internal`, hosts containing `:`, private IPv4 ranges; 8 s timeout; 5 MB cap; only PNG / JPEG by magic bytes; every error -> image skipped.
71. `exportCongTacXlsx`: `r.khoiLuong === '' ? null : Number(r.khoiLuong) || null` (0 becomes null) (I:712-716). `exportProductsXlsx` reloads the catalogue (`getProducts`, refreshing the cache), filters by `recordId` or `ma`, file name uses the UTC date (I:652-687).
72. `/mau-nhap-son-nuoc.xlsx` file name: `chuanHM(hm)` NFD-stripped, `đ` (case-insensitive) -> `d`, `[^\w]+` -> `-` (I:824).

### F10. Companies
73. `createCongTy` slug: lower-case, NFD strip, `đ` -> `d`, non `[a-z0-9]` runs -> `-`, trim dashes, first 32 chars (A:128-129); `gioi_han_user = Number(...) || 10`; the owner account is created AFTER the company insert, so a failure there leaves the company in place (A:146-152). Go differs since D-13 (2026-10-15): `InsertCongTy` + `adminCreateUser` run in one transaction, so a failure leaves no company.
74. `updateCongTy`: fields are applied when `!= null`; non-super admins may change only `ten, logoUrl, mauChinh, email, sdt` of their own company; empty patch returns `getCongTy(id)` without audit (A:169-198).
75. `deleteCongTy` deletes tenant tables in TENANT_TABLES key order with `users` last, swallowing every per-table error (A:203-208). Go since D-13: the loop + company delete run in one transaction; per-table errors are still swallowed (savepoint per statement), but a failure of the final delete rolls everything back.
76. `adminCreateUser` company precedence: super with `data.congTyId`, else `tenant.tenantId()` (includes viewAs), else `actor.ct` (A:329-330). Role downgrade and perms rules at A:348-350.

---

## Open points (not resolvable from the source alone)

- Static frontend: Node serves `public/` and three folders from the root `node_modules` (I:21-29). Whether the Go server serves them (path via config) or a reverse proxy does is a deployment decision.
- Swagger UI (I:833-835): port or drop.
- REST error envelope and status codes: the RPC route must keep "everything is 500"; the REST routes are new and free to map errors to 4xx.
- `notifyPurchaseAdmins` / `notifyDeXuatAdmins` / `DX_TEN` / `getAdmins_` are assigned to **notifications** here (the task text says "notify* helpers"); purchasing consumes them through an interface.
