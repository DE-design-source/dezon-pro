import * as L from '../state/chatLogic'
import { enablePush, loadMoreConversations, sortedConversations, togglePin, unreadFor } from '../state/chatStore'
import { ConvAvatar, PIN_PATH, SearchIcon, UsersIcon, avatarConv } from './shared'
import AccountSwitcher from './AccountSwitcher'

const TABS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'group', label: 'Nhóm' },
  { key: 'unread', label: 'Chưa đọc' },
]

const NET_TEXT = { connecting: 'Đang kết nối…', authing: 'Đang kết nối…', waiting: 'Mất kết nối, đang thử lại…', idle: 'Đang kết nối…' }

/* Cột danh sách hội thoại — renderConvList() trong chat.html.
   Dòng đầu luôn là hội thoại cục bộ SiteFlow Bot (ghim cố định), sau đó là hội thoại thật của máy chủ chat.
   Cạnh tiêu đề "Chat": bộ chọn tài khoản (mỗi tab một tài khoản). */
export default function ConversationList({ chat, bot, activeId, filterTab, searchTerm, onTab, onSearch, onSelect, onOpenDirectory, onNewChat, onAddAccount }) {
  const ready = chat.auth === 'ready'
  const me = chat.me
  const now = Date.now()
  const pins = new Set(chat.pins)
  const match = name => !searchTerm || String(name || '').toLowerCase().includes(searchTerm)

  const rows = []
  if ((filterTab === 'all' || (filterTab === 'unread' && bot.unread > 0)) && match(bot.name)) {
    rows.push(
      <div key="bot" className={'ch-conv-item' + (activeId === 'bot' ? ' active' : '')} onClick={() => onSelect('bot')}>
        <ConvAvatar conv={bot.conv} />
        <div className="ch-conv-body">
          <div className="ch-conv-top">
            <svg className="ch-conv-pinned-icon" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d={PIN_PATH} /></svg>
            <span className="ch-conv-name">{bot.name}</span>
            <span className="ch-conv-time">{bot.time}</span>
          </div>
          <div className="ch-conv-bottom">
            <span className="ch-conv-preview">{bot.preview}</span>
            {bot.unread > 0 && <span className="ch-conv-unread">{bot.unread}</span>}
          </div>
        </div>
      </div>,
    )
  }

  if (ready) {
    for (const c of sortedConversations(chat)) {
      const title = L.convTitle(c)
      const unread = unreadFor(chat, c)
      if (filterTab === 'group' && c.type !== 'group') continue
      if (filterTab === 'unread' && unread <= 0) continue
      if (!match(title)) continue
      const pinned = pins.has(String(c.id))
      const peerPres = c.type === 'direct' && c.peer ? chat.presence[c.peer.id] : null
      const online = c.type === 'direct' && c.peer && chat.net === 'online' ? (peerPres ? peerPres.online : !!c.peer.online) : false
      const typing = Object.values(chat.typing[c.id] || {}).some(exp => exp > now)
      const pend = L.pendingFor(chat.outbox, c.id)
      const lastPend = pend[pend.length - 1]
      let preview
      if (typing) preview = <i>đang soạn tin…</i>
      else if (lastPend && (!c.last_message || Date.parse(lastPend.created_at) >= Date.parse(c.last_message.created_at))) {
        preview = (lastPend.status === 'failed' ? 'Gửi lỗi: ' : 'Bạn: ') + lastPend.content
      } else preview = L.previewText(c.last_message, me.id, c.type)
      const muted = L.isMuted(c.muted_until, now)
      rows.push(
        <div key={c.id} className={'ch-conv-item' + (c.id === activeId ? ' active' : '') + (pinned ? ' pinned' : '')} onClick={() => onSelect(c.id)}>
          <ConvAvatar conv={avatarConv(c, online)} />
          <div className="ch-conv-body">
            <div className="ch-conv-top">
              {pinned && <svg className="ch-conv-pinned-icon" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d={PIN_PATH} /></svg>}
              <span className="ch-conv-name">{title}</span>
              <span className="ch-conv-time">{L.listTimeLabel(c.last_message_at || c.created_at, now)}</span>
            </div>
            <div className="ch-conv-bottom">
              <span className="ch-conv-preview">{preview}</span>
              {unread > 0 && <span className={'ch-conv-unread' + (muted ? ' muted' : '')} title={muted ? 'Đã tắt thông báo' : undefined}>{unread > 99 ? '99+' : unread}</span>}
            </div>
          </div>
          <button
            type="button"
            className="ch-conv-pin-btn"
            title={pinned ? 'Bỏ ghim hội thoại' : 'Ghim hội thoại lên đầu'}
            onClick={e => { e.stopPropagation(); togglePin(c.id) }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={PIN_PATH} /><line x1="12" y1="17" x2="12" y2="22" /></svg>
          </button>
        </div>,
      )
    }
  }

  let note = null
  if (!ready) note = chat.auth === 'unconfigured' ? 'Chưa cấu hình máy chủ chat.' : 'Đăng nhập Dezon Chat để xem tin nhắn của bạn.'
  else if (!chat.listLoaded && chat.listLoading) note = 'Đang tải hội thoại…'
  else if (!chat.listLoaded && chat.listError) note = chat.listError
  else if (chat.listLoaded && rows.length <= 1 && filterTab === 'all' && !searchTerm) note = 'Chưa có cuộc trò chuyện nào. Bấm + để nhắn tin mới.'

  function onScroll(e) {
    const el = e.currentTarget
    if (ready && chat.nextCursor && el.scrollHeight - el.scrollTop - el.clientHeight < 120) loadMoreConversations()
  }

  const offline = typeof navigator !== 'undefined' && navigator.onLine === false

  return (
    <div className="ch-conv-list">
      <div className="ch-conv-head">
        <div className="ch-row1">
          <div className="ch-row1-title">
            <h2>Chat</h2>
            <AccountSwitcher chat={chat} onAdd={onAddAccount} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="ch-icon-btn" title="Danh bạ" onClick={onOpenDirectory}>
              <UsersIcon />
            </button>
            <button className="ch-icon-btn" title="Soạn tin nhắn mới" disabled={!ready} onClick={onNewChat}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
        </div>
        {ready && (offline || chat.net !== 'online') && (
          <div className="ch-net">{offline ? 'Không có mạng — tin nhắn sẽ được gửi khi có mạng lại' : NET_TEXT[chat.net] || 'Đang kết nối…'}</div>
        )}
        {/* Chưa bật cho tài khoản này: quyền chưa hỏi, hoặc quyền đã cấp (vd. tài khoản khác từng bật) mà tài khoản này
            chưa chọn; tự tắt ('off') hoặc đang tự bật lại ('on') thì không nhắc */}
        {ready && chat.push.supported && chat.push.enabled && !chat.push.subscribed && chat.push.permission !== 'denied' &&
          chat.push.pref !== 'off' && (chat.push.permission === 'default' || chat.push.pref !== 'on') && (
          <div className="ch-push-hint">
            <span>Bật thông báo để không lỡ tin nhắn khi đóng trang.</span>
            <button type="button" disabled={chat.push.busy} onClick={() => enablePush()}>{chat.push.busy ? 'Đang bật…' : 'Bật'}</button>
          </div>
        )}
        <div className="ch-search-box">
          <SearchIcon />
          {/* Ô nhập không điều khiển (giữ nguyên chuỗi người dùng gõ), từ khoá lọc = trim + lowercase */}
          <input type="text" placeholder="Tìm cuộc trò chuyện..." onChange={e => onSearch(e.target.value.trim().toLowerCase())} />
        </div>
        <div className="ch-conv-tabs">
          {TABS.map(t => (
            <button key={t.key} className={filterTab === t.key ? 'active' : undefined} onClick={() => onTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>

      <div className="ch-conv-items" onScroll={onScroll}>
        {rows}
        {note && <div className="ch-conv-note">{note}</div>}
        {ready && chat.loadingMore && <div className="ch-conv-note">Đang tải thêm…</div>}
      </div>
    </div>
  )
}
