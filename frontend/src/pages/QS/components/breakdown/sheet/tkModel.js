/* Mô hình hiển thị của bảng Bóc tách trên khung SheetBody / SheetGrid của bản clone (dòng = Line của server, khoá cột = COLS).
   Port: visCols PUB/app.js:1844-1847 · tkSheetO_ / tkSheetGrid_ bangtinh.js:384-427 (chữ trong ô, dòng tầng có tổng ở cột
   Thành tiền, đánh số gi.ri theo dòng đang hiện) · TK_SO / TK_GIUA / tkSheetSua_ bangtinh.js:386-389 · tkFieldsFor_ /
   editProfit_ (lib/calc) cho ô sửa · btXlsx_ bangtinh.js:928-939 (dữ liệu xuất Excel). */
import { COLS, DEFW, TK_MINW_, TXT_COL, NUM_COL, TK_RO_COL, visCols, colPlain, cellSortVal_, sortLines_ } from '../../../lib/columns.js'
import { tkFieldsFor_, editProfit_, giaDaiLy_, donGiaCK_, ttBan_ } from '../../../lib/calc.js'
import { money, tkNum_, ptQty } from '../../../lib/format.js'
import { vsFltNganh_ } from '../../../lib/catalogFilters.js'
import { qsToast } from '../../common/dialogs'

export const ROW_NUM_WIDTH = 57
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']
export const roman = gi => ROMAN[gi] || String(gi + 1)
/* Chữ cái cột kiểu bảng tính: 0 -> A, 25 -> Z, 26 -> AA (bảng Bóc tách có tới 27 cột) */
export function colLetter(i) {
  let s = ''; let n = i + 1
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
  return s
}

export const TK_SO = { soLuong: 1, giaNCC: 1, giaDaiLy: 1, donGia: 1, donGiaCK: 1, lnVnd: 1, thanhTien: 1, chietKhau: 1, lnPct: 1, ckKhach: 1, markup: 1, margin: 1 }
export const TK_GIUA = { stt: 1, hinhAnh: 1, dvt: 1, taiLieu: 1, nganh: 1 }
const PROFIT = { markup: 1, margin: 1, lnVnd: 1 }
export function tkSheetSua_(k) { return !TK_RO_COL[k] && k !== 'taiLieu' && !!(k === 'moTa' || k === 'kichThuoc' || TXT_COL[k] || NUM_COL[k] || PROFIT[k]) }
/* Cột giá (nút "Hiện / ẩn các cột giá" trên thanh công cụ) */
export const TK_PRICE_KEYS = ['giaNCC', 'chietKhau', 'giaDaiLy', 'lnPct', 'donGia']

/* Cột đang hiện -> cột của khung SheetGrid {key,label,w,align,pin}. Cố định tới cột Tên nếu phần cố định
   không quá 40% bề ngang (tkSheetVe_), không thì chỉ STT + cột kế; freezeN > 0 = "Cố định đến cột này". */
export function tkColumns(order, cols, node, colWMap, freezeN, boxW) {
  const vc = visCols(order, cols, vsFltNganh_(node))
  const width = k => ((colWMap || {})[k] ? Math.max(colWMap[k], 40) : Math.max(DEFW[k] || 110, TK_MINW_[k] || 60))
  let frz = 2
  if (freezeN > 0) frz = freezeN
  else {
    const iTen = vc.findIndex(c => c[0] === 'ten')
    const rong = (boxW || 1000) * 0.4
    let cw = 0
    if (iTen >= 1) { for (let i = 0; i <= iTen; i++) cw += width(vc[i][0]); if (cw <= rong) frz = iTen + 1 }
  }
  return vc.map((c, i) => ({ key: c[0], label: c[1], w: width(c[0]), align: TK_SO[c[0]] ? 'right' : (TK_GIUA[c[0]] ? 'center' : undefined), pin: i < frz,
    /* fixed: người dùng đã tự đặt bề rộng cột này (kéo / hộp Thay đổi kích thước) -> SheetGrid giữ đúng số đó, không co giãn */
    fixed: !!(colWMap || {})[c[0]] }))
}

const btMoney_ = v => { v = Math.round(Number(v) || 0); return v ? money(v) : '' }
const btSl_ = v => { v = Number(v) || 0; return v.toLocaleString('vi-VN', { maximumFractionDigits: 3 }) }

/* Chữ của 1 ô (tkSheetO_); hinhAnh / taiLieu là phần tử -> '' (SheetGrid vẽ qua renderCell) */
export function lineText(l, k, stt) {
  switch (k) {
    case 'stt': return stt || ''
    case 'nganh': return String((l.extra && l.extra.nganh) || '')
    case 'hinhAnh': case 'taiLieu': return ''
    case 'soLuong': return btSl_(l.soLuong)
    case 'giaNCC': return btMoney_(l.donGiaVon)
    case 'donGia': return btMoney_(l.donGiaBan)
    case 'giaDaiLy': return btMoney_(giaDaiLy_(l))
    case 'donGiaCK': return btMoney_(donGiaCK_(l))
    case 'thanhTien': return btMoney_(ttBan_(l))
    case 'lnVnd': return btMoney_((donGiaCK_(l) - giaDaiLy_(l)) * (Number(l.soLuong) || 0))
    case 'chietKhau': case 'lnPct': case 'ckKhach': return (Number(l[k]) || 0) + '%'
    case 'markup': { const dl = giaDaiLy_(l); const dg = donGiaCK_(l); return dl > 0 ? Math.round((dg - dl) / dl * 100) + '%' : '' }
    case 'margin': { const dl = giaDaiLy_(l); const dg = donGiaCK_(l); return dg > 0 ? Math.round((dg - dl) / dg * 100) + '%' : '' }
    default: { const f = TXT_COL[k] || k; return String(l[f] == null ? '' : l[f]) }
  }
}
/* Số của 1 ô (thống kê vùng chọn); null = không phải ô số */
export function lineNumber(l, k) {
  if (!TK_SO[k]) return null
  const v = cellSortVal_(l, k)
  return typeof v === 'number' ? v : null
}
/* Gõ text vào ô -> dòng mới (chỉ đổi trường gốc của Line; số dẫn xuất do recalcLine_ / server tính) */
export function lineApply(l, k, text) {
  if (!tkSheetSua_(k)) return l
  let fields
  if (PROFIT[k]) {
    const r = editProfit_(l, k, text)
    if (r && r.msg) qsToast(r.msg)
    fields = r && r.fields
  } else fields = tkFieldsFor_(l, k, text)
  if (!fields) return l
  const keys = Object.keys(fields).filter(f => l[f] !== fields[f])
  if (!keys.length) return l
  const n = { ...l }
  keys.forEach(f => { n[f] = fields[f] })
  return n
}

/* Trải nhóm tầng thành các dòng đang hiện. pred(l) lọc dòng; sort = {key, dir} sắp xếp hiển thị (sortLines_);
   STT gi.ri đánh theo dòng đang hiện như bản gốc; n = số hàng ở cột 1-2-3 của lưới, đánh liền như Excel: hàng tiêu đề cột = 1,
   rồi mọi dòng (tầng / phòng và sản phẩm) nối tiếp 2, 3, 4… */
export function tkFlatten(groups, pred, sort) {
  const out = []
  let n = 1   // hàng tiêu đề cột (STT, TÊN SẢN PHẨM…) là hàng 1 (SheetGrid ghi số 1 ở ô cột số của hàng tiêu đề)
  groups.forEach((g, gi) => {
    const list = (g.rows || []).filter(r => !pred || pred(r))
    const sum = list.reduce((s, l) => s + ttBan_(l), 0)
    n += 1
    out.push({ type: 'group', g, gi, n, count: list.length, cells: { thanhTien: btMoney_(sum) } })
    if (g.collapsed) return
    const rows = sort && sort.key ? sortLines_(list, sort.key, sort.dir) : list
    rows.forEach((r, ri) => {
      n += 1
      out.push({ type: 'item', g, gi, r, ri, n, stt: (gi + 1) + '.' + (ri + 1) })
    })
  })
  return out
}
export function tkEntryText(e, k) {
  if (e.type === 'item') return lineText(e.r, k, e.stt)
  if (e.type === 'group') {
    if (k === 'stt') return roman(e.gi)
    if (k === 'khuVuc' || k === 'ten') return e.g.name
    return (e.cells && e.cells[k]) || ''
  }
  return (e.cells && e.cells[k]) || ''
}

/* Dữ liệu cho POST /export/bang (btXlsx_): bỏ cột ảnh / tài liệu, dòng tầng = {group}, ô số giữ kiểu số */
export function tkXlsxBody(flat, cols, tenBang) {
  const giu = cols.filter(c => c.key !== 'hinhAnh' && c.key !== 'taiLieu')
  const rows = flat.filter(e => e.type === 'group' || e.type === 'item').map(e => {
    if (e.type === 'group') return { group: roman(e.gi) + '. ' + e.g.name }
    return { cells: giu.map(c => { const v = lineText(e.r, c.key, e.stt); return (TK_SO[c.key] && v) ? tkNum_(v) : v }) }
  })
  return { ten: tenBang, sheet: 'Boc tach', cols: giu.map(c => ({ label: c.label, num: !!TK_SO[c.key] })), rows }
}

export { COLS, colPlain, ptQty }
