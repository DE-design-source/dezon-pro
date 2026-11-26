/* Trạng thái form Nhập công tác Phần thô (S._ctPending / S._ctPendEdit / S._ctSessionAdded / S._ctGhi / S._ctGrp.imp / S._imgMain /
   S._imgList / S._committing của bản gốc, PUB/nhap.js:872-1025), giữ ở cấp module như importStore: rời tab / rời /qs rồi quay lại vẫn còn
   form đang gõ, danh sách chờ, danh sách vừa lưu. Đổi tài khoản / công ty xem hoặc đăng xuất thì xoá sạch (cùng khoá với importStore).
   Số công tác đang chờ ghi sang importStore.ctPendingN để cảnh báo rời trang (beforeunload ở ImportTab). */
import { useSyncExternalStore } from 'react'
import { getState as qsGet, subscribe as qsSub } from '../../../state/store'
import { money, ptN, ptR2, ptMoneyN_ } from '../../../lib/format.js'
import { ptLoaiGop_ } from '../../../lib/phantho.js'
import { ctGrpParse_ } from '../../products/pt/ptCore'
import { impSet } from '../importStore'

let formSeq = 0
const s_ = v => (v == null ? '' : String(v))
const empRows = () => [{ k: '', v: '' }, { k: '', v: '' }, { k: '', v: '' }]

/* Giá bán lẻ ⟷ %Chiết khấu ⟷ Giá đại lý: gõ ô nào cũng tự tính 2 ô còn lại (ctGiaSync_, PUB/phantho.js:1009-1023).
   src = 'dg' | 'ck' | 'dgnt' | '' (chuẩn hoá cả 3 ô) */
export function ctGiaSync_(d, src) {
  let dg = ptMoneyN_(d.dg), nt = ptMoneyN_(d.dgnt), ck = ptN(String(d.ck).replace(',', '.'))
  if (src === 'dg' || src === 'ck') {
    if (dg && ck) nt = Math.round(dg * (1 - ck / 100))
    else if (dg && !ck && src === 'dg' && nt) ck = ptR2((1 - nt / dg) * 100)
  } else if (src === 'dgnt') {
    if (dg && nt) ck = ptR2((1 - nt / dg) * 100)
  }
  const o = { ...d }
  if (src !== 'dgnt') o.dgnt = nt ? money(nt) : ''
  if (src !== 'ck') o.ck = (ck || ck === 0) ? String(ck) : ''
  if (src !== 'dg') o.dg = dg ? money(dg) : ''
  return o
}

/* Form mới từ 1 công tác c (rỗng = form trống): ctFormHtml2_ + ctFormInit_ ('imp') */
// trong = dòng nhập từ file còn lỗi (M5.1): Loại báo giá / Cách tính đọc không được thì để TRỐNG, bắt người dùng chọn lại
export function newForm_(c, ghi, trong) {
  c = c || {}
  const dg = Number(c.dg) || 0, dgnt = Number(c.dgnt) || 0, ck = (dg && dgnt) ? ptR2((1 - dgnt / dg) * 100) : ''
  const anh = String(c.hinhAnh || '').split('\n').map(x => x.trim()).filter(Boolean)
  let grps = ctGrpParse_(c.thongSo || '')
  if (!grps.length) grps = [{ t: '', rows: empRows() }]
  const d = ctGiaSync_({
    ten: s_(c.ten), ncc: s_(c.ncc), hangMuc: s_(c.hangMuc), deMuc: s_(c.deMuc),
    dg: dg ? money(dg) : '', ck: ck === '' ? '' : String(ck), dgnt: dgnt ? money(dgnt) : '', dvt: s_(c.dvt),
    loai: (trong && !c.loai) ? '' : ptLoaiGop_(c.loai), loaiGoc: s_(c.loai), mode: c.mode || (trong ? '' : 'item'), maNhom: s_(c.maNhom),
    kl: c.kl == null ? '' : s_(c.kl), dt: c.dt == null ? '' : s_(c.dt), hs: c.hs == null ? '' : s_(c.hs),
    gc: s_(c.gc), phamVi: s_(c.phamVi), linkTaiLieu: s_(c.linkTaiLieu), thuTu: c.thuTu == null ? '' : s_(c.thuTu), maSP: s_(c.maSP),
  }, '')
  return { seq: ++formSeq, d, grps, main: anh[0] || '', list: anh.slice(1), ghi: !!ghi }
}

function initial(key) {
  return { key, form: newForm_(null, false), ghiAll: false, pending: [], pendEdit: null, sessionAdded: [], committing: false, commitText: '' }
}
const sessKey_ = q => (q.me ? String(q.me.id || q.me.username || '') + '|' + (q.viewAs || '') : '')
let S = initial(sessKey_(qsGet()))
const subs = new Set()
export function ctGet() { return S }
export function ctSet(patch) {
  const prevN = (S.pending || []).length
  S = { ...S, ...(typeof patch === 'function' ? patch(S) : patch) }
  const n = (S.pending || []).length
  if (n !== prevN) impSet({ ctPendingN: n })
  subs.forEach(fn => fn())
}
export function ctForm(fn) { ctSet(s => ({ form: { ...s.form, ...fn(s.form) } })) }
export function useCtImp(sel) {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, () => sel(S), () => sel(S))
}
qsSub(() => {
  const k = sessKey_(qsGet())
  if (k !== S.key) { S = initial(k); subs.forEach(fn => fn()) }
})
let pendSeq = 0
export const ctPendUid_ = () => 'c' + (++pendSeq)
