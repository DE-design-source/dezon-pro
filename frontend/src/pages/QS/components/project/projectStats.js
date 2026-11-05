import * as api from '../../api/qsApi'
import { anhUrl_ } from './ProjectImages'
import { projCtx_ } from './projectShell'
import { dashTotals_ } from '../../lib/totals.js'

/* Số dòng báo giá + tổng tiền bán của từng dự án (đếm khi mở trang, đọc dòng từng dự án, tối đa 4 yêu cầu cùng lúc; nhớ trong phiên).
   "Dự án có báo giá" = dự án đã có ít nhất 1 dòng (database chưa có cột đánh dấu đã báo giá, mã báo giá đều trống) */
export const statCache = {}
const nccOf_ = ls => {
  const m = {}
  ls.forEach(l => { const k = String(l.thuongHieu || '').trim(); if (k) m[k] = (m[k] || 0) + 1 })
  return Object.keys(m).sort((a, b) => m[b] - m[a] || a.localeCompare(b, 'vi'))
}
const busy = new Set()   // mã đang đọc: lần gọi sau (đổi bộ lọc) không đọc trùng
export async function loadStats_(list, onOne) {
  const todo = list.filter(x => !statCache[x.maDA] && !busy.has(x.maDA))
  todo.forEach(x => busy.add(x.maDA))
  let i = 0
  async function worker() {
    while (i < todo.length) {
      const x = todo[i++]
      try {
        const [ls, pd] = await Promise.all([api.getLines(x.maDA), api.getProjData(x.maDA).catch(() => ({}))])
        const anh = Array.isArray(pd && pd.anhDuAn) ? pd.anhDuAn : []
        statCache[x.maDA] = { n: (ls || []).length, tong: (ls || []).reduce((t, l) => t + (Number(l.thanhTienBan) || 0), 0), cover: anhUrl_(anh[0]), nAnh: anh.length, ncc: nccOf_(ls || []),
          t: dashTotals_(ls || [], projCtx_(x, pd)) }   // số đủ như Bảng điều khiển (Phần thô, CK báo giá, VAT) - cột trái cộng theo bộ lọc
      } catch (e) { statCache[x.maDA] = { n: 0, tong: 0, err: true } }
      busy.delete(x.maDA)
      onOne()
    }
  }
  await Promise.all([0, 1, 2, 3].map(worker))
}
