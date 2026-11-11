/* Trạng thái tab Nhập dữ liệu, giữ ở cấp module (như S._pending / S._sessionAdded / S._impLoai của bản gốc, PUB/nhap.js).
   Rời /qs rồi quay lại vẫn còn form đang gõ, danh sách chờ và danh sách "vừa nhập" (PLAN 1.5: tab này giữ form chưa lưu).
   Đổi tài khoản / công ty đang xem hoặc đăng xuất thì xoá sạch, như tải lại trang ở bản gốc. */
import { useSyncExternalStore } from 'react'
import { getState as qsGet, subscribe as qsSub } from '../../state/store'

const VARS0 = { varKelvin: '', varWatt: '', varAngle: '', varColor: '', varSize: '' }
let formSeq = 0
let pendSeq = 0
export function emptyForm_() {
  // ghi.ds = danh sách mã dự án ghi danh; null = theo dự án đang mở (bản gốc chọn sẵn S.cur lúc vẽ form)
  return { seq: ++formSeq, vals: {}, imgMain: '', imgList: [], combo: [], vars: { ...VARS0 }, varImg: {}, varMeta: {}, ghi: { on: false, ds: null, qty: '1' } }
}
function initial(key) {
  return {
    key,
    loai: 'sp',
    form: emptyForm_(),
    pending: [],
    sessionAdded: [],
    pendEdit: null,
    committing: false,
    commitText: '',
    imgUploading: 0,
    bulk: { products: [], headers: [], nganh: '', res: null, msg: null, ver: 0, fileSeq: 0, ghi: { on: false, ds: null, qty: '1' } },
    // Số công tác đang chờ lưu của form Phần thô (importer/pt, Batch 3B ghi vào đây) -> cảnh báo rời trang như S._ctPending
    ctPendingN: 0,
  }
}

/* Giữ qua TẢI LẠI TRANG (localStorage, theo tài khoản + công ty đang xem): ngành đang chọn, form đang gõ, danh sách chờ lưu,
   danh sách "vừa nhập". Không giữ: bảng xem trước nhập file (có thể rất lớn), trạng thái đang lưu / đang tải ảnh.
   Ảnh tạm data: (chưa tải xong) bị bỏ khi ghi. Đầy bộ nhớ trình duyệt thì thôi không ghi, trang vẫn chạy như cũ. */
const LS_ = key => 'qs_imp_' + key
const noData_ = v => (typeof v === 'string' && v.indexOf('data:') === 0 ? '' : v)
function snap_(s) {
  const f = s.form || {}
  const vi = {}; Object.keys(f.varImg || {}).forEach(k => { vi[k] = noData_(f.varImg[k]) })
  return { v: 1, loai: s.loai, pending: s.pending, sessionAdded: s.sessionAdded,
    form: { ...f, imgMain: noData_(f.imgMain), imgList: (f.imgList || []).filter(x => noData_(x)), varImg: vi } }
}
function restore_(key) {
  if (!key) return null
  try {
    const j = JSON.parse(localStorage.getItem(LS_(key)) || 'null')
    if (!j || j.v !== 1) return null
    const s = initial(key)
    if (j.loai) s.loai = j.loai
    if (Array.isArray(j.pending)) s.pending = j.pending
    if (Array.isArray(j.sessionAdded)) s.sessionAdded = j.sessionAdded
    if (j.form && typeof j.form === 'object') s.form = { ...emptyForm_(), ...j.form, seq: ++formSeq }
    // uid dòng chờ khôi phục: đặt bộ đếm cao hơn để dòng mới không trùng uid
    s.pending.forEach(x => { const n = Number(String(x.uid || '').slice(1)); if (n > pendSeq) pendSeq = n })
    return s
  } catch (e) { return null }
}
let saveT = null
function saveSoon_() {
  if (!S.key) return
  clearTimeout(saveT)
  saveT = setTimeout(() => {
    try { localStorage.setItem(LS_(S.key), JSON.stringify(snap_(S))) } catch (e) { /* đầy / bị chặn: bỏ qua */ }
  }, 400)
}

let S = initial('')
const subs = new Set()
export function impGet() { return S }
export function impSet(patch) {
  S = { ...S, ...(typeof patch === 'function' ? patch(S) : patch) }
  subs.forEach(fn => fn())
  saveSoon_()
}
export function impForm(fn) { impSet(s => ({ form: { ...s.form, ...fn(s.form) } })) }
function subscribe(fn) { subs.add(fn); return () => subs.delete(fn) }
export function useImp(sel) {
  return useSyncExternalStore(subscribe, () => sel(S), () => sel(S))
}
/* Khoá phiên = tài khoản + công ty đang xem; khác khoá cũ thì làm mới toàn bộ */
export function impEnsureKey(key) {
  if (S.key !== key) { S = restore_(key) || initial(key); subs.forEach(fn => fn()) }
}
/* Theo id người dùng, không theo token: hết phiên rồi đăng nhập lại đúng người đó thì bản gốc chỉ hiện màn đăng nhập
   (showLogin_, PUB/app.js:2456), form + danh sách chờ còn nguyên. Đăng xuất (me = null) = tải lại trang ở bản gốc -> xoá. */
const sessKey_ = q => (q.me ? String(q.me.id || q.me.username || '') + '|' + (q.viewAs || '') : '')
impEnsureKey(sessKey_(qsGet()))
qsSub(() => impEnsureKey(sessKey_(qsGet())))

/* renderImport của bản gốc dựng lại cả thẻ "Nhập hàng loạt": bảng xem trước mất, ô chọn file trống (PUB/nhap.js:851-862) */
export function bulkCleared_(b) {
  return { ...b, products: [], headers: [], nganh: '', res: null, msg: null, fileSeq: ((b && b.fileSeq) || 0) + 1 }
}

/* upBusy_ / waitUploads_ (PUB/nhap.js:1115-1117): đếm ảnh / file đang tải để nút Lưu đợi xong */
export function upBusy_(d) { impSet(s => ({ imgUploading: Math.max(0, (s.imgUploading || 0) + d) })) }
export async function waitUploads_(timeout) {
  const t0 = Date.now()
  while ((S.imgUploading || 0) > 0 && Date.now() - t0 < (timeout || 15000)) await new Promise(r => setTimeout(r, 250))
}

export function pendUid_() { return 'p' + (++pendSeq) }
export function pendingAdd_(items) {
  (items || []).forEach(x => { if (!x.uid) x.uid = pendUid_() })
  impSet(s => ({ pending: (items || []).concat(s.pending || []) }))
}
export function nowIsoClient_() { try { return new Date().toISOString() } catch (e) { return '' } }
export function sessionAdd_(o) {
  impSet(s => ({
    sessionAdded: [{ ten: o.ten || '', ma: o.ma || '', thuongHieu: o.thuongHieu || '', ncc: o.ncc || '',
      hinhAnh: o.hinhAnh || '', capNhat: o.capNhat || nowIsoClient_(), nhieuBienThe: !!o.nhieuBienThe }].concat(s.sessionAdded || []),
  }))
}
