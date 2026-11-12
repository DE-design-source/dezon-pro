import { useSyncExternalStore } from 'react'

/* Các tab chính người dùng ẩn khỏi menu bên trái (Cài đặt > Hiển thị): localStorage "siteflow-nav-hidden" = [path].
   Dùng chung cho Sidebar và trang Cài đặt (đổi bên này bên kia vẽ lại ngay, kể cả tab trình duyệt khác).
   Ẩn chỉ bỏ khỏi menu, vào thẳng đường dẫn vẫn mở được. Cài đặt không ẩn được (để còn đường bật lại). */
const KEY = 'siteflow-nav-hidden'
export const NAV_LOCKED = ['/cai-dat']

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v.filter(p => typeof p === 'string' && NAV_LOCKED.indexOf(p) < 0) : []
  } catch { return [] }
}
let cur = read()
const subs = new Set()
const emit = () => subs.forEach(fn => fn())
function subscribe(fn) {
  subs.add(fn)
  const onStorage = e => { if (e.key === KEY) { cur = read(); emit() } }
  window.addEventListener('storage', onStorage)
  return () => { subs.delete(fn); window.removeEventListener('storage', onStorage) }
}

export function setNavHidden(list) {
  cur = list.filter(p => NAV_LOCKED.indexOf(p) < 0)
  try { if (cur.length) localStorage.setItem(KEY, JSON.stringify(cur)); else localStorage.removeItem(KEY) } catch { /* bỏ qua */ }
  emit()
}
export function toggleNavHidden(path) {
  setNavHidden(cur.indexOf(path) >= 0 ? cur.filter(p => p !== path) : [...cur, path])
}

export function useNavHidden() {
  return useSyncExternalStore(subscribe, () => cur, () => cur)
}
