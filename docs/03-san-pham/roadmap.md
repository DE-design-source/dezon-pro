# Roadmap QS Pro

> **Cập nhật:** 2026-10-23 · **Phiên bản mới nhất:** 1.0.0 (số cuối của `package.json` trước khi gỡ app Node; chưa có changelog)
>
> **Backlog từ 2026-10-15:** mục 2.1 làm trên server Go (`backend/`) + module QS React (`frontend/src/pages/QS`). Mục "cần chốt nghiệp vụ" được
> chọn phương án hợp lý nhất từ mã + quy trình QT, giả định ghi ngay trong dòng của mục đó (chủ sản phẩm có thể đổi).
>
> **Ký hiệu:** ✅ xong · 🟡 một phần · ⬜ chưa làm · 🔑 cần credential · 🏗 subsystem lớn
>
> **Nguồn của bản đầu tiên này:** dựng từ mã nguồn và 18 quy trình nghiệp vụ `docs/03-san-pham/flows/QT-*.md` ngày 2026-10-07 (thư mục này KHÔNG có
> trên nhánh hiện tại, chỉ còn trong git ở commit `727f800`: `git show 727f800:docs/03-san-pham/flows/<file>`; các mã QT-xx / Q-xx dưới đây trỏ tới đó).
> Trạng thái của bản đầu được xác định bằng **đọc mã nguồn, chưa chạy thử ứng dụng** — ✅ ở đây nghĩa là "có trong mã nguồn".
> Từ 2026-10-15 mã nguồn là server Go (`backend/`) + module QS React (`frontend/src/pages/QS`); các mục M*.x / N3 ghi ngày 2026-10-15 đã chạy thử trên
> hai phần này (database thử `qspro_gotest`). Tính năng ở mục 5 mà bản Go + React không có được ghi rõ ngay trong dòng và đưa lại vào mục 2.
> Backlog (mục 2) chỉ gồm tính năng mà mã nguồn / cơ sở dữ liệu / giao diện đã bắt đầu hoặc đã hứa nhưng chưa làm xong.
> Lỗi, thiếu kiểm tra quyền và câu hỏi thiết kế KHÔNG nằm ở đây — xem mục 14 của từng quy trình (227 câu hỏi mở).

---

## 1. Tổng quan tiến độ

### App User

| Module | Tên | Trạng thái | Còn lại |
|---|---|---|---|
| [M1](#xong-1) | Đăng nhập & phiên | ✅ | - |
| [M2](#xong-2) | Bảng điều khiển | ✅ | - |
| [M3](#xong-3) | Dự án | ✅ | - |
| [M4](#xong-4) | Bóc tách | ✅ | - |
| [M5](#xong-5) | Phần thô & công tác | ✅ | - |
| [M6](#xong-6) | Tờ bìa (khái toán) | ✅ | - |
| [M7](#xong-7) | Chi phí | ✅ | - |
| [M8](#xong-8) | Xuất báo giá | ✅ | - |
| [M9](#xong-9) | Mua hàng & đề xuất | ✅ | - |
| [M10](#xong-10) | Danh sách sản phẩm | ✅ | - |
| [M11](#xong-11) | Nhập dữ liệu | ✅ | - |
| [M12](#xong-12) | Tệp & ảnh | ✅ | - |
| [M13](#xong-13) | Thông báo | ✅ | - |

### App Admin

| Module | Tên | Trạng thái | Còn lại |
|---|---|---|---|
| [M14](#xong-14) | Tài khoản & phân quyền | ✅ | - |
| [M15](#xong-15) | Duyệt yêu cầu (xoá sản phẩm, mua hàng, đề xuất) | ✅ | - |
| [M16](#xong-16) | Nhật ký hoạt động | ✅ | - |
| [M17](#xong-17) | Công ty (quản trị hệ thống) | ✅ | - |
| [M18](#xong-18) | Báo cáo nhập sản phẩm qua Lark | ✅ | - |

### Tính năng mới (N)

| Mã | Tính năng | Trạng thái | Còn lại |
|---|---|---|---|
| [N1](#xong-n1) | Database PostgreSQL trực tiếp, tên bảng / cột tiếng Anh | 🟡 | [N1](#n1): thử tay trên trình duyệt, chuyển production |
| [N2](#xong-n2) | Server Go + Gin (`backend/`) | 🟡 | [N2](#n2): chuyển deploy sang bản Go, so vi sai phần còn mở |
| [N3](#xong-n3) | Tích hợp QS vào frontend React SiteFlow (`frontend/`) với API Go | ✅ | - |

---

## 2. Backlog

### 2.1 Làm được ngay

| Mã | Tính năng | App | Trạng thái |
|---|---|---|---|
| - | Chưa có | - | - |

### 2.2 Tính năng mới

| Mã | Tính năng | App | Trạng thái |
|---|---|---|---|
| - | Chưa có | - | - |

### 2.3 Cần credential 🔑

| Mã | Tính năng | App | Trạng thái |
|---|---|---|---|
| - | Chưa có | - | - |

### 2.4 Subsystem lớn 🏗

| Mã | Tính năng | App | Trạng thái |
|---|---|---|---|
| <a id="n1"></a>N1 | Refactor database sang PostgreSQL trực tiếp (`DATABASE_URL`; bản Node dùng `pg`, bản Go dùng `pgx`): đã triển khai trên database local `qspro_en2`; mọi tab QS đã chạy thử tự động trên trình duyệt (React + Go, database thử `qspro_gotest`, xem [N3](#xong-n3)); còn người dùng thử tay trên dữ liệu thật, chuyển production (cần máy chủ PostgreSQL mà Render truy cập được), xoá 8 cột `DEPRECATED` (D-09; `delete_requests.note`, `product_combos.note`, `companies.last_reminder_date` / `reminder_milestone` đã ra khỏi danh sách ngày 2026-10-15 vì M15.2 / M10.2 / M17.3 dùng lại; migration 0010 / 0012 / 0013 đổi chú thích cột) - xem `docs/02-ky-thuat/database/ket-qua-trien-khai.md` mục 8 | Toàn hệ thống | 🟡 |
| <a id="n2"></a>N2 | Chuyển server Node + Express sang Go + Gin (`backend/`, đã commit ở `5fa5d52` / `033c421`; app Node và `render.yaml` đã gỡ khỏi repo): đã chuyển mã; còn dựng deploy cho bản Go (chưa có cấu hình deploy nào trong repo, chỉ có `infra/docker/backend.Dockerfile`; server Go không phục vụ app React, React build và deploy riêng với `VITE_API_URL` trỏ tới Go + `CORS_ORIGINS` của Go), so vi sai job báo cáo và các nhánh chỉ chạy khi database thiếu cột - xem `backend/docs/ARCHITECTURE.md` mục "Việc còn mở" | Toàn hệ thống | 🟡 |

---

## 3. Ưu tiên tiếp theo

> Thứ tự dưới đây là **gợi ý của Claude, chưa được duyệt** — xếp theo "chỉ còn thiếu nối giao diện" trước, "cần quyết định nghiệp vụ" sau.

1. Hai hạng mục lớn ở mục 2.4: [N2](#n2) (dựng deploy cho bản Go) và [N1](#n1) (chuyển production, xoá cột D-09)
2. Chạy migration 0014 (`user_sessions`, M1.2) trên `qspro_en2` / production TRƯỚC khi chạy server Go bản mới (thiếu bảng thì mọi lời gọi đã đăng nhập trả 500)
3. Chủ sản phẩm xác nhận các GIẢ ĐỊNH đã ghi trong mục 5 (gần nhất: M1.2, M6.1, M10.1, M17.3)

---

## 4. Cách thêm tính năng

- Việc thuộc module có sẵn → mục 2.1, mã `M<số module>.<số thứ tự>` (số kế tiếp trong module đó), anchor `m<module>-<số>`.
- Tính năng mới ngoài các module trên → mục 2.2, mã N tiếp theo (`hiện tại: N4`), anchor `n<số>`; dùng xong thì tăng số ở đây.
- Cần tài khoản / khoá bên thứ ba → mục 2.3. Hạng mục lớn cần làm riêng một đợt → mục 2.4.
- Quy tắc cập nhật đầy đủ: `.claude/rules/docs/roadmap-sync.md`.

---

## 5. Đã xong

### App User

<a id="xong-1"></a>
#### M1 - Đăng nhập & phiên

- Đăng nhập bằng tên đăng nhập hoặc email cùng mật khẩu
- Tự vào thẳng ứng dụng khi trình duyệt còn phiên hợp lệ
- Phiên làm việc 7 ngày, một tài khoản dùng được nhiều máy cùng lúc
- Chặn đăng nhập khi tài khoản bị khoá, chưa thuộc công ty, công ty tạm khoá hoặc hết hạn
- Kiểm tra lại tài khoản và công ty ở mỗi thao tác, mất phiên trong tối đa 30 giây khi bị khoá
- Tự mã hoá mật khẩu đang lưu dạng chữ thường ở lần đăng nhập đầu
- Hiện tên, vai trò, công ty; đổi logo và tên trang theo công ty
- Ẩn các tab không được cấp, tự chuyển sang tab đầu tiên được phép
- Tự đổi mật khẩu (phải nhập đúng mật khẩu hiện tại)
- Lưu và xoá bộ cột "Của tôi" theo tài khoản, giữ khi sang máy khác
- Lưu các bảng cột đặt tên của Bóc tách theo tài khoản
- Dải nhắc "Đã có bản cập nhật mới" với nút Tải lại ở module QS React (M1.1): server Go gửi header `x-app-ver` trên mọi response `/api/v1` (kể cả 401 / 403 / 404 không có route), cùng giá trị với cổng `/api/:fn`; React thấy giá trị khác lần đầu thì hiện dải, bấm "Tải lại" để nạp bản mới; giao diện tối có nền dải sáng hơn để không lẫn vào thanh trên
- Đăng xuất làm phiên hết hiệu lực ngay ở máy chủ (M1.2): bảng phiên đăng nhập (migration 0014 `user_sessions`), token mang id phiên; đăng xuất chỉ thu hồi phiên đó, máy khác của cùng tài khoản vẫn dùng tiếp; tự đổi mật khẩu đóng các phiên khác; admin đặt lại mật khẩu thu hồi mọi phiên của tài khoản đó (tự đặt cho mình thì giữ phiên đang dùng); giao diện bị thu hồi phiên thì về màn đăng nhập với "Phiên đã hết, mời đăng nhập lại.". GIẢ ĐỊNH (chủ sản phẩm có thể đổi): token cấp trước 0014 (không có id phiên) bị từ chối, người dùng đăng nhập lại một lần; khoá tài khoản không xoá phiên (mở khoá thì token cũ dùng tiếp, như bản Node); chạy nhiều tiến trình server thì tiến trình khác còn nhận token đã thu hồi tối đa 30 giây (cache phiên). Database chưa chạy 0014 -> 500 báo đích danh bảng thiếu
- Ghi nhật ký đăng nhập, đăng nhập sai, đăng xuất, đổi mật khẩu

<a id="xong-2"></a>
#### M2 - Bảng điều khiển

- Thẻ "Đang làm việc" cho bản nháp đang mở
- 5 ô số liệu: số dòng, giá vốn, giá bán chưa VAT, tổng thanh toán gồm VAT, lợi nhuận và biên
- Biểu đồ giá trị theo nhóm hạng mục
- Danh sách dự án gom các bản nháp cùng tên thành một thẻ
- Ô tìm kiếm dự án
- Tự mở bản nháp đầu danh sách khi vào ứng dụng
- Nút "Dùng" để chuyển sang bản nháp khác
- Đổi tên bản nháp ngay trên Bảng điều khiển
- Chip gắn / bỏ link Dezon của dự án
- Mở hộp "Thông tin dự án" từ thẻ dự án

<a id="xong-3"></a>
#### M3 - Dự án

- Tạo dự án mới (tên, khách hàng, số điện thoại, địa chỉ, link Dezon, VAT)
- Thêm bản nháp mới cho một dự án
- Mở bản nháp và nạp dòng bóc tách cùng dữ liệu rời
- Sửa thông tin chung, áp cho mọi bản nháp của dự án
- Sửa thông tin riêng từng bản nháp (trạng thái, VAT, mã báo giá, quy mô, diện tích, ghi chú...)
- Cập nhật phần trăm tiến độ
- Nhân bản bản nháp, chọn phần sao chép (Bóc tách, Xuất báo giá, Phần thô)
- Xoá một bản nháp
- Xoá cả dự án
- Tự lưu dữ liệu rời của bản nháp lên máy chủ
- Tự đưa bản lưu cũ trên trình duyệt lên máy chủ
- Mỗi công ty chỉ thấy dự án của mình
- Ô chọn dự án và thẻ dự án phía trên các màn hình
- Lối mở "Thông tin dự án" (M3.1, QT-09 Q-12): hộp Thông tin dự án (cùng nội dung trang `v-project` cũ, không dựng trang riêng) mở từ thẻ dự án ở Bóc tách, Chi phí, Xuất báo giá, Mua hàng, Dự án và từ banner, thẻ dự án, dòng bản nháp ở Bảng điều khiển; kiểm bằng admin + nhân viên 2026-10-15

<a id="xong-4"></a>
#### M4 - Bóc tách

- Chọn đề mục trong cây hạng mục, lọc bảng theo đề mục
- Thêm tầng / phòng và đặt tầng đang thêm
- Thêm sản phẩm từ danh mục (bấm dấu cộng hoặc kéo thả), tự cộng dồn số lượng khi trùng
- Thêm dòng trống để tự nhập
- Chọn sản phẩm cho dòng hoặc tạo sản phẩm mới vào danh mục
- Sửa ô trực tiếp, tự tính giá đại lý, đơn giá, thành tiền
- Gõ Markup, Margin hoặc Lợi nhuận (VND) để tính ngược giá bán
- Nút sửa ở dải chip cột: bật / tắt chip rồi Lưu, đặt tên thành bộ chọn nhanh mới (tối đa 20, lưu theo tài khoản `ui_prefs.tkPresets`, xoá trong "Chọn nhanh cột") - 🟡 chưa chạy thử trên giao diện
- Nút bộ cột trên băng dự án mở cùng lúc "Chọn nhanh cột" + dải chip cột; cột đang hiện tự lưu theo tài khoản (`ui_prefs.tkLastCols`), mở lại đúng cột lần trước - 🟡 chưa chạy thử trên giao diện
- Sửa hàng loạt: chuyển tầng, đặt lợi nhuận, sửa cột
- Sao chép, nhân bản, xoá nhiều dòng
- Kéo thả đổi vị trí dòng và thứ tự tầng, đổi tên tầng
- Sắp xếp và lọc theo cột
- Cập nhật dòng lệch so với danh mục (từng dòng hoặc cả bản nháp)
- Chế độ Bảng tính và Bảng thường
- Hạng mục tự tạo trong cây

<a id="xong-5"></a>
#### M5 - Phần thô & công tác

- Nhập công tác bằng form (tên, hạng mục, đơn vị tính, giá, ảnh, ghi chú, thông số) với giá bán lẻ / chiết khấu / giá đại lý tự tính qua lại
- Danh sách chờ trên trình duyệt: sửa, xoá rồi lưu hàng loạt vào cơ sở dữ liệu, dòng lỗi ở lại kèm lý do
- Tuỳ chọn thêm luôn công tác vừa lưu vào bảng khái toán của dự án đang chọn
- Danh mục công tác ở 3.1 Phần thô: thẻ lọc Tất cả / Chưa duyệt / Đã duyệt / Yêu thích, tìm kiếm và bộ lọc
- Sửa công tác trong cửa sổ cập nhật, sửa nhanh từng ô trên bảng và sửa hàng loạt một trường
- Duyệt / bỏ duyệt công tác (từng dòng hoặc nhiều dòng); sửa nội dung tự đưa về Chưa duyệt
- Đánh dấu yêu thích dùng chung cho cả công ty
- Xoá một hoặc nhiều công tác
- Xem lịch sử thay đổi của từng công tác (200 dòng mới nhất)
- Tải danh sách công tác ra Excel (toàn bộ đang lọc hoặc các dòng đã chọn)
- Thư viện công tác trong tab Bóc tách theo 4 loại báo giá; thêm vào bảng Phần thô bằng dấu cộng, kéo thả, cả nhóm, một dự án mẫu có sẵn, bộ dự toán
- Bảng Phần thô tự tính khối lượng, thành tiền, lợi nhuận, VAT và tổng theo hạng mục
- Bảng Phần thô tự lưu theo dự án lên máy chủ
- Công tác có phân loại đề mục hiện thêm ở đề mục hoàn thiện 3.2.x và thêm được vào bảng bóc tách
- Nhập công tác từ file (M5.1): Nhập dữ liệu > Phần thô có "Tải file mẫu" (`/mau-nhap-cong-tac.xlsx`, byte = bản cuối trong git) và "Chọn file Excel/CSV"; máy chủ Go đọc file (`POST /api/v1/work-items/import/parse`, không ghi gì) rồi đưa vào danh sách chờ, lưu bằng đường lưu công tác sẵn có; dòng lỗi ở lại kèm "Dòng N: lý do" (đúng số dòng trong file), chỉ lưu được sau khi sửa trong form (Loại báo giá / Cách tính đọc không được thì để trống, bắt chọn lại); dòng "Ghi chú:" của file mẫu bị bỏ; file hỏng báo lỗi tiếng Việt. Giả định: cột "Thứ tự" tuỳ chọn; thiếu Hạng mục là lỗi như form nhập tay; số đọc kiểu VN như form ("450.000" = 450000), số âm / chữ là lỗi; tối đa 2000 công tác mỗi file
- Lọc thư viện theo nhà thầu (M5.2): ô "Tên nhà thầu" ở thư viện 3.1 = 4 nhà thầu cũ (H77, Decox, TTP, Unicons) ∪ nhà thầu có trong công tác của công ty, kèm số công tác theo loại báo giá đang chọn; chọn một nhà thầu thì thư viện chỉ còn công tác của nhà thầu đó (không phân biệt hoa thường / khoảng trắng), nhóm trống ghi "Nhà thầu X chưa có đơn giá cho mục này"; gợi ý ô Nhà thầu ở form nhập và hộp Cập nhật dùng cùng danh sách. Giả định: mỗi công tác gắn 1 nhà thầu với đơn giá riêng; chọn nhà thầu chỉ LỌC, không đổi giá dòng đã có trong bảng; công tác dựng sẵn (không thuộc dữ liệu công ty) không có nhà thầu nên bị ẩn khi chọn nhà thầu
- Ô "Thứ tự" của công tác (M5.3) ở form Nhập dữ liệu > Phần thô, hộp Cập nhật công tác và cột sửa nhanh ở Danh sách SP 3.1 (số nguyên ≥ 0, chỉ công tác của công ty); thư viện sắp theo loại báo giá rồi Thứ tự như máy chủ, đổi Thứ tự thấy ngay không cần tải lại; nhóm đứng theo công tác có thứ tự nhỏ nhất. Lưu ý: sửa Thứ tự cũng đưa công tác về Chưa duyệt như mọi lần sửa

<a id="xong-6"></a>
#### M6 - Tờ bìa (khái toán)

- Tự dựng tờ bìa 26 mục từ mẫu chuẩn khi bản nháp chưa có tờ bìa
- Tự cộng tiền từng mục nhỏ từ các dòng bóc tách cùng mã hạng mục
- Cộng thêm bảng Phần thô vào mục 3.1
- Mục cha tự bằng tổng mục con, tổng tờ bìa và tỷ trọng % từng mục
- Sửa tay ô chi phí (lưu ngay) kèm nhãn "tự động" / "sửa tay"
- Bỏ sửa tay từng mục hoặc "Lấy lại số từ bóc tách" cho cả tờ bìa
- Sửa số thứ tự, tên, mô tả; thêm mục lớn / mục nhỏ; xoá mục (xoá mục và sửa tên mục lớn chỉ có ở Mẫu 2)
- Ẩn / hiện mục lớn trên tờ bìa, lưu theo bản nháp
- Sửa thông tin đầu tờ bìa (mã báo giá, khách hàng, quy mô, diện tích, nhu cầu, phân khúc)
- Nạp lại mẫu chuẩn và Lưu tờ bìa
- Hai kiểu trình bày Mẫu 1 / Mẫu 2, nhớ trên máy
- Bảng tính diện tích theo hệ số và nút "Áp vào tờ bìa"
- Tự lưu số đang hiện vào tờ bìa trước khi xuất Excel
- Đơn giá phần thô / m² đất (M6.1): khối "Bảng tính diện tích (hệ số)" ở Xuất báo giá > Chỉnh sửa có dòng chỉ đọc "Đơn giá phần thô / m² đất" = chi phí mục 3.1 trên tờ bìa ÷ diện tích khu đất (Dài × Rộng), kèm dòng ghi chú công thức. GIẢ ĐỊNH chờ chủ sản phẩm xác nhận: chỉ hiển thị (không lưu, không vào bản xem trước / Excel); diện tích 0, tờ bìa chưa có 3.1 hoặc 3.1 âm thì hiện "—"

<a id="xong-7"></a>
#### M7 - Chi phí

- Dải tổng đầu trang: vốn, giá bán, lợi nhuận, biên, VAT, tổng thanh toán
- Lọc theo hạng mục dùng chung cho mọi màn hình
- Cộng Phần thô và trừ chiết khấu báo giá khi xem tất cả hạng mục
- Thẻ Tổng quan chi phí kèm biểu đồ theo hạng mục và theo nhà cung cấp
- Tìm kiếm và chip cảnh báo: đang lỗ, biên thấp, chưa có giá bán, chưa có giá vốn
- Gom theo hạng mục / tầng / nhà cung cấp, có tổng từng nhóm
- Sắp xếp theo cột, bật tắt 14 cột hiển thị
- Sửa giá và số lượng ngay trong bảng, ghi thẳng vào dòng bóc tách
- Đặt nhanh lợi nhuận % cho nhiều dòng
- Đặt biên lợi nhuận mục tiêu để tính lại giá bán
- Biên tối thiểu theo bản nháp, tô vàng dòng biên thấp
- Sửa VAT của bản nháp
- So sánh các bản nháp của cùng dự án
- Xuất Excel đúng bảng đang xem; gợi ý khi hạng mục đang lọc trống

<a id="xong-8"></a>
#### M8 - Xuất báo giá

- Xem trước báo giá nhiều trang: trang 1 tờ bìa, từ trang 2 bảng chi tiết
- Chọn hạng mục đã bóc để đưa vào báo giá
- Chọn cột xuất, dùng chung với bảng Bóc tách
- Mặc định ẩn cột nội bộ, có lựa chọn "Xuất kèm (bản nội bộ)"
- Chỉnh trình bày: mỗi phần 1 trang, số dòng mỗi trang, mức phóng, kéo đổi thứ tự / độ rộng cột
- Tổng kết & điều khoản: chiết khấu tổng, ngày báo giá, hiệu lực, tiến độ thanh toán, ghi chú
- Thông tin công ty (tên, logo, địa chỉ, liên hệ) trên bản xem trước và bản in
- Mẫu tờ bìa: chọn nhanh bằng số ①②… (2 mẫu dựng sẵn + tối đa 6 mẫu tự lưu theo tài khoản `ui_prefs.bgBiaMau`), ⊕ lưu cài đặt đang dùng thành mẫu mới, Lưu ghi đè / Xoá mẫu tự lưu - 🟡 chưa chạy thử trên giao diện
- Logo tờ bìa: chế độ Công ty chọn 1 trong 3 logo gần nhất, tab "Tạo logo" chọn 1 trong 2: Logo ảnh (tải ảnh) hoặc Logo chữ (gõ chữ, chỉnh font / màu / đậm / nghiêng / giãn chữ), bấm "Lưu logo" thì logo vào danh sách của mục Công ty; thông tin công ty dưới logo theo mẫu chung hoặc tự nhập riêng cho báo giá; thanh Cỡ logo đổi cả cỡ chữ khi không có ảnh - 🟡 chưa chạy thử trên giao diện
- Xuất Excel nhiều trang tính: Tờ bìa, Tổng cộng, 3.2 Phần hoàn thiện, 3.1 Phần thô, chi tiết theo nhóm
- Nhúng ảnh sản phẩm vào file Excel (bỏ qua ảnh webp / gif / svg và ảnh trên 5 MB)
- Cảnh báo dòng đang dùng giá cũ trước khi xuất Excel
- Xuất PDF / In khổ A4 ngang qua trình duyệt
- Tự chốt phiên bản khi xuất, chốt tay, lịch sử phiên bản, xem lại và so sánh
- Cảnh báo khi tổng tờ bìa khác tổng trang cuối
- Nút xuất Excel ở các tab khác, tải danh sách sản phẩm và file mẫu nhập liệu
- Excel báo giá theo thông tin công ty, tiến độ thanh toán và ghi chú như bản xem trước (M8.1): tờ bìa có tên + địa chỉ / liên hệ công ty (logo nhúng nếu là ảnh PNG / JPG tải được), sheet "Tổng cộng" có Ngày báo giá · Hiệu lực, TIẾN ĐỘ THANH TOÁN (Đợt i: nội dung | số tiền | tỷ lệ %), GHI CHÚ & ĐIỀU KHOẢN, Người lập; không còn ghi cứng tên một công ty. Giả định: chữ / số lấy nguyên từ bản xem trước (máy chủ không tính lại), bố cục Excel của khối tổng kết là của bản Go; logo best-effort (logo mặc định `/logo.svg` là SVG nên không nhúng)
- Excel theo Mẫu 1 / Mẫu 2 của tờ bìa và thứ tự / độ rộng cột đã kéo ở bản xem trước (M8.2): Mẫu 1 có cột NỘI DUNG, ô NO / HẠNG MỤC gộp theo mục lớn, mục có con in đậm "(gồm các mục dưới)". Giả định: Mẫu 2 = bố cục Excel cũ; độ rộng chỉ áp cho cột người dùng đã kéo (cột khác giữ bề rộng cũ)
- Ô "Hiện trạng" của dự án (M8.3, cột `projects.current_condition`, migration 0011): nhập ở hộp Thông tin dự án và đầu tờ bìa (nhiều dòng), in ở bản xem trước và Excel (giữ xuống dòng). Giả định: chỉ ghi khi người dùng đổi ô này; Excel chỉ in khi giao diện gửi thông tin trình bày (React luôn gửi)

<a id="xong-9"></a>
#### M9 - Mua hàng & đề xuất

- Xem sản phẩm bóc tách của dự án gom theo nhà cung cấp, có VAT và tổng tiền
- Nhập giảm giá nhà cung cấp theo từng dòng hoặc cho cả nhà cung cấp
- Chọn / bỏ chọn nhà cung cấp và gửi một hoặc nhiều đơn cùng lúc
- Bắt buộc nhập Người gửi và Phòng ban trước khi gửi
- Mỗi nhà cung cấp thành một đơn riêng ở trạng thái Chờ duyệt
- Báo admin trong ứng dụng và gửi thẻ yêu cầu mua hàng vào nhóm Lark
- Danh sách Đơn đã gửi theo dự án, có nút tải lại
- Đánh dấu Đã đặt hàng rồi Đã nhận hàng cho đơn đã duyệt
- Tải Excel của từng đơn
- Cảnh báo sản phẩm đã nằm trong đơn trước đó
- Lập đề xuất chiết khấu theo từng dòng và gửi phiếu
- Lập đề xuất thanh toán theo đợt (chia nhanh 2 / 3 / 4 đợt, lưu nháp) và gửi phiếu
- Danh sách và chi tiết Phiếu đề xuất đã gửi của dự án
- Người gửi nhận thông báo khi đơn hoặc phiếu được duyệt / từ chối
- Kết quả gửi Lark của đơn mua hàng (M9.1): máy chủ ghi "ok" / "loi" sau khi gửi thẻ Lark; chi tiết đơn có dòng "Kết quả gửi Lark" (Đã gửi / Lỗi gửi Lark / Chưa rõ), tab Mua hàng có chip "Lark: ..." ở từng đơn đã gửi, gửi đơn mà Lark lỗi thì hiện cảnh báo "Đã lưu đơn nhưng gửi Lark thất bại". Giả định: các đơn "ok" tạo trước bản này là giá trị mặc định lúc lưu, không phải xác nhận đã tới Lark (hiện là "Đã gửi")

<a id="xong-10"></a>
#### M10 - Danh sách sản phẩm

- Xem danh mục theo bốn khung nhìn: Tất cả, Chưa duyệt, Đã duyệt, Yêu thích
- Sửa sản phẩm trong hộp Cập nhật, kèm lịch sử thay đổi từng trường
- Sửa nhanh ngay trên bảng và hoàn tác (Ctrl+Z, tối đa 50 bước)
- Sửa hàng loạt một trường cho nhiều sản phẩm
- Duyệt / bỏ duyệt từng sản phẩm, cả nhóm biến thể hoặc hàng loạt
- Lưu & duyệt trong một lần bấm
- Sản phẩm đã duyệt tự về Chưa duyệt khi bị sửa ở Danh sách sản phẩm (cập nhật đè qua Nhập dữ liệu thì không)
- Khai báo sản phẩm đi kèm (combo) hai chiều, có số lượng
- Gom biến thể khác mã thành nhóm; tự nhận biến thể cùng mã
- Tạo biến thể, tạo nhanh nhiều biến thể, sao chép thành sản phẩm mới
- Đánh dấu yêu thích từng sản phẩm hoặc hàng loạt
- Xem kho chung Dezon ở chế độ chỉ xem (khi công ty được bật)
- Tải danh sách sản phẩm ra Excel (theo dòng đã chọn hoặc theo bộ lọc)
- Nhân viên gửi yêu cầu xoá; admin xoá trực tiếp một hoặc nhiều sản phẩm
- Ghi chú cho từng sản phẩm đi kèm (M10.2): ô "Ghi chú" ở form Cập nhật sản phẩm cho liên kết do chính sản phẩm đặt; liên kết ngược (hai chiều) chỉ xem, kèm "Sửa ghi chú ở sản phẩm kia"; hiện "Ghi chú: …" ở hộp xem sản phẩm, dòng mở rộng của Danh sách sản phẩm, thẻ đi kèm ở thư viện Bóc tách và hộp chi tiết sản phẩm Bóc tách; lưu lại form (đổi số lượng) giữ nguyên ghi chú
- Tạo bản sao riêng từ sản phẩm kho chung Dezon (M10.1): nút "Tạo bản sao riêng" ở hộp xem sản phẩm và cột thao tác của dòng "Kho Dezon"; hỏi lại rồi chép sang công ty mình (Chưa duyệt; không chép combo, biến thể, yêu thích), tải lại danh mục và mở form Cập nhật của bản sao. Trùng mã + trục biến thể -> "Công ty bạn đã có sản phẩm mã X" (tìm được đúng 1 bản riêng thì mở form của bản đó). Bản riêng chỉ che dòng kho chung trùng đủ khoá kiểm trùng, kể cả kích thước (khác Node: chép sơn 15L không làm mất 1L / 5L). GIẢ ĐỊNH: `SpPerms` cho MỌI nhân viên quyền sửa nên máy chủ lặp lại phép thử `canTab('sanpham')` của giao diện: công ty có danh sách tính năng thiếu "sanpham" thì không ai chép được; nhân viên cần tab "sanpham"; admin chỉ xét tính năng công ty; quản trị hệ thống được hết. Đây là điều kiện riêng của bản Go, các đường tạo / nhập / sửa sản phẩm khác không xét tab hay tính năng

<a id="xong-11"></a>
#### M11 - Nhập dữ liệu

- Chọn ngành hàng: Thiết bị đèn, Thiết bị vệ sinh, Sơn nước
- Form nhập theo ngành, thông số hiện theo hạng mục
- Thêm ảnh bằng chọn file, kéo-thả, dán Ctrl+V hoặc dán link
- Tải tài liệu hoặc dán link tài liệu cho sản phẩm
- Giá đại lý tự tính từ giá bán lẻ và % chiết khấu
- Chọn sản phẩm đi kèm ngay lúc nhập
- Nhập biến thể: tự nhân tổ hợp thành nhiều sản phẩm
- Danh sách chờ lưu: thêm, sửa, bỏ trước khi ghi vào danh mục
- Tải file mẫu theo ngành (sơn nước theo hạng mục)
- Đọc file Excel/CSV, tự dò cột và tự nhận ngành
- Bảng xem trước: sửa ô, gắn ảnh từng dòng, đánh dấu ô thiếu
- Cảnh báo trùng trước khi lưu, cho chọn cập nhật đè hoặc xem lại
- Lưu vào danh mục kèm ghi danh vào dự án; dòng lỗi ở lại kèm lý do
- Lưu một dòng bóc tách thành sản phẩm mới trong danh mục

<a id="xong-12"></a>
#### M12 - Tệp & ảnh

- Tải ảnh sản phẩm: chọn file, kéo-thả, dán Ctrl+V
- Tự thu nhỏ và nén ảnh trước khi tải
- Tự thử lại khi tải ảnh lỗi mạng
- Dán link ảnh có sẵn thay cho tải lên
- Hình đại diện một ảnh, hình chi tiết nhiều ảnh
- Tải tài liệu sản phẩm (PDF, bản vẽ, file nén, Word, Excel), tối đa 50MB mỗi file
- Dán link tài liệu thay cho tải file
- Bốn ô tài liệu: tài liệu kỹ thuật, thông số, hướng dẫn cài đặt, bản vẽ
- Tải ảnh cho công tác phần thô
- Tải logo công ty
- Chờ ảnh tải xong (tối đa 15-20 giây) rồi mới lưu sản phẩm
- Hiển thị ảnh cũ lưu trên Lark

<a id="xong-13"></a>
#### M13 - Thông báo

- Chuông thông báo với số chưa đọc, tự đếm lại mỗi 30 giây
- Danh sách 30 thông báo mới nhất, làm nổi thông báo chưa đọc
- Bấm thông báo để đánh dấu đã đọc
- Nút "Đánh dấu đã đọc" cho toàn bộ thông báo
- Báo admin công ty khi có yêu cầu xoá sản phẩm
- Báo admin công ty khi có đơn mua hàng mới
- Báo admin công ty khi có đề xuất mua hàng mới
- Báo người gửi khi yêu cầu được duyệt hoặc bị từ chối
- Thông báo đơn mua hàng dẫn admin tới đúng chi tiết đơn, nhân viên tới tab Mua hàng
- Thông báo yêu cầu xoá dẫn admin tới đúng yêu cầu và nháy sáng
- Gửi thẻ vào nhóm Lark khi có đơn mua hàng hoặc đề xuất
- Báo cáo sản phẩm nhập mới gửi Lark tự động thứ 4 và thứ 7 lúc 8 giờ sáng
- Bấm thông báo về phiếu đề xuất mở đúng phiếu (M13.1): admin mở chi tiết phiếu ở tab Admin; người gửi mở chi tiết phiếu ở tab Mua hàng (kể cả khi chưa mở dự án, qua `GET /api/v1/my-proposals/:code` - chỉ phiếu của chính mình) và không thấy nút Duyệt / Từ chối; icon riêng cho thông báo đề xuất

### App Admin

<a id="xong-14"></a>
#### M14 - Tài khoản & phân quyền

- Danh sách tài khoản của công ty: vai trò, quyền, trạng thái, đăng nhập gần nhất
- Thêm tài khoản với tên đăng nhập, họ tên, phòng ban, mật khẩu
- Chọn vai trò Nhân viên hoặc Quản trị công ty
- Cấp quyền vào từng mục (8 mục), có Chọn tất cả / Bỏ hết
- Ba mức quyền trong Danh sách sản phẩm: không giới hạn, chỉ sửa, sửa và duyệt
- Sửa họ tên, phòng ban, vai trò, quyền của tài khoản (⚠ lưu biểu mẫu trên tài khoản quản trị hệ thống sẽ hạ vai trò xuống nhân viên - QT-03 Q-01)
- Đặt lại mật khẩu cho người khác
- Khoá và mở khoá tài khoản, người bị khoá mất phiên ngay
- Xoá tài khoản có xác nhận, không tự xoá được chính mình
- Luôn giữ ít nhất một admin đang hoạt động cho mỗi công ty
- Chặn tạo tài khoản khi công ty đã đủ số người dùng của gói
- Tên đăng nhập duy nhất trong toàn hệ thống
- Quản trị hệ thống chọn công ty, chuyển công ty và gán công ty cho tài khoản chưa có
- Ghi nhật ký tạo, sửa, khoá, mở, đặt lại mật khẩu, xoá tài khoản
- Sửa email tài khoản ở hộp Sửa tài khoản tab Admin (M14.1): lưu chữ thường, để trống = xoá, báo "Email không hợp lệ" khi sai dạng; không trùng tài khoản khác trong CÙNG công ty (khác công ty được phép, đăng nhập tự chọn đúng tài khoản); email cũ sai dạng vẫn sửa được các mục khác; đăng nhập được bằng email mới. Giả định: đường tạo tài khoản giữ như cũ (kiểm dạng ở giao diện); email có `*`, `%`, `\` lưu được nhưng không dùng để đăng nhập (có cảnh báo)

<a id="xong-15"></a>
#### M15 - Duyệt yêu cầu (xoá sản phẩm, mua hàng, đề xuất)

- Ô thống kê Đơn mua hàng chờ duyệt và Đề xuất chờ duyệt (đếm trong 200 đơn / phiếu mới nhất)
- Danh sách Yêu cầu mua hàng của công ty kèm số chờ duyệt
- Xem chi tiết đơn mua hàng: sản phẩm, tạm tính, VAT, tổng thanh toán
- Duyệt hoặc từ chối đơn mua hàng (từ chối có hỏi xác nhận)
- Chặn xử lý lại đơn đã được duyệt / từ chối
- Danh sách Đề xuất mua hàng (chiết khấu, thanh toán) của công ty
- Xem chi tiết phiếu đề xuất chiết khấu và thanh toán theo đợt
- Duyệt hoặc từ chối phiếu đề xuất, lưu người duyệt và ngày duyệt
- Báo lại người gửi trong ứng dụng khi duyệt / từ chối
- Ghi nhật ký hoạt động khi duyệt / từ chối
- Bấm thông báo đơn mua hàng mở thẳng chi tiết đơn
- Chỉ admin công ty và quản trị hệ thống được duyệt
- Admin nhận thông báo trên chuông khi có yêu cầu xoá mới
- Bấm thông báo mở thẳng đúng yêu cầu ở tab Admin
- Danh sách yêu cầu xoá kèm người gửi, sản phẩm, thời điểm, trạng thái
- Ô đếm số yêu cầu đang chờ duyệt
- Duyệt & xoá: xoá đúng các sản phẩm trong yêu cầu
- Từ chối yêu cầu (hỏi lý do, tuỳ chọn; Huỷ = không từ chối)
- Mỗi yêu cầu chỉ xử lý được một lần
- Báo kết quả cho người gửi (đã xoá X/N hoặc bị từ chối)
- Hiện người xử lý
- Yêu cầu chỉ hiện trong công ty của người gửi
- Người duyệt / ngày duyệt đơn mua hàng (M15.1, migration 0009): ghi lúc duyệt / từ chối; hiện ở chi tiết đơn, thẻ đơn ở tab Admin ("Xử lý bởi ... · ngày") và danh sách đơn đã gửi ở tab Mua hàng ("Duyệt bởi" / "Từ chối bởi")
- Lý do xoá và lý do từ chối yêu cầu xoá sản phẩm (M15.2, migration 0010): nhân viên gửi yêu cầu được hỏi lý do (tuỳ chọn; Huỷ = không gửi), Admin từ chối được hỏi lý do; thẻ yêu cầu hiện "Lý do" và "Lý do từ chối", cả hai nối vào thông báo; tối đa 500 ký tự (kiểm ở giao diện và máy chủ, quá dài thì hộp mở lại giữ nội dung đã gõ)

<a id="xong-16"></a>
#### M16 - Nhật ký hoạt động

- Tự ghi nhật ký cho các thao tác quan trọng: ai làm, hành động, chi tiết, thời gian, công ty
- Thẻ "Nhật ký hoạt động" ở tab Admin với 120 dòng mới nhất
- Admin công ty chỉ thấy nhật ký của công ty mình
- Quản trị hệ thống thấy toàn hệ thống hoặc theo công ty đang xem
- Ghi nhật ký đăng nhập, tài khoản, công ty
- Ghi nhật ký sản phẩm, công tác, mua hàng, đề xuất, yêu cầu xoá
- Tự ghi lỗi giao diện trên máy người dùng vào nhật ký (kèm tên tab)
- Ghi nhật ký báo cáo tự động gửi Lark
- Ghi nhật ký lỗi không làm hỏng thao tác chính

<a id="xong-17"></a>
#### M17 - Công ty (quản trị hệ thống)

- Danh sách công ty dạng thẻ kèm bốn ô thống kê
- Tạo công ty với tên, mã, email, điện thoại, logo
- Tải logo lên hoặc dùng đường dẫn ảnh
- Đặt số người dùng tối đa, hạn dùng, trạng thái, ghi chú (chưa bỏ được hạn dùng đã đặt)
- Bật/tắt từng tính năng (8 mục) cho công ty
- Cho công ty dùng danh sách sản phẩm của Dezon
- Tạo kèm tài khoản quản trị khi tạo công ty (⚠ tên đăng nhập sai dạng thì công ty vẫn được tạo mà không có quản trị - QT-02 Q-03)
- Sửa thông tin, gia hạn, tạm khoá và mở lại công ty
- Công ty tạm khoá hoặc hết hạn thì người dùng bị chặn
- Xem danh sách người dùng của một công ty và thêm tài khoản
- "Xem dữ liệu" như một công ty và thoát chế độ xem
- Xoá công ty cùng toàn bộ dữ liệu, phải gõ đúng mã xác nhận
- Ghi nhật ký tạo, sửa, xoá công ty
- Thẻ "Thông tin công ty" ở tab Admin (M17.1): admin sửa tên, logo, email, điện thoại, màu chính của công ty mình, áp ngay (thanh trên đổi màu, không tải lại); quản trị hệ thống sửa khi đang xem một công ty (không đổi công ty đang dùng của chính mình); ô "Hạn dùng" chỉ xem ("Không giới hạn", "Còn N ngày · dd/mm/yyyy", "Hết hạn dd/mm/yyyy", "Đến dd/mm/yyyy" như bản Node)
- Ô chọn màu chính (bảng màu + mã hex + Mặc định) ở thẻ trên và tab Thông tin của hộp Tạo / Sửa công ty (M17.2); máy chủ chỉ nhận trống, `#RGB` hoặc `#RRGGBB`, báo "Màu chính phải dạng #RRGGBB"
- Nhắc gia hạn trong ứng dụng (M17.3): admin đang hoạt động nhận thông báo "Công ty sắp hết hạn sử dụng" ở các mốc còn 30/14/7/3/1/0 ngày (mỗi mốc 1 lần) và thấy dải nhắc đầu trang khi còn ≤ 30 ngày (ẩn trong ngày được; bấm thông báo mở tab Admin và hiện lại dải); job nền 8h05 giờ VN mỗi ngày + gửi bù khi khởi động, chung công tắc `REPORT_JOB`; quản trị hệ thống "Chạy thử" / "Gửi nhắc ngay" ở thẻ "Nhắc gia hạn công ty" tab Công ty. Chống trùng bằng UPDATE có điều kiện (an toàn nhiều tiến trình); không gửi được thì trả mốc; route chỉ gửi thật khi `dryRun=false`. GIẢ ĐỊNH (bản Lark đã gỡ ở 42af44d; chủ sản phẩm có thể huỷ): chỉ trong ứng dụng, không Lark, không email; giá trị mốc cũ ngoài tập coi như chưa nhắc; đổi hạn dùng thì xoá mốc. Migration 0012 chỉ đổi chú thích 2 cột

<a id="xong-18"></a>
#### M18 - Báo cáo nhập sản phẩm qua Lark

- Tự gửi báo cáo lúc 8 giờ sáng thứ Tư và thứ Bảy (giờ Việt Nam)
- Gửi bù khi máy chủ khởi động lại trong ngày gửi
- Chống gửi trùng trong cùng một ngày
- Kỳ báo cáo tính từ lần gửi theo lịch liền trước
- Mỗi công ty một thẻ Lark "Sản phẩm nhập mới"
- Thống kê số sản phẩm, nhà cung cấp, người nhập
- Bảng theo ngành hàng
- Bảng theo người nhập và ngày, kèm phòng ban
- Cảnh báo số sản phẩm chưa ghi nhận người nhập
- Gom sản phẩm chưa gắn công ty vào thẻ riêng
- Ghi nhật ký hoạt động sau khi gửi
- Dùng đường Lark riêng cho báo cáo, chưa đặt thì dùng chung với mua hàng
- Thẻ "Báo cáo sản phẩm nhập mới (Lark)" ở tab Công ty, chỉ quản trị hệ thống (M18.1): chọn Từ ngày (tính từ 0h giờ Việt Nam) hoặc để trống = kỳ hiện tại; Chạy thử xem số sản phẩm theo từng công ty và theo người nhập; Gửi ngay có hỏi lại; kết quả Đã gửi / Lỗi gửi Lark từng công ty (chi tiết lỗi chỉ ở log máy chủ). Lần gửi tay thành công tính là lần gửi của hôm nay (lịch 8h cùng ngày bỏ qua; có cảnh báo trên thẻ)

### Tính năng mới (N)

<a id="xong-n1"></a>
#### N1 - Database PostgreSQL trực tiếp

- Server đọc / ghi PostgreSQL qua `pg` và `DATABASE_URL`; Supabase chỉ còn làm kho file
- Tên bảng / cột trong database sang tiếng Anh, `db-map.json` ánh xạ hai chiều với tên trong code (nay là `backend/internal/platform/database/db-map.json`; bản `server/db-map.json` đã gỡ cùng app Node)
- Tách bảng sản phẩm thành bảng lõi + 4 bảng thông số theo ngành; cấu hình cấp công ty sang bảng `company_settings`; phiếu đề xuất tách 2 bảng dòng
- Bảng con bỏ cột công ty, lấy công ty qua bảng cha; thêm khoá ngoại và CHECK công thức
- Migration đánh số trong `infra/db/migrations/`, chạy bằng `go run ./cmd/migrate` (trong `backend/`; trước đây `npm run migrate` của app Node đã gỡ)
- Dữ liệu sai chuyển sang schema `quarantine`, không xoá hẳn
- Test `npm run test:db` (61 đạt) và `npm run test:api` (96 đạt) trên database local `qspro_en2` (2026-10-12, app Node trước khi gỡ)
- Transaction cho thao tác nhiều bước (D-13, bản Go, 2026-10-15): lưu đơn mua hàng (mỗi đơn), lưu đề xuất, xoá / nhân bản dự án, lưu tờ bìa, tạo / xoá công ty, ghi combo / biến thể / xoá sản phẩm; lỗi giữa chừng không còn dữ liệu dở dang, thành công giữ nguyên kết quả. Gộp cả lần gửi nhiều đơn vào 1 transaction chưa làm (cần `clock_timestamp()`) - chi tiết `backend/docs/ARCHITECTURE.md` mục 3.5
- 🟡 phần còn lại ở 2.4

<a id="xong-n2"></a>
#### N2 - Server Go + Gin

- Bản chuyển `server/` sang Go + Gin trong `backend/`, chạy độc lập; app Node (`server/`, `public/`) đã gỡ khỏi repo, file tĩnh cần cho React (thông số ngành, logo, file mẫu) nhúng trong binary Go
- Giữ `POST /api/<tênHàm>`, thêm REST dưới `/api/v1`
- Migration (`go run ./cmd/migrate`) và chạy bằng Docker
- 🟡 phần còn lại ở 2.4

<a id="xong-n3"></a>
#### N3 - Tích hợp QS vào frontend React SiteFlow

- Module QS của frontend React (`frontend/src/pages/QS`, bản clone giao diện cũ) dùng dữ liệu thật qua REST `/api/v1` của server Go; đăng nhập riêng cho QS, bỏ toàn bộ dữ liệu giả
- Bổ sung phần bản clone còn thiếu: nhập dữ liệu, sửa sản phẩm (combo, biến thể, lịch sử), phần thô, quản trị tài khoản, công ty, thông báo
- Server Go tự phục vụ thông số ngành (`*-spec.js`), logo, file mẫu nhập hàng loạt và file mẫu công tác `/mau-nhap-cong-tac.xlsx` (nhúng trong binary, byte = bản cuối trong git), không còn cần `public/`; kiểm lại 2026-10-15 với `STATIC_DIR` trống
- Chạy React với server Go: đặt `CORS_ORIGINS` của server Go đúng origin của frontend (cấu hình chạy, không phải phần mã còn thiếu; deploy production thuộc [N2](#n2))
- Backlog mục 2.1 (2026-10-15, 3 đợt) làm trên server Go + module QS React, mục 2.1 nay trống; mỗi việc ghi ở module của nó trong mục 5 (mã M). Kiểm tích hợp sau đợt 3: Go build / vet / gofmt / test toàn bộ đạt trên `qspro_gotest` (migration tới 0013), mọi tab QS chạy với admin / staff / super không lỗi trang
- Kiểm thử 2026-10-15: build OK, 62.658 golden test công thức đạt (chạy lại sau backlog: 62.658 đạt / 0 khác; 2 ca thư viện công tác "giả", "mẫu+giả" nay đưa danh sách theo thứ tự máy chủ trả vì M5.3 sắp lại công tác ở máy), so từng tab với bản gốc không thiếu số tiền nào (admin, staff, super), file Excel báo giá trùng bản gốc, 20 trang SiteFlow khác không đổi pixel nào, chạy được không có `public/` (cả bản Docker)
