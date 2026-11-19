import * as api from '../../api/qsApi'
import { anhUrl_ } from './ProjectImages'
import { projCtx_ } from './projectShell'
import { dashTotals_ } from '../../lib/totals.js'

/* Số dòng báo giá + tổng tiền bán của từng dự án (đếm khi mở trang, đọc dòng từng dự án, tối đa 4 yêu cầu cùng lúc; nhớ trong phiên).
   "Dự án có báo giá" = dự án đã có ít nhất 1 dòng (database chưa có cột đánh dấu đã báo giá, mã báo giá đều trống) */
export const statCache = {}
const nccN_ = ls => {
  const m = {}
  ls.forEach(l => { const k = String(l.thuongHieu || '').trim(); if (k) m[k] = (m[k] || 0) + 1 })
  return m
}
const nccOf_ = m => Object.keys(m).sort((a, b) => m[b] - m[a] || a.localeCompare(b, 'vi'))
/* Mã đang đọc -> danh sách hàm báo xong: lần gọi sau (trang khác, đổi bộ lọc) không đọc trùng nhưng vẫn được báo khi mã đó
   đọc xong (trước đây chỉ người gọi đầu được báo -> trang Nhà cung cấp đếm thiếu dự án do Bảng điều khiển đang đọc dở) */
const busy = new Map()
export async function loadStats_(list, onOne) {
  const todo = list.filter(x => !statCache[x.maDA] && !busy.has(x.maDA))
  const waits = list.filter(x => !statCache[x.maDA] && busy.has(x.maDA)).map(x => new Promise(res => { busy.get(x.maDA).push(() => { onOne(); res() }) }))
  todo.forEach(x => busy.set(x.maDA, []))
  async function worker() {
    while (i < todo.length) {
      const x = todo[i++]
      try {
        const [ls, pd] = await Promise.all([api.getLines(x.maDA), api.getProjData(x.maDA).catch(() => ({}))])
        const anh = Array.isArray(pd && pd.anhDuAn) ? pd.anhDuAn : []
        const nccN = nccN_(ls || [])   // {thương hiệu: số dòng} - trang Nhà cung cấp hiện số sản phẩm của hãng trong từng dự án
        statCache[x.maDA] = { n: (ls || []).length, tong: (ls || []).reduce((t, l) => t + (Number(l.thanhTienBan) || 0), 0), cover: anhUrl_(anh[0]), nAnh: anh.length, ncc: nccOf_(nccN), nccN,
          t: dashTotals_(ls || [], projCtx_(x, pd)) }   // số đủ như Bảng điều khiển (Phần thô, CK báo giá, VAT) - cột trái cộng theo bộ lọc
      } catch (e) { statCache[x.maDA] = { n: 0, tong: 0, err: true } }
      const ws = busy.get(x.maDA) || []
      busy.delete(x.maDA)
      onOne()
      ws.forEach(f => { try { f() } catch (e) { /* trang chờ đã đóng */ } })
    }
  }
  let i = 0
  await Promise.all([0, 1, 2, 3].map(worker).concat(waits))
}
/* Dòng báo giá của các dự án vừa đổi (Ghi danh / Thêm vào bóc tách): bỏ số đã đếm rồi báo trang đang mở (Nhà cung cấp,
   Danh sách dự án) đếm lại - tab "Dự án đang dùng", chip Nhà cung cấp cập nhật ngay */
const resetSubs = new Set()
export function onStatsReset(fn) { resetSubs.add(fn); return () => { resetSubs.delete(fn) } }
export function resetStats(maDAs) {
  ;(maDAs || []).forEach(m => { if (m) delete statCache[m] })
  resetSubs.forEach(fn => fn())
}
