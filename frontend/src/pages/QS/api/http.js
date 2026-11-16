/* Lớp gọi REST /api/v1 của máy chủ Go cho riêng trang QS (không dùng src/api/client.js).
   Theo api()/apiHeaders_() của bản gốc (PUB/app.js:40-62):
   - token + công ty "xem như" đọc lại từ localStorage MỖI lần gọi (qs_token / qs_viewAs);
   - code NOAUTH -> xoá token, phát sự kiện 'qs:noauth', ném QsAuthError;
   - có error -> QsApiError(message, status), 403 -> forbidden;
   - thân không phải JSON (404/413 HTML) -> 'HTTP <status>'; lỗi mạng -> QsUnreachableError; huỷ -> QsAbortError. */

const RAW_BASE = (import.meta.env.VITE_API_URL || '').trim()
export const API_BASE = RAW_BASE.replace(/\/+$/, '')
export const apiConfigured = () => !!API_BASE

export class QsApiError extends Error {
  constructor(message, status, extra) {
    super(message)
    this.name = 'QsApiError'
    this.status = status || 0
    this.forbidden = status === 403
    if (extra) Object.assign(this, extra)
  }
}
export class QsAuthError extends QsApiError {
  constructor(message) { super(message || 'Chưa đăng nhập', 401); this.name = 'QsAuthError' }
}
export class QsUnreachableError extends Error {
  constructor(message) { super(message || ('Không kết nối được máy chủ QS (' + (API_BASE || 'chưa cấu hình') + ')')); this.name = 'QsUnreachableError' }
}
export class QsAbortError extends Error {
  constructor() { super('Đã huỷ'); this.name = 'QsAbortError' }
}
export class QsNotConfiguredError extends Error {
  constructor() { super('Chưa cấu hình VITE_API_URL'); this.name = 'QsNotConfiguredError' }
}

export const isAbort = e => !!e && (e.name === 'QsAbortError' || e.name === 'AbortError')

/* ---- token / view-as: mọi truy cập localStorage đều bọc try/catch, lỗi = chưa đăng nhập ---- */
export function readToken() { try { return localStorage.getItem('qs_token') || '' } catch (e) { return '' } }
export function writeToken(t) { try { if (t) localStorage.setItem('qs_token', t); else localStorage.removeItem('qs_token') } catch (e) { /* bỏ qua */ } }
export function readViewAs() { try { return localStorage.getItem('qs_viewAs') || '' } catch (e) { return '' } }
export function writeViewAs(id) { try { if (id) localStorage.setItem('qs_viewAs', id); else localStorage.removeItem('qs_viewAs') } catch (e) { /* bỏ qua */ } }

/* Header chung (apiHeaders_): Content-Type chỉ khi có thân, không thêm header nào khác (CORS chỉ cho 3 header) */
export function authHeaders(hasBody) {
  const h = {}
  if (hasBody) h['Content-Type'] = 'application/json'
  const t = readToken()
  if (t) h.Authorization = 'Bearer ' + t
  const v = readViewAs()
  if (v) h['x-view-company'] = v
  return h
}

export function noAuth(message) {
  writeToken('')
  try { window.dispatchEvent(new CustomEvent('qs:noauth', { detail: { message: message || 'Phiên đã hết, mời đăng nhập lại.' } })) } catch (e) { /* bỏ qua */ }
  return new QsAuthError('Chưa đăng nhập')
}

/* ---- Nhật ký lỗi phía máy (PUB/app.js:16-28): tối đa 20 lỗi / phiên, bỏ trùng theo nội dung, chưa đăng nhập thì thôi.
   Chỉ gọi từ catch / ErrorBoundary, không bao giờ từ effect lúc render. ---- */
const sentErr = {}
let sentN = 0
export function reportClientError(msg, src, tab) {
  msg = String(msg || '').slice(0, 300)
  if (!msg || sentErr[msg] || sentN >= 20 || !readToken() || !API_BASE) return
  sentErr[msg] = 1; sentN++
  request('POST', '/client-errors', { body: { msg, src: src || '', tab: String(tab || '').trim() }, noLog: true }).catch(() => {})
}
let currentTab = ''
export function setErrorTab(t) { currentTab = t || '' }

/* ---- Phiên bản máy chủ (M1.1, port banMoi_ PUB/app.js:30-38): header x-app-ver của mọi response /api/v1.
   Nhớ giá trị ĐẦU TIÊN thấy được; response sau mang giá trị khác = máy chủ vừa deploy bản mới -> báo cho dải nhắc.
   Giữ ở cấp module (không theo phiên đăng nhập) như S._appVer của bản gốc: rời /qs rồi quay lại vẫn còn. ---- */
let appVer = ''
const verSubs = new Set()
export function noteAppVer(v) {
  if (!v) return
  if (!appVer) { appVer = v; return }
  if (v === appVer) return
  // Bản gốc: đã đóng dải (✕) mà response sau vẫn khác -> hiện lại; báo mọi lần lệch, dải tự bỏ qua khi đang hiện
  verSubs.forEach(fn => { try { fn(v) } catch (e) { /* bỏ qua */ } })
}
export function onNewAppVer(fn) { verSubs.add(fn); return () => verSubs.delete(fn) }

function buildUrl(path, query) {
  let url = API_BASE + '/api/v1' + path
  if (query) {
    const qs = Object.keys(query)
      .filter(k => query[k] !== undefined && query[k] !== null && query[k] !== '')
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(query[k])))
      .join('&')
    if (qs) url += '?' + qs
  }
  return url
}

/* Trang đang tải lại / rời đi (pagehide): trình duyệt cắt các fetch đang dở -> fetch hỏng (thành 'Không kết nối được')
   hoặc đọc thân hỏng (thành 'HTTP 200'). Đó là huỷ, không phải lỗi: tái hiện bằng Playwright tải lại liên tục
   giữa lúc đang nạp dự án (script thử nằm ngoài repo), mọi lỗi đều rơi SAU pagehide. pageshow (về từ bfcache) thì bỏ cờ. */
let roiTrang = false
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { roiTrang = true })
  window.addEventListener('pageshow', () => { roiTrang = false })
}

/* Khoá ghi tạm thời: QS vừa vẽ từ bản đệm (state/bootCache.js) và đang tải bản mới (store.js boot()) -> chặn mọi request
   ghi (không phải GET) tới khi bản mới về, để thao tác không đè lên dữ liệu cũ của bản đệm. Đăng nhập / đăng xuất, chat,
   thông báo không bị chặn. */
let writeLock = ''
export function setWriteLock(msg) { writeLock = msg || '' }
const LOCK_FREE = /^\/(auth|chat|notifications)(\/|$)/

/* request(method, path, {body, query, signal}) -> result (đã bóc {ok,result}) */
export async function request(method, path, opts = {}) {
  const { body, query, signal, noLog } = opts
  if (!API_BASE) throw new QsNotConfiguredError()
  if (writeLock && method !== 'GET' && method !== 'HEAD' && !LOCK_FREE.test(path)) {
    const e = new QsApiError(writeLock, 423)
    e.src = method + ' ' + path
    e.noLog = true
    throw e
  }
  const hasBody = body !== undefined && method !== 'GET' && method !== 'HEAD'
  let res
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers: authHeaders(hasBody),
      body: hasBody ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (e) {
    if (isAbort(e) || (signal && signal.aborted) || roiTrang) throw new QsAbortError()
    throw new QsUnreachableError()
  }
  noteAppVer(res.headers.get('x-app-ver'))
  let d
  try { d = await res.json() } catch (e) {
    // huỷ giữa lúc đang tải thân (rời /qs, tải lại trang) không phải lỗi 'HTTP 200'
    if (isAbort(e) || (signal && signal.aborted) || roiTrang) throw new QsAbortError()
    d = null
  }
  if (d && d.code === 'NOAUTH') throw noAuth()
  let err = null
  if (!d || typeof d !== 'object') err = new QsApiError('HTTP ' + res.status, res.status)
  else if (d.error) err = new QsApiError(String(d.error), res.status)
  else if (!res.ok) err = new QsApiError('HTTP ' + res.status, res.status)
  if (err) {
    err.src = method + ' ' + path
    if (noLog) err.noLog = true
    throw err
  }
  return d.result === undefined ? null : d.result
}

/* Như bản gốc (PUB/app.js:24-27) chỉ ghi lỗi KHÔNG ai bắt: lỗi đã được nơi gọi xử lý (toast, 403...) thì không ghi.
   Chỉ nhận lỗi của lớp API QS, không đụng lỗi của phần còn lại của SiteFlow, không chặn hành vi mặc định. */
if (typeof window !== 'undefined' && !window.__qsRejBound) {
  window.__qsRejBound = true
  window.addEventListener('unhandledrejection', e => {
    const r = e && e.reason
    if (!(r instanceof QsApiError) || r instanceof QsAuthError || r.noLog || r.status === 401) return
    reportClientError('Promise: ' + r.message, r.src || '', currentTab)
  })
}

/* Thăm dò máy chủ khi chưa có token (để hiện thẻ "Không kết nối được" thay vì form đăng nhập).
   no-cors: có phản hồi bất kỳ = tới được máy chủ; chỉ lỗi mạng mới là không tới được. */
export async function ping(signal) {
  if (!API_BASE) throw new QsNotConfiguredError()
  try { await fetch(API_BASE + '/healthz', { method: 'GET', mode: 'no-cors', signal }) } catch (e) {
    if (isAbort(e) || (signal && signal.aborted)) throw new QsAbortError()
    throw new QsUnreachableError()
  }
}

export const enc = v => encodeURIComponent(String(v == null ? '' : v))
