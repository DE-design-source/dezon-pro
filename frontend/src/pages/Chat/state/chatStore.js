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
    push: { supported: pushSupported(), enabled: false, key: null, permission: notifPermission(), subscribed: false, busy: false, error: '', pref: '' },
  }
}

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

const sleep = ms => new Promise(r => setTimeout(r, ms))

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
}

function upsertDetail(d) {
  if (!d || !Number.isFinite(d.id)) return
  const { members, ...row } = d
  set(s => {
    const meId = s.me && s.me.id
    const rc = { ...(s.rcpt[d.id] || {}) }
    const ids = new Set()
    for (const m of members || []) {
      ids.add(String(m.user_id))
      if (m.user_id === meId) continue
      rc[m.user_id] = L.mergeReceipt(rc[m.user_id], m.last_delivered_seq, m.last_read_seq)
    }
    if (members) for (const k of Object.keys(rc)) if (!ids.has(k)) delete rc[k]
    return {
      convs: { ...s.convs, [d.id]: L.mergeConvRow(s.convs[d.id], row) },
      members: members ? { ...s.members, [d.id]: members } : s.members,
      rcpt: { ...s.rcpt, [d.id]: rc },
    }
  })
  schedulePresence()
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
    return { convs: { ...s.convs, [cid]: { ...s.convs[cid], left: true } }, members, rcpt }
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
          const r = await api.sync(syncCursor)
          if (ep !== epoch) return
          if (r && r.truncated) await loadConversations()
          else {
            mergeRows((r && r.conversations) || [])
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
  if (openId) { ensureMessages(openId); refreshDetail(openId).catch(() => {}) }
  reconcileReceipts()
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
  const ep = epoch
  setEntry(cid, { loading: true, error: '' })
  try {
    const r = await api.messages(cid, { limit: 50 })
    if (ep !== epoch) return
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
  try {
    const r = await api.messages(cid, { limit: 50 })
    if (ep !== epoch) return
    const fetched = (r && r.messages) || []
    const top = L.maxSeq(fetched)
    const cur = S.msgs[cid] || { list: [] }
    setEntry(cid, { list: L.mergeMessages(fetched, cur.list.filter(m => m.seq > top)), hasMore: !!(r && r.has_more), loaded: true })
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
  if (after == null) return
  const top = Math.max(c ? c.last_seq : 0, L.maxSeq(e.list))
  if (top - after > 500) { reloadLatest(cid); return }
  fillFrom(cid, after)
}

async function fillFrom(cid, after) {
  gapFrom.set(cid, Math.min(gapFrom.has(cid) ? gapFrom.get(cid) : Infinity, after))
  if (gapRunning.has(cid)) return
  gapRunning.add(cid)
  const ep = epoch
  let added = false
  try {
    while (gapFrom.has(cid)) {
      let from = gapFrom.get(cid)
      gapFrom.delete(cid)
      for (let page = 0; page < 5; page++) {
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

/* Gửi tin văn bản: hiện ngay (đồng hồ), vào outbox, gửi khi có kết nối */
export function sendText(cid, text) {
  const content = String(text || '').trim()
  if (!S.me || !Number.isFinite(cid) || !content || L.runeLength(content) > L.MAX_CONTENT) return false
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
  set(s => ({ outbox: [...s.outbox, item] }))
  persistOutbox()
  stopTyping(cid)
  pumpOutbox()
  return true
}

export function retrySend(clientMsgId) {
  updateOutboxItem(clientMsgId, { status: 'sending', tries: 0, error: '' })
  pumpOutbox()
}

export function discardPending(clientMsgId) {
  removedHere.add(clientMsgId)
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
      let ack
      try {
        ack = await socket.request('message.send', {
          conversation_id: item.conversation_id,
          client_msg_id: item.client_msg_id,
          msg_type: 'text',
          content: item.content,
        }, 10000)
      } catch (e) {
        if (ep !== epoch) return
        const code = e && e.code
        if (code === 'CLOSED' || code === 'OFFLINE') break
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
  if (!me || !Number.isFinite(ack.seq)) return
  const m = {
    id: ack.message_id,
    conversation_id: item.conversation_id,
    seq: ack.seq,
    client_msg_id: item.client_msg_id,
    sender_id: me.id,
    sender_name: me.display_name,
    msg_type: 'text',
    content: item.content,
    created_at: ack.created_at || item.created_at,
  }
  const cid = m.conversation_id
  const e = S.msgs[cid]
  if (e) { mergeInto(cid, [m]); if (e.loaded) scheduleHoleCheck(cid) } else setEntry(cid, { list: [m] })
  if (S.convs[cid]) set(s => ({ convs: { ...s.convs, [cid]: L.applyMessageToConv(s.convs[cid], m, me.id) } }))
  else refreshDetail(cid).catch(() => {})
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
    if (c && c.left) { rq.delete(cid); continue }
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
    if (c.left) continue
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
  if (cc && !cc.left && lr > (cc.last_read_seq || 0)) queueReceipt(cid, 'r', lr)
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
  ensureMessages(id)
  refreshDetail(id).catch(() => {})
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
export async function renameGroup(cid, name) { const ep = epoch; const d = await api.renameConversation(cid, name); sameAccount(ep); upsertDetail(d) }
export async function addMembers(cid, userIds) { const ep = epoch; const d = await api.addMembers(cid, userIds); sameAccount(ep); upsertDetail(d) }
export async function removeMember(cid, userId) {
  const ep = epoch
  await api.removeMember(cid, userId)
  sameAccount(ep)
  if (S.me && userId === S.me.id) markLeft(cid)
  else refreshDetail(cid).catch(() => {})
}
export async function setMemberRole(cid, userId, role) { const ep = epoch; const d = await api.setMemberRole(cid, userId, role); sameAccount(ep); upsertDetail(d) }
export async function setMute(cid, until) { const ep = epoch; const r = await api.muteConversation(cid, until); sameAccount(ep); mergeRows([r]) }

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
  if (!hasWindow || !document.hidden || m.msg_type !== 'text') return
  if (!pushSupported() || Notification.permission !== 'granted' || !S.push.subscribed || !S.me) return
  const c = S.convs[m.conversation_id]
  if (c && L.isMuted(c.muted_until)) return
  const uid = S.me.id
  if (visibleElsewhere(uid)) return
  const title = c && c.type === 'group' ? `${m.sender_name} · ${L.convTitle(c)}` : (m.sender_name || 'Dezon Chat')
  const n = { title, body: L.firstRunes(m.content, 100), tag: L.notifyTag(uid, m.conversation_id), url: L.chatUrl(uid, m.conversation_id) }
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
