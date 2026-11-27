import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { PAGE_TABS } from '../data/pageTabs'
import { can, useAccess } from '../services/accessService'
import { useWorkSession } from '../services/workSession'

/* Module (tab đầu trang) người dùng ẩn trong từng trang chính (Cài đặt > Hiển thị):
   localStorage "siteflow-page-tabs-hidden" = {đường dẫn trang: [khoá tab]}. Dùng chung cho các trang và trang Cài đặt
   (đổi bên này bên kia vẽ lại ngay, kể cả tab trình duyệt khác). Chỉ ẩn thêm khỏi thanh tab, không đổi quyền.
   Tab không có quyền xem (Phân quyền 3 cấp N21, accessService.can(module, tab, 'view')) luôn bị ẩn, không bật lại được.
   Mỗi trang luôn còn ít nhất 1 tab được xem đang hiện. Danh sách tab của từng trang: data/pageTabs.js. */
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

/* Bật / tắt 1 tab của trang; allKeys = khoá tab được xem của trang (không cho ẩn tab cuối cùng còn hiện) */
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
const pageOf = path => PAGE_TABS.find(p => p.path === path)
/* Khoá tab của trang (data/pageTabs.js) mà tài khoản được xem, đúng thứ tự thanh tab; trang không có trong PAGE_TABS -> [] */
export function viewablePageTabKeys(path) {
  const pg = pageOf(path)
  if (!pg) return []
  return pg.tabs.map(t => t[0]).filter(k => !pg.module || can(pg.module, k, 'view'))
}
/* Vẽ lại khi quyền thực / phiên đổi; trả khoá phụ thuộc cho useMemo */
function useAccessKey() {
  const s = useWorkSession()
  const a = useAccess()
  return [a.ready, a.grants, s.me, s.congTy]
}
/* Khoá tab được xem của 1 trang (Cài đặt > Hiển thị chỉ liệt kê các tab này) */
export function useViewablePageTabs(path) {
  const dep = useAccessKey()
  return useMemo(() => viewablePageTabKeys(path), [path, ...dep]) // eslint-disable-line react-hooks/exhaustive-deps
}
/* Khoá các tab phải ẩn của 1 trang = tab không có quyền xem + tab người dùng ẩn.
   Người dùng ẩn hết các tab được xem (quyền đổi sau khi ẩn) thì bỏ phần người dùng ẩn để còn tab hiện */
export function usePageTabsHidden(path) {
  const all = useAllPageTabsHidden()
  const user = all[path] || NONE
  const dep = useAccessKey()
  return useMemo(() => {
    const pg = pageOf(path)
    if (!pg || !pg.module) return user
    const keys = pg.tabs.map(t => t[0])
    const ok = viewablePageTabKeys(path)
    const noView = keys.filter(k => ok.indexOf(k) < 0)
    if (!noView.length) return user
    const keep = ok.some(k => user.indexOf(k) < 0) ? user.filter(k => noView.indexOf(k) < 0) : NONE
    return noView.concat(keep)
  }, [path, user, ...dep]) // eslint-disable-line react-hooks/exhaustive-deps
}

/* Tab đang mở bị ẩn -> chuyển sang tab hiện đầu tiên (keys = thứ tự tab của trang) */
export function useTabFallback(hidden, active, keys, go) {
  useEffect(() => {
    if (!hidden.length || hidden.indexOf(active) < 0 || keys.indexOf(active) < 0) return
    const first = keys.find(k => hidden.indexOf(k) < 0)
    if (first) go(first)
  }, [hidden, active]) // eslint-disable-line react-hooks/exhaustive-deps
}
