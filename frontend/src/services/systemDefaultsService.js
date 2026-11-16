import { useSyncExternalStore } from 'react'
import { request, readToken, apiConfigured } from '../pages/QS/api/http'

/* Mặc định toàn hệ thống do Siêu quản trị viên lưu (N17): GET /api/v1/system-defaults (mọi tài khoản đã đăng nhập),
   PUT /api/v1/system-defaults/:section (chỉ super). 3 mục: appearance (giao diện), general (cài đặt người dùng
   "siteflow-settings"), display (tab ẩn trên menu). Người dùng tự đổi thì giá trị riêng của họ thắng mặc định.
   Bản tải về lưu đệm ở localStorage để áp ngay lúc tải trang (index.html đọc mục appearance trước khi vẽ). */
const LS = 'siteflow-sys-defaults'
export const SYS_SECTIONS = ['appearance', 'general', 'display']

const EMPTY = { appearance: null, general: null, display: null, updatedAt: null, updatedBy: null }
function read() {
  try {
    const v = JSON.parse(localStorage.getItem(LS) || 'null')
    return v && typeof v === 'object' ? { ...EMPTY, ...v } : EMPTY
  } catch { return EMPTY }
}
let cur = read()
const subs = new Set()
const emit = () => subs.forEach(fn => fn())
function subscribe(fn) {
  subs.add(fn)
  const onStorage = e => { if (e.key === LS) { cur = read(); emit() } }
  window.addEventListener('storage', onStorage)
  return () => { subs.delete(fn); window.removeEventListener('storage', onStorage) }
}
function store(v) {
  cur = { ...EMPTY, ...(v || {}) }
  try { localStorage.setItem(LS, JSON.stringify(cur)) } catch { /* bỏ qua */ }
  emit()
}

export const getSysDefaults = () => cur
export const subscribeSysDefaults = subscribe
export function useSysDefaults() { return useSyncExternalStore(subscribe, getSysDefaults, getSysDefaults) }
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
export const sysSection = (sec, d = cur) => obj(d && d[sec])

/* Tải lại từ máy chủ. Chưa đăng nhập / máy chủ chưa có route / lỗi mạng: giữ bản đệm, không báo lỗi */
let inflight = null
export function loadSysDefaults() {
  if (!apiConfigured() || !readToken()) return Promise.resolve(cur)
  if (inflight) return inflight
  inflight = request('GET', '/system-defaults', { noLog: true })
    .then(r => { if (r && typeof r === 'object') store(r); return cur }, () => cur)
    .finally(() => { inflight = null })
  return inflight
}

/* Chỉ super: lưu (value = object) hoặc bỏ (value = null) mặc định của 1 mục rồi tải lại */
export async function saveSysDefault(section, value) {
  await request('PUT', '/system-defaults/' + encodeURIComponent(section), { body: { value } })
  return loadSysDefaults()
}
