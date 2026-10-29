/* Trường sản phẩm - form Nhập / modal Sửa / bảng Danh sách SP. Port nguyên văn PUB/nhap.js + sanpham.js.
   Spec ngành (VS_SPEC / SON_SPEC / CT_SPEC) là THAM SỐ: specs = {VS_SPEC, SON_SPEC, CT_SPEC} (api/specs.js loadSpecs).
   Nguồn: DB_GROUPS / DB_FLAT nhap.js:6-41 · DB_GROUPS_VS 50-76 · DB_GROUPS_SON 80-105 · DB_GROUPS_CT 109-135 · coSpec_ 137
   specNganh_ / nganhCuaSP_ / groupsCuaSP_ 142-150 · DOC_GROUPS / docList_ / prodDocs_ / lineProd_ / lineDocs_ / docExt_ 166-176
   IMP_TRUC / impGon_ 598-600 · IMP_LOAI 723-724 · COL2PROP / SP_* sanpham.js:161-180 · DB_LABEL2COL_ / SP_COL2LABEL_ 1941-1962
   spSpec_ / vsVal_ / vsNhom_ / vsChip_ app.js:1178-1184, 1220-1224 */

// Phẳng hoá nhóm trường (DB_FLAT = mọi trường theo thứ tự nhóm)
export function flat_(groups){ var out=[]; groups.forEach(function(gr){ gr.f.forEach(function(f){ out.push(f); }); }); return out; }

/* ==== Nhập dữ liệu -> bảng DB_SẢN PHẨM. Trường: [nhãn cột Lark, nhãn hiển thị, kiểu, bắt buộc, danh sách chọn, gợi ý, 'vs'] ==== */
export const DB_GROUPS=[
  {g:'Thông tin cơ bản', f:[
    ['THƯƠNG HIỆU','Thương hiệu','text',1],['NHÀ CUNG CẤP','Nhà cung cấp','text',1],
    ['HẠNG MỤC','Hạng mục','sel',1,['Đèn nội thất','Đèn ngoại thất','Đèn kỹ thuật']],
    ['DÒNG SẢN PHẨM','Dòng sản phẩm','text',1],['NHÓM SẢN PHẨM','Nhóm sản phẩm','text',0,null,'Để trống = lấy theo Dòng sản phẩm'],
    ['TÊN SẢN PHẨM','Tên sản phẩm','text',1],['MÃ SẢN PHẨM','Mã sản phẩm','text',1] ]},
  {g:'Thông tin giá bán', note:'Giá đại lý tự tính = Giá bán lẻ × (1 − %Chiết khấu).', f:[
    ['GIÁ BÁN LẺ','Giá bán lẻ','num',1],['CHIẾT KHẤU ĐẠI LÝ (%)','%Chiết khấu','num',1],['GIÁ ĐẠI LÝ','Giá đại lý','calc',1] ]},
  {g:'Key Product Info (Thông tin chính)', f:[
    ['CÔNG SUẤT (W)','Công suất','text',1,null,'VD: 7  ·  2×5  ·  9/18'],['NHIỆT ĐỘ MÀU (K)','Nhiệt độ màu','sel',1,['2700','3000','4000','5000','6500']],
    ['GÓC CHIẾU (°)','Góc chiếu','text',1],['MÀU SẮC','Màu sắc','text',1],['CHẤT LIỆU','Chất liệu','text',1] ]},
  {g:'Thông số thiết kế', f:[
    ['GÓC NGHIÊNG (°)','Góc nghiêng','text',0],['CHIỀU CAO (mm)','Chiều cao','num',0],['ĐƯỜNG KÍNH (mm)','Đường kính','num',1] ]},
  {g:'Performance Specifications (Thông số hiệu suất)', f:[
    ['QUANG THÔNG (lm)','Quang thông','num',1],['CHỈ SỐ IP','Chỉ số IP (Chống bụi, nước)','sel',1,['IP20','IP44','IP54','IP65']],['CRI','CRI','text',1],
    ['HIỆU SUẤT PHÁT QUANG (lm/W)','Hiệu suất phát quang (lm/W)','num',0],['UGR','UGR','text',0],['SDCM','SDCM','text',0],
    ['COI','COI','text',0],['TUỔI THỌ','Tuổi thọ','text',0],
    ['TÊN CHIP LED','Tên chip LED','sel',0,['Bridgelux','Citizen','Cree','Osram','Samsung','Lumileds','Nichia','Seoul Semiconductor','Epistar','San An'],'Hãng / model chip, VD: Samsung LM301B'],
    ['LOẠI CHIP LED','Loại chip LED','sel',0,['COB','SMD','SMD 2835','SMD 3030','SMD 5730','Modul']] ]},
  {g:'Driver (Nguồn LED / Chấn lưu)', f:[
    ['LẮP NGUỒN RỜI','Lắp nguồn rời','sel',0,['Có','Không']],['TÊN BỘ NGUỒN','Tên bộ nguồn','text',0],['MÃ BỘ NGUỒN','Mã bộ nguồn','text',0],
    ['HÃNG BỘ NGUỒN','Hãng bộ nguồn','text',0],['GIÁ BÁN BỘ NGUỒN','Giá bán bộ nguồn','num',0,null,'VNĐ — giá bán rời của bộ nguồn'],
    ['VỊ TRÍ LẮP NGUỒN','Vị trí lắp nguồn','sel',0,['Lắp rời','Tích hợp trong thân đèn']],
    ['TƯƠNG THÍCH ĐIỀU KHIỂN','Tương thích điều khiển','sel',0,['DALI','0-10V','Triac','On-Off']],['DÒNG RA TỐI ĐA (mA)','Dòng ra tối đa (mA)','num',0] ]},
  {g:'Installation Specifications (Thông số lắp đặt)', f:[
    ['LỖ KHOÉT TRẦN (mm)','Lỗ khoét trần (Cutout)','text',1,null,'VD: Ø75  ·  Ø40×78  ·  60×60'],
    ['CẤP BẢO VỆ ĐIỆN','Cấp bảo vệ điện','sel',0,['Class I','Class II','Class III']] ]},
  {g:'Thương mại', f:[
    ['BẢO HÀNH (năm)','Bảo hành (năm)','num',0],['ĐƠN VỊ TÍNH','Đơn vị tính','sel',1,['Cái','Bộ','Mét']],
    ['TRẠNG THÁI','Trạng thái','sel',0,['Đang kinh doanh','Ngưng kinh doanh','Đặt hàng']],
    ['GHI CHÚ','Ghi chú','area',0] ]},
  {g:'Tài liệu', note:'Tải file lên (PDF, ảnh, bản vẽ DWG/DXF, ZIP…) hoặc dán link — hiện thành nút mở trong Thông tin sản phẩm.', f:[
    ['LINK DATASHEET','Tài liệu kỹ thuật / Catalogue','doc',0],['THÔNG SỐ KỸ THUẬT','Thông số kỹ thuật','doc',0],
    ['HƯỚNG DẪN CÀI ĐẶT','Hướng dẫn cài đặt','doc',0],['FILE BẢN VẼ','File bản vẽ','doc',0] ]},
];
export const DB_FLAT=flat_(DB_GROUPS);

/* Thiết bị vệ sinh (đề mục 3.2.5): bộ nhóm sinh từ VS_SPEC (nhap.js:50-76) */
export function dbGroupsVs(VS_SPEC){
  function vsGomNhom_(k){ return k==='chinh'?VS_SPEC.CHINH_ALL:VS_SPEC.TK_ALL; }
  function vsField_(lb){ var m=VS_SPEC.METRIC[lb]; return [lb, m[1], m[2], 0, [], m[3]||'', 'vs']; }
  return [
    {g:'Thông tin cơ bản', f:[
      ['THƯƠNG HIỆU','Thương hiệu','text',1],['NHÀ CUNG CẤP','Nhà cung cấp','text',1],
      ['HẠNG MỤC','Hạng mục','hm',1,VS_SPEC.HANG_MUC],
      ['DÒNG SẢN PHẨM','Dòng sản phẩm','text',1,null,'VD: Bồn cầu treo tường'],
      ['NHÓM SẢN PHẨM','Nhóm sản phẩm','text',0,null,'Để trống = lấy theo Dòng sản phẩm'],
      ['TÊN SẢN PHẨM','Tên sản phẩm','text',1],['MÃ SẢN PHẨM','Mã sản phẩm','text',1] ]},
    {g:'Thông tin giá bán', note:'Giá đại lý tự tính = Giá bán lẻ × (1 − %Chiết khấu).', f:[
      ['GIÁ BÁN LẺ','Giá bán lẻ','num',1],['CHIẾT KHẤU ĐẠI LÝ (%)','%Chiết khấu','num',1],['GIÁ ĐẠI LÝ','Giá đại lý','calc',0] ]},
    {g:'Key Product Info (Thông tin chính)', vs:1, note:'Thông số theo hạng mục đã chọn — lên cột "Thông tin chính" của bảng bóc tách.',
      f:vsGomNhom_('chinh').map(vsField_)},
    {g:'Thông số thiết kế', vs:1, note:'Thông số theo hạng mục đã chọn — lên cột "Thông số thiết kế" của bảng bóc tách.',
      f:vsGomNhom_('tk').map(vsField_)},
    {g:'Tính năng', note:'Mỗi dòng một tính năng — hiện ở phần Thông tin sản phẩm (mở rộng).', f:[
      ['TÍNH NĂNG','Tính năng','area',0,null,'• Men sứ chống dính CEFIONTECT\n• Hệ thống xả Tornado siêu êm'] ]},
    {g:'Thương mại', f:[
      ['BẢO HÀNH (năm)','Bảo hành (năm)','num',0],
      ['ĐƠN VỊ TÍNH','Đơn vị tính','sel',1,['Cái','Bộ','Chiếc']],
      ['TRẠNG THÁI','Trạng thái','sel',0,['Đang kinh doanh','Ngưng kinh doanh','Đặt hàng']],
      ['GHI CHÚ','Ghi chú','area',0] ]},
    {g:'Tài liệu', note:'Tải file lên (PDF, ảnh, bản vẽ DWG/DXF, ZIP…) hoặc dán link — hiện thành nút mở trong Thông tin sản phẩm.', f:[
      ['LINK DATASHEET','Tài liệu kỹ thuật / Catalogue','doc',0],['THÔNG SỐ KỸ THUẬT','Thông số kỹ thuật','doc',0],
      ['HƯỚNG DẪN CÀI ĐẶT','Hướng dẫn cài đặt','doc',0],['FILE BẢN VẼ','File bản vẽ','doc',0] ]},
  ];
}
/* Sơn nước (đề mục 3.2.2): sinh từ SON_SPEC (nhap.js:80-105) */
export function dbGroupsSon(SON_SPEC){
  function sonField_(lb){ var m=SON_SPEC.METRIC[lb]; return [lb, m[1], m[2], 0, [], m[3]||'', 'vs']; }
  return [
    {g:'Thông tin cơ bản', f:[
      ['THƯƠNG HIỆU','Thương hiệu','text',1],['NHÀ CUNG CẤP','Nhà cung cấp','text',1],
      ['HẠNG MỤC','Hạng mục','hm',1,SON_SPEC.HANG_MUC],
      ['DÒNG SẢN PHẨM','Dòng sản phẩm','text',1,null,'VD: Sơn ngoại thất'],
      ['NHÓM SẢN PHẨM','Nhóm sản phẩm','text',0,null,'Để trống = lấy theo Dòng sản phẩm'],
      ['TÊN SẢN PHẨM','Tên sản phẩm','text',1],['MÃ SẢN PHẨM','Mã sản phẩm','text',1] ]},
    {g:'Thông tin giá bán', note:'Giá đại lý tự tính = Giá bán lẻ × (1 − %Chiết khấu).', f:[
      ['GIÁ BÁN LẺ','Giá bán lẻ','num',1],['CHIẾT KHẤU ĐẠI LÝ (%)','%Chiết khấu','num',1],['GIÁ ĐẠI LÝ','Giá đại lý','calc',0] ]},
    {g:'Key Product Info (Thông tin chính)', vs:1, note:'Thông số theo hạng mục đã chọn — lên cột "Thông tin chính" của bảng bóc tách.',
      f:SON_SPEC.CHINH_ALL.map(sonField_)},
    {g:'Tính chất vật lý & hoá học', vs:1, note:'Theo mục IX của bảng dữ liệu an toàn — lên cột "Thông số thiết kế" của bảng bóc tách.',
      f:SON_SPEC.TK_ALL.map(sonField_)},
    {g:'Tính năng', note:'Mỗi dòng một tính năng — hiện ở phần Thông tin sản phẩm (mở rộng).', f:[
      ['TÍNH NĂNG','Tính năng','area',0,null,'• Chống nấm mốc\n• Chống bám bụi\n• Sắc màu bền đẹp'] ]},
    {g:'Thương mại', f:[
      ['BẢO HÀNH (năm)','Bảo hành (năm)','num',0],
      ['ĐƠN VỊ TÍNH','Đơn vị tính','sel',1,['Thùng','Lon','Bao','Bộ','Lít','Kg']],
      ['TRẠNG THÁI','Trạng thái','sel',0,['Đang kinh doanh','Ngưng kinh doanh','Đặt hàng']],
      ['GHI CHÚ','Ghi chú','area',0] ]},
    {g:'Tài liệu', note:'Tải file lên (PDF, ảnh, bảng dữ liệu an toàn, ZIP…) hoặc dán link — hiện thành nút mở trong Thông tin sản phẩm.', f:[
      ['LINK DATASHEET','Tài liệu kỹ thuật / Catalogue','doc',0],['THÔNG SỐ KỸ THUẬT','Thông số kỹ thuật','doc',0],
      ['HƯỚNG DẪN CÀI ĐẶT','Hướng dẫn thi công','doc',0],['FILE BẢN VẼ','Bảng màu / File bản vẽ','doc',0] ]},
  ];
}
/* Công tắc - ổ cắm (đề mục 3.2.6.2): sinh từ CT_SPEC (nhap.js:109-135) */
export function dbGroupsCt(CT_SPEC){
  function ctField_(lb){ var m=CT_SPEC.METRIC[lb]; return [lb, m[1], m[2], 0, [], m[3]||'', 'vs']; }
  function ctKhoi_(k){ var out=[]; CT_SPEC.HANG_MUC.forEach(function(h){ CT_SPEC.HM[h].nhom[k].forEach(function(lb){ if(out.indexOf(lb)<0) out.push(lb); }); }); return out; }
  return [
    {g:'Thông tin cơ bản', f:[
      ['THƯƠNG HIỆU','Thương hiệu','text',1],['NHÀ CUNG CẤP','Nhà cung cấp','text',1],
      ['HẠNG MỤC','Hạng mục','hm',1,CT_SPEC.HANG_MUC],
      ['DÒNG SẢN PHẨM','Dòng sản phẩm','text',1,null,'VD: Ổ cắm đôi 3 chấu · Công tắc 2 nút 1 chiều'],
      ['NHÓM SẢN PHẨM','Nhóm sản phẩm (series)','text',0,null,'Tên series của NCC — để trống = lấy theo Dòng sản phẩm'],
      ['TÊN SẢN PHẨM','Tên sản phẩm','text',1],['MÃ SẢN PHẨM','Mã sản phẩm','text',1,null,'Hãng bán rời mặt / hạt / đế: mỗi cấu kiện 1 mã'] ]},
    {g:'Thông tin giá bán', note:'Giá đại lý tự tính = Giá bán lẻ × (1 − %Chiết khấu).', f:[
      ['GIÁ BÁN LẺ','Giá bán lẻ','num',1],['CHIẾT KHẤU ĐẠI LÝ (%)','%Chiết khấu','num',1],['GIÁ ĐẠI LÝ','Giá đại lý','calc',0] ]},
    {g:'Key Product Info (Thông tin chính)', vs:1, note:'Thông số theo hạng mục đã chọn — lên cột "Thông tin chính" của bảng bóc tách.', f:ctKhoi_('chinh').map(ctField_)},
    {g:'Electrical Specifications (Thông số điện & an toàn)', vs:1, f:ctKhoi_('dien').map(ctField_)},
    {g:'USB / Tín hiệu / Thông minh & điều khiển', vs:1, f:ctKhoi_('tm').map(ctField_)},
    {g:'Installation Specifications (Thông số lắp đặt)', vs:1, note:'Rộng × Cao × Dày ghép thành "Kích thước mặt" trên bảng bóc tách.', f:ctKhoi_('lap').map(ctField_)},
    {g:'Tính năng', note:'Mỗi dòng một tính năng — hiện ở phần Thông tin sản phẩm (mở rộng).', f:[
      ['TÍNH NĂNG','Tính năng','area',0,null,'• Chống giật\n• Mặt phẳng chống bám bụi'] ]},
    {g:'Thương mại', f:[
      ['BẢO HÀNH (năm)','Bảo hành (năm)','num',0],
      ['ĐƠN VỊ TÍNH','Đơn vị tính','sel',1,['Cái','Bộ','Hộp']],
      ['TRẠNG THÁI','Trạng thái','sel',0,['Đang kinh doanh','Ngưng kinh doanh','Đặt hàng']],
      ['GHI CHÚ','Ghi chú','area',0] ]},
    {g:'Tài liệu', note:'Tải file lên (PDF, ảnh, ZIP…) hoặc dán link — hiện thành nút mở trong Thông tin sản phẩm.', f:[
      ['LINK DATASHEET','Tài liệu kỹ thuật / Catalogue','doc',0],['THÔNG SỐ KỸ THUẬT','Thông số kỹ thuật','doc',0],
      ['HƯỚNG DẪN CÀI ĐẶT','Hướng dẫn lắp đặt','doc',0],['FILE BẢN VẼ','File bản vẽ','doc',0] ]},
  ];
}

/* Điện lạnh (đề mục 3.2.7, QS Pro ea787b6): sinh từ DL_SPEC. Điều hoà: 4 khối theo DL_SPEC.KHOI; vật tư / phụ kiện / thông gió: Quy cách · Xuất xứ */
export function dbGroupsDl(DL_SPEC){
  function dlField_(lb){ var m=DL_SPEC.METRIC[lb]; return [lb, m[1], m[2], 0, [], m[3]||'', 'vs']; }
  function dlKhoi_(k){ var out=[]; DL_SPEC.HANG_MUC.forEach(function(h){ DL_SPEC.HM[h].nhom[k].forEach(function(lb){ if(out.indexOf(lb)<0) out.push(lb); }); }); return out; }
  return [
    {g:'Thông tin cơ bản', f:[
      ['THƯƠNG HIỆU','Thương hiệu','text',1],['NHÀ CUNG CẤP','Nhà cung cấp','text',1],
      ['HẠNG MỤC','Hạng mục','hm',1,DL_SPEC.HANG_MUC],
      ['DÒNG SẢN PHẨM','Dòng sản phẩm','text',1,null,'VD: Máy lạnh treo tường · Dàn nóng Multi · Ống đồng dẫn gas'],
      ['NHÓM SẢN PHẨM','Nhóm sản phẩm (series)','text',0,null,'Tên series của NCC — để trống = lấy theo Dòng sản phẩm'],
      ['TÊN SẢN PHẨM','Tên sản phẩm','text',1],['MÃ SẢN PHẨM','Mã sản phẩm','text',1,null,'Mỗi model 1 mã'] ]},
    {g:'Thông tin giá bán', note:'Giá đại lý tự tính = Giá bán lẻ × (1 − %Chiết khấu).', f:[
      ['GIÁ BÁN LẺ','Giá bán lẻ','num',1],['CHIẾT KHẤU ĐẠI LÝ (%)','%Chiết khấu','num',1],['GIÁ ĐẠI LÝ','Giá đại lý','calc',0] ]},
  ].concat(DL_SPEC.KHOI.map(function(k,i){ var t=k[1].split('|');
    return {g:t[0]+' ('+t[1]+')', vs:1, note:i===0?'Thông số theo hạng mục đã chọn — lên cột "Thông tin chính" của bảng bóc tách. Vật tư / phụ kiện chỉ có Quy cách · Xuất xứ.':undefined, f:dlKhoi_(k[0]).map(dlField_)}; })
  ).concat([
    {g:'Tính năng', note:'Mỗi dòng một tính năng — hiện ở phần Thông tin sản phẩm (mở rộng).', f:[
      ['TÍNH NĂNG','Tính năng','area',0,null,'• Inverter tiết kiệm điện\n• Lọc bụi mịn PM2.5'] ]},
    {g:'Thương mại', f:[
      ['BẢO HÀNH (năm)','Bảo hành (năm)','num',0],
      ['ĐƠN VỊ TÍNH','Đơn vị tính','sel',1,['Bộ','Cái','m','Lô','Gói']],
      ['TRẠNG THÁI','Trạng thái','sel',0,['Đang kinh doanh','Ngưng kinh doanh','Đặt hàng']],
      ['GHI CHÚ','Ghi chú','area',0] ]},
    {g:'Tài liệu', note:'Tải file lên (PDF, ảnh, ZIP…) hoặc dán link — hiện thành nút mở trong Thông tin sản phẩm.', f:[
      ['LINK DATASHEET','Tài liệu kỹ thuật / Catalogue','doc',0],['THÔNG SỐ KỸ THUẬT','Thông số kỹ thuật','doc',0],
      ['HƯỚNG DẪN CÀI ĐẶT','Hướng dẫn lắp đặt','doc',0],['FILE BẢN VẼ','File bản vẽ','doc',0] ]},
  ]);
}

/* Ngành có BỘ THÔNG SỐ THEO HẠNG MỤC (khác đèn): vệ sinh · sơn nước · công tắc - ổ cắm · điện lạnh */
export function coSpec_(n){ return n==='vs'||n==='son'||n==='ct'||n==='dl'; }
/* Spec tải bất đồng bộ (api/specs.js loadSpecs, PLAN D6): khi CHƯA có / tải lỗi, các hàm dưới KHÔNG ném lỗi mà coi như
   chưa biết ngành: specNganh_ -> null, nganhCuaSP_ -> '' (trừ SP ghi sẵn ngành vs/son/ct), groups*_ -> [], bản đồ nhãn chỉ còn cột chung.
   Người gọi kiểm specsOk_ để hiện "Không tải được thông số ngành" (PLAN 1.6). Có đủ spec thì kết quả đúng như bản gốc. */
export function specsOk_(specs){ return !!(specs && specs.VS_SPEC && specs.SON_SPEC && specs.CT_SPEC && specs.DL_SPEC); }
// Bộ thông số theo ngành
export function specNganh_(ng, specs){ specs=specs||{}; return (ng==='son'?specs.SON_SPEC:(ng==='ct'?specs.CT_SPEC:(ng==='dl'?specs.DL_SPEC:specs.VS_SPEC)))||null; }
export function nganhCuaSP_(p, specs){
  if(!p) return 'den';
  var n=String(p.nganh||'').trim(); if(coSpec_(n)) return n;
  if(!specsOk_(specs)) return '';
  if(!n && specs.SON_SPEC.chuanHM(p.hangMuc)) return 'son';
  if(!n && specs.CT_SPEC.chuanHM(p.hangMuc)) return 'ct';
  if(specs.VS_SPEC.nganhOf(p.nganh,p.hangMuc)==='vs') return 'vs';
  // Điện lạnh: xét sau vệ sinh như máy chủ (categories.NganhCua) - hạng mục chuẩn hoặc ghi chung ("Điện lạnh", "Máy lạnh"...)
  if(!n && (specs.DL_SPEC.chuanHM(p.hangMuc)||specs.DL_SPEC.laChung(p.hangMuc))) return 'dl';
  return 'den';
}
// Bộ nhóm trường theo ngành (impGroups_ / groupsCuaSP_): 'son' | 'ct' | 'vs' | còn lại = đèn
export function groupsOfNganh_(ng, specs){ if(coSpec_(ng) && !specNganh_(ng, specs)) return []; return ng==='son'?dbGroupsSon(specs.SON_SPEC):(ng==='ct'?dbGroupsCt(specs.CT_SPEC):(ng==='dl'?dbGroupsDl(specs.DL_SPEC):(ng==='vs'?dbGroupsVs(specs.VS_SPEC):DB_GROUPS))); }
export function groupsCuaSP_(p, specs){ var ng=nganhCuaSP_(p, specs); return ng?groupsOfNganh_(ng, specs):[]; }

/* ═══ TÀI LIỆU SẢN PHẨM - mỗi trường chứa NHIỀU file (mỗi dòng 1 link) ═══ */
export const DOC_GROUPS=[['link_datasheet','linkDatasheet','Tài liệu kỹ thuật'],['thong_so_file','thongSoFile','Thông số kỹ thuật'],
  ['huong_dan_lap_dat','huongDanLapDat','Hướng dẫn cài đặt'],['file_ban_ve','fileBanVe','File bản vẽ']];
export function docList_(v){ return String(v||'').split(/\r?\n|\s*;\s*/).map(function(x){ return x.trim(); }).filter(Boolean); }
// Toàn bộ file của 1 sản phẩm: [{g:'Hướng dẫn cài đặt', url}]
export function prodDocs_(p){ var raw=(p&&p.raw)||{}, out=[];
  DOC_GROUPS.forEach(function(d){ docList_(raw[d[0]]||(p&&p[d[1]])).forEach(function(u){ out.push({g:d[2], url:u}); }); });
  return out; }
// Dòng bóc tách -> sản phẩm gốc trong danh mục (theo mã SP, dự phòng theo tên)
export function lineProd_(l, products){ var ma=String(l.maSP||'').trim().toLowerCase(), ten=String(l.ten||'').trim().toLowerCase(), ds=products||[], p=null;
  if(ma) p=ds.filter(function(x){ return String(x.ma||'').trim().toLowerCase()===ma && prodDocs_(x).length; })[0]||ds.filter(function(x){ return String(x.ma||'').trim().toLowerCase()===ma; })[0];
  if(!p && ten) p=ds.filter(function(x){ return String(x.ten||'').trim().toLowerCase()===ten; })[0];
  return p||null; }
export function lineDocs_(l, products){ var p=lineProd_(l, products); return p?prodDocs_(p):[]; }
export function docExt_(u){ var m=/\.([a-z0-9]{2,4})(?:$|[?#])/i.exec(String(u||'').split('?')[0]); return m?m[1].toLowerCase():'link'; }

/* Máy chủ gặp SP TRÙNG mã + thông số biến thể thì CẬP NHẬT đè -> hỏi lại trước khi lưu */
export const IMP_TRUC=[['MÀU SẮC','mauSac','mau_sac'],['NHIỆT ĐỘ MÀU (K)','nhietDo','nhiet_do_mau_k'],['CÔNG SUẤT (W)','congSuat','cong_suat_w'],
  ['GÓC CHIẾU (°)','gocChieu','goc_chieu_deg'],['KÍCH THƯỚC','kichThuoc','kich_thuoc']];
export function impGon_(v){ return String(v==null?'':v).toLowerCase().replace(/[^0-9a-z.À-ỹ]/g,''); }
// Ngành hàng ở trang Nhập dữ liệu
export const IMP_LOAI=[['sp','Thiết bị đèn · sản phẩm'],['vs','Thiết bị vệ sinh · sản phẩm'],
  ['son','Sơn nước · sản phẩm'],['ct','Công tắc - ổ cắm · sản phẩm'],['dl','Điện lạnh · sản phẩm'],['pt','Xây dựng · công tác phần thô']];

// cột DB -> thuộc tính đã format sẵn trong object sản phẩm
export const COL2PROP={ thuong_hieu:'thuongHieu', nha_cung_cap:'ncc', hang_muc:'hangMuc', dong_sp:'dongSanPham',
  cong_suat_w:'congSuat', nhiet_do_mau_k:'nhietDo', goc_chieu_deg:'gocChieu', goc_nghieng_deg:'gocNghieng',
  mau_sac:'mauSac', chat_lieu:'chatLieu', chieu_cao_mm:'chieuCao', duong_kinh_mm:'duongKinh',
  cutout_mm:'loKhoet', chi_so_ip:'capBaoVe', cri:'cri', hieu_suat_lm_w:'hieuSuat', quang_thong_lm:'quangThong',
  ugr:'ugr', sdcm:'sdcm', coi:'coi', tuoi_tho:'tuoiTho', ten_chip_led:'tenChip', loai_chip_led:'chipLed',
  class_rating:'capBaoVeDien', lap_nguon_roi:'lapNguonRoi', ten_bo_nguon:'tenBoNguon', ma_bo_nguon:'maBoNguon',
  hang_bo_nguon:'hangBoNguon', vi_tri_lap_nguon:'viTriNguon', dieu_khien:'tuongThich', dong_ra_max_ma:'dongRa',
  bao_hanh_nam:'baoHanh', dvt:'dvt', link_datasheet:'linkDatasheet' };
export const SP_NUMCOL={gia_ban_le:1, ck_dai_ly_pct:1, gia_ban_bo_nguon:1, quang_thong_lm:1, hieu_suat_lm_w:1, dong_ra_max_ma:1,
  bao_hanh_nam:1, chieu_cao_mm:1, duong_kinh_mm:1};
export const SP_CTCOL={cong_suat_w:1, nhiet_do_mau_k:1, goc_chieu_deg:1, goc_nghieng_deg:1, cri:1, chi_so_ip:1,
  ugr:1, sdcm:1, coi:1, dvt:1, loai_chip_led:1, lap_nguon_roi:1, class_rating:1};
export const SP_SFX={gia_ban_le:'đ', ck_dai_ly_pct:'%', gia_ban_bo_nguon:'đ'};      // đơn vị chỉ hiện cạnh ô, KHÔNG nằm trong giá trị
export const SP_ALWAYS={ck_dai_ly_pct:1};       // cột này sửa được cả khi CHƯA bật Edit (giá bán lẻ chỉ sửa ở chế độ Edit)
export const SP_MONEY={gia_ban_le:1, gia_ban_bo_nguon:1};     // ô tiền: hiện có dấu chấm 930.000, lưu số thuần
export const SP_SKIP={'TÊN SẢN PHẨM':1,'MÃ SẢN PHẨM':1,'GIÁ ĐẠI LÝ':1,'ẢNH SẢN PHẨM':1};   // đã có cột đặc biệt lo
export const SP_COLLBL={trang_thai:'Trạng thái KD'};   // tránh trùng tên với cột "Trạng thái" (duyệt)

/* Nhãn cột Lark -> cột DB (kèm cột của 3 spec ngành) và chiều ngược lại */
export function dbLabelMaps_(specs){
  var DB_LABEL2COL_={
    'MÃ SẢN PHẨM':'ma_sp','TÊN SẢN PHẨM':'ten_sp','DÒNG SẢN PHẨM':'dong_sp','HẠNG MỤC':'hang_muc','NHÓM SẢN PHẨM':'nhom_sp',
    'THƯƠNG HIỆU':'thuong_hieu','NHÀ CUNG CẤP':'nha_cung_cap','CÔNG SUẤT (W)':'cong_suat_w','NHIỆT ĐỘ MÀU (K)':'nhiet_do_mau_k',
    'QUANG THÔNG (lm)':'quang_thong_lm','GÓC CHIẾU (°)':'goc_chieu_deg','GÓC NGHIÊNG (°)':'goc_nghieng_deg','MÀU SẮC':'mau_sac',
    'CHẤT LIỆU':'chat_lieu','CHIỀU CAO (mm)':'chieu_cao_mm','ĐƯỜNG KÍNH (mm)':'duong_kinh_mm','LỖ KHOÉT TRẦN (mm)':'cutout_mm',
    'CHỈ SỐ IP':'chi_so_ip','CRI':'cri','HIỆU SUẤT PHÁT QUANG (lm/W)':'hieu_suat_lm_w','UGR':'ugr','SDCM':'sdcm','COI':'coi',
    'TUỔI THỌ':'tuoi_tho','TÊN CHIP LED':'ten_chip_led','LOẠI CHIP LED':'loai_chip_led','CẤP BẢO VỆ ĐIỆN':'class_rating','LẮP NGUỒN RỜI':'lap_nguon_roi',
    'TÊN BỘ NGUỒN':'ten_bo_nguon','MÃ BỘ NGUỒN':'ma_bo_nguon','HÃNG BỘ NGUỒN':'hang_bo_nguon','GIÁ BÁN BỘ NGUỒN':'gia_ban_bo_nguon','VỊ TRÍ LẮP NGUỒN':'vi_tri_lap_nguon',
    'TƯƠNG THÍCH ĐIỀU KHIỂN':'dieu_khien','DÒNG RA TỐI ĐA (mA)':'dong_ra_max_ma','BẢO HÀNH (năm)':'bao_hanh_nam','ĐƠN VỊ TÍNH':'dvt',
    'GIÁ BÁN LẺ':'gia_ban_le','CHIẾT KHẤU ĐẠI LÝ (%)':'ck_dai_ly_pct','ẢNH SẢN PHẨM':'anh_sp','LINK DATASHEET':'link_datasheet',
    'TRẠNG THÁI':'trang_thai','GHI CHÚ':'ghi_chu',
    // ---- Ngành THIẾT BỊ VỆ SINH ----
    'NGÀNH HÀNG':'nganh','KÍCH THƯỚC':'kich_thuoc','HỆ THỐNG XẢ':'he_thong_xa',
    'LƯỢNG NƯỚC XẢ':'luong_nuoc_xa','THIẾT KẾ':'thiet_ke','TÂM XẢ':'tam_xa',
    'ÁP LỰC NƯỚC':'ap_luc_nuoc','LƯU Ý':'luu_y','TÍNH NĂNG':'tinh_nang',
    'GIÁ ĐẠI LÝ':'gia_dai_ly'   // chỉ HIỂN THỊ: cột tự tính, server bỏ qua khi lưu
  };
  ['VS_SPEC','SON_SPEC','CT_SPEC','DL_SPEC'].forEach(function(k){ var SP=specs&&specs[k]; if(!SP) return;
    Object.keys(SP.METRIC).forEach(function(lb){ if(!DB_LABEL2COL_[lb]) DB_LABEL2COL_[lb]=SP.METRIC[lb][0]; }); });
  Object.assign(DB_LABEL2COL_,{'THÔNG SỐ KỸ THUẬT':'thong_so_file','HƯỚNG DẪN CÀI ĐẶT':'huong_dan_lap_dat','FILE BẢN VẼ':'file_ban_ve'});
  var SP_COL2LABEL_={}; Object.keys(DB_LABEL2COL_).forEach(function(k){ SP_COL2LABEL_[DB_LABEL2COL_[k]]=k; });
  return {DB_LABEL2COL_:DB_LABEL2COL_, SP_COL2LABEL_:SP_COL2LABEL_};
}

/* Thông số vệ sinh / sơn / công tắc theo HẠNG MỤC của SP */
export function spSpec_(p, specs){ var ng=nganhCuaSP_(p, specs); return ng?specNganh_(ng, specs):null; }
export function vsVal_(p,lb,specs){ var SP=spSpec_(p,specs), m=SP&&SP.METRIC[lb]; var v=m&&p.raw?p.raw[m[0]]:''; return (v==null?'':String(v)).trim(); }
export function vsNhom_(p,specs){
  var SP=spSpec_(p,specs); if(!SP) return {chinh:[], tk:[]};
  var h=SP.hmOf(p.hangMuc);
  if(h) return {chinh:h.chinh, tk:h.tk};
  return {chinh:SP.CHINH_ALL, tk:SP.TK_ALL};     // hạng mục lạ: cùng cách chia với server
}
// 4 thông số nổi bật của SP vệ sinh: [icon, giá trị, nhãn]
export function vsChip_(p,specs){
  var g=vsNhom_(p,specs), ds=['KÍCH THƯỚC','MÀU SẮC'].concat(g.chinh.filter(function(lb){ return lb!=='MÀU SẮC'&&lb!=='THIẾT KẾ'; }));
  var ic={'KÍCH THƯỚC':'ruler','MÀU SẮC':'color'};
  return ds.map(function(lb){ return [ic[lb]||'gauge', vsVal_(p,lb,specs), lb]; }).filter(function(x){ return x[1]; }).slice(0,4);
}
