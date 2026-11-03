/* Hàm thuần cho đăng nhập bằng QR + bảng thiết bị (API.md "Đăng nhập bằng QR", "Đa thiết bị").
   Mã QR = 10 ký tự Crockford base32 (0-9 A-Z bỏ I L O U), hiển thị ABCDE-FGHJK. Nội dung QR = <origin>/chat/qr#<mã>. */

export const QR_CODE_LEN = 10
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/

/* Mã gõ tay: bỏ khoảng trắng / gạch nối, chữ hoa, O -> 0, I / L -> 1 (như máy chủ). Sai dạng -> '' */
function normalizeCode(s) {
  const c = String(s || '').replace(/[\s\-_.]/g, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1')
  return CODE_RE.test(c) ? c : ''
}

/* Chữ đọc được từ QR / ô nhập -> mã chuẩn hoá hoặc ''. Nhận: mã trần (có / không gạch nối) hoặc link
   .../chat/qr#<mã> (cả ?code=<mã>). Link khác (QR của trang web bất kỳ) -> ''. */
export function parseQrText(text) {
  const t = String(text || '').trim()
  if (!t) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) {
    let u
    try { u = new URL(t) } catch (e) { return '' }
    if (!/\/chat\/qr\/?$/.test(u.pathname)) return ''
    const fromHash = normalizeCode(decodeURIComponent(u.hash.replace(/^#/, '')))
    return fromHash || normalizeCode(u.searchParams.get('code') || '')
  }
  if (t.length > 40) return ''
  return normalizeCode(t)
}

/* ABCDEFGHJK -> ABCDE-FGHJK (chuỗi khác độ dài: giữ nguyên, chữ hoa) */
export function formatQrCode(code) {
  const c = String(code || '').replace(/[\s-]/g, '').toUpperCase()
  return c.length === QR_CODE_LEN ? c.slice(0, 5) + '-' + c.slice(5) : c
}

/* Nội dung QR của máy đang chờ: mở bằng camera thường của điện thoại -> trang xác nhận */
export const qrLoginUrl = (origin, code) => String(origin || '') + '/chat/qr#' + String(code || '')

/* Đếm ngược m:ss (âm -> 0:00) */
export function countdownLabel(sec) {
  const s = Math.max(0, Math.ceil(Number(sec) || 0))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

const pad = n => String(n).padStart(2, '0')

/* 14:30 03/11/2026 (giờ máy); sai dạng -> '' */
export function dateTimeLabel(iso) {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return ''
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear()
}

const PLATFORMS = { web: 'Trình duyệt web', android: 'Android', ios: 'iOS', desktop: 'Máy tính' }
export const platformLabel = p => PLATFORMS[p] || (p ? String(p) : 'Không rõ')

export const loginMethodLabel = m => (m === 'qr' ? 'Đăng nhập bằng mã QR' : 'Đăng nhập bằng mã xác thực')

/* "Hoạt động 5 phút trước" của thiết bị; online -> "Đang hoạt động" */
export function deviceSeenLabel(d, now = Date.now()) {
  if (!d) return ''
  if (d.online) return 'Đang hoạt động'
  const t = Date.parse(d.last_seen_at)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.floor((now - t) / 1000))
  if (s < 60) return 'Hoạt động vừa xong'
  if (s < 3600) return `Hoạt động ${Math.floor(s / 60)} phút trước`
  if (s < 86400) return `Hoạt động ${Math.floor(s / 3600)} giờ trước`
  if (s < 30 * 86400) return `Hoạt động ${Math.floor(s / 86400)} ngày trước`
  return 'Hoạt động ' + dateTimeLabel(d.last_seen_at)
}

/* Thiết bị hiện tại trước, rồi last_seen_at mới trước (máy chủ đã xếp; giữ ổn định nếu thiếu) */
export function sortDevices(list) {
  return (Array.isArray(list) ? list : []).slice().sort((a, b) => {
    if (!!a.current !== !!b.current) return a.current ? -1 : 1
    return (Date.parse(b.last_seen_at) || 0) - (Date.parse(a.last_seen_at) || 0)
  })
}

/* Thông báo ở cổng sau khi bị đăng xuất mà người dùng không tự bấm (thiết bị bị đăng xuất từ xa / phiên bị thu hồi).
   chatApi.removeAccount ghi dấu chat_removed:<id> = thời điểm bỏ; confirmSignOut ghi chat_self_signout:<id> trước khi
   tự đăng xuất. Dấu bỏ mới (< 2 phút), không có dấu tự đăng xuất tương ứng, chưa báo -> báo một lần. */
const REMOVED_PREFIX = 'chat_removed:'
const SELF_PREFIX = 'chat_self_signout:'
const SEEN_KEY = 'chat_forced_notice_seen'
const NOTICE_WINDOW_MS = 120000

export function markSelfSignOut(uid) {
  if (!uid) return
  try { localStorage.setItem(SELF_PREFIX + uid, String(Date.now())) } catch (e) { /* bỏ qua */ }
}

/* Trả true nếu vừa có tài khoản bị đăng xuất từ xa (và đánh dấu đã báo) */
export function takeForcedSignOutNotice(now = Date.now()) {
  try {
    const seen = Number(localStorage.getItem(SEEN_KEY)) || 0
    let latest = 0
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || k.indexOf(REMOVED_PREFIX) !== 0) continue
      const at = Number(localStorage.getItem(k)) || 0
      if (!at || at <= seen || now - at > NOTICE_WINDOW_MS) continue
      const self = Number(localStorage.getItem(SELF_PREFIX + k.slice(REMOVED_PREFIX.length))) || 0
      if (self && at - self < NOTICE_WINDOW_MS && at >= self) continue
      latest = Math.max(latest, at)
    }
    if (!latest) return false
    localStorage.setItem(SEEN_KEY, String(latest))
    return true
  } catch (e) {
    return false
  }
}
