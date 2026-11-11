/* REST của Dezon Chat: /api/v1/chat/... trên cùng máy chủ Go với QS (API_BASE của ../../QS/api/http.js).
   Danh tính chat RIÊNG (số điện thoại hoặc email + OTP), không dùng token QS: access token (JWT 15 phút) + refresh token (30 ngày).
   Nhiều tài khoản trong một trình duyệt, mỗi tab một tài khoản:
   - kho chung localStorage chat_accounts = {"version":1,"accounts":{"<user id>":{access_token, refresh_token, device_id,
     user, added_at}}}: mỗi tài khoản là một thiết bị riêng trên máy chủ (OTP một lần cho mỗi tài khoản);
     chat_last_account = tài khoản chọn gần nhất ở tab bất kỳ;
   - tài khoản của tab: sessionStorage chat_tab_account (tải lại tab vẫn giữ, nhân bản tab thì tab mới kế thừa);
   - phiên kiểu cũ (chat_access_token / chat_refresh_token / chat_device_id / chat_user) chuyển vào kho một lần.
   - Kết quả bóc từ {ok, result}; lỗi {error, code} -> ChatApiError(message, status, code).
   - 401 CHAT_NOAUTH -> làm mới token MỘT lần dưới khoá navigator.locks 'dezon-chat-refresh:<user id>' (không có thì dùng
     promise trong tab, theo tài khoản), đọc lại mục của tài khoản đó sau khi giữ khoá vì tab khác có thể vừa làm mới xong.
   - REFRESH_RACE -> đọc lại token rồi thử lại; REFRESH_INVALID / REFRESH_REUSED -> chỉ bỏ tài khoản đó khỏi kho. */
import { API_BASE, apiConfigured } from '../../QS/api/http'
import * as L from '../state/chatLogic'

const LEGACY = { access: 'chat_access_token', refresh: 'chat_refresh_token', device: 'chat_device_id', user: 'chat_user' }
export const STORAGE_KEYS = { vault: 'chat_accounts', last: 'chat_last_account', tab: 'chat_tab_account', legacy: LEGACY }
const K = STORAGE_KEYS

export const configured = () => apiConfigured()

export class ChatApiError extends Error {
  constructor(message, status, code) {
    super(message)
    this.name = 'ChatApiError'
    this.status = status || 0
    this.code = code || ''
  }
}
const authError = msg => new ChatApiError(msg || 'Phiên chat đã hết, mời đăng nhập lại', 401, 'CHAT_NOAUTH')

/* ---- localStorage / sessionStorage (mọi truy cập bọc try/catch) ---- */
function lsGet(k) { try { return localStorage.getItem(k) || '' } catch (e) { return '' } }
function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k) } catch (e) { /* bỏ qua */ } }
function ssGet(k) { try { return sessionStorage.getItem(k) || '' } catch (e) { return '' } }
function ssSet(k, v) { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k) } catch (e) { /* bỏ qua */ } }

/* ---- Kho tài khoản ---- */
export function readVault() { return L.parseVault(lsGet(K.vault)) }

/* Đọc - sửa - ghi kho trong cùng một lượt (không await giữa chừng); chỉ ghi khi có thay đổi. Kho rỗng -> xoá khoá. */
function editVault(fn) {
  const raw = lsGet(K.vault)
  const v = L.parseVault(raw)
  const res = fn(v.accounts)
  const next = Object.keys(v.accounts).length ? JSON.stringify(v) : ''
  if (next !== raw) lsSet(K.vault, next)
  return res
}

/* Mục tab này vừa ghi (đăng nhập / làm mới): tab khác đọc kho cũ rồi ghi đè (localStorage giữa các tab có thể chậm vài
   mili giây) làm mất refresh token mới -> lần làm mới sau dùng token cũ là REFRESH_REUSED (máy chủ thu hồi thiết bị),
   hoặc làm mất hẳn tài khoản vừa thêm. healVault() (gọi khi kho đổi ở tab khác) ghi lại bản mới hơn của tab này.
   Bỏ tài khoản (removeAccount) ghi dấu chat_removed:<id> = thời điểm bỏ TRƯỚC khi ghi kho: mục mất khỏi kho mà dấu bỏ
   cũ hơn lần ghi của tab này -> bị ghi đè, khôi phục; dấu mới hơn -> đăng xuất thật. */
const REMOVED_PREFIX = 'chat_removed:'
const HEAL_ADD_MS = 10000 // chỉ khôi phục mục vừa ghi gần đây (ghi đè do đọc kho cũ chỉ xảy ra ngay sau lần ghi)
const written = new Map()
function remember(id, e) {
  written.set(id, { access_token: e.access_token, refresh_token: e.refresh_token, device_id: e.device_id, user: e.user || null, added_at: e.added_at || Date.now(), at: Date.now() })
}

export function healVault() {
  if (!written.size) return
  const acc = readVault().accounts
  const fix = []
  for (const [id, mine] of written) {
    const cur = acc[id]
    if (!cur) {
      const removedAt = Number(lsGet(REMOVED_PREFIX + id)) || 0
      if (removedAt < mine.at && Date.now() - mine.at < HEAL_ADD_MS) fix.push(id) // tab khác ghi đè bằng kho cũ
      else written.delete(id) // đã đăng xuất
      continue
    }
    if (cur.device_id !== mine.device_id) { written.delete(id); continue } // đăng nhập lại thiết bị khác
    if (cur.refresh_token === mine.refresh_token) continue
    if (L.tokenIat(mine.access_token) > L.tokenIat(cur.access_token)) fix.push(id)
    else written.delete(id) // tab khác làm mới sau: bản trong kho mới hơn
  }
  if (!fix.length) return
  editVault(a => {
    for (const id of fix) {
      const mine = written.get(id)
      if (!mine) continue
      if (!a[id]) a[id] = { access_token: mine.access_token, refresh_token: mine.refresh_token, device_id: mine.device_id, user: mine.user, added_at: mine.added_at }
      else if (a[id].device_id === mine.device_id) a[id] = { ...a[id], access_token: mine.access_token, refresh_token: mine.refresh_token }
    }
  })
}

/* Tài khoản trong kho theo thứ tự thêm vào: [{id, user, added_at}] */
export function listAccounts() {
  const v = readVault()
  return L.vaultIds(v).map(id => ({ id: Number(id), user: v.accounts[id].user, added_at: v.accounts[id].added_at }))
}
export function hasAccount(uid) { return !!(uid && readVault().accounts[String(uid)]) }

/* ---- Tài khoản của tab này ---- */
let active = null // id (chuỗi) hoặc null

export const activeAccountId = () => (active ? Number(active) : null)

/* Đặt tài khoản của tab (sessionStorage chỉ của tab này). choose: người dùng chọn (đổi tài khoản, đăng nhập, bấm thông
   báo) -> ghi thêm chat_last_account cho tab mở sau. */
export function setActiveAccount(uid, choose) {
  active = uid ? String(uid) : null
  ssSet(K.tab, active || '')
  if (active && choose) lsSet(K.last, active)
}

/* Thứ tự chọn tài khoản: (?u= trên địa chỉ khi useUrl) -> sessionStorage -> chat_last_account -> tài khoản duy nhất */
export function resolveAccount(useUrl) {
  const ids = L.vaultIds(readVault())
  const query = useUrl && typeof window !== 'undefined' && window.location ? L.accountParam(window.location.search) : null
  const id = L.pickAccount({ query, tab: ssGet(K.tab), last: lsGet(K.last), ids })
  return id ? Number(id) : null
}

/* Phiên kiểu cũ (một tài khoản cho cả trình duyệt) -> một mục trong kho, đặt làm tài khoản của tab + tài khoản gần nhất,
   rồi xoá khoá cũ. Idempotent (hai tab cùng chuyển một lúc ghi cùng một mục). Trả id tài khoản vừa chuyển hoặc null. */
export function migrateLegacy() {
  const legacy = { access: lsGet(LEGACY.access), refresh: lsGet(LEGACY.refresh), device: lsGet(LEGACY.device), user: lsGet(LEGACY.user) }
  if (!legacy.access && !legacy.refresh && !legacy.device && !legacy.user) return null
  let uid = null
  if (legacy.refresh) {
    const raw = lsGet(K.vault)
    const r = L.mergeLegacy(L.parseVault(raw), legacy, Date.now())
    if (!r.uid) return null // không biết tài khoản nào: để nguyên, không mất phiên
    const next = JSON.stringify(r.vault)
    if (next !== raw) lsSet(K.vault, next)
    uid = r.uid
    if (!ssGet(K.tab)) ssSet(K.tab, uid)
    const last = lsGet(K.last)
    if (!last || !r.vault.accounts[last]) lsSet(K.last, uid)
  }
  Object.values(LEGACY).forEach(k => lsSet(k, ''))
  return uid ? Number(uid) : null
}

/* Lúc nạp trang: chuyển phiên kiểu cũ, chọn tài khoản cho tab, bỏ ?u= khỏi địa chỉ (giữ đường dẫn, tham số khác và #c<id>;
   ?u= là tài khoản không còn trong kho thì bỏ luôn #c<id>: không mở hội thoại của tài khoản đó dưới tài khoản khác).
   Trả {uid, migrated}. */
export function initTab() {
  const migrated = migrateLegacy()
  const fromUrl = typeof window !== 'undefined' && window.location ? L.accountParam(window.location.search) : null
  const uid = resolveAccount(true)
  setActiveAccount(uid, !!uid && fromUrl != null && String(uid) === fromUrl)
  if (fromUrl != null && typeof window !== 'undefined' && window.history) {
    const loc = window.location
    const keepHash = String(uid) === fromUrl || !/^#c\d+$/.test(loc.hash)
    try { window.history.replaceState(window.history.state, '', loc.pathname + L.withoutAccountParam(loc.search) + (keepHash ? loc.hash : '')) } catch (e) { /* bỏ qua */ }
  }
  return { uid, migrated }
}

/* Phiên của một tài khoản (mặc định: tài khoản của tab) */
export function readSession(uid) {
  const id = uid === undefined ? active : uid ? String(uid) : null
  const e = id ? readVault().accounts[id] : null
  if (!e) return { uid: id ? Number(id) : null, access: '', refresh: '', deviceId: 0, user: null }
  /* gói auth WebSocket bắt buộc device_id đúng thiết bị của token: thiếu device_id thì lấy claim did của token */
  const did = Number(e.device_id) || Number((L.decodeJwt(e.access_token) || {}).did) || 0
  return { uid: Number(id), access: e.access_token, refresh: e.refresh_token, deviceId: did, user: e.user }
}

/* Lưu kết quả otp/verify của cổng đăng nhập vào mục của tài khoản đó (id lấy từ user / claim sub). choose: ghi luôn
   chat_last_account. Trả {uid, replaced}: replaced = mục cũ của cùng tài khoản trên một thiết bị KHÁC (đăng nhập lại
   cùng số) - cổng báo máy chủ xoá thiết bị cũ bằng logoutTokens(replaced). */
export function saveSession(r, choose) {
  if (!r || !r.refresh_token) return { uid: null, replaced: null }
  const claims = L.decodeJwt(r.access_token) || {}
  const id = String((r.user && r.user.id) || claims.sub || '')
  if (!/^[1-9]\d*$/.test(id)) return { uid: null, replaced: null }
  noteToken(r.access_token)
  const entry = { access_token: r.access_token || '', refresh_token: r.refresh_token, device_id: Number(r.device_id) || Number(claims.did) || 0 }
  let replaced = null
  lsSet(REMOVED_PREFIX + id, '')
  const saved = editVault(acc => {
    const old = acc[id]
    if (old && old.refresh_token !== entry.refresh_token && !(old.device_id && old.device_id === entry.device_id)) replaced = { ...old }
    acc[id] = { ...entry, user: r.user || (old && old.user) || null, added_at: (old && old.added_at) || Date.now() }
    return acc[id]
  })
  remember(id, saved)
  if (choose) lsSet(K.last, id)
  return { uid: Number(id), replaced }
}

/* Kết quả refresh: chỉ ghi khi mục vẫn còn và cùng thiết bị (không làm sống lại tài khoản vừa đăng xuất ở tab khác) */
function storeRefreshed(id, r, deviceId) {
  const entry = { access_token: r.access_token || '', refresh_token: r.refresh_token, device_id: Number(r.device_id) || deviceId || 0 }
  const saved = editVault(acc => {
    const old = acc[id]
    if (!old || (old.device_id && deviceId && old.device_id !== deviceId)) return null
    acc[id] = { ...old, ...entry, user: r.user || old.user }
    return acc[id]
  })
  if (saved) remember(id, saved)
  return !!saved
}

/* Thông tin tài khoản (getMe / patchMe) vào mục của tài khoản đó; không đổi thì không ghi */
export function saveUser(u) {
  if (!u || !u.id) return
  editVault(acc => {
    const e = acc[String(u.id)]
    if (e && JSON.stringify(e.user) !== JSON.stringify(u)) e.user = u
  })
}

/* Bỏ tài khoản khỏi kho. cond {refresh, deviceId}: chỉ bỏ khi mục vẫn giữ đúng refresh token / thiết bị đó (tab khác
   vừa đăng nhập lại tài khoản này bằng thiết bị mới thì giữ). Trả true nếu đã bỏ. */
export function removeAccount(uid, cond) {
  if (!uid) return false
  const id = String(uid)
  const done = editVault(acc => {
    const e = acc[id]
    if (!e) return false
    if (cond && cond.refresh && e.refresh_token !== cond.refresh) return false
    if (cond && cond.deviceId && e.device_id && e.device_id !== cond.deviceId) return false
    delete acc[id]
    lsSet(REMOVED_PREFIX + id, String(Date.now())) // trước khi ghi kho (healVault ở tab khác đọc dấu này)
    return true
  })
  if (done) written.delete(id)
  return done
}

/* Phiên bị thu hồi (refresh hỏng / bị dùng lại): bỏ đúng tài khoản đó, báo cho store (code, uid) */
const forcedSubs = new Set()
export function onForcedSignOut(fn) { forcedSubs.add(fn); return () => forcedSubs.delete(fn) }
function forceSignOut(code, id, cond) {
  if (!removeAccount(id, cond)) return false
  forcedSubs.forEach(f => { try { f(code, Number(id)) } catch (e) { /* bỏ qua */ } })
  return true
}

/* ---- Lệch giờ máy so với máy chủ: ước từ iat của token vừa nhận / server_time của auth.ok ---- */
let skewMs = 0
function noteToken(token) {
  const p = L.decodeJwt(token)
  if (p && Number.isFinite(p.iat)) skewMs = p.iat * 1000 - Date.now()
}
export function noteServerTime(iso) {
  const t = Date.parse(iso)
  if (Number.isFinite(t)) skewMs = t - Date.now()
}
export function serverNow() { return Date.now() + skewMs }

/* Access token còn dưới 30 giây (theo giờ máy chủ) thì làm mới trước khi dùng */
export function accessExpiringSoon(token) {
  const p = L.decodeJwt(token)
  if (!p || !Number.isFinite(p.exp)) return true
  return p.exp * 1000 - serverNow() < 30000
}

/* ---- HTTP ---- */
function buildUrl(path, query) {
  let url = API_BASE + '/api/v1/chat' + path
  if (query) {
    const qs = Object.keys(query)
      .filter(k => query[k] !== undefined && query[k] !== null && query[k] !== '')
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(query[k])))
      .join('&')
    if (qs) url += '?' + qs
  }
  return url
}

/* timeoutMs: hết giờ thì huỷ yêu cầu và báo lỗi NETWORK; signal của người gọi huỷ thì vẫn ném AbortError như cũ */
async function raw(method, path, { body, query, token, signal, timeoutMs } = {}) {
  if (!apiConfigured()) throw new ChatApiError('Chưa cấu hình địa chỉ máy chủ (VITE_API_URL)', 0, 'NOT_CONFIGURED')
  const headers = {}
  const hasBody = body !== undefined
  if (hasBody) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = 'Bearer ' + token
  let sig = signal
  let timer = null
  let timedOut = false
  let unlink = null
  if (timeoutMs > 0) {
    const ac = new AbortController()
    if (signal) {
      if (signal.aborted) ac.abort()
      else {
        const onAbort = () => ac.abort()
        signal.addEventListener('abort', onAbort, { once: true })
        unlink = () => signal.removeEventListener('abort', onAbort)
      }
    }
    timer = setTimeout(() => { timedOut = true; ac.abort() }, timeoutMs)
    sig = ac.signal
  }
  const slow = () => new ChatApiError('Máy chủ chat không phản hồi kịp, thử lại sau', 0, 'NETWORK')
  let res
  let d = null
  try {
    try {
      res = await fetch(buildUrl(path, query), { method, headers, body: hasBody ? JSON.stringify(body) : undefined, signal: sig })
    } catch (e) {
      if (timedOut) throw slow()
      if (e && e.name === 'AbortError') throw e
      throw new ChatApiError('Không kết nối được máy chủ chat', 0, 'NETWORK')
    }
    try { d = await res.json() } catch (e) {
      if (timedOut) throw slow()
      if (e && e.name === 'AbortError') throw e
      d = null
    }
  } finally {
    if (timer) clearTimeout(timer)
    if (unlink) unlink()
  }
  if (d && typeof d === 'object' && d.error) throw new ChatApiError(String(d.error), res.status, d.code || '')
  if (!res.ok || !d || typeof d !== 'object') {
    throw new ChatApiError('Lỗi máy chủ chat (HTTP ' + res.status + ')', res.status, res.status === 401 ? 'CHAT_NOAUTH' : '')
  }
  return d.result === undefined ? null : d.result
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/* Làm mới cặp token của một tài khoản (mặc định: của tab). staleAccess = access token vừa bị từ chối: kho đã có token
   khác -> tab khác làm mới rồi, dùng luôn. Mỗi tài khoản một khoá: làm mới tài khoản này không chờ tài khoản khác. */
const refreshing = new Map()
export function refreshSession(staleAccess, uid) {
  const id = uid === undefined || uid === null ? active : String(uid)
  if (!id) return Promise.reject(authError())
  if (refreshing.has(id)) return refreshing.get(id)
  const run = async () => {
    let s = readSession(id)
    if (!s.refresh) throw authError()
    if (staleAccess !== undefined && s.access && s.access !== staleAccess && !accessExpiringSoon(s.access)) return s
    for (let i = 0; i < 4; i++) {
      let r
      try {
        r = await raw('POST', '/auth/refresh', { body: { refresh_token: s.refresh } })
      } catch (e) {
        if (e.code === 'REFRESH_RACE') {
          // Token vừa được xoay bởi một yêu cầu khác (< 30 giây): đọc lại kho, có token mới thì dùng
          await sleep(300 + i * 400)
          const n = readSession(id)
          if (!n.refresh) throw authError()
          if (n.refresh !== s.refresh) return n
          s = n
          continue
        }
        if (e.code === 'REFRESH_INVALID' || e.code === 'REFRESH_REUSED' || e.code === 'CHAT_NOAUTH') {
          if (forceSignOut(e.code, id, { refresh: s.refresh })) throw authError(e.message)
          const n = readSession(id) // mục đã được thay (đăng nhập lại ở tab khác): dùng token mới
          if (n.refresh && n.refresh !== s.refresh) return n
          throw authError(e.message)
        }
        throw e
      }
      if (!storeRefreshed(id, r || {}, s.deviceId)) {
        // tài khoản vừa bị đăng xuất / đăng nhập lại bằng thiết bị khác trong lúc chờ: bỏ cặp token này
        const n = readSession(id)
        if (n.refresh) return n
        throw authError()
      }
      noteToken(r.access_token)
      return readSession(id)
    }
    throw new ChatApiError('Không làm mới được phiên chat, thử lại sau', 409, 'REFRESH_RACE')
  }
  const locks = typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function'
  const p = locks ? navigator.locks.request('dezon-chat-refresh:' + id, run) : run()
  const q = p.finally(() => { if (refreshing.get(id) === q) refreshing.delete(id) })
  refreshing.set(id, q)
  return q
}

/* Phiên còn dùng được (access token chưa sắp hết) - socket gọi trước khi gửi gói auth. Mặc định: tài khoản của tab. */
export async function ensureFreshSession(uid) {
  const s = readSession(uid)
  if (!s.refresh) throw authError()
  if (!s.access || accessExpiringSoon(s.access)) return refreshSession(s.access, s.uid)
  return s
}

/* Gọi API cần đăng nhập chat (opts.uid: tài khoản, mặc định của tab - lấy lúc bắt đầu gọi): tự làm mới token khi
   401 CHAT_NOAUTH (một lần) */
async function call(method, path, opts = {}) {
  const s = await ensureFreshSession(opts.uid != null ? opts.uid : undefined)
  try {
    return await raw(method, path, { ...opts, token: s.access })
  } catch (e) {
    if (e.status !== 401 || e.code !== 'CHAT_NOAUTH') throw e
    const n = await refreshSession(s.access, s.uid)
    try {
      return await raw(method, path, { ...opts, token: n.access })
    } catch (e2) {
      if (e2.status === 401 && e2.code === 'CHAT_NOAUTH') forceSignOut('CHAT_NOAUTH', String(s.uid), { refresh: n.refresh })
      throw e2
    }
  }
}

const device = () => ({ platform: 'web', name: L.deviceName(typeof navigator !== 'undefined' ? navigator.userAgent : '') })

/* Danh tính gửi máy chủ: {email} hoặc {phone} (đã chuẩn hoá) - máy chủ từ chối khi có cả hai */
const contactOf = t => (t && t.email ? { email: t.email } : { phone: (t && t.phone) || '' })

/* ---- Đăng nhập (công khai) ---- */
/* target {phone} | {email} -> {phone?, email?, expires_in, resend_after, dev_code?} (đúng một trong phone / email) */
export const otpRequest = target => raw('POST', '/auth/otp/request', { body: contactOf(target) })
export function otpVerify(target, otp, displayName) {
  const body = { ...contactOf(target), otp, device: device() }
  if (displayName && displayName.trim()) body.display_name = displayName.trim()
  return raw('POST', '/auth/otp/verify', { body })
}
export const logout = uid => call('POST', '/auth/logout', { uid })

/* Lỗi tạm thời (mất mạng, máy chủ 5xx / 429, refresh trùng lúc): thử lại sau thì có thể được */
export const transientError = e => !!e && (e.code === 'NETWORK' || e.code === 'REFRESH_RACE' || e.status >= 500 || e.status === 429)

/* Báo máy chủ xoá thiết bị của một cặp token cũ (mục bị thay khi đăng nhập lại cùng số trên trình duyệt này, đăng xuất
   lúc mất mạng): access bị từ chối / sắp hết thì làm mới bằng refresh token cũ rồi đăng xuất. Trả false khi lỗi tạm thời
   (thử lại sau), true khi xong hoặc phiên đã hết (không còn gì để xoá). */
export async function logoutTokens(entry) {
  if (!entry || !entry.refresh_token) return true
  try {
    let access = entry.access_token
    if (access && !accessExpiringSoon(access)) {
      try { await raw('POST', '/auth/logout', { token: access }); return true } catch (e) { if (e.status !== 401) return !transientError(e) }
    }
    const r = await raw('POST', '/auth/refresh', { body: { refresh_token: entry.refresh_token } })
    access = r && r.access_token
    if (access) await raw('POST', '/auth/logout', { token: access })
    return true
  } catch (e) { return !transientError(e) }
}

/* Đăng xuất lúc mất mạng / máy chủ lỗi: máy chủ chưa xoá thiết bị (thiết bị còn giữ subscription chung của trình duyệt).
   Giữ cặp token trong chat_pending_logout, báo lại khi mở app / có mạng; bỏ khi xong hoặc phiên đã hết. */
const PENDING_LOGOUT = 'chat_pending_logout'
function pendingLogouts() {
  try {
    const v = JSON.parse(lsGet(PENDING_LOGOUT) || '[]')
    return Array.isArray(v) ? v.filter(x => x && typeof x.refresh_token === 'string' && x.refresh_token) : []
  } catch (e) { return [] }
}
function writePendingLogouts(list) { lsSet(PENDING_LOGOUT, list.length ? JSON.stringify(list.slice(-20)) : '') }
export function queueLogout(entry) {
  if (!entry || !entry.refresh_token) return
  const list = pendingLogouts().filter(x => x.refresh_token !== entry.refresh_token)
  list.push({ access_token: entry.access_token || '', refresh_token: entry.refresh_token })
  writePendingLogouts(list)
}
let flushingLogouts = null
export function flushPendingLogouts() {
  if (flushingLogouts) return flushingLogouts
  if (!apiConfigured() || !pendingLogouts().length) return Promise.resolve()
  const run = async () => {
    for (const entry of pendingLogouts()) {
      if (await logoutTokens(entry)) writePendingLogouts(pendingLogouts().filter(x => x.refresh_token !== entry.refresh_token))
    }
  }
  const locks = typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function'
  const p = (locks ? navigator.locks.request('dezon-chat-pending-logout', run) : run()).catch(() => {})
  flushingLogouts = p.finally(() => { flushingLogouts = null })
  return flushingLogouts
}

/* ---- Tài khoản ---- */
export const getMe = () => call('GET', '/me')
/* uid: cổng đăng nhập đặt tên cho tài khoản vừa xác thực (chưa phải tài khoản của tab) */
export const patchMe = (patch, uid) => call('PATCH', '/me', { body: patch, uid })

/* ---- Danh bạ / bạn bè / chặn ---- */
/* query {phone} | {email} -> {user: User | null} */
export const searchUser = query => call('GET', '/users/search', { query: contactOf(query) })
export const matchContacts = ({ phones, phone_hashes }) => call('POST', '/contacts/match', { body: phones ? { phones } : { phone_hashes } })
export const friends = () => call('GET', '/friends')
export const unfriend = userId => call('DELETE', '/friends/' + userId)
export const friendRequests = () => call('GET', '/friend-requests')
export const sendFriendRequest = userId => call('POST', '/friend-requests', { body: { user_id: userId } })
export const acceptFriendRequest = userId => call('POST', '/friend-requests/' + userId + '/accept')
export const rejectFriendRequest = userId => call('POST', '/friend-requests/' + userId + '/reject')
export const cancelFriendRequest = userId => call('DELETE', '/friend-requests/' + userId)
export const blocks = () => call('GET', '/blocks')
export const block = userId => call('POST', '/blocks', { body: { user_id: userId } })
export const unblock = userId => call('DELETE', '/blocks/' + userId)

/* ---- Hội thoại ---- */
export const conversations = ({ cursor, limit } = {}) => call('GET', '/conversations', { query: { cursor, limit } })
export const createDirect = userId => call('POST', '/conversations', { body: { type: 'direct', user_id: userId } })
export const createGroup = (name, memberIds) => call('POST', '/conversations', { body: { type: 'group', name, member_ids: memberIds } })
export const conversation = id => call('GET', '/conversations/' + id)
export const renameConversation = (id, name) => call('PATCH', '/conversations/' + id, { body: { name } })
export const addMembers = (id, userIds) => call('POST', '/conversations/' + id + '/members', { body: { user_ids: userIds } })
export const removeMember = (id, userId) => call('DELETE', '/conversations/' + id + '/members/' + userId)
export const setMemberRole = (id, userId, role) => call('PATCH', '/conversations/' + id + '/members/' + userId, { body: { role } })
export const muteConversation = (id, until) => call('PUT', '/conversations/' + id + '/mute', { body: { until } })
/* Một trong before_seq / after_seq / around_seq (around_seq: tin quanh seq đó, kết quả có thêm has_newer) */
export const messages = (id, { before_seq, after_seq, around_seq, limit } = {}) =>
  call('GET', '/conversations/' + id + '/messages', { query: { before_seq, after_seq, around_seq, limit } })
/* Tin đã sửa / thu hồi / đổi reaction sau mốc since (sync_cursor đã dùng cho /sync) hoặc cursor (next_cursor trang trước)
   -> {messages, next_cursor} */
export const messageChanges = (id, { since, cursor, limit } = {}) =>
  call('GET', '/conversations/' + id + '/messages/changes', { query: { since, cursor, limit } })
export const sync = cursor => call('GET', '/sync', { query: { cursor } })

/* ---- Thao tác trên tin (giai đoạn 2) ---- */
/* -> Message sau khi sửa */
export const editMessage = (messageId, { content, mentions } = {}) =>
  call('PATCH', '/messages/' + messageId, { body: mentions && mentions.length ? { content, mentions } : { content } })
/* -> Message đã thu hồi (idempotent) */
export const recallMessage = messageId => call('POST', '/messages/' + messageId + '/recall', { body: {} })
/* targets [{conversation_id, client_msg_id}] -> {results: [{conversation_id, ok, ack?, error?: {code, message}}]} */
export const forwardMessage = (messageId, targets) => call('POST', '/messages/' + messageId + '/forward', { body: { targets } })
/* -> ReactionSummary {counts, total, mine} */
export const setReaction = (messageId, reaction) => call('PUT', '/messages/' + messageId + '/reaction', { body: { reaction } })
export const removeReaction = messageId => call('DELETE', '/messages/' + messageId + '/reaction')
/* -> {message_id, reactions: [{user_id, display_name, reaction, created_at}]} */
export const listReactions = messageId => call('GET', '/messages/' + messageId + '/reactions')

/* ---- Tìm tin -> {hits: [SearchHit], next_cursor} ---- */
export const searchMessages = ({ q, cursor, limit } = {}) => call('GET', '/search/messages', { query: { q, cursor, limit } })
export const searchConversationMessages = (id, { q, cursor, limit } = {}) =>
  call('GET', '/conversations/' + id + '/messages/search', { query: { q, cursor, limit } })

/* ---- Thiết bị đăng nhập ---- */
/* -> {devices: [Device]} */
export const devices = () => call('GET', '/devices')
export const revokeDevice = deviceId => call('DELETE', '/devices/' + deviceId)
/* -> {revoked: n} */
export const revokeOtherDevices = () => call('POST', '/devices/logout-others', { body: {} })

/* ---- Đăng nhập bằng QR ---- */
/* Máy mới (công khai) -> {qr_id, code, poll_token, expires_in, poll_interval} */
export const qrStart = () => raw('POST', '/auth/qr/start', { body: { device: device() } })
/* -> {status, expires_in, approver?: {display_name}, auth?: AuthResult} */
export const qrPoll = (qrId, pollToken) => raw('POST', '/auth/qr/poll', { body: { qr_id: qrId, poll_token: pollToken } })
/* Máy đã đăng nhập: quét -> QRSession; duyệt / từ chối -> {status} */
export const qrScan = code => call('POST', '/auth/qr/scan', { body: { code } })
export const qrApprove = code => call('POST', '/auth/qr/approve', { body: { code } })
export const qrReject = code => call('POST', '/auth/qr/reject', { body: { code } })
/* Ghim tin nhắn: trả {conversation_id, pins[]} (mới ghim trước, tối đa 5) */
export const pins = id => call('GET', '/conversations/' + id + '/pins')
export const pinMessage = (id, messageId) => call('POST', '/conversations/' + id + '/pins', { body: { message_id: messageId } })
export const unpinMessage = (id, messageId) => call('DELETE', '/conversations/' + id + '/pins/' + messageId)

/* ---- Quản trị nhóm (API.md mục "Quản trị nhóm") ---- */
/* patch {name?, description?, avatar_media_id?}: khoá vắng = giữ nguyên; description ''/null = xoá; avatar_media_id null = xoá ảnh
   -> ConversationDetail */
export const updateGroupInfo = (id, patch) => call('PATCH', '/conversations/' + id, { body: patch || {} })
/* settings {admins_only_send?, admins_only_edit_info?, admins_only_add_members?} -> ConversationDetail */
export const updateGroupSettings = (id, settings) => call('PATCH', '/conversations/' + id + '/settings', { body: settings || {} })
export const transferOwnership = (id, userId) => call('POST', '/conversations/' + id + '/owner', { body: { user_id: userId } })
export const disbandGroup = id => call('POST', '/conversations/' + id + '/disband', { body: {} })
/* -> {invite_link: InviteLink | null} (không có token) */
export const getInviteLink = id => call('GET', '/conversations/' + id + '/invite-link')
/* body {requires_approval?, expires_in?: giây | null} -> {invite_link} CÓ token + url_path */
export const createInviteLink = (id, body) => call('POST', '/conversations/' + id + '/invite-link', { body: body || {} })
export const revokeInviteLink = id => call('DELETE', '/conversations/' + id + '/invite-link')
/* -> InvitePreview {group, requires_approval, expires_at, membership, conversation_id} */
export const invitePreview = token => call('GET', '/invites/' + encodeURIComponent(token))
/* -> {status: joined | pending | already_member, conversation_id, request_id} */
export const joinByInvite = token => call('POST', '/invites/' + encodeURIComponent(token) + '/join', { body: {} })
/* -> {requests: [JoinRequest]} */
export const joinRequests = id => call('GET', '/conversations/' + id + '/join-requests')
export const approveJoinRequest = (id, reqId) => call('POST', '/conversations/' + id + '/join-requests/' + reqId + '/approve', { body: {} })
export const rejectJoinRequest = (id, reqId) => call('POST', '/conversations/' + id + '/join-requests/' + reqId + '/reject', { body: {} })

/* ---- Thông báo đẩy (uid: tài khoản, mặc định của tab) ---- */
export const pushConfig = () => call('GET', '/push/config')
export const registerPush = (subscriptionJson, uid) => call('POST', '/devices/push', { body: { push_kind: 'webpush', push_token: subscriptionJson }, uid })
export const unregisterPush = uid => call('DELETE', '/devices/push', { uid })

/* ---- Tệp đính kèm (ảnh / video / tệp / tin thoại) ---- */
/* -> {enabled, max_bytes:{image,video,file,voice}, max_voice_ms, max_poster_bytes, mimes:{image,video,voice}, denied_ext} */
export const mediaConfig = () => call('GET', '/media/config')
/* body {type, mime, size, sha256, file_name?, width?, height?, duration_ms?, waveform?, poster?:{mime, size}}
   -> {media_id, dedup, upload?:{url, method, headers | fields, expires_at}, poster_upload?, media?} */
export const mediaUploadUrl = body => call('POST', '/media/upload-url', { body })
/* Báo đã tải lên xong: máy chủ kiểm, quét, làm ảnh thu nhỏ (tối đa 60 giây) -> MediaDTO */
export const mediaComplete = id => call('POST', '/media/' + id + '/complete', { timeoutMs: 65000 })
/* -> {media: MediaDTO}, url / thumb_url có hạn; download: tải về dạng tệp; messageId: lấy tên tệp theo tin nhắn đó */
export const mediaGet = (id, { download, messageId } = {}) =>
  call('GET', '/media/' + id, { query: { download: download ? 1 : undefined, message_id: messageId } })

/* Địa chỉ WebSocket: API_BASE (http/https, tuyệt đối hoặc tương đối) -> ws/wss + /api/v1/chat/ws */
export function wsUrl() {
  const u = new URL(API_BASE + '/api/v1/chat/ws', typeof window !== 'undefined' ? window.location.href : 'http://localhost/')
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return u.href
}
