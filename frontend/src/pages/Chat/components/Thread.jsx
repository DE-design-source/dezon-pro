import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { COLORS } from '../../../data/chatData'
import * as L from '../state/chatLogic'
import { discardPending, getDraft, loadOlder, noteTyping, openMessages, retrySend, sendText, setDraft, stopTyping, unblockUser } from '../state/chatStore'
import { ConvAvatar, StatusIcon, UsersIcon, avatarConv, colorFor, errText, initials } from './shared'
import AddMemberPopover from './AddMemberPopover'
import Composer from './Composer'
import RequestCard from './RequestCard'

/* Thẻ thông báo của SiteFlow Bot */
function BotCard({ m }) {
  /* Bản HTML: mức "amber" tô màu bằng inline style */
  const style = m.level === 'amber' ? { borderColor: 'var(--finance)', background: 'var(--finance-tint)', color: 'var(--finance)' } : undefined
  return (
    <div className={'ch-bot-card' + (m.level === 'info' ? ' info' : '')} style={style}>
      <span className="ch-bc-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l10 18H2z" /><line x1="12" y1="10" x2="12" y2="15" /><circle cx="12" cy="18" r="0.6" fill="currentColor" stroke="none" /></svg></span>
      <div className="ch-bc-text"><strong>{m.title}</strong>{m.text}<div className="ch-bc-meta">{m.meta} · {m.time}</div></div>
    </div>
  )
}

/* Đồng hồ cho các nhãn tương đối ("Truy cập 5 phút trước") */
function useMinuteTick() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 60000)
    return () => clearInterval(t)
  }, [])
}

/* Hội thoại cục bộ SiteFlow Bot: thông báo hệ thống + thẻ phiếu yêu cầu (RequestCard) như bản cũ.
   Tin gõ ở đây chỉ hiện trên máy này (bot không có máy chủ chat). */
export function BotThread({ conv, requests, onUpdateRequest, onSend, meName }) {
  const boxRef = useRef(null)
  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [conv.messages])

  let lastOwn = false
  const items = conv.messages.map((m, idx) => {
    if (m.bot) {
      lastOwn = false
      if (m.request) {
        const req = requests.find(r => r.id === m.reqId)
        return req ? <RequestCard key={m.reqId} req={req} onUpdate={onUpdateRequest} /> : null
      }
      return <BotCard key={idx} m={m} />
    }
    const same = lastOwn
    lastOwn = true
    return (
      <div key={idx} className="ch-msg-group own">
        {same ? <div style={{ width: 34, flex: 'none' }} /> : <div className="ch-g-avatar" style={{ background: COLORS.purple }}>{initials(meName)}</div>}
        <div className="ch-g-col">
          <div className="ch-bubble ch-text">{m.text}</div>
          <span className="ch-msg-time">{m.time}</span>
        </div>
      </div>
    )
  })

  return (
    <div className="ch-thread">
      <div className="ch-thread-head">
        <ConvAvatar conv={conv} size={36} extraClass="ch-t-avatar" />
        <div>
          <div className="ch-t-name">{conv.name}</div>
          <div className="ch-t-sub">{conv.sub}</div>
        </div>
      </div>
      <div className="ch-thread-messages" ref={boxRef}>
        <div className="ch-date-divider">Hôm nay</div>
        {items}
      </div>
      <div className="ch-typing" />
      <Composer onSend={onSend} placeholder="Nhập tin nhắn... (Enter để gửi)" />
    </div>
  )
}

/* Cột hội thoại thật (máy chủ chat): đầu thread, lịch sử (cuộn lên tải thêm), trạng thái tin, đang soạn, khung soạn tin */
export default function Thread({ chat, conv, memberPopOpen, onToggleMemberPop, onCloseMemberPop }) {
  useMinuteTick()
  const me = chat.me
  const cid = conv.id
  const entry = chat.msgs[cid]
  const list = entry ? entry.list : []
  const pending = L.pendingFor(chat.outbox, cid)
  const members = chat.members[cid] || []
  const rc = chat.rcpt[cid] || {}
  const peer = conv.type === 'direct' ? conv.peer : null
  const pres = peer ? chat.presence[peer.id] : null
  /* Mất kết nối thì không biết đối phương còn online không: không hiện "Đang hoạt động" cũ */
  const online = peer && chat.net === 'online' ? (pres ? pres.online : !!peer.online) : false
  const title = L.convTitle(conv)
  const [unblockErr, setUnblockErr] = useState('')

  const boxRef = useRef(null)
  const atBottom = useRef(true)
  const prev = useRef({ first: 0, last: '', height: 0 })

  /* Giữ vị trí cuộn: thêm tin cũ ở trên -> giữ nguyên chỗ đang đọc; tin mới / tin mình gửi -> cuộn xuống nếu đang ở cuối */
  const firstSeq = L.minSeq(list)
  const lastKey = L.maxSeq(list) + ':' + pending.length
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const p = prev.current
    if (p.first && firstSeq && firstSeq < p.first && lastKey === p.last) box.scrollTop += box.scrollHeight - p.height
    else if (atBottom.current || (pending.length && lastKey !== p.last)) box.scrollTop = box.scrollHeight
    prev.current = { first: firstSeq, last: lastKey, height: box.scrollHeight }
  })

  /* Danh sách ngắn chưa có thanh cuộn mà còn tin cũ -> tải thêm luôn */
  useEffect(() => {
    const box = boxRef.current
    if (box && entry && entry.loaded && entry.hasMore && !entry.loadingOlder && box.scrollHeight <= box.clientHeight + 4) loadOlder(cid)
  }, [entry, cid])

  function onScroll(e) {
    const box = e.currentTarget
    atBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80
    if (box.scrollTop < 60 && entry && entry.hasMore && !entry.loadingOlder) loadOlder(cid)
  }

  const nameOf = uid => {
    if (peer && peer.id === uid) return peer.display_name
    const m = members.find(x => x.user_id === uid)
    return m ? m.display_name : 'Ai đó'
  }

  /* ---- Tin nhắn: vạch chia ngày, gom tin liên tiếp của cùng người (5 phút), tin hệ thống ở giữa ---- */
  const now = Date.now()
  let lastOwnSeq = 0
  for (const m of list) if (m.sender_id === me.id && m.msg_type !== 'system') lastOwnSeq = m.seq
  const items = []
  let lastDay = ''
  let lastSender = null
  let lastT = 0
  /* Vạch ngày: tin chờ gửi vẽ sau tin đã xác nhận, tin lỗi từ hôm trước không được vẽ lại vạch của ngày cũ
     (trùng key, vạch "Hôm qua" dưới "Hôm nay"): chỉ vẽ khi ngày tiến lên (dayKey là YYYY-MM-DD, so chuỗi được) */
  const pushDay = (iso, prefix = 'd') => {
    const day = L.dayKey(iso)
    if (day && day !== lastDay && (prefix === 'd' || !lastDay || day > lastDay)) {
      items.push(<div key={prefix + day} className="ch-date-divider">{L.dayDividerLabel(iso, now)}</div>)
      lastDay = day
      lastSender = null
    }
  }
  const bubble = ({ key, own, senderId, senderName, text, time, status, failed, sending, extra, onClick }) => {
    const t = Date.parse(time) || now
    const same = lastSender === senderId && t - lastT < 5 * 60000
    lastSender = senderId
    lastT = t
    items.push(
      <div key={key} className={'ch-msg-group' + (own ? ' own' : '')}>
        {same ? <div style={{ width: 34, flex: 'none' }} /> : <div className="ch-g-avatar" style={{ background: colorFor(senderId) }}>{initials(senderName)}</div>}
        <div className="ch-g-col">
          {!same && !own && conv.type === 'group' && <div className="ch-sender-name">{senderName}</div>}
          <div className={'ch-bubble ch-text' + (failed ? ' failed' : '') + (sending ? ' sending' : '')} onClick={onClick} role={onClick ? 'button' : undefined}>{text}</div>
          <span className="ch-msg-time">{L.clockLabel(time)}{status && <StatusIcon status={status} />}</span>
          {extra}
        </div>
      </div>,
    )
  }

  for (const m of list) {
    pushDay(m.created_at)
    if (m.msg_type === 'system') {
      items.push(<div key={'s' + m.seq} className="ch-sys-msg">{m.content}</div>)
      lastSender = null
      continue
    }
    const own = m.sender_id === me.id
    let status = null
    let extra = null
    if (own) {
      const st = L.ownMessageStatus(m.seq, rc, me.id)
      status = st.status
      if (m.seq === lastOwnSeq && !pending.length) {
        const label = L.seenLabel(conv.type, st)
        if (label) extra = <span className="ch-seen-line">{label}</span>
      }
    }
    bubble({ key: 'm' + m.seq, own, senderId: m.sender_id, senderName: own ? me.display_name : (m.sender_name || nameOf(m.sender_id)), text: m.content, time: m.created_at, status, extra })
  }
  for (const p of pending) {
    pushDay(p.created_at, 'pd')
    const failed = p.status === 'failed'
    bubble({
      key: 'p' + p.client_msg_id,
      own: true,
      senderId: me.id,
      senderName: me.display_name,
      text: p.content,
      time: p.created_at,
      status: failed ? null : 'sending',
      failed,
      sending: !failed,
      onClick: failed ? () => retrySend(p.client_msg_id) : undefined,
      extra: failed && (
        <span className="ch-msg-failed">
          <button type="button" onClick={() => retrySend(p.client_msg_id)}>Gửi lỗi, chạm để thử lại</button>
          {p.error && <span className="ch-msg-failed-why">{p.error}</span>}
          <button type="button" className="ch-msg-discard" onClick={() => discardPending(p.client_msg_id)}>Huỷ tin</button>
        </span>
      ),
    })
  }

  /* ---- Đang soạn tin ---- */
  const typingNames = Object.entries(chat.typing[cid] || {}).filter(([, exp]) => exp > now).map(([uid]) => nameOf(Number(uid)))
  const typingLine = conv.type === 'direct' && typingNames.length ? `${typingNames[0]} đang soạn tin…` : L.typingText(typingNames)

  /* ---- Đầu thread ---- */
  let sub = ''
  if (conv.type === 'group') sub = conv.left ? '' : `${conv.member_count || members.length} thành viên`
  else if (online) sub = 'Đang hoạt động'
  else if (pres && pres.last_seen) sub = L.lastSeenLabel(pres.last_seen, now)
  const mutedText = L.muteLabel(conv.muted_until, now)

  let bottom
  if (conv.left) {
    bottom = <div className="ch-thread-notice">Bạn không còn là thành viên của cuộc trò chuyện này.</div>
  } else if (peer && peer.relation === 'blocked') {
    bottom = (
      <div className="ch-thread-notice">
        Bạn đã chặn {peer.display_name}. Bỏ chặn để tiếp tục nhắn tin.
        <button type="button" className="ch-pjm-btn primary" onClick={() => { setUnblockErr(''); unblockUser(peer.id).catch(e => setUnblockErr(errText(e))) }}>Bỏ chặn</button>
        {unblockErr && <span className="ch-thread-notice-err">{unblockErr}</span>}
      </div>
    )
  } else {
    bottom = (
      <Composer
        initialText={getDraft(cid)}
        onDraft={v => setDraft(cid, v)}
        onTyping={v => noteTyping(cid, v)}
        onBlur={() => stopTyping(cid)}
        onSend={t => { atBottom.current = true; return sendText(cid, t) }}
      />
    )
  }

  let body
  if (!entry || (!entry.loaded && !list.length)) {
    body = entry && entry.error
      ? <div className="ch-thread-state">{entry.error} <button type="button" className="ch-gate-link" onClick={() => openMessages(cid)}>Thử lại</button></div>
      : <div className="ch-thread-state">Đang tải tin nhắn…</div>
  } else if (!list.length && !pending.length) {
    body = <div className="ch-thread-state">Chưa có tin nhắn. Gửi lời chào để bắt đầu nhé!</div>
  }

  return (
    <div className="ch-thread">
      <div className="ch-thread-head">
        <ConvAvatar conv={avatarConv(conv, online)} size={36} extraClass="ch-t-avatar" />
        <div style={{ minWidth: 0 }}>
          <div className="ch-t-name">{title}</div>
          <div className="ch-t-sub">{sub}{mutedText ? (sub ? ' · ' : '') + mutedText : ''}</div>
        </div>
        <div className="ch-thread-actions">
          {conv.type === 'group' && !conv.left && (
            <button className="ch-icon-btn" title="Thêm người vào nhóm" onClick={e => { e.stopPropagation(); onToggleMemberPop() }}><UsersIcon /></button>
          )}
          {conv.type === 'group' && memberPopOpen && <AddMemberPopover conv={conv} chat={chat} onClose={onCloseMemberPop} />}
        </div>
      </div>

      <div className="ch-thread-messages" ref={boxRef} onScroll={onScroll}>
        {entry && entry.loadingOlder && <div className="ch-history-loader">Đang tải tin cũ…</div>}
        {entry && entry.loaded && !entry.hasMore && list.length > 0 && <div className="ch-history-loader">Bắt đầu cuộc trò chuyện</div>}
        {body}
        {items}
      </div>

      <div className="ch-typing">{typingLine}</div>

      {bottom}
    </div>
  )
}
