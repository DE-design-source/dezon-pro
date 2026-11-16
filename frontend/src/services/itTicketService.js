/* Yêu cầu hỗ trợ gửi từ nút "Báo lỗi" (Dezbot) tới phòng IT: lớp mỏng trên REST /api/v1/it/tickets (pages/IT/api.js).
   Phiếu lưu trên máy chủ (source 'report'); trang IT cập nhật trạng thái + tiến độ, người báo xem lại ở tab "Đã gửi". */
import { createTicket, listMyTickets } from '../pages/IT/api'
import { readToken } from '../pages/QS/api/http'

const EVT = 'siteflow-it-reported-change'
export const MAX_IMAGE_BYTES = 8 << 20   // máy chủ nhận tối đa 8 MB / ảnh (sau giải mã base64)

export const isLoggedIn = () => !!readToken()
/* Số byte thật của data URL base64 */
export function dataUrlBytes(u) {
  const i = String(u || '').indexOf(',')
  if (i < 0) return 0
  const b64 = u.slice(i + 1)
  return Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0)
}

/* data: {title, desc, priority, category, requester, requesterUsername, page, images: [{name, data: dataURL}]}.
   Trả về phiếu máy chủ (fromServer); lỗi ném lại (reportErrorText đổi thành câu tiếng Việt) */
export async function addReport(data) {
  const t = await createTicket({
    title: data.title, desc: data.desc || '', priority: data.priority, category: data.category,
    requester: data.requester || '', requesterUsername: data.requesterUsername || '',
    images: (data.images || []).slice(0, 8), source: 'report', page: data.page || '',
  })
  try { window.dispatchEvent(new Event(EVT)) } catch { /* bỏ qua */ }
  return t
}

/* Phiếu người đang đăng nhập đã gửi, mới nhất trước */
export const loadReports = () => listMyTickets()

/* Báo khi vừa gửi xong phiếu (trong trang) + hỏi lại định kỳ (mặc định 30 s, bỏ qua khi tab đang ẩn).
   Gọi khi hộp Báo lỗi đang mở; trả về hàm huỷ */
export function subscribeReports(fn, interval = 30000) {
  window.addEventListener(EVT, fn)
  const timer = interval > 0 ? setInterval(() => { if (!document.hidden) fn() }, interval) : null
  return () => { window.removeEventListener(EVT, fn); if (timer) clearInterval(timer) }
}

/* Lỗi gọi API -> câu tiếng Việt cho người báo */
export function reportErrorText(e) {
  const n = e && e.name
  if (n === 'QsAuthError') return 'Phiên đăng nhập đã hết, mời đăng nhập lại rồi gửi lại.'
  if (n === 'QsUnreachableError') return 'Không kết nối được máy chủ. Kiểm tra mạng rồi bấm gửi lại.'
  if (n === 'QsNotConfiguredError') return 'Chưa cấu hình địa chỉ máy chủ (VITE_API_URL).'
  if (e && e.status === 413) return 'Ảnh quá lớn, máy chủ không nhận. Thử chụp lại vùng nhỏ hơn.'
  if (e && e.status >= 500 && /^HTTP \d+$/.test(e.message || '')) return 'Máy chủ đang lỗi (' + e.message + '), thử lại sau.'
  return (e && e.message) || 'Không gửi được, thử lại sau.'
}
