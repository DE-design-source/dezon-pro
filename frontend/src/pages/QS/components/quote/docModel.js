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
  coverCosts, coverDepth, coverSortFn, coverHasChild, bgHidden, bgSoLaiOn_, coverSoLai_, bgLines_, bgPTSecs_, bgOrg_, bgOpt_, bgTong_, bgVatParts_, vatOf_, bgTongKetData_,
  docSoVN_, fmtVN_, bgNoiBoXuat_, BG_NOI_BO, bgDocW_,
} from '../../lib/quote.js'
import { API_BASE } from '../../api/http'
import { mediaUrl } from '../../api/files'
import { bgChu_ } from './docCss'

export const ROMAN_ = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV']

/* Tên class tài liệu: .qs-page -> .qsd-pg, .qs-doc -> .qsd-doc, các class chung (qx-*, qp-*, qc-*, qd*, qsum*, qpager, qpg*,
   qxrsz, qxth) thêm tiền tố qsd- (PLAN 1.8 [F1]). Dùng chung cho HTML và CSS nên hai bên luôn khớp.
   Biểu thức nằm TRONG hàm: docCss.js (nhập vòng với file này) gọi docClass_ ngay lúc nạp, khi hằng cấp module chưa khởi tạo. */
export function docClass_(tok) {
  if (tok === 'qs-page') return 'qsd-pg'
  if (tok === 'qs-doc') return 'qsd-doc'
  if (tok === 'qx-page') return 'qsd-qxpg'     // tên mới không được chứa "-page" (selector toàn cục của SiteFlow, F17)
  return /^(qx|qp|qc-|qd|qsum|qpager|qpg)/.test(tok) ? 'qsd-' + tok : tok
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
/* Cột riêng từng hạng mục (bgCfg.colHm = {mã hạng mục (l.nhom): {khoá cột: true}}): hạng mục chưa đặt riêng dùng chip cột chung (ui.cols).
   Bản xem trước / PDF áp ở chế độ "mỗi hạng mục một trang"; file Excel (1 sheet / hạng mục) luôn áp (opts.colsHm) */
export function bgColHm_(bgCfg) { return (bgCfg || {}).colHm || {} }
export function bgDocColsOf_(ctx, ui, code) { const m = bgColHm_(ctx.bgCfg)[code]; return bgDocCols_(ctx, m ? Object.assign({}, ui, { cols: m }) : ui) }
export function bgExportColsOf_(ctx, ui, code) { const m = bgColHm_(ctx.bgCfg)[code]; return bgExportCols_(ctx, m ? Object.assign({}, ui, { cols: m }) : ui) }
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
/* ---- Ước chiều cao 1 dòng bảng chi tiết (px của trang 1123 x 794) để CHIA TRANG THEO CHIỀU CAO: mọi trang giữ cỡ chữ gốc,
   dòng không vừa trang thì sang trang sau (thay vì thu nhỏ cả trang). Đo chữ bằng canvas, xếp chữ theo bề rộng cột (bgDocW_),
   ô mô tả tối đa 5 dòng (.qx-desc), tên SP + mã, ảnh ~ vuông theo bề rộng cột (tối đa 240). Ước dư một chút để không tràn. */
/* Chiều cao ĐO THẬT của dòng bảng (px, chưa thu nhỏ) do bản xem trước đo ở khung ẩn (QuotePreview) ghi vào; khoá = mã băm
   (bề rộng cột + html dòng), gắn trên dòng ở thuộc tính data-hk. Có số đo thì chia trang theo số đo, chưa có thì theo ước tính.
   Chỉ tăng (dòng đo cao hơn số cũ mới ghi đè: chia trang không bị lặp qua lại khi cột cân lại theo trang). Số đo mới -> tăng phiên bản để QuoteTab dựng lại trang (useSyncExternalStore). */
const hDo_ = new Map()
let hVer_ = 0
const hSubs_ = new Set()
export function hDoGhi_(ds) {
  let doi = false
  ds.forEach(function (x) { const cu = hDo_.get(x[0]); if (x[0] && x[1] > 0 && (cu == null || x[1] > cu + 1.5)) { hDo_.set(x[0], x[1]); doi = true } })
  if (doi) { hVer_++; hSubs_.forEach(function (f) { f() }) }
}
/* đo ở khung ẩn (QuotePreview): hCho_ = chỗ trống cho cả bảng chi tiết của 1 trang (px, từ mép trên bảng tới mép trên chân trang - 8,
   không gồm tiêu đề hạng mục). Chỉ ghi khi NHỎ đi: số đo đổi theo cách chia trang, ghi hai chiều có thể chia lại mãi (trang trắng) */
let hCho_ = null
/* hCho1_ = chỗ trống cho bảng hạng mục ở tờ bìa (từ mép trên bảng tới mép trên chân trang - 8): chỉ phụ thuộc phần đầu bìa
   (logo, khung tiêu đề, thông tin dự án), không phụ thuộc cách chia nên ghi theo số đo mới nhất */
let hCho1_ = null
export function hChoGhi_(cho, cho1) {
  let doi = false
  if (cho > 100 && (hCho_ == null || cho < hCho_ - 1)) { hCho_ = cho; doi = true }
  if (cho1 > 0 && (hCho1_ == null || Math.abs(cho1 - hCho1_) > 1)) { hCho1_ = cho1; doi = true }
  if (doi) { hVer_++; hSubs_.forEach(function (f) { f() }) }
}
/* gắn mã băm (data-hk) lên thẻ đầu của html để khung ẩn đo chiều cao */
function ganHk_(html, them) { const k = bam_((them || '') + html); return { k: k, html: html.replace(/^<(\w+)/, '<$1 data-hk="' + k + '"') } }
export const hDoSub_ = f => { hSubs_.add(f); return () => { hSubs_.delete(f) } }
export const hDoVer_ = () => hVer_
function bam_(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) }

let cv_ = null
function rongChu_(t, px, dam, fam) {
  if (cv_ == null) { try { cv_ = document.createElement('canvas').getContext('2d') } catch (e) { cv_ = false } }
  if (!cv_) return String(t).length * px * 0.56
  cv_.font = (dam ? '700 ' : '400 ') + px + 'px ' + fam
  return cv_.measureText(String(t)).width
}
function soDong_(text, px, dam, fam, w) {
  const tu = String(text || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, 'x').split(/\s+/).filter(Boolean)
  if (!tu.length || !(w > 0)) return 0
  const sp = rongChu_(' ', px, dam, fam)
  let n = 1, cur = 0
  tu.forEach(function (x) {
    const r = rongChu_(x, px, dam, fam)
    if (r > w) { n += Math.ceil(r / w) - (cur ? 0 : 1); cur = r % w; return }   // chữ dài hơn cột: bẻ giữa chữ
    if (cur && cur + sp + r > w) { n++; cur = r } else cur = cur ? cur + sp + r : r
  })
  return n
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
/* Bề rộng cột bảng hạng mục tờ bìa: NO, CHI PHÍ, TỶ TRỌNG vừa đủ số; HẠNG MỤC vừa tên mục; MÔ TẢ nhận phần lớn (chữ dài nhất) */
const COVER_COLG_ = ws => '<colgroup>' + ws.map(function (w) { return '<col style="width:' + w + '%">' }).join('') + '</colgroup>'
const COVER_COLG_M1 = COVER_COLG_([6, 14, 20, 13, 8, 39])   // NO · HẠNG MỤC · NỘI DUNG · CHI PHÍ · TỶ TRỌNG · MÔ TẢ
const COVER_COLG_M2 = COVER_COLG_([7, 26, 14, 9, 44])       // NO · HẠNG MỤC · CHI PHÍ · TỶ TRỌNG · MÔ TẢ
export function bgCoverPage_(comp, ctx, coverMau) {
  const P = bgCoverParts_(comp, ctx, coverMau)
  return P.rong != null ? P.rong : P.ttl + P.open + P.th + P.khoi.map(function (k) { return k.join('') }).join('') + P.tong.join('') + '</table>'
}
/* Các phần của bảng hạng mục tờ bìa để chia trang: ttl (tiêu đề) · open (thẻ mở bảng + colgroup) · th (hàng tiêu đề) ·
   khoi (mỗi khối = các dòng không tách rời: Mẫu 1 một mục lớn vì ô gộp rowspan, Mẫu 2 một dòng) · tong (khối tổng: các dòng
   TỔNG CHI PHÍ DỰ KIẾN -> chiết khấu -> VAT -> TỔNG GỒM VAT -> bằng chữ, đi liền nhau, chưa có thẻ đóng bảng).
   Chưa có tờ bìa -> { rong: html thông báo } */
export function bgCoverParts_(comp, ctx, coverMau) {
  const cost = comp.cost; const total = comp.total
  const rows = (ctx.cover || []).filter(function (c) { return !bgHidden(c.stt, ctx.bgCfg) }).slice().sort(coverSortFn)
  if (!rows.length) return { rong: '<div class="qx-secttl">CHI TIẾT CÁC HẠNG MỤC</div>'
    + '<div class="qsum-card"><table class="qsum"><tr><td class="nm" style="color:#94a3b8;padding:16px 0">Chưa có tờ bìa — sang chế độ <b>Chỉnh sửa</b> bấm “↻ Nạp mẫu”.</td></tr></table></div>' }
  const m1 = (coverMau === 'm1')
  // số in ở cột NO: đánh lại liên tục theo các mục đang hiện (bgSoLaiOn_), tắt thì giữ mã gốc
  const soMap = bgSoLaiOn_(ctx.bgCfg) ? coverSoLai_(rows) : null
  const no = function (stt) { return soMap && soMap[stt] ? soMap[stt] : stt }
  const ttl = '<div class="qx-secttl">CHI TIẾT CÁC HẠNG MỤC</div>'
  /* khối tổng = 1 module duy nhất ở cuối bảng hạng mục (thay hộp tổng tiền riêng, không lặp lại "Tổng cộng"): tính trên tổng tờ bìa */
  const la = rows.filter(function (c) { return !rows.some(function (x) { return x.stt !== c.stt && String(x.stt).indexOf(c.stt + '.') === 0 }) })
  const T = bgTong_(total, ctx.bgCfg, ctx.cur && ctx.cur.vat, la.map(function (c) { return { tt: Number(cost[c.stt]) || 0, vp: vatOf_(ctx, c.stt) } }))
  const o = bgOpt_(ctx.bgCfg)
  const ghep = m1 ? 3 : 2
  const dongTong = function (nhan, tien, pct, cls, cuoi) {
    return '<tr class="sec' + (cls ? ' ' + cls : '') + '"><td colspan="' + ghep + '" style="text-align:right"><b>' + nhan + '</b></td>'
      + '<td class="num"><b>' + money(tien) + '</b></td><td class="num"><b>' + (pct || '') + '</b></td><td>' + (cuoi || '') + '</td></tr>'
  }
  // 3 kiểu dòng (Tuỳ biến > Khối tổng): tg1 = tổng, tg2 = chiết khấu / VAT, tg3 = tổng gồm VAT
  const tong = [dongTong('TỔNG CHI PHÍ DỰ KIẾN', total, '100%', 'tg1')]
  if (T.ck) tong.push(dongTong('CHIẾT KHẤU' + (o.ckKieu === 'pct' ? ' ' + o.ck + '%' : ''), -T.ck, '', 'tg2'), dongTong('SAU CHIẾT KHẤU', T.sau, '', 'tg2'))
  // bằng chữ nằm ở ô MÔ TẢ (đang trống) của dòng tổng gồm VAT: module gọn 3 - 5 dòng, dễ vừa cuối trang
  tong.push(dongTong('VAT ' + T.vatNhan, T.vat, '', 'tg2'), dongTong('TỔNG CHI PHÍ DỰ KIẾN (GỒM VAT)', T.total, '', 'tg3 grand',
    '<span class="bchu"><i>Bằng chữ:</i> ' + esc(docSoVN_(T.total)) + '</span>'))
  if (m1) {
    // Mẫu 1: gộp theo mục lớn (một ô HẠNG MỤC dùng chung cho các dòng con)
    const secs = rows.filter(function (c) { return coverDepth(c.stt) === 1 })
    const khoi = secs.map(function (sec) {
      let kids = rows.filter(function (c) { return c.stt !== sec.stt && String(c.stt).indexOf(sec.stt + '.') === 0 })
      if (!kids.length) kids = [sec]
      return kids.map(function (c, ki) {
        const val = cost[c.stt] || 0; const pct = total > 0 ? (val / total * 100) : 0
        const lead = ki === 0 ? '<td class="ct" rowspan="' + kids.length + '">' + esc(no(sec.stt)) + '</td>'
          + '<td class="hm" rowspan="' + kids.length + '">' + esc(sec.hangMuc || '') + '</td>' : ''
        // mục CÓ CON (vd 3.2) là dòng cộng gộp của các mục dưới nó: in đậm; mục con thụt vào + chữ nhạt hơn
        const gop = c !== sec && coverHasChild(ctx.cover, c.stt); const sau = Math.max(0, coverDepth(c.stt) - 2)
        return '<tr>' + lead + '<td style="' + (sau ? 'padding-left:' + (8 + sau * 14) + 'px;color:#5b6b7b' : '') + (gop ? ';font-weight:700' : '') + '">' + esc(c === sec ? '' : (c.hangMuc || '')) + (gop ? ' <i style="font-weight:400;color:#94a3b8">(gồm các mục dưới)</i>' : '') + '</td>'
          + '<td class="num" style="' + (gop ? 'font-weight:700' : (sau ? 'color:#5b6b7b' : '')) + '">' + money(val) + '</td><td class="num" style="' + (sau ? 'color:#5b6b7b' : '') + '">' + pct.toFixed(2) + '%</td>'
          + '<td class="it">' + esc(c.moTa || '') + '</td></tr>'
      })
    })
    return {
      ttl: ttl, open: '<table class="qx-tbl qx-cover">' + COVER_COLG_M1, khoi: khoi, T: T,
      th: '<tr class="qx-h"><th class="ct">NO</th><th>HẠNG MỤC</th><th>NỘI DUNG</th><th class="num">CHI PHÍ DỰ KIẾN</th><th class="num">TỶ TRỌNG</th><th>MÔ TẢ</th></tr>',
      tong: tong,
    }
  }
  // Mẫu 2: danh sách phẳng phân cấp
  const khoi = rows.map(function (c) {
    const lvl = coverDepth(c.stt); const val = cost[c.stt] || 0; const pct = total > 0 ? (val / total * 100) : 0
    return '<tr class="lv' + lvl + '"><td class="ct">' + esc(no(c.stt)) + '</td>'
      + '<td>' + esc(c.hangMuc || '') + '</td>'
      + '<td class="num">' + money(val) + '</td><td class="num">' + pct.toFixed(2) + '%</td>'
      + '<td class="it">' + esc(c.moTa || '') + '</td></tr>'
  }).map(function (r) { return [r] })
  return {
    ttl: ttl, open: '<table class="qx-tbl qx-cover">' + COVER_COLG_M2, khoi: khoi, T: T,
    th: '<tr class="qx-h"><th class="ct">NO</th><th>HẠNG MỤC</th><th class="num">CHI PHÍ DỰ KIẾN</th><th class="num">TỶ TRỌNG</th><th>MÔ TẢ</th></tr>',
    tong: tong,
  }
}

/* ---- Ô ký (trang bìa sau), bgCfg.ky = {an, ghi, cao, cot: [{hd, nm}]}: an = ẩn cả khối; ghi = dòng "(Ký, ghi rõ họ tên)";
   cao = chiều cao chỗ ký (px); cot = 2-3 cột, tiêu đề / tên để trống = mặc định (cột 1 khách hàng, cột 2 công ty + người lập) ---- */
export const KY_CAO_MAC = 90
export const KY_COT_MAX = 3
export function bgKy_(bgCfg) {
  const k = (bgCfg && bgCfg.ky) || {}
  const cao = Number(k.cao)
  const cot = (Array.isArray(k.cot) ? k.cot : []).slice(0, KY_COT_MAX).map(function (c) { return { hd: String((c && c.hd) || ''), nm: String((c && c.nm) || '') } })
  while (cot.length < 2) cot.push({ hd: '', nm: '' })
  return { an: !!k.an, ghi: !!k.ghi, cao: cao >= 30 && cao <= 240 ? cao : KY_CAO_MAC, cot: cot }
}
/* tiêu đề / tên mặc định của cột ký i */
export function bgKyMac_(i, ctx, org, nguoi) {
  if (i === 0) return { hd: 'KHÁCH HÀNG / CUSTOMER', nm: (ctx.cur && ctx.cur.khachHang) || '' }
  if (i === 1) return { hd: String(org.ten || '').toUpperCase(), nm: nguoi ? 'Người lập: ' + nguoi : '' }
  return { hd: 'ĐẠI DIỆN', nm: '' }
}

/* ---- Hộp tổng + bằng chữ (cuối tờ bìa) ---- */
export function bgTongTienHTML_(q, ctx) {
  const o = bgOpt_(ctx.bgCfg)
  function row(nhan, tien, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td class="lbl">' + nhan + '</td><td class="num">' + money(tien) + ' đ</td></tr>' }
  const tot = '<table class="qx-tbl qx-totbox"><colgroup><col style="width:74%"><col style="width:26%"></colgroup>'
    + row('TỔNG CỘNG:', q.sub)
    + (q.ck ? row('CHIẾT KHẤU' + (o.ckKieu === 'pct' ? ' ' + o.ck + '%' : '') + ':', -q.ck) + row('SAU CHIẾT KHẤU:', q.sau) : '')
    + row('VAT ' + q.vatNhan + ':', q.vat) + row('THÀNH TIỀN SAU THUẾ:', q.total, 'grand') + '</table>'
    + '<div class="qx-bangchu"><i>Bằng chữ:</i> <b>' + esc(docSoVN_(q.total)) + '</b></div>'
  return '<div class="qx-biatong">' + tot + '</div>'
}

/* ---- Hộp tổng tiền + tiến độ thanh toán + ghi chú + ô ký (trang bìa sau = trang cuối, luôn là trang riêng) ---- */
export function bgTongKetHTML_(q, org, ctx, me) {
  // chữ / số của khối tổng kết: cùng một hàm với opts.tongKet của file Excel (M8.1)
  const tk = bgTongKetData_(q, ctx.bgCfg, me)
  const tt = tk.dot.length ? '<div class="qx-dot"><div class="h">Tiến độ thanh toán</div><table><tr><th>Đợt</th><th>Nội dung</th><th class="num">Tỷ lệ</th><th class="num">Số tiền</th></tr>'
    + tk.dot.map(function (d, i) { return '<tr><td>' + (i + 1) + '</td><td>' + esc(d.noiDung) + '</td><td class="num">' + d.pct + '%</td><td class="num">' + money(d.soTien) + ' đ</td></tr>' }).join('')
    + '</table></div>' : ''
  const notes = '<div class="qx-notes"><div class="h">Ghi chú & điều khoản:</div><ol>' + tk.ghiChu.map(function (x) { return '<li>' + esc(x) + '</li>' }).join('') + '</ol></div>'
  const nguoi = tk.nguoi
  const ky = bgKy_(ctx.bgCfg)
  const sign = ky.an ? '' : '<div class="qx-sign">' + ky.cot.map(function (c, i) {
    const mac = bgKyMac_(i, ctx, org, nguoi)
    return '<div class="col"><div class="hd">' + esc(c.hd.trim() || mac.hd) + '</div>'
      + (ky.ghi ? '<div class="ghi">(Ký, ghi rõ họ tên)</div>' : '')
      + '<div class="sp" style="height:' + ky.cao + 'px"></div><div class="nm">' + esc(c.nm.trim() || mac.nm) + '</div></div>'
  }).join('') + '</div>'
  /* tổng giá trị báo giá: đặt sau tiến độ thanh toán, cùng tông nhạt với khối tiến độ (không dùng hộp nền đậm) */
  const o2 = bgOpt_(ctx.bgCfg)
  const dong = function (nhan, tien, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + nhan + '</td><td class="num">' + money(tien) + ' đ</td></tr>' }
  const tongNhe = '<div class="qx-dot qx-tongnhe"><div class="h">Tổng giá trị báo giá</div><table>'
    + dong('Thành tiền (Chưa VAT)', q.sub)
    + (q.ck ? dong('Chiết khấu' + (o2.ckKieu === 'pct' ? ' ' + o2.ck + '%' : ''), -q.ck) + dong('Sau chiết khấu', q.sau) : '')
    + dong('VAT ' + q.vatNhan, q.vat) + dong('Thành tiền (Bao gồm VAT)', q.total, 'grand') + '</table>'
    + '<div class="chu"><i>Bằng chữ:</i> <b>' + esc(docSoVN_(q.total)) + '</b></div></div>'
  // trang bìa sau: tiến độ thanh toán -> tổng giá trị -> ghi chú & điều khoản -> ô ký
  return tt + tongNhe + notes + sign
}

/* Dựng danh sách trang: [tờ bìa] + [các trang chi tiết] + [phần thô] (+ trang "Tổng kết" khi trang cuối đã quá nửa).
   Trả [{html, meta:{trang, ten, dong, tien}}]; html đã đổi tên class (docHtml_). */
/* Các mục thông tin dự án trên tờ bìa — lấy đúng các ô của hộp "Thông tin dự án" (Bảng điều khiển), cùng tên + thứ tự;
   in theo cặp 2 cột. BG_TT_MAC = các mục hiện sẵn khi bản nháp chưa tự chọn (bgCfg.hienTT) */
export const BG_TT_DS = [['ten', 'Tên dự án'], ['kh', 'Khách hàng'], ['sdt', 'Số điện thoại'], ['dc', 'Địa chỉ'], ['ma', 'Mã báo giá'],
  ['qm', 'Quy mô'], ['dt', 'Tổng DT XD'], ['dtbg', 'DT báo giá'], ['nc', 'Nhu cầu'], ['pc', 'Phân khúc'], ['ht', 'Hiện trạng'], ['gc', 'Ghi chú']]
export const BG_LOGO_MIN = 20
export const BG_LOGO_MAX = 72
export const BG_TT_MAC = ['ten', 'kh', 'sdt', 'dc']   // mặc định: Tên dự án · Khách hàng · Số điện thoại · Địa chỉ
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
    hienTT: Array.isArray(c.hienTT) ? c.hienTT
      : Array.isArray(c.anTT) ? ['kh', 'ht', 'ten', 'qm', 'dt', 'nc', 'pc', 'dtbg'].filter(k => c.anTT.indexOf(k) < 0)   // bản cũ: anTT tính trên bộ mặc định cũ
        : BG_TT_MAC,
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
  themTrang('', { ten: 'Tờ bìa' })          // chỗ của tờ bìa: dựng ở cuối (cần tổng tiền), có thể thành nhiều trang
  // ===== Từ trang 2: bảng chi tiết các hạng mục đã bóc được chọn, THEO ĐÚNG CHIP CỘT đang bật =====
  const lines = bgLines_(ctx)
  /* bộ dựng bảng theo 1 danh sách cột (chung, hoặc cột riêng của 1 hạng mục - bgDocColsOf_) */
  function bang(cols) {
    const coAnh = cols.some(function (c) { return c[0] === 'hinhAnh' })
    /* thước đo chiều cao (chia trang theo chiều cao): cỡ chữ / đệm theo độ dày bảng (qx-dense), hệ số cỡ chữ báo giá, đệm dòng của khung */
    const chu = bgChu_(ctx.bgCfg)
    const kz = (Number(chu.co) || 100) / 100
    const dense = cols.length >= 20 ? 2 : cols.length >= 15 ? 1 : 0
    const fz = [10.5, 9.5, 8.5][dense] * kz; const padH = [8, 5, 3][dense]
    const padV = chu.ctkSet && chu.ctkCach != null ? chu.ctkCach : [8, 6, 5][dense]
    const fam = (chu.font ? chu.font + ', ' : '') + 'Arial, Helvetica, sans-serif'
    const tongW = bgDocTongW_(cols, 30, ui.bgColW)
    const rong = function (c) { return bgDocW_(c[0], ui.bgColW) / tongW * 1047 - 2 * padH - 1 }
    const hDong = fz * 1.45
    function hRow(l) {
      let h = hDong
      cols.forEach(function (c) {
        const k = c[0]; const w = rong(c); let x
        if (k === 'hinhAnh') x = l.hinhAnh ? Math.min(240, Math.max(20, w)) : 0
        else if (k === 'ten') x = Math.max(1, soDong_(l.ten, fz, true, fam, w)) * hDong + (l.maSP ? 8 * kz * 1.3 + 1 : 0)
        else if (k === 'moTa' || k === 'kichThuoc') x = Math.min(5, soDong_(k === 'moTa' ? l.moTa : l.kichThuoc, 9.5 * kz, false, fam, w)) * 9.5 * kz * 1.35 + 2
        else if (bgDocAlign_(k) === 'num') x = hDong
        else x = soDong_(bgDocCell_(l, k), fz, false, fam, w) * hDong
        if (x > h) h = x
      })
      return Math.ceil(h + 2 * padV + 1) + 1
    }
    const hSec = Math.ceil(hDong + 2 * padV + 2)
    /* gắn mã băm (data-hk) lên dòng để khung ẩn đo đúng dòng đó; chiều cao = số đo thật nếu có, không thì ước tính */
    const colg = bgColg_(cols, 30, ui.bgColW)
    const gan = function (html) { const k = bam_(colg + html); return { k: k, html: html.replace(/^<tr/, '<tr data-hk="' + k + '"') } }
    const TH = gan(bgTh_(cols))
    /* chỗ cho các dòng: trang 794 - đệm trên 34 - chân trang (đáy 22 + chữ ~14 + cách 8) - tiêu đề hạng mục ~50 - hàng tiêu đề cột */
    const hHead = hDo_.get(TH.k) || (18 + 3 * 9 * 1.25 * kz)
    const cho = hCho_ != null ? hCho_ - hHead - 4 : (794 - 34 - 44 - 50 - hHead) * 0.98
    const rowRaw = function (l, ri) {
      return '<tr><td class="ct">' + (ri + 1) + '</td>'
        + cols.map(function (c) { return '<td class="' + bgDocAlign_(c[0]) + '">' + bgDocCell_(l, c[0]) + '</td>' }).join('') + '</tr>'
    }
    return {
      cho: cho, hHead: hHead,
      /* 1 dòng sản phẩm / 1 dòng đề mục kèm chiều cao dùng để chia trang */
      row: function (l, ri) { const g = gan(rowRaw(l, ri)); return { html: g.html, h: hDo_.get(g.k) || hRow(l) } },
      sec: function (nhan, tien) { const g = gan(bgSecRow_(cols, nhan, tien, 'thanhTien')); return { html: g.html, h: hDo_.get(g.k) || hSec } },
      colg: colg, thead: TH.html,
      tblCls: 'qx-tbl' + (cols.length >= 15 ? ' qx-dense' : '') + (cols.length >= 20 ? ' qx-dense2' : ''),
      rowHtml: function (l, ri) { return gan(rowRaw(l, ri)).html },
      secRow: function (nhan, tien) { return gan(bgSecRow_(cols, nhan, tien, 'thanhTien')).html },
      PER: bgPerRows_(ui.per, coAnh),          // số dòng mỗi trang (tự động: có ảnh 8, không ảnh 13)
    }
  }
  const B0 = bang(bgDocCols_(ctx, ui))
  const colg = B0.colg; const thead = B0.thead; const tblCls = B0.tblCls; const rowHtml = B0.rowHtml; const secRow = B0.secRow; const PER = B0.PER
  /* Chia 1 dãy dòng thành các trang -> [[đầu, cuối)…]. "Dòng / trang" đặt số cố định thì chia theo số đó; Tự động thì chia theo CHIỀU CAO
     ước tính (hs) cho vừa chỗ trống của trang - không trang nào phải thu nhỏ chữ. Dòng đề mục (meta null) không đứng cuối trang. */
  function chia(hs, metas, B) {
    const n = hs.length; const out = []
    if (Number(ui.per) > 0) { for (let i = 0; i < n; i += B.PER) out.push([i, Math.min(n, i + B.PER)]); return out }
    let dau = 0; let cong = 0
    for (let i = 0; i < n; i++) {
      if (i > dau && cong + hs[i] > B.cho) {
        let cat = i
        if (metas[i - 1] === null && cat - 1 > dau) cat = i - 1      // đề mục nhóm sang trang sau cùng dòng của nó
        out.push([dau, cat]); dau = cat; cong = 0
        for (let j = dau; j < i; j++) cong += hs[j]
      }
      cong += hs[i]
    }
    if (dau < n) out.push([dau, n])
    return out
  }
  if (ui.perSec) {
    const byNode = {}; const ordN = []
    lines.forEach(function (l) { const c = (l.nhom || '').trim() || '__k'; if (!byNode[c]) { byNode[c] = []; ordN.push(c) } byNode[c].push(l) })
    ordN.forEach(function (code) {
      const B = bang(bgDocColsOf_(ctx, ui, code))   // cột riêng của hạng mục (nếu đã đặt)
      const its = byNode[code]; const ten = (code === '__k' ? 'KHÁC' : (nodeName(code) || code))
      const secTt = its.reduce(function (a, l) { return a + ttBan_(l) }, 0)
      const flatN = []; const metaN = []; const hN = []; const byF = {}; const ordF = []
      its.forEach(function (l) { const g = (l.tang || '').trim() || 'HẠNG MỤC'; if (!byF[g]) { byF[g] = []; ordF.push(g) } byF[g].push(l) })
      ordF.forEach(function (g, gi) {
        const sub = byF[g].reduce(function (a, l) { return a + ttBan_(l) }, 0)
        const s1 = B.sec((ROMAN_[gi] || (gi + 1)) + '. ' + esc(g), sub); flatN.push(s1.html); metaN.push(null); hN.push(s1.h)
        byF[g].forEach(function (l, ri) { const r = B.row(l, ri); flatN.push(r.html); metaN.push(ttBan_(l)); hN.push(r.h) })
      })
      const s2 = B.sec('<b>TỔNG ' + esc(String(ten).toUpperCase()) + '</b>', secTt); flatN.push(s2.html); metaN.push(null); hN.push(s2.h)
      /* đầu trang đầu tiên của hạng mục: Chưa VAT · VAT x% · Thành tiền (VAT) của riêng hạng mục này */
      const vatHm = vatOf_(ctx, code); const tienVat = Math.round(secTt * vatHm / 100)
      const hmTong = '<span class="qx-hmtong"><span>Chưa VAT <b>' + money(secTt) + '</b></span><span>VAT ' + vatHm + '% <b>' + money(tienVat) + '</b></span>'
        + '<span class="g">Thành tiền (VAT) <b>' + money(secTt + tienVat) + '</b></span></span>'
      chia(hN, metaN, B).forEach(function (r) {
        themTrang('<div class="qx-secttl"><span>' + esc(String(ten).toUpperCase()) + (r[0] ? ' (tiếp)' : '') + '</span>' + (r[0] ? '' : hmTong) + '</div>'
          + '<table class="' + B.tblCls + '">' + B.colg + B.thead + flatN.slice(r[0], r[1]).join('') + '</table>',
        bgMetaTrang_(ten, metaN.slice(r[0], r[1])))
      })
    })
  } else {
    const groups = {}; const order = []
    lines.forEach(function (l) { const g = (l.tang || '').trim() || 'HẠNG MỤC'; if (!groups[g]) { groups[g] = []; order.push(g) } groups[g].push(l) })
    const flat = []; const metaF = []; const hF = []
    order.forEach(function (g, gi) {
      const items = groups[g] || []; const sec = items.reduce(function (a, l) { return a + ttBan_(l) }, 0)
      const s1 = B0.sec((ROMAN_[gi] || (gi + 1)) + '. ' + esc(g), sec); flat.push(s1.html); metaF.push(null); hF.push(s1.h)
      items.forEach(function (l, ri) { const r = B0.row(l, ri); flat.push(r.html); metaF.push(ttBan_(l)); hF.push(r.h) })
    })
    if (flat.length) {
      chia(hF, metaF, B0).forEach(function (r) {
        themTrang((r[0] === 0 ? '<div class="qx-secttl">BẢNG BÁO GIÁ CHI TIẾT</div>' : '') + '<table class="' + tblCls + '">' + colg + thead + flat.slice(r[0], r[1]).join('') + '</table>',
          bgMetaTrang_('Bảng báo giá chi tiết', metaF.slice(r[0], r[1])))
      })
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
  const tong = bgTong_(subBG, ctx.bgCfg, p.vat, bgVatParts_(ctx))
  /* Tờ bìa = phần đầu (logo, tiêu đề, thông tin) + bảng hạng mục kết thúc bằng khối tổng (1 module: tổng -> VAT -> tổng gồm VAT -> bằng chữ).
     Đã đo (khung ẩn) thì chia theo chiều cao: bảng không vừa trang 1 thì các khối còn lại sang trang "(tiếp)" (lặp hàng tiêu đề); khối tổng
     luôn đi liền 1 khối, không vừa thì sang trang sau cùng hàng tiêu đề - cỡ chữ tờ bìa giữ như mọi trang. Chưa đo đủ -> dồn hết vào trang 1. */
  const CP = bgCoverParts_(comp, ctx, ui.coverMau)
  const dauBia = decoxHead + infoBlock
  let bia
  if (CP.rong != null) bia = [dauBia + CP.rong + bgTongTienHTML_(tong, ctx)]
  else {
    const TH = ganHk_(CP.th, CP.open)
    const TONG = CP.tong.map(function (r) { return ganHk_(r, CP.open) })
    const khoi = CP.khoi.map(function (k) { return k.map(function (r) { return ganHk_(r, CP.open) }) })
    const h = function (g) { return hDo_.get(g.k) }
    const cao = function (ds) { return ds.reduce(function (a, g) { return a + h(g) }, 0) }
    const du = hCho1_ != null && h(TH) != null && TONG.every(function (g) { return h(g) != null }) && khoi.every(function (k) { return k.every(function (g) { return h(g) != null }) })
    const choN = hCho_ != null ? hCho_ : 794 - 34 - 42 - 8 - 50
    let trang = [{ khoi: khoi.map(function (k, i) { return i }), tong: true }]
    if (du) {
      trang = [{ khoi: [], tong: false }]
      let cho = hCho1_ - 4; let dung = h(TH)
      const moi = function () { trang.push({ khoi: [], tong: false }); cho = choN - 4; dung = h(TH) }
      khoi.forEach(function (k, i) {
        const kh = cao(k)
        if (trang[trang.length - 1].khoi.length && dung + kh > cho) moi()
        trang[trang.length - 1].khoi.push(i); dung += kh
      })
      // hạng mục đổ đầy trang hiện tại; khối tổng (đi liền 1 khối) không vừa phần còn lại thì sang trang sau
      if (dung + cao(TONG) > cho) moi()
      trang[trang.length - 1].tong = true
    }
    bia = trang.map(function (t, ti) {
      const bang = CP.open + TH.html + t.khoi.map(function (i) { return khoi[i].map(function (g) { return g.html }).join('') }).join('')
        + (t.tong ? TONG.map(function (g) { return g.html }).join('') : '') + '</table>'
      return (ti === 0 ? dauBia + CP.ttl : '<div class="qx-secttl">CHI TIẾT CÁC HẠNG MỤC (tiếp)</div>') + bang
    })
  }
  inners.splice.apply(inners, [0, 1].concat(bia))
  metas.splice.apply(metas, [0, 1].concat(bia.map(function () { return { ten: 'Tờ bìa' } })))
  // tiến độ thanh toán + ghi chú + ô ký là trang bìa sau (trang cuối, riêng)
  inners.push(bgTongKetHTML_(tong, org, ctx, me)); metas.push({ ten: 'Trang bìa sau' })
  const N = inners.length
  return inners.map(function (inner, idx) {
    const m = metas[idx] || {}
    // Chân trang: đơn vị - dự án (trái) · số trang (phải); bỏ dòng giữa "hạng mục · số dòng · tiền của trang" (vẫn có ở thanh trên bản xem trước qua meta)
    const foot = '<div class="qp-foot">'
      + '<span>' + esc(org.ten) + ' — ' + esc(p.ten || '') + '</span>'
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
