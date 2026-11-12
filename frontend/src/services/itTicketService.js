/* Yêu cầu hỗ trợ gửi từ nút "Báo lỗi" (Dezbot) tới phòng IT.
   Trang IT chưa có server nên phiếu lưu ở localStorage của trình duyệt (cùng máy mới thấy);
   trang IT đọc / cập nhật trạng thái + tiến độ, người báo xem lại tiến độ trong hộp Báo lỗi. */
import { TICKETS } from '../data/itData'

const KEY = 'siteflow-it-reported'
const EVT = 'siteflow-it-reported-change'

export function loadReports() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

function saveReports(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { return false }
  window.dispatchEvent(new Event(EVT))
  return true
}

/* Thêm phiếu mới; trả về phiếu đã lưu (null nếu không lưu được, vd ảnh quá lớn) */
export function addReport(data) {
  const list = loadReports()
  const id = Math.max(0, ...TICKETS.map(t => t.id), ...list.map(t => t.id)) + 1
  const today = new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const t = { id, status: 'moi', progress: 0, date: today, createdAt: Date.now(), reported: true, assignee: '', ...data }
  return saveReports([t, ...list]) ? t : null
}

export function updateReport(id, patch) {
  const list = loadReports()
  if (!list.some(t => t.id === id)) return
  saveReports(list.map(t => (t.id === id ? { ...t, ...patch } : t)))
}

/* Báo khi danh sách đổi (cùng tab hoặc tab khác) */
export function subscribeReports(fn) {
  const onStorage = e => { if (e.key === KEY) fn() }
  window.addEventListener(EVT, fn)
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(EVT, fn); window.removeEventListener('storage', onStorage) }
}
