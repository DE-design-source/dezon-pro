/* ═══ GẠCH ỐP LÁT (đề mục 3.2.4 "Ốp lát") — BỘ THÔNG SỐ THEO HẠNG MỤC (nguồn DUY NHẤT) ═══
   Cùng khuôn với dl-spec.js. Dùng chung cho form Nhập dữ liệu / modal Sửa SP, file mẫu nhập hàng loạt
   (/api/v1/product-templates/gach), server (map cột DB, lọc thông số khi nhập, cột "Thông tin chính" /
   "Thông số thiết kế" của bảng bóc tách) và trang thông tin SP.
   Bộ trường lấy theo file "gạch edit.xlsx" của Dezon:
     · Key Product Info (cột I): đủ 8 thông số + Dòng SP · Hạng mục · Bảo hành
     · THÔNG TIN CHÍNH (cột M): Bề mặt · Xương gạch · Màu sắc / Vân (+ Dòng SP · Hạng mục · Bảo hành do server tự thêm)
     · THÔNG SỐ THIẾT KẾ (cột O): Kích thước · Độ dày · Độ hút nước · Chống trơn · Quy cách đóng hộp
   Nhãn trùng ngành khác trỏ cùng cột: KÍCH THƯỚC (kich_thuoc), BỀ MẶT HOÀN THIỆN (be_mat), ĐỘ DÀY (do_day), MÀU SẮC (mau_sac).
   Cột riêng: bảng product_tile_specs (migration 0032). */
(function (root) {
  'use strict';
  // Nhãn cột (= tiêu đề cột trong file Excel) -> [cột DB, nhãn hiển thị, kiểu, gợi ý nhập]
  var METRIC = {
    'KÍCH THƯỚC':          ['kich_thuoc', 'Kích thước', 'sel', 'VD: 600 x 1200 (mm)'],
    'BỀ MẶT HOÀN THIỆN':   ['be_mat', 'Bề mặt', 'sel', 'VD: Men mờ (Matt)'],
    'XƯƠNG GẠCH':          ['xuong_gach', 'Xương gạch', 'sel', 'VD: Porcelain đồng chất (Granite)'],
    'MÀU SẮC':             ['mau_sac', 'Màu sắc / Vân', 'text', 'VD: Vân đá marble trắng xám'],
    'ĐỘ DÀY':              ['do_day', 'Độ dày', 'text', 'VD: 9 mm'],
    'ĐỘ HÚT NƯỚC':         ['do_hut_nuoc', 'Độ hút nước', 'sel', 'VD: ≤ 0.5%'],
    'CHỐNG TRƠN':          ['chong_tron', 'Chống trơn', 'sel', 'VD: R10'],
    'QUY CÁCH ĐÓNG HỘP':   ['quy_cach_hop', 'Quy cách đóng hộp', 'text', 'VD: 2 viên/hộp – 1.44 m²/hộp']
  };
  var OPT = {
    'KÍCH THƯỚC': ['300 x 300 (mm)', '300 x 600 (mm)', '400 x 800 (mm)', '600 x 600 (mm)', '600 x 1200 (mm)', '800 x 800 (mm)',
      '800 x 1600 (mm)', '1000 x 1000 (mm)', '1200 x 1200 (mm)', '1200 x 2400 (mm)', '150 x 900 (mm)', '200 x 1200 (mm)'],
    'BỀ MẶT HOÀN THIỆN': ['Men mờ (Matt)', 'Men bóng (Glossy)', 'Bán bóng (Semi-polished)', 'Bóng kiếng (Polished)', 'Sần (Structured)',
      'Nhám chống trơn (Grip)', 'Satin'],
    'XƯƠNG GẠCH': ['Porcelain đồng chất (Granite)', 'Porcelain tráng men', 'Ceramic', 'Bán sứ (Semi-porcelain)', 'Gạch nung (Cotto / Terracotta)',
      'Mosaic thuỷ tinh', 'Mosaic gốm', 'Gạch bông xi măng'],
    'ĐỘ HÚT NƯỚC': ['≤ 0.5%', '0.5% – 3%', '3% – 6%', '6% – 10%', '> 10%'],
    'CHỐNG TRƠN': ['R9', 'R10', 'R11', 'R12', 'R13', 'Không công bố']
  };
  // Trường CHUNG của mọi SP gạch — cột nào ngoài CHUNG + thông số của hạng mục đều bị bỏ khi nhập
  var CHUNG = ['THƯƠNG HIỆU', 'NHÀ CUNG CẤP', 'HẠNG MỤC', 'DÒNG SẢN PHẨM', 'NHÓM SẢN PHẨM', 'TÊN SẢN PHẨM', 'MÃ SẢN PHẨM',
    'GIÁ BÁN LẺ', 'CHIẾT KHẤU ĐẠI LÝ (%)', 'TÍNH NĂNG', 'BẢO HÀNH (năm)', 'ĐƠN VỊ TÍNH', 'TRẠNG THÁI',
    'LINK DATASHEET', 'THÔNG SỐ KỸ THUẬT', 'HƯỚNG DẪN CÀI ĐẶT', 'FILE BẢN VẼ', 'GHI CHÚ', 'ẢNH SẢN PHẨM', 'NGÀNH HÀNG'];

  // Khối thông số ở trang thông tin SP / form — "Tiếng Anh|Tiếng Việt"
  var KHOI = [['chinh', 'Key Product Info|Thông tin chính']];
  // Thứ tự cột I của file: Kích thước · Bề mặt · Xương gạch · Màu sắc / Vân · Độ dày · Độ hút nước · Chống trơn · Quy cách đóng hộp
  var NHOM = { chinh: Object.keys(METRIC) };

  /* chinh = cột "Thông tin chính" của bảng bóc tách (cột M), tk = "Thông số thiết kế" (cột O) */
  function hm(dong, mau) {
    return { kem: [], nhom: NHOM, dong: dong,
      chinh: ['BỀ MẶT HOÀN THIỆN', 'XƯƠNG GẠCH', 'MÀU SẮC'],
      tk: ['KÍCH THƯỚC', 'ĐỘ DÀY', 'ĐỘ HÚT NƯỚC', 'CHỐNG TRƠN', 'QUY CÁCH ĐÓNG HỘP'],
      req: ['KÍCH THƯỚC'], opt: OPT, mau: mau };
  }
  function vd(dong, ten, ma, them) {
    return Object.assign({ 'DÒNG SẢN PHẨM': dong, 'TÊN SẢN PHẨM': ten, 'MÃ SẢN PHẨM': ma, 'ĐƠN VỊ TÍNH': 'm²' }, them || {});
  }
  /* Tên hạng mục phải KHÔNG trùng hạng mục ngành khác (ngành đoán theo tên hạng mục). */
  var HM = {
    'Gạch lát nền': hm(['Gạch porcelain lát nền', 'Gạch ceramic lát nền', 'Gạch giả gỗ'], vd('Gạch porcelain lát nền', 'Gạch porcelain lát nền 60x120', 'DEMO-VD-6120-01',
      { 'KÍCH THƯỚC': '600 x 1200 (mm)', 'BỀ MẶT HOÀN THIỆN': 'Men mờ (Matt)', 'XƯƠNG GẠCH': 'Porcelain đồng chất (Granite)',
        'MÀU SẮC': 'Vân đá marble trắng xám', 'ĐỘ DÀY': '9 mm', 'ĐỘ HÚT NƯỚC': '≤ 0.5%', 'CHỐNG TRƠN': 'R10',
        'QUY CÁCH ĐÓNG HỘP': '2 viên/hộp – 1.44 m²/hộp', 'GIÁ BÁN LẺ': 450000 })),
    'Gạch ốp tường': hm(['Gạch ốp tường', 'Gạch ốp nhà tắm', 'Gạch ốp bếp'], vd('Gạch ốp tường', 'Gạch ốp tường 30x60 men bóng', 'DEMO-OT-3060-02',
      { 'KÍCH THƯỚC': '300 x 600 (mm)', 'BỀ MẶT HOÀN THIỆN': 'Men bóng (Glossy)', 'XƯƠNG GẠCH': 'Ceramic',
        'MÀU SẮC': 'Trắng trơn', 'ĐỘ DÀY': '8 mm', 'ĐỘ HÚT NƯỚC': '6% – 10%', 'QUY CÁCH ĐÓNG HỘP': '8 viên/hộp – 1.44 m²/hộp', 'GIÁ BÁN LẺ': 260000 })),
    'Gạch ngoài trời': hm(['Gạch lát sân vườn', 'Gạch ban công', 'Gạch hồ bơi'], vd('Gạch lát sân vườn', 'Gạch lát sân vườn 60x60 dày 20mm', 'DEMO-SV-6060-20',
      { 'KÍCH THƯỚC': '600 x 600 (mm)', 'BỀ MẶT HOÀN THIỆN': 'Nhám chống trơn (Grip)', 'XƯƠNG GẠCH': 'Porcelain đồng chất (Granite)',
        'MÀU SẮC': 'Vân đá xám', 'ĐỘ DÀY': '20 mm', 'ĐỘ HÚT NƯỚC': '≤ 0.5%', 'CHỐNG TRƠN': 'R11', 'QUY CÁCH ĐÓNG HỘP': '2 viên/hộp – 0.72 m²/hộp', 'GIÁ BÁN LẺ': 520000 })),
    'Gạch trang trí / Mosaic': hm(['Gạch mosaic', 'Gạch thẻ', 'Gạch bông'], vd('Gạch mosaic', 'Gạch mosaic thuỷ tinh xanh ngọc', 'DEMO-MS-2525',
      { 'KÍCH THƯỚC': '300 x 300 (mm)', 'BỀ MẶT HOÀN THIỆN': 'Men bóng (Glossy)', 'XƯƠNG GẠCH': 'Mosaic thuỷ tinh',
        'MÀU SẮC': 'Xanh ngọc', 'ĐỘ DÀY': '4 mm', 'QUY CÁCH ĐÓNG HỘP': '11 vỉ/hộp – 1 m²/hộp', 'GIÁ BÁN LẺ': 680000 }))
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
  // Hạng mục ghi CHUNG ("Gạch", "Ốp lát", "Gạch ốp lát", "Sàn gạch"…) chứ không phải 1 hạng mục con -> vẫn là ngành gach
  function laChung(v) { var k = bo_dau(v); return !!k && !chuanHM(v) && /(^| )(gach|op lat)( |$)/.test(k); }
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
    chuanHM: chuanHM, laChung: laChung, hmOf: hmOf, labelsOf: labelsOf, optsOf: optsOf, isReq: isReq, dong: dong,
    MUC: 'Ốp lát',                                // tên đề mục 3.2.4 trên cây
    TEN: 'GẠCH ỐP LÁT', VD: '[VÍ DỤ]' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GACH_SPEC = api;
})(typeof window !== 'undefined' ? window : this);
