/* Kết nối WebSocket của Dezon Chat (CHAT.md mục 5, 7): MỘT kết nối cho cả tab, tạo một lần ở cấp module (chatStore.js),
   start()/stop() idempotent nên React StrictMode gắn effect hai lần cũng không mở hai socket.
   - Gói đầu tiên là auth {access_token, device_id}; chờ auth.ok tối đa 10 giây.
   - ping mỗi 25 giây, không có pong sau 10 giây -> coi kết nối đã chết, kết nối lại.
   - Kết nối lại theo backoff có jitter 1, 2, 4... tối đa 30 giây; có mạng lại / tab hiện lại -> thử ngay.
   - req_id -> promise (ack / error), hết 10 giây -> lỗi TIMEOUT; mất kết nối -> lỗi CLOSED.
   - Gói reconnect (máy chủ sắp tắt) -> kết nối lại; force_logout -> báo store (kèm phiên đã dùng để store biết thiết bị).
   - Kết nối luôn theo tài khoản ĐANG chọn của tab: stop() rồi start() (đổi tài khoản) trong lúc đang lấy token thì lượt
     kết nối cũ tự bỏ và kết nối lại bằng tài khoản mới. */
import { backoffDelay } from '../state/chatLogic'
import { ensureFreshSession, refreshSession, wsUrl, noteServerTime } from './chatApi'

const PING_EVERY = 25000
const PONG_TIMEOUT = 10000
const AUTH_TIMEOUT = 10000
const CONNECT_TIMEOUT = 15000

export class SocketError extends Error {
  constructor(code, message) { super(message || code); this.name = 'SocketError'; this.code = code }
}

export class ChatSocket {
  /* handlers: onPacket(p), onStatus(status), onAuthed(data), onForceLogout(session), onAuthLost() */
  constructor(handlers) {
    this.h = handlers
    this.status = 'idle' // idle | connecting | authing | online | waiting
    this.wanted = false
    this.ws = null
    this.gen = 0
    this.run = 0 // tăng mỗi lần stop(): việc bất đồng bộ của lượt trước (lấy / làm mới token) tự bỏ
    this.attempt = 0
    this.connecting = false
    this.authRetried = false
    this.authRejected = false
    this.timers = { reconnect: null, ping: null, pong: null, auth: null }
    this.reqs = new Map()
    this.reqSeq = 0
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.kick())
      window.addEventListener('offline', () => { if (this.ws) this.drop('offline') })
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.kick() })
    }
  }

  setStatus(st) {
    if (this.status === st) return
    this.status = st
    try { this.h.onStatus(st) } catch (e) { /* bỏ qua */ }
  }

  isOnline() { return this.status === 'online' }

  start() {
    this.wanted = true
    if (!this.ws && !this.connecting && !this.timers.reconnect) this.connect()
  }

  stop() {
    this.wanted = false
    this.run++
    this.clearTimer('reconnect')
    this.detach()
    this.attempt = 0
    this.setStatus('idle')
  }

  /* Mạng có lại / tab hiện lại: đang chờ kết nối lại thì thử ngay; đang online thì ping để kiểm tra kết nối còn sống */
  kick() {
    if (!this.wanted) return
    if (this.status === 'online') { this.ping(); return }
    if (this.ws || this.connecting) return
    this.clearTimer('reconnect')
    this.attempt = 0
    this.connect()
  }

  clearTimer(name) {
    const t = this.timers[name]
    if (t) { clearTimeout(t); clearInterval(t); this.timers[name] = null }
  }

  async connect() {
    if (!this.wanted || this.ws || this.connecting) return
    this.connecting = true
    this.setStatus('connecting')
    const run = this.run
    let s
    try {
      s = await ensureFreshSession()
    } catch (e) {
      this.connecting = false
      if (run !== this.run) { if (this.wanted) this.connect(); return }
      if (e && e.status === 401) { this.wanted = false; this.setStatus('idle'); this.h.onAuthLost(); return }
      this.schedule()
      return
    }
    if (run !== this.run) { this.connecting = false; if (this.wanted) this.connect(); else this.setStatus('idle'); return }
    if (!this.wanted) { this.connecting = false; this.setStatus('idle'); return }
    let ws
    try { ws = new WebSocket(wsUrl()) } catch (e) { this.connecting = false; this.schedule(); return }
    this.connecting = false
    this.ws = ws
    this.authRejected = false
    const gen = ++this.gen
    // Bắt tay treo (proxy giữ kết nối...) -> bỏ, thử lại theo backoff
    this.timers.auth = setTimeout(() => this.drop('connect-timeout'), CONNECT_TIMEOUT)
    ws.onopen = () => {
      if (gen !== this.gen) return
      this.clearTimer('auth')
      this.setStatus('authing')
      this.raw({ type: 'auth', req_id: 'auth-' + gen, data: { access_token: s.access, device_id: s.deviceId } })
      this.timers.auth = setTimeout(() => this.drop('auth-timeout'), AUTH_TIMEOUT)
    }
    ws.onmessage = ev => { if (gen === this.gen) this.handle(ev.data, s) }
    ws.onerror = () => {
      // Đã mở: onclose theo sau (có mã 4401...). Chưa mở (bắt tay hỏng): không phải môi trường nào cũng phát close -> tự bỏ.
      if (gen !== this.gen || ws.readyState === 1) return
      this.detach()
      this.schedule()
    }
    ws.onclose = ev => {
      if (gen !== this.gen) return
      const authFail = ev.code === 4401 || this.authRejected
      this.detach()
      if (authFail) this.onAuthFail(s)
      else this.schedule()
    }
  }

  /* Bị từ chối xác thực: làm mới token một lần rồi kết nối lại ngay; lần nữa thì chờ backoff */
  async onAuthFail(s) {
    if (!this.wanted) return
    if (this.authRetried) { this.schedule(); return }
    this.authRetried = true
    const run = this.run
    try {
      await refreshSession(s.access, s.uid)
    } catch (e) {
      if (run !== this.run) return
      if (e && e.status === 401) { this.wanted = false; this.setStatus('idle'); this.h.onAuthLost(); return }
      this.schedule()
      return
    }
    if (run !== this.run) return
    if (this.wanted && !this.ws && !this.connecting) this.connect()
  }

  handle(text, s) {
    let p
    try { p = JSON.parse(text) } catch (e) { return }
    if (!p || typeof p.type !== 'string') return
    const d = p.data || {}
    switch (p.type) {
      case 'auth.ok':
        this.clearTimer('auth')
        this.attempt = 0
        this.authRetried = false
        if (d.server_time) noteServerTime(d.server_time)
        this.startPing()
        this.setStatus('online')
        try { this.h.onAuthed(d) } catch (e) { /* bỏ qua */ }
        return
      case 'pong':
        this.clearTimer('pong')
        return
      case 'ack':
        this.settle(p.req_id, null, d)
        return
      case 'error':
        if (this.status !== 'online') { this.authRejected = true; return }
        if (p.req_id && this.reqs.has(p.req_id)) this.settle(p.req_id, new SocketError(d.code || 'INTERNAL', d.message || 'Lỗi máy chủ'))
        else try { this.h.onPacket(p) } catch (e) { /* bỏ qua */ }
        return
      case 'reconnect':
        // Máy chủ sắp tắt / triển khai bản mới: đóng rồi kết nối lại sau 1-2 giây (jitter)
        this.drop('server-reconnect', 1)
        return
      case 'force_logout':
        this.wanted = false
        this.detach()
        this.setStatus('idle')
        try { this.h.onForceLogout(s) } catch (e) { /* bỏ qua */ }
        return
      default:
        try { this.h.onPacket(p) } catch (e) { console.error('[chat] lỗi xử lý gói', p.type, e) }
    }
  }

  startPing() {
    this.clearTimer('ping')
    this.timers.ping = setInterval(() => this.ping(), PING_EVERY)
  }

  ping() {
    if (!this.ws || this.status !== 'online' || this.timers.pong) return
    this.raw({ type: 'ping' })
    this.timers.pong = setTimeout(() => { this.timers.pong = null; this.drop('pong-timeout') }, PONG_TIMEOUT)
  }

  /* Bỏ kết nối hiện tại ngay (không chờ onclose - mạng chết thì onclose có thể đến rất muộn) rồi hẹn kết nối lại */
  drop(reason, attemptFloor) {
    this.detach()
    if (attemptFloor) this.attempt = Math.max(this.attempt, attemptFloor)
    this.schedule()
  }

  /* Tháo kết nối: bỏ handler, dừng timer, từ chối mọi yêu cầu đang chờ */
  detach() {
    this.gen++
    this.clearTimer('auth'); this.clearTimer('ping'); this.clearTimer('pong')
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
      try { ws.close(1000) } catch (e) { /* bỏ qua */ }
    }
    for (const [id, r] of this.reqs) { clearTimeout(r.timer); r.reject(new SocketError('CLOSED', 'Mất kết nối')); this.reqs.delete(id) }
    if (this.status === 'online' || this.status === 'authing') this.setStatus('waiting')
  }

  schedule() {
    if (!this.wanted) { this.setStatus('idle'); return }
    if (this.timers.reconnect) return
    const delay = backoffDelay(this.attempt++)
    this.setStatus('waiting')
    this.timers.reconnect = setTimeout(() => { this.timers.reconnect = null; this.connect() }, delay)
  }

  raw(packet) {
    if (!this.ws || this.ws.readyState !== 1) return false
    try { this.ws.send(JSON.stringify(packet)); return true } catch (e) { return false }
  }

  /* Gửi không cần phản hồi (typing, receipt, presence.subscribe); chưa online -> false */
  send(type, data) {
    if (this.status !== 'online') return false
    return this.raw({ type, data })
  }

  /* Gửi có req_id, chờ ack (resolve data) hoặc error (reject SocketError có code) */
  request(type, data, timeout = 10000) {
    if (this.status !== 'online') return Promise.reject(new SocketError('OFFLINE', 'Chưa kết nối'))
    const reqId = 'c-' + (++this.reqSeq).toString(36)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.reqs.has(reqId)) return
        this.reqs.delete(reqId)
        reject(new SocketError('TIMEOUT', 'Máy chủ không phản hồi'))
      }, timeout)
      this.reqs.set(reqId, { resolve, reject, timer })
      if (!this.raw({ type, req_id: reqId, data })) {
        clearTimeout(timer)
        this.reqs.delete(reqId)
        reject(new SocketError('OFFLINE', 'Chưa kết nối'))
      }
    })
  }

  settle(reqId, err, data) {
    const r = reqId && this.reqs.get(reqId)
    if (!r) return
    this.reqs.delete(reqId)
    clearTimeout(r.timer)
    if (err) r.reject(err)
    else r.resolve(data)
  }
}
