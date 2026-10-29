---
name: thiet-bi-ve-sinh
description: Thêm/sửa/bỏ thông số (metric) của ngành Thiết bị vệ sinh theo từng hạng mục (Bồn cầu, Lavabo, Sen tắm…) trong QS Pro — form Nhập dữ liệu, file mẫu nhập hàng loạt, bộ lọc panel Bóc tách, panel chi tiết SP, cột Thông tin chính / Thông số thiết kế. Dùng khi user nói tới "thiết bị vệ sinh", "vs", "metric hạng mục", "file mẫu vệ sinh", "bộ lọc vệ sinh", hoặc thêm hạng mục vệ sinh mới.
---

# Thiết bị vệ sinh — thông số theo hạng mục

## Nguồn DUY NHẤT: `backend/internal/shared/specs/js/vs-spec.js`
Module UMD (`window.VS_SPEC` ở trình duyệt; server Go nhúng file bằng `go:embed` và phục vụ ở `/vs-spec.js`, dữ liệu cho Go nằm ở `backend/internal/shared/specs/data/*.json` sinh từ file JS). Mọi nơi đọc từ đây — **không** khai báo lại danh sách thông số ở chỗ khác.
Sửa bất kỳ `*-spec.js` nào xong phải chạy `node backend/scripts/gen-specs.js` (sinh lại `specs/data/*.json` và golden), rồi từ `backend/`: `go test ./internal/shared/specs ./internal/server`.

- `METRIC[NHÃN] = [cột DB, nhãn hiển thị, kiểu 'text'|'sel'|'area', gợi ý nhập]` — NHÃN cũng là tiêu đề cột Excel và khoá của `DB_LABEL2COL`.
- `HM[hạng mục] = { chinh:[…], tk:[…], req:[…], opt:{NHÃN:[lựa chọn]}, mau:{dòng ví dụ} }`
  - `chinh` → khối "Key Product Info" + cột **Thông tin chính** (bảng bóc tách/báo giá)
  - `tk` → khối/cột **Thông số thiết kế**
  - `req` → bắt buộc (form chặn lưu, import báo lỗi từng dòng)
  - `opt` → danh sách chọn riêng hạng mục (datalist form, dropdown Excel, thứ tự chip bộ lọc)
- Helper: `chuanHM` (chuẩn hoá tên hạng mục), `labelsOf`, `optsOf`, `isReq`, `nganhOf(nganh, hangMuc)` (ngành trống + hạng mục vệ sinh ⇒ 'vs' — dùng ở CẢ client & server), `CHINH_ALL`/`TK_ALL`/`gom` (hợp thông số, dùng cho bảng, file mẫu, prodToObj), `CHUNG` (trường chung — import vệ sinh bỏ mọi cột ngoài CHUNG + thông số hạng mục), `kem` (hạng mục gợi ý combo), `VD` = tiền tố `[VÍ DỤ]` của dòng ví dụ trong file mẫu (tự bỏ qua khi nhập).

## Nơi tiêu thụ (tự đổi theo khi sửa vs-spec.js)
Lưu ý: bảng dưới ghi vị trí trong app Node cũ (`public/`, `server/`), đã gỡ khỏi repo. Bản hiện hành là Go (`backend/internal/`) và React (`frontend/src/pages/QS`) — grep theo tên hàm / nhãn để tìm chỗ tương ứng.

| Chỗ | File / hàm |
|---|---|
| Form Nhập + modal Sửa: chỉ hiện thông số của hạng mục đang chọn | `nhap.js` `DB_GROUPS_VS` (hợp mọi hạng mục), `vsApplyHM_`, `tdSave`; `sanpham.js` `speField_`, `spEditSave` (xoá thông số không thuộc hạng mục) |
| File mẫu nhập hàng loạt — **bố cục y hệt file mẫu đèn** (user yêu cầu): 1 sheet `San pham` phẳng, tiêu đề xanh sáng `FF2563EB` = bắt buộc / xanh đậm `FF12324C` = tuỳ chọn, 3 dòng ví dụ nền `FFF7F9FC` chữ nghiêng, tên bắt đầu `[VÍ DỤ]` (tự bỏ qua khi nhập), không dropdown/ghi chú; sheet `Hướng dẫn` đánh số + bảng thông số theo hạng mục | `server/components/xuat-file/vs-template.js` → route `GET /mau-nhap-thiet-bi-ve-sinh.xlsx` (tạo động, không có file tĩnh) |
| Đọc file: đọc MỌI sheet (trừ "Hướng dẫn"), HẠNG MỤC trống = tên sheet (vẫn nhận file kiểu cũ 1 sheet/hạng mục) | `server/components/san-pham/san-pham.import.js` `importParse(b64, ext, 'vs')` |
| Commit: đóng dấu `nganh='vs'`, chuẩn hoá hạng mục, bỏ cột của hạng mục khác, chặn thiếu bắt buộc | `server/components/san-pham/san-pham.import.js` `importCommit` (client gửi `p._nganh='vs'`) |
| Xem trước import: ô "—" = không áp dụng, viền đỏ = thiếu bắt buộc | `nhap.js` `impVsCheck_`, `impRow_`, `impVsSummary_` |
| Ghép Thông tin chính / Thông số thiết kế | `server/components/san-pham/san-pham.mapper.js` `prodToObj` nhánh `nganh==='vs'` |
| Panel chi tiết SP + chip thông số | `app.js` `pdSpecsVS_`, `vsChip_`, `vsVal_` (đọc `p.raw[cột]`) |
| Bộ lọc panel trái tab Bóc tách (đề mục 3.2.5) | `app.js` `renderVsFilters_`, `vsFltMatch_`, state `S.fVs={cột:{giá trị:1}}` |

## Checklist khi THÊM thông số mới
1. Thêm vào `METRIC` (cột DB snake_case, kiểu `text` — cột mới luôn là **text**, không đưa vào `DB_NUM`).
2. Gắn vào `chinh`/`tk` (+ `req`/`opt` nếu cần) của các hạng mục liên quan.
3. Viết migration `infra/db/migrations/NNNN_ten.sql` (tên cột TIẾNG ANH): `alter table product_sanitary_specs add column … text` (cột dùng cho từ 2 ngành trở lên thì thêm vào `products`), rồi `drop view product_catalog` và tạo lại view kèm cột mới (chép định nghĩa trong `infra/db/schema.sql`). Thêm cặp `"cot_trong_code": "column_in_db"` vào `db_san_pham.columns` của `backend/internal/platform/database/db-map.json` (bản duy nhất).
4. Chạy `go run ./cmd/migrate` từ `backend/` (database ở `DATABASE_URL`), khởi động lại server, sinh lại `infra/db/schema.sql`. Quy trình đầy đủ: `docs/02-ky-thuat/database/ket-qua-trien-khai.md` mục 7.
5. Kiểm tra: `node --check backend/internal/shared/specs/js/<ngành>-spec.js`, `node backend/scripts/gen-specs.js`, rồi từ `backend/`: `go test ./internal/shared/specs ./internal/server` (thêm ca test khi thêm logic mới).

## Ngành SƠN NƯỚC — cùng khuôn, khác spec
`backend/internal/shared/specs/js/son-spec.js` (`SON_SPEC`) là bản song song của vs-spec cho đề mục **3.2.2 Sơn nước**: cùng API (`METRIC`/`HM`/`HANG_MUC`/`CHUNG`/`chuanHM`/`labelsOf`/`optsOf`/`isReq`/`CHINH_ALL`/`TK_ALL`/`VD`), hạng mục = dòng sơn (Sơn nội thất · ngoại thất · lót · chống thấm · Bả matit · hiệu ứng · sàn epoxy · Dung môi), `chinh` = Key Product Info, `tk` = mục IX tính chất lý hoá. File mẫu `server/son-template.js` → `GET /mau-nhap-son-nuoc.xlsx`; bảng `product_paint_specs` (migration `infra/db/migrations/0006_product_spec_tables.sql`).

Chỗ chọn spec theo ngành (thêm ngành mới thì sửa đúng mấy chỗ này; ngành Điện lạnh `dl` thêm ngày 2026-10-28 theo đúng danh sách này):
| Nơi | Chỗ |
|---|---|
| Spec + golden | `specs/js/<ngành>-spec.js`, `specs/source.go` (go:embed + `SourceFiles`), `specs/specs.go` (`load`), `specs/specs_test.go` (`byName`, các danh sách), `backend/scripts/gen-specs.js` (`SPECS`, `NAMES`, `LABELS_ALL`, `NGANH`); hàm riêng của spec (vd `dl` có `laChung` / `doanHM`) viết bản Go (`specs/dl.go`) + ca golden |
| Server Go | `modules/categories/service.go`: `NganhCua`, `SpecNganh`, `MucNganh`, bảng nhãn↔cột · `shared/errors/colerr.go` · `shared/qscore/importparse.go` `specOf` · `modules/materials`: `service_import.go` (`_nganh`), `service_write.go`, `service_format.go` (`prodToObj`) · file mẫu `categories/template_<ngành>.go` (route gốc `/mau-nhap-*.xlsx` đóng băng: ngành mới đi `/api/v1/product-templates/...`) · `server/assets_test.go` |
| Database | migration bảng `product_<ngành>_specs` + tạo lại view `product_catalog` · `db-map.json` `db_san_pham.columns` + `parts` · `infra/deploy/Caddyfile` (đường dẫn `/<ngành>-spec.js`) |
| Client React | `api/specs.js`, `api/files.js` (`TEMPLATES`), `lib/productFields.js` (`dbGroups*`, `coSpec_`, `specNganh_`, `nganhCuaSP_`, `groupsOfNganh_`, `IMP_LOAI`, `dbLabelMaps_`), `lib/catalogFilters.js`, `components/importer/*`, `components/products/list/spModel.js`, `components/products/edit/editModel.js`, `components/breakdown/catalog/catalogModel.js`, `components/purchase/ProductModal.jsx` |
| Test golden Node | golden Node không sinh lại được: chỉ sửa mã test (`categories` `nodePart`, `colerr_test`, `materials` `stripDL` / `goonly.StripEmpty`) |

Nhãn TRÙNG giữa 2 spec phải trỏ **cùng một cột DB** (MÀU SẮC · KÍCH THƯỚC · BỀ MẶT HOÀN THIỆN · LƯU Ý).

## Lưu ý / bẫy
- Nhãn phải DUY NHẤT toàn hệ thống (đèn + vệ sinh dùng chung `DB_LABEL2COL` trong `san-pham.mapper.js`); dùng lại nhãn đèn đã có (vd `CHẤT LIỆU`, `MÀU SẮC`) thì trùng cột là đúng ý.
- Tránh tiêu đề cột chứa chuỗi alias của `IMPORT_ALIAS` (`san-pham.import.js`) đứng TRƯỚC cột gốc (vd "PRODUCT", "TÊN") — dò header theo chuỗi con.
- Đổi ngành đèn ↔ vệ sinh ở panel Bóc tách tự xoá `S.fNhomSet`/`S.fVs`; bộ lọc đèn (Công suất/Nhiệt độ/Góc) bị bỏ qua khi ở 3.2.5.
- Thứ tự ô trên form theo thứ tự khai báo của hạng mục (CSS `order`), không theo `DB_GROUPS_VS`.
- Nhập dữ liệu dùng **danh sách chờ** (`S._pending` sản phẩm / `S._ctPending` công tác): form/file chỉ đưa vào chờ, nút Thêm mới ghi DB. Có khoá `S._committing` chống bấm 2 lần; khi lưu xong chỉ bỏ các dòng đã lưu theo `uid` (dòng thêm trong lúc lưu được giữ). Lỗi `importCommit` trả `{i, ten, error}` — client ghép theo chỉ số `i`, KHÔNG theo tên (biến thể trùng tên).
- Khớp tiêu đề cột Excel (`matchAlias_`) theo NGUYÊN TỪ — tránh "ẢNH" khớp nhầm "BẢO HÀNH".
- **Ghi danh SP vào dự án phải theo ĐỀ MỤC CỦA NGÀNH**: vệ sinh → `3.2.5`, đèn → `3.2.6.1`. `addProdObj` (`boc.js`) lấy đề mục qua `prodNode_` (trong tab Bóc tách thì theo `S.node` người dùng chọn, ngoài Bóc tách theo `spNodeCodeOf_(p)` trong `sanpham.js`, từ trường `muc`); form Nhập dùng `impLoai_()` (`nhap.js`). Đóng dấu sai đề mục ⇒ dòng vẫn lưu nhưng tab Dự án / Chi phí / Mua hàng lọc theo hạng mục sẽ không thấy — trong `chiphi.js`: `hmLacNote_` báo "đang nằm ở hạng mục khác", `hmSaiNote_` + `hmSaiFix_` chuyển các dòng cũ về đúng đề mục.
