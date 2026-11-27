/* Phân quyền 3 cấp (N21): quyền thực Module > Tab > Thao tác của tài khoản đang đăng nhập (GET /api/v1/access/me).
   Danh mục module / tab / thao tác: backend/internal/modules/access/catalog.json (loadAccessCatalog()).
   useAccess() -> { ready, can(module, tab, action = 'view'), tabs(module), grants, grantable, error, reload }.
   can() / tabs() / reloadAccess() dùng được ngoài React.
   - super: can() luôn true.
   - chưa nạp xong (ready = false): 'view' theo canPage cũ (tab QS theo canTab cũ), create / edit / delete / approve / export = false.
   - tab '' hoặc '*' = ở ít nhất 1 tab của module.
   Nạp lại khi phiên sẵn sàng (sự kiện 'dezon:auth' ready), khi đổi công ty "xem như" (store QS viewAs), khi gọi reload(),
   khi quay lại cửa sổ / có mạng lại (focus / online, tối đa 1 lần / 30 giây); nạp lỗi thì thử lại sau 30 giây.
   canPage / canTab (services/workSession.js) và canTab của store QS hỏi viewFor(): đã nạp xong thì theo quyền thực, chưa thì theo cách cũ. */
import { useSyncExternalStore } from 'react'
import * as qsApi from '../pages/QS/api/qsApi'
import * as qsStore from '../pages/QS/state/store'
import { legacyCanPage, getSession, useWorkSession } from './workSession'

const EMPTY = {}
let A = { ready: false, grants: EMPTY, grantable: EMPTY, error: '', uid: '', errorAt: 0 }
const subs = new Set()
let seq = 0
let loading = null
let lastViewAs = qsStore.getState().viewAs || ''

const uidOf = me => (me && me.id != null ? String(me.id) : '')
function set(patch) {
  const was = A.ready && A.grants
  A = { ...A, ...patch }
  subs.forEach(f => f())
  if ((A.ready && A.grants) !== was) qsStore.accessChanged()   // tab QS đang mở không còn quyền xem -> sang tab được phép
}
function reset() {
  seq++
  loading = null
  if (A.ready || A.error || A.uid) set({ ready: false, grants: EMPTY, grantable: EMPTY, error: '', uid: '' })
}

/* Nạp quyền thực của phiên hiện tại; lời gọi cũ (đổi phiên giữa chừng) bị bỏ */
export function reloadAccess() {
  const s = getSession()
  if (s.auth !== 'ready' || !s.me) { reset(); return Promise.resolve(A) }
  const my = ++seq
  const uid = uidOf(s.me)
  if (A.uid !== uid) set({ ready: false, grants: EMPTY, grantable: EMPTY, error: '', uid })
  loading = qsApi.getMyAccess().then(r => {
    if (my !== seq) return A
    set({ ready: true, grants: (r && r.grants) || EMPTY, grantable: (r && r.grantable) || EMPTY, error: '', uid })
    return A
  }, e => {
    if (my !== seq) return A
    set({ error: (e && e.message) || 'Không tải được phân quyền', errorAt: Date.now() })
    return A
  }).finally(() => { if (my === seq) loading = null })
  return loading
}

/* Lỗi nạp quyền: thử lại khi có người cần quyền và lỗi đã cũ hơn RETRY_MS (không dồn lời gọi khi máy chủ đang lỗi) */
const RETRY_MS = 30000
function ensure() {
  const s = getSession()
  if (s.auth !== 'ready' || !s.me || loading) return
  if (A.ready && A.uid === uidOf(s.me)) return
  if (A.error && Date.now() - (A.errorAt || 0) < RETRY_MS) return
  reloadAccess()
}

/* Quay lại cửa sổ / có mạng lại: nạp lại quyền (quản trị có thể vừa đổi quyền), tối đa 1 lần / REFRESH_MS */
const REFRESH_MS = 30000
let lastRefresh = 0
function refreshOnReturn() {
  const s = getSession()
  if (s.auth !== 'ready' || !s.me || loading) return
  const now = Date.now()
  if (now - lastRefresh < REFRESH_MS) return
  lastRefresh = now
  reloadAccess()
}

if (typeof window !== 'undefined') {
  window.addEventListener('dezon:auth', e => {
    const st = e && e.detail && e.detail.state
    if (st === 'ready') reloadAccess()
    else reset()
  })
  qsStore.subscribe(() => {
    const v = qsStore.getState().viewAs || ''
    if (v === lastViewAs) return
    lastViewAs = v
    if (getSession().auth === 'ready') reloadAccess()
  })
  window.addEventListener('focus', refreshOnReturn)
  window.addEventListener('online', refreshOnReturn)
}

const isSuper = me => !!me && me.role === 'super'
const tabOk = (list, action) => Array.isArray(list) && list.indexOf(action) >= 0
const anyTab = (m, action) => !!m && Object.keys(m).some(t => tabOk(m[t], action))

/* Khoá tab QS (PERM_TABS) và khoá module (= khoá quyền trang cũ: kinhdoanh, thietke, ..., wiki; 'muahang' cũ là tab QS, nay còn là module trang Mua hàng) */
const QS_TAB_KEYS = new Set(qsStore.PERM_TABS.map(x => x[0]).concat(['dsduan', 'dsncc', 'dsntk']))
const MODULE_KEYS = new Set(['qs', 'muahang'].concat(qsStore.WORK_TABS.map(x => x[0]), qsStore.PAGE_TABS.map(x => x[0])))

/* Quyền thực áp cho me không: đã nạp xong của đúng tài khoản đang đăng nhập, không phải super (super giữ cách cũ: cần "xem như") */
function applies(me) {
  if (!me || isSuper(me) || !A.ready) return false
  const uid = uidOf(me)
  return !!uid && uid === A.uid && uid === uidOf(getSession().me)
}

/* Quyền XEM theo quyền thực; null = chưa áp được (chưa nạp / lỗi / super / tài khoản khác) -> người gọi dùng cách cũ.
   key: khoá tab QS hoặc khoá module. prefer 'qs' (store QS: 'muahang' = tab Mua hàng của QS) / 'page' ('muahang' = trang Mua hàng) */
export function viewFor(me, key, prefer = 'page') {
  if (!applies(me)) return null
  const qsTab = QS_TAB_KEYS.has(key), mod = MODULE_KEYS.has(key)
  if (qsTab && (prefer === 'qs' || !mod)) return tabOk((A.grants.qs || EMPTY)[key], 'view')
  if (mod) return anyTab(A.grants[key], 'view')
  return null
}
qsStore.setAccessView((me, tab) => viewFor(me, tab, 'qs'))

/* Có thao tác action ở tab của module không. */
export function can(module, tab, action = 'view') {
  const me = getSession().me
  if (!me) return false
  if (isSuper(me)) return true
  if (!applies(me)) {
    if (action !== 'view') return false
    if (module === 'qs' && tab && tab !== '*') return !!qsStore.legacyCanTab(tab, me, getSession().congTy)
    return !!legacyCanPage(module)
  }
  const m = A.grants[module]
  if (!m) return false
  if (!tab || tab === '*') return anyTab(m, action)
  return tabOk(m[tab], action)
}

/* Khoá các tab của module được xem (theo thứ tự danh mục máy chủ trả). Chưa nạp xong -> []. */
export function tabs(module) {
  if (!A.ready || !A.uid || A.uid !== uidOf(getSession().me)) return []
  const m = A.grants[module]
  return m ? Object.keys(m).filter(t => tabOk(m[t], 'view')) : []
}

export const getAccess = () => A

/* Danh mục quyền {actions, modules: [{key, label, tabs: [{key, label, actions}]}]} - nạp 1 lần, lỗi thì lần sau thử lại */
let catalogP = null
export function loadAccessCatalog() {
  if (!catalogP) catalogP = qsApi.getAccessCatalog().catch(e => { catalogP = null; throw e })
  return catalogP
}

const subscribe = f => { subs.add(f); ensure(); return () => subs.delete(f) }
const snap = () => A
/* Cho useWorkSession(): vẽ lại khi quyền thực đổi */
export const subscribeAccess = subscribe
export const accessSnap = snap
export function useAccess() {
  const s = useWorkSession()   // vẽ lại khi phiên đổi (me / auth)
  const a = useSyncExternalStore(subscribe, snap)
  return {
    ready: a.ready && !!s.me && a.uid === uidOf(s.me),
    can, tabs,
    grants: a.grants, grantable: a.grantable, error: a.error,
    reload: reloadAccess,
  }
}
