import { useEffect, useSyncExternalStore } from 'react'

/* Module (tab đầu trang) người dùng ẩn trong từng trang chính (Cài đặt > Hiển thị):
   localStorage "siteflow-page-tabs-hidden" = {đường dẫn trang: [khoá tab]}. Dùng chung cho các trang và trang Cài đặt
   (đổi bên này bên kia vẽ lại ngay, kể cả tab trình duyệt khác). Chỉ ẩn khỏi thanh tab, không đổi quyền.
   Mỗi trang luôn còn ít nhất 1 tab hiện. Danh sách tab của từng trang: data/pageTabs.js. */
const KEY = 'siteflow-page-tabs-hidden'
const NONE = []

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}')
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out = {}
    Object.keys(v).forEach(p => { if (Array.isArray(v[p]) && v[p].length) out[p] = v[p].filter(k => typeof k === 'string') })
    return out
  } catch { return {} }
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
function save(next) {
  cur = next
  try { if (Object.keys(cur).length) localStorage.setItem(KEY, JSON.stringify(cur)); else localStorage.removeItem(KEY) } catch { /* bỏ qua */ }
  emit()
}

/* Bật / tắt 1 tab của trang; allKeys = mọi khoá tab của trang (không cho ẩn tab cuối cùng còn hiện) */
export function togglePageTab(path, key, allKeys) {
  const h = cur[path] || NONE
  let list
  if (h.indexOf(key) >= 0) list = h.filter(k => k !== key)
  else {
    if (allKeys && allKeys.filter(k => k !== key && h.indexOf(k) < 0).length === 0) return
    list = [...h, key]
  }
  const next = { ...cur }
  if (list.length) next[path] = list; else delete next[path]
  save(next)
}
/* Hiện lại mọi tab của 1 trang (path) hoặc của mọi trang (không truyền path) */
export function showAllPageTabs(path) {
  if (!path) { save({}); return }
  const next = { ...cur }
  delete next[path]
  save(next)
}

export function useAllPageTabsHidden() {
  return useSyncExternalStore(subscribe, () => cur, () => cur)
}
/* Khoá các tab đang ẩn của 1 trang */
export function usePageTabsHidden(path) {
  const all = useAllPageTabsHidden()
  return all[path] || NONE
}

/* Tab đang mở bị ẩn -> chuyển sang tab hiện đầu tiên (keys = thứ tự tab của trang) */
export function useTabFallback(hidden, active, keys, go) {
  useEffect(() => {
    if (!hidden.length || hidden.indexOf(active) < 0 || keys.indexOf(active) < 0) return
    const first = keys.find(k => hidden.indexOf(k) < 0)
    if (first) go(first)
  }, [hidden, active]) // eslint-disable-line react-hooks/exhaustive-deps
}
