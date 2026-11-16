import { useSyncExternalStore } from 'react'
import { getSysDefaults, subscribeSysDefaults, sysSection } from '../services/systemDefaultsService'

/* Các tab chính người dùng ẩn khỏi menu bên trái (Cài đặt > Hiển thị): localStorage "siteflow-nav-hidden" = [path].
   Dùng chung cho Sidebar và trang Cài đặt (đổi bên này bên kia vẽ lại ngay, kể cả tab trình duyệt khác).
   Ẩn chỉ bỏ khỏi menu, vào thẳng đường dẫn vẫn mở được. Cài đặt không ẩn được (để còn đường bật lại).
   Chưa có khoá (người dùng chưa tự chỉnh) -> theo mặc định hệ thống của Siêu quản trị viên (mục display.hidden, N17);
   người dùng chỉnh rồi thì lưu cả danh sách rỗng ("[]" = hiện hết) để không bị mặc định đè lại. */
const KEY = 'siteflow-nav-hidden'
export const NAV_LOCKED = ['/cai-dat']

const clean = v => (Array.isArray(v) ? v.filter(p => typeof p === 'string' && NAV_LOCKED.indexOf(p) < 0) : [])
function read() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw != null) return clean(JSON.parse(raw))
  } catch { return [] }
  const d = sysSection('display', getSysDefaults())
  return clean(d && d.hidden)
}
let cur = read()
const subs = new Set()
const emit = () => subs.forEach(fn => fn())
subscribeSysDefaults(() => { cur = read(); emit() })
function subscribe(fn) {
  subs.add(fn)
  const onStorage = e => { if (e.key === KEY) { cur = read(); emit() } }
  window.addEventListener('storage', onStorage)
  return () => { subs.delete(fn); window.removeEventListener('storage', onStorage) }
}

export function setNavHidden(list) {
  cur = clean(list)
  try { localStorage.setItem(KEY, JSON.stringify(cur)) } catch { /* bỏ qua */ }
  emit()
}
/* Bỏ lựa chọn riêng -> theo lại mặc định hệ thống */
export function resetNavHidden() {
  try { localStorage.removeItem(KEY) } catch { /* bỏ qua */ }
  cur = read()
  emit()
}
export function toggleNavHidden(path) {
  setNavHidden(cur.indexOf(path) >= 0 ? cur.filter(p => p !== path) : [...cur, path])
}

export function useNavHidden() {
  return useSyncExternalStore(subscribe, () => cur, () => cur)
}
