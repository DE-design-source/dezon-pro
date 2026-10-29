/* Phiên đăng nhập dùng chung cho các trang nghiệp vụ ngoài QS (Kinh doanh, Quản lý thiết kế, Quản lý dự án).
   Cùng token với trang QS (localStorage qs_token, http.js) nên đăng nhập ở đâu cũng dùng được ở đây,
   nhưng KHÔNG nạp bootstrap 4 MB của QS. useWorkSession() -> {auth, me, congTy, error, canTab(tab), login, logout, retry}.
   auth: 'unconfigured' | 'checking' | 'login' | 'unreachable' | 'ready'. */
import { useSyncExternalStore } from 'react'
import { apiConfigured, readToken, writeToken, readViewAs, ping } from '../pages/QS/api/http'
import * as qsApi from '../pages/QS/api/qsApi'

let S = { auth: apiConfigured() ? 'checking' : 'unconfigured', me: null, congTy: null, error: '' }
const subs = new Set()
const set = patch => { S = { ...S, ...patch }; subs.forEach(f => f()) }
let started = null

function start() {
  if (started || !apiConfigured()) return started
  started = (async () => {
    try {
      if (!readToken()) { await ping(); set({ auth: 'login' }); return }
      const u = await qsApi.me()
      set({ auth: 'ready', me: u, congTy: u.congTy || null, error: '' })
    } catch (e) {
      if (e && e.name === 'QsUnreachableError') set({ auth: 'unreachable', error: e.message })
      else { writeToken(''); set({ auth: 'login' }) }
    }
  })()
  return started
}

if (typeof window !== 'undefined') {
  // token hết hạn ở bất kỳ lệnh gọi nào (http.js phát 'qs:noauth') -> về màn đăng nhập
  window.addEventListener('qs:noauth', e => set({ auth: 'login', me: null, error: (e.detail && e.detail.message) || '' }))
}

export async function login(user, pw) {
  user = String(user || '').trim()
  if (!user || !pw) throw new Error('Nhập tên đăng nhập và mật khẩu')
  const r = await qsApi.login(user, pw)
  writeToken(r.token)
  set({ auth: 'ready', me: r.user, congTy: r.congTy || null, error: '' })
}
export async function logout() {
  try { await qsApi.logout() } catch (e) { /* phiên đã hết thì thôi */ }
  writeToken('')
  set({ auth: 'login', me: null, congTy: null })
}
export function retry() { started = null; set({ auth: 'checking' }); start() }

/* Giống canTab của QS (state/store.js): tính năng công ty (rỗng = mọi tab), admin/super được hết, nhân viên cần perms */
export function canTab(tab, me = S.me, congTy = S.congTy) {
  if (!me) return false
  if (me.role === 'super') return !!readViewAs() || !!me.congTyId
  const f = (congTy && congTy.tinhNang) || []
  if (f.length && f.indexOf(tab) < 0) return false
  if (me.role === 'admin') return true
  return (me.perms || []).indexOf(tab) >= 0
}

const subscribe = f => { subs.add(f); start(); return () => subs.delete(f) }
const snap = () => S
export function useWorkSession() {
  const s = useSyncExternalStore(subscribe, snap)
  return { ...s, canTab: tab => canTab(tab, s.me, s.congTy), login, logout, retry }
}
