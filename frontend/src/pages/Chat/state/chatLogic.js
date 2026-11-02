/* Hàm thuần của Dezon Chat: không đụng DOM, mạng, localStorage hay đồng hồ ngầm (thời điểm "bây giờ" truyền vào).
   Dùng chung cho store (chatStore.js), giao diện và script tự kiểm chạy bằng node. */

export const MAX_CONTENT = 4000
export const MAX_GROUP_NAME = 100

/* ---------- Số điện thoại (khớp quy tắc phone.go của máy chủ) ---------- */

/* Bỏ khoảng trắng, dấu chấm, gạch, ngoặc. 0 + 9 số -> +84...; 84 + 9 số -> +84...; + và 8..15 số giữ nguyên.
   Số +84 phải là di động Việt Nam: đúng 9 số, bắt đầu bằng 3, 5, 7, 8, 9. Sai -> chuỗi rỗng. */
export function normalizePhone(input) {
  let s = String(input == null ? '' : input).replace(/[\s.\-()]/g, '')
  if (!s) return ''
  if (/^0\d{9}$/.test(s)) s = '+84' + s.slice(1)
  else if (/^84\d{9}$/.test(s)) s = '+' + s
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return ''
  if (s.startsWith('+84') && !/^\+84[35789]\d{8}$/.test(s)) return ''
  return s
}

/* +84901234567 -> "0901 234 567"; số nước khác giữ dạng E.164 */
export function formatPhone(p) {
  const m = /^\+84(\d{9})$/.exec(p || '')
  if (!m) return p || ''
  const d = '0' + m[1]
  return d.slice(0, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7)
}

/* Danh sách số dán vào ô "Đồng bộ danh bạ": tách theo xuống dòng, dấu phẩy, chấm phẩy -> {valid:[{input, phone}], invalid:[input]}.
   Bỏ số trùng (theo E.164), tối đa max số hợp lệ. */
export function parsePhoneList(text, max = 1000) {
  const valid = []
  const invalid = []
  const seen = new Set()
  for (const raw of String(text || '').split(/[\n\r,;]+/)) {
    const input = raw.trim()
    if (!input) continue
    const phone = normalizePhone(input)
    if (!phone) { invalid.push(input); continue }
    if (seen.has(phone) || valid.length >= max) continue
    seen.add(phone)
    valid.push({ input, phone })
  }
  return { valid, invalid }
}

/* ---------- Email (khớp quy tắc email.go của máy chủ) ---------- */

/* Khoảng trắng chung với emailSpace của email.go: Zs + tab, xuống dòng, VT, FF, NEL, LS, PS, BOM (trim() của JS không cắt NEL) */
const EMAIL_TRIM = /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$/g
/* Bên trong: ký tự điều khiển (unicode.IsControl), khoảng trắng, hoặc ký tự đặc biệt "(),:;<>[]\ (máy chủ đọc "1<a@b.vn>" ra hộp thư a@b.vn) */
const EMAIL_BAD_CHAR = /[\u0000-\u001f\u007f-\u009f \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"(),:;<>[\]\\]/
/* Đã loại khoảng trắng ở trên nên tương đương ^[^\s@]+@[^\s@]+\.[^\s@]+$ của máy chủ */
const EMAIL_SHAPE = /^[^@]+@[^@]+\.[^@]+$/
/* Một phần của email (trước / sau @): không có dấu chấm ở đầu, cuối, hay hai dấu chấm liền nhau */
const dotAtom = p => !!p && p[0] !== '.' && p[p.length - 1] !== '.' && !p.includes('..')

function utf8Length(s) {
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0)
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
  }
  return n
}

/* Trim hai đầu, chữ thường toàn bộ (từng ký tự như strings.ToLower: "İ" -> "i"). Sai -> chuỗi rỗng: rỗng, quá 254 byte,
   phần trước @ quá 64 byte, có ký tự điều khiển / khoảng trắng bên trong, không đúng một dấu @ hoặc thiếu dấu chấm sau @.
   Không bỏ dấu chấm / phần +tag của Gmail. */
export function normalizeEmail(input) {
  const t = String(input == null ? '' : input).replace(EMAIL_TRIM, '')
  if (!t) return ''
  const s = Array.from(t, ch => Array.from(ch.toLowerCase())[0]).join('')
  if (utf8Length(s) > 254 || EMAIL_BAD_CHAR.test(s) || !EMAIL_SHAPE.test(s)) return ''
  const at = s.indexOf('@')
  if (utf8Length(s.slice(0, at)) > 64 || !dotAtom(s.slice(0, at)) || !dotAtom(s.slice(at + 1))) return ''
  return s
}

/* Ô nhập "số điện thoại hoặc email": có '@' thì coi là email */
export const looksLikeEmail = s => String(s == null ? '' : s).includes('@')

/* Dòng liên hệ dưới tên: số (dạng 0901 234 567) nếu có, không thì email */
export function contactText(u) {
  if (!u) return ''
  return u.phone ? formatPhone(u.phone) : (u.email || '')
}

/* ---------- Tin nhắn theo seq ---------- */

export function maxSeq(list) { return list && list.length ? list[list.length - 1].seq : 0 }
export function minSeq(list) { return list && list.length ? list[0].seq : 0 }

/* Gộp tin mới vào danh sách đã sắp theo seq, khoá (conversation_id, seq): trùng seq thì bản mới thay bản cũ.
   Không có gì đổi -> trả lại đúng mảng cũ (React không vẽ lại). */
export function mergeMessages(list, incoming) {
  const base = list || []
  const add = (Array.isArray(incoming) ? incoming : [incoming]).filter(m => m && Number.isFinite(m.seq))
  if (!add.length) return base
  const map = new Map()
  for (const m of base) map.set(m.seq, m)
  let changed = false
  for (const m of add) {
    const old = map.get(m.seq)
    if (!old || old.id !== m.id || old.content !== m.content || old.created_at !== m.created_at) { map.set(m.seq, m); changed = true }
  }
  if (!changed) return base
  return Array.from(map.values()).sort((a, b) => a.seq - b.seq)
}

/* Chỗ hở thấp nhất trong danh sách (seq liên tục là bất biến của máy chủ): trả seq ngay TRƯỚC chỗ hở
   (dùng làm after_seq); không hở nhưng lastSeq của hội thoại lớn hơn tin cuối -> trả seq tin cuối; đủ -> null. */
export function findHole(list, lastSeq = 0) {
  if (!list || !list.length) return null
  for (let i = 1; i < list.length; i++) if (list[i].seq !== list[i - 1].seq + 1) return list[i - 1].seq
  const top = list[list.length - 1].seq
  return lastSeq > top ? top : null
}

/* ---------- Hàng đợi gửi (outbox) ---------- */

/* Thứ tự gửi: theo số thứ tự tạo (ord), cùng ord thì theo thời điểm tạo */
export function orderOutbox(items) {
  return (items || []).slice().sort((a, b) => (a.ord - b.ord) || String(a.created_at).localeCompare(String(b.created_at)))
}

/* Tin tiếp theo cần gửi: tin đầu tiên (theo thứ tự) còn ở trạng thái 'sending' */
export function nextToSend(items) {
  return orderOutbox(items).find(i => i.status === 'sending') || null
}

export function pendingFor(items, conversationId) {
  return orderOutbox(items).filter(i => i.conversation_id === conversationId)
}

/* Bỏ khỏi outbox các tin máy chủ đã có (client_msg_id xuất hiện trong tin đã xác nhận) */
export function pruneOutbox(items, confirmedIds) {
  const ids = confirmedIds instanceof Set ? confirmedIds : new Set(confirmedIds || [])
  const out = (items || []).filter(i => !ids.has(i.client_msg_id))
  return out.length === (items || []).length ? items : out
}

/* Đọc outbox đã lưu: tin đang gửi dở khi tải lại trang quay về 'sending' (gửi lại cùng client_msg_id, máy chủ chống trùng) */
export function restoreOutbox(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(i => i && typeof i.client_msg_id === 'string' && Number.isFinite(i.conversation_id) && typeof i.content === 'string' && i.content)
    .map(i => ({
      client_msg_id: i.client_msg_id,
      conversation_id: i.conversation_id,
      content: i.content,
      created_at: i.created_at || new Date(0).toISOString(),
      ord: Number.isFinite(i.ord) ? i.ord : 0,
      status: i.status === 'failed' ? 'failed' : 'sending',
      tries: i.status === 'failed' ? (i.tries || 0) : 0,
      error: i.status === 'failed' ? (i.error || '') : '',
    }))
}

/* ---------- Đã gửi / đã nhận / đã xem ---------- */

/* Trạng thái tin của mình đã có seq: receipts = {userId: {d: last_delivered_seq, r: last_read_seq | null}} của các
   thành viên khác (r = null: người đó tắt "cho biết đã xem"). Trả {status: 'sent'|'delivered'|'seen', seenCount, total}.
   Chat 1-1: đã xem khi người kia đọc tới seq; nhóm: 'seen' khi mọi người đã xem, 'delivered' khi mọi người đã nhận. */
export function ownMessageStatus(seq, receipts, meId) {
  const others = Object.keys(receipts || {}).filter(id => Number(id) !== meId).map(id => receipts[id])
  const total = others.length
  if (!total) return { status: 'sent', seenCount: 0, total: 0 }
  let seenCount = 0
  let deliveredCount = 0
  for (const r of others) {
    const read = r.r != null && r.r >= seq
    if (read) seenCount++
    if (read || (r.d || 0) >= seq) deliveredCount++
  }
  const status = seenCount === total ? 'seen' : deliveredCount === total ? 'delivered' : 'sent'
  return { status, seenCount, total }
}

/* Dòng chữ dưới tin cuối của mình */
export function seenLabel(type, st) {
  if (!st) return ''
  if (type === 'direct') return st.status === 'seen' ? 'Đã xem' : ''
  return st.seenCount > 0 ? `Đã xem bởi ${st.seenCount} người` : ''
}

/* Gộp con trỏ đã nhận / đã xem: không bao giờ lùi; r = null (ẩn) thì giữ null */
export function mergeReceipt(old, delivered, read) {
  const o = old || { d: 0, r: null }
  const d = Math.max(o.d || 0, Number(delivered) || 0, read != null ? Number(read) || 0 : 0)
  const r = read == null ? null : Math.max(o.r || 0, Number(read) || 0)
  return { d, r }
}

/* ---------- Hội thoại ---------- */

export function convTitle(c) {
  if (!c) return ''
  if (c.name) return c.name
  if (c.peer && c.peer.display_name) return c.peer.display_name
  return 'Cuộc trò chuyện'
}

/* Số chưa đọc = last_seq - last_read_seq (con trỏ đọc lấy max với bản đã báo đọc lạc quan ở máy này) */
export function unreadOf(c, localRead = 0) {
  if (!c) return 0
  return Math.max(0, (c.last_seq || 0) - Math.max(c.last_read_seq || 0, localRead || 0))
}

const later = (a, b) => (!a ? b || null : !b ? a : (Date.parse(b) > Date.parse(a) ? b : a))

/* Gộp một dòng hội thoại từ máy chủ (list / sync / detail) vào bản đang có, idempotent:
   con trỏ seq lấy max, tin cuối lấy tin có seq lớn hơn; tên / số thành viên chỉ nhận khi dòng mới không cũ hơn. */
export function mergeConvRow(old, row) {
  if (!row) return old
  if (!old) return { ...row }
  const out = { ...old, ...row }
  out.last_seq = Math.max(old.last_seq || 0, row.last_seq || 0)
  out.last_read_seq = Math.max(old.last_read_seq || 0, row.last_read_seq || 0)
  out.last_delivered_seq = Math.max(old.last_delivered_seq || 0, row.last_delivered_seq || 0, out.last_read_seq)
  const om = old.last_message
  const nm = row.last_message
  out.last_message = !nm ? om || null : !om ? nm : (nm.seq >= om.seq ? nm : om)
  out.last_message_at = later(old.last_message_at, row.last_message_at)
  if (old.updated_at && row.updated_at && Date.parse(row.updated_at) < Date.parse(old.updated_at)) {
    out.name = old.name
    out.member_count = old.member_count
    out.updated_at = old.updated_at
  }
  /* Dòng đã rời từ /sync không còn tên nhóm (máy chủ không lộ tên đổi sau khi rời): giữ tên đã biết */
  if (row.left && row.name == null && old.name != null) out.name = old.name
  out.unread = Math.max(0, out.last_seq - out.last_read_seq)
  return out
}

/* Cập nhật dòng hội thoại khi có tin mới (realtime hoặc ack của mình) */
export function applyMessageToConv(c, m, meId) {
  if (!c || !m) return c
  const out = { ...c }
  out.last_seq = Math.max(c.last_seq || 0, m.seq)
  if (!c.last_message || m.seq >= c.last_message.seq) { out.last_message = m; out.last_message_at = later(c.last_message_at, m.created_at) }
  if (m.sender_id === meId) {
    out.last_read_seq = Math.max(c.last_read_seq || 0, m.seq)
    out.last_delivered_seq = Math.max(c.last_delivered_seq || 0, m.seq)
  }
  out.unread = Math.max(0, out.last_seq - (out.last_read_seq || 0))
  return out
}

export function isMuted(mutedUntil, now = Date.now()) {
  if (!mutedUntil) return false
  if (mutedUntil === 'forever') return true
  const t = Date.parse(mutedUntil)
  return Number.isFinite(t) && t > now
}

/* Thứ tự danh sách: hội thoại ghim (localStorage) trước, rồi last_message_at giảm dần (null cuối), rồi id giảm dần.
   Hội thoại đã rời (left) không hiện. */
export function sortConversations(convs, pins = []) {
  const pinSet = new Set((pins || []).map(String))
  const t = c => (c.last_message_at ? Date.parse(c.last_message_at) : -Infinity)
  return Object.values(convs || {})
    .filter(c => c && !c.left)
    .sort((a, b) => {
      const pa = pinSet.has(String(a.id)) ? 1 : 0
      const pb = pinSet.has(String(b.id)) ? 1 : 0
      if (pa !== pb) return pb - pa
      const ta = t(a)
      const tb = t(b)
      if (ta !== tb) return tb > ta ? 1 : -1
      return b.id - a.id
    })
}

/* Người cần theo dõi online: đối phương của các hội thoại 1-1 đầu danh sách + thành viên hội thoại đang mở, tối đa max */
export function presenceTargets(sortedConvs, openMembers, meId, max = 50) {
  const ids = []
  const seen = new Set([meId])
  const add = id => { if (id && !seen.has(id) && ids.length < max) { seen.add(id); ids.push(id) } }
  for (const m of openMembers || []) add(m.user_id)
  for (const c of sortedConvs || []) { if (c.type === 'direct' && c.peer) add(c.peer.id); if (ids.length >= max) break }
  return ids.sort((a, b) => a - b)
}

/* ---------- Nhóm: vai trò và quyền ---------- */

export const ROLE_LABEL = { owner: 'Trưởng nhóm', admin: 'Quản trị viên', member: 'Thành viên' }

/* Ai được xoá ai: chính mình = rời nhóm; trưởng nhóm xoá mọi người; quản trị viên chỉ xoá thành viên thường */
export function canRemoveMember(actorRole, targetRole, isSelf) {
  if (isSelf) return true
  if (actorRole === 'owner') return targetRole !== 'owner'
  if (actorRole === 'admin') return targetRole === 'member'
  return false
}
export const canRename = role => role === 'owner' || role === 'admin'
export const canSetRole = (actorRole, targetRole) => actorRole === 'owner' && targetRole !== 'owner'

/* ---------- Thời gian (giờ địa phương của máy) ---------- */

const pad = n => String(n).padStart(2, '0')
const WEEKDAY_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const WEEKDAY_LONG = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']

export function dayKey(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
function daysAgo(iso, now) {
  const d = new Date(iso)
  return Math.round((startOfDay(new Date(now)) - startOfDay(d)) / 86400000)
}

export function clockLabel(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/* Nhãn giờ ở danh sách hội thoại: hôm nay HH:mm, hôm qua, trong tuần T2..CN, cũ hơn dd/MM (khác năm thêm năm) */
export function listTimeLabel(iso, now = Date.now()) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const n = daysAgo(iso, now)
  if (n <= 0) return clockLabel(iso)
  if (n === 1) return 'Hôm qua'
  if (n < 7) return WEEKDAY_SHORT[d.getDay()]
  if (d.getFullYear() !== new Date(now).getFullYear()) return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear()
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1)
}

/* Vạch chia ngày trong thread */
export function dayDividerLabel(iso, now = Date.now()) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const n = daysAgo(iso, now)
  if (n <= 0) return 'Hôm nay'
  if (n === 1) return 'Hôm qua'
  return WEEKDAY_LONG[d.getDay()] + ', ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear()
}

/* "Truy cập 5 phút trước" ở đầu chat 1-1 */
export function lastSeenLabel(iso, now = Date.now()) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.floor((now - t) / 1000))
  if (s < 60) return 'Vừa truy cập'
  if (s < 3600) return `Truy cập ${Math.floor(s / 60)} phút trước`
  if (s < 86400) return `Truy cập ${Math.floor(s / 3600)} giờ trước`
  if (s < 7 * 86400) return `Truy cập ${Math.floor(s / 86400)} ngày trước`
  const d = new Date(t)
  return `Truy cập ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/* "Đã tắt đến 14:30" / "Đã tắt thông báo" */
export function muteLabel(mutedUntil, now = Date.now()) {
  if (!isMuted(mutedUntil, now)) return ''
  if (mutedUntil === 'forever') return 'Đã tắt thông báo'
  const n = daysAgo(mutedUntil, now)
  const d = new Date(mutedUntil)
  return 'Đã tắt đến ' + clockLabel(mutedUntil) + (n === 0 ? '' : ' ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1))
}

/* "Lan đang soạn tin…" / "Lan và Bình đang soạn tin…" / "Lan và 3 người khác đang soạn tin…" */
export function typingText(names) {
  const list = (names || []).filter(Boolean)
  if (!list.length) return ''
  if (list.length === 1) return `${list[0]} đang soạn tin…`
  if (list.length === 2) return `${list[0]} và ${list[1]} đang soạn tin…`
  return `${list[0]} và ${list.length - 1} người khác đang soạn tin…`
}

/* Xem trước tin cuối ở danh sách: "Bạn: ...", nhóm thì "Lan: ..." */
export function previewText(m, meId, convType) {
  if (!m) return ''
  const text = String(m.content || '').replace(/\s+/g, ' ').trim()
  if (m.msg_type === 'system') return text
  if (m.sender_id === meId) return 'Bạn: ' + text
  if (convType === 'group' && m.sender_name) return m.sender_name + ': ' + text
  return text
}

/* ---------- Kết nối ---------- */

/* Thời gian chờ kết nối lại thứ attempt (0, 1, 2...): 1, 2, 4... tối đa 30 giây, jitter "equal" (nửa cố định + nửa ngẫu nhiên) */
export function backoffDelay(attempt, rnd = Math.random) {
  const base = Math.min(30000, 1000 * 2 ** Math.max(0, Math.min(attempt, 10)))
  return Math.round(base / 2 + rnd() * (base / 2))
}

/* Đọc trường exp/iat của JWT (không kiểm chữ ký - chỉ để biết khi nào cần làm mới) */
export function decodeJwt(token) {
  try {
    const part = String(token || '').split('.')[1]
    if (!part) return null
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4)
    const bin = atob(b64)
    const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (e) {
    return null
  }
}

/* iat (giây) của access token; không đọc được -> 0 */
export function tokenIat(token) {
  const p = decodeJwt(token)
  return p && Number.isFinite(p.iat) ? p.iat : 0
}

/* ---------- Nhiều tài khoản trong một trình duyệt (mỗi tab một tài khoản) ---------- */

const isId = k => /^[1-9]\d*$/.test(String(k == null ? '' : k))

/* Kho tài khoản (localStorage chat_accounts): {"version":1,"accounts":{"<user id>":{access_token, refresh_token,
   device_id, user, added_at}}}. Chuỗi hỏng / sai dạng -> kho rỗng; bỏ mục không có refresh_token hoặc khoá không phải id. */
export function parseVault(raw) {
  let v = raw
  if (typeof raw === 'string') { try { v = JSON.parse(raw) } catch (e) { v = null } }
  const out = { version: 1, accounts: {} }
  const acc = v && typeof v === 'object' && v.accounts && typeof v.accounts === 'object' ? v.accounts : {}
  for (const k of Object.keys(acc)) {
    const e = acc[k]
    if (!isId(k) || !e || typeof e !== 'object' || typeof e.refresh_token !== 'string' || !e.refresh_token) continue
    out.accounts[k] = {
      access_token: typeof e.access_token === 'string' ? e.access_token : '',
      refresh_token: e.refresh_token,
      device_id: Number(e.device_id) || 0,
      user: e.user && typeof e.user === 'object' ? e.user : null,
      added_at: Number(e.added_at) || 0,
    }
  }
  return out
}

/* Id (chuỗi) các tài khoản trong kho theo thứ tự thêm vào (cùng lúc thì theo id) */
export function vaultIds(vault) {
  const acc = (vault && vault.accounts) || {}
  return Object.keys(acc).sort((a, b) => ((acc[a].added_at || 0) - (acc[b].added_at || 0)) || (Number(a) - Number(b)))
}

/* Tài khoản của tab khi nạp trang: ?u=<id> (có trong kho) -> sessionStorage của tab -> chat_last_account ->
   tài khoản duy nhất trong kho -> null (hiện cổng đăng nhập). ids: id (chuỗi) trong kho. */
export function pickAccount({ query, tab, last, ids }) {
  const list = (ids || []).map(String)
  const has = id => isId(id) && list.includes(String(id))
  if (has(query)) return String(query)
  if (has(tab)) return String(tab)
  if (has(last)) return String(last)
  return list.length === 1 ? list[0] : null
}

/* Chuyển phiên một tài khoản kiểu cũ (chat_access_token / chat_refresh_token / chat_device_id / chat_user) vào kho.
   Idempotent: kho đã có tài khoản đó thì chỉ nhận token cũ khi cùng thiết bị và token mới hơn (iat).
   Trả {vault, uid}: uid = id (chuỗi) của tài khoản, null khi không có phiên cũ dùng được (thiếu refresh token / không biết id). */
export function mergeLegacy(vault, legacy, now) {
  const base = vault || { version: 1, accounts: {} }
  const refresh = legacy && legacy.refresh
  if (!refresh) return { vault: base, uid: null }
  let user = null
  try { user = legacy.user ? JSON.parse(legacy.user) : null } catch (e) { user = null }
  if (!user || typeof user !== 'object' || !isId(user.id)) user = null
  const claims = decodeJwt(legacy.access) || {}
  const key = user ? String(user.id) : isId(claims.sub) ? String(claims.sub) : ''
  if (!key) return { vault: base, uid: null }
  const entry = {
    access_token: legacy.access || '',
    refresh_token: refresh,
    device_id: Number(legacy.device) || Number(claims.did) || 0,
    user,
    added_at: Number(now) || 0,
  }
  const old = base.accounts[key]
  if (old && !(old.device_id === entry.device_id && tokenIat(entry.access_token) > tokenIat(old.access_token))) return { vault: base, uid: key }
  const next = old
    ? { ...old, access_token: entry.access_token, refresh_token: refresh, user: user || old.user }
    : entry
  return { vault: { version: 1, accounts: { ...base.accounts, [key]: next } }, uid: key }
}

/* Tham số ?u=<id> (tài khoản) trên địa chỉ trang; không có / sai -> null */
export function accountParam(search) {
  const m = /[?&]u=([^&#]*)/.exec(String(search || ''))
  return m && isId(m[1]) ? m[1] : null
}

/* Bỏ tham số u khỏi chuỗi query, giữ tham số khác: "?u=5&x=1" -> "?x=1", "?u=5" -> "" */
export function withoutAccountParam(search) {
  const s = String(search || '').replace(/^\?/, '')
  if (!s) return ''
  const rest = s.split('&').filter(p => p && !/^u=/.test(p))
  return rest.length ? '?' + rest.join('&') : ''
}

/* Thông báo của tin mới: tag gộp theo (tài khoản, hội thoại) - hai tài khoản trên một trình duyệt không đè thông báo của nhau;
   url mở đúng tài khoản + hội thoại. Không biết tài khoản -> dạng cũ conv-<id> / /chat#c<id>. */
export const notifyTag = (uid, cid) => (uid ? 'conv-' + uid + '-' + cid : 'conv-' + cid)
export const chatUrl = (uid, cid) => '/chat' + (uid ? '?u=' + uid : '') + (cid ? '#c' + cid : '')

/* Nhãn thiết bị gửi kèm otp/verify, vd. "Chrome Windows" (tối đa 200 ký tự) */
export function deviceName(ua) {
  const s = String(ua || '')
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox'
    : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Trình duyệt'
  const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad|iPod/.test(s) ? 'iOS'
    : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : ''
  return (browser + (os ? ' ' + os : '')).slice(0, 200)
}

/* UUID v4 từ nguồn ngẫu nhiên an toàn (getRandomValues) - dùng khi không có crypto.randomUUID (trang http) */
export function uuidFromBytes(bytes) {
  const b = Array.from(bytes).slice(0, 16)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = b.map(x => x.toString(16).padStart(2, '0')).join('')
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20)
}

/* Khoá VAPID base64url -> Uint8Array cho pushManager.subscribe */
export function urlBase64ToUint8Array(s) {
  const b64 = String(s || '').replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s || '').length + 3) % 4)
  const bin = atob(b64)
  return Uint8Array.from(bin, ch => ch.charCodeAt(0))
}

export function sameBytes(a, b) {
  if (!a || !b) return false
  const x = new Uint8Array(a)
  const y = new Uint8Array(b)
  if (x.length !== y.length) return false
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false
  return true
}

/* 100 ký tự (rune) đầu - giống phần thân push của máy chủ */
export function firstRunes(s, n = 100) { return Array.from(String(s || '')).slice(0, n).join('') }
export function runeLength(s) { return Array.from(String(s || '')).length }
