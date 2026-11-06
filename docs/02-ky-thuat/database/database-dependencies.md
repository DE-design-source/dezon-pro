# Phụ thuộc giữa database và code

> **Cập nhật 2026-10-12:** tài liệu này mô tả database `qspro_en` TRƯỚC refactor (mốc audit). Cấu trúc đang chạy: [schema-hien-hanh.md](schema-hien-hanh.md); kết quả triển khai: [ket-qua-trien-khai.md](ket-qua-trien-khai.md).
>
> **Ghi chú 2026-11-06:** viết khi còn app Node (đã gỡ ở commit `5fa5d52`); đường dẫn `server/*.js`, `public/*.js`, `render.yaml` và lệnh `npm ...` trong tài liệu này là mã / cách làm cũ. Hiện nay: migration chạy bằng `go run ./cmd/migrate` (trong `backend/`), `db-map.json` duy nhất ở `backend/internal/platform/database/db-map.json`, bảng tự lọc công ty khai trong `TenantTables` (`backend/internal/platform/database/postgres.go`).

- Nguồn: truy vết `server/*.js` và `public/*.js` ở commit `83d264e` (2026-10-12). Mọi dòng ghi `file:dòng` là đã mở file kiểm tra.
- Tên bảng/cột ghi theo tên **code đang dùng** (tiếng Việt); tên trong database xem [data-dictionary.md](data-dictionary.md).
- Viết tắt: `S` = `server/store_supa.js`, `A` = `server/auth.js`, `I` = `server/index.js`.
- `UNKNOWN` = chưa xác minh được.

## 1. Cơ chế chung

| Cơ chế | Mô tả | Bằng chứng |
|---|---|---|
| Lối vào duy nhất | `supa.select / insert / update / remove`. Không raw SQL, không RPC, không view, không trigger | `server/supa.js` |
| Tự lọc công ty | 18 bảng trong `TENANT_TABLES`: select/update/remove tự thêm `cong_ty_id=eq.<tenant>`; insert tự gắn `cong_ty_id` nếu dòng chưa có | `supa.js:34-57`, `:266-269` |
| Bỏ lọc | `noScope: true` (42 chỗ, phân loại ở [tenant-security.md](tenant-security.md)); hoặc super admin chưa chọn công ty | `tenant.js:20-24` |
| Sắp xếp | Có `order` thì tự thêm `id.asc` làm khoá phụ; cột chữ sắp theo collation ICU `en-US` | `supa.js` |
| Phân quyền API | `PUBLIC_FNS` (login), `ADMIN_FNS` (17 hàm), `SUPER_FNS` (6 hàm), còn lại: mọi user đã đăng nhập | `I:116-135` |
| Tác vụ nền | Hẹn giờ báo cáo nhập SP: đọc `db_san_pham`, `users`, `cong_ty`; ghi 1 dòng `audit_log` | `I:451-593` |
| Script | `infra/scripts/sync-from-supabase.js`: xoá sạch rồi nạp lại toàn bộ database đích | cần `--yes` |

## 2. Bảng đối chiếu theo bảng

Cột "Đề xuất" tham chiếu mã quyết định trong [decisions.md](decisions.md).

### 2.1 Công ty, tài khoản, nhật ký

| Bảng / cột | Mục đích | Nơi đọc | Nơi ghi | Phụ thuộc | Đề xuất |
|---|---|---|---|---|---|
| `cong_ty` (cả dòng) | Tenant + gói dịch vụ | `getCongTy` (login, me, sessionActor) `A:107`; `listCongTy` `A:113`; `spChungId_` `S:171`; báo cáo `I:478` | `createCongTy` `A:123`; `updateCongTy` `A:169`; `deleteCongTy` `A:208` | `ma='dezon'` là giá trị đặc biệt của kho SP chung `S:173` | Giữ |
| `cong_ty.tinh_nang` | Module theo gói (danh sách cách dấu phẩy) | Trả về client `A:102`; **chỉ trình duyệt kiểm** `public/app.js:2486` | create/update | Khoá: dash, boc, chiphi, export, muahang, duan, sanpham, import | D-08 |
| `cong_ty.han_dung`, `active` | Khoá / hết hạn công ty | `login` `A:249-250`; mỗi request `A:52` | updateCongTy (super) | Cache phiên 30 giây | Giữ |
| `cong_ty.gioi_han_user` | Giới hạn số tài khoản | `adminCreateUser` `A:339-345` | create/update | Đếm cả tài khoản bị khoá; không nguyên tử | Giữ |
| `cong_ty.nhac_lan_cuoi`, `nhac_moc` | Nhắc hạn (đã gỡ ở 42af44d). Cập nhật 2026-10-15: nhắc gia hạn trong ứng dụng (M17.3, chỉ server Go) | Go `companies.NhacGiaHan` | Go `companies.NhacGiaHan` (ghi mốc); `UpdateCongTy` xoá khi đổi `han_dung` | Job 8h05 VN (công tắc `REPORT_JOB`) | Giữ (ra khỏi D-09, migration 0012) |
| `users` (cả dòng) | Tài khoản | `sessionActor` `A:48`; `getUsersByName_` `A:84,87`; `getUserById` `A:212`; `adminListUsers` `A:311`; `getAdmins_` `A:450`; báo cáo `I:472` | `adminCreateUser` `A:351`; `adminUpdateUser` `A:402`; `login` (last_login) `A:253`; `setMyPref`; đổi/đặt mật khẩu; khoá; xoá | Gần như mọi truy vấn dùng `noScope`; cách ly dựa vào `targetUser_` `A:364-371` | D-05 (unique username) |
| `users.perms` | Quyền (danh sách cách dấu phẩy) | Server: `spPerms_` `A:517-526` (chỉ `sp_edit`, `sp_duyet`); client: quyền theo tab | create/update user | User không có cả hai quyền SP thì được cả hai | D-08 |
| `users.password_hash` | bcrypt | `pwOk_` `A:218`; không trả về client (`userOut` `A:73`) | create, đổi, đặt lại, tự băm khi đăng nhập | Nhiều `select *` nạp cột này không cần thiết | Giữ; thu hẹp select |
| `audit_log` | Nhật ký, chỉ thêm | `getAuditLog` `A:444` (admin, tối đa 1000); kiểm trùng báo cáo `I:557` | `audit()` `A:59`; `logAudit_` `S:588`; báo cáo `I:547` | 31 giá trị `action`; lỗi ghi bị nuốt; không có hạn lưu | D-04 (FK user) |
| `notifications` | Thông báo cho user | `notifCount/List` `A:455-462` | `notify_` `A:451`; `notifRead/ReadAll` | `ref_id` đa hình (id phiếu xoá / mã đơn / mã đề xuất) | D-04 |

### 2.2 Danh mục sản phẩm

| Bảng / cột | Mục đích | Nơi đọc | Nơi ghi | Phụ thuộc | Đề xuất |
|---|---|---|---|---|---|
| `db_san_pham` (cả dòng) | Sản phẩm / biến thể | `getProducts` `S:177` (`*`, sắp `ten_sp`, tối đa 20000, cache 5 phút theo công ty); `getDbProduct` `S:599` (trả nguyên dòng DB); `getBienThe` `S:910`; `getCombo` `S:828`; báo cáo `I:460` | `saveDbProduct` `S:504` (chèn hoặc cập nhật theo khoá biến thể); `updateDbProductTracked` `S:636`; `setSpDuyet` `S:694`; `setBienThe` `S:932`; `deleteDbProduct` `S:571`; nhập hàng loạt `S:1035` | `prodToObj` `S:43-140` đổi sang camelCase + `raw` (tên cột tiếng Việt). Client: `sanpham.js`, `nhap.js`, `boc.js`, `app.js`, `chiphi.js` | D-06 (tách theo ngành) |
| Khoá biến thể: `ma_sp, nhiet_do_mau_k, cong_suat_w, goc_chieu_deg, mau_sac, kich_thuoc` | Chống trùng | `saveDbProduct` `S:524-536` (lọc `and=(or(...))`) | cùng hàm | Unique index theo `(cong_ty_id, ma_sp, coalesce(5 trục,''))`. Code chỉ thêm `kich_thuoc` vào khoá khi ngành vs/son | Giữ nguyên |
| `gia_dai_ly` | Giá đại lý (dẫn xuất) | `prodToObj` -> `donGiaVon`, `donGiaBan` `S:132` | **Không code nào ghi** (cột generated ở Supabase) | Lỗi A1 trong audit | D-02 (khôi phục generated) |
| `da_duyet, nguoi_duyet, ngay_duyet` | Duyệt SP | `prodToObj` | `setSpDuyet`; tự về false ở `S:539`, `S:647-650` | Lịch sử ghi `TRẠNG THÁI DUYỆT` | Giữ |
| `nhom_bt` | Nhóm biến thể thủ công `BT-<id>` | `getBienThe`, client `app.js:666` | `setBienThe` | Không FK | Giữ |
| `nganh`, `hang_muc` | Ngành và hạng mục | `nganhCua_` `S:14-20`; spec `public/*-spec.js` | `saveDbProduct` `S:520`; nhập hàng loạt | Quyết định bộ cột thông số | Giữ |
| 70 cột thông số vs/son/ct | Thông số theo ngành | Qua `DB_LABEL2COL` `S:444-467`, `raw` | Qua form và file mẫu | Định nghĩa trong `public/vs-spec.js`, `son-spec.js`, `ct-spec.js` | D-06 |
| `db_san_pham_history` | Lịch sử SP | `getProductHistory` `S:953` (theo `ma_sp`, 200 dòng mới nhất) | Chỉ chèn: `S:544,558,579,632,649,657,698,895,948` | Khoá là mã SP dạng chữ, hoặc tên SP khi không có mã | Giữ (tham chiếu mềm) |
| `sp_combo` | SP đi kèm | `getCombo` `S:811`; `stampCombo_` `S:735` (đọc cả bảng, mọi công ty) | `setCombo` `S:858-899`; `deleteDbProduct` `S:574` | Đọc theo cả hai chiều; có thể có cả A->B và B->A | Giữ; sửa A4 |
| `sp_yeu_thich` | Yêu thích theo công ty | `ytIds_` `S:724` | `setYeuThich` `S:761-798`; `deleteDbProduct` `S:576` | Cố ý trỏ sang SP của Dezon | D-04 |
| `delete_requests` | Phiếu xin xoá SP | `listDeleteRequests` `A:479` | `requestDeleteProducts` `A:467`; `resolveDeleteRequest` `A:483` (cập nhật có điều kiện `status=pending`) | `items` là JSON trong text | Giữ |

### 2.3 Dự án, bóc tách, báo giá

| Bảng / cột | Mục đích | Nơi đọc | Nơi ghi | Phụ thuộc | Đề xuất |
|---|---|---|---|---|---|
| `du_an` | Bản nháp dự án | `getProjects` `S:232` (sắp `ngay_tao.desc`, 2000); `getProject` `S:236` | `createProject` `S:247`; `updateProject` `S:257` (qua `PROJ_MAP` `S:223`); `duplicateProject` `S:275`; `deleteProject` `S:266` | `ma_da` bất biến, do server sinh. Client gom nhóm theo tên `app.js:2107` | Giữ; D-10 (không tách bảng dự án) |
| `du_an.tong_dt, dt_bao_gia` | Diện tích | client | client gõ, hoặc chép từ máy tính diện tích `baogia.js:95-100` | Kiểu text | Giữ |
| `du_an.vat_pct` | VAT | client, `getQuote` | 3 chỗ ở client | Đồng bộ với `du_an_data.ptVat` | Giữ |
| `db_bao_gia` | Dòng bóc tách | `getLines` `S:331` (theo `ma_du_an`, sắp `sort_no`); `getQuote` `S:1010`; `buildCoverFromTemplate` `S:415` | `addLine` `S:345`; `updateLine` `S:376` (luôn ghi lại 12 cột giá); `deleteLine` `S:403`; nhân bản, xoá dự án | `lineToObj` `S:315-330`. Công thức `calc_` `S:336-344` phải khớp `recalcLine_` ở `public/app.js:1861` | D-07 (CHECK công thức) |
| `db_bao_gia`: `ma_sp, ten_sp, thuong_hieu, nha_cung_cap, mo_ta, kich_thuoc, hinh_anh, dvt, gia_ban_le, ck_dai_ly_pct` | **Bản chụp** từ danh mục lúc thêm dòng | lineToObj | `addLine`; đồng bộ lại chỉ khi người dùng chọn `boc.js:1420-1590` | 209/503 dòng đã lệch giá so với danh mục: đúng thiết kế | Giữ (snapshot) |
| `db_bao_gia`: `gia_dai_ly, don_gia, thanh_tien` | Dẫn xuất, server đọc lại | `lineToObj`; `getQuote`; tờ bìa | `calc_` | 0 dòng lệch công thức | D-07 |
| `db_bao_gia`: `markup_pct, margin_pct, loi_nhuan_vnd, stt` | Dẫn xuất chỉ ghi | Không | `addLine`, `updateLine` | Không | D-09 |
| `db_bao_gia.khu_vuc` | Không dùng | Không | Không | Không | D-09 |
| `db_bao_gia.nhom` | Mã cây / tên nhóm tự tạo / tiêu đề mục công tác | Lọc theo tiền tố ở client, `export.js:471`, `shared.js:51` | addLine, updateLine | Tờ bìa cộng theo tiền tố mã | Giữ |
| `khai_toan` | Tờ bìa | `getCover` `S:406` | `saveCover` `S:428` (chèn bộ mới rồi xoá bộ cũ theo id) | `id` đổi sau mỗi lần lưu; tham chiếu ngoài dùng `stt` (`bgCfg.tay`, `bgCfg.an`) | Giữ |
| `du_an_data` | Kho JSON theo khoá | `getProjData` `S:1105` (3 lượt: `__cty`, `__cty:<id>`, mã dự án) | `setProjData` `S:1118` (tự upsert: đọc rồi sửa hoặc chèn) | 10 khoá hợp lệ `S:1117`; client ghi dồn sau 1,2 giây | D-03 (tách phần cấp công ty) |
| `cong_tac` | Thư viện công tác | `ctList` `S:1345` | `ctSave`, `ctUpdate`, `ctDelete`, `ctDuyet`, `ctFav` `S:1355-1491` | Dùng trong dự án bằng cách **sao chép** (không id) | Giữ |
| `cong_tac_history` | Lịch sử công tác | `ctGetHistory` `S:1413` | Chỉ chèn; dòng "XOÁ" ghi **sau khi** đã xoá công tác | Không thể có FK cứng tới `cong_tac` | Giữ (tham chiếu mềm) |

### 2.4 Mua hàng

| Bảng / cột | Mục đích | Nơi đọc | Nơi ghi | Phụ thuộc | Đề xuất |
|---|---|---|---|---|---|
| `don_mua_hang` | Đơn mua | `listPurchaseRequests` `A:618`; `getPurchaseOrder` `A:626`; `getPurchaseOrders` `S:1179` | `savePurchaseOrder` `S:1153`; đổi trạng thái `A:648,662` | Hai dạng đối tượng trả về khác tên trường (admin và tab Mua hàng). `getPurchaseOrder` đọc `nguoi_duyet, ngay_duyet` **không tồn tại** | Giữ |
| `don_mua_hang.ma_du_an, ten_du_an` | Tham chiếu mềm + bản chụp tên | lọc theo dự án | lúc tạo | Đơn tồn tại sau khi xoá dự án | D-04 (không FK) |
| `don_mua_hang`: `so_sp, tong_truoc_vat, vat, tong_cong` | Tổng lưu sẵn | hiển thị | lúc tạo; client tính `muahang.js:150-154` | Không bao giờ tính lại; khớp 100% | D-07 (CHECK) |
| `chi_tiet_mua_hang` | Dòng đơn, bản chụp | `A:628`, `S:1183` (N+1: mỗi đơn một truy vấn) | Chỉ chèn `S:1161` | Không bao giờ cập nhật | Giữ |
| `de_xuat` | Phiếu đề xuất ck / tt | `listDeXuat` `A:684`; `getDeXuat` `A:689`; `getDeXuatList` `S:1270` | `saveDeXuat` `S:1224`; `resolveDeXuat` `A:700` | Lỗi chứa chữ `de_xuat` bị trả thành danh sách rỗng `A:685` | Giữ |
| `chi_tiet_de_xuat` | Dòng đề xuất, đa hình | `A:691`, `S:1275` | Chỉ chèn `S:1238-1249` | 0 dòng dữ liệu | D-11 (tách 2 bảng) |

## 3. Hình dạng dữ liệu trả về client (hợp đồng API phải giữ)

| Đối tượng | Hàm đổi | Trường | File client dùng |
|---|---|---|---|
| Sản phẩm | `prodToObj` `S:43` | `ma, ten, hangMuc, nhom, nganh, thuongHieu, ncc, dvt, giaBanLe, ckDaiLy, donGiaVon, donGiaBan, hinhAnh, anhTatCa, moTa, kichThuoc, recordId, daDuyet, nhomBT, raw{<tên cột tiếng Việt>}, spChung, yeuThich, comboN, ...` | `sanpham.js`, `nhap.js`, `boc.js`, `app.js`, `chiphi.js`, `muahang.js` |
| Sản phẩm (dòng thô) | `getDbProduct` trả nguyên dòng | **Tên cột tiếng Việt của database** | `sanpham.js` (form sửa, `data-col`) |
| Dự án | `projToObj` `S:227` | `maDA, ten, khachHang, diaChi, sdt, trangThai, vat, tienDo, ghiChu, quyMo, tongDT, dtBaoGia, nhuCau, phanKhuc, maBaoGia, nhomTuTao, tangTuTao, tenBanNhap, linkDezon, ngayTao, capNhat` | `app.js`, `dash.js`, `baogia.js`, `boc.js`, `duan.js` |
| Dòng bóc tách | `lineToObj` `S:315` | `lineId, maDA, stt, nhom, loai, tang, maSP, ten, thuongHieu, ncc, moTa, kichThuoc, hinhAnh, dvt, khuVuc, maBanVe, soLuong, donGiaVon, chietKhau, lnPct, donGiaBan, ckKhach, donGia, giamGiaNcc, thanhTienVon, thanhTienBan, trangThai, ghiChu, tuNhap, daLuuDM, extra` | `app.js`, `boc.js`, `bangtinh.js`, `chiphi.js`, `muahang.js`, `baogia.js`; `server/export.js` |
| Dòng tờ bìa | `S:408` | `stt, hangMuc, moTa, chiPhi` | `baogia.js`, `export.js` |
| Công tác | `ctToObj` `S:1284` | `id, loai, mode, maNhom, hangMuc, deMuc, ten, dvt, ncc, kl, dt, hs, dgnt, dg, gc, hinhAnh, thongSo, phamVi, linkTaiLieu, daDuyet, yeuThich, ...` | `phantho.js`, `sanpham.js`, `nhap.js` |
| Đơn mua (admin) | `A:620-641` | `maDon, project, supplier, soSp, total, status, requester, phongBan, at, items[]` | `admin.js` |
| Đơn mua (theo dự án) | `S:1184-1189` | `maDon, ncc, hangMuc, soSP, tongCong, trangThai, nguoiGui, ngayGui, items[]` | `muahang.js` |
| Phiếu đề xuất | `dxHead_`, `dxItem_` `S:1254-1266` | `ma, loai, project, supplier, tongGoc, tongDeXuat, tienGiam, status, items[]` | `muahang.js`, `admin.js` |

Vì mọi hàm đổi nằm ở server, đổi cấu trúc database không buộc phải đổi client, **trừ** hai chỗ lộ tên cột: `getDbProduct` và `prodToObj().raw`. Lớp `server/supa.js` + `db-map.json` đang giữ hai chỗ này ổn định.

## 4. Phụ thuộc chưa xác minh (UNKNOWN)

- `server/export.js`: các trường sản phẩm dùng khi xuất Excel (mới xác nhận dùng `nganh`, `dvt` và bản chụp trên dòng). File đã gỡ ở `5fa5d52`, câu hỏi không còn áp dụng.
- `scripts/test-core.js`: có ghi database không (đã thấy `test-vs.js` dùng database giả). File đã gỡ ở `5fa5d52`, câu hỏi không còn áp dụng.
- Công cụ ngoài repo đọc thẳng database (báo cáo, BI): không tìm thấy dấu hiệu nhưng không loại trừ được.
- `du_an.cap_nhat`: trả về client là `capNhat`, chưa kiểm tra có hiển thị không.
