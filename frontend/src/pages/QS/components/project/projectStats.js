import * as api from '../../api/qsApi'
import { anhUrl_ } from './ProjectImages'
import { projCtx_ } from './projectShell'
import { dashTotals_ } from '../../lib/totals.js'

/* Số dòng báo giá + tổng tiền bán của từng dự án (đọc dòng + dữ liệu rời từng dự án; nhớ trong phiên).
   "Dự án có báo giá" = dự án đã có ít nhất 1 dòng (database chưa có cột đánh dấu đã báo giá, mã báo giá đều trống).
   Một hàng đợi chung cho mọi trang, tối đa 4 dự án đọc cùng lúc. Danh sách lớn (> STAT_AUTO_MAX dự án, vd sau khi nhập dự án
   dezon.vn) không đếm hết khi mở trang: trang chỉ đếm phần đang vẽ, đếm hết khi người dùng dùng bộ lọc / số cần đủ mọi dự án. */
export const statCache = {}
export const STAT_AUTO_MAX = 150
const nccN_ = ls => {
  const m = {}
  ls.forEach(l => { const k = String(l.thuongHieu || '').trim(); if (k) m[k] = (m[k] || 0) + 1 })
  return m
}
const nccOf_ = m => Object.keys(m).sort((a, b) => m[b] - m[a] || a.localeCompare(b, 'vi'))
async function readOne_(x) {
  try {
    const [ls, pd] = await Promise.all([api.getLines(x.maDA), api.getProjData(x.maDA).catch(() => ({}))])
    const anh = Array.isArray(pd && pd.anhDuAn) ? pd.anhDuAn : []
    const nccN = nccN_(ls || [])   // {thương hiệu: số dòng} - trang Nhà cung cấp hiện số sản phẩm của hãng trong từng dự án
    const ncc = nccOf_(nccN)
    /* nhà cung cấp ghi trên dezon.vn (nccDezon, dự án nhập từ dezon.vn): thêm sau thương hiệu của dòng báo giá (không có số dòng) */
    const low = new Set(ncc.map(n => n.toLowerCase()))
    ;(Array.isArray(pd && pd.nccDezon) ? pd.nccDezon : []).forEach(o => {
      const n = String((o && o.ten) || '').trim()
      if (n && !low.has(n.toLowerCase())) { low.add(n.toLowerCase()); ncc.push(n) }
    })
    statCache[x.maDA] = { n: (ls || []).length, tong: (ls || []).reduce((t, l) => t + (Number(l.thanhTienBan) || 0), 0), cover: anhUrl_(anh[0]), nAnh: anh.length, ncc, nccN,
      t: dashTotals_(ls || [], projCtx_(x, pd)) }   // số đủ như Bảng điều khiển (Phần thô, CK báo giá, VAT) - cột trái cộng theo bộ lọc
  } catch (e) { statCache[x.maDA] = { n: 0, tong: 0, err: true, errAt: Date.now() } }
}
/* Số đã đếm còn dùng được: lỗi (mạng / máy chủ bận) thì sau ERR_RETRY ms lần gọi sau đọc lại, không nhớ số 0 cả phiên */
const ERR_RETRY = 30000
const have_ = m => { const st = statCache[m]; return !!st && (!st.err || Date.now() - (st.errAt || 0) < ERR_RETRY) }
/* Danh sách lớn: người dùng đã bấm "Đếm" ở trang Nhà cung cấp / Đơn vị thiết kế -> nhớ trong phiên, các trang đó tự đếm đủ */
let countAll = false
export const countAllOn = () => countAll
export const setCountAll = () => { countAll = true }
/* Hàng đợi chung: jobs = mã -> {x, subs (hàm báo xong của từng người gọi), running}; queue = mã chờ đọc (đầu mảng đọc trước).
   Nhiều trang cùng xin 1 mã thì chỉ đọc 1 lần, mọi người gọi đều được báo khi xong (trang Nhà cung cấp không đếm thiếu
   dự án do Bảng điều khiển đang đọc dở). Mã chờ mà không còn ai xin (trang đã đóng / đổi bộ lọc, signal huỷ) thì bỏ khỏi hàng. */
const CONC = 4
const jobs = new Map()
let queue = []
let running = 0
function pump_() {
  while (running < CONC && queue.length) {
    const ma = queue.shift()
    const j = jobs.get(ma)
    if (!j || j.running) continue
    j.running = true
    running++
    readOne_(j.x).then(() => {
      running--
      if (j.stale) {   // resetStats trong lúc đang đọc: số vừa đọc có thể cũ -> bỏ, đọc lại trước khi báo người chờ
        j.stale = false
        j.running = false
        delete statCache[ma]
        queue.unshift(ma)
      } else {
        jobs.delete(ma)
        j.subs.forEach(f => { try { f() } catch (e) { /* trang chờ đã đóng */ } })
      }
      pump_()
    })
  }
}
/* Đếm các dự án của list chưa có trong statCache; onOne() gọi mỗi khi 1 dự án xong. Trả Promise xong khi đủ hoặc khi huỷ.
   opts.signal (AbortSignal): huỷ = thôi chờ, mã chưa bắt đầu đọc không ai cần nữa thì bỏ. opts.front: xếp lên đầu hàng
   (phần đang hiện trên màn hình đọc trước phần đếm nền). */
export function loadStats_(list, onOne, opts) {
  const sig = opts && opts.signal
  const front = !!(opts && opts.front)
  const need = []
  const seen = new Set()
  ;(list || []).forEach(x => { if (x && x.maDA && !have_(x.maDA) && !seen.has(x.maDA)) { seen.add(x.maDA); need.push(x) } })
  if (!need.length || (sig && sig.aborted)) return Promise.resolve()
  return new Promise(resolve => {
    let left = need.length
    const mine = []
    const stop = () => {
      const drop = new Set()
      mine.forEach(([j, f]) => {
        j.subs.delete(f)
        if (!j.subs.size && !j.running && jobs.get(j.x.maDA) === j) { jobs.delete(j.x.maDA); drop.add(j.x.maDA) }
      })
      if (drop.size) queue = queue.filter(m => !drop.has(m))
      resolve()
    }
    const add = []
    need.forEach(x => {
      let j = jobs.get(x.maDA)
      if (!j) { j = { x, subs: new Set(), running: false }; jobs.set(x.maDA, j); add.push(x.maDA) } else if (front && !j.running) add.push(x.maDA)
      const f = () => { try { onOne() } catch (e) { /* trang đã đóng */ } if (--left <= 0) { if (sig) sig.removeEventListener('abort', stop); resolve() } }
      j.subs.add(f)
      mine.push([j, f])
    })
    if (front) { const s = new Set(add); queue = add.concat(queue.filter(m => !s.has(m))) } else queue = queue.concat(add)
    if (sig) sig.addEventListener('abort', stop, { once: true })
    pump_()
  })
}
/* Số dự án của list đã đếm xong */
export const statCount_ = list => (list || []).reduce((n, x) => n + (statCache[x.maDA] ? 1 : 0), 0)
/* Dòng báo giá của các dự án vừa đổi (Ghi danh / Thêm vào bóc tách): bỏ số đã đếm rồi báo trang đang mở (Nhà cung cấp,
   Danh sách dự án) đếm lại - tab "Dự án đang dùng", chip Nhà cung cấp cập nhật ngay */
const resetSubs = new Set()
export function onStatsReset(fn) { resetSubs.add(fn); return () => { resetSubs.delete(fn) } }
export function resetStats(maDAs) {
  ;(maDAs || []).forEach(m => {
    if (!m) return
    delete statCache[m]
    const j = jobs.get(m)
    if (j && j.running) j.stale = true
  })
  resetSubs.forEach(fn => fn())
}
