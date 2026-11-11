/* Store của Dezon Chat (giống services/workSession.js: biến cấp module + useSyncExternalStore).
   Một bản duy nhất cho cả tab: socket, timer và listener tạo một lần, start()/stop() idempotent nên React StrictMode
   (gắn effect hai lần) không mở thêm kết nối. Có người xem (subscribe, trang Chat) -> giữ WebSocket; hết người xem 3 giây
   -> đóng (rời trang Chat thì máy chủ coi là offline và gửi push). Người xem thụ động (subscribePassive, huy hiệu ở
   sidebar) chỉ nhận cập nhật, không giữ WebSocket.
   Dữ liệu:
   - convs: hội thoại theo id (gộp từ /conversations, /sync, chi tiết, tin mới), con trỏ seq không bao giờ lùi;
   - msgs[cid].list: tin đã xác nhận, khoá (conversation_id, seq); outbox: tin chờ gửi khoá client_msg_id, lưu
     localStorage chat_outbox:<user id> (tải lại trang không mất), gửi tuần tự sau auth.ok + đồng bộ;
   - rcpt[cid][user]: con trỏ đã nhận / đã xem của thành viên khác; localRead: con trỏ đã xem báo lạc quan ở máy này;
   - presence, typing, friends, requests, blocks, push.
   Nhiều tài khoản trong một trình duyệt, MỖI TAB MỘT TÀI KHOẢN (kho tài khoản + tài khoản của tab ở chatApi.js):
   - accounts: các tài khoản đã đăng nhập trên trình duyệt (bộ chọn tài khoản); accountId: tài khoản của tab;
   - đổi tài khoản chỉ đổi tab này: đóng socket, dọn toàn bộ trạng thái (hội thoại, tin, online, đang soạn, timer, báo
     đã xem đang chờ) rồi khởi động tài khoản kia; outbox, ghim (chat_pins:<id>), lựa chọn push (chat_push:<id>) theo tài khoản;
   - tài khoản của tab bị đăng xuất ở tab khác / bị thu hồi -> tab chuyển sang tài khoản kế tiếp hoặc về cổng đăng nhập.
   Mỗi lần đăng xuất / đổi tài khoản tăng `epoch`: kết quả bất đồng bộ của phiên cũ bị bỏ. */
import { useSyncExternalStore } from 'react'
import * as api from '../api/chatApi'
import { ChatSocket } from '../api/chatSocket'
import * as L from './chatLogic'
import * as M from './chatMedia'
import { putObject } from '../api/chatUpload'

const LEGACY_PINS_KEY = 'chat_pins' // ghim chung của bản một tài khoản -> chat_pins:<id>
const PINS_PREFIX = 'chat_pins:'
const OUTBOX_PREFIX = 'chat_outbox:'
const PUSH_PREF_PREFIX = 'chat_push:' // + user id: 'on' (đã bật trên trình duyệt này) | 'off' (tự tắt)
const VISIBLE_PREFIX = 'chat_visible:' // + user id: {tab, at} - tab đang hiện của tài khoản đó (xem maybeNotify)
const VISIBLE_BEAT_MS = 20000
const VISIBLE_STALE_MS = 45000
const TAB_ID = Math.random().toString(36).slice(2, 10)
const hasWindow = typeof window !== 'undefined'

const pushSupported = () => hasWindow && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
const notifPermission = () => (hasWindow && 'Notification' in window ? Notification.permission : 'unsupported')

/* Ghim của một tài khoản; lần đầu nhận ghim chung của bản cũ (nếu còn) rồi xoá khoá cũ */
function loadPins(uid) {
  if (!uid) return []
  try {
    let raw = localStorage.getItem(PINS_PREFIX + uid)
    if (raw == null) {
      raw = localStorage.getItem(LEGACY_PINS_KEY)
      if (raw != null) { localStorage.setItem(PINS_PREFIX + uid, raw); localStorage.removeItem(LEGACY_PINS_KEY) }
    }
    const v = JSON.parse(raw || '[]')
    return Array.isArray(v) ? v.map(String) : []
  } catch (e) { return [] }
}

function freshState(auth) {
  return {
    auth, // unconfigured | checking | signedout | unreachable | ready
    error: '',
    accounts: api.configured() ? api.listAccounts() : [],
    accountId: api.activeAccountId(),
    me: null,
    net: 'idle', // idle | connecting | authing | online | waiting
    convs: {},
    listLoaded: false,
    listLoading: false,
    listError: '',
    nextCursor: null,
    loadingMore: false,
    msgs: {},
    outbox: [],
    members: {},
    rcpt: {},
    localRead: {},
    presence: {},
    typing: {},
    friends: null,
    requests: null,
    blocks: null,
    pins: [],
    /* tin đang ghim theo hội thoại (máy chủ): {[cid]: [{message_id, seq, sender_name, msg_type, content, ...}]} */
    msgPins: {},
    /* yêu cầu vào nhóm đang chờ duyệt (chỉ owner / admin tải): {[cid]: [JoinRequest]}; chưa tải = undefined */
    joinRequests: {},
    /* link mời hiện hành theo hội thoại: {[cid]: InviteLink | null}, kèm token / url_path nếu máy này còn giữ (chat_invite:<uid>:<cid>) */
    inviteLinks: {},
    push: { supported: pushSupported(), enabled: false, key: null, permission: notifPermission(), subscribed: false, busy: false, error: '', pref: '' },
    /* cấu hình gửi tệp (GET /chat/media/config) + insecure (trang không phải HTTPS: không băm được tệp) + voice (ghi âm được) */
    mediaCfg: mediaCfgOff(),
    /* tiến độ tải lên theo client_msg_id: {progress 0..1, phase, previewUrl, posterUrl} - chỉ trong bộ nhớ, không lưu */
    uploads: {},
    /* giai đoạn 2: tin đang trả lời / đang sửa theo hội thoại {[cid]: Message}; tin cần cuộn tới + tô sáng
       {cid, seq, nonce} | null (Thread cuộn xong gọi clearFocus); thiết bị đăng nhập của tài khoản (bảng Thiết bị) */
    replyTo: {},
    editing: {},
    focus: null,
    devices: { list: null, loading: false, error: '' },
  }
}

function mediaCfgOff() { return { enabled: false, insecure: false, voice: false } }

/* Nạp module (một lần mỗi tab): chuyển phiên kiểu cũ vào kho, chọn tài khoản của tab (?u= -> sessionStorage ->
   chat_last_account -> tài khoản duy nhất), bỏ ?u= khỏi địa chỉ */
if (api.configured()) api.initTab()

function initialAuth() {
  if (!api.configured()) return 'unconfigured'
  return api.readSession().refresh ? 'checking' : 'signedout'
}

let S = freshState(initialAuth())
const subs = new Set()
const passive = new Set()
function emit() { subs.forEach(f => f()); passive.forEach(f => f()) }
function set(patch) {
  const p = typeof patch === 'function' ? patch(S) : patch
  if (!p) return
  S = { ...S, ...p }
  emit()
}
export const getState = () => S

/* ---------- trạng thái ngoài render (reset theo phiên) ---------- */
let epoch = 0
let started = false
let syncCursor = null
let syncing = null
let syncAgain = false
let syncRetry = null
let listPromise = null
let readyToSend = false
let pumping = false
let outboxOrd = 0
let removedHere = new Set()
let openId = null
const drafts = new Map()
const holeTimers = new Map()
const gapFrom = new Map()
const gapRunning = new Set()
const detailInflight = new Map()
const rq = new Map()
let rqTimer = null
let readTimer = null
let readCid = null // hội thoại của readTimer đang chờ
const typingOut = new Map()
let typingPrune = null
let presTimer = null
let presKey = ''
let idleTimer = null
/* tệp đính kèm: tệp gốc / đã nén chỉ giữ trong bộ nhớ tab (không lưu localStorage) */
const MAX_UPLOADS = 2
const blobs = new Map() // client_msg_id -> {file, blob, poster, previewUrl, posterUrl, original, prepared, step, restarts, ctrl}
const uploadQueue = []
let uploadActive = 0
const progBuf = new Map()
let progTimer = null
const mediaRefresh = new Map() // media id -> {at, p, md}
let mediaCfgState = '' // '' (chưa tải / lỗi) | 'loading' | 'ok'
/* giai đoạn 2 */
const listGen = new Map() // cid -> số lần thay danh sách (nhảy tới tin): kết quả tải trang mới nhất bắt đầu trước đó bị bỏ
const jumping = new Set() // hội thoại đang tải trang quanh một tin (jumpToMessage)
const changesSince = new Map() // cid -> mốc sync_cursor cần bù thay đổi (messageChanges) sau lần đồng bộ
let focusNonce = 0
let devicesReq = 0

const sleep = ms => new Promise(r => setTimeout(r, ms))

/* Chờ sự kiện online (hoặc huỷ qua signal) */
function waitOnline(signal) {
  return new Promise(resolve => {
    if (typeof window === 'undefined' || navigator.onLine !== false || (signal && signal.aborted)) { resolve(); return }
    const done = () => {
      window.removeEventListener('online', done)
      if (signal) signal.removeEventListener('abort', done)
      resolve()
    }
    window.addEventListener('online', done)
    if (signal) signal.addEventListener('abort', done)
  })
}

const socket = new ChatSocket({
  onPacket: p => onPacket(p),
  onStatus: st => {
    if (st !== 'online') { readyToSend = false; presKey = '' }
    if (S.net !== st) set({ net: st })
  },
  onAuthed: () => { readyToSend = false; runSync() },
  onForceLogout: s => deviceLoggedOut(s),
  onAuthLost: () => authLost(),
})

function resetSession(auth) {
  epoch++
  clearVisible(S.me && S.me.id)
  socket.stop()
  syncCursor = null; syncing = null; syncAgain = false; listPromise = null
  readyToSend = false; pumping = false; outboxOrd = 0; removedHere = new Set()
  clearTimeout(syncRetry); syncRetry = null
  holeTimers.forEach(t => clearTimeout(t)); holeTimers.clear()
  gapFrom.clear(); gapRunning.clear(); detailInflight.clear()
  rq.clear(); clearTimeout(rqTimer); rqTimer = null
  clearTimeout(readTimer); readTimer = null; readCid = null
  typingOut.clear()
  clearInterval(typingPrune); typingPrune = null
  clearTimeout(presTimer); presTimer = null; presKey = ''
  drafts.clear()
  for (const ent of blobs.values()) dropBlobEntry(ent)
  blobs.clear(); uploadQueue.length = 0; uploadActive = 0
  progBuf.clear(); clearTimeout(progTimer); progTimer = null
  mediaRefresh.clear(); mediaCfgState = ''
  listGen.clear(); jumping.clear(); changesSince.clear(); devicesReq++
  S = freshState(auth)
}

/* ---------- vòng đời ---------- */

function subscribe(f) {
  subs.add(f)
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  start()
  return () => {
    subs.delete(f)
    if (!subs.size && !idleTimer) {
      idleTimer = setTimeout(() => {
        idleTimer = null
        if (subs.size) return
        stopAllTyping()
        socket.stop()
      }, 3000)
    }
  }
}

/* Người xem thụ động (huy hiệu số chưa đọc ở sidebar, có mặt ở mọi trang): nhận cập nhật nhưng KHÔNG giữ WebSocket -
   rời trang Chat thì socket vẫn đóng sau 3 giây để máy chủ coi là offline và gửi push. Lần đầu vẫn khởi động store
   (đồng bộ danh sách qua HTTP, không mở socket khi chưa có người xem chủ động). */
function subscribePassive(f) {
  passive.add(f)
  if (!started) start()
  return () => { passive.delete(f) }
}

function start() {
  if (!api.configured()) return
  /* Lần đầu: khởi động tài khoản của tab. Sau đó, đang ở cổng mà kho đã có phiên (tài khoản mới rời trang ở bước đặt
     tên, chưa signIn): đăng nhập luôn, không bắt làm lại OTP (mỗi lần OTP lại tạo thêm một thiết bị) */
  if (!started || S.auth === 'signedout') {
    if (!started) api.flushPendingLogouts()
    started = true
    const s = api.readSession()
    if (s.refresh) { boot(s.user); return }
    const next = api.resolveAccount(false)
    if (next) { activate(next, false); return }
    if (S.auth !== 'signedout') set({ auth: 'signedout' })
    return
  }
  if (S.auth === 'ready') socket.start()
}

function boot(user) {
  started = true
  resetSession(user ? 'ready' : 'checking')
  if (user) S = { ...S, me: user, outbox: loadOutbox(user.id), pins: loadPins(user.id) }
  markVisible()
  emit()
  refreshMe()
  if (user) afterReady()
}

/* Danh sách tài khoản của bộ chọn: đọc lại kho, đổi thì cập nhật */
function syncAccounts() {
  const list = api.listAccounts()
  if (JSON.stringify(list) !== JSON.stringify(S.accounts)) set({ accounts: list })
}

/* Tab này chuyển sang tài khoản uid (có trong kho): báo nốt đang soạn / đã xem đang chờ, đóng socket, dọn trạng thái
   rồi khởi động tài khoản đó. sessionStorage là của riêng tab: tab khác không đổi. */
function activate(uid, choose) {
  const prev = S.me && S.me.id
  if (prev && prev !== uid && api.hasAccount(prev)) { stopAllTyping(); flushReads() }
  api.setActiveAccount(uid, choose)
  boot(api.readSession(uid).user)
}

/* Bộ chọn tài khoản: đổi tài khoản của tab này */
export function switchAccount(uid) {
  const id = Number(uid)
  if (!id || !api.hasAccount(id)) return false
  if (id === api.activeAccountId() && S.auth !== 'signedout') { api.setActiveAccount(id, true); return true }
  activate(id, true)
  return true
}

/* Tài khoản của tab không còn trong kho (đăng xuất ở đây / ở tab khác, bị thu hồi): chuyển sang tài khoản kế tiếp
   (sessionStorage -> chat_last_account -> tài khoản duy nhất) hoặc về cổng đăng nhập */
function leaveAccount() {
  const next = api.resolveAccount(false)
  if (next) { activate(next, false); return }
  api.setActiveAccount(null)
  if (S.auth === 'signedout') { syncAccounts(); return }
  resetSession('signedout')
  emit()
}

/* Máy chủ từ chối phiên (401): bỏ tài khoản nếu kho vẫn giữ đúng phiên đó; kho đã có phiên mới (đăng nhập lại ở tab
   khác) thì khởi động lại bằng phiên mới */
function dropAccount(used) {
  if (used && used.uid && api.removeAccount(used.uid, { refresh: used.refresh })) forgetPush(used.uid)
  if (api.hasAccount(api.activeAccountId())) boot(api.readSession().user)
  else leaveAccount()
}

/* force_logout: thiết bị của phiên socket đang dùng đã bị đăng xuất / thu hồi. Kho đã có thiết bị khác cho tài khoản
   này (đăng nhập lại cùng số, thiết bị cũ bị xoá) -> kết nối lại bằng phiên mới; không thì bỏ tài khoản. */
function deviceLoggedOut(s) {
  const uid = s && s.uid
  if (uid && uid !== api.activeAccountId()) return
  const cur = api.readSession()
  if (uid && cur.refresh && s.deviceId && cur.deviceId && cur.deviceId !== s.deviceId) {
    if (S.auth === 'ready' && subs.size) socket.start()
    return
  }
  const id = api.activeAccountId()
  if (api.removeAccount(id, s && s.deviceId ? { deviceId: s.deviceId } : null)) forgetPush(id)
  leaveAccount()
}

/* Socket không lấy được phiên: refresh hỏng thì chatApi đã bỏ tài khoản khỏi kho; còn trong kho thì thử lại sau */
function authLost() {
  if (!api.hasAccount(api.activeAccountId())) { leaveAccount(); return }
  const ep = epoch
  setTimeout(() => { if (ep === epoch && S.auth === 'ready' && subs.size) socket.start() }, 2000)
}

function afterReady() {
  runSync()
  if (subs.size) socket.start()
  initPush()
  loadMediaCfg()
}

async function refreshMe() {
  const ep = epoch
  const used = api.readSession()
  try {
    const me = await api.getMe()
    if (ep !== epoch || !me) return
    api.saveUser(me)
    if (S.auth === 'ready') {
      if (S.me && S.me.id !== me.id) { boot(me); return }
      set({ me })
    } else {
      set({ auth: 'ready', me, outbox: loadOutbox(me.id), pins: loadPins(me.id), error: '' })
      markVisible()
      afterReady()
    }
    syncAccounts()
  } catch (e) {
    if (ep !== epoch) return
    if (e && e.status === 401) { dropAccount(used); return }
    if (S.auth === 'checking') set({ auth: 'unreachable', error: (e && e.message) || 'Không kết nối được máy chủ chat' })
  }
}

export function retry() { boot(api.readSession().user) }

/* Cổng đăng nhập gọi sau otp/verify (token đã lưu bằng api.saveSession): tab chuyển sang tài khoản vừa đăng nhập
   (thêm tài khoản: tài khoản đang dùng vẫn đăng nhập, chọn lại được ở bộ chọn tài khoản) */
export function signIn(user) {
  if (user) api.saveUser(user)
  const id = (user && user.id) || api.activeAccountId() || api.resolveAccount(false)
  if (id && api.hasAccount(id)) activate(id, true)
}

/* Đăng xuất một tài khoản (mặc định: của tab): bỏ đăng ký push của tài khoản đó (subscription của trình duyệt chỉ huỷ
   khi không còn tài khoản nào bật thông báo), báo máy chủ (xoá thiết bị), bỏ tin chưa gửi + ghim + lựa chọn thông báo
   của tài khoản, bỏ khỏi kho. Tab đang dùng tài khoản đó chuyển sang tài khoản kế tiếp (hoặc về cổng); tài khoản khác
   vẫn đăng nhập. */
export async function signOut(uid) {
  const id = Number(uid) || (S.me && S.me.id) || api.activeAccountId()
  if (!id) { leaveAccount(); return }
  /* bỏ lựa chọn push TRƯỚC khi chờ mạng: tab khác đăng xuất tài khoản khác cùng lúc thấy ngay tài khoản này không còn
     giữ subscription (không tab nào huỷ thì subscription thành mồ côi) */
  try { localStorage.removeItem(PUSH_PREF_PREFIX + id) } catch (e) { /* bỏ qua */ }
  try { await releasePush(id) } catch (e) { /* bỏ qua */ }
  try {
    await api.logout(id)
  } catch (e) {
    /* phiên đã hết: vẫn đăng xuất ở máy này. Mất mạng / máy chủ lỗi: máy chủ chưa xoá thiết bị -> báo lại sau */
    if (api.transientError(e)) { const s = api.readSession(id); api.queueLogout({ access_token: s.access, refresh_token: s.refresh }) }
  }
  try { for (const k of [OUTBOX_PREFIX, PINS_PREFIX, PUSH_PREF_PREFIX]) localStorage.removeItem(k + id) } catch (e) { /* bỏ qua */ }
  api.removeAccount(id)
  if (id === api.activeAccountId()) leaveAccount()
  else syncAccounts()
}

/* Tài khoản bị bỏ khỏi kho mà không qua signOut (thu hồi phiên, force_logout): bỏ lựa chọn push của nó và huỷ subscription
   của trình duyệt nếu không còn tài khoản nào bật (không để subscription mồ côi) */
function forgetPush(uid) {
  if (!uid) return
  try { localStorage.removeItem(PUSH_PREF_PREFIX + uid) } catch (e) { /* bỏ qua */ }
  releasePush(uid).catch(() => {})
}

api.onForcedSignOut((code, uid) => {
  forgetPush(uid)
  if (uid === api.activeAccountId()) leaveAccount()
  else syncAccounts()
})

/* ---------- danh sách hội thoại + đồng bộ ---------- */

function mergeRows(rows) {
  if (!rows || !rows.length) return
  const was = aliveIds(rows)
  set(s => {
    const convs = { ...s.convs }
    let presence = s.presence
    for (const r of rows) {
      if (!r || !Number.isFinite(r.id)) continue
      convs[r.id] = L.mergeConvRow(convs[r.id], r)
      if (r.peer && Number.isFinite(r.peer.id) && presence[r.peer.id] === undefined) {
        if (presence === s.presence) presence = { ...presence }
        presence[r.peer.id] = { online: !!r.peer.online, last_seen: null }
      }
    }
    return { convs, presence }
  })
  schedulePresence()
  noteDisbanded(was, true)
}

/* Hội thoại đã biết, chưa giải tán, mà dòng sắp gộp báo disbanded: true */
function aliveIds(rows) {
  const out = []
  for (const r of rows) if (r && r.disbanded && S.convs[r.id] && !S.convs[r.id].disbanded) out.push(r.id)
  return out
}
/* Sau khi gộp: hội thoại vừa chuyển sang giải tán -> dọn trạng thái ghi (refresh: tải lại chi tiết, members: []) */
function noteDisbanded(ids, refresh) {
  for (const id of ids) if (L.isDisbanded(S.convs[id])) afterDisband(id, refresh)
}

function upsertDetail(d) {
  if (!d || !Number.isFinite(d.id)) return
  const { members, ...row } = d
  const was = aliveIds([d])
  set(s => {
    const meId = s.me && s.me.id
    const rc = { ...(s.rcpt[d.id] || {}) }
    const ids = new Set()
    for (const m of members || []) {
      ids.add(String(m.user_id))
      if (m.user_id === meId) continue
      rc[m.user_id] = L.mergeReceipt(rc[m.user_id], m.last_delivered_seq, m.last_read_seq)
    }
    /* nhóm đã giải tán: members rỗng -> giữ con trỏ cuối cùng đã biết (lịch sử vẫn hiện đã xem) */
    if (members && !d.disbanded) for (const k of Object.keys(rc)) if (!ids.has(k)) delete rc[k]
    return {
      convs: { ...s.convs, [d.id]: L.mergeConvRow(s.convs[d.id], row) },
      members: members ? { ...s.members, [d.id]: members } : s.members,
      rcpt: { ...s.rcpt, [d.id]: rc },
    }
  })
  schedulePresence()
  noteDisbanded(was, false)
  if (d.id === openId) {
    /* đang mở mà tin chưa tải được (vd từng bị 403 khi bị xoá khỏi nhóm, nay được thêm lại): tải lại */
    const e = S.msgs[d.id]
    if (!e || (!e.loaded && !e.loading)) ensureMessages(d.id)
    scheduleRead()
  }
}

/* Đã rời / bị xoá: bỏ danh sách thành viên + con trỏ của họ (không còn được cập nhật, giữ lại là hiện sai) */
function markLeft(cid) {
  const c = S.convs[cid]
  if (!c || c.left) return
  set(s => {
    const members = { ...s.members }
    delete members[cid]
    const rcpt = { ...s.rcpt }
    delete rcpt[cid]
    return { convs: { ...s.convs, [cid]: { ...s.convs[cid], left: true, disbanded: false } }, members, rcpt }
  })
}

function loadConversations() {
  if (listPromise) return listPromise
  const ep = epoch
  set({ listLoading: true, listError: '' })
  const p = (async () => {
    try {
      const r = await api.conversations({ limit: 50 })
      if (ep !== epoch) return
      mergeRows((r && r.conversations) || [])
      if (r && r.sync_cursor) syncCursor = r.sync_cursor
      set({ listLoaded: true, listLoading: false, nextCursor: (r && r.next_cursor) || null })
    } catch (e) {
      if (ep === epoch) set({ listLoading: false, listError: (e && e.message) || 'Không tải được danh sách hội thoại' })
      throw e
    } finally {
      if (ep === epoch) listPromise = null
    }
  })()
  listPromise = p
  return p
}

export async function loadMoreConversations() {
  if (!S.nextCursor || S.loadingMore) return
  const ep = epoch
  set({ loadingMore: true })
  try {
    const r = await api.conversations({ cursor: S.nextCursor, limit: 50 })
    if (ep !== epoch) return
    mergeRows((r && r.conversations) || [])
    set({ nextCursor: (r && r.next_cursor) || null, loadingMore: false })
  } catch (e) {
    if (ep === epoch) set({ loadingMore: false })
  }
}

/* Đồng bộ sau mỗi auth.ok (CHAT.md mục 11): chưa có danh sách -> tải trang đầu; có rồi -> /sync?cursor.
   Xong thì: tải tin còn thiếu của hội thoại đã mở, báo đã nhận / đã xem, gửi outbox theo thứ tự, đăng ký presence. */
function runSync() {
  if (S.auth !== 'ready') return Promise.resolve()
  if (syncing) { syncAgain = true; return syncing }
  const ep = epoch
  clearTimeout(syncRetry); syncRetry = null
  const p = (async () => {
    let ok = true
    try {
      do {
        syncAgain = false
        if (!S.listLoaded || !syncCursor) {
          await loadConversations()
        } else {
          const since = syncCursor
          const r = await api.sync(syncCursor)
          if (ep !== epoch) return
          if (r && r.truncated) {
            /* quá nhiều hội thoại đổi: bù thay đổi cho mọi hội thoại đang giữ tin trong bộ nhớ */
            for (const k of Object.keys(S.msgs)) noteChanges(Number(k), since)
            await loadConversations()
          } else {
            const rows = (r && r.conversations) || []
            mergeRows(rows)
            for (const row of rows) if (row && Number.isFinite(row.id)) noteChanges(row.id, since)
            if (r && r.sync_cursor) syncCursor = r.sync_cursor
          }
        }
      } while (syncAgain && ep === epoch)
    } catch (e) {
      ok = false
    }
    if (ep !== epoch) return
    if (ok) afterSync()
    else if (socket.isOnline()) syncRetry = setTimeout(() => { syncRetry = null; runSync() }, 5000)
  })()
  syncing = p
  p.finally(() => { if (ep === epoch && syncing === p) syncing = null })
  return p
}

function afterSync() {
  for (const k of Object.keys(S.msgs)) {
    const cid = Number(k)
    const e = S.msgs[cid]
    const c = S.convs[cid]
    if (e && e.loaded && c && c.last_seq > L.maxSeq(e.list)) scheduleHoleCheck(cid, 0)
  }
  /* hội thoại đang mở: tải lại chi tiết + ghim (gói pins.updated có thể đã lỡ khi mất kết nối) */
  if (openId) { ensureMessages(openId); refreshDetail(openId).catch(() => {}); loadMsgPins(openId) }
  reconcileReceipts()
  runChanges()
  if (!mediaCfgState) loadMediaCfg()
  if (rq.size && !rqTimer) rqTimer = setTimeout(flushReceipts, 250)
  if (socket.isOnline()) {
    readyToSend = true
    pumpOutbox()
    updatePresence(true)
    loadRequests().catch(() => {})
  }
}

/* ---------- tin nhắn ---------- */

function setEntry(cid, patch) {
  set(s => ({
    msgs: {
      ...s.msgs,
      [cid]: { list: [], hasMore: true, loaded: false, loading: false, loadingOlder: false, error: '', ...(s.msgs[cid] || {}), ...patch },
    },
  }))
}

function mergeInto(cid, ms) {
  const e = S.msgs[cid]
  const list = L.mergeMessages(e ? e.list : [], ms)
  if (e && list === e.list) return false
  setEntry(cid, { list })
  return true
}

/* Lần mở đầu: 50 tin mới nhất, gộp với tin realtime đã giữ tạm có seq lớn hơn (đến trong lúc tải) */
async function ensureMessages(cid) {
  const e = S.msgs[cid]
  if (e && (e.loaded || e.loading)) return
  if (jumping.has(cid)) return // jumpToMessage đang tải trang quanh tin: không để trang mới nhất đè lên
  const ep = epoch
  const gen = listGen.get(cid) || 0
  setEntry(cid, { loading: true, error: '' })
  try {
    const r = await api.messages(cid, { limit: 50 })
    if (ep !== epoch) return
    if ((listGen.get(cid) || 0) !== gen) { setEntry(cid, { loading: false }); return } // đã nhảy tới tin khác trong lúc tải
    const fetched = (r && r.messages) || []
    const top = L.maxSeq(fetched)
    const cur = S.msgs[cid] || { list: [] }
    const stray = cur.list.filter(m => m.seq > top)
    setEntry(cid, { list: L.mergeMessages(fetched, stray), hasMore: !!(r && r.has_more), loaded: true, loading: false })
    afterIncoming(cid, fetched)
    scheduleHoleCheck(cid, 0)
    if (cid === openId) scheduleRead()
  } catch (err) {
    if (ep !== epoch) return
    setEntry(cid, { loading: false, error: (err && err.message) || 'Không tải được tin nhắn' })
    if (err && (err.status === 403 || err.status === 404)) markLeft(cid)
  }
}

async function reloadLatest(cid) {
  const ep = epoch
  const gen = listGen.get(cid) || 0
  try {
    const r = await api.messages(cid, { limit: 50 })
    if (ep !== epoch || (listGen.get(cid) || 0) !== gen) return
    const fetched = (r && r.messages) || []
    const top = L.maxSeq(fetched)
    const cur = S.msgs[cid] || { list: [] }
    setEntry(cid, { list: L.mergeMessages(fetched, cur.list.filter(m => m.seq > top)), hasMore: !!(r && r.has_more), hasNewer: false, loaded: true })
    afterIncoming(cid, fetched)
  } catch (e) { /* lần đồng bộ sau thử lại */ }
}

export async function loadOlder(cid) {
  const e = S.msgs[cid]
  if (!e || !e.loaded || e.loadingOlder || !e.hasMore || !e.list.length) return
  const ep = epoch
  setEntry(cid, { loadingOlder: true })
  try {
    const r = await api.messages(cid, { before_seq: L.minSeq(e.list), limit: 50 })
    if (ep !== epoch) return
    setEntry(cid, { list: L.mergeMessages(S.msgs[cid].list, (r && r.messages) || []), hasMore: !!(r && r.has_more), loadingOlder: false })
  } catch (err) {
    if (ep === epoch) setEntry(cid, { loadingOlder: false, error: (err && err.message) || 'Không tải được tin cũ' })
  }
}

/* Hở seq (CHAT.md mục 8 bước 10): đợi một chút (tin đang trên đường tới thì tự lấp), còn hở thì tải after_seq.
   Thiếu quá 500 tin -> chỉ tải 50 tin mới nhất (cuộn lên mới tải tiếp). */
function scheduleHoleCheck(cid, delay = 1500) {
  if (holeTimers.has(cid)) return
  holeTimers.set(cid, setTimeout(() => { holeTimers.delete(cid); checkHole(cid) }, delay))
}

function checkHole(cid) {
  const e = S.msgs[cid]
  const c = S.convs[cid]
  if (!e || !e.loaded) return
  const after = L.findHole(e.list, c ? c.last_seq : 0)
  if (after == null) { if (e.hasNewer) setEntry(cid, { hasNewer: false }); return }
  const top = Math.max(c ? c.last_seq : 0, L.maxSeq(e.list))
  /* đang xem trang quanh một tin cũ (nhảy tới tin): không thay bằng trang mới nhất, tải tiếp bằng loadNewer */
  if (top - after > 500) { if (!e.hasNewer) reloadLatest(cid); return }
  fillFrom(cid, after)
}

/* Đang xem trang quanh một tin cũ (hasNewer): tải tiếp 100 tin mới hơn (Thread gọi khi cuộn tới cuối) */
export function loadNewer(cid) {
  const e = S.msgs[cid]
  const c = S.convs[cid]
  if (!e || !e.loaded || !e.list.length) return
  const after = L.findHole(e.list, c ? c.last_seq : 0)
  if (after == null) { if (e.hasNewer) setEntry(cid, { hasNewer: false }); return }
  fillFrom(cid, after, 1)
}

async function fillFrom(cid, after, pages = 5) {
  gapFrom.set(cid, Math.min(gapFrom.has(cid) ? gapFrom.get(cid) : Infinity, after))
  if (gapRunning.has(cid)) return
  gapRunning.add(cid)
  const ep = epoch
  let added = false
  try {
    while (gapFrom.has(cid)) {
      let from = gapFrom.get(cid)
      gapFrom.delete(cid)
      for (let page = 0; page < pages; page++) {
        const r = await api.messages(cid, { after_seq: from, limit: 100 })
        if (ep !== epoch) return
        const ms = (r && r.messages) || []
        if (ms.length && mergeInto(cid, ms)) { added = true; afterIncoming(cid, ms) }
        if (!r || !r.has_more || !ms.length) break
        from = L.maxSeq(ms)
      }
    }
  } catch (e) {
    /* lỗi mạng: lần đồng bộ sau thử lại */
  } finally {
    if (ep === epoch) gapRunning.delete(cid)
  }
  if (ep === epoch && added) scheduleHoleCheck(cid, 3000)
}

/* Tin của người khác vừa đến: báo đã nhận (seq lớn nhất), hội thoại đang mở thì hẹn báo đã xem */
function afterIncoming(cid, ms) {
  const meId = S.me && S.me.id
  let top = 0
  for (const m of ms || []) if (m.sender_id !== meId && m.seq > top) top = m.seq
  if (top) {
    const c = S.convs[cid]
    if (!c || top > (c.last_delivered_seq || 0)) queueReceipt(cid, 'd', top)
  }
  if (cid === openId) scheduleRead()
}

function onPacket(p) {
  const d = p.data || {}
  switch (p.type) {
    case 'message.new': onMessageNew(d); break
    case 'receipt.update': onReceipt(d); break
    case 'presence.update': onPresence(d); break
    case 'typing': onTyping(d); break
    case 'pins.updated': setMsgPins(d); break
    case 'conversation.updated': onConvUpdated(d); break
    case 'members.updated': onMembersUpdated(d); break
    case 'join_requests.updated': onJoinRequestsUpdated(d); break
    case 'message.updated': onMessageUpdated(d); break
    case 'reactions.updated': onReactionsUpdated(d); break
    case 'devices.updated': onDevicesUpdated(d); break
    case 'error': console.warn('[chat] lỗi từ máy chủ:', d.code, d.message); break
    default: break
  }
}

function onMessageNew(m) {
  if (!m || !Number.isFinite(m.conversation_id) || !Number.isFinite(m.seq) || !S.me) return
  const cid = m.conversation_id
  const meId = S.me.id
  if (m.sender_id === meId && m.client_msg_id && S.outbox.some(i => i.client_msg_id === m.client_msg_id)) {
    removedHere.add(m.client_msg_id)
    set(s => ({ outbox: s.outbox.filter(i => i.client_msg_id !== m.client_msg_id) }))
    persistOutbox()
    releaseBlob(m.client_msg_id)
  }
  const e = S.msgs[cid]
  if (e) { mergeInto(cid, [m]); if (e.loaded) scheduleHoleCheck(cid) } else setEntry(cid, { list: [m] })
  const known = !!S.convs[cid]
  if (known) {
    set(s => ({ convs: { ...s.convs, [cid]: L.applyMessageToConv(s.convs[cid], m, meId) } }))
    schedulePresence() // hội thoại vừa lên đầu danh sách: theo dõi online của đối phương (presKey trùng thì không gửi)
  }
  const detail = !known || m.msg_type === 'system' ? refreshDetail(cid) : null
  if (detail) detail.catch(() => {})
  if (m.sender_id !== meId) {
    clearTyping(cid, m.sender_id)
    /* Chat 1-1 mình mở với người lạ: máy chủ chỉ cho xem online khi họ đã nhắn ít nhất một tin (presenceCond), nên lần
       đăng ký trước không có họ - họ vừa nhắn mà chưa có trạng thái online thì đăng ký lại (cùng tập id vẫn gửi) */
    const conv = S.convs[cid]
    if (conv && conv.type === 'direct' && !S.presence[m.sender_id]) { presKey = ''; schedulePresence() }
    /* Tin hệ thống có thể là "đã xoá bạn khỏi nhóm": chờ chi tiết (403 -> đã rời) rồi mới báo đã nhận / đã xem,
       để không gửi receipt cho hội thoại mình không còn trong đó (máy chủ trả FORBIDDEN) */
    if (m.msg_type === 'system' && detail) detail.then(() => afterIncoming(cid, [m]), () => {})
    else afterIncoming(cid, [m])
    maybeNotify(m)
  }
}

function onReceipt(d) {
  const cid = d.conversation_id
  const uid = d.user_id
  if (!Number.isFinite(cid) || !Number.isFinite(uid) || !S.me) return
  if (uid === S.me.id) {
    const c = S.convs[cid]
    if (!c) return
    const last_read_seq = Math.max(c.last_read_seq || 0, Number(d.read_seq) || 0)
    const last_delivered_seq = Math.max(c.last_delivered_seq || 0, Number(d.delivered_seq) || 0, last_read_seq)
    if (last_read_seq === c.last_read_seq && last_delivered_seq === c.last_delivered_seq) return
    set(s => ({ convs: { ...s.convs, [cid]: { ...s.convs[cid], last_read_seq, last_delivered_seq, unread: Math.max(0, (c.last_seq || 0) - last_read_seq) } } }))
    return
  }
  set(s => {
    const cur = s.rcpt[cid] || {}
    return { rcpt: { ...s.rcpt, [cid]: { ...cur, [uid]: L.mergeReceipt(cur[uid], d.delivered_seq, d.read_seq) } } }
  })
}

function onPresence(d) {
  const uid = d.user_id
  if (!Number.isFinite(uid)) return
  set(s => ({ presence: { ...s.presence, [uid]: { online: !!d.online, last_seen: d.last_seen || null } } }))
}

/* conversation.updated: ghi đè tên / mô tả / ảnh / cài đặt / giải tán (gộp theo updated_at). Hội thoại chưa biết -> tải chi
   tiết. Vừa giải tán: thôi báo đang soạn / con trỏ, bỏ hàng chờ duyệt + link mời, tải lại chi tiết (members: []). */
function onConvUpdated(d) {
  const row = L.convUpdateRow(d)
  if (!row || !S.me) return
  const cid = row.id
  if (!S.convs[cid]) { refreshDetail(cid).catch(() => {}); return }
  mergeRows([row])
}

function afterDisband(cid, refresh) {
  stopTyping(cid)
  rq.delete(cid)
  set(s => {
    const joinRequests = { ...s.joinRequests }
    delete joinRequests[cid]
    return { joinRequests, inviteLinks: { ...s.inviteLinks, [cid]: null } }
  })
  if (S.me) writeInviteCache(S.me.id, cid, null)
  if (refresh) refreshDetailFresh(cid)
}

/* members.updated: cập nhật số thành viên; đang mở / đã tải danh sách thành viên thì tải lại chi tiết (vai trò của mình có
   thể đã đổi) */
function onMembersUpdated(d) {
  const cid = d.conversation_id
  if (!Number.isFinite(cid) || !S.convs[cid]) return
  const n = Number(d.member_count)
  if (Number.isFinite(n) && S.convs[cid].member_count !== n) set(s => ({ convs: { ...s.convs, [cid]: { ...s.convs[cid], member_count: n } } }))
  if (cid === openId || S.members[cid]) refreshDetailFresh(cid)
}

/* join_requests.updated (chỉ owner / admin nhận): số yêu cầu chờ; hàng chờ đã tải thì tải lại */
function onJoinRequestsUpdated(d) {
  const cid = d.conversation_id
  if (!Number.isFinite(cid)) return
  const n = Number(d.pending_count)
  if (S.convs[cid] && Number.isFinite(n)) set(s => ({ convs: { ...s.convs, [cid]: { ...s.convs[cid], pending_join_requests: n } } }))
  if (S.joinRequests[cid] !== undefined) loadJoinRequests(cid).catch(() => {})
}

/* ---------- outbox ---------- */

function loadOutbox(uid) {
  let raw = []
  try { raw = JSON.parse(localStorage.getItem(OUTBOX_PREFIX + uid) || '[]') } catch (e) { raw = [] }
  const items = L.orderOutbox(L.restoreOutbox(raw))
  outboxOrd = items.reduce((mx, i) => Math.max(mx, i.ord || 0), outboxOrd)
  return items
}

/* Ghi outbox: giữ tin của tab khác (cùng tài khoản) đang có trong kho, tin của tab này lấy theo bộ nhớ.
   Đổi sang tài khoản khác không xoá outbox của tài khoản cũ: tab đang dùng tài khoản đó đã nhận qua sự kiện storage,
   tab mở sau / quay lại tài khoản đó thì tải lại từ kho. */
function persistOutbox() {
  if (!S.me) return
  const key = OUTBOX_PREFIX + S.me.id
  let stored = []
  try { stored = JSON.parse(localStorage.getItem(key) || '[]') } catch (e) { stored = [] }
  const mine = new Set(S.outbox.map(i => i.client_msg_id))
  const others = (Array.isArray(stored) ? stored : []).filter(i => i && i.tab && i.tab !== TAB_ID && !mine.has(i.client_msg_id) && !removedHere.has(i.client_msg_id))
  const out = others.concat(S.outbox.map(i => ({ ...i, tab: TAB_ID })))
  try {
    if (out.length) localStorage.setItem(key, JSON.stringify(out))
    else localStorage.removeItem(key)
  } catch (e) { /* đầy bộ nhớ: tin vẫn còn trong bộ nhớ tab */ }
}

/* Tab khác (cùng tài khoản) vừa ghi outbox: nhận tin của tab đó mà tab này chưa có (tab kia có thể đã đóng khi mất
   mạng - không ai gửi). Gửi trùng không sao: máy chủ chống trùng theo client_msg_id, ack / message.new bỏ khỏi outbox.
   Chỉ gọi cho outbox của tài khoản ĐANG dùng ở tab (khoá chat_outbox:<id của tab>). */
function adoptOutbox(raw) {
  if (!S.me) return
  let list = []
  try { list = JSON.parse(raw || '[]') } catch (e) { list = [] }
  /* tin tệp tab kia đang tải lên: tệp chỉ có ở tab đó, không nhận (nhận về đây chỉ thành "Tệp chưa tải xong") */
  if (Array.isArray(list)) list = list.filter(i => !(i && L.isMediaType(i.msg_type) && i.status === 'uploading'))
  const have = new Set(S.outbox.map(i => i.client_msg_id))
  const add = L.restoreOutbox(list).filter(i => !have.has(i.client_msg_id) && !removedHere.has(i.client_msg_id))
  if (!add.length) return
  outboxOrd = add.reduce((mx, i) => Math.max(mx, i.ord || 0), outboxOrd)
  set(s => ({ outbox: L.orderOutbox([...s.outbox, ...add]) }))
  pumpOutbox()
}

/* Số tin chưa gửi của tài khoản trên trình duyệt này (cả của tab khác), cho hộp hỏi trước khi đăng xuất */
export function unsentCount() {
  if (!S.me) return S.outbox.length
  const ids = new Set(S.outbox.map(i => i.client_msg_id))
  try {
    const stored = JSON.parse(localStorage.getItem(OUTBOX_PREFIX + S.me.id) || '[]')
    for (const i of L.restoreOutbox(stored)) if (!removedHere.has(i.client_msg_id)) ids.add(i.client_msg_id)
  } catch (e) { /* bỏ qua */ }
  return ids.size
}

function updateOutboxItem(id, patch) {
  set(s => ({ outbox: s.outbox.map(i => (i.client_msg_id === id ? { ...i, ...patch } : i)) }))
  persistOutbox()
}

function newClientMsgId() {
  const c = typeof crypto !== 'undefined' ? crypto : null
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  c.getRandomValues(b)
  return L.uuidFromBytes(b)
}

/* Gửi tin văn bản: hiện ngay (đồng hồ), vào outbox, gửi khi có kết nối. mentions (tuỳ chọn, chỉ nhóm): [{user_id, offset,
   length}] theo đơn vị UTF-16 trên text như truyền vào - tự trừ phần khoảng trắng đầu bị cắt, bỏ phần tử sai. */
export function sendText(cid, text, mentions) {
  const raw = String(text || '')
  const content = raw.trim()
  if (!S.me || !Number.isFinite(cid) || !content || L.runeLength(content) > L.MAX_CONTENT) return false
  const conv = S.convs[cid]
  if (L.isDisbanded(conv)) return false
  const ms = conv && conv.type === 'direct' ? [] : L.normalizeMentions(content, mentions, raw.length - raw.trimStart().length)
  const item = {
    client_msg_id: newClientMsgId(),
    conversation_id: cid,
    content,
    created_at: new Date(api.serverNow()).toISOString(),
    /* thứ tự gửi: tăng dần trong tab, và theo giờ máy giữa các tab (cùng máy) - tin của 2 tab không xen sai thứ tự */
    ord: (outboxOrd = Math.max(outboxOrd + 1, Date.now())),
    status: 'sending',
    tries: 0,
    error: '',
  }
  if (ms.length) item.mentions = ms
  attachReply(cid, item)
  set(s => ({ outbox: [...s.outbox, item] }))
  persistOutbox()
  stopTyping(cid)
  pumpOutbox()
  return true
}

/* Tin đang trả lời của hội thoại (S.replyTo[cid]) gắn vào tin sắp gửi: reply_to_message_id (gửi máy chủ) + reply_to (khung
   trích dẫn dựng ở máy cho bong bóng chờ gửi), rồi bỏ trạng thái đang trả lời */
function attachReply(cid, item) {
  const r = S.replyTo[cid]
  if (!r || !Number.isFinite(r.id) || r.recalled) { if (r) setReplyTo(cid, null); return }
  item.reply_to_message_id = r.id
  item.reply_to = L.replyPreviewOf(r)
  setReplyTo(cid, null)
}

export function retrySend(clientMsgId) {
  const it = S.outbox.find(i => i.client_msg_id === clientMsgId)
  if (it && L.isMediaType(it.msg_type)) return retryMedia(clientMsgId)
  updateOutboxItem(clientMsgId, { status: 'sending', tries: 0, error: '' })
  pumpOutbox()
  return true
}

export function discardPending(clientMsgId) {
  removedHere.add(clientMsgId)
  releaseBlob(clientMsgId)
  set(s => ({ outbox: s.outbox.filter(i => i.client_msg_id !== clientMsgId) }))
  persistOutbox()
}

/* Gửi tuần tự từng tin (giữ đúng thứ tự). Hết 10 giây không có ack -> gửi lại cùng client_msg_id (máy chủ chống trùng);
   3 lần thất bại -> 'failed' ("Gửi lỗi, chạm để thử lại"). Mất kết nối giữa chừng: dừng, gửi tiếp sau lần đồng bộ tới. */
async function pumpOutbox() {
  if (pumping) return
  pumping = true
  const ep = epoch
  try {
    while (ep === epoch && readyToSend && socket.isOnline()) {
      const item = L.nextToSend(S.outbox)
      if (!item) break
      const isMedia = L.isMediaType(item.msg_type)
      const data = {
        conversation_id: item.conversation_id,
        client_msg_id: item.client_msg_id,
        msg_type: item.msg_type || 'text',
        content: item.content,
      }
      if (isMedia) {
        data.attachments = [item.media && item.media.media_id]
        if (item.msg_type === 'file' && item.file_name) data.file_name = item.file_name
      }
      if (Array.isArray(item.mentions) && item.mentions.length) data.mentions = item.mentions
      if (item.reply_to_message_id > 0) data.reply_to_message_id = item.reply_to_message_id
      let ack
      try {
        ack = await socket.request('message.send', data, 10000)
      } catch (e) {
        if (ep !== epoch) return
        const code = e && e.code
        if (code === 'CLOSED' || code === 'OFFLINE') break
        /* tệp đã bị dọn (quá hạn, máy chủ xoá) / chưa sẵn sàng: còn tệp trong bộ nhớ thì tải lên lại, không thì báo chọn lại tệp */
        if (isMedia && (code === 'MEDIA_NOT_FOUND' || code === 'MEDIA_NOT_READY')) { restartMedia(item); continue }
        if (code === 'GROUP_DISBANDED') markDisbanded(item.conversation_id)
        /* tin gốc vừa bị thu hồi / không còn: gửi tiếp KHÔNG trích dẫn (không kẹt tin của người dùng) */
        if (item.reply_to_message_id > 0 && (code === 'MESSAGE_RECALLED' || code === 'NOT_FOUND')) {
          set(s => ({ outbox: s.outbox.map(i => {
            if (i.client_msg_id !== item.client_msg_id) return i
            const n = { ...i }
            delete n.reply_to_message_id
            delete n.reply_to
            return n
          }) }))
          persistOutbox()
          continue
        }
        const retriable = code === 'TIMEOUT' || code === 'INTERNAL' || code === 'RATE_LIMIT'
        const tries = (item.tries || 0) + 1
        if (retriable && tries < 3) {
          updateOutboxItem(item.client_msg_id, { tries })
          if (code === 'RATE_LIMIT') await sleep(1000)
          continue
        }
        updateOutboxItem(item.client_msg_id, { tries, status: 'failed', error: retriable ? '' : ((e && e.message) || '') })
        continue
      }
      if (ep !== epoch) return
      onAck(item, ack || {})
    }
  } finally {
    if (ep === epoch) pumping = false
  }
}

function onAck(item, ack) {
  const me = S.me
  removedHere.add(item.client_msg_id)
  set(s => ({ outbox: s.outbox.filter(i => i.client_msg_id !== item.client_msg_id) }))
  persistOutbox()
  releaseBlob(item.client_msg_id)
  if (!me || !Number.isFinite(ack.seq)) return
  const m = {
    id: ack.message_id,
    conversation_id: item.conversation_id,
    seq: ack.seq,
    client_msg_id: item.client_msg_id,
    sender_id: me.id,
    sender_name: me.display_name,
    msg_type: item.msg_type || 'text',
    content: item.content,
    created_at: ack.created_at || item.created_at,
  }
  if (item.file_name) m.file_name = item.file_name
  /* nhắc tên như máy chủ đã lưu (bỏ người không còn trong nhóm...); gửi trùng: của tin gốc. Ack không có khoá mentions
     = tin đã lưu không nhắc ai (máy chủ bỏ khoá khi rỗng), KHÔNG dùng lại nhắc tên chưa kiểm ở máy */
  const ms = ack.mentions
  if (Array.isArray(ms) && ms.length) m.mentions = ms
  /* tệp lấy theo ack của máy chủ (địa chỉ ký, ảnh thu nhỏ...), không dùng media_id giữ ở máy */
  if (Array.isArray(ack.attachments) && ack.attachments.length) m.attachments = ack.attachments
  /* trích dẫn như máy chủ đã lưu (gửi trùng: của tin gốc) */
  if (ack.reply_to) m.reply_to = ack.reply_to
  const cid = m.conversation_id
  const e = S.msgs[cid]
  if (e) { mergeInto(cid, [m]); if (e.loaded) scheduleHoleCheck(cid) } else setEntry(cid, { list: [m] })
  if (S.convs[cid]) set(s => ({ convs: { ...s.convs, [cid]: L.applyMessageToConv(s.convs[cid], m, me.id) } }))
  else refreshDetail(cid).catch(() => {})
}

/* ---------- tệp đính kèm (ảnh / video / tệp / tin thoại) ----------
   Mỗi tệp là một tin trong outbox: status 'uploading' (đang chuẩn bị / tải lên, phase prepare -> url -> put -> complete)
   -> 'sending' (phase 'done', có media_id, pumpOutbox gửi message.send kèm attachments) -> ack. Tối đa 2 tệp tải cùng lúc.
   Thứ tự: nextToSend chỉ lấy tin 'sending' nên tin văn bản gõ sau ảnh đang tải KHÔNG phải chờ - máy chủ xếp theo seq lúc
   nhận; ở máy người gửi, bong bóng ảnh chờ gửi giữ chỗ theo ord giữa các tin chờ cho tới khi có ack rồi về đúng vị trí seq.
   Tiến độ (S.uploads) báo tối đa ~10 lần/giây; chỉ đổi phase / media_id mới ghi localStorage. */

function revokeUrl(u) { if (u && hasWindow && typeof URL.revokeObjectURL === 'function') { try { URL.revokeObjectURL(u) } catch (e) { /* bỏ qua */ } } }
function objectUrl(b) { return b && hasWindow && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(b) : '' }

function dropBlobEntry(ent) {
  if (ent.ctrl) { try { ent.ctrl.abort() } catch (e) { /* bỏ qua */ } }
  revokeUrl(ent.previewUrl)
  revokeUrl(ent.posterUrl)
}

/* Bỏ tệp trong bộ nhớ của tin (ack, huỷ, tin đã có ở máy chủ): huỷ tải lên đang chạy, thu hồi địa chỉ xem trước */
function releaseBlob(id) {
  const ent = blobs.get(id)
  if (ent) { blobs.delete(id); dropBlobEntry(ent) }
  const qi = uploadQueue.indexOf(id)
  if (qi >= 0) uploadQueue.splice(qi, 1)
  progBuf.delete(id)
  if (S.uploads[id]) set(s => { const u = { ...s.uploads }; delete u[id]; return { uploads: u } })
}

function setUpload(id, patch) {
  if (!blobs.has(id)) return
  set(s => ({ uploads: { ...s.uploads, [id]: { ...(s.uploads[id] || { progress: 0 }), ...patch } } }))
}

function flushProgress() {
  clearTimeout(progTimer); progTimer = null
  if (!progBuf.size) return
  const list = Array.from(progBuf)
  progBuf.clear()
  set(s => {
    let u = null
    for (const [id, p] of list) {
      if (!s.uploads[id] || s.uploads[id].progress === p) continue
      if (!u) u = { ...s.uploads }
      u[id] = { ...u[id], progress: p }
    }
    return u ? { uploads: u } : null
  })
}

function noteProgress(id, loaded, total) {
  progBuf.set(id, total > 0 ? Math.max(0, Math.min(1, loaded / total)) : 0)
  if (!progTimer) progTimer = setTimeout(flushProgress, 100)
}

async function loadMediaCfg() {
  if (mediaCfgState === 'loading' || S.auth !== 'ready') return
  const ep = epoch
  mediaCfgState = 'loading'
  try {
    const cfg = await api.mediaConfig()
    if (ep !== epoch) return
    mediaCfgState = 'ok'
    // máy chủ bật tệp nhưng trang không phải HTTPS (không băm được tệp): insecure -> nút đính kèm mờ "Cần HTTPS để gửi tệp"
    if (!(cfg && cfg.enabled)) set({ mediaCfg: mediaCfgOff() })
    else if (!M.mediaSupported()) set({ mediaCfg: { ...mediaCfgOff(), insecure: true } })
    else set({ mediaCfg: { ...cfg, enabled: true, insecure: false, voice: M.voiceSupported() } })
  } catch (e) {
    if (ep !== epoch) return
    mediaCfgState = '' // thử lại ở lần đồng bộ sau
    if (S.mediaCfg.enabled) set({ mediaCfg: mediaCfgOff() })
  }
}

/* Thêm một tin tệp vào outbox (hiện ngay bong bóng chờ gửi) rồi xếp hàng tải lên */
function addMediaItem(cid, kind, file, { content = '', original = false, fileName, mime, durationMs, waveform, reply = false } = {}) {
  const id = newClientMsgId()
  const item = {
    client_msg_id: id,
    conversation_id: cid,
    msg_type: kind,
    content,
    created_at: new Date(api.serverNow()).toISOString(),
    ord: (outboxOrd = Math.max(outboxOrd + 1, Date.now())),
    status: 'uploading',
    tries: 0,
    error: '',
    media: {
      media_id: null, type: kind, mime: mime || 'application/octet-stream', size: file.size, sha256: '',
      width: null, height: null, duration_ms: Number.isFinite(durationMs) ? durationMs : null, waveform: waveform || null,
    },
    phase: 'prepare',
  }
  if (fileName) item.file_name = fileName
  if (reply) attachReply(cid, item)
  const previewUrl = kind === 'file' ? '' : objectUrl(file)
  blobs.set(id, { file, blob: null, poster: null, previewUrl, posterUrl: '', original: !!original, prepared: false, step: '', restarts: 0, ctrl: null })
  set(s => ({ outbox: [...s.outbox, item], uploads: { ...s.uploads, [id]: { progress: 0, phase: 'prepare', previewUrl, posterUrl: '' } } }))
  persistOutbox()
  enqueueUpload(id)
  return id
}

/* Gửi tệp người dùng chọn / dán / kéo thả: mỗi tệp một tin, chú thích đi kèm tệp đầu tiên.
   original: gửi ảnh gốc (không nén). -> {ok, count, errors: ["tên tệp: lý do"]} (tệp bị chặn / quá lớn không vào outbox) */
export function sendMedia(cid, files, { caption, original } = {}) {
  const cfg = S.mediaCfg
  if (!S.me || !Number.isFinite(cid)) return { ok: false, count: 0, errors: [] }
  if (!cfg.enabled) return { ok: false, count: 0, errors: [cfg.insecure ? 'Cần HTTPS để gửi tệp' : 'Máy chủ chưa bật gửi ảnh / tệp'] }
  const cap = String(caption || '').trim()
  if (L.runeLength(cap) > L.MAX_CONTENT) return { ok: false, count: 0, errors: ['Chú thích quá dài (tối đa ' + L.MAX_CONTENT + ' ký tự)'] }
  const errors = []
  let count = 0
  for (const file of Array.from(files || [])) {
    if (!file) continue
    const kind = M.kindOf(file, cfg)
    /* ảnh sẽ nén: giới hạn dung lượng kiểm sau khi nén */
    const err = kind === 'image' && !original ? (file.size > 0 ? '' : 'Tệp rỗng') : M.checkFile(file, kind, cfg)
    if (err) { errors.push((file.name ? file.name + ': ' : '') + err); continue }
    addMediaItem(cid, kind, file, {
      content: count === 0 ? cap : '',
      reply: count === 0, // trả lời: chỉ tệp đầu (kèm chú thích)
      original,
      fileName: kind === 'file' ? String(file.name || '').split(/[/\\]/).pop() || 'tep' : undefined,
      mime: M.mimeOf(file),
    })
    count++
  }
  if (count) stopTyping(cid)
  return { ok: count > 0, count, errors }
}

/* Gửi tin thoại: blob ghi âm, meta {duration_ms, mime?, waveform?} (thiếu sóng âm thì tự tính khi chuẩn bị) -> {ok, count, errors} */
export function sendVoice(cid, blob, meta = {}) {
  const cfg = S.mediaCfg
  if (!S.me || !Number.isFinite(cid) || !blob) return { ok: false, count: 0, errors: [] }
  if (!cfg.enabled) return { ok: false, count: 0, errors: [cfg.insecure ? 'Cần HTTPS để gửi tệp' : 'Máy chủ chưa bật gửi ảnh / tệp'] }
  const durationMs = Math.round(Number(meta.duration_ms) || 0)
  if (durationMs < 1000) return { ok: false, count: 0, errors: ['Tin thoại quá ngắn'] }
  if (cfg.max_voice_ms > 0 && durationMs > cfg.max_voice_ms) return { ok: false, count: 0, errors: ['Tin thoại quá dài'] }
  const err = M.checkFile({ name: 'voice', size: blob.size }, 'voice', cfg)
  if (err) return { ok: false, count: 0, errors: [err] }
  const wf = Array.isArray(meta.waveform) && meta.waveform.length
    ? meta.waveform.slice(0, 128).map(v => Math.max(0, Math.min(255, Math.round(Number(v) || 0))))
    : null
  addMediaItem(cid, 'voice', blob, { mime: M.baseMime(meta.mime || blob.type) || 'audio/webm', durationMs, waveform: wf, reply: true })
  stopTyping(cid)
  return { ok: true, count: 1, errors: [] }
}

function enqueueUpload(id) {
  if (!uploadQueue.includes(id)) uploadQueue.push(id)
  pumpUploads()
}

function pumpUploads() {
  while (uploadActive < MAX_UPLOADS && uploadQueue.length) {
    const id = uploadQueue.shift()
    const ep = epoch
    uploadActive++
    uploadItem(id)
      .catch(e => console.warn('[chat] tải tệp lỗi:', e))
      .finally(() => { if (ep === epoch) { uploadActive--; pumpUploads() } })
  }
}

/* Chuẩn bị tệp: nén ảnh, ảnh bìa video, sóng âm tin thoại, rồi băm sha256 */
async function prepareMedia(id, ent) {
  const it = S.outbox.find(i => i.client_msg_id === id)
  const cfg = S.mediaCfg
  const media = { ...it.media }
  const kind = it.msg_type
  ent.blob = ent.file
  if (kind === 'image') {
    const r = await M.compressImage(ent.file, { original: ent.original })
    ent.blob = r.blob || ent.file
    media.mime = M.baseMime(r.mime) || media.mime
    if (r.width > 0 && r.height > 0) { media.width = r.width; media.height = r.height }
    const err = M.checkFile({ name: ent.file.name, size: ent.blob.size }, 'image', cfg)
    if (err) throw new api.ChatApiError(err, 0, 'MEDIA_TOO_LARGE')
  } else if (kind === 'video') {
    const r = await M.videoPoster(ent.file)
    if (r.width > 0 && r.height > 0) { media.width = r.width; media.height = r.height }
    if (r.duration_ms > 0) media.duration_ms = r.duration_ms
    if (r.poster && (!(cfg.max_poster_bytes > 0) || r.poster.size <= cfg.max_poster_bytes)) {
      ent.poster = r.poster
      ent.posterUrl = objectUrl(r.poster)
      setUpload(id, { posterUrl: ent.posterUrl })
    }
  } else if (kind === 'voice') {
    if (!Array.isArray(media.waveform) || !media.waveform.length) media.waveform = await M.voiceWaveform(ent.blob, 64)
  }
  media.size = ent.blob.size
  media.sha256 = await M.sha256Hex(ent.blob)
  ent.prepared = true
  return media
}

function uploadBody(it, ent) {
  const md = it.media
  const b = { type: it.msg_type, mime: md.mime, size: md.size, sha256: md.sha256 }
  if (it.msg_type === 'file') b.file_name = it.file_name || 'tep'
  if (it.msg_type === 'video') {
    if (md.width > 0 && md.height > 0) { b.width = md.width; b.height = md.height }
    if (md.duration_ms > 0) b.duration_ms = md.duration_ms
    if (ent.poster) b.poster = { mime: 'image/jpeg', size: ent.poster.size }
  }
  if (it.msg_type === 'voice') { b.duration_ms = md.duration_ms; b.waveform = md.waveform }
  return b
}

/* Chạy các bước tải lên của một tin tệp; lỗi thì thử lại theo L.uploadRetry (mất mạng 1/3/9 giây, địa chỉ hết hạn -> xin
   địa chỉ mới cùng hash, MEDIA_NOT_UPLOADED -> tải lên lại một lần, MEDIA_NOT_READY -> báo xong lại sau 3 giây, tối đa 5 lần),
   còn lại -> 'failed' kèm lời báo của máy chủ */
async function uploadItem(id) {
  const ep = epoch
  const ent = blobs.get(id)
  const cur = () => S.outbox.find(i => i.client_msg_id === id)
  if (!ent || !cur() || cur().status !== 'uploading') return
  const alive = () => ep === epoch && blobs.get(id) === ent && !!cur() && cur().status === 'uploading'
  const ctrl = new AbortController()
  ent.ctrl = ctrl
  let step = ent.step || (ent.prepared ? 'url' : 'prepare')
  ent.step = ''
  let target = null
  const counts = {}
  const phase = p => {
    if (cur().phase !== p) updateOutboxItem(id, { phase: p })
    if (!S.uploads[id] || S.uploads[id].phase !== p) setUpload(id, { phase: p })
  }
  while (alive()) {
    try {
      if (step === 'prepare') {
        phase('prepare')
        const media = await prepareMedia(id, ent)
        if (!alive()) return
        updateOutboxItem(id, { media: { ...media, media_id: cur().media.media_id } })
        step = 'url'
      } else if (step === 'url') {
        phase('url')
        const r = await api.mediaUploadUrl(uploadBody(cur(), ent))
        if (!alive()) return
        target = r || {}
        if (Number(target.media_id) > 0 && target.media_id !== cur().media.media_id) updateOutboxItem(id, { media: { ...cur().media, media_id: Number(target.media_id) } })
        step = target.dedup ? 'done' : 'put'
      } else if (step === 'put') {
        if (!target || !target.upload) { step = 'url'; continue }
        phase('put')
        noteProgress(id, 0, 1)
        await putObject(target.upload, ent.blob, { signal: ctrl.signal, onProgress: (l, t) => noteProgress(id, l, t) })
        if (target.poster_upload && ent.poster) await putObject(target.poster_upload, ent.poster, { signal: ctrl.signal })
        if (!alive()) return
        step = 'complete'
      } else if (step === 'complete') {
        const mid = cur().media.media_id
        if (!mid) { step = 'url'; continue }
        phase('complete')
        await api.mediaComplete(mid)
        if (!alive()) return
        step = 'done'
      } else {
        flushProgress()
        setUpload(id, { phase: 'done', progress: 1 })
        updateOutboxItem(id, { phase: 'done', status: 'sending', tries: 0, error: '' })
        pumpOutbox()
        return
      }
    } catch (e) {
      if (!alive()) return
      const code = (e && e.code) || ''
      // trình duyệt báo mất mạng: chờ có mạng lại rồi chạy tiếp đúng bước, không tính vào số lần thử (như tin văn bản chờ socket)
      if (code === 'NETWORK' && typeof navigator !== 'undefined' && navigator.onLine === false) {
        await waitOnline(ctrl.signal)
        continue
      }
      const key = step + ':' + code
      const n = counts[key] || 0
      counts[key] = n + 1
      let r = L.uploadRetry(step, code, n)
      if (r.action === 'complete' && !cur().media.media_id) r = { action: 'fail' }
      if (r.action === 'stop') return
      if (r.action === 'fail') {
        updateOutboxItem(id, { status: 'failed', error: (e && e.message) || 'Tải tệp lên lỗi' })
        return
      }
      if (r.delay) await sleep(r.delay)
      if (r.action !== 'again') step = r.action
    }
  }
}

/* message.send báo MEDIA_NOT_FOUND / MEDIA_NOT_READY (tệp quá hạn bị dọn, hoặc chưa xử lý xong): còn tệp trong bộ nhớ thì
   tải lại từ bước xin địa chỉ (cùng hash), tối đa 2 lần; không còn -> 'failed' "Tệp đã hết hạn, hãy chọn lại tệp" */
function restartMedia(item) {
  const id = item.client_msg_id
  const ent = blobs.get(id)
  if (ent && ent.prepared && ent.restarts < 2) {
    ent.restarts++
    ent.step = 'url'
    updateOutboxItem(id, { status: 'uploading', phase: 'url', tries: 0, error: '' })
    setUpload(id, { progress: 0, phase: 'url' })
    enqueueUpload(id)
    return
  }
  updateOutboxItem(id, { status: 'failed', tries: (item.tries || 0) + 1, error: ent ? 'Tệp chưa sẵn sàng để gửi, thử lại sau' : L.MEDIA_EXPIRED })
}

/* Thử lại tin tệp bị lỗi: đã tải lên xong -> gửi lại; còn tệp trong bộ nhớ -> tải lên lại (từ bước đang dở);
   tệp đã mất (tải lại trang) -> báo chọn lại tệp. -> true nếu đã thử lại */
export function retryMedia(clientMsgId) {
  const it = S.outbox.find(i => i.client_msg_id === clientMsgId)
  if (!it) return false
  if (!L.isMediaType(it.msg_type)) return retrySend(clientMsgId)
  const ent = blobs.get(clientMsgId)
  if (it.media && it.media.media_id && it.phase === 'done') {
    updateOutboxItem(clientMsgId, { status: 'sending', tries: 0, error: '' })
    pumpOutbox()
    return true
  }
  if (!ent) { updateOutboxItem(clientMsgId, { status: 'failed', error: L.UPLOAD_LOST }); return false }
  ent.restarts = 0
  updateOutboxItem(clientMsgId, { status: 'uploading', tries: 0, error: '' })
  setUpload(clientMsgId, { progress: 0, phase: it.phase })
  enqueueUpload(clientMsgId)
  return true
}

/* Huỷ tệp đang tải lên (nút huỷ trên bong bóng): dừng tải, bỏ tin khỏi outbox */
export function cancelUpload(clientMsgId) {
  discardPending(clientMsgId)
}

/* Lấy lại địa chỉ ký mới của tệp (ảnh lỗi tải / sắp hết hạn), vá vào msgs và last_message. Chống gọi dồn: mỗi tệp một yêu
   cầu đang chạy, 30 giây gọi lại tối đa một lần. -> MediaDTO | null */
export function refreshMedia(mediaId) {
  const id = Number(mediaId)
  if (!(id > 0) || S.auth !== 'ready') return Promise.resolve(null)
  const prev = mediaRefresh.get(id)
  if (prev && prev.p) return prev.p
  if (prev && Date.now() - prev.at < 30000) return Promise.resolve(prev.md)
  const ep = epoch
  const ent = { at: Date.now(), p: null, md: null }
  mediaRefresh.set(id, ent)
  ent.p = api.mediaGet(id).then(r => {
    ent.p = null
    ent.at = Date.now()
    const md = r && r.media
    if (ep !== epoch || !md) return null
    ent.md = md
    patchMedia(md)
    return md
  }, () => { ent.p = null; ent.at = Date.now(); return null })
  return ent.p
}

function patchMedia(md) {
  set(s => {
    let msgs = s.msgs
    let convs = s.convs
    for (const k of Object.keys(s.msgs)) {
      const e = s.msgs[k]
      let changed = false
      const list = e.list.map(m => { const n = L.patchMessageMedia(m, md); if (n !== m) changed = true; return n })
      if (changed) { if (msgs === s.msgs) msgs = { ...s.msgs }; msgs[k] = { ...e, list } }
    }
    for (const k of Object.keys(s.convs)) {
      const c = s.convs[k]
      const lm = c.last_message && L.patchMessageMedia(c.last_message, md)
      if (lm && lm !== c.last_message) { if (convs === s.convs) convs = { ...s.convs }; convs[k] = { ...c, last_message: lm } }
    }
    return msgs === s.msgs && convs === s.convs ? null : { msgs, convs }
  })
}

/* ---------- đã nhận / đã xem ---------- */

function queueReceipt(cid, kind, seq) {
  const cur = rq.get(cid) || {}
  cur[kind] = Math.max(cur[kind] || 0, seq)
  rq.set(cid, cur)
  if (!rqTimer) rqTimer = setTimeout(flushReceipts, 250)
}

/* Gộp theo hội thoại; read đã kéo theo delivered ở máy chủ nên có read thì không gửi delivered. Tối đa 20 gói / lượt. */
function flushReceipts() {
  rqTimer = null
  if (!socket.isOnline()) return
  let n = 0
  for (const [cid, v] of Array.from(rq)) {
    if (n >= 20) break
    const c = S.convs[cid]
    if (c && (c.left || c.disbanded)) { rq.delete(cid); continue } // nhóm đã giải tán: máy chủ từ chối con trỏ (410)
    const needR = v.r && (!c || v.r > (c.last_read_seq || 0))
    const needD = v.d && (!c || v.d > (c.last_delivered_seq || 0))
    let ok = true
    if (needR) ok = socket.send('message.read', { conversation_id: cid, seq: v.r })
    else if (needD) ok = socket.send('message.delivered', { conversation_id: cid, seq: v.d })
    if (!ok) break
    rq.delete(cid)
    if (needR || needD) n++
  }
  if (rq.size && !rqTimer) rqTimer = setTimeout(flushReceipts, 1000)
}

function reconcileReceipts() {
  for (const c of Object.values(S.convs)) {
    if (c.left || c.disbanded) continue
    if ((c.last_seq || 0) > (c.last_delivered_seq || 0)) queueReceipt(c.id, 'd', c.last_seq)
    const lr = S.localRead[c.id] || 0
    if (lr > (c.last_read_seq || 0)) queueReceipt(c.id, 'r', lr)
  }
  if (openId) scheduleRead()
}

const docVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible'

/* Hội thoại đang mở + trang đang hiện: số chưa đọc về 0 ngay, gói message.read gộp 1 giây */
function scheduleRead() {
  if (!openId || !docVisible()) return
  const cid = openId
  const e = S.msgs[cid]
  const c = S.convs[cid]
  if (!e || !e.loaded || !c) return
  const top = L.maxSeq(e.list)
  if (top > Math.max(c.last_read_seq || 0, S.localRead[cid] || 0)) set(s => ({ localRead: { ...s.localRead, [cid]: top } }))
  /* timer đang chờ là của hội thoại khác (vừa chuyển sang hội thoại này trong 1 giây): báo đã xem của nó luôn, không huỷ */
  if (readTimer && readCid !== cid) queueRead(readCid)
  clearTimeout(readTimer)
  readCid = cid
  readTimer = setTimeout(() => {
    readTimer = null
    readCid = null
    queueRead(cid)
  }, 1000)
}

function queueRead(cid) {
  const lr = S.localRead[cid] || 0
  const cc = S.convs[cid]
  if (cc && !cc.left && !cc.disbanded && lr > (cc.last_read_seq || 0)) queueReceipt(cid, 'r', lr)
}

/* Trước khi rời tài khoản (đổi tài khoản): gửi ngay báo đã xem / đã nhận đang chờ gộp (socket còn mở thì đi được) */
function flushReads() {
  if (readTimer) {
    clearTimeout(readTimer)
    readTimer = null
    const cid = readCid
    readCid = null
    if (cid) queueRead(cid)
  }
  if (rq.size) { clearTimeout(rqTimer); flushReceipts() }
}

/* ---------- đang soạn tin ---------- */

/* Ô soạn tin đổi: có chữ -> typing.start tối đa 3 giây một lần; trống -> typing.stop */
export function noteTyping(cid, text) {
  if (!Number.isFinite(cid) || !socket.isOnline()) return
  const c = S.convs[cid]
  if (c && (L.isDisbanded(c) || (c.type === 'group' && !L.canDo(c.role, c.settings, 'typing')))) return // máy chủ bỏ qua im lặng
  const st = typingOut.get(cid) || { last: 0, active: false }
  if (!String(text || '').trim()) {
    if (st.active) { socket.send('typing.stop', { conversation_id: cid }); st.active = false; st.last = 0 }
  } else if (Date.now() - st.last >= 3000) {
    if (socket.send('typing.start', { conversation_id: cid })) { st.last = Date.now(); st.active = true }
  }
  typingOut.set(cid, st)
}

export function stopTyping(cid) {
  const st = typingOut.get(cid)
  if (st && st.active) {
    socket.send('typing.stop', { conversation_id: cid })
    st.active = false
    st.last = 0
  }
}

function stopAllTyping() { for (const cid of typingOut.keys()) stopTyping(cid) }

function onTyping(d) {
  const cid = d.conversation_id
  const uid = d.user_id
  if (!Number.isFinite(cid) || !Number.isFinite(uid) || (S.me && uid === S.me.id)) return
  if (!d.is_typing) { clearTyping(cid, uid); return }
  set(s => ({ typing: { ...s.typing, [cid]: { ...(s.typing[cid] || {}), [uid]: Date.now() + 5000 } } }))
  if (!typingPrune) typingPrune = setInterval(pruneTyping, 1000)
}

function clearTyping(cid, uid) {
  const t = S.typing[cid]
  if (!t || !(uid in t)) return
  const n = { ...t }
  delete n[uid]
  set(s => ({ typing: { ...s.typing, [cid]: n } }))
}

/* Ẩn "đang soạn tin" sau 5 giây không có tín hiệu mới */
function pruneTyping() {
  const now = Date.now()
  let changed = false
  const next = {}
  for (const [cid, t] of Object.entries(S.typing)) {
    const n = {}
    for (const [uid, exp] of Object.entries(t)) { if (exp > now) n[uid] = exp; else changed = true }
    if (Object.keys(n).length) next[cid] = n
  }
  if (changed) set({ typing: next })
  if (!Object.keys(next).length) { clearInterval(typingPrune); typingPrune = null }
}

/* ---------- online ---------- */

function schedulePresence() {
  if (presTimer) return
  presTimer = setTimeout(() => { presTimer = null; updatePresence(false) }, 400)
}

/* presence.subscribe: đối phương 1-1 đang hiện đầu danh sách + thành viên hội thoại đang mở, tối đa 50 */
function updatePresence(force) {
  if (!socket.isOnline() || !S.me) return
  const ids = L.presenceTargets(sortedConversations().slice(0, 40), openId ? S.members[openId] : null, S.me.id, 50)
  const key = ids.join(',')
  if (!force && key === presKey) return
  presKey = key
  /* Người không còn trong tập theo dõi: bỏ trạng thái cũ (không còn được cập nhật, giữ lại là "Đang hoạt động" mãi);
     giao diện lấy lại peer.online của dòng hội thoại */
  const keep = new Set(ids)
  const stale = Object.keys(S.presence).filter(k => !keep.has(Number(k)))
  if (stale.length) {
    set(s => {
      const presence = { ...s.presence }
      for (const k of stale) delete presence[k]
      return { presence }
    })
  }
  socket.send('presence.subscribe', { user_ids: ids })
}

/* ---------- hội thoại đang mở ---------- */

export function setOpenConversation(cid) {
  const id = Number.isFinite(cid) ? cid : null
  if (openId === id) return
  if (openId) stopTyping(openId)
  openId = id
  if (!id || S.auth !== 'ready') return
  /* mở lại hội thoại đang để ở trang quanh một tin cũ (lần nhảy trước): về trang mới nhất */
  const e = S.msgs[id]
  if (e && e.hasNewer && !jumping.has(id) && !(S.focus && S.focus.cid === id)) reloadLatestReplace(id)
  ensureMessages(id)
  refreshDetail(id).catch(() => {})
  loadMsgPins(id)
  scheduleRead()
  schedulePresence()
}

function refreshDetail(cid) {
  if (detailInflight.has(cid)) return detailInflight.get(cid)
  const ep = epoch
  const p = api.conversation(cid)
    .then(d => { if (ep === epoch) upsertDetail(d); return d })
    .catch(e => { if (ep === epoch && e && (e.status === 403 || e.status === 404)) markLeft(cid); throw e })
    .finally(() => { if (ep === epoch) detailInflight.delete(cid) })
  detailInflight.set(cid, p)
  return p
}
export const loadDetail = cid => refreshDetail(cid)

/* Tải lại chi tiết SAU thay đổi vừa báo: đang có yêu cầu bay (có thể bắt đầu trước thay đổi) thì tải thêm một lần sau nó */
function refreshDetailFresh(cid) {
  const p = detailInflight.get(cid)
  if (!p) { refreshDetail(cid).catch(() => {}); return }
  const ep = epoch
  p.catch(() => {}).then(() => { if (ep === epoch) refreshDetail(cid).catch(() => {}) })
}

/* ---------- ghim tin nhắn (máy chủ, gói pins.updated) ---------- */

function setMsgPins(r) {
  if (!r || !Number.isFinite(r.conversation_id)) return
  set(s => ({ msgPins: { ...s.msgPins, [r.conversation_id]: Array.isArray(r.pins) ? r.pins : [] } }))
}
function loadMsgPins(cid) {
  const ep = epoch
  api.pins(cid).then(r => { if (ep === epoch) setMsgPins(r) }).catch(() => {})
}
export async function pinMessage(cid, messageId) { const ep = epoch; const r = await gw(cid, api.pinMessage(cid, messageId)); sameAccount(ep); setMsgPins(r) }
export async function unpinMessage(cid, messageId) { const ep = epoch; const r = await gw(cid, api.unpinMessage(cid, messageId)); sameAccount(ep); setMsgPins(r) }
export const openMessages = cid => ensureMessages(cid)

export function getDraft(cid) { return drafts.get(cid) || '' }
export function setDraft(cid, text) { if (text) drafts.set(cid, text); else drafts.delete(cid) }

export function togglePin(id) {
  const key = String(id)
  const pins = S.pins.includes(key) ? S.pins.filter(x => x !== key) : [key, ...S.pins]
  if (S.me) { try { localStorage.setItem(PINS_PREFIX + S.me.id, JSON.stringify(pins)) } catch (e) { /* bỏ qua */ } }
  set({ pins })
}

/* ---------- hành động hội thoại ---------- */

/* Kết quả của thao tác bắt đầu ở tài khoản trước (tab đã đổi tài khoản / đăng xuất trong lúc chờ): không gộp vào trạng
   thái của tài khoản hiện tại, báo lỗi để nơi gọi không làm tiếp (vd. mở hội thoại vừa tạo) */
function sameAccount(ep) {
  if (ep !== epoch) throw new api.ChatApiError('Đã đổi tài khoản, thao tác của tài khoản trước bị bỏ', 0, 'ACCOUNT_CHANGED')
}

/* Máy chủ báo 410 GROUP_DISBANDED (nhóm vừa bị giải tán, gói conversation.updated chưa tới / đã lỡ): đánh dấu ngay */
function markDisbanded(cid) {
  if (S.convs[cid] && !S.convs[cid].disbanded) mergeRows([{ id: cid, disbanded: true, member_count: 0, pending_join_requests: 0 }])
}
/* Thao tác ghi trên nhóm: lỗi GROUP_DISBANDED thì đánh dấu nhóm đã giải tán rồi ném lỗi tiếp */
async function gw(cid, p) {
  const ep = epoch
  try {
    return await p
  } catch (e) {
    if (ep === epoch && e && e.code === 'GROUP_DISBANDED') markDisbanded(cid)
    throw e
  }
}

export async function startDirect(userId) {
  const ep = epoch
  const d = await api.createDirect(userId)
  sameAccount(ep)
  upsertDetail(d)
  return d.id
}
export async function createGroup(name, memberIds) {
  const ep = epoch
  const d = await api.createGroup(name, memberIds)
  sameAccount(ep)
  upsertDetail(d)
  return d.id
}
export async function renameGroup(cid, name) { const ep = epoch; const d = await gw(cid, api.renameConversation(cid, name)); sameAccount(ep); upsertDetail(d) }
export async function addMembers(cid, userIds) { const ep = epoch; const d = await gw(cid, api.addMembers(cid, userIds)); sameAccount(ep); upsertDetail(d) }
export async function removeMember(cid, userId) {
  const ep = epoch
  await gw(cid, api.removeMember(cid, userId))
  sameAccount(ep)
  if (S.me && userId === S.me.id) markLeft(cid)
  else refreshDetail(cid).catch(() => {})
}
export async function setMemberRole(cid, userId, role) { const ep = epoch; const d = await gw(cid, api.setMemberRole(cid, userId, role)); sameAccount(ep); upsertDetail(d) }
export async function setMute(cid, until) { const ep = epoch; const r = await gw(cid, api.muteConversation(cid, until)); sameAccount(ep); mergeRows([r]) }

/* ---------- quản trị nhóm (API.md "Quản trị nhóm") ---------- */

/* Đổi tên / mô tả / ảnh nhóm: chỉ gửi khoá có trong patch (vắng = giữ nguyên; description ''/null = xoá; avatar_media_id
   null = xoá ảnh) -> ConversationDetail */
export async function updateGroupInfo(cid, patch = {}) {
  const body = {}
  for (const k of ['name', 'description', 'avatar_media_id']) if (patch && patch[k] !== undefined) body[k] = patch[k]
  const ep = epoch
  const d = await gw(cid, api.updateGroupInfo(cid, body))
  sameAccount(ep)
  upsertDetail(d)
  return d
}

/* Cắt giữa thành ảnh vuông cạnh ≤ 512 px, JPEG (ảnh nhóm). Trình duyệt không vẽ được -> giữ tệp gốc. */
const AVATAR_EDGE = 512
async function squareAvatar(file) {
  const keep = { blob: file, mime: M.baseMime(file.type) || 'image/jpeg' }
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return keep
  let bmp
  try { bmp = await createImageBitmap(file) } catch (e) { return keep }
  try {
    const side = Math.min(bmp.width, bmp.height)
    if (!side) return keep
    const edge = Math.min(AVATAR_EDGE, side)
    const c = document.createElement('canvas')
    c.width = edge
    c.height = edge
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, edge, edge)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, edge, edge)
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88))
    return blob && blob.size ? { blob, mime: 'image/jpeg', width: edge, height: edge } : keep
  } catch (e) {
    return keep
  } finally {
    if (bmp && bmp.close) bmp.close()
  }
}

/* Tải ảnh nhóm: cắt vuông -> upload-url (loại image) -> PUT -> complete -> PATCH avatar_media_id. Trả ConversationDetail. */
export async function uploadGroupAvatar(cid, file) {
  if (!file) throw new api.ChatApiError('Chưa chọn ảnh', 400, 'BAD_REQUEST')
  const ep = epoch
  if (!S.mediaCfg.enabled) await loadMediaCfg()
  sameAccount(ep)
  if (!S.mediaCfg.enabled) throw new api.ChatApiError(S.mediaCfg.insecure ? 'Trang cần HTTPS để tải ảnh lên' : 'Máy chủ chưa bật gửi tệp', 503, 'MEDIA_DISABLED')
  const kind = M.kindOf(file, S.mediaCfg)
  if (kind !== 'image') throw new api.ChatApiError('Ảnh nhóm phải là tệp ảnh', 400, 'BAD_REQUEST')
  const img = await squareAvatar(file)
  const err = M.checkFile({ name: file.name, size: img.blob.size }, 'image', S.mediaCfg)
  if (err) throw new api.ChatApiError(err, 413, 'MEDIA_TOO_LARGE')
  const body = { type: 'image', mime: img.mime, size: img.blob.size, sha256: await M.sha256Hex(img.blob) }
  if (img.width) { body.width = img.width; body.height = img.height }
  const r = (await api.mediaUploadUrl(body)) || {}
  sameAccount(ep)
  const mid = Number(r.media_id)
  if (!(mid > 0)) throw new api.ChatApiError('Không tải được ảnh lên, thử lại sau', 0, 'INTERNAL')
  if (!r.dedup) {
    if (!r.upload) throw new api.ChatApiError('Không tải được ảnh lên, thử lại sau', 0, 'INTERNAL')
    await putObject(r.upload, img.blob)
    sameAccount(ep)
    await api.mediaComplete(mid)
    sameAccount(ep)
  }
  return updateGroupInfo(cid, { avatar_media_id: mid })
}

/* settings {admins_only_send?, admins_only_edit_info?, admins_only_add_members?} -> ConversationDetail */
export async function updateGroupSettings(cid, settings = {}) {
  const body = {}
  for (const k of ['admins_only_send', 'admins_only_edit_info', 'admins_only_add_members']) if (settings && typeof settings[k] === 'boolean') body[k] = settings[k]
  const ep = epoch
  const d = await gw(cid, api.updateGroupSettings(cid, body))
  sameAccount(ep)
  upsertDetail(d)
  return d
}

export async function transferOwnership(cid, userId) {
  const ep = epoch
  const d = await gw(cid, api.transferOwnership(cid, userId))
  sameAccount(ep)
  upsertDetail(d)
  return d
}

/* Giải tán (chỉ trưởng nhóm): nhóm còn đọc được, mọi thao tác ghi bị chặn. conversation.updated tới sau cũng gộp được. */
export async function disbandGroup(cid) {
  const ep = epoch
  await gw(cid, api.disbandGroup(cid))
  sameAccount(ep)
  if (S.convs[cid]) mergeRows([{ id: cid, disbanded: true, member_count: 0, pending_join_requests: 0 }])
  else refreshDetail(cid).catch(() => {})
}

/* ---- link mời: token chỉ có lúc tạo, máy này giữ lại ở localStorage chat_invite:<uid>:<cid> = {id, token, url_path} ---- */

function readInviteCache(uid, cid) {
  try {
    const v = JSON.parse(localStorage.getItem(L.inviteCacheKey(uid, cid)) || 'null')
    return v && Number.isFinite(v.id) && typeof v.token === 'string' ? v : null
  } catch (e) { return null }
}
function writeInviteCache(uid, cid, link) {
  try {
    const k = L.inviteCacheKey(uid, cid)
    if (link && link.token) localStorage.setItem(k, JSON.stringify({ id: link.id, token: link.token, url_path: link.url_path || '/chat/join/' + link.token }))
    else localStorage.removeItem(k)
  } catch (e) { /* bỏ qua */ }
}
function setInviteLink(cid, link) { set(s => ({ inviteLinks: { ...s.inviteLinks, [cid]: link || null } })) }

/* Link mời hiện hành (null khi chưa có / đã thu hồi / nhóm đã giải tán); còn token của đúng link đó ở máy này thì gắn
   token + url_path, link khác (đã tạo lại ở máy khác) thì bỏ token cũ */
export async function getInviteLink(cid) {
  const ep = epoch
  const r = await api.getInviteLink(cid)
  sameAccount(ep)
  let link = (r && r.invite_link) || null
  const uid = S.me && S.me.id
  const cached = uid ? readInviteCache(uid, cid) : null
  if (link && cached && cached.id === link.id) link = { ...link, token: cached.token, url_path: cached.url_path }
  else if (cached && uid) writeInviteCache(uid, cid, null)
  setInviteLink(cid, link)
  return link
}

/* opts {expires_in?: giây | null, requires_approval? (nhận cả require_approval)} - link cũ bị thu hồi ("tạo lại link") */
export async function createInviteLink(cid, opts = {}) {
  const body = { requires_approval: !!(opts.requires_approval != null ? opts.requires_approval : opts.require_approval) }
  if (opts.expires_in != null) body.expires_in = Number(opts.expires_in)
  const ep = epoch
  const r = await gw(cid, api.createInviteLink(cid, body))
  sameAccount(ep)
  const link = (r && r.invite_link) || null
  if (S.me) writeInviteCache(S.me.id, cid, link)
  setInviteLink(cid, link)
  return link
}

export async function revokeInviteLink(cid) {
  const ep = epoch
  await gw(cid, api.revokeInviteLink(cid))
  sameAccount(ep)
  if (S.me) writeInviteCache(S.me.id, cid, null)
  setInviteLink(cid, null)
}

/* Link đầy đủ để sao chép (cần token: chỉ link tạo ở máy này) */
export const inviteLinkUrl = link => L.inviteUrl(hasWindow ? window.location.origin : '', link)

/* Xem trước nhóm từ token (InvitePreview) - mọi tài khoản chat đã đăng nhập */
export async function invitePreview(token) {
  const ep = epoch
  const r = await api.invitePreview(token)
  sameAccount(ep)
  return r
}

/* Tham gia qua link: joined / already_member -> tải chi tiết hội thoại (có ngay trong danh sách); pending -> chờ duyệt */
export async function joinByInvite(token) {
  const ep = epoch
  const r = await api.joinByInvite(token)
  sameAccount(ep)
  const cid = r && Number(r.conversation_id)
  if (cid > 0 && (r.status === 'joined' || r.status === 'already_member')) {
    try { await refreshDetail(cid) } catch (e) { /* message.new / lần đồng bộ sau sẽ tải */ }
  }
  return r
}

/* ---- yêu cầu vào nhóm (owner / admin) ---- */

function setJoinRequests(cid, list) {
  set(s => {
    const c = s.convs[cid]
    const convs = c && list.length < 500 && c.pending_join_requests !== list.length ? { ...s.convs, [cid]: { ...c, pending_join_requests: list.length } } : s.convs
    return { joinRequests: { ...s.joinRequests, [cid]: list }, convs }
  })
}

export async function loadJoinRequests(cid) {
  const ep = epoch
  const r = await gw(cid, api.joinRequests(cid))
  sameAccount(ep)
  const list = (r && Array.isArray(r.requests)) ? r.requests : []
  setJoinRequests(cid, list)
  return list
}

/* Duyệt / từ chối: bỏ yêu cầu khỏi hàng chờ (kể cả khi máy chủ báo không còn chờ - 404); duyệt xong tải lại chi tiết */
async function decideJoinRequest(call, cid, reqId) {
  const ep = epoch
  const drop = () => { if (ep === epoch && S.joinRequests[cid]) setJoinRequests(cid, S.joinRequests[cid].filter(x => x.id !== reqId)) }
  try {
    const r = await gw(cid, call(cid, reqId))
    sameAccount(ep)
    drop()
    return r
  } catch (e) {
    if (e && e.status === 404 && e.code === 'NOT_FOUND') drop()
    throw e
  }
}
export async function approveJoinRequest(cid, reqId) {
  const r = await decideJoinRequest(api.approveJoinRequest, cid, reqId)
  refreshDetailFresh(cid)
  return r
}
export const rejectJoinRequest = (cid, reqId) => decideJoinRequest(api.rejectJoinRequest, cid, reqId)

/* ---------- giai đoạn 2: trả lời, sửa, thu hồi, chuyển tiếp, reaction, nhảy tới tin, tìm tin, thiết bị ----------
   (API.md "Giai đoạn 2"). Thao tác đi qua REST; kết quả gộp ngay vào store, gói message.updated / reactions.updated tới
   sau (kể cả ở các thiết bị khác của mình) gộp lại idempotent. Mất kết nối: sau auth.ok + /sync gọi messages/changes cho
   các hội thoại /sync trả về mà máy đang giữ tin (chỉ thay tin đã có theo seq, không chèn). */

/* Thay các tin đã sửa / thu hồi (msgs, last_message, tin đang trả lời / đang sửa). fromRest: xem L.applyMessageUpdate */
function applyUpdates(cid, ms, fromRest) {
  const list = (ms || []).filter(m => m && Number.isFinite(m.seq))
  if (!list.length) return
  set(s => {
    const out = {}
    const e = s.msgs[cid]
    if (e) {
      let l = e.list
      for (const m of list) l = L.applyMessageUpdate(l, m, fromRest)
      if (l !== e.list) out.msgs = { ...s.msgs, [cid]: { ...e, list: l } }
    }
    const c = s.convs[cid]
    if (c) {
      let n = c
      for (const m of list) n = L.patchLastMessage(n, m)
      if (n !== c) out.convs = { ...s.convs, [cid]: n }
    }
    for (const m of list) {
      const r = (out.replyTo || s.replyTo)[cid]
      if (r && r.id === m.id) {
        out.replyTo = { ...(out.replyTo || s.replyTo) }
        if (m.recalled) delete out.replyTo[cid]
        else out.replyTo[cid] = { ...r, ...m }
      }
      const ed = (out.editing || s.editing)[cid]
      if (ed && ed.id === m.id && m.recalled) {
        out.editing = { ...(out.editing || s.editing) }
        delete out.editing[cid]
      }
    }
    return Object.keys(out).length ? out : null
  })
}

/* message.updated {conversation_id, action: edit | recall, message} (message không có reactions: giữ reaction đang có) */
function onMessageUpdated(d) {
  const cid = d && d.conversation_id
  const m = d && d.message
  if (!Number.isFinite(cid) || !m || !Number.isFinite(m.seq) || !S.me) return
  const msg = d.action === 'recall' && !m.recalled ? { ...m, recalled: true } : m
  applyUpdates(cid, [msg], false)
}

/* reactions.updated {conversation_id, message_id, seq, counts, total, user_id, reaction} */
function onReactionsUpdated(d) {
  const cid = d && d.conversation_id
  if (!Number.isFinite(cid) || !S.me) return
  const e = S.msgs[cid]
  if (!e) return
  const list = L.applyReactionsUpdate(e.list, d, S.me.id)
  if (list !== e.list) setEntry(cid, { list })
}

/* devices.updated {reason, device_id}: bảng thiết bị đã tải thì tải lại */
function onDevicesUpdated() {
  if (S.devices.list !== null) loadDevices()
}

/* ---- bù thay đổi sau khi mất kết nối ---- */

function noteChanges(cid, since) {
  if (!since || !Number.isFinite(cid) || changesSince.has(cid)) return
  changesSince.set(cid, since)
}

function runChanges() {
  for (const [cid, since] of Array.from(changesSince)) {
    changesSince.delete(cid)
    const e = S.msgs[cid]
    if (!e || !e.list.length) continue
    const ep = epoch
    catchUpChanges(cid, since).catch(err => {
      if (ep === epoch && api.transientError(err)) noteChanges(cid, since) // thử lại ở lần đồng bộ sau
    })
  }
}

async function catchUpChanges(cid, since) {
  const ep = epoch
  let cursor = null
  for (let page = 0; page < 20; page++) {
    const e = S.msgs[cid]
    if (!e || !e.list.length) return
    const r = await api.messageChanges(cid, cursor ? { cursor, limit: 200 } : { since, limit: 200 })
    if (ep !== epoch) return
    const ms = (r && r.messages) || []
    if (ms.length) applyUpdates(cid, ms, true)
    if (!r || !r.next_cursor || !ms.length) return
    cursor = r.next_cursor
  }
}

/* ---- trả lời / sửa ---- */

/* Đang trả lời tin message (null = huỷ); bỏ chế độ sửa của hội thoại đó */
export function setReplyTo(cid, message) {
  if (!Number.isFinite(cid)) return
  set(s => {
    if (!message && !s.replyTo[cid]) return null
    const replyTo = { ...s.replyTo }
    if (message) replyTo[cid] = message
    else delete replyTo[cid]
    let editing = s.editing
    if (message && editing[cid]) { editing = { ...editing }; delete editing[cid] }
    return { replyTo, editing }
  })
}

/* Đang sửa tin message (null = huỷ); bỏ trạng thái đang trả lời của hội thoại đó */
export function setEditing(cid, message) {
  if (!Number.isFinite(cid)) return
  set(s => {
    if (!message && !s.editing[cid]) return null
    const editing = { ...s.editing }
    if (message) editing[cid] = message
    else delete editing[cid]
    let replyTo = s.replyTo
    if (message && replyTo[cid]) { replyTo = { ...replyTo }; delete replyTo[cid] }
    return { editing, replyTo }
  })
}

/* Lưu sửa tin văn bản: text + mentions như sendText (offset theo text truyền vào, tự trừ khoảng trắng đầu). -> Message mới */
export async function submitEdit(cid, messageId, text, mentions) {
  const raw = String(text || '')
  const content = raw.trim()
  if (!content) throw new api.ChatApiError('Nội dung tin nhắn không được để trống', 400, 'BAD_REQUEST')
  if (L.runeLength(content) > L.MAX_CONTENT) throw new api.ChatApiError('Tin nhắn tối đa ' + L.MAX_CONTENT + ' ký tự', 400, 'BAD_REQUEST')
  const conv = S.convs[cid]
  const ms = conv && conv.type === 'direct' ? [] : L.normalizeMentions(content, mentions, raw.length - raw.trimStart().length)
  const ep = epoch
  const msg = await gw(cid, api.editMessage(messageId, { content, mentions: ms }))
  sameAccount(ep)
  if (msg) applyUpdates(cid, [msg], true)
  if (S.editing[cid] && S.editing[cid].id === messageId) setEditing(cid, null)
  stopTyping(cid)
  return msg
}

/* Thu hồi (idempotent) -> Message đã thu hồi */
export async function recallMessage(cid, messageId) {
  const ep = epoch
  const msg = await gw(cid, api.recallMessage(messageId))
  sameAccount(ep)
  if (msg) applyUpdates(cid, [msg.recalled ? msg : { ...msg, recalled: true }], true)
  return msg
}

/* ---- chuyển tiếp ---- */

function findMessage(messageId) {
  for (const k of Object.keys(S.msgs)) {
    const m = S.msgs[k].list.find(x => x.id === messageId)
    if (m) return m
  }
  return null
}

/* Một đích chuyển tiếp thành công: biết tin nguồn thì hiện ngay tin mới (như ack của message.send), không thì nâng last_seq
   rồi để lấp chỗ hở / message.new tải */
function applyForwardAck(cid, ack, src) {
  const me = S.me
  if (!me || !ack || !Number.isFinite(ack.seq)) return
  if (!src) {
    const c = S.convs[cid]
    if (!c) { refreshDetail(cid).catch(() => {}); return }
    if (ack.seq > (c.last_seq || 0)) set(s => ({ convs: { ...s.convs, [cid]: { ...s.convs[cid], last_seq: ack.seq } } }))
    const e = S.msgs[cid]
    if (e && e.loaded) scheduleHoleCheck(cid, 0)
    return
  }
  const m = {
    id: ack.message_id,
    conversation_id: cid,
    seq: ack.seq,
    client_msg_id: ack.client_msg_id || null,
    sender_id: me.id,
    sender_name: me.display_name,
    msg_type: src.msg_type,
    content: src.content || '',
    created_at: ack.created_at,
    forwarded: true,
  }
  if (Array.isArray(ack.attachments) && ack.attachments.length) m.attachments = ack.attachments
  else if (Array.isArray(src.attachments) && src.attachments.length) m.attachments = src.attachments
  if (src.file_name) m.file_name = src.file_name
  const e = S.msgs[cid]
  if (e) { mergeInto(cid, [m]); if (e.loaded) scheduleHoleCheck(cid) } else setEntry(cid, { list: [m] })
  if (S.convs[cid]) set(s => ({ convs: { ...s.convs, [cid]: L.applyMessageToConv(s.convs[cid], m, me.id) } }))
  else refreshDetail(cid).catch(() => {})
}

/* Chuyển tiếp một tin tới các hội thoại cids (1..20), mỗi đích một client_msg_id -> {results: [{conversation_id, ok, ack?,
   error?: {code, message}}]} đúng thứ tự. Lỗi của cả yêu cầu (tin nguồn đã thu hồi, không đọc được...) -> ném lỗi. */
export async function forwardMessage(messageId, cids) {
  const ids = Array.from(new Set((cids || []).map(Number).filter(n => Number.isInteger(n) && n > 0)))
  if (!ids.length || ids.length > 20) throw new api.ChatApiError('Chọn từ 1 đến 20 cuộc trò chuyện', 400, 'BAD_REQUEST')
  const targets = ids.map(cid => ({ conversation_id: cid, client_msg_id: newClientMsgId() }))
  const ep = epoch
  const r = await api.forwardMessage(messageId, targets)
  sameAccount(ep)
  const src = findMessage(messageId)
  const results = (r && Array.isArray(r.results)) ? r.results : []
  for (const it of results) {
    if (!it) continue
    if (it.ok && it.ack) applyForwardAck(it.conversation_id, it.ack, src)
    else if (it.error && it.error.code === 'GROUP_DISBANDED') markDisbanded(it.conversation_id)
  }
  return { results }
}

/* ---- reaction ---- */

function patchReactions(cid, messageId, reactions) {
  const e = S.msgs[cid]
  if (!e) return
  let changed = false
  const list = e.list.map(m => {
    if (m.id !== messageId) return m
    if ((m.reactions || null) === (reactions || null)) return m
    changed = true
    const n = { ...m }
    if (reactions && reactions.total > 0) n.reactions = reactions
    else delete n.reactions
    return n
  })
  if (changed) setEntry(cid, { list })
}

const summaryOf = r => (r && r.total > 0 ? { counts: { ...(r.counts || {}) }, total: r.total, mine: r.mine || null } : null)

/* Bấm một reaction: đang là reaction của mình -> bỏ (DELETE), khác -> đặt / thay (PUT). Hiện ngay (lạc quan), lỗi thì trả
   lại như cũ và ném lỗi. -> ReactionSummary */
export async function toggleReaction(cid, messageId, code) {
  const e = S.msgs[cid]
  const m = e && e.list.find(x => x.id === messageId)
  const old = (m && m.reactions) || null
  const remove = !!old && old.mine === code
  const optimistic = L.toggledReactions(old, code)
  if (m) patchReactions(cid, messageId, optimistic)
  const ep = epoch
  try {
    const r = await gw(cid, remove ? api.removeReaction(messageId) : api.setReaction(messageId, code))
    sameAccount(ep)
    patchReactions(cid, messageId, summaryOf(r))
    return r
  } catch (err) {
    if (ep === epoch && m) {
      const cur = S.msgs[cid] && S.msgs[cid].list.find(x => x.id === messageId)
      if (cur && (cur.reactions || null) === optimistic) patchReactions(cid, messageId, old)
    }
    throw err
  }
}

/* Ai đã thả reaction -> {message_id, reactions: [{user_id, display_name, reaction, created_at}]} */
export async function loadReactions(messageId) {
  const ep = epoch
  const r = await api.listReactions(messageId)
  sameAccount(ep)
  return r || { message_id: messageId, reactions: [] }
}

/* ---- nhảy tới tin ---- */

function setFocus(cid, seq) { set({ focus: { cid, seq, nonce: ++focusNonce } }) }
export function clearFocus() { if (S.focus) set({ focus: null }) }

function bumpGen(cid) {
  const g = (listGen.get(cid) || 0) + 1
  listGen.set(cid, g)
  return g
}

/* Về trang mới nhất (bỏ trang quanh tin cũ của lần nhảy trước) */
async function reloadLatestReplace(cid) {
  const ep = epoch
  const gen = bumpGen(cid)
  try {
    const r = await api.messages(cid, { limit: 50 })
    if (ep !== epoch || listGen.get(cid) !== gen) return
    const fetched = (r && r.messages) || []
    const top = L.maxSeq(fetched)
    const cur = S.msgs[cid] || { list: [] }
    setEntry(cid, { list: L.mergeMessages(fetched, cur.list.filter(m => m.seq > top)), hasMore: !!(r && r.has_more), hasNewer: false, loaded: true, loading: false, error: '' })
    afterIncoming(cid, fetched)
    scheduleHoleCheck(cid, 0)
  } catch (e) { /* giữ trang đang có */ }
}

/* Gửi tin khi đang xem trang quanh một tin cũ (hasNewer): về trang mới nhất trước, để tin vừa gửi không nằm ngay dưới trang cũ */
export function showLatest(cid) {
  const e = S.msgs[cid]
  if (e && e.loaded && e.hasNewer) reloadLatestReplace(cid)
}

/* Cuộn tới tin seq của hội thoại cid và tô sáng (S.focus). Tin chưa có trong bộ nhớ -> tải trang quanh seq (around_seq):
   chồng / liền với khoảng đang có thì gộp, không thì thay danh sách (hasNewer: còn tin mới hơn, lấp bằng after_seq / loadNewer). */
export async function jumpToMessage(cid, seq) {
  const s = Number(seq)
  if (!Number.isFinite(cid) || !(s > 0)) return
  const e = S.msgs[cid]
  if (e && e.loaded && e.list.some(m => m.seq === s)) { setFocus(cid, s); return }
  const ep = epoch
  const gen = bumpGen(cid)
  jumping.add(cid)
  /* chưa tải lần đầu: đánh dấu đang tải để ensureMessages (mở hội thoại) không tải trang mới nhất song song */
  if (!(e && e.loaded)) setEntry(cid, { loading: true, error: '' })
  try {
    const r = await api.messages(cid, { around_seq: s, limit: 50 })
    if (ep !== epoch || listGen.get(cid) !== gen) return
    const page = (r && r.messages) || []
    const cur = S.msgs[cid]
    const pMin = L.minSeq(page)
    const pMax = L.maxSeq(page)
    const cMin = cur && cur.list.length ? L.minSeq(cur.list) : 0
    const cMax = cur && cur.list.length ? L.maxSeq(cur.list) : 0
    if (cur && cur.loaded && cur.list.length && page.length && pMin <= cMax + 1 && pMax >= cMin - 1) {
      setEntry(cid, {
        list: L.mergeMessages(cur.list, page),
        hasMore: pMin < cMin ? !!(r && r.has_more) : cur.hasMore,
        hasNewer: pMax > cMax ? !!(r && r.has_newer) : !!cur.hasNewer,
        loaded: true, loading: false, error: '',
      })
    } else {
      setEntry(cid, { list: L.mergeMessages([], page), hasMore: !!(r && r.has_more), hasNewer: !!(r && r.has_newer), loaded: true, loading: false, error: '' })
    }
    afterIncoming(cid, page)
    setFocus(cid, s)
    scheduleHoleCheck(cid, 0)
  } catch (err) {
    if (ep === epoch && err && err.status === 403 && err.code === 'FORBIDDEN') markLeft(cid)
    throw err
  } finally {
    if (ep === epoch && listGen.get(cid) === gen) {
      jumping.delete(cid)
      /* nhảy lỗi khi chưa có danh sách: bỏ cờ đang tải, hội thoại đang mở thì tải trang mới nhất như bình thường */
      const cur = S.msgs[cid]
      if (cur && !cur.loaded) {
        setEntry(cid, { loading: false })
        if (cid === openId) ensureMessages(cid)
      }
    }
  }
}

/* ---- tìm tin ---- */

/* q: từ khoá; cid: một hội thoại hoặc null = mọi hội thoại -> {hits: [SearchHit], next_cursor} */
export async function searchMessages(q, { cid, cursor, limit } = {}) {
  const ep = epoch
  const opts = { q: String(q || ''), cursor: cursor || undefined, limit }
  const r = Number.isFinite(cid) && cid > 0 ? await api.searchConversationMessages(cid, opts) : await api.searchMessages(opts)
  sameAccount(ep)
  return { hits: (r && Array.isArray(r.hits)) ? r.hits : [], next_cursor: (r && r.next_cursor) || null }
}

/* ---- thiết bị đăng nhập ---- */

function setDevices(patch) { set(s => ({ devices: { ...s.devices, ...patch } })) }

/* Tải danh sách thiết bị vào S.devices (không ném lỗi: lỗi ghi vào S.devices.error) -> Device[] | null */
export async function loadDevices() {
  const ep = epoch
  const req = ++devicesReq
  setDevices({ loading: true, error: '' })
  try {
    const r = await api.devices()
    if (ep !== epoch || req !== devicesReq) return S.devices.list
    const list = (r && Array.isArray(r.devices)) ? r.devices : []
    setDevices({ list, loading: false, error: '' })
    return list
  } catch (e) {
    if (ep === epoch && req === devicesReq) setDevices({ loading: false, error: (e && e.message) || 'Không tải được danh sách thiết bị' })
    return null
  }
}

/* Đăng xuất từ xa một thiết bị khác của tôi (lỗi -> ném) */
export async function revokeDevice(deviceId) {
  const ep = epoch
  await api.revokeDevice(deviceId)
  sameAccount(ep)
  if (S.devices.list) setDevices({ list: S.devices.list.filter(d => d.id !== deviceId) })
  loadDevices()
}

/* Đăng xuất mọi thiết bị khác -> {revoked} */
export async function revokeOtherDevices() {
  const ep = epoch
  const r = await api.revokeOtherDevices()
  sameAccount(ep)
  if (S.devices.list) setDevices({ list: S.devices.list.filter(d => d.current) })
  loadDevices()
  return { revoked: Number(r && r.revoked) || 0 }
}

/* ---------- tài khoản + danh bạ ---------- */

export async function updateMe(patch) {
  const ep = epoch
  const me = await api.patchMe(patch)
  api.saveUser(me)
  if (ep === epoch) { set({ me }); syncAccounts() }
  return me
}

export async function loadFriends() {
  const ep = epoch
  const r = await api.friends()
  if (ep === epoch) set({ friends: (r && r.friends) || [] })
}
export async function loadRequests() {
  const ep = epoch
  const r = await api.friendRequests()
  if (ep === epoch) set({ requests: { incoming: (r && r.incoming) || [], outgoing: (r && r.outgoing) || [] } })
}
export async function loadBlocks() {
  const ep = epoch
  const r = await api.blocks()
  if (ep === epoch) set({ blocks: (r && r.users) || [] })
}

function refreshSocial(which) {
  for (const w of which) {
    const f = w === 'friends' ? loadFriends : w === 'requests' ? loadRequests : loadBlocks
    f().catch(() => {})
  }
}

/* Quan hệ với một người đổi: sửa peer.relation của hội thoại 1-1 với người đó */
function patchRelation(userId, relation) {
  const ids = Object.values(S.convs).filter(c => c.peer && c.peer.id === userId).map(c => c.id)
  if (!ids.length) return
  set(s => {
    const convs = { ...s.convs }
    for (const id of ids) convs[id] = { ...convs[id], peer: { ...convs[id].peer, relation } }
    return { convs }
  })
}

export async function sendFriendRequest(userId) {
  const ep = epoch
  const r = await api.sendFriendRequest(userId)
  sameAccount(ep)
  patchRelation(userId, r && r.status === 'accepted' ? 'friend' : 'outgoing')
  refreshSocial(['requests', 'friends'])
  return r
}
/* Thao tác quan hệ (gọi API rồi sửa peer.relation + tải lại danh sách) - bỏ kết quả nếu tab đã đổi tài khoản */
async function relationAction(call, userId, relation, which) {
  const ep = epoch
  await call(userId)
  sameAccount(ep)
  patchRelation(userId, relation)
  refreshSocial(which)
}
export const acceptFriend = userId => relationAction(api.acceptFriendRequest, userId, 'friend', ['requests', 'friends'])
export const rejectFriend = userId => relationAction(api.rejectFriendRequest, userId, 'none', ['requests'])
export const cancelFriendRequest = userId => relationAction(api.cancelFriendRequest, userId, 'none', ['requests'])
export const unfriend = userId => relationAction(api.unfriend, userId, 'none', ['friends'])
export const blockUser = userId => relationAction(api.block, userId, 'blocked', ['friends', 'requests', 'blocks'])
export const unblockUser = userId => relationAction(api.unblock, userId, 'none', ['blocks'])

/* Tìm đúng một số điện thoại hoặc email (có '@' là email); sai định dạng -> lỗi PHONE_INVALID / EMAIL_INVALID (chưa gọi máy chủ) */
export async function searchByContact(input) {
  let query
  if (L.looksLikeEmail(input)) {
    const email = L.normalizeEmail(input)
    if (!email) throw new api.ChatApiError('Email không hợp lệ', 400, 'EMAIL_INVALID')
    query = { email }
  } else {
    const phone = L.normalizePhone(input)
    if (!phone) throw new api.ChatApiError('Số điện thoại không hợp lệ', 400, 'PHONE_INVALID')
    query = { phone }
  }
  const r = await api.searchUser(query)
  return (r && r.user) || null
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
}

/* Đồng bộ danh bạ: có crypto.subtle (https / localhost) thì chỉ gửi SHA-256 của số E.164 (CHAT.md mục 6), không thì gửi số */
export async function matchContacts(text) {
  const { valid, invalid } = L.parsePhoneList(text, 1000)
  if (!valid.length) return { users: [], valid, invalid, hashed: false }
  const subtle = typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function'
  let users
  if (subtle) {
    const hashes = await Promise.all(valid.map(v => sha256Hex(v.phone)))
    const byHash = new Map(hashes.map((h, i) => [h, valid[i]]))
    const r = await api.matchContacts({ phone_hashes: hashes })
    users = ((r && r.users) || []).map(u => ({ ...u, input: (byHash.get(u.matched) || {}).input || u.phone || '' }))
  } else {
    const byPhone = new Map(valid.map(v => [v.phone, v]))
    const r = await api.matchContacts({ phones: valid.map(v => v.phone) })
    users = ((r && r.users) || []).map(u => ({ ...u, input: (byPhone.get(u.matched) || {}).input || u.matched || '' }))
  }
  return { users, valid, invalid, hashed: !!subtle }
}

/* ---------- thông báo đẩy (Web Push) ---------- */

function setPush(patch) { set(s => ({ push: { ...s.push, ...patch } })) }

/* Lựa chọn thông báo của từng tài khoản trên trình duyệt này: 'on' = đã bấm "Bật" (mở app / đổi tài khoản thì gửi lại
   subscription, subscription đã bị huỷ mà quyền còn thì đăng ký lại); 'off' = người dùng tự tắt; '' = chưa chọn, không
   tự đăng ký (subscription đang có có thể là của tài khoản khác). Đăng xuất / bị thu hồi thì bỏ lựa chọn. */
function pushPref(uid) { try { return (uid && localStorage.getItem(PUSH_PREF_PREFIX + uid)) || '' } catch (e) { return '' } }
function writePushPref(uid, v) {
  if (!uid) return
  try { localStorage.setItem(PUSH_PREF_PREFIX + uid, v) } catch (e) { /* bỏ qua */ }
}
function setPushPref(uid, v) {
  if (!uid) return
  writePushPref(uid, v)
  setPush({ pref: v })
}

/* Trình duyệt chỉ có MỘT service worker + MỘT subscription cho mọi tài khoản: tài khoản khác trong kho còn bật thông
   báo thì không được huỷ subscription */
function othersKeepPush(uid) { return api.listAccounts().some(a => a.id !== uid && pushPref(a.id) === 'on') }

async function getSwRegistration() {
  if (!pushSupported()) return null
  return navigator.serviceWorker.register('/chat-sw.js')
}

/* Mở app / đổi tài khoản: đăng ký service worker; tài khoản này đã bật ('on') + đã cho phép thì gửi lại subscription cho
   máy chủ cho thiết bị của tài khoản này (token có thể đổi), chưa có subscription (đã huỷ) thì đăng ký lại. Chưa chọn
   ('') hoặc tự tắt ('off') thì không gửi, kể cả khi trình duyệt đã có subscription (của tài khoản khác, hoặc mồ côi sau
   khi tài khoản đã bật bị thu hồi): hiện nút "Bật". */
async function initPush() {
  const ep = epoch
  if (!pushSupported()) return
  const uid = S.me && S.me.id
  setPush({ pref: pushPref(uid) })
  let reg
  try { reg = await getSwRegistration() } catch (e) { return }
  let cfg
  try { cfg = await api.pushConfig() } catch (e) { return }
  if (ep !== epoch) return
  /* đọc lại lựa chọn sau khi chờ mạng: tab khác (cùng tài khoản) có thể vừa bật / tắt */
  const pref = pushPref(uid)
  setPush({ enabled: !!(cfg && cfg.enabled), key: (cfg && cfg.vapid_public_key) || null, permission: notifPermission(), pref })
  if (!cfg || !cfg.enabled || !cfg.vapid_public_key || Notification.permission !== 'granted' || pref !== 'on') return
  try {
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      await navigator.serviceWorker.ready
      if (ep !== epoch || pushPref(uid) !== 'on') return
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: L.urlBase64ToUint8Array(cfg.vapid_public_key) })
    }
    if (!L.sameBytes(sub.options && sub.options.applicationServerKey, L.urlBase64ToUint8Array(cfg.vapid_public_key))) {
      await sub.unsubscribe()
      await navigator.serviceWorker.ready
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: L.urlBase64ToUint8Array(cfg.vapid_public_key) })
    }
    await api.registerPush(JSON.stringify(sub), uid)
    if (ep === epoch) setPush({ subscribed: true, pref: 'on' })
  } catch (e) { /* thử lại ở lần mở sau */ }
}

function askPermission() {
  return new Promise(resolve => {
    const p = Notification.requestPermission(resolve)
    if (p && typeof p.then === 'function') p.then(resolve)
  })
}

/* Bấm "Bật thông báo": phải gọi từ sự kiện click (requestPermission cần thao tác của người dùng) */
export async function enablePush() {
  if (!S.push.supported || !S.push.enabled || !S.push.key || S.push.busy) return
  const permissionPromise = askPermission()
  setPush({ busy: true, error: '' })
  const ep = epoch
  const uid = S.me && S.me.id
  try {
    const perm = await permissionPromise
    setPush({ permission: perm })
    if (perm !== 'granted') throw new Error('Trình duyệt chưa cho phép thông báo. Mở cài đặt trang để bật lại.')
    await getSwRegistration()
    const reg = await navigator.serviceWorker.ready
    const key = L.urlBase64ToUint8Array(S.push.key)
    let sub = await reg.pushManager.getSubscription()
    if (sub && !L.sameBytes(sub.options && sub.options.applicationServerKey, key)) { await sub.unsubscribe(); sub = null }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    await api.registerPush(JSON.stringify(sub), uid)
    writePushPref(uid, 'on')
    if (ep === epoch) setPush({ subscribed: true, busy: false, pref: 'on' })
  } catch (e) {
    if (ep === epoch) setPush({ busy: false, error: (e && e.message) || 'Không bật được thông báo' })
  }
}

/* Tắt thông báo cho tài khoản của tab. optOut: người dùng tự bấm "Tắt thông báo" (nhớ lựa chọn 'off', lần sau không tự
   bật lại). */
export async function disablePush(opts) {
  if (!pushSupported()) return
  const uid = (S.me && S.me.id) || api.activeAccountId()
  if (opts && opts.optOut) setPushPref(uid, 'off')
  await releasePush(uid)
}

/* Bỏ thông báo đẩy của một tài khoản trên trình duyệt này (tắt thông báo / đăng xuất): báo máy chủ bỏ subscription khỏi
   thiết bị của tài khoản đó; subscription của trình duyệt chỉ huỷ khi không còn tài khoản nào khác bật thông báo */
async function releasePush(uid) {
  if (!pushSupported()) return
  if (!othersKeepPush(uid)) {
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = reg && await reg.pushManager.getSubscription()
      if (sub) await sub.unsubscribe()
    } catch (e) { /* bỏ qua */ }
  }
  try { if (uid && api.readSession(uid).refresh) await api.unregisterPush(uid) } catch (e) { /* bỏ qua */ }
  if (S.me && S.me.id === uid) setPush({ subscribed: false })
}

/* Tab đang hiện của tài khoản nào: localStorage chat_visible:<id> = {tab, at}, ghi khi tab hiện / khởi động tài khoản và
   lặp lại mỗi 20 giây (tab hiện không bị bóp timer); tab ẩn, đóng trang, đổi tài khoản thì xoá (nếu là của tab này).
   Quá 45 giây chưa ghi lại coi như hết (tab bị treo / đóng đột ngột). */
function markVisible() {
  const uid = S.me && S.me.id
  if (!hasWindow || !uid || !docVisible()) return
  try { localStorage.setItem(VISIBLE_PREFIX + uid, JSON.stringify({ tab: TAB_ID, at: Date.now() })) } catch (e) { /* bỏ qua */ }
}
function readVisible(uid) {
  try { return JSON.parse(localStorage.getItem(VISIBLE_PREFIX + uid) || 'null') } catch (e) { return null }
}
function clearVisible(uid) {
  if (!hasWindow || !uid) return
  const v = readVisible(uid)
  if (v && v.tab === TAB_ID) { try { localStorage.removeItem(VISIBLE_PREFIX + uid) } catch (e) { /* bỏ qua */ } }
}
function visibleElsewhere(uid) {
  const v = readVisible(uid)
  return !!v && v.tab !== TAB_ID && Date.now() - Number(v.at) < VISIBLE_STALE_MS
}

/* Tab đang ẩn nhưng vẫn online (máy chủ không gửi push cho người đang online): tự hiện thông báo - chỉ khi tài khoản
   này đang bật thông báo trên trình duyệt (subscribed; quyền 'granted' thôi chưa đủ: "Tắt thông báo" vẫn giữ quyền).
   Có tab khác của CÙNG tài khoản đang hiện thì không báo (người dùng đang xem); tab hiện của tài khoản khác không chặn.
   Gửi qua service worker: nhiều tab ẩn cùng nhận một tin chỉ báo 1 lần (theo tài khoản, hội thoại, seq). Kèm user_id:
   bấm thông báo thì tab chuyển đúng tài khoản. */
function maybeNotify(m) {
  if (!hasWindow || !document.hidden || !(m.msg_type === 'text' || L.isMediaType(m.msg_type))) return
  if (!pushSupported() || Notification.permission !== 'granted' || !S.push.subscribed || !S.me) return
  const c = S.convs[m.conversation_id]
  const uid = S.me.id
  if (c && L.isDisbanded(c)) return
  /* được nhắc tên: báo cả khi đã tắt thông báo (như push của máy chủ), nội dung có tiền tố "Nhắc đến bạn: " */
  const mentioned = L.mentionsMe(m, uid)
  if (c && !mentioned && L.isMuted(c.muted_until)) return
  if (visibleElsewhere(uid)) return
  const title = c && c.type === 'group' ? `${m.sender_name} · ${L.convTitle(c)}` : (m.sender_name || 'Dezon Chat')
  const n = { title, body: (mentioned ? 'Nhắc đến bạn: ' : '') + L.firstRunes(L.mediaLabel(m), 100), tag: L.notifyTag(uid, m.conversation_id), url: L.chatUrl(uid, m.conversation_id) }
  navigator.serviceWorker.getRegistration().then(reg => {
    if (!reg) return
    if (reg.active) reg.active.postMessage({ type: 'notify', user_id: uid, conversation_id: m.conversation_id, seq: m.seq, ...n })
    else reg.showNotification(n.title, { body: n.body, tag: n.tag, renotify: true, data: { url: n.url, user_id: uid, conversation_id: m.conversation_id, seq: m.seq } })
  }).catch(() => {})
}

/* ---------- bộ chọn cho giao diện ---------- */

let memoConvs = null
let memoPins = null
let memoSorted = []
export function sortedConversations(s = S) {
  if (s.convs !== memoConvs || s.pins !== memoPins) {
    memoConvs = s.convs
    memoPins = s.pins
    memoSorted = L.sortConversations(s.convs, s.pins)
  }
  return memoSorted
}

export const unreadFor = (s, c) => L.unreadOf(c, s.localRead[c.id])
/* Dấu '@' ở danh sách hội thoại: có tin nhắc mình chưa đọc (tính cả bản đã đọc lạc quan ở máy này) */
export const unreadMentionFor = (s, c) => L.hasUnreadMention(c, s.localRead[c.id])

const snap = () => S
export function useChat() { return useSyncExternalStore(subscribe, snap) }

/* Tổng tin chưa đọc thật (huy hiệu "Chat" ở sidebar): chỉ khi đã đăng nhập chat và đã tải danh sách; không có thì 0
   (sidebar không hiện số). Theo dõi thụ động: không giữ WebSocket, rời trang Chat thì socket đóng (máy chủ gửi push)
   nên số giữ giá trị biết được lần cuối. */
export function unreadTotal(s = S) {
  if (s.auth !== 'ready' || !s.listLoaded) return 0
  let n = 0
  for (const c of Object.values(s.convs)) if (!c.left) n += unreadFor(s, c)
  return n
}
const unreadTotalSnap = () => unreadTotal(S)
export function useChatUnreadTotal() { return useSyncExternalStore(subscribePassive, unreadTotalSnap) }
/* Theo dõi store ngoài React (vd. huy hiệu số chưa đọc ở chỗ khác), thụ động như useChatUnreadTotal: trả hàm huỷ */
export const subscribeChat = subscribePassive

/* Bấm thông báo của tài khoản khác: tab đổi tài khoản rồi mở hội thoại. Chat.jsx lấy hội thoại này (thay vì bỏ hội
   thoại đang mở như khi đổi tài khoản bằng bộ chọn). */
let openTarget = null
export function takeOpenTarget(uid) {
  const t = openTarget
  openTarget = null
  return t && t.uid === uid ? t.cid : null
}

/* Kho tài khoản đổi ở tab khác: vá token mới nhất của tab này (nếu bị ghi đè bằng bản cũ), cập nhật bộ chọn; tài khoản
   của tab bị bỏ -> sang tài khoản kế tiếp / cổng; token đổi thì không làm gì (lần gọi sau đọc kho); tab đang ở cổng mà
   tab khác vừa đăng nhập thêm tài khoản -> dùng luôn (như bản một tài khoản) */
function onVaultChanged() {
  api.healVault()
  const before = new Set(S.accounts.map(a => a.id))
  syncAccounts()
  const cur = api.activeAccountId()
  if (cur) {
    if (!api.hasAccount(cur)) { leaveAccount(); return }
    const u = api.readSession(cur).user
    if (u && S.me && u.id === S.me.id && JSON.stringify(u) !== JSON.stringify(S.me)) set({ me: { ...S.me, ...u } })
    return
  }
  if (S.auth === 'signedout' && started && S.accounts.some(a => !before.has(a.id))) {
    const next = api.resolveAccount(false)
    if (next) activate(next, false)
  }
}

/* ---------- sự kiện toàn cục (đăng ký một lần khi nạp module) ---------- */

if (hasWindow) {
  document.addEventListener('visibilitychange', () => {
    if (docVisible()) { markVisible(); scheduleRead() } else clearVisible(S.me && S.me.id)
  })
  window.addEventListener('pagehide', () => clearVisible(S.me && S.me.id))
  setInterval(markVisible, VISIBLE_BEAT_MS)

  /* Đăng xuất lúc mất mạng còn chờ báo máy chủ: thử lại khi có mạng (và lúc khởi động store) */
  window.addEventListener('online', () => { if (api.configured()) api.flushPendingLogouts() })

  /* Tab khác thêm / bỏ / làm mới tài khoản (kho), tab bản cũ ghi phiên kiểu cũ (chuyển vào kho), tab khác cùng tài khoản
     ghi outbox (chỉ nhận outbox của tài khoản của tab này) */
  window.addEventListener('storage', e => {
    if (!api.configured()) return
    if (e.key === api.STORAGE_KEYS.vault || e.key === null) { onVaultChanged(); return }
    if (e.key === api.STORAGE_KEYS.legacy.refresh) {
      if (e.newValue) { api.migrateLegacy(); onVaultChanged() }
      return
    }
    if (S.me && e.key === OUTBOX_PREFIX + S.me.id) adoptOutbox(e.newValue)
  })

  /* Service worker báo người dùng bấm thông báo: {url: /chat?u=<id>#c<id>, user_id}. Tài khoản đó có trong kho mà
     không phải tài khoản của tab -> tab đổi sang tài khoản đó; rồi chuyển tới /chat#c<id> qua router (không tải lại
     trang). Gói không có user_id (máy chủ cũ): mở hội thoại ở tài khoản đang dùng như trước. */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => {
      const d = e.data
      if (!d || d.type !== 'open' || !d.url) return
      try {
        const u = new URL(d.url, window.location.href)
        if (u.origin !== window.location.origin) return
        const uid = Number(d.user_id) || Number(L.accountParam(u.search)) || 0
        const m = /^#c(\d+)$/.exec(u.hash)
        let hash = u.hash
        if (uid && api.configured()) {
          if (!api.hasAccount(uid)) hash = '' // tài khoản đã đăng xuất khỏi trình duyệt này: chỉ mở trang Chat
          else if (uid !== api.activeAccountId()) {
            openTarget = m ? { uid, cid: Number(m[1]) } : null
            switchAccount(uid)
          }
        }
        window.history.pushState(null, '', u.pathname + L.withoutAccountParam(u.search) + hash)
        window.dispatchEvent(new PopStateEvent('popstate'))
      } catch (err) { /* bỏ qua */ }
    })
    try { navigator.serviceWorker.startMessages() } catch (e) { /* trình duyệt cũ: tự bật khi trang tải xong */ }
  }
}
