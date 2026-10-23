/* Tài liệu báo giá (các trang A4 ngang) - port nguyên văn PUB/baogia.js, chuỗi HTML như bản gốc:
     bgBuildPages 133-245 · bgMetaTrang_ 248-252 · bgCoverPage_ 254-298 · bgDocCols_ 300-312 · bgColg_ / bgTh_ 323-340
     bgPerRows_ 395 · bgDocAlign_ / bgDocCell_ 407-433 · bgSecRow_ 440-447 · bgPTCols_ / bgPTCell_ 469-494
     bgTongKetHTML_ 1102-1123 · bgExportCols_ 876-883
   S.* của bản gốc thành tham số:
     ctx = ngữ cảnh lib/quote.js {cur, lines, cover, bgCfg, bgNodes, phanTho, ptVat, congTy, bgOrg}
     ui  = {cols, colOrder, nganh, bgColOrder, bgColW, coverMau, perSec, per}  (S.cols / S.colOrder / vsFltNganh_() /
           S.bgColOrder / S.bgColW / S.coverMau / bgPerSec_() / S.bgPer)
     me  = người đang đăng nhập (ô ký "Người lập"), ver = bgVerInfo_()
   Khác bản gốc: tên class tài liệu đổi qua docClass_ (PLAN 1.8, không đụng .qs-page của trang QS); ảnh và logo dùng URL
   tuyệt đối tới máy chủ Go (mediaUrl); đầu cột không gắn onclick nội tuyến (kéo / chỉnh rộng xử lý ở QuotePreview). */
import { esc, money, ptQty } from '../../lib/format.js'
import { giaDaiLy_, donGiaCK_, ttBan_, lnVnd_, markup_, margin_ } from '../../lib/calc.js'
import { nodeName } from '../../lib/tree.js'
import { visCols } from '../../lib/columns.js'
import {
  coverCosts, coverDepth, coverSortFn, coverHasChild, bgHidden, bgLines_, bgPTSecs_, bgOrg_, bgOpt_, bgTong_, bgTongKetData_,
  docSoVN_, fmtVN_, bgNoiBoXuat_, BG_NOI_BO, bgDocW_,
} from '../../lib/quote.js'
import { API_BASE } from '../../api/http'
import { mediaUrl } from '../../api/files'

export const ROMAN_ = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV']

/* Tên class tài liệu: .qs-page -> .qsd-pg, .qs-doc -> .qsd-doc, các class chung (qx-*, qp-*, qc-*, qd*, qsum*, qpager, qpg*,
   qxrsz, qxth) thêm tiền tố qsd- (PLAN 1.8 [F1]). Dùng chung cho HTML và CSS nên hai bên luôn khớp. */
const DOC_TOK = /^(qx|qp|qc-|qd|qsum|qpager|qpg)/
export function docClass_(tok) {
  if (tok === 'qs-page') return 'qsd-pg'
  if (tok === 'qs-doc') return 'qsd-doc'
  if (tok === 'qx-page') return 'qsd-qxpg'     // tên mới không được chứa "-page" (selector toàn cục của SiteFlow, F17)
  return DOC_TOK.test(tok) ? 'qsd-' + tok : tok
}
export function docHtml_(html) {
  return html.replace(/class="([^"]*)"/g, (m, c) => 'class="' + c.split(' ').map(docClass_).join(' ') + '"')
}

/* Ảnh / logo trên tài liệu: luôn là URL tuyệt đối (bản in mở trong cửa sổ about:blank) [F20] */
export function docImg_(v) {
  v = String(v || '').trim()
  if (!v) return ''
  if (v.charAt(0) === '/' && v.charAt(1) !== '/') return API_BASE + v
  if (/^(https?:|data:image\/|blob:)/i.test(v)) return v
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return '#'
  return mediaUrl(v)
}
function imgSrc1_(v) { return docImg_(String(v || '').split('\n')[0].trim()) }

/* ---- Cột của bảng chi tiết trong tài liệu = đúng các chip cột đang bật ---- */
export function bgDocCols_(ctx, ui) {
  const nb = bgNoiBoXuat_(ctx.bgCfg)
  let vis = visCols(ui.colOrder, ui.cols, ui.nganh).filter(function (c) { return c[0] !== 'stt' && c[0] !== 'taiLieu' && (nb || !BG_NOI_BO[c[0]]) })
  if (!vis.length) vis = [['ten', 'Tên sản phẩm'], ['soLuong', 'Số lượng'], ['donGiaCK', 'Đơn giá'], ['thanhTien', 'Thành tiền']]
  const ord = ui.bgColOrder || []
  if (ord.length) {
    const by = {}; vis.forEach(function (c) { by[c[0]] = c })
    const out = []; ord.forEach(function (k) { if (by[k]) { out.push(by[k]); delete by[k] } })
    vis.forEach(function (c) { if (by[c[0]]) out.push(c) })
    vis = out
  }
  return vis
}
export function bgDocTongW_(cols, sttW, bgColW) { return (sttW || 0) + cols.reduce(function (a, c) { return a + bgDocW_(c[0], bgColW) }, 0) }
export function bgColg_(cols, sttW, bgColW) {
  sttW = (sttW == null ? 30 : sttW)
  const tong = bgDocTongW_(cols, sttW, bgColW); const pc = function (w) { return (w / tong * 100).toFixed(3) + '%' }
  return '<colgroup>' + (sttW ? '<col style="width:' + pc(sttW) + '">' : '')
    + cols.map(function (c) { return '<col style="width:' + pc(bgDocW_(c[0], bgColW)) + '">' }).join('') + '</colgroup>'
}
/* Đầu cột trên trang xem trước: kéo để đổi vị trí · kéo mép phải để chỉnh rộng (tay kéo .qxrsz ẩn khi in) */
export function bgTh_(cols, khongDoiChoCot) {
  return '<tr class="qx-h"><th class="ct">STT</th>'
    + cols.map(function (c) {
      const keo = khongDoiChoCot ? '' : ' draggable="true"'
      return '<th class="' + bgDocAlign_(c[0]) + '" data-k="' + esc(c[0]) + '"' + keo
        + ' title="' + (khongDoiChoCot ? 'Kéo mép phải để chỉnh rộng' : 'Kéo để đổi vị trí cột · kéo mép phải để chỉnh rộng') + '">'
        + '<span class="qxth">' + esc(String(c[1]).toUpperCase()) + '</span>'
        + '<span class="qxrsz" data-k="' + esc(c[0]) + '"></span></th>'
    }).join('') + '</tr>'
}
export function bgPerRows_(per, coAnh) { const v = Number(per) || 0; return v > 0 ? v : (coAnh ? 8 : 13) }
export function bgDocAlign_(k) {
  if (['soLuong', 'giaNCC', 'giaDaiLy', 'donGia', 'donGiaCK', 'lnVnd', 'thanhTien', 'kl', 'dg', 'tt', 'dgnt', 'ttnt'].indexOf(k) >= 0) return 'num'
  if (['hinhAnh', 'dvt', 'chietKhau', 'lnPct', 'ckKhach', 'markup', 'margin', 'maBanVe', 'nganh'].indexOf(k) >= 0) return 'ct'
  return ''
}
export function bgDocCell_(l, k) {
  switch (k) {
    case 'hinhAnh': return l.hinhAnh ? ('<img class="qx-img" src="' + esc(imgSrc1_(l.hinhAnh)) + '" onerror="this.style.display=\'none\'">') : ''
    case 'ten': return '<b>' + esc(l.ten || '') + '</b>' + (l.maSP ? '<span class="qx-ma">' + esc(l.maSP) + '</span>' : '')
    case 'moTa': return '<span class="qx-desc">' + esc(l.moTa || '') + '</span>'
    case 'kichThuoc': return '<span class="qx-desc">' + esc(l.kichThuoc || '') + '</span>'
    case 'giaNCC': return money(l.donGiaVon)
    case 'giaDaiLy': return money(giaDaiLy_(l))
    case 'donGia': return l.donGiaBan ? money(l.donGiaBan) : ''
    case 'donGiaCK': return money(donGiaCK_(l))
    case 'lnVnd': return money(lnVnd_(l))
    case 'thanhTien': return ttBan_(l) ? money(ttBan_(l)) : '-'
    case 'markup': return markup_(l) + '%'
    case 'margin': return margin_(l) + '%'
    case 'chietKhau': return (Number(l.chietKhau) || 0) + '%'
    case 'lnPct': return (Number(l.lnPct) || 0) + '%'
    case 'ckKhach': return (Number(l.ckKhach) || 0) + '%'
    case 'soLuong': return String(Number(l.soLuong) || 0)
    case 'nganh': return esc((l.extra && l.extra.nganh) || '')
    default: return esc(l[k] == null ? '' : String(l[k]))
  }
}
/* Dòng tiêu đề nhóm: số tiền đặt vào ĐÚNG cột Thành tiền */
export function bgSecRow_(cols, nhan, tien, keyTT) {
  const ks = cols.map(function (c) { return c[0] })
  let iTT = ks.indexOf(keyTT); if (iTT < 0) iTT = ks.length - 1
  const truoc = Math.max(1, iTT); const sau = ks.length - truoc - 1
  return '<tr class="sec"><td class="ct"></td><td colspan="' + truoc + '">' + nhan + '</td>'
    + '<td class="num">' + (tien ? money(tien) : '-') + '</td>'
    + (sau > 0 ? '<td colspan="' + sau + '"></td>' : '') + '</tr>'
}
/* Cột bảng phần thô đi theo chip cột đang bật; giá nhà thầu chỉ in khi "xuất kèm cột nội bộ" */
export function bgPTCols_(secs, ctx, ui) {
  const on = {}; visCols(ui.colOrder, ui.cols, ui.nganh).forEach(function (c) { on[c[0]] = 1 })
  const coGC = (secs || []).some(function (s) { return s.items.some(function (it) { return String(it.gc || '').trim() }) })
  const cols = [['n', 'Nội dung công việc']]
  cols.push(['dvt', 'ĐVT'])
  cols.push(['kl', 'Khối lượng'])
  const nt = bgNoiBoXuat_(ctx.bgCfg) && (on.giaNCC || on.giaDaiLy)
  if (nt) cols.push(['dgnt', 'Đơn giá (nhà thầu)'])
  if (nt) cols.push(['ttnt', 'Thành tiền (nhà thầu)'])
  cols.push(['dg', 'Đơn giá'])
  cols.push(['tt', 'Thành tiền'])
  if (coGC) cols.push(['gc', 'Ghi chú'])
  return cols
}
export function bgPTCell_(it, k) {
  switch (k) {
    case 'n': return '<b>' + esc(it.n || '') + '</b>'
    case 'kl': return it.kl ? ptQty(it.kl) : ''
    case 'dg': return it.dg ? money(it.dg) : ''
    case 'tt': return it.tt ? money(it.tt) : '-'
    case 'dgnt': return it.dgnt ? money(it.dgnt) : ''
    case 'ttnt': return it.ttnt ? money(it.ttnt) : ''
    case 'gc': return '<span class="qx-desc">' + esc(it.gc || '') + '</span>'
    default: return esc(it[k] == null ? '' : String(it[k]))
  }
}
/* Số dòng dữ liệu (bỏ dòng tiêu đề nhóm / dòng tổng) và tổng tiền của đúng những dòng đó trên 1 trang */
export function bgMetaTrang_(ten, tienDs) {
  let n = 0; let t = 0
  ;(tienDs || []).forEach(function (v) { if (v == null) return; n++; t += Number(v) || 0 })
  return { ten: ten, dong: n, tien: t }
}

/* ---- Tờ bìa cho TRANG 1 (chỉ đọc, theo Mẫu 1 / Mẫu 2) ---- */
export function bgCoverPage_(comp, ctx, coverMau) {
  const cost = comp.cost; const total = comp.total
  const rows = (ctx.cover || []).filter(function (c) { return !bgHidden(c.stt, ctx.bgCfg) }).slice().sort(coverSortFn)
  if (!rows.length) return '<div class="qx-secttl">CHI TIẾT CÁC HẠNG MỤC</div>'
    + '<div class="qsum-card"><table class="qsum"><tr><td class="nm" style="color:#94a3b8;padding:16px 0">Chưa có tờ bìa — sang chế độ <b>Chỉnh sửa</b> bấm “↻ Nạp mẫu”.</td></tr></table></div>'
  const m1 = (coverMau === 'm1')
  let body
  if (m1) {
    // Mẫu 1: gộp theo mục lớn (một ô HẠNG MỤC dùng chung cho các dòng con)
    const secs = rows.filter(function (c) { return coverDepth(c.stt) === 1 })
    body = secs.map(function (sec) {
      let kids = rows.filter(function (c) { return c.stt !== sec.stt && String(c.stt).indexOf(sec.stt + '.') === 0 })
      if (!kids.length) kids = [sec]
      return kids.map(function (c, ki) {
        const val = cost[c.stt] || 0; const pct = total > 0 ? (val / total * 100) : 0
        const lead = ki === 0 ? '<td class="ct" rowspan="' + kids.length + '">' + esc(sec.stt) + '</td>'
          + '<td class="hm" rowspan="' + kids.length + '">' + esc(sec.hangMuc || '') + '</td>' : ''
        // mục CÓ CON (vd 3.2) là dòng cộng gộp của các mục dưới nó: in đậm; mục con thụt vào + chữ nhạt hơn
        const gop = c !== sec && coverHasChild(ctx.cover, c.stt); const sau = Math.max(0, coverDepth(c.stt) - 2)
        return '<tr>' + lead + '<td style="' + (sau ? 'padding-left:' + (8 + sau * 14) + 'px;color:#5b6b7b' : '') + (gop ? ';font-weight:700' : '') + '">' + esc(c === sec ? '' : (c.hangMuc || '')) + (gop ? ' <i style="font-weight:400;color:#94a3b8">(gồm các mục dưới)</i>' : '') + '</td>'
          + '<td class="num" style="' + (gop ? 'font-weight:700' : (sau ? 'color:#5b6b7b' : '')) + '">' + money(val) + '</td><td class="num" style="' + (sau ? 'color:#5b6b7b' : '') + '">' + pct.toFixed(2) + '%</td>'
          + '<td class="it">' + esc(c.moTa || '') + '</td></tr>'
      }).join('')
    }).join('')
    return '<div class="qx-secttl">CHI TIẾT CÁC HẠNG MỤC</div>'
      + '<table class="qx-tbl qx-cover"><tr class="qx-h"><th class="ct">NO</th><th>HẠNG MỤC</th><th>NỘI DUNG</th>'
      + '<th class="num">CHI PHÍ DỰ KIẾN</th><th class="num">TỶ TRỌNG</th><th>MÔ TẢ</th></tr>'
      + body + '<tr class="sec"><td colspan="3" style="text-align:right"><b>TỔNG CHI PHÍ DỰ KIẾN</b></td>'
      + '<td class="num"><b>' + money(total) + '</b></td><td class="num"><b>100%</b></td><td></td></tr></table>'
  }
  // Mẫu 2: danh sách phẳng phân cấp
  body = rows.map(function (c) {
    const lvl = coverDepth(c.stt); const val = cost[c.stt] || 0; const pct = total > 0 ? (val / total * 100) : 0
    return '<tr class="lv' + lvl + '"><td class="ct">' + esc(c.stt) + '</td>'
      + '<td>' + esc(c.hangMuc || '') + '</td>'
      + '<td class="num">' + money(val) + '</td><td class="num">' + pct.toFixed(2) + '%</td>'
      + '<td class="it">' + esc(c.moTa || '') + '</td></tr>'
  }).join('')
  return '<div class="qx-secttl">CHI TIẾT CÁC HẠNG MỤC</div>'
    + '<table class="qx-tbl qx-cover"><tr class="qx-h"><th class="ct">NO</th><th>HẠNG MỤC</th>'
    + '<th class="num">CHI PHÍ DỰ KIẾN</th><th class="num">TỶ TRỌNG</th><th>MÔ TẢ</th></tr>'
    + body + '<tr class="sec"><td colspan="2" style="text-align:right"><b>TỔNG CHI PHÍ DỰ KIẾN</b></td>'
    + '<td class="num"><b>' + money(total) + '</b></td><td class="num"><b>100%</b></td><td></td></tr></table>'
}

/* ---- Hộp tổng + tiến độ thanh toán + ghi chú + ô ký (trang cuối) ---- */
export function bgTongKetHTML_(q, org, ctx, me) {
  const o = bgOpt_(ctx.bgCfg)
  function row(nhan, tien, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td class="lbl">' + nhan + '</td><td class="num">' + money(tien) + ' đ</td></tr>' }
  const tot = '<table class="qx-tbl qx-totbox"><colgroup><col style="width:74%"><col style="width:26%"></colgroup>'
    + row('TỔNG CỘNG:', q.sub)
    + (q.ck ? row('CHIẾT KHẤU' + (o.ckKieu === 'pct' ? ' ' + o.ck + '%' : '') + ':', -q.ck) + row('SAU CHIẾT KHẤU:', q.sau) : '')
    + row('VAT ' + q.vatPct + '%:', q.vat) + row('THÀNH TIỀN SAU THUẾ:', q.total, 'grand') + '</table>'
    + '<div class="qx-bangchu"><i>Bằng chữ:</i> <b>' + esc(docSoVN_(q.total)) + '</b></div>'
  // chữ / số của khối tổng kết: cùng một hàm với opts.tongKet của file Excel (M8.1)
  const tk = bgTongKetData_(q, ctx.bgCfg, me)
  const tt = tk.dot.length ? '<div class="qx-dot"><div class="h">Tiến độ thanh toán</div><table><tr><th>Đợt</th><th>Nội dung</th><th class="num">Tỷ lệ</th><th class="num">Số tiền</th></tr>'
    + tk.dot.map(function (d, i) { return '<tr><td>' + (i + 1) + '</td><td>' + esc(d.noiDung) + '</td><td class="num">' + d.pct + '%</td><td class="num">' + money(d.soTien) + ' đ</td></tr>' }).join('')
    + '</table></div>' : ''
  const notes = '<div class="qx-notes"><div class="h">Ghi chú & điều khoản:</div><ol>' + tk.ghiChu.map(function (x) { return '<li>' + esc(x) + '</li>' }).join('') + '</ol></div>'
  const nguoi = tk.nguoi
  const sign = '<div class="qx-sign"><div class="col"><div class="hd">KHÁCH HÀNG / CUSTOMER</div><div class="sp"></div>'
    + '<div class="nm">' + esc((ctx.cur && ctx.cur.khachHang) || '') + '</div></div>'
    + '<div class="col"><div class="hd">' + esc(String(org.ten).toUpperCase()) + '</div><div class="sp"></div>'
    + '<div class="nm">' + (nguoi ? 'Người lập: ' + esc(nguoi) : '') + '</div></div></div>'
  return tot + tt + notes + sign
}

/* Dựng danh sách trang: [tờ bìa] + [các trang chi tiết] + [phần thô] (+ trang "Tổng kết" khi trang cuối đã quá nửa).
   Trả [{html, meta:{trang, ten, dong, tien}}]; html đã đổi tên class (docHtml_). */
/* Các mục thông tin dự án trên tờ bìa — lấy đúng các ô của hộp "Thông tin dự án" (Bảng điều khiển), cùng tên + thứ tự;
   in theo cặp 2 cột. BG_TT_MAC = các mục hiện sẵn (như tờ bìa cũ) */
export const BG_TT_DS = [['ten', 'Tên dự án'], ['kh', 'Khách hàng'], ['sdt', 'Số điện thoại'], ['dc', 'Địa chỉ'], ['ma', 'Mã báo giá'],
  ['qm', 'Quy mô'], ['dt', 'Tổng DT XD'], ['dtbg', 'DT báo giá'], ['nc', 'Nhu cầu'], ['pc', 'Phân khúc'], ['ht', 'Hiện trạng'], ['gc', 'Ghi chú']]
export const BG_LOGO_MIN = 20
export const BG_LOGO_MAX = 72
export const BG_TT_MAC = ['kh', 'ht', 'ten', 'qm', 'dt', 'nc', 'pc', 'dtbg']
/* Tuỳ chọn tờ bìa trong bgCfg: logo 'cty' (logo công ty, mặc định) | 'tao' (đang tạo logo); logoAn = true: ẩn logo (bia.logo = 'an');
   taoKieu: 'anh' (Logo ảnh: ảnh tải lên logoAnh) | 'chu' (Logo chữ: logoChu + kiểu chữ lc*) — chọn 1 trong 2;
   bản cũ lưu logo 'anh' (ảnh riêng) / 'chu' (chỉ tên) -> 'tao' với taoKieu tương ứng;
   logoCo nho / vua / lon; ttCty (địa chỉ, liên hệ công ty, mặc định bật);
   tdTen (chữ tiêu đề), tdHm / tdMa (dòng hạng mục / dòng mã-ngày, mặc định bật), tdHmTen (chữ dòng hạng mục), tdSo (cỡ chữ khung tiêu đề, mặc định 12); hienTT = mục thông tin hiện trên bìa */
const TD_CO = [['tdCo1', 12.5], ['tdCo2', 11], ['tdCo3', 10]]
export const TD_CO_MIN = 6
export const TD_CO_MAX = 48
const fontOk_ = v => (/^[A-Za-z0-9 ,'-]{1,80}$/.test(v || '') ? v : '')
function tdCo_(c) {
  const tk = (Number(c.tdSo) >= 8 && Number(c.tdSo) <= 24 ? Number(c.tdSo) : 12) / 12
  const o = { tdFont1: fontOk_(c.tdFont1), tdFont2: fontOk_(c.tdFont2) }
  TD_CO.forEach(([k, px]) => { o[k] = Number(c[k]) >= TD_CO_MIN && Number(c[k]) <= TD_CO_MAX ? Number(c[k]) : Math.round(px * tk * 10) / 10 })
  return o
}
export function bgBia_(bgCfg) {
  const c = bgCfg || {}
  return {
    /* logoAn: ẩn logo (bản cũ lưu logo 'an') — c.logo (tab Công ty / Tạo logo) giữ nguyên nên ẩn rồi hiện lại về đúng tab cũ */
    logo: c.logoAn === true || c.logo === 'an' ? 'an' : (['tao', 'anh', 'chu'].indexOf(c.logo) >= 0 ? 'tao' : 'cty'), logoAnh: String(c.logoAnh || ''),
    taoKieu: c.taoKieu === 'anh' || c.taoKieu === 'chu' ? c.taoKieu : (c.logo === 'chu' ? 'chu' : 'anh'),
    /* logoChon: logo chọn trong 3 logo gần nhất ở chế độ Công ty (trống = logo của Thông tin công ty);
       logoChu: chữ hiện ở chế độ Chỉ tên (trống = tên công ty) */
    logoChon: String(c.logoChon || ''), logoChu: String(c.logoChu || ''),
    /* kiểu chữ của chế độ Chỉ tên: font ('' = font báo giá), màu ('' = màu tiêu đề), đậm (mặc định bật), nghiêng, giãn chữ (em, -0,1–0,5, mặc định .16) */
    /* thông tin công ty dưới logo: ttKieu 'chung' (mẫu chung bgOrg / công ty) | 'rieng' (tự nhập ttRieng {diaChi, sdt, email, web, xuong}) */
    ttKieu: c.ttKieu === 'rieng' ? 'rieng' : 'chung',
    ttRieng: c.ttRieng && typeof c.ttRieng === 'object' ? Object.fromEntries(['diaChi', 'sdt', 'email', 'web', 'xuong']
      .filter(k => String(c.ttRieng[k] || '').trim()).map(k => [k, String(c.ttRieng[k]).trim()])) : {},
    lcFont: /^[A-Za-z0-9 ,'-]{1,80}$/.test(c.lcFont || '') ? c.lcFont : '', lcMau: /^#[0-9a-f]{6}$/i.test(c.lcMau || '') ? c.lcMau : '',
    lcDam: c.lcDam !== false, lcNghieng: !!c.lcNghieng,
    /* cỡ chữ Logo chữ (px, 1–100); chưa đặt thì theo Cỡ logo như trước (46px ứng với chữ 26px) */
    lcCo: Number(c.lcCo) >= 1 && Number(c.lcCo) <= 100 ? Math.round(Number(c.lcCo))
      : Math.round((Number(c.logoPx) >= BG_LOGO_MIN && Number(c.logoPx) <= BG_LOGO_MAX ? Number(c.logoPx) : ({ nho: 34, vua: 46, lon: 64 }[c.logoCo] || 46)) * 26 / 46),
    lcGian: c.lcGian !== '' && c.lcGian != null && Number(c.lcGian) >= -0.1 && Number(c.lcGian) <= 0.5 ? Number(c.lcGian) : 0.16,
    logoCo: ['nho', 'vua', 'lon'].indexOf(c.logoCo) >= 0 ? c.logoCo : 'vua',
    /* chiều cao logo (px) chỉnh bằng thanh kéo BG_LOGO_MIN–MAX, mặc định giữa = 46; bản cũ lưu logoCo nhỏ / vừa / lớn */
    logoPx: Number(c.logoPx) >= BG_LOGO_MIN && Number(c.logoPx) <= BG_LOGO_MAX ? Number(c.logoPx) : ({ nho: 34, vua: 46, lon: 64 }[c.logoCo] || 46),
    tenCty: !!c.tenCty, ttCty: c.ttCty !== false,
    /* vị trí logo: 'trai' | 'giua' | 'phai' (hàng trên cùng của tờ bìa) */
    logoVt: ['trai', 'giua', 'phai'].indexOf(c.logoVt) >= 0 ? c.logoVt : 'trai',
    /* dòng thứ 3 của khung tiêu đề tách riêng 3 mục (bản cũ tdMa = false thì tắt cả 3) */
    tdMaBG: c.tdMaBG != null ? c.tdMaBG !== false : c.tdMa !== false, tdPB: c.tdPB != null ? c.tdPB !== false : c.tdMa !== false,
    tdNgay: c.tdNgay != null ? c.tdNgay !== false : c.tdMa !== false,
    /* dòng thông tin thêm do người dùng tự đặt: [{k: nhãn, v: giá trị}] (vd. Nhân viên phụ trách báo giá, Chủ trì thiết kế) */
    ttThem: Array.isArray(c.ttThem) ? c.ttThem.filter(x => x && (x.k || x.v)) : [],
    tdTen: String(c.tdTen || ''), tdHm: c.tdHm !== false,
    tdHmTen: String(c.tdHmTen || ''), tdSo: Number(c.tdSo) >= 8 && Number(c.tdSo) <= 24 ? Number(c.tdSo) : 12,
    /* cỡ chữ (px) + font riêng từng dòng khung tiêu đề: 1 = chữ tiêu đề, 2 = dòng hạng mục, 3 = dòng mã / phiên bản / ngày;
       chưa đặt thì theo tdSo cũ (12,5 / 11 / 10 px nhân tdSo / 12) */
    ...tdCo_(c),
    /* hienTT = các mục đang hiện; bản cũ lưu anTT (mục ẩn) thì đổi sang danh sách hiện */
    hienTT: Array.isArray(c.hienTT) ? c.hienTT : BG_TT_MAC.filter(k => !(Array.isArray(c.anTT) && c.anTT.indexOf(k) >= 0)),
  }
}
export function bgBuildPages(ctx, ui, ver, me) {
  const p = ctx.cur || {}; const comp = coverCosts(ctx)
  const inners = []; const metas = []
  function themTrang(html, meta) { inners.push(html); metas.push(meta || {}) }
  const hangMuc = 'TỔNG HỢP CHI PHÍ'                // trang 1 luôn là tờ bìa của cả dự án
  const org = bgOrg_(ctx.congTy, ctx.bgOrg); const opt = bgOpt_(ctx.bgCfg)
  /* Tuỳ chọn tờ bìa (bgCfg, thẻ "Logo" + "Trang bìa"): logo, khung tiêu đề, các mục thông tin dự án hiện trên bìa */
  const cf = bgBia_(ctx.bgCfg)
  const logoCty = cf.logoChon || org.logo
  const tao = cf.logo === 'tao'
  const taoChu = tao && cf.taoKieu === 'chu'
  const logoSrc = tao ? (cf.taoKieu === 'anh' ? cf.logoAnh || '' : '') : (cf.logo === 'cty' && logoCty ? docImg_(logoCty) : '')
  const tenLogo = taoChu && cf.logoChu.trim() ? cf.logoChu.trim() : org.ten
  /* logo đã lưu (logoChon) / Logo ảnh là logo trọn vẹn: không in thêm tên công ty bên dưới */
  const anTen = !!logoSrc && (tao || !!cf.logoChon)
  const lcCss = (cf.lcFont ? ';font-family:' + esc(cf.lcFont) + ', Arial, sans-serif' : '') + (cf.lcMau ? ';color:' + cf.lcMau : '')
    + ';font-weight:' + (cf.lcDam ? 700 : 400) + (cf.lcNghieng ? ';font-style:italic' : '') + ';letter-spacing:' + cf.lcGian + 'em'
  const logoH = cf.logoPx
  /* dòng thông tin công ty: tự nhập thì in đúng các ô đã điền (cùng cách ghép như bgOrg_), không thì mẫu chung */
  const tr = cf.ttRieng
  const ttLines = cf.ttKieu === 'rieng'
    ? [tr.diaChi, [tr.sdt ? 'ĐT: ' + tr.sdt : '', tr.email ? 'Email: ' + tr.email : ''].filter(Boolean).join('   '), tr.xuong, tr.web ? 'Website: ' + tr.web : ''].filter(Boolean)
    : org.lines
  const brandbox = cf.logo === 'an' ? ''
    : '<div class="qx-brandbox" style="display:flex;flex-direction:column;align-items:' + ({ trai: 'flex-start', giua: 'center', phai: 'flex-end' }[cf.logoVt])
      + ';text-align:' + ({ trai: 'left', giua: 'center', phai: 'right' }[cf.logoVt]) + '">'
      + (logoSrc ? '<img class="qx-logo" style="max-height:' + logoH + 'px;max-width:' + Math.round(logoH * 4.2) + 'px" src="' + esc(logoSrc) + '" alt="">' : '')
      /* không có ảnh logo: tên công ty là logo -> cỡ chữ theo thanh kéo Cỡ logo (mặc định 46px ứng với chữ 26px của docCss) */
      /* Logo chữ: kiểu chữ tự chỉnh (lcCss) */
      + (anTen ? '' : '<div class="qx-brand' + (logoSrc ? ' sm' : '') + '"'
        + (logoSrc ? '' : ' style="font-size:' + (taoChu ? cf.lcCo : Math.round(logoH * 26 / 46 * 10) / 10) + 'px' + (taoChu ? lcCss : '') + '"') + '>' + esc(tenLogo) + '</div>')
      + (cf.ttCty && ttLines.length ? '<div class="qx-org">' + ttLines.map(esc).join('<br>') + '</div>' : '') + '</div>'
  /* Khung tiêu đề luôn mở rộng hết phần còn lại của đầu trang (.qx-head.rong); cỡ chữ theo số tdSo (mặc định 12) */
  const fz = (px, font) => ' style="font-size:' + px + 'px' + (font ? ';font-family:' + esc(font) + ', Arial, sans-serif' : '') + '"'
  const t3 = [cf.tdMaBG && ('Mã: <b>' + esc(ver.ma) + '</b>'), cf.tdPB && esc(ver.nhan), cf.tdNgay && ('Ngày ' + esc(fmtVN_(opt.ngay)))].filter(Boolean)
  const decoxHead = '<div class="qx-head rong">' + brandbox
    + '<div class="qx-titlebox"><div class="t1"' + fz(cf.tdCo1, cf.tdFont1) + '>' + esc(cf.tdTen || 'BẢNG ƯỚC TÍNH CHI PHÍ DỰ ÁN') + '</div>'
      + (cf.tdHm ? '<div class="t2"' + fz(cf.tdCo2, cf.tdFont2) + '>' + esc(cf.tdHmTen || ('HẠNG MỤC: ' + String(hangMuc).toUpperCase())) + '</div>' : '')
      + (t3.length ? '<div class="t3"' + fz(cf.tdCo3) + '>' + t3.join(' · ') + '</div>' : '') + '</div></div>'
  function ip(k, v) { return '<td class="k">' + k + '</td><td class="v">' + v + '</td>' }
  const ttVal = {
    kh: esc(p.khachHang || ''), ten: esc(p.ten || ''), dt: p.tongDT ? esc(p.tongDT + ' m²') : '', pc: esc(p.phanKhuc || ''),
    // Hiện trạng nhập bằng textarea (M8.3): giữ xuống dòng như Excel (service_export_opts.go writeHienTrang)
    ht: esc(p.hienTrang || '').replace(/\r\n?/g, '\n').replace(/\n/g, '<br>'), qm: esc(p.quyMo || ''), nc: esc(p.nhuCau || ''),
    dtbg: p.dtBaoGia ? esc(p.dtBaoGia + ' m²') : '',
    sdt: esc(p.sdt || ''), dc: esc(p.diaChi || ''), ma: esc(p.maBaoGia || ''), gc: esc(p.ghiChu || '').replace(/\r?\n/g, '<br>'),
  }
  cf.ttThem.forEach(function (x, i) { ttVal['them' + i] = esc(x.v || '') })
  const tt = BG_TT_DS.filter(function (x) { return cf.hienTT.indexOf(x[0]) >= 0 })
    .concat(cf.ttThem.map(function (x, i) { return ['them' + i, esc(x.k || '')] }))
  let rowsTT = ''
  for (let i = 0; i < tt.length; i += 2) rowsTT += '<tr>' + ip(tt[i][1], ttVal[tt[i][0]]) + (tt[i + 1] ? ip(tt[i + 1][1], ttVal[tt[i + 1][0]]) : '<td class="k"></td><td class="v"></td>') + '</tr>'
  const infoBlock = tt.length ? '<table class="qx-info">' + rowsTT + '</table>' : ''
  // ===== TRANG 1 = TỜ BÌA (Mẫu 1 hoặc Mẫu 2) =====
  themTrang(decoxHead + infoBlock + bgCoverPage_(comp, ctx, ui.coverMau), { ten: 'Tờ bìa' })
  // ===== Từ trang 2: bảng chi tiết các hạng mục đã bóc được chọn, THEO ĐÚNG CHIP CỘT đang bật =====
  const lines = bgLines_(ctx)
  const cols = bgDocCols_(ctx, ui)
  const coAnh = cols.some(function (c) { return c[0] === 'hinhAnh' })
  const colg = bgColg_(cols, 30, ui.bgColW); const thead = bgTh_(cols)
  const tblCls = 'qx-tbl' + (cols.length >= 15 ? ' qx-dense' : '') + (cols.length >= 20 ? ' qx-dense2' : '')
  function rowHtml(l, ri) {
    return '<tr><td class="ct">' + (ri + 1) + '</td>'
      + cols.map(function (c) { return '<td class="' + bgDocAlign_(c[0]) + '">' + bgDocCell_(l, c[0]) + '</td>' }).join('') + '</tr>'
  }
  function secRow(nhan, tien) { return bgSecRow_(cols, nhan, tien, 'thanhTien') }
  const PER = bgPerRows_(ui.per, coAnh)          // số dòng mỗi trang (tự động: có ảnh 8, không ảnh 13)
  if (ui.perSec) {
    const byNode = {}; const ordN = []
    lines.forEach(function (l) { const c = (l.nhom || '').trim() || '__k'; if (!byNode[c]) { byNode[c] = []; ordN.push(c) } byNode[c].push(l) })
    ordN.forEach(function (code) {
      const its = byNode[code]; const ten = (code === '__k' ? 'KHÁC' : (nodeName(code) || code))
      const secTt = its.reduce(function (a, l) { return a + ttBan_(l) }, 0)
      const flatN = []; const metaN = []; const byF = {}; const ordF = []
      its.forEach(function (l) { const g = (l.tang || '').trim() || 'HẠNG MỤC'; if (!byF[g]) { byF[g] = []; ordF.push(g) } byF[g].push(l) })
      ordF.forEach(function (g, gi) {
        const sub = byF[g].reduce(function (a, l) { return a + ttBan_(l) }, 0)
        flatN.push(secRow((ROMAN_[gi] || (gi + 1)) + '. ' + esc(g), sub)); metaN.push(null)
        byF[g].forEach(function (l, ri) { flatN.push(rowHtml(l, ri)); metaN.push(ttBan_(l)) })
      })
      flatN.push(secRow('<b>TỔNG ' + esc(String(ten).toUpperCase()) + '</b>', secTt)); metaN.push(null)
      for (let q0 = 0; q0 < flatN.length; q0 += PER) {
        themTrang('<div class="qx-secttl">' + esc(String(ten).toUpperCase()) + (q0 ? ' (tiếp)' : '') + '</div>'
          + '<table class="' + tblCls + '">' + colg + thead + flatN.slice(q0, q0 + PER).join('') + '</table>',
        bgMetaTrang_(ten, metaN.slice(q0, q0 + PER)))
      }
    })
  } else {
    const groups = {}; const order = []
    lines.forEach(function (l) { const g = (l.tang || '').trim() || 'HẠNG MỤC'; if (!groups[g]) { groups[g] = []; order.push(g) } groups[g].push(l) })
    const flat = []; const metaF = []
    order.forEach(function (g, gi) {
      const items = groups[g] || []; const sec = items.reduce(function (a, l) { return a + ttBan_(l) }, 0)
      flat.push(secRow((ROMAN_[gi] || (gi + 1)) + '. ' + esc(g), sec)); metaF.push(null)
      items.forEach(function (l, ri) { flat.push(rowHtml(l, ri)); metaF.push(ttBan_(l)) })
    })
    if (flat.length) {
      for (let i = 0; i < flat.length; i += PER) {
        themTrang((i === 0 ? '<div class="qx-secttl">BẢNG BÁO GIÁ CHI TIẾT</div>' : '') + '<table class="' + tblCls + '">' + colg + thead + flat.slice(i, i + PER).join('') + '</table>',
          bgMetaTrang_('Bảng báo giá chi tiết', metaF.slice(i, i + PER)))
      }
    }
  }
  // ===== PHẦN THÔ (3.1) - bảng ước tính riêng, không nằm trong lines =====
  const ptSecs = bgPTSecs_(ctx); let ptTong = 0
  if (ptSecs.length) {
    const pcols = bgPTCols_(ptSecs, ctx, ui)
    const pcolg = bgColg_(pcols, 30, ui.bgColW); const pthead = bgTh_(pcols, true)
    const pSecRow = function (nhan, tien) { return bgSecRow_(pcols, nhan, tien, 'tt') }
    const flatP = []; const metaP = []
    ptSecs.forEach(function (sec, gi) {
      ptTong += Number(sec.tt) || 0
      flatP.push(pSecRow((ROMAN_[gi] || (gi + 1)) + '. ' + esc(String(sec.ten).toUpperCase()), sec.tt)); metaP.push(null)
      sec.items.forEach(function (it, ri) {
        flatP.push('<tr><td class="ct">' + (ri + 1) + '</td>'
          + pcols.map(function (c) { return '<td class="' + bgDocAlign_(c[0]) + '">' + bgPTCell_(it, c[0]) + '</td>' }).join('') + '</tr>')
        metaP.push(Number(it.tt) || 0)
      })
    })
    flatP.push(pSecRow('<b>TỔNG PHẦN THÔ</b>', ptTong)); metaP.push(null)
    for (let qp = 0; qp < flatP.length; qp += PER) {
      themTrang('<div class="qx-secttl">PHẦN THÔ — ƯỚC TÍNH CHI PHÍ XÂY DỰNG' + (qp ? ' (tiếp)' : '') + '</div>'
        + '<table class="qx-tbl">' + pcolg + pthead + flatP.slice(qp, qp + PER).join('') + '</table>',
      bgMetaTrang_('Phần thô', metaP.slice(qp, qp + PER)))
    }
  }
  // ===== Hộp tổng + ghi chú + ô ký: tổng ĐÚNG phạm vi đang xuất =====
  const subBG = lines.reduce(function (a, l) { return a + ttBan_(l) }, 0) + ptTong
  const tong = bgTong_(subBG, ctx.bgCfg, p.vat)
  // trang chi tiết cuối đã quá nửa số dòng / trang -> khối tổng kết sang trang riêng "Tổng kết"
  const cuoi = metas[metas.length - 1] || {}; const PERc = PER
  if (inners.length > 1 && (cuoi.dong || 0) > PERc * 0.5) { inners.push(bgTongKetHTML_(tong, org, ctx, me)); metas.push({ ten: 'Tổng kết' }) } else inners[inners.length - 1] += bgTongKetHTML_(tong, org, ctx, me)
  const N = inners.length
  return inners.map(function (inner, idx) {
    const m = metas[idx] || {}
    // Chân trang: đơn vị - dự án · nội dung trang · SỐ DÒNG · tiền của trang · số trang
    const giua = [m.ten || '', m.dong ? (m.dong + ' dòng') : '', m.dong ? (money(m.tien || 0) + ' đ') : ''].filter(Boolean).join(' · ')
    const foot = '<div class="qp-foot">'
      + '<span>' + esc(org.ten) + ' — ' + esc(p.ten || '') + '</span>'
      + '<span class="qp-mid">' + esc(giua) + '</span>'
      + '<span>Trang ' + (idx + 1) + ' / ' + N + '</span></div>'
    return { html: docHtml_('<div class="qs-page qx-page">' + inner + foot + '</div>'), meta: Object.assign({ trang: idx + 1 }, m) }
  })
}

/* Cột đưa vào file Excel = đúng các chip cột đang bật của bảng Bóc tách (bgExportCols_), xếp theo thứ tự đã kéo trên
   bản xem trước (ui.bgColOrder, như bgDocCols_) và kèm bề rộng đã kéo (w = px của ui.bgColW, chỉ cột đã chỉnh; M8.2).
   Máy chủ chỉ dùng w khi request có opts. */
export function bgExportCols_(ctx, ui) {
  const vis = visCols(ui.colOrder, ui.cols, ui.nganh)
  let cols = vis.map(function (c) { return { key: c[0], label: String(c[1]).toUpperCase() } })
    .filter(function (c) { return c.key !== 'stt' && c.key !== 'taiLieu' && (bgNoiBoXuat_(ctx.bgCfg) || !BG_NOI_BO[c.key]) })
  const ord = ui.bgColOrder || []
  if (ord.length) {
    const by = {}; cols.forEach(function (c) { by[c.key] = c })
    const out = []; ord.forEach(function (k) { if (by[k]) { out.push(by[k]); delete by[k] } })
    cols.forEach(function (c) { if (by[c.key]) out.push(c) })
    cols = out
  }
  const bw = ui.bgColW || {}
  cols = cols.map(function (c) { const n = Number(bw[c.key]); return n > 0 ? Object.assign({}, c, { w: bgDocW_(c.key, bw) }) : c })
  cols.unshift({ key: 'stt', label: 'STT' })
  if (!cols.some(function (c) { return c.key === 'ten' })) cols.splice(1, 0, { key: 'ten', label: 'TÊN SẢN PHẨM' })
  return cols
}
