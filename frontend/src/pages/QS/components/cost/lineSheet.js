/* Bảng Chi phí / Dự án trên khung SheetBody / SheetGrid (dòng = Line của server, khoá cột = COLS), không React.
   Port: cpRows_ / cpSortVal_ / cpSort PUB/chiphi.js:123-164 · cpSheetGrid_ bangtinh.js:690-704 (dòng nhóm mang vốn · LN · bán,
   dòng TỔNG cuối, tô dòng lỗ / biên thấp CP_TO) · btGan_ 712-740 (bề rộng cột, cố định tới cột Tên) ·
   daSapXep_ duan.js:15-18 · renderDuAn 58-92 (lọc hạng mục + ô tìm, gom tầng) · daSheetGrid_ bangtinh.js:742-756 ·
   cpXuatExcel_ chiphi.js:515-540 · daXuatExcel_ duan.js:20-33. Ô chữ / ô sửa dùng chung mô hình bảng Bóc tách (tkModel). */
import { DEFW, TK_MINW_, cpLabel_, cpAlign_, cellSortVal_, colPlain, NUMSORT } from '../../lib/columns.js'
import { ttBan_ } from '../../lib/calc.js'
import { money, spNorm_, ptQty } from '../../lib/format.js'
import { cpTotOf_, cpGroupsOf_, cpWarn_, cpTong_, daExcelTong_ } from '../../lib/totals.js'
import { groupByFloor_ } from '../../lib/sheetModel.js'
import { PT_ROMAN } from '../../lib/phantho.js'
import { nodeName } from '../../lib/tree.js'
import { lineText, lineApply, lineNumber, tkSheetSua_, TK_SO, TK_GIUA, colLetter, ROW_NUM_WIDTH } from '../breakdown/sheet/tkModel'

export const romanPT = gi => PT_ROMAN[gi] || String(gi + 1)
const btMoney_ = v => { v = Math.round(Number(v) || 0); return v ? money(v) : '' }
const btSl_ = v => { v = Number(v) || 0; return v.toLocaleString('vi-VN', { maximumFractionDigits: 3 }) }

/* Cột cho SheetGrid: STT + các cột theo thứ tự đã lưu. Bề rộng max(colW, sàn), cố định tới cột Tên nếu Tên nằm trong 3 cột đầu */
export function sheetColumns(order, cols, colWMap, sortKey, sortDir) {
  const vis = order.filter(k => cols[k])
  const iTen = vis.indexOf('ten') + 1
  const frz = (iTen > 0 && iTen < 4) ? iTen + 1 : 2
  const width = k => Math.max((colWMap || {})[k] || DEFW[k] || 110, TK_MINW_[k] || 60)
  const pinOf = k => { const i = vis.indexOf(k); return i >= 0 && i + 1 < frz }
  const lbl = k => cpLabel_(k) + (sortKey === k ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '')
  return [{ key: 'stt', label: 'STT', w: 58, align: 'center', pin: true }].concat(order.map(k => ({
    key: k, label: lbl(k), w: width(k), align: TK_SO[k] ? 'right' : (TK_GIUA[k] ? 'center' : undefined), pin: pinOf(k),
  })))
}

/* Cách đọc / ghi ô của dòng Line (như bảng Bóc tách); dòng nhóm / TỔNG lấy chữ từ e.cells */
export function lineAdapter(isFav) {
  return {
    rowId: r => r.lineId,
    cellText: (r, k, stt) => lineText(r, k, stt),
    editText: (r, k) => lineText(r, k, ''),
    applyEdit: lineApply,
    cellNumber: lineNumber,
    entryText: (e, k) => {
      if (e.type === 'item') return lineText(e.r, k, e.stt)
      if (e.type === 'group' && k === 'stt') return romanPT(e.gi)
      return (e.cells && e.cells[k]) || ''
    },
    colLetter,
    editable: tkSheetSua_,
    isNumeric: k => !!TK_SO[k],
    isFav: r => !!(isFav && isFav(r)),
    priceKeys: [],
    rowNumWidth: ROW_NUM_WIDTH,
    roman: romanPT,
  }
}

/* ===== CHI PHÍ ===== */
/* Giá trị sắp xếp của 1 ô (cpSortVal_) */
export function cpSortVal_(l, k) {
  if (k === 'chietKhau' || k === 'ckKhach' || NUMSORT[k]) return cellSortVal_(l, k)
  return String(l[k] || '')
}
/* Dòng của bảng: hạng mục (scope) -> ô tìm -> chip lọc -> sắp xếp (cpRows_) */
export function cpRows_(scope, q, flt, minBien, sortKey, sortDir) {
  q = spNorm_(q || '')
  const out = scope.filter(l => {
    if (q && spNorm_([l.ten, l.maSP, l.thuongHieu, l.ncc, l.khuVuc].join(' ')).indexOf(q) < 0) return false
    if (flt === 'lo' && cpWarn_(l, minBien) !== 'lo') return false
    if (flt === 'thap' && cpWarn_(l, minBien) !== 'thap') return false
    if (flt === 'chuaGia' && Number(l.donGiaBan) > 0) return false
    if (flt === 'chuaVon' && Number(l.donGiaVon) > 0) return false
    return true
  })
  if (!sortKey) return out
  const dir = sortDir === 'desc' ? -1 : 1
  return out.slice().sort((a, b) => {
    const x = cpSortVal_(a, sortKey), y = cpSortVal_(b, sortKey)
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
    return String(x).localeCompare(String(y), 'vi') * dir
  })
}
/* Đếm cho các chip lọc (cpToolbar_), tính trên đúng phạm vi hạng mục */
export function cpCounts_(scope, minBien) {
  const c = { lo: 0, thap: 0, chuaGia: 0, chuaVon: 0 }
  scope.forEach(l => {
    const w = cpWarn_(l, minBien)
    if (w === 'lo') c.lo++
    if (w === 'thap') c.thap++
    if (!(Number(l.donGiaBan) > 0)) c.chuaGia++
    if (!(Number(l.donGiaVon) > 0)) c.chuaVon++
  })
  return c
}
/* Trải dòng như cpSheetGrid_: by = 'hm' | 'tang' | 'ncc' | '' ; firstKey = cột dữ liệu đầu tiên (nhận chữ của dòng nhóm / TỔNG);
   closed = Set khoá nhóm đang thu gọn (chỉ hiển thị).
   plain = Bảng thường (cpTableHtml_ chiphi.js:293-333): dòng nhóm chỉ mang chữ "N dòng · Vốn · Bán · LN" (số nằm ở dòng
   "Cộng <nhóm>" cuối mỗi nhóm, bỏ khi chỉ có 1 nhóm), ô tổng dùng money / ptQty như cpCellTot_. Mỗi dòng nhóm / tổng mang t (cpTotOf_). */
export function cpFlatten(rows, by, firstKey, closed, minBien, plain) {
  const out = []
  let n = 0
  const tot = plain
    ? (nhan, t) => ({ [firstKey]: nhan, soLuong: ptQty(t.sl), giaDaiLy: money(t.von), lnVnd: money(Math.round(t.ln)), thanhTien: money(t.ban) })
    : (nhan, t) => ({ [firstKey]: nhan, soLuong: btSl_(t.sl), giaDaiLy: btMoney_(t.von), lnVnd: btMoney_(t.ln), thanhTien: btMoney_(t.ban) })
  const all = { id: 'x:all', name: '' }
  if (by) {
    const gs = cpGroupsOf_(rows, by)
    gs.forEach((g, gi) => {
      const id = 'x:' + g.k
      const isClosed = !!(closed && closed.has(id))
      const gg = { id, name: g.ten, collapsed: isClosed, k: g.k }
      n += 1
      out.push({ type: 'group', synthetic: true, gi, n, g: gg, count: g.list.length, t: g.t,
        cells: plain ? { [firstKey]: g.ten + '  ·  ' + g.list.length + ' dòng  ·  Vốn ' + money(g.t.von) + ' · Bán ' + money(g.t.ban) + ' · LN ' + money(Math.round(g.t.ln)) }
          : tot(g.ten + '  ·  ' + g.list.length + ' dòng', g.t) })
      if (isClosed) return
      g.list.forEach((l, ri) => { n += 1; out.push({ type: 'item', g: gg, gi, r: l, ri, n, stt: (gi + 1) + '.' + (ri + 1), w: cpWarn_(l, minBien) }) })
      if (plain && gs.length > 1) { n += 1; out.push({ type: 'total', sub: true, n, g: { id: 'sub:' + g.k }, t: g.t, cells: tot('Cộng ' + g.ten, g.t) }) }
    })
  } else rows.forEach((l, ri) => { n += 1; out.push({ type: 'item', g: all, gi: 0, r: l, ri, n, stt: String(ri + 1), w: cpWarn_(l, minBien) }) })
  const T = cpTotOf_(rows)
  n += 1
  out.push({ type: 'total', n, g: { id: 'total' }, t: T, cells: tot('TỔNG · ' + T.n + ' hạng mục', T) })
  return out
}
/* Thân yêu cầu POST /export/bang của Chi phí (cpXuatExcel_): đúng cột đang bật, lọc / tìm, cách gom; dòng tổng như dải tổng trang */
export function cpXlsxBody(cur, keys, rows, by, loc, hm, ctx) {
  const cols = [{ label: 'STT' }].concat(keys.map(k => ({ label: cpLabel_(k), num: cpAlign_(k) === 'num' || (cpAlign_(k) === 'ct' && k !== 'dvt'), w: xw_(k) })))
  const val = (l, k) => { if (k === 'ten' || k === 'dvt') return String(l[k] || ''); const v = cellSortVal_(l, k); return typeof v === 'number' ? v : (Number(v) || 0) }
  const out = []
  const them = (list, pre) => list.forEach((l, i) => out.push({ cells: [pre + (i + 1)].concat(keys.map(k => val(l, k))) }))
  if (by) cpGroupsOf_(rows, by).forEach((g, gi) => {
    out.push({ group: roman15(gi) + '. ' + g.ten + '   —   vốn ' + money(g.t.von) + ' · bán ' + money(g.t.ban) + ' · lợi nhuận ' + money(g.t.ln) })
    them(g.list, (gi + 1) + '.')
  })
  else them(rows, '')
  // Đang lọc / tìm: tổng của đúng các dòng xuất ra. Không lọc: đúng dải tổng của trang (gồm Phần thô, trừ CK báo giá).
  const T = loc ? cpTotOf_(rows) : cpTong_(rows, hm, ctx)
  const vp = Number(cur.vat) || 0
  const banT = loc ? T.ban : T.net
  const vat = Math.round(banT * vp / 100)
  const tong = [['Tổng giá vốn', T.von]].concat(!loc && T.ptBan ? [['  trong đó Phần thô (giá bán)', T.ptBan]] : []).concat(!loc && T.ck ? [['Chiết khấu báo giá', -T.ck]] : [])
    .concat([['Tổng giá bán', banT], ['Lợi nhuận', T.ln], ['VAT ' + vp + '%', vat], ['Tổng thanh toán', banT + vat]])
  return {
    ten: 'BẢNG CHI PHÍ — ' + (cur.ten || cur.maDA) + (hm ? (' · ' + nodeName(hm)) : ''), sheet: 'Chi phi', cols, rows: out, tong, dep: true,
  }
}
/* ROMAN_ của bản gốc (baogia.js:131) có 15 số */
const ROMAN15 = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV']
const roman15 = gi => ROMAN15[gi] || String(gi + 1)

/* ===== DỰ ÁN ===== */
/* Sắp xếp trong từng tầng (daSapXep_) */
export function daSapXep_(list, sortKey, sortDir) {
  if (!sortKey) return list
  const d = sortDir === 'desc' ? -1 : 1
  return list.slice().sort((a, b) => {
    let x = cellSortVal_(a, sortKey), y = cellSortVal_(b, sortKey)
    if (typeof x !== 'number' || typeof y !== 'number') { x = colPlain(a, sortKey); y = colPlain(b, sortKey); return String(x).localeCompare(String(y), 'vi', { numeric: true }) * d }
    return (x - y) * d
  })
}
/* Ô tìm của Dự án: chỉ lọc bảng */
export function daSearch_(scope, q) {
  const dq = spNorm_(q || '')
  return dq ? scope.filter(l => spNorm_([l.ten, l.maSP, l.thuongHieu, l.ncc, l.khuVuc].join(' ')).indexOf(dq) >= 0) : scope
}
/* Gom tầng (bỏ tầng trống) + sắp trong tầng: {order, groups} */
export function daGroups_(visible, cur, allLines, sortKey, sortDir) {
  const r = groupByFloor_(visible, cur, allLines, true)
  r.order.forEach(g => { r.groups[g] = daSapXep_(r.groups[g], sortKey, sortDir) })
  return r
}
/* Trải dòng như daSheetGrid_: dòng tầng mang tổng tầng ở Thành tiền, dòng TỔNG cuối.
   plain = Bảng thường (renderDuAn duan.js:96-99): tổng tầng nằm trong chữ của dòng tầng ("Tổng tầng: X đ"), e.sum = tổng tầng */
export function daFlatten(dg, lines, firstKey, closed, plain) {
  const out = []
  let n = 0
  dg.order.forEach((g, gi) => {
    const list = dg.groups[g] || []
    const isClosed = !!(closed && closed.has(g))
    const gg = { id: g, name: g, collapsed: isClosed }
    const sum = list.reduce((s, l) => s + ttBan_(l), 0)
    n += 1
    out.push({ type: 'group', gi, n, g: gg, count: list.length, sum,
      cells: plain ? { [firstKey]: g + '  ·  Tổng tầng: ' + money(sum) + ' đ' } : { [firstKey]: g, thanhTien: btMoney_(sum) } })
    if (isClosed) return
    list.forEach((l, ri) => { n += 1; out.push({ type: 'item', g: gg, gi, r: l, ri, n, stt: (gi + 1) + '.' + (ri + 1) }) })
  })
  n += 1
  out.push({ type: 'total', n, g: { id: 'total' }, cells: {
    [firstKey]: 'TỔNG · ' + lines.length + ' SP',
    thanhTien: btMoney_(lines.reduce((s, l) => s + ttBan_(l), 0)),
    soLuong: btSl_(lines.reduce((s, l) => s + (Number(l.soLuong) || 0), 0)),
  } })
  return out
}
/* Độ rộng cột Excel (đơn vị ký tự) theo độ rộng mặc định trên màn hình (DEFW, px) - dùng với dep: true của /export/bang */
const xw_ = k => Math.max(8, Math.min(60, Math.round((DEFW[k] || 120) / 7)))
/* Thân yêu cầu POST /export/bang của Dự án (daXuatExcel_): bỏ cột tài liệu, dòng tầng = {group}, ô số giữ kiểu số.
   dep: true (chỉ bản Go) -> file có viền, canh giữa, cột Hình ảnh nhúng ảnh thật (ô gửi link ảnh) */
const DA_NUM = { soLuong: 1, giaNCC: 1, giaDaiLy: 1, donGia: 1, donGiaCK: 1, thanhTien: 1, lnVnd: 1, chietKhau: 1, lnPct: 1, ckKhach: 1, markup: 1, margin: 1 }
export function daXlsxBody(cur, keys, dg, lines) {
  const ks = keys.filter(k => k !== 'taiLieu')
  const rows = []
  const o = (l, k) => (k === 'hinhAnh' ? String(l.hinhAnh || '').split('\n')[0].trim() : (DA_NUM[k] ? cellSortVal_(l, k) : String(lineText(l, k, ''))))
  dg.order.forEach((g, gi) => {
    rows.push({ group: romanPT(gi) + '. ' + g })
    dg.groups[g].forEach((l, ri) => rows.push({ cells: [(gi + 1) + '.' + (ri + 1)].concat(ks.map(k => o(l, k))) }))
  })
  return {
    ten: 'SẢN PHẨM TRONG DỰ ÁN — ' + (cur.ten || cur.maDA), sheet: 'Du an', dep: true,
    cols: [{ label: 'STT' }].concat(ks.map(k => ({ label: cpLabel_(k), num: !!DA_NUM[k], img: k === 'hinhAnh', w: k === 'hinhAnh' ? 12 : xw_(k) }))), rows,
    tong: daExcelTong_(lines, cur.vat),
  }
}


