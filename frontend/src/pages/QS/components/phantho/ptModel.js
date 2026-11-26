/* Phần tính (không React, không fetch) của panel Phần thô (đề mục 3.1) và form sửa công tác.
   Port nguyên văn PUB/phantho.js; S.* thành tham số. Nguồn:
   ptKeyLabel_ / ptCellVal_ 1300-1314 · ptRowPass_ 1345-1348 · PT_BULK_F 1434-1436 · PT_CELL_F / PT_NUM_K 1476-1478 · ptCellEditable_ 1489-1494
   ptCfClass_ 1540-1547 · ptInfoKey_ / ptInfo_ / ptInfoImgs_ (phần dữ liệu) 1739-1756 · ptDetailParts_ (phần dữ liệu) 1810-1867
   ptBlankItem_ 2053-2057 · PT_COLS 2085-2092 · ptVisCols_ / ptW_ 2102-2108 · PT_SORTKEY / ptSortItems_ 2121-2133
   ptSheetGrid_ / ptSheetSua_ bangtinh.js:306-343 · CT_DEMUC_CHON / ctDeMucNhan_ 541-542 · ctHangMucList_ 721-726 · CT_MODE_LBL 727
   ctGrpParse_ / ctGrpText_ 944-966 · ctPrev_ (phần tính) 1033-1044 · ctFormRead_ (phần dựng dữ liệu) 1086-1100 · spPTAll_ / ptXlsRows_ sanpham.js:1300-1355 */
import { money, ptN, ptR0, ptR2, ptQty } from '../../lib/format.js'
import { PT_LOAI, PT_ROMAN, ptLoaiGop_, ptSecLoai_, ptVal_, ptLibDg_, ctOf_, ptCanEditF_, ptHs_, ptAutoKL_, ptMkPct_, ptMoTaHien_ } from '../../lib/phantho.js'
import { nodeName } from '../../lib/tree.js'
import { ctDeMucOf_, ptLoaiLabel_ } from '../breakdown/catalog/catalogModel'

/* Cột bảng Phần thô: [key, nhãn, canh, rộng] */
/* Bộ cột đầy đủ theo file mẫu I.Prilem (MarkUp 2026-11-26): [key, nhãn, canh, rộng, mặc định mở, ẩn khi xuất báo giá].
   Giá: Giá cost × (1 − CK nhà thầu) = Giá đại lý; Đơn giá = Giá đại lý × (1 + LN/giá vốn mục tiêu); Đơn giá sau CK = Đơn giá × (1 − CK khách);
   Khối lượng = L × B × H × Hệ số (ô trống không nhân). Thông tin chính (việc con) hiện ở panel thông tin công tác, không thành cột. */
export const PT_COLS = [
  ['stt', 'STT', 'c', 52, 1], ['maBanVe', 'Mã số bản vẽ', 'l', 110, 0], ['dongSP', 'Dòng sản phẩm', 'l', 130, 0],
  ['maSP', 'Mã sản phẩm', 'l', 130, 0], ['noidung', 'Tên sản phẩm', 'l', 300, 1], ['moTa', 'Mô tả', 'l', 460, 1], ['ncc', 'Nhà cung cấp / nhà thầu', 'l', 160, 1],
  ['hinhAnh', 'Hình ảnh', 'c', 96, 1], ['dvt', 'Đơn vị tính', 'c', 84, 1],
  ['dimL', 'L (m)', 'n', 76, 0], ['dimB', 'B (m)', 'n', 76, 0], ['dimH', 'H (m)', 'n', 76, 0], ['heso', 'Hệ số', 'n', 72, 0],
  ['khoiluong', 'Khối lượng', 'n', 104, 1],
  ['giaNCC', 'Giá cost nhà thầu', 'n', 136, 0], ['ttCost', 'Thành tiền (giá cost)', 'n', 148, 0],
  ['ckNT', 'Chiết khấu của nhà thầu (%)', 'n', 136, 0],
  ['dgnt', 'Giá đại lý (giá Dezon)', 'n', 140, 1, 1], ['ttnt', 'Thành tiền (giá đại lý)', 'n', 148, 0],
  ['mkPct', 'Lợi nhuận/giá vốn mục tiêu (%)', 'n', 150, 1, 1], ['dg', 'Đơn giá (Dezon)', 'n', 134, 0],
  ['ckKH', 'Chiết khấu cho khách hàng (%)', 'n', 136, 0], ['dgCK', 'Đơn giá (sau chiết khấu)', 'n', 146, 1],
  ['tt', 'Thành tiền (sau chiết khấu)', 'n', 156, 0],
  ['markup', 'LN sau CK/giá vốn - Markup (%)', 'n', 156, 0, 1], ['margin', 'LN sau CK/giá bán - Margin (%)', 'n', 156, 0, 1],
  ['lnvnd', 'Lợi nhuận (VND)', 'n', 124, 1, 1], ['trangThai', 'Trạng thái', 'l', 120, 0], ['ghichu', 'Ghi chú', 'l', 210, 0],
]
export const PT_COLS_MAC_DINH = PT_COLS.filter(c => c[4]).map(c => c[0])
export const PT_AN_XUAT = PT_COLS.filter(c => c[5]).map(c => c[0])
/* Bộ cột dựng sẵn của khung "Chọn nhanh cột" Phần thô: [id, tên, danh sách cột | null = tất cả]; cột Tên sản phẩm luôn có */
export const PT_PRESETS = [
  ['all', 'Hiện tất cả cột', null],
  ['md', 'Mặc định', PT_COLS_MAC_DINH],
  ['nt', 'Nhà thầu', ['stt', 'noidung', 'ncc', 'dvt', 'dimL', 'dimB', 'dimH', 'heso', 'khoiluong', 'giaNCC', 'ttCost', 'ckNT', 'dgnt', 'ttnt', 'ghichu']],
  ['kh', 'Báo giá cho khách', ['stt', 'noidung', 'moTa', 'hinhAnh', 'dvt', 'khoiluong', 'dg', 'ckKH', 'dgCK', 'tt', 'ghichu']],
  ['ln', 'Giá & lợi nhuận', ['stt', 'noidung', 'khoiluong', 'dgnt', 'ttnt', 'mkPct', 'dg', 'ckKH', 'dgCK', 'tt', 'markup', 'margin', 'lnvnd']],
  ['gon', 'Tối giản', ['stt', 'noidung', 'dvt', 'khoiluong', 'dgCK', 'tt']],
]
export function ptPresetCols_(list) {
  const want = {}; (list || PT_COLS.map(c => c[0])).forEach(k => { want[k] = 1 }); want.noidung = 1
  const m = {}; PT_COLS.forEach(c => { m[c[0]] = !!want[c[0]] }); return m
}
export function ptSameCols_(a, b) { return PT_COLS.every(c => !!(a || {})[c[0]] === !!(b || {})[c[0]]) }
export function ptKeyLabel_(k) { const c = PT_COLS.filter(x => x[0] === k)[0]; return c ? c[1] : k }
export const PT_BULK_F = [['noidung', 'Tên sản phẩm'], ['moTa', 'Mô tả'], ['maBanVe', 'Mã số bản vẽ'], ['maSP', 'Mã sản phẩm'], ['ncc', 'Nhà cung cấp / nhà thầu'],
  ['dvt', 'Đơn vị tính'], ['dimL', 'L (m)'], ['dimB', 'B (m)'], ['dimH', 'H (m)'], ['heso', 'Hệ số'], ['khoiluong', 'Khối lượng'],
  ['giaNCC', 'Giá cost nhà thầu'], ['ckNT', 'Chiết khấu của nhà thầu (%)'], ['dgnt', 'Giá đại lý'],
  ['mkPct', '% Lợi nhuận / giá vốn mục tiêu'], ['dg', 'Đơn giá (Dezon)'], ['ckKH', 'Chiết khấu cho khách hàng (%)'],
  ['trangThai', 'Trạng thái'], ['ghichu', 'Ghi chú']]
export const PT_CELL_F = { noidung: 'n', moTa: 'moTa', maBanVe: 'maBanVe', maSP: 'maSP', ncc: 'ncc', dvt: 'dvt', dimL: 'cd', dimB: 'cr', dimH: 'cc', heso: 'hs',
  khoiluong: 'kl', giaNCC: 'giaNCC', ckNT: 'ckNT', dgnt: 'dgnt', mkPct: 'mkPct', dg: 'dg', ckKH: 'ckKH', trangThai: 'trangThai', ghichu: 'gc' }
export const PT_NUM_K = { dimL: 1, dimB: 1, dimH: 1, heso: 1, khoiluong: 1, giaNCC: 1, ttCost: 1, ckNT: 1, dgnt: 1, ttnt: 1, mkPct: 1,
  dg: 1, ckKH: 1, dgCK: 1, tt: 1, markup: 1, margin: 1, lnvnd: 1 }
export const PT_SORTKEY = { noidung: 'n', moTa: 'moTa', maBanVe: 'maBanVe', maSP: 'maSP', ncc: 'ncc', dvt: 'dvt', dimL: 'cd', dimB: 'cr', dimH: 'cc', heso: 'hs',
  khoiluong: 'kl', giaNCC: 'giaNCC', ckNT: 'ckNT', dgnt: 'dgnt', dg: 'dg', ckKH: 'ckKH', trangThai: 'trangThai', ghichu: 'gc' }
const PT_SORT_NUM = ['cd', 'cr', 'cc', 'hs', 'kl', 'giaNCC', 'ckNT', 'dgnt', 'dg', 'ckKH']

// giá trị 1 ô theo khoá cột (để lọc & sao chép)
export function ptCellVal_(sec, it, k) {
  const s = v => (v == null ? '' : String(v))
  switch (k) {
    case 'noidung': return String(it.n || '')
    case 'dongSP': return String(sec.t || '').split('\n')[0]
    case 'khoiluong': return s(it._kl)
    case 'ghichu': return String(it.gc || '')
    default: { const f = PT_CELL_F[k]; return f ? s(it[f]) : '' }
  }
}
export function ptRowPass_(filter, sec, it) {
  const f = filter || {}; const ks = Object.keys(f); if (!ks.length) return true
  return ks.every(k => ptCellVal_(sec, it, k).trim() === f[k])
}
// cột này có cột dữ liệu để sửa không (bản gốc chỉ kiểm có nhóm + có trường)
export function ptCellEditable_(phanTho, si, key) {
  const f = PT_CELL_F[key]; if (!f) return false
  return !!(phanTho || [])[si]
}
// Tô màu điều kiện (3 luật như bảng Bóc tách)
export function ptCfClass_(cf, sec, it) {
  const r = cf || {}; let c = ''
  if (sec.mode !== 'item') return ''
  const tt = ptN(it._tt), ttnt = ptN(it._ttnt), dg = ptN(it.dg), kl = ptN(it._kl)
  if (r.ln0 && (tt - ttnt) < 0) c += ' cf-red'
  if (r.noPrice && !dg) c += ' cf-yellow'
  if (r.kl0 && !kl) c += ' cf-grey'
  return c
}
export function ptBlankItem_(sec) {
  if (sec.mode === 'item') return { n: '', dvt: '', kl: 1, dg: 0, gc: '', dgnt: 0 }
  if (sec.mode === 'area' || sec.mode === 'area0') return { n: '', dvt: 'm2', dt: 0, hs: 1, gc: '' }
  return { n: '', dvt: 'gói', gc: '' }
}
// Cột đang hiện theo thứ tự tuỳ biến (order) + chip đang bật (cols)
export function ptVisCols_(order, cols) {
  const by = {}; PT_COLS.forEach(c => { by[c[0]] = c })
  const ord = (order || PT_COLS.map(c => c[0])).slice()
  PT_COLS.forEach(c => { if (ord.indexOf(c[0]) < 0) ord.push(c[0]) })
  return ord.map(k => by[k]).filter(c => c && (!cols || cols[c[0]]))
}
export function ptW_(colW, c) { return (colW && colW[c[0]]) || c[3] }
// sắp xếp các dòng TRONG TỪNG hạng mục; trả [{it, oi}] - oi = index GỐC trong sec.items
export function ptSortItems_(items, sortKey, sortDir) {
  const arr = items.map((it, i) => ({ it, oi: i }))
  if (!sortKey) return arr
  const f = PT_SORTKEY[sortKey]; if (!f) return arr
  const dir = sortDir === 'desc' ? -1 : 1, num = PT_SORT_NUM.indexOf(f) >= 0
  return arr.sort((a, b) => {
    const va = a.it[f], vb = b.it[f]
    if (num) return ((Number(va) || 0) - (Number(vb) || 0)) * dir
    return String(va || '').localeCompare(String(vb || ''), 'vi', { numeric: true }) * dir
  })
}
export function ptPct(v) { v = Number(v) || 0; return v ? (v.toFixed(1) + '%') : '' }

/* ═══ Bảng tính (bangtinh.js) ═══ */
export function btMoney_(v) { v = Math.round(Number(v) || 0); return v ? money(v) : '' }
export function btPct_(v) { v = Number(v) || 0; return v ? (v.toFixed(1).replace('.', ',') + '%') : '' }
export function btQty_(v) { v = Number(v) || 0; return v ? ptQty(v) : '' }
/* Ô dòng nhóm của bảng tính (ptSheetGrid_, phần sv) */
export function ptSheetSecVals_(sec, si, st) {
  const ln = st.tt - st.ttnt, dvtSet = {}
  sec.items.forEach(it => { dvtSet[String(it.dvt || '').trim()] = 1 })
  const mot = Object.keys(dvtSet).length <= 1
  const sumDG = sec.items.reduce((s, it) => s + ptN(it.dg), 0)
  const sumDGCK = sec.items.reduce((s, it) => s + ptN(it._dgCK), 0)
  const dgntSet = {}; sec.items.forEach(it => { dgntSet[ptN(it.dgnt)] = 1 })
  const dk = Object.keys(dgntSet), secDgnt = (dk.length === 1 && ptN(dk[0])) ? ptN(dk[0]) : 0
  return {
    stt: PT_ROMAN[si], noidung: String(sec.t || ''), khoiluong: (st.sumKL && mot) ? btQty_(st.sumKL) : '',
    ttCost: btMoney_(st.ttCost), dgnt: btMoney_(secDgnt), ttnt: btMoney_(st.ttnt), lnvnd: btMoney_(ln),
    margin: st.tt ? btPct_(ln / st.tt * 100) : '', markup: st.ttnt ? btPct_(ln / st.ttnt * 100) : '',
    dg: sec.mode === 'area' ? btMoney_(sec.up) : ((sumDG && mot) ? btMoney_(sumDG) : ''),
    dgCK: sec.mode === 'area' ? '' : ((sumDGCK && mot) ? btMoney_(sumDGCK) : ''), tt: btMoney_(st.tt),
  }
}
const btNum_ = v => (v == null || v === '' ? '' : String(v).replace('.', ','))
/* Ô dòng công tác của bảng tính (ptSheetGrid_, phần v); it đã qua ptSecTotals */
export function ptSheetItemVals_(sec, it, pos) {
  const isItem = sec.mode === 'item', tt = it._tt, ttnt = it._ttnt, l = isItem ? (tt - ttnt) : 0
  const anh = ptInfoImgsRaw_({ anh: it.anh })
  return {
    stt: String(pos + 1), maBanVe: String(it.maBanVe || ''), dongSP: String(sec.t || '').split('\n')[0], maSP: String(it.maSP || ''),
    noidung: String(it.n || ''), moTa: ptMoTaHien_(it.moTa), ncc: String(it.ncc || ''), hinhAnh: anh.length ? (anh.length + ' ảnh') : '', dvt: String(it.dvt || ''),
    dimL: btNum_(it.cd), dimB: btNum_(it.cr), dimH: btNum_(it.cc), heso: btNum_(it.hs),
    khoiluong: btQty_(it._kl), giaNCC: isItem ? btMoney_(it.giaNCC) : '', ttCost: isItem ? btMoney_(it._ttCost) : '',
    ckNT: isItem ? btNum_(it.ckNT) : '', dgnt: btMoney_(it.dgnt), ttnt: isItem ? btMoney_(ttnt) : '',
    mkPct: isItem ? btPct_(ptMkPct_(it)) : '', dg: btMoney_(it.dg), ckKH: isItem ? btNum_(it.ckKH) : '',
    dgCK: isItem ? btMoney_(it._dgCK) : '', tt: isItem ? btMoney_(tt) : '',
    markup: (isItem && ttnt) ? btPct_(l / ttnt * 100) : '', margin: (isItem && tt) ? btPct_(l / tt * 100) : '',
    lnvnd: isItem ? btMoney_(l) : '', trangThai: String(it.trangThai || ''), ghichu: String(it.gc || ''),
  }
}
// Ô này sửa được không (ptSheetSua_): trả tên trường hoặc null. m = {k:'sec'|'it', si}
export function ptSheetSua_(phanTho, m, key) {
  const sec = (phanTho || [])[m.si]; if (!sec) return null
  if (m.k === 'sec') { if (key === 'noidung') return 't'; if (key === 'dg' && sec.mode === 'area') return 'up'; return null }
  const f = PT_CELL_F[key]; if (!f) return null
  if (f === 'n') return f
  return ptCanEditF_(sec, f) ? f : null
}
// cột chỉ nội bộ (giá vốn, lợi nhuận) - theo cột "Ẩn trong xuất báo giá" của file mẫu
export const PT_NOI_BO = { giaNCC: 1, ttCost: 1, ckNT: 1, dgnt: 1, ttnt: 1, mkPct: 1, lnvnd: 1, margin: 1, markup: 1 }

/* ═══ THÔNG TIN CÔNG TÁC (panel chi tiết) ═══ PT_INFO dựng sẵn trong code là {} (phantho.js:1739) */
export const PT_INFO = {}
export function ptInfoKey_(ten) { return String(ten || '').split('\n')[0].trim().toLowerCase() }
// user = phần người dùng tự nhập (projData.ptInfo, dự phòng localStorage qs_ptinfo)
export function ptInfo_(user, ten) {
  const k = ptInfoKey_(ten), a = PT_INFO[k] || {}, b = (user || {})[k] || {}, o = {}
  ;['anh', 'model', 'ts', 'gc', 'pv', 'tl'].forEach(f => { o[f] = (b[f] != null && b[f] !== '') ? b[f] : (a[f] || '') })
  return o
}
export function ptInfoImgsRaw_(inf) {
  return String(inf.anh || '').split(/[\n,]/).map(s => s.trim()).filter(Boolean)
}
/* Dữ liệu của panel chi tiết (ptDetailParts_ không phần HTML) */
export function ptDetailData_(sec, a, ii, ovr, infoUser, contractor) {
  const ten = String(a[0]), dvt = ptVal_(sec, a, 'dvt', ovr); let gc = ptVal_(sec, a, 'gc', ovr)
  const dgBan = (sec.mode === 'area') ? (Number(sec.up) || 0) : ptVal_(sec, a, 'dg', ovr), dgNT = ptVal_(sec, a, 'dgnt', ovr)
  const ctr = ctOf_(a)
  const inf = ctr ? { anh: ctr.hinhAnh || '', model: '', ts: ctr.thongSo || '', gc: '', pv: ctr.phamVi || '', tl: ctr.linkTaiLieu || '' }
    : ptInfo_(infoUser, ten)
  const imgs = ptInfoImgsRaw_(inf)
  const gcGoc = gc; if (inf.gc) gc = inf.gc
  const loai = PT_LOAI.filter(x => x[0] === ptLoaiGop_(sec.loai))[0] || PT_LOAI[0]
  const ln = dgBan - dgNT, lnPct = dgBan ? (ln / dgBan * 100) : 0
  const chinh = [['Tên / model', inf.model || ''], ['Hạng mục', String(sec.t).split('\n')[0]],
    ['Nhà thầu · nhà cung cấp', (ctr && ctr.ncc) || ''],
    ['Đơn vị tính', dvt], ['Loại báo giá', loai[1]], ['Nhà thầu đang chọn', contractor || '']]
  const thieu = []
  if (!imgs.length) thieu.push('ảnh'); if (!inf.ts) thieu.push('thông số kỹ thuật')
  if (!gc) thieu.push('ghi chú'); if (!inf.pv) thieu.push('phạm vi ứng dụng')
  return {
    ten, dvt, gc, gcGoc, dgBan, dgNT, ln, lnPct, ctr, inf, imgs, loai, chinh,
    code: sec.r + '.' + (ii + 1) + ' · ' + String(sec.t).split('\n')[0],
    thieu: thieu.length < 2 ? '' : 'Chưa có ' + thieu.join(' · '),
  }
}
// Thông số: dòng "## nhóm" / "Tên: giá trị" / còn lại là khối chữ (ptSpecRows_) -> [{grp}|{kv:[k,v]}|{notes:[...]}]
export function ptSpecRows_(text) {
  const ls = String(text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean)
  const out = []; let buf = []
  const flush = () => { if (buf.length) { out.push({ notes: buf.slice() }); buf = [] } }
  ls.forEach(l => {
    const g = l.match(/^##\s*(.*)$/)
    if (g) { flush(); out.push({ grp: g[1] || 'Thông số kỹ thuật' }); return }
    const m = l.match(/^([^:：]{2,40})[:：]\s*(.+)$/)
    if (m) { flush(); out.push({ kv: [m[1].trim(), m[2].trim()] }) } else buf.push(l)
  })
  flush()
  return out
}
export function ptLines_(text) { return String(text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean) }
// ptKV_: ghi chú dài xếp chồng
export function ptKvDai_(k, v) { return String(v).length > 20 || String(k).length > 14 }

/* ═══ THƯ VIỆN: đếm / Excel ═══ */
export function ptLibCount_(secs) { return secs.reduce((s, se) => s + se.items.length, 0) }
// spPTAll_: mọi công tác đang hiện của thư viện (bỏ bản dựng sẵn đã thay bằng CSDL)
export function spPTAll_(tpl, ovr) {
  const out = []
  tpl.forEach((sec, si) => {
    if (sec.an) return
    ;(sec.items || []).forEach((a, ii) => {
      out.push({ si, ii, sec, a, loai: sec.loai || 'kt_chitiet', r: sec.r || '', mode: sec.mode,
        nhom: String(sec.t).split('\n')[0], ten: String(a[0]),
        dvt: ptVal_(sec, a, 'dvt', ovr), dg: ptLibDg_(sec, a, ovr), dgnt: ptVal_(sec, a, 'dgnt', ovr),
        kl: ptVal_(sec, a, 'kl', ovr), dt: ptVal_(sec, a, 'dt', ovr), hs: ptVal_(sec, a, 'hs', ovr), gc: ptVal_(sec, a, 'gc', ovr) })
    })
  })
  return out
}
export function ptXlsRows_(rows) {
  return rows.map((r, i) => ({ stt: i + 1, loai: ptLoaiLabel_(r.loai), hangMuc: (r.r ? r.r + '. ' : '') + r.nhom, noiDung: r.ten,
    dvt: r.dvt, khoiLuong: (r.mode === 'item' ? r.kl : ''), dienTich: (r.mode !== 'item' && r.mode !== 'none' ? r.dt : ''),
    heSo: (r.mode !== 'item' && r.mode !== 'none' ? r.hs : ''), dgnt: (r.mode === 'item' ? r.dgnt : ''), dg: r.dg, ghiChu: r.gc }))
}

/* ═══ FORM CÔNG TÁC ═══ */
export const CT_DEMUC_CHON = ['3.2.1', '3.2.2', '3.2.3', '3.2.4', '3.2.5', '3.2.6', '3.2.6.1', '3.2.6.2', '3.2.7', '3.2.8', '3.2.8.1', '3.2.8.2']
export function ctDeMucNhan_(hangMuc) { const c = ctDeMucOf_(hangMuc); return c ? (c + ' ' + nodeName(c)) : '' }
export const CT_MODE_LBL = { item: 'Khối lượng × đơn giá', area: 'Diện tích × hệ số (đơn giá chung của nhóm)',
  area0: 'Chỉ tính khối lượng (chưa có đơn giá)', none: 'Chỉ liệt kê (chưa bao gồm)' }
export const CT_MODES = [['item', 'Khối lượng × đơn giá', 'Đa số công tác: 1 tim cọc, 1 m3 đất…'],
  ['area', 'Diện tích × hệ số', 'Sàn, tầng — đơn giá chung cho cả hạng mục'],
  ['area0', 'Chỉ tính khối lượng', 'Có khối lượng, đơn giá chốt sau'],
  ['none', 'Chỉ liệt kê', 'Hạng mục "chưa bao gồm"']]
export const CT_DVT = ['m', 'm2', 'm3', 'md', 'tim', 'cái', 'bộ', 'gói', 'tấn', 'ngày', 'tháng', 'tầng', 'hệ', 'điểm', 'công', 'ca']
// tpl = bộ mẫu đã gắn công tác CSDL (ctSyncTemplate_)
export function ctHangMucList_(tpl, congTac) {
  const m = {}
  ;(tpl || []).forEach(s => { if (!s.an) m[String(s.t).split('\n')[0]] = 1 })
  ;(congTac || []).forEach(c => { if (c.hangMuc) m[c.hangMuc] = 1 })
  return Object.keys(m).sort((a, b) => a.localeCompare(b, 'vi'))
}
/* Đề mục lớn / nhỏ lưu trong 1 ô text: "## Tên đề mục lớn" rồi các dòng "Tên: giá trị" */
export function ctGrpParse_(txt) {
  const out = []; let cur = null
  String(txt || '').split(/\r?\n/).forEach(raw => {
    const l = raw.trim(); if (!l) return
    // dòng thụt vào = dòng tiếp theo của CÙNG một đề mục nhỏ
    if (/^\s+/.test(raw) && cur && cur.rows.length) { const last = cur.rows[cur.rows.length - 1]; last.v = (last.v ? last.v + '\n' : '') + l; return }
    const m = l.match(/^##\s*(.*)$/)
    if (m) { cur = { t: m[1].trim(), rows: [] }; out.push(cur); return }
    if (!cur) { cur = { t: 'Thông số kỹ thuật', rows: [] }; out.push(cur) }
    const kv = l.match(/^([^:：]{1,60})[:：]\s*(.*)$/)
    cur.rows.push(kv ? { k: kv[1].trim(), v: kv[2].trim() } : { k: '', v: l })
  })
  return out
}
export function ctGrpText_(grps) {
  grps = (grps || []).filter(g => String(g.t || '').trim() || (g.rows || []).some(r => String(r.k || '').trim() || String(r.v || '').trim()))
  return grps.map(g => '## ' + (g.t || 'Thông số kỹ thuật') + '\n'
    + g.rows.filter(r => (r.k || '').trim() || (r.v || '').trim())
      .map(r => {
        const t = (r.k || '').trim() ? ((r.k).trim() + ': ' + (r.v || '').trim()) : (r.v || '').trim()
        return t.split(/\r?\n/).map((x, i) => (i ? ('  ' + x.trim()) : x)).join('\n')
      }).join('\n')).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
// Dòng xem trước của form (ctPrev_): null = chỉ liệt kê
export function ctPrevVals_(mode, kl, dt, hs, dg, nt) {
  if (mode === 'none') return null
  const q = mode === 'item' ? (ptN(kl) || 0) : (ptN(dt) * (ptN(hs) || 0))
  return { kl: q, tt: Math.round(q * dg), ln: Math.round(q * (dg - nt)), pct: dg ? ((dg - nt) / dg * 100) : 0 }
}
// Giá bán lẻ ⟷ %Chiết khấu ⟷ Giá đại lý (ctGiaSync_, phần tính): trả {dg, ck, nt} mới
export function ctGiaSyncVals_(src, dg, ck, nt) {
  if (src === 'dg' || src === 'ck') {
    if (dg && ck) nt = Math.round(dg * (1 - ck / 100))
    else if (dg && !ck && src === 'dg' && nt) ck = ptR2((1 - nt / dg) * 100)
  } else if (src === 'dgnt') {
    if (dg && nt) ck = ptR2((1 - nt / dg) * 100)
  }
  return { dg, ck, nt }
}
export { ptR0, ptHs_, ptAutoKL_, ptSecLoai_, ptLoaiGop_ }
