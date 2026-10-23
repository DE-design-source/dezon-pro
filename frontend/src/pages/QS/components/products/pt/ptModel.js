/* Danh sách SP ở chế độ "3.1 Phần thô" - phần không vẽ (port PUB/sanpham.js:1144-1471, 769-781).
   Bảng liệt kê THƯ VIỆN CÔNG TÁC thay cho sản phẩm; nguồn dữ liệu = PT_TEMPLATE (ptTpl_), cột / lọc / tải Excel riêng. */
import { ptLoaiGop_, ctOf_, ptVal_, ptLibDg_, ptOvrDaSua_, ptDaCo_, ptCanEditF_ } from '../../../lib/phantho.js'
import { spNorm_ } from '../../../lib/format.js'
import { lsJson_, ptLoaiLabel_ } from './ptCore'

/* Cột của bảng công tác: [khoá, nhãn, class, thông tin ô sửa] (spPTCols_, sanpham.js:1166-1198) */
export const PT_COLS = [
  { k: 'stt', label: 'STT', cls: 'ct' },
  { k: 'thumb', label: 'Ảnh', cls: 'thumbcol' },
  { k: 'duyet', label: 'Trạng thái', cls: 'ct' },
  { k: 'ten', label: 'Nội dung công việc', cls: 'sp-name' },
  { k: 'loai', label: 'Loại báo giá', cls: 'ct' },
  { k: 'nhom', label: 'Hạng mục', cls: '' },
  { k: 'dvt', label: 'ĐVT', cls: 'ct', e: { f: 'dvt' } },
  { k: 'kl', label: 'Khối lượng mẫu', cls: 'num', e: { f: 'kl', num: 1 } },
  { k: 'dt', label: 'Diện tích mẫu', cls: 'num', e: { f: 'dt', num: 1 } },
  { k: 'hs', label: 'Hệ số', cls: 'num', e: { f: 'hs', num: 1 } },
  { k: 'dgnt', label: 'Đơn giá (nhà thầu)', cls: 'num sp-price', e: { f: 'dgnt', num: 1, money: 1 } },
  { k: 'dg', label: 'Đơn giá', cls: 'num sp-price', e: { f: 'dg', num: 1, money: 1 } },
  { k: 'gc', label: 'Ghi chú', cls: '', e: { f: 'gc' } },
  // M5.3: thứ tự trong thư viện (cùng loại báo giá), chỉ công tác CSDL sửa được
  { k: 'thuTu', label: 'Thứ tự', cls: 'num', e: { f: 'thuTu', num: 1 } },
]
export const PT_SPDEFW = { stt: 52, thumb: 56, duyet: 120, ten: 300, loai: 126, nhom: 180, dvt: 70, kl: 116, dt: 112, hs: 80, dgnt: 156, dg: 140, gc: 260, thuTu: 84 }
export const ptColW_ = (w, k) => (w && w[k]) || PT_SPDEFW[k] || 124
const PT_ON0 = ['thumb', 'duyet', 'loai', 'nhom', 'dvt', 'kl', 'dgnt', 'dg', 'gc', 'thuTu']

/* thứ tự + độ rộng + cột hiện của BẢNG CÔNG TÁC, lưu riêng ở qs_ptcolcfg (ptOrder2_, sanpham.js:769-781) */
export function ptCfgLoad_() {
  const all = PT_COLS.map(c => c.k)
  const j = lsJson_('qs_ptcolcfg', null)
  let order = (j && j.order) || null
  const w = (j && j.w) || {}
  let on = (j && j.on) || null
  if (!order) order = all.slice()
  if (!on) { on = {}; PT_ON0.forEach(k => { on[k] = 1 }) }
  return { order: ptOrderFix_(order), w, on }
}
export function ptOrderFix_(order) {
  const all = PT_COLS.map(c => c.k)
  const o = (order || []).slice(), co = {}
  o.forEach(k => { co[k] = 1 })
  all.forEach(k => { if (!co[k]) { if (k === 'stt') o.unshift(k); else o.push(k) } })
  return o.filter(k => all.indexOf(k) >= 0)
}
/* spSaveCols_ nhánh Phần thô: đang Edit thì lưu bộ cột thật (onBak) */
export function ptCfgSave_(cfg) {
  try { localStorage.setItem('qs_ptcolcfg', JSON.stringify({ order: cfg.order, w: cfg.w || {}, on: (cfg.edit && cfg.onBak) || cfg.on || {} })) } catch (e) { /* bỏ qua */ }
}
export const ptColOn_ = (on, k) => (k === 'ten' || k === 'stt') ? true : !!(on && on[k])
export function ptColList_(order) { const by = {}; PT_COLS.forEach(c => { by[c.k] = c }); return order.map(k => by[k]).filter(Boolean) }
export function ptVisCols_(order, on) { return ptColList_(order).filter(c => ptColOn_(on, c.k)) }
/* COLSET.sp khi đang ở Phần thô (app.js:1658-1664): keys = cột trừ stt/ten, mặc định = tất cả */
export function ptColset_(colList) {
  const keys = () => colList.map(c => c.k).filter(k => k !== 'stt' && k !== 'ten')
  return { ten: 'Danh sách SP', pref: 'spCols', luon: 'ten', keys, macdinh: keys }
}

/* Mỗi dòng = 1 công tác của thư viện (spPTAll_, sanpham.js:1342-1355) */
export function spPTAll_(tpl, ovr) {
  const out = []
  tpl.forEach((sec, si) => {
    if (sec.an) return                       // bản dựng sẵn đã được thay bằng dữ liệu CSDL
    ;(sec.items || []).forEach((a, ii) => {
      out.push({ si, ii, sec, a, loai: sec.loai || 'kt_chitiet', r: sec.r || '', mode: sec.mode,
        nhom: String(sec.t).split('\n')[0], ten: String(a[0]),
        dvt: ptVal_(sec, a, 'dvt', ovr), dg: ptLibDg_(sec, a, ovr), dgnt: ptVal_(sec, a, 'dgnt', ovr),
        kl: ptVal_(sec, a, 'kl', ovr), dt: ptVal_(sec, a, 'dt', ovr), hs: ptVal_(sec, a, 'hs', ovr), gc: ptVal_(sec, a, 'gc', ovr),
        daSua: ptOvrDaSua_(ovr, sec, a) })
    })
  })
  return out
}
/* Lọc theo khung nhìn, bộ lọc công tác, ô tìm (spPTList_, sanpham.js:1356-1375) */
export function spPTList_(all, q, f, view, phanTho) {
  f = f || {}
  q = spNorm_(q || ''); view = view || 'all'
  const mn = Number(f.min) || 0, mx = Number(f.max) || 0
  return all.filter(r => {
    if (view === '__chua') { const c1 = ctOf_(r.a); if (!c1 || c1.daDuyet) return false }
    else if (view === '__da') { const c2 = ctOf_(r.a); if (!c2 || !c2.daDuyet) return false }
    else if (view === '__fav') { const c3 = ctOf_(r.a); if (!c3 || !c3.yeuThich) return false }
    if (f.ptLoai && ptLoaiGop_(r.loai) !== ptLoaiGop_(f.ptLoai)) return false
    if (f.ptNhom && r.nhom !== f.ptNhom) return false
    if (f.ptDvt && r.dvt !== f.ptDvt) return false
    if (f.ptSua === '1' && !r.daSua) return false
    if (f.ptDa === '1' && !ptDaCo_(r.sec, r.a, phanTho)) return false
    if (f.ptDa === '0' && ptDaCo_(r.sec, r.a, phanTho)) return false
    if (mn && r.dg < mn) return false
    if (mx && r.dg > mx) return false
    if (q && spNorm_(r.ten + ' ' + r.nhom + ' ' + r.gc + ' ' + r.dvt).indexOf(q) < 0) return false
    return true
  })
}
export const ptSelKey_ = r => 'pt|' + r.si + '|' + r.ii
/* 4 khung nhìn như Thiết bị đèn (spPTTabs_, sanpham.js:1377-1392) */
export function ptTabs_(all) {
  const db = all.filter(r => ctOf_(r.a))
  const chua = db.filter(r => !ctOf_(r.a).daDuyet).length
  const da = db.filter(r => ctOf_(r.a).daDuyet).length
  const fav = db.filter(r => ctOf_(r.a).yeuThich).length
  return [['all', 'Tất cả', all.length], ['__chua', 'Chưa duyệt', chua], ['__da', 'Đã duyệt', da], ['__fav', '★ Yêu thích', fav]]
}
export const PT_FLT_KEYS = ['ptLoai', 'ptDvt', 'ptNhom', 'ptDa', 'ptSua', 'min', 'max']
export function ptFltCount_(f) { f = f || {}; let n = 0; PT_FLT_KEYS.forEach(k => { if (f[k]) n++ }); return n }
/* Dòng gửi /export/cong-tac (ptXlsRows_, sanpham.js:1300-1307) */
export function ptXlsRows_(rows) {
  return rows.map((r, i) => ({ stt: i + 1, loai: ptLoaiLabel_(r.loai), hangMuc: (r.r ? r.r + '. ' : '') + r.nhom, noiDung: r.ten,
    dvt: r.dvt, khoiLuong: (r.mode === 'item' ? r.kl : ''), dienTich: (r.mode !== 'item' && r.mode !== 'none' ? r.dt : ''),
    heSo: (r.mode !== 'item' && r.mode !== 'none' ? r.hs : ''), dgnt: (r.mode === 'item' ? r.dgnt : ''), dg: r.dg, ghiChu: r.gc }))
}
/* Ô sửa được ở chế độ Edit (spCellEditable_ nhánh Phần thô) */
export const ptCellEditable_ = (c, r) => !!c.e && (c.e.f === 'thuTu' ? !!ctOf_(r.a) : ptCanEditF_(r.sec, c.e.f))
/* Giá trị đang có của 1 ô sửa được: Thứ tự lấy từ công tác CSDL, còn lại theo ptVal_ (có giá sửa tay) */
export function ptCellVal_(r, f, ovr) {
  if (f === 'thuTu') { const c = ctOf_(r.a); return c ? (Number(c.thuTu) || 0) : '' }
  return ptVal_(r.sec, r.a, f, ovr)
}
/* Ảnh đầu của công tác: bản CSDL lấy hinhAnh, bản dựng sẵn lấy ptInfo (ptAnh_ / ptAnh1_) */
export function ptAnh1Raw_(r, info) {
  const c = ctOf_(r.a)
  const s = c ? String(c.hinhAnh || '') : String((info || {}).anh || '')
  return s.split(/[\n,]/).map(x => x.trim()).filter(Boolean)[0] || ''
}
