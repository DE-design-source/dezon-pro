/* Service worker của Dezon Chat (Web Push, CHAT.md mục 13). Vite chép thư mục public/ ra gốc bản build -> /chat-sw.js.
   Không có trình xử lý fetch: không chặn / cache request nào của app.
   Một trình duyệt đăng nhập được nhiều tài khoản chat (mỗi tab một tài khoản), dùng chung worker + subscription này;
   gói push / notify mang user_id của tài khoản nhận (máy chủ / trang cũ không có user_id: dạng cũ theo hội thoại):
   - push: hiện thông báo {title, body, tag: conv-<user>-<id>, data.url: /chat?u=<user>#c<id>}, cập nhật huy hiệu
     ứng dụng (badge = tổng chưa đọc của tài khoản đó).
   - message {type: 'notify'}: thông báo của trang đang ẩn (khử trùng giữa các tab theo (tài khoản, hội thoại, seq)).
   - notificationclick: có cửa sổ app đang mở thì focus + postMessage({type:'open', url, user_id}) (trang tự đổi sang
     tài khoản đó rồi mở hội thoại), không thì mở cửa sổ mới tới url. */

self.addEventListener('install', () => { self.skipWaiting() })
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()) })

const userOf = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }
const tagFor = (uid, cid) => (uid ? 'conv-' + uid + '-' + cid : 'conv-' + cid)
const urlFor = (uid, cid) => '/chat' + (uid ? '?u=' + uid : '') + (cid ? '#c' + cid : '')

/* seq lớn nhất đã báo theo (tài khoản, hội thoại) (trong bộ nhớ của worker): nhiều tab ẩn cùng nhận một tin chỉ báo 1 lần;
   hai tài khoản cùng ở một hội thoại thì mỗi tài khoản vẫn được báo */
const notified = new Map()
function firstTime(userId, conversationId, seq) {
  const cid = Number(conversationId)
  const s = Number(seq)
  if (!Number.isFinite(cid) || !Number.isFinite(s)) return true
  const key = userOf(userId) + ':' + cid
  if (s <= (notified.get(key) || 0)) return false
  notified.set(key, s)
  if (notified.size > 500) notified.delete(notified.keys().next().value)
  return true
}

/* Trang đang online nhưng ẩn (máy chủ không push cho người đang online) nhờ worker hiện thông báo: {type: 'notify',
   user_id, conversation_id, seq, title, body, tag, url}. Bỏ nếu đã báo tin này (tab khác). Có user_id thì trang đã tự
   kiểm tab đang hiện của CÙNG tài khoản (worker không biết tab nào của tài khoản nào: tab hiện của tài khoản khác không
   được chặn); trang cũ không gửi user_id thì như trước: bỏ khi đang có cửa sổ app hiện trên màn hình. */
self.addEventListener('message', event => {
  const d = event.data
  if (!d || d.type !== 'notify' || !firstTime(d.user_id, d.conversation_id, d.seq)) return
  event.waitUntil((async () => {
    const uid = userOf(d.user_id)
    if (!uid) {
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (list.some(c => c.visibilityState === 'visible')) return
    }
    const cid = d.conversation_id || null
    await self.registration.showNotification(d.title || 'Dezon Chat', {
      body: d.body || 'Bạn có tin nhắn mới',
      tag: d.tag || (cid ? tagFor(uid, cid) : 'dezon-chat'),
      renotify: true,
      data: { url: d.url || urlFor(uid, cid), user_id: uid || null, conversation_id: cid, seq: d.seq || null },
    })
  })())
})

self.addEventListener('push', event => {
  let d = {}
  try {
    d = event.data ? event.data.json() : {}
  } catch (e) {
    d = { body: event.data ? event.data.text() : '' }
  }
  const uid = userOf(d.user_id)
  const cid = d.conversation_id || null
  const title = d.title || 'Dezon Chat'
  const url = d.url || urlFor(uid, cid)
  if (cid && d.seq) firstTime(uid, cid, d.seq) // trang mở lại ngay sau đó không báo lại tin này
  const options = {
    body: d.body || 'Bạn có tin nhắn mới',
    tag: d.tag || (cid ? tagFor(uid, cid) : 'dezon-chat'),
    renotify: true,
    data: { url, user_id: uid || null, conversation_id: cid, seq: d.seq || null },
  }
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options)
    const nav = self.navigator
    if (typeof d.badge === 'number' && nav && typeof nav.setAppBadge === 'function') {
      try {
        if (d.badge > 0) await nav.setAppBadge(d.badge)
        else if (typeof nav.clearAppBadge === 'function') await nav.clearAppBadge()
      } catch (e) { /* trình duyệt không hỗ trợ huy hiệu */ }
    }
  })())
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const data = event.notification.data || {}
  const url = new URL(data.url || '/chat', self.location.origin).href
  let uid = userOf(data.user_id)
  if (!uid) { try { uid = userOf(new URL(url).searchParams.get('u')) } catch (e) { uid = 0 } }
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const same = list.filter(c => {
      try { return new URL(c.url).origin === self.location.origin } catch (e) { return false }
    })
    /* Ưu tiên cửa sổ đang ở trang /chat, sau đó cửa sổ bất kỳ của app; trang nhận 'open' tự đổi sang tài khoản user_id */
    const target = same.find(c => new URL(c.url).pathname === '/chat') || same[0]
    if (target) {
      try { await target.focus() } catch (e) { /* bỏ qua */ }
      target.postMessage({ type: 'open', url, user_id: uid || null })
      return
    }
    await self.clients.openWindow(url)
  })())
})
