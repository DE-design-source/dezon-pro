/* Phiên đăng nhập DUY NHẤT của cả ứng dụng (AppGate, mọi trang, QS, Chat).
   Token chung với trang QS (localStorage qs_token, http.js) nhưng KHÔNG nạp bootstrap 4 MB của QS:
   mỗi lần phiên sẵn sàng thì giao me / congTy cho store QS (adoptSession), store QS chỉ nạp dữ liệu khi /qs mở.
   useWorkSession() -> {auth, me, congTy, error, canTab(tab), canPage(perm), login, logout, retry, ...}.
   auth: 'unconfigured' | 'checking' | 'login' | 'unreachable' | 'ready'.
   Mỗi lần auth thành 'ready' / 'login' phát window CustomEvent 'dezon:auth' {state, me} (Chat nghe để đổi phiên chat). */
import { useSyncExternalStore } from 'react'
import { apiConfigured, readToken, writeToken, readViewAs, ping } from '../pages/QS/api/http'
import * as qsApi from '../pages/QS/api/qsApi'
import * as qsStore from '../pages/QS/state/store'

let S = { auth: apiConfigured() ? 'checking' : 'unconfigured', me: null, congTy: null, error: '' }
const subs = new Set()
function emit(state) {
  try { window.dispatchEvent(new CustomEvent('dezon:auth', { detail: { state, me: S.me } })) } catch (e) { /* bỏ qua */ }
}
/* Người dùng của phiên sẵn sàng gần nhất (bộ nhớ + localStorage qs_user, clearSession của store QS xoá):
   hết phiên rồi đăng nhập tài khoản KHÁC thì bỏ "xem như" (qs_viewAs) / dự án đang mở (qs_cur) của người trước */
let lastUid = ''
const uidOf = me => (me && me.id != null ? String(me.id) : '')
function readLastUid() {
  if (lastUid) return lastUid
  try { return localStorage.getItem('qs_user') || '' } catch (e) { return '' }
}
function rememberUid(me) {
  lastUid = uidOf(me)
  try { if (lastUid) localStorage.setItem('qs_user', lastUid) } catch (e) { /* bỏ qua */ }
}
function forgetOtherUser(me) {
  const last = readLastUid()
  if (last && uidOf(me) && uidOf(me) !== last) qsStore.clearSession()
}
const set = patch => {
  const prev = S.auth
  S = { ...S, ...patch }
  subs.forEach(f => f())
  if (patch.auth === 'ready') { rememberUid(S.me); qsStore.adoptSession(S.me, S.congTy); emit('ready') }
  else if (patch.auth === 'login' && prev !== 'login') emit('login')
}
let started = null
let startSeq = 0 // tăng khi token đổi (tab khác, đăng nhập): kết quả của lần kiểm tra cũ bị bỏ
let curToken = '' // token của phiên đang hiện
// chỉ khi chạy local (vite dev): tự đăng nhập bằng tài khoản thử trong .env.development.local, bản build luôn hiện màn đăng nhập
const DEV_USER = import.meta.env.DEV && import.meta.env.VITE_DEV_LOGIN_USER
const devLogin = () => (DEV_USER ? login(DEV_USER, import.meta.env.VITE_DEV_LOGIN_PASSWORD).then(() => true, () => false) : Promise.resolve(false))

function start() {
  if (started || !apiConfigured()) return started
  const seq = ++startSeq
  const live = () => seq === startSeq
  started = (async () => {
    try {
      curToken = readToken()
      if (!curToken) { await ping(); if (live() && !(await devLogin()) && live()) set({ auth: 'login' }); return }
      const u = await qsApi.me()
      if (!live()) return
      forgetOtherUser(u)
      set({ auth: 'ready', me: u, congTy: u.congTy || null, error: '' })
    } catch (e) {
      if (!live()) return
      if (e && e.name === 'QsUnreachableError') set({ auth: 'unreachable', error: e.message })
      else { writeToken(''); curToken = ''; if (!(await devLogin()) && live()) set({ auth: 'login', me: null, congTy: null }) }
    }
  })()
  return started
}

if (typeof window !== 'undefined') {
  // token hết hạn ở bất kỳ lệnh gọi nào (http.js phát 'qs:noauth') -> về màn đăng nhập chung (store QS tự dừng phần của nó)
  window.addEventListener('qs:noauth', e => { curToken = ''; set({ auth: 'login', me: null, congTy: null, error: (e.detail && e.detail.message) || '' }) })
  /* Tab khác đăng xuất / đăng nhập (sự kiện 'storage' chỉ tới các tab KHÁC tab vừa ghi, không lặp qua lại):
     token bị xoá -> màn đăng nhập + dọn store QS; token đổi -> kiểm tra lại me / congTy, 'dezon:auth' ready báo người dùng mới */
  window.addEventListener('storage', e => {
    if ((e.key !== 'qs_token' && e.key !== null) || !apiConfigured()) return
    const t = readToken()
    if (t === curToken) return
    startSeq++; started = null
    if (!t) {
      curToken = ''
      qsStore.clearSession()
      set({ auth: 'login', me: null, congTy: null, error: '' })
      return
    }
    set({ auth: 'checking', error: '' })
    start()
  })
}

export async function login(user, pw) {
  user = String(user || '').trim(); pw = String(pw || '')
  if (!user || !pw) throw new Error('Nhập tên đăng nhập và mật khẩu')
  const r = await qsApi.login(user, pw)
  writeToken(r.token)
  curToken = r.token || ''
  startSeq++
  forgetOtherUser(r.user)
  set({ auth: 'ready', me: r.user, congTy: r.congTy || null, error: '' })
  return r
}
/* Đăng xuất chung (Cài đặt > Tài khoản, menu tài khoản ở thanh trên, nút tài khoản của QS, thẻ thiếu quyền):
   gửi hết hàng đợi của QS khi token còn, thu hồi phiên phía máy chủ, rồi dọn store QS (qs_viewAs, qs_cur, qs_user...) */
let loggingOut = null
export function logout() {
  if (loggingOut) return loggingOut
  loggingOut = (async () => {
    try { await qsStore.flushBeforeLogout() } catch (e) { /* bỏ qua */ }
    try { await qsApi.logout() } catch (e) { /* phiên đã hết thì thôi */ }
    writeToken('')
    qsStore.clearSession()
    set({ auth: 'login', me: null, congTy: null, error: '' })
  })().finally(() => { loggingOut = null })
  return loggingOut
}
// nơi nào gọi logout() của store QS (vd. bản thử Playwright) cũng đi qua đăng xuất chung
qsStore.setAppLogout(logout)

export function retry() { started = null; set({ auth: 'checking' }); start() }
export const getSession = () => S
/* Cài đặt > Tài khoản: tự sửa họ tên / email; giữ uiPrefs / congTy của phiên (máy chủ chỉ trả phần tài khoản) */
export async function saveProfile(fields) {
  const u = await qsApi.updateMe(fields)
  set({ me: { ...S.me, ...u } })
  return u
}
export const changePassword = (oldPw, newPw) => qsApi.changePassword(oldPw, newPw)

/* Giống canTab của QS (state/store.js): tính năng công ty (rỗng = mọi tab), admin/super được hết, nhân viên cần perms.
   Super chỉ thấy dữ liệu khi đang "xem như" 1 công ty (hoặc có công ty) */
export function canTab(tab, me = S.me, congTy = S.congTy) {
  if (!me) return false
  if (me.role === 'super') return !!readViewAs() || !!me.congTyId
  const f = (congTy && congTy.tinhNang) || []
  if (f.length && f.indexOf(tab) < 0) return false
  if (me.role === 'admin') return true
  return (me.perms || []).indexOf(tab) >= 0
}

/* Tính năng công ty (CT_FEATURES = tab QS + trang nghiệp vụ): công ty tắt thì không ai thấy; các trang còn lại (PAGE_TABS) không bị khoá theo công ty */
const FEATURE_KEYS = new Set(qsStore.PERM_TABS.concat(qsStore.WORK_TABS).map(x => x[0]))
/* Quyền HIỆN 1 trang trên thanh bên / vào được route (data/navigation.js perm). Super thấy mọi trang
   (trang dữ liệu vẫn cần "Xem như công ty", WorkGate kiểm canTab). perm 'qs' = được ít nhất 1 tab QS. Mảng = được 1 trong số đó */
export function canPage(perm, me = S.me, congTy = S.congTy) {
  if (!me) return false
  if (!perm) return true
  if (Array.isArray(perm)) return perm.some(p => canPage(p, me, congTy))
  if (me.role === 'super') return true
  if (perm === 'qs') return qsStore.PERM_TABS.some(x => qsStore.canTab(x[0], me, congTy))
  const f = (congTy && congTy.tinhNang) || []
  if (FEATURE_KEYS.has(perm) && f.length && f.indexOf(perm) < 0) return false
  if (me.role === 'admin') return true
  return (me.perms || []).indexOf(perm) >= 0
}

const subscribe = f => { subs.add(f); start(); return () => subs.delete(f) }
const snap = () => S
export function useWorkSession() {
  const s = useSyncExternalStore(subscribe, snap)
  return {
    ...s, canTab: tab => canTab(tab, s.me, s.congTy), canPage: perm => canPage(perm, s.me, s.congTy),
    login, logout, retry, saveProfile, changePassword,
  }
}
