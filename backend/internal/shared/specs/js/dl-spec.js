/* ═══ ĐIỆN LẠNH (đề mục 3.2.7) — BỘ THÔNG SỐ THEO TỪNG HẠNG MỤC (nguồn DUY NHẤT) ═══
   Cùng cách làm với public/ct-spec.js (công tắc - ổ cắm). Dùng chung cho form Nhập dữ liệu / modal Sửa SP,
   file mẫu nhập hàng loạt (/mau-nhap-dien-lanh.xlsx), server (map cột DB, lọc thông số khi nhập, cột "Thông tin chính" /
   "Thông số thiết kế" của bảng bóc tách) và trang thông tin SP.
   Bộ trường lấy theo sheet "THIẾT BỊ ĐIỆN LẠNH" trong file "THIẾT BỊ ĐIỆN 1 - thêm ĐIỆN LẠNH.xlsx" của Dezon:
     · THIẾT BỊ CHÍNH (điều hoà): 4 khối — Key Product Info (cột I) · Performance (K) · Piping & Wiring (M) · Installation (O)
     · VẬT TƯ / PHỤ KIỆN / THÔNG GIÓ: chỉ Quy cách · Xuất xứ
   Cột DB (tên cũ, qua view qs.db_san_pham): db/pg/dien_lanh.sql — bảng product_hvac_specs.                         */
(function (root) {
  'use strict';
  // Nhãn cột (= tiêu đề cột trong file Excel) -> [cột DB, nhãn hiển thị, kiểu, gợi ý nhập]
  var METRIC = {
    // ----- Key Product Info (Thông tin chính) -----
    'LOẠI MÁY':                    ['loai_may', 'Loại máy', 'sel', ''],
    'CÔNG SUẤT LẠNH (kW)':         ['cs_lanh_kw', 'Công suất lạnh (kW)', 'text', 'VD: 5.6'],
    'CÔNG SUẤT (HP)':              ['cs_hp', 'Công suất (HP)', 'text', 'VD: 2'],
    'CÔNG SUẤT (BTU/h)':           ['cs_btu', 'Công suất (BTU/h)', 'text', 'VD: 18000'],
    'CHẾ ĐỘ VẬN HÀNH':             ['che_do_van_hanh', 'Chế độ vận hành', 'sel', ''],
    'CÔNG NGHỆ MÁY NÉN':           ['may_nen', 'Công nghệ máy nén', 'sel', ''],
    'MÔI CHẤT LẠNH (GAS)':         ['moi_chat_lanh', 'Môi chất lạnh (Gas)', 'sel', ''],
    'ĐIỆN NGUỒN':                  ['dien_nguon_dl', 'Điện nguồn', 'sel', 'VD: 220V / 1 pha / 50Hz'],
    'XUẤT XỨ':                     ['xuat_xu', 'Xuất xứ', 'text', 'VD: Thái Lan'],
    // ----- Performance Specifications (Thông số hiệu suất) -----
    'CÔNG SUẤT ĐIỆN TIÊU THỤ (kW)': ['cs_dien_kw', 'Công suất điện tiêu thụ (kW)', 'text', 'VD: 1.55'],
    'HIỆU SUẤT NĂNG LƯỢNG (CSPF / EER)': ['hieu_suat_nl', 'Hiệu suất năng lượng (CSPF / EER)', 'text', 'VD: CSPF 5.8'],
    'NHÃN NĂNG LƯỢNG':             ['nhan_nang_luong', 'Nhãn năng lượng', 'sel', ''],
    'LƯU LƯỢNG GIÓ (m³/h)':        ['luu_luong_gio', 'Lưu lượng gió (m³/h)', 'text', 'VD: 1100'],
    'ĐỘ ỒN DÀN LẠNH (dB)':         ['do_on_dan_lanh', 'Độ ồn dàn lạnh (dB)', 'text', 'VD: 22 - 40'],
    'ĐỘ ỒN DÀN NÓNG (dB)':         ['do_on_dan_nong', 'Độ ồn dàn nóng (dB)', 'text', 'VD: 50'],
    'PHẠM VI LÀM LẠNH (m²)':       ['pham_vi_lam_lanh', 'Phạm vi làm lạnh (diện tích)', 'text', 'VD: 20 - 30 m²'],
    'LỌC KHÍ / KHỬ ẨM':            ['loc_khi', 'Lọc khí / Khử ẩm', 'text', 'VD: Nanoe-X, khử ẩm'],
    'ĐIỀU KHIỂN (REMOTE / WIFI)':  ['dk_dieu_hoa', 'Điều khiển (Remote / Wifi)', 'sel', ''],
    // ----- Piping & Wiring (Kết nối ống đồng / thoát nước / điện) -----
    'ỐNG ĐỒNG – ĐƯỜNG LỎNG':       ['ong_long', 'Ống đồng – đường lỏng', 'text', 'VD: Ø6.4'],
    'ỐNG ĐỒNG – ĐƯỜNG HƠI':        ['ong_hoi', 'Ống đồng – đường hơi', 'text', 'VD: Ø12.7'],
    'CHIỀU DÀI ỐNG TỐI ĐA (m)':    ['ong_dai_max', 'Chiều dài ống tối đa (m)', 'text', 'VD: 20'],
    'CHÊNH LỆCH ĐỘ CAO TỐI ĐA (m)': ['chenh_cao_max', 'Chênh lệch độ cao tối đa (m)', 'text', 'VD: 15'],
    'ỐNG THOÁT NƯỚC':              ['ong_thoat_nuoc', 'Ống thoát nước', 'text', 'VD: D21'],
    'DÂY ĐIỆN NGUỒN':              ['day_nguon', 'Dây điện nguồn', 'text', 'VD: 3 x 2.5mm²'],
    'DÂY ĐIỀU KHIỂN':              ['day_dieu_khien', 'Dây điều khiển', 'text', 'VD: 4 x 1.5mm²'],
    'MẶT NẠ (PANEL) ĐI KÈM':       ['mat_na', 'Mặt nạ (Panel) đi kèm', 'text', 'VD: PT-UAHG0'],
    'SỐ DÀN LẠNH KẾT NỐI TỐI ĐA':  ['so_dan_lanh_max', 'Số dàn lạnh kết nối tối đa (Multi)', 'text', 'VD: 4'],
    'GAS NẠP SẴN / NẠP THÊM':      ['gas_nap', 'Gas nạp sẵn / nạp thêm', 'text', 'VD: Nạp sẵn cho 7.5m, thêm 20g/m'],
    // ----- Installation Specifications (Thông số lắp đặt) -----
    'KÍCH THƯỚC DÀN LẠNH (R x C x S)': ['kt_dan_lanh', 'Kích thước dàn lạnh (R x C x S)', 'text', 'VD: 870 x 302 x 228 mm'],
    'KHỐI LƯỢNG DÀN LẠNH (kg)':    ['kl_dan_lanh', 'Khối lượng dàn lạnh (kg)', 'text', 'VD: 10'],
    'KÍCH THƯỚC DÀN NÓNG (R x C x S)': ['kt_dan_nong', 'Kích thước dàn nóng (R x C x S)', 'text', 'VD: 824 x 619 x 299 mm'],
    'KHỐI LƯỢNG DÀN NÓNG (kg)':    ['kl_dan_nong', 'Khối lượng dàn nóng (kg)', 'text', 'VD: 35'],
    'KÍCH THƯỚC MẶT NẠ / LỖ KHOÉT TRẦN': ['kt_mat_na', 'Kích thước mặt nạ / lỗ khoét trần', 'text', 'VD: 950 x 950 / lỗ 860 x 860'],
    'VỊ TRÍ LẮP ĐẶT':              ['vi_tri_lap_dat', 'Vị trí lắp đặt', 'text', 'VD: Trần thạch cao phòng khách'],
    'GIÁ ĐỠ DÀN NÓNG':             ['gia_do_dan_nong', 'Giá đỡ dàn nóng', 'text', 'VD: Sắt V4 hàn'],
    'KHOẢNG CÁCH LẮP ĐẶT TỐI THIỂU': ['kc_lap_min', 'Khoảng cách lắp đặt tối thiểu', 'text', 'VD: Cách trần 50mm, hai bên 100mm'],
    'GHI CHÚ LẮP ĐẶT':             ['gc_lap_dat', 'Ghi chú lắp đặt', 'text', ''],
    // ----- Vật tư / phụ kiện / thông gió -----
    'QUY CÁCH':                    ['quy_cach_vt', 'Quy cách', 'text', 'VD: Ø9.5 – dày 0.81mm']
  };

  var OPT = {
    'LOẠI MÁY': ['Treo tường', 'Âm trần Cassette', 'Âm trần nối ống gió', 'Áp trần', 'Tủ đứng', 'Dàn nóng Multi', 'Âm trần Cassette (Multi)',
      'Dàn lạnh treo tường (Multi)', 'Dàn lạnh nối ống gió (Multi)', 'VRV / VRF', 'Khác'],
    'CHẾ ĐỘ VẬN HÀNH': ['1 chiều lạnh', '2 chiều nóng lạnh'],
    'CÔNG NGHỆ MÁY NÉN': ['Inverter', 'Non-Inverter', 'Khác'],
    'MÔI CHẤT LẠNH (GAS)': ['R32', 'R410A', 'R22', 'R454B', 'Khác'],
    'ĐIỆN NGUỒN': ['220V / 1 pha / 50Hz', '380V / 3 pha / 50Hz'],
    'NHÃN NĂNG LƯỢNG': ['5 sao', '4 sao', '3 sao', '2 sao', '1 sao', 'Không có'],
    'ĐIỀU KHIỂN (REMOTE / WIFI)': ['Remote không dây', 'Điều khiển dây', 'Wifi (ứng dụng)', 'Remote + Wifi', 'Điều khiển trung tâm']
  };
  // Trường CHUNG của mọi SP điện lạnh — cột nào ngoài CHUNG + thông số của hạng mục đều bị bỏ khi nhập
  var CHUNG = ['THƯƠNG HIỆU', 'NHÀ CUNG CẤP', 'HẠNG MỤC', 'DÒNG SẢN PHẨM', 'NHÓM SẢN PHẨM', 'TÊN SẢN PHẨM', 'MÃ SẢN PHẨM',
    'GIÁ BÁN LẺ', 'CHIẾT KHẤU ĐẠI LÝ (%)', 'TÍNH NĂNG', 'BẢO HÀNH (năm)', 'ĐƠN VỊ TÍNH', 'TRẠNG THÁI',
    'LINK DATASHEET', 'THÔNG SỐ KỸ THUẬT', 'HƯỚNG DẪN CÀI ĐẶT', 'FILE BẢN VẼ', 'GHI CHÚ', 'ẢNH SẢN PHẨM', 'NGÀNH HÀNG'];

  // Tên 4 khối (trang thông tin SP / form / file mẫu) — "Tiếng Anh|Tiếng Việt"
  var KHOI = [['chinh', 'Key Product Info|Thông tin chính'], ['hs', 'Performance Specifications|Thông số hiệu suất'],
    ['ket', 'Piping & Wiring|Kết nối ống đồng / thoát nước / điện'], ['lap', 'Installation Specifications|Thông số lắp đặt']];
  /* 2 module, mỗi module 4 khối đúng thứ tự cột I · K · M · O của sheet.
     ttc / tsk = cột "Thông tin chính" / "Thông số thiết kế" của bảng bóc tách / báo giá ('@BH' = bảo hành) */
  var MAY = {
    chinh: ['LOẠI MÁY', 'CÔNG SUẤT LẠNH (kW)', 'CÔNG SUẤT (HP)', 'CÔNG SUẤT (BTU/h)', 'CHẾ ĐỘ VẬN HÀNH', 'CÔNG NGHỆ MÁY NÉN', 'MÔI CHẤT LẠNH (GAS)', 'ĐIỆN NGUỒN', 'XUẤT XỨ'],
    hs: ['CÔNG SUẤT ĐIỆN TIÊU THỤ (kW)', 'HIỆU SUẤT NĂNG LƯỢNG (CSPF / EER)', 'NHÃN NĂNG LƯỢNG', 'LƯU LƯỢNG GIÓ (m³/h)', 'ĐỘ ỒN DÀN LẠNH (dB)',
      'ĐỘ ỒN DÀN NÓNG (dB)', 'PHẠM VI LÀM LẠNH (m²)', 'LỌC KHÍ / KHỬ ẨM', 'ĐIỀU KHIỂN (REMOTE / WIFI)'],
    ket: ['ỐNG ĐỒNG – ĐƯỜNG LỎNG', 'ỐNG ĐỒNG – ĐƯỜNG HƠI', 'CHIỀU DÀI ỐNG TỐI ĐA (m)', 'CHÊNH LỆCH ĐỘ CAO TỐI ĐA (m)', 'ỐNG THOÁT NƯỚC',
      'DÂY ĐIỆN NGUỒN', 'DÂY ĐIỀU KHIỂN', 'MẶT NẠ (PANEL) ĐI KÈM', 'SỐ DÀN LẠNH KẾT NỐI TỐI ĐA', 'GAS NẠP SẴN / NẠP THÊM'],
    lap: ['KÍCH THƯỚC DÀN LẠNH (R x C x S)', 'KHỐI LƯỢNG DÀN LẠNH (kg)', 'KÍCH THƯỚC DÀN NÓNG (R x C x S)', 'KHỐI LƯỢNG DÀN NÓNG (kg)',
      'KÍCH THƯỚC MẶT NẠ / LỖ KHOÉT TRẦN', 'VỊ TRÍ LẮP ĐẶT', 'GIÁ ĐỠ DÀN NÓNG', 'KHOẢNG CÁCH LẮP ĐẶT TỐI THIỂU', 'GHI CHÚ LẮP ĐẶT'],
    ttc: ['LOẠI MÁY', 'CÔNG SUẤT LẠNH (kW)', 'CÔNG SUẤT (HP)', 'CHẾ ĐỘ VẬN HÀNH', 'MÔI CHẤT LẠNH (GAS)', 'XUẤT XỨ', '@BH'],
    tsk: ['ĐIỆN NGUỒN', 'CÔNG SUẤT ĐIỆN TIÊU THỤ (kW)', 'HIỆU SUẤT NĂNG LƯỢNG (CSPF / EER)', 'KÍCH THƯỚC DÀN LẠNH (R x C x S)', 'KÍCH THƯỚC DÀN NÓNG (R x C x S)']
  };
  var VT = { chinh: ['QUY CÁCH', 'XUẤT XỨ'], hs: [], ket: [], lap: [], ttc: ['QUY CÁCH', '@BH'], tsk: ['XUẤT XỨ'] };

  function hm(M, dong, mau) {
    return { kem: [], loai: M === MAY ? 'may' : 'vt', nhom: M, dong: dong,
      chinh: M.chinh, tk: M.hs.concat(M.ket, M.lap),
      req: M === MAY ? ['LOẠI MÁY', 'CÔNG SUẤT (HP)'] : [], opt: OPT, mau: mau };
  }
  function vd(dong, ten, ma, them) {
    return Object.assign({ 'DÒNG SẢN PHẨM': dong, 'TÊN SẢN PHẨM': ten, 'MÃ SẢN PHẨM': ma, 'ĐƠN VỊ TÍNH': 'Cái' }, them || {});
  }
  var DONG_MAY = ['Máy lạnh treo tường', 'Dàn nóng Multi', 'Dàn lạnh âm trần Cassette Multi', 'Máy lạnh âm trần nối ống gió', 'Máy lạnh tủ đứng', 'Máy lạnh áp trần'];
  /* Hạng mục: theo các nhóm I · II · III của sheet. Tên phải KHÔNG trùng hạng mục ngành khác (ngành đoán theo tên hạng mục). */
  var HM = {
    'Điều hoà không khí': hm(MAY, DONG_MAY, vd('Máy lạnh treo tường', 'Máy lạnh treo tường Inverter 2.0HP', 'DEMO-CU-XU18',
      { 'LOẠI MÁY': 'Treo tường', 'CÔNG SUẤT LẠNH (kW)': '5.6', 'CÔNG SUẤT (HP)': '2', 'CHẾ ĐỘ VẬN HÀNH': '1 chiều lạnh', 'CÔNG NGHỆ MÁY NÉN': 'Inverter',
        'MÔI CHẤT LẠNH (GAS)': 'R32', 'ĐIỆN NGUỒN': '220V / 1 pha / 50Hz', 'XUẤT XỨ': 'Malaysia', 'GIÁ BÁN LẺ': 21900000, 'ĐƠN VỊ TÍNH': 'Bộ' })),
    'Mặt nạ dàn lạnh': hm(VT, ['Mặt nạ dàn lạnh'], vd('Mặt nạ dàn lạnh', 'Mặt nạ dàn lạnh Cassette', 'DEMO-PT-UAHG0',
      { 'QUY CÁCH': '950 x 950 mm', 'XUẤT XỨ': 'Thái Lan', 'GIÁ BÁN LẺ': 1850000, 'ĐƠN VỊ TÍNH': 'Bộ' })),
    'Ống đồng dẫn gas': hm(VT, ['Ống đồng dẫn gas'], vd('Ống đồng dẫn gas', 'Ống đồng dẫn gas Ø9.5', 'DEMO-OD-9.5',
      { 'QUY CÁCH': 'Ø9.5 – dày 0.81mm', 'XUẤT XỨ': 'Thái Lan', 'GIÁ BÁN LẺ': 68000, 'ĐƠN VỊ TÍNH': 'm' })),
    'Cách nhiệt ống đồng': hm(VT, ['Cách nhiệt ống gas'], vd('Cách nhiệt ống gas', 'Cách nhiệt ống gas Ø9.5', 'DEMO-CN-9.5',
      { 'QUY CÁCH': 'Ø9.5 – dày 25mm', 'XUẤT XỨ': 'Malaysia', 'GIÁ BÁN LẺ': 21000, 'ĐƠN VỊ TÍNH': 'm' })),
    'Ống thoát nước ngưng': hm(VT, ['Ống thoát nước'], vd('Ống thoát nước', 'Ống thoát nước D27', 'DEMO-TN-D27',
      { 'QUY CÁCH': 'D27 + gen xám D28 dày 10mm', 'XUẤT XỨ': 'Việt Nam', 'GIÁ BÁN LẺ': 35000, 'ĐƠN VỊ TÍNH': 'm' })),
    'Dây điện nguồn & điều khiển': hm(VT, ['Dây điện nguồn', 'Dây điều khiển'], vd('Dây điện nguồn', 'Dây điện nguồn 3x2.5mm²', 'DEMO-DN-3x2.5',
      { 'QUY CÁCH': 'Đi chung ống đồng', 'XUẤT XỨ': 'Việt Nam', 'GIÁ BÁN LẺ': 42000, 'ĐƠN VỊ TÍNH': 'm' })),
    'Giá đỡ & vật tư phụ điều hoà': hm(VT, ['Giá đỡ dàn nóng', 'Vật tư phụ'], vd('Giá đỡ dàn nóng', 'Giá đỡ dàn nóng sắt V4', 'DEMO-GD-V4',
      { 'QUY CÁCH': 'Sắt V4 hàn', 'GIÁ BÁN LẺ': 350000, 'ĐƠN VỊ TÍNH': 'Bộ' })),
    'Quạt hút / thông gió': hm(VT, ['Quạt hút WC', 'Quạt hút bếp', 'Quạt thông gió'], vd('Quạt hút WC', 'Quạt hút âm trần WC', 'DEMO-FV-24CU9',
      { 'QUY CÁCH': 'Âm trần, ống Ø100', 'XUẤT XỨ': 'Malaysia', 'GIÁ BÁN LẺ': 1450000 })),
    'Ống gió & phụ kiện thông gió': hm(VT, ['Ống gió mềm', 'Louver', 'Chữ Y ống gió', 'Vật tư phụ thông gió'], vd('Ống gió mềm', 'Ống gió mềm không cách nhiệt Ø100', 'DEMO-OG-100',
      { 'QUY CÁCH': 'Ø100', 'XUẤT XỨ': 'Việt Nam', 'GIÁ BÁN LẺ': 30000, 'ĐƠN VỊ TÍNH': 'm' }))
  };
  var HANG_MUC = Object.keys(HM);

  function bo_dau(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function chuanHM(v) {
    var k = bo_dau(v); if (!k) return '';
    for (var i = 0; i < HANG_MUC.length; i++) if (bo_dau(HANG_MUC[i]) === k) return HANG_MUC[i];
    return '';
  }
  // Hạng mục ghi CHUNG ("Điện lạnh", "Điều hoà", "Máy lạnh", "Thông gió"…) chứ không phải 1 hạng mục con -> vẫn là ngành dl
  function laChung(v) { var k = bo_dau(v); return !!k && !chuanHM(v) && /(dien lanh|dieu hoa|may lanh|thong gio|hvac)/.test(k); }
  // Đoán hạng mục con theo TÊN SP (cụ thể trước, chung sau)
  var DOAN = [
    [/mat na|panel/, 'Mặt nạ dàn lạnh'],
    [/cach nhiet/, 'Cách nhiệt ống đồng'],
    [/thoat nuoc|nuoc ngung/, 'Ống thoát nước ngưng'],
    [/ong dong|dan gas|ong gas/, 'Ống đồng dẫn gas'],
    [/day dien|day nguon|day dieu khien|cap dien/, 'Dây điện nguồn & điều khiển'],
    [/quat/, 'Quạt hút / thông gió'],
    [/ong gio|louver|chu y|cua gio|mieng gio/, 'Ống gió & phụ kiện thông gió'],
    [/gia do|vat tu phu|van chuyen|ty treo/, 'Giá đỡ & vật tư phụ điều hoà']
  ];
  function doanHM(h, ten) {
    var c = chuanHM(h); if (c) return c;
    var t = bo_dau(ten);
    for (var i = 0; i < DOAN.length; i++) if (DOAN[i][0].test(t)) return DOAN[i][1];
    return 'Điều hoà không khí';
  }
  function hmOf(v) { return HM[chuanHM(v)] || null; }
  var ALL = Object.keys(METRIC);
  function labelsOf(v) { var h = hmOf(v); return h ? h.chinh.concat(h.tk) : ALL.slice(); }
  function gom(k) {
    var out = [];
    HANG_MUC.forEach(function (x) { HM[x][k].forEach(function (lb) { if (out.indexOf(lb) < 0) out.push(lb); }); });
    return out;
  }
  var CHINH_ALL = gom('chinh'), TK_ALL = gom('tk').filter(function (lb) { return CHINH_ALL.indexOf(lb) < 0; });
  function optsOf(v, lb) { var h = hmOf(v); return (h && h.opt[lb]) || OPT[lb] || []; }
  function isReq(v, lb) { var h = hmOf(v); return !!(h && h.req.indexOf(lb) >= 0); }
  // 1 dòng [nhãn, giá trị] cho bảng / panel; get(col) = giá trị thô của cột DB. '@BH' = thời gian bảo hành.
  function dong(lb, get) {
    if (lb === '@BH') { var bh = String(get('bao_hanh_nam') || '').trim(); return bh && bh !== '0' ? ['Bảo hành', bh + ' năm'] : null; }
    var m = METRIC[lb]; if (!m) return null;
    var v = String(get(m[0]) == null ? '' : get(m[0])).trim();
    return v ? [m[1], v] : null;
  }

  var api = { METRIC: METRIC, HM: HM, HANG_MUC: HANG_MUC, ALL: ALL, CHUNG: CHUNG, OPT: OPT, KHOI: KHOI,
    gom: gom, CHINH_ALL: CHINH_ALL, TK_ALL: TK_ALL,
    chuanHM: chuanHM, laChung: laChung, doanHM: doanHM, hmOf: hmOf, labelsOf: labelsOf, optsOf: optsOf, isReq: isReq, dong: dong,
    MUC: 'Điện lạnh',                             // tên đề mục 3.2.7 trên cây
    TEN: 'ĐIỆN LẠNH', VD: '[VÍ DỤ]' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DL_SPEC = api;
})(typeof window !== 'undefined' ? window : this);
