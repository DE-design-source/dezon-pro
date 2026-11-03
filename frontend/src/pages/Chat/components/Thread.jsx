import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { COLORS } from '../../../data/chatData'
import * as L from '../state/chatLogic'
import { discardPending, getDraft, loadNewer, loadOlder, noteTyping, openMessages, removeMember, retryMedia, retrySend, sendMedia, sendText, sendVoice, setDraft, stopTyping, unblockUser } from '../state/chatStore'
import MentionText from './MentionText'
import { pinMessage, unpinMessage } from '../state/chatStore'
import { clearFocus, jumpToMessage, recallMessage, setEditing, setReplyTo, showLatest, submitEdit, toggleReaction } from '../state/chatStore'
import PinnedBar from './PinnedBar'
import { ConvAvatar, SearchIcon, StatusIcon, UsersIcon, avatarConv, colorFor, errText, initials } from './shared'
import AddMemberPopover from './AddMemberPopover'
import Composer from './Composer'
import ForwardDialog from './ForwardDialog'
import Lightbox from './Lightbox'
import MediaBubble from './MediaBubble'
import MessageMenu from './MessageMenu'
import ReactionBar from './ReactionBar'
import ReactionPicker from './ReactionPicker'
import ReactionUsersDialog from './ReactionUsersDialog'
import ReadByDialog from './ReadByDialog'
import ReplyPreview from './ReplyPreview'
import RequestCard from './RequestCard'
import './MessageActions.css'

const isMediaType = t => t === 'image' || t === 'video' || t === 'file' || t === 'voice'

/* Sao chép chữ: Clipboard API (cần HTTPS), không có thì dùng textarea ẩn + execCommand */
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text)
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch { ok = false }
    document.body.removeChild(ta)
    if (ok) resolve()
    else reject(new Error('Không sao chép được'))
  })
}

const ICON_MORE = <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
const ICON_SMILE = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2" /><line x1="9" y1="9.5" x2="9.01" y2="9.5" /><line x1="15" y1="9.5" x2="15.01" y2="9.5" /></svg>
const ICON_REPLY = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg>

/* Kéo tệp từ máy (không phải kéo chữ / link trong trang) */
const hasFiles = e => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')

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
export default function Thread({ chat, conv, memberPopOpen, onToggleMemberPop, onCloseMemberPop, onLeft, onOpenSearch }) {
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
  const [leaving, setLeaving] = useState(false)
  const mediaCfg = chat.mediaCfg || { enabled: false }
  const uploads = chat.uploads || {}
  const [lbKey, setLbKey] = useState(null)
  const [readBySeq, setReadBySeq] = useState(null)
  const [dropped, setDropped] = useState(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  useEffect(() => { setLbKey(null); setDropped(null); setReadBySeq(null) }, [cid])
  const [pinErr, setPinErr] = useState('')
  useEffect(() => { setPinErr('') }, [cid])
  /* Menu thao tác / bảng chọn cảm xúc đang mở (theo seq), hộp chuyển tiếp, hộp "ai đã thả cảm xúc" (message id) */
  const [menuSeq, setMenuSeq] = useState(null)
  const [pickerSeq, setPickerSeq] = useState(null)
  const [fwdMsg, setFwdMsg] = useState(null)
  const [usersFor, setUsersFor] = useState(null)
  const longPress = useRef(null)
  useEffect(() => () => clearTimeout(longPress.current), [])

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
    /* hasNewer: đang xem trang quanh một tin cũ (nhảy tới tin) - tin nối thêm ở dưới không kéo khung xuống cuối */
    const viewingOld = !!(entry && entry.hasNewer)
    if (p.first && firstSeq && firstSeq < p.first && lastKey === p.last) box.scrollTop += box.scrollHeight - p.height
    else if ((atBottom.current && !viewingOld) || (pending.length && lastKey !== p.last)) box.scrollTop = box.scrollHeight
    prev.current = { first: firstSeq, last: lastKey, height: box.scrollHeight }
  })

  /* Nhảy tới tin (khung trích dẫn, tin ghim, kết quả tìm kiếm): chatStore đặt S.focus và tải trang quanh seq nếu cần;
     tin đã vẽ -> cuộn tới giữa khung, tô sáng 2 giây rồi xoá focus */
  const focus = chat.focus
  const focusEl = useRef({ el: null, timer: 0 })
  const dropFocusClass = () => {
    const f = focusEl.current
    clearTimeout(f.timer)
    if (f.el) f.el.classList.remove('ch-msg-focus')
    focusEl.current = { el: null, timer: 0 }
  }
  useEffect(() => dropFocusClass, [])
  useEffect(() => {
    if (!focus || focus.cid !== cid) return
    const box = boxRef.current
    const el = box && box.querySelector('[data-mkey="m' + focus.seq + '"]')
    if (!el) return
    atBottom.current = false
    el.scrollIntoView({ block: 'center' })
    dropFocusClass()
    el.classList.remove('ch-msg-focus')
    void el.offsetWidth
    el.classList.add('ch-msg-focus')
    /* bỏ lớp sau 2 giây (kể cả khi giảm chuyển động: lớp là viền tĩnh, không tự hết như animation) */
    focusEl.current = { el, timer: setTimeout(dropFocusClass, 2000) }
    clearFocus()
  }, [focus, cid, list])

  /* Tin đang sửa bị thu hồi (thiết bị khác / trưởng nhóm) -> thoát chế độ sửa */
  const editingRaw = (chat.editing || {})[cid] || null
  const editingMsg = editingRaw ? (list.find(x => x.id === editingRaw.id) || editingRaw) : null
  useEffect(() => {
    if (editingMsg && editingMsg.recalled) { setEditing(cid, null); setPinErr('Tin nhắn đang sửa đã bị thu hồi') }
  }, [editingMsg, cid])
  /* chatStore (applyUpdates) bỏ S.editing cùng lúc đánh dấu thu hồi: nhận ra khi chế độ sửa vừa tắt mà tin đó đã bị thu hồi */
  const prevEdit = useRef(null)
  useEffect(() => {
    const p = prevEdit.current
    prevEdit.current = editingRaw ? { cid, id: editingRaw.id } : null
    if (editingRaw || !p || p.cid !== cid) return
    const m = list.find(x => x.id === p.id)
    if (m && m.recalled) setPinErr('Tin nhắn đang sửa đã bị thu hồi')
  }, [editingRaw, cid])

  /* Danh sách ngắn chưa có thanh cuộn mà còn tin cũ -> tải thêm luôn */
  useEffect(() => {
    const box = boxRef.current
    if (box && entry && entry.loaded && entry.hasMore && !entry.loadingOlder && box.scrollHeight <= box.clientHeight + 4) loadOlder(cid)
    if (box && entry && entry.loaded && entry.hasNewer && !(chat.focus && chat.focus.cid === cid) && box.scrollHeight <= box.clientHeight + 4) loadNewer(cid)
  }, [entry, cid])

  function onScroll(e) {
    const box = e.currentTarget
    atBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80
    if (box.scrollTop < 60 && entry && entry.hasMore && !entry.loadingOlder) loadOlder(cid)
    if (atBottom.current && entry && entry.hasNewer) loadNewer(cid)
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
  /* media: nội dung ảnh / video / tệp / tin thoại; text khi đó là chú thích (bubble chữ riêng bên dưới) */
  /* Ghim tin: nhóm - trưởng / phó nhóm; chat 1-1 - cả hai bên */
  const msgPins = (chat.msgPins && chat.msgPins[cid]) || []
  const pinnedIds = new Set(msgPins.map(p => p.message_id))
  const myRole = conv.role || ((members.find(x => x.user_id === me.id) || {}).role) || 'member'
  const canPin = !conv.left && !L.isDisbanded(conv) && (conv.type === 'direct' || myRole === 'owner' || myRole === 'admin')
  const togglePinMsg = m => {
    setPinErr('')
    const op = pinnedIds.has(m.id) ? unpinMessage(cid, m.id) : pinMessage(cid, m.id)
    op.catch(e => setPinErr(errText(e)))
  }
  const jumpTo = seq => {
    setPinErr('')
    jumpToMessage(cid, seq).catch(e => setPinErr(errText(e)))
  }

  /* Quyền thao tác theo hội thoại (ma trận API.md "Giai đoạn 2"); luật theo từng tin nằm ở msgActionUtil (MessageMenu) */
  const isDisb = L.isDisbanded(conv)
  const blockedPeer = !!(peer && peer.relation === 'blocked')
  const activeHere = !conv.left && !isDisb
  const canSendHere = activeHere && !blockedPeer && (conv.type !== 'group' || L.canDo(myRole, conv.settings, 'send'))
  const canReactHere = activeHere && !blockedPeer
  /* Danh sách thành viên nhóm chưa tải: 'unknown' (canRecallMsg ẩn quyền thu hồi của phó nhóm), chỉ coi là đã rời (null) khi đã tải */
  const roleOf = uid => {
    if (conv.type === 'group' && !members.length) return 'unknown'
    const x = members.find(y => y.user_id === uid)
    return x ? x.role : null
  }
  const closeMenus = () => { setMenuSeq(null); setPickerSeq(null) }
  const react = (m, code) => { setPinErr(''); toggleReaction(cid, m.id, code).catch(e => setPinErr(errText(e))) }
  const startReply = m => { setPinErr(''); setEditing(cid, null); setReplyTo(cid, m) }
  const startEdit = m => { setPinErr(''); setReplyTo(cid, null); setEditing(cid, m) }
  const doRecall = m => {
    if (!window.confirm('Thu hồi tin nhắn này với mọi người?')) return
    setPinErr('')
    recallMessage(cid, m.id).catch(e => setPinErr(errText(e)))
  }
  const doCopy = m => { copyText(String(m.content || '')).then(() => setPinErr('')).catch(e => setPinErr(errText(e))) }
  /* Giữ lâu (màn hình cảm ứng) / chuột phải -> mở menu tin */
  const pressHandlers = seq => ({
    onContextMenu: e => { e.preventDefault(); setPickerSeq(null); setMenuSeq(seq) },
    onTouchStart: () => { clearTimeout(longPress.current); longPress.current = setTimeout(() => { setPickerSeq(null); setMenuSeq(seq) }, 500) },
    onTouchEnd: () => clearTimeout(longPress.current),
    onTouchMove: () => clearTimeout(longPress.current),
  })

  const bubble = ({ key, own, senderId, senderName, text, time, status, failed, sending, extra, onClick, media, tools, top, quote, recalled, below, actions, press }) => {
    const t = Date.parse(time) || now
    const same = lastSender === senderId && t - lastT < 5 * 60000
    lastSender = senderId
    lastT = t
    items.push(
      <div key={key} data-mkey={key} className={'ch-msg-group' + (own ? ' own' : '')}>
        {same ? <div style={{ width: 34, flex: 'none' }} /> : <div className="ch-g-avatar" style={{ background: colorFor(senderId) }}>{initials(senderName)}</div>}
        <div className="ch-g-col">
          {!same && !own && conv.type === 'group' && <div className="ch-sender-name">{senderName}</div>}
          {top}
          {quote}
          <div className="ch-msg-body" {...(press || {})}>
            {media && <div className={'ch-media-wrap' + (failed ? ' failed' : '') + (sending ? ' sending' : '')}>{media}</div>}
            {(!media || text) && <div className={'ch-bubble ch-text' + (failed ? ' failed' : '') + (sending ? ' sending' : '') + (recalled ? ' ch-recalled' : '')} onClick={onClick} role={onClick ? 'button' : undefined}>{text}</div>}
            {actions}
          </div>
          {below}
          <span className="ch-msg-time">{L.clockLabel(time)}{status && <StatusIcon status={status} />}{tools}</span>
          {extra}
        </div>
      </div>,
    )
  }

  for (const m of list) {
    pushDay(m.created_at)
    if (m.msg_type === 'system') {
      items.push(<div key={'s' + m.seq} data-mkey={'m' + m.seq} className="ch-sys-msg">{m.content}</div>)
      lastSender = null
      continue
    }
    const own = m.sender_id === me.id
    const senderName = own ? me.display_name : (m.sender_name || nameOf(m.sender_id))
    let status = null
    let extra = null
    if (own) {
      const st = L.ownMessageStatus(m.seq, rc, me.id)
      status = st.status
      if (m.seq === lastOwnSeq && !pending.length) {
        const label = L.seenLabel(conv.type, st)
        if (label && conv.type === 'group') {
          const seq = m.seq
          extra = <button type="button" className="ch-seen-line ch-seen-btn" onClick={() => setReadBySeq(seq)}>{label}</button>
        } else if (label) extra = <span className="ch-seen-line">{label}</span>
      }
    }
    const recalled = !!m.recalled
    const isPinned = pinnedIds.has(m.id)
    const tools = (
      <>
        {m.edited_at && !recalled && <span className="ch-msg-edited">Đã chỉnh sửa</span>}
        {isPinned && !recalled && <span className="ch-pin-btn on">Đã ghim</span>}
      </>
    )
    if (recalled) {
      bubble({ key: 'm' + m.seq, own, senderId: m.sender_id, senderName, text: L.recalledText(m), recalled: true, time: m.created_at, status, extra, tools })
      continue
    }
    const media = isMediaType(m.msg_type)
      ? <MediaBubble msg={m} onOpen={m.msg_type === 'image' || m.msg_type === 'video' ? () => setLbKey('m' + m.seq) : undefined} />
      : null
    const text = m.content && m.mentions && m.mentions.length ? <MentionText text={m.content} mentions={m.mentions} meId={me.id} /> : m.content
    const seq = m.seq
    const hasId = !!m.id
    const menuOpen = menuSeq === seq
    const pickerOpen = pickerSeq === seq
    const actions = hasId && (
      <>
        <div className={'ch-msg-hover' + (menuOpen || pickerOpen ? ' show' : '')}>
          {canReactHere && (
            <button type="button" className="ch-msg-hover-btn" title="Thả cảm xúc" aria-label="Thả cảm xúc" data-reaction-trigger=""
              onClick={() => { setMenuSeq(null); setPickerSeq(pickerOpen ? null : seq) }}>{ICON_SMILE}</button>
          )}
          {canSendHere && (
            <button type="button" className="ch-msg-hover-btn" title="Trả lời" aria-label="Trả lời" onClick={() => { closeMenus(); startReply(m) }}>{ICON_REPLY}</button>
          )}
          <button type="button" className="ch-msg-hover-btn" title="Thêm" aria-label="Thao tác khác" aria-haspopup="menu" aria-expanded={menuOpen}
            data-msg-menu-trigger=""
            onClick={() => { setPickerSeq(null); setMenuSeq(menuOpen ? null : seq) }}>{ICON_MORE}</button>
        </div>
        {menuOpen && (
          <MessageMenu
            message={m}
            meId={me.id}
            conv={conv}
            myRole={myRole}
            senderRole={roleOf(m.sender_id)}
            pinned={isPinned}
            canPin={canPin}
            onReply={canSendHere ? () => startReply(m) : undefined}
            onForward={!conv.left ? () => setFwdMsg(m) : undefined}
            onEdit={canSendHere ? () => startEdit(m) : undefined}
            onRecall={activeHere ? () => doRecall(m) : undefined}
            onCopy={() => doCopy(m)}
            onPin={() => togglePinMsg(m)}
            onUnpin={() => togglePinMsg(m)}
            onReact={canReactHere ? () => { setMenuSeq(null); setPickerSeq(seq) } : undefined}
            onClose={() => setMenuSeq(cur => (cur === seq ? null : cur))}
          />
        )}
        {pickerOpen && (
          <ReactionPicker
            mine={m.reactions ? m.reactions.mine : null}
            align={own ? 'right' : 'left'}
            onPick={code => react(m, code)}
            onClose={() => setPickerSeq(cur => (cur === seq ? null : cur))}
          />
        )}
      </>
    )
    const r = m.reply_to
    bubble({
      key: 'm' + seq,
      own,
      senderId: m.sender_id,
      senderName,
      text,
      time: m.created_at,
      status,
      extra,
      media,
      tools,
      top: m.forwarded ? <span className="ch-fwd-label">Đã chuyển tiếp</span> : null,
      quote: r ? <ReplyPreview reply={r} onJump={() => jumpTo(r.seq)} /> : null,
      below: <ReactionBar reactions={m.reactions} onToggle={canReactHere ? code => react(m, code) : undefined} onShowUsers={() => setUsersFor(m.id)} />,
      actions,
      press: hasId ? pressHandlers(seq) : null,
    })
  }
  /* Tin chờ gửi: tin có tệp nằm theo thứ tự ord giữa các tin chờ cho tới khi máy chủ xác nhận (rồi về đúng seq) */
  for (const p of pending) {
    pushDay(p.created_at, 'pd')
    const failed = p.status === 'failed'
    const isMedia = isMediaType(p.msg_type)
    const retry = () => (isMedia ? retryMedia(p.client_msg_id) : retrySend(p.client_msg_id))
    bubble({
      key: 'p' + p.client_msg_id,
      own: true,
      senderId: me.id,
      senderName: me.display_name,
      text: p.content && p.mentions && p.mentions.length ? <MentionText text={p.content} mentions={p.mentions} meId={me.id} /> : p.content,
      time: p.created_at,
      status: failed ? null : 'sending',
      failed,
      sending: !failed,
      media: isMedia ? <MediaBubble pending={p} upload={uploads[p.client_msg_id]} /> : null,
      quote: p.reply_to ? <ReplyPreview reply={p.reply_to} onJump={() => jumpTo(p.reply_to.seq)} /> : null,
      onClick: failed ? retry : undefined,
      extra: failed && (
        <span className="ch-msg-failed">
          <button type="button" onClick={retry}>Gửi lỗi, chạm để thử lại</button>
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
  if (conv.type === 'group') sub = conv.left ? '' : L.isDisbanded(conv) ? 'Nhóm đã giải tán' : `${conv.member_count || members.length} thành viên`
  else if (online) sub = 'Đang hoạt động'
  else if (pres && pres.last_seen) sub = L.lastSeenLabel(pres.last_seen, now)
  const mutedText = L.muteLabel(conv.muted_until, now)

  /* Nhóm đã giải tán: chỉ đọc, thay ô soạn bằng nút gỡ khỏi danh sách; nhóm chỉ trưởng / phó nhóm gửi tin: member không có ô soạn */
  const disbanded = L.isDisbanded(conv)
  const sendLocked = conv.type === 'group' && !conv.left && !disbanded && !L.canDo(myRole, conv.settings, 'send')
  const mentionMembers = conv.type === 'group' ? members.filter(x => x.user_id !== me.id) : null
  /* Thanh "Đang trả lời": dựng từ bản tin mới nhất trong danh sách (tin gốc vừa sửa / thu hồi thì thanh đổi theo) */
  const replyRaw = (chat.replyTo || {})[cid] || null
  let replyBar = null
  if (replyRaw) {
    const src = list.find(x => x.id === replyRaw.id) || replyRaw
    replyBar = L.replyPreviewOf(src)
    if (replyBar && !replyBar.sender_name) replyBar = { ...replyBar, sender_name: src.sender_id === me.id ? me.display_name : nameOf(src.sender_id) }
  }
  let bottom
  if (disbanded) {
    bottom = (
      <div className="ch-thread-notice ch-readonly">
        <span className="ch-notice-title">Nhóm đã bị giải tán</span>
        <span>Bạn vẫn xem được tin nhắn cũ nhưng không gửi được tin mới.</span>
        <button type="button" className="ch-pjm-btn" disabled={leaving} onClick={() => {
          if (!window.confirm('Xoá nhóm "' + L.convTitle(conv) + '" khỏi danh sách? Bạn sẽ không xem lại được tin nhắn của nhóm.')) return
          setUnblockErr(''); setLeaving(true)
          removeMember(cid, me.id).then(() => { if (onLeft) onLeft() }).catch(e => setUnblockErr(errText(e))).finally(() => setLeaving(false))
        }}>{leaving ? 'Đang xoá…' : 'Xoá khỏi danh sách'}</button>
        {unblockErr && <span className="ch-thread-notice-err">{unblockErr}</span>}
      </div>
    )
  } else if (sendLocked) {
    bottom = <div className="ch-thread-notice">Chỉ trưởng / phó nhóm được gửi tin trong nhóm này.</div>
  } else if (conv.left) {
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
        onSend={(t, mentions) => { atBottom.current = true; showLatest(cid); return mentions ? sendText(cid, t, mentions) : sendText(cid, t) }}
        mentionMembers={mentionMembers}
        canMentionAll={conv.type === 'group' && L.canDo(myRole, conv.settings, 'mention_all')}
        mediaCfg={mediaCfg}
        incomingFiles={dropped}
        onSendFiles={(files, opts) => { atBottom.current = true; showLatest(cid); return sendMedia(cid, files, opts) }}
        onSendVoice={(blob, meta) => { atBottom.current = true; showLatest(cid); return sendVoice(cid, blob, meta) }}
        reply={replyBar}
        onCancelReply={() => setReplyTo(cid, null)}
        editing={editingMsg}
        onSubmitEdit={(t, ms) => submitEdit(cid, editingMsg.id, t, ms).then(() => setEditing(cid, null))}
        onCancelEdit={() => setEditing(cid, null)}
      />
    )
  }
  const canDrop = !!mediaCfg.enabled && !conv.left && !disbanded && !sendLocked && !(peer && peer.relation === 'blocked')

  /* Kéo thả tệp vào cả cột thread -> đưa vào hàng đính kèm của khung soạn */
  const dnd = canDrop ? {
    onDragEnter: e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDragging(true) },
    onDragOver: e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy' },
    onDragLeave: e => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false) },
    onDrop: e => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const files = Array.from(e.dataTransfer.files || [])
      if (files.length) setDropped({ files })
    },
  } : {}

  /* Ảnh / video trong hội thoại cho lightbox (chỉ tin đã lên máy chủ, tệp đã sẵn sàng) */
  let lightbox = null
  if (lbKey) {
    const lbItems = []
    for (const m of list) {
      if (m.msg_type !== 'image' && m.msg_type !== 'video') continue
      const md = m.attachments && m.attachments[0]
      if (md && md.url && (!md.status || md.status === 'ready')) lbItems.push({ key: 'm' + m.seq, media: md, messageId: m.id, type: m.msg_type })
    }
    const idx = lbItems.findIndex(x => x.key === lbKey)
    if (idx >= 0) lightbox = <Lightbox items={lbItems} index={idx} onIndex={i => setLbKey(lbItems[i].key)} onClose={() => setLbKey(null)} />
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
    <div className="ch-thread" {...dnd}>
      {dragging && <div className="ch-drop-overlay"><span>Thả tệp vào đây để gửi</span></div>}
      {lightbox}
      {readBySeq != null && conv.type === 'group' && <ReadByDialog seq={readBySeq} receipts={rc} meId={me.id} nameOf={nameOf} onClose={() => setReadBySeq(null)} />}
      {fwdMsg && <ForwardDialog message={fwdMsg} onClose={() => setFwdMsg(null)} />}
      {usersFor != null && <ReactionUsersDialog messageId={usersFor} reactions={(list.find(x => x.id === usersFor) || {}).reactions} onClose={() => setUsersFor(null)} />}
      <div className="ch-thread-head">
        <ConvAvatar conv={avatarConv(conv, online)} size={36} extraClass="ch-t-avatar" />
        <div style={{ minWidth: 0 }}>
          <div className="ch-t-name">{title}</div>
          <div className="ch-t-sub">{sub}{mutedText ? (sub ? ' · ' : '') + mutedText : ''}</div>
        </div>
        <div className="ch-thread-actions">
          {onOpenSearch && !conv.left && (
            <button className="ch-icon-btn" title="Tìm tin nhắn trong cuộc trò chuyện" aria-label="Tìm tin nhắn" onClick={() => onOpenSearch()}><SearchIcon size={15} /></button>
          )}
          {conv.type === 'group' && !conv.left && !L.isDisbanded(conv) && L.canDo(myRole, conv.settings, 'add_members') && (
            <button className="ch-icon-btn" title="Thêm người vào nhóm" onClick={e => { e.stopPropagation(); onToggleMemberPop() }}><UsersIcon /></button>
          )}
          {conv.type === 'group' && memberPopOpen && <AddMemberPopover conv={conv} chat={chat} onClose={onCloseMemberPop} />}
        </div>
      </div>

      <PinnedBar pins={msgPins} canPin={canPin} onJump={p => jumpTo(p.seq)} onUnpin={p => { setPinErr(''); unpinMessage(cid, p.message_id).catch(e => setPinErr(errText(e))) }} />
      {pinErr && <div className="ch-pin-err">{pinErr}</div>}
      <div className="ch-thread-messages" ref={boxRef} onScroll={onScroll}>
        {entry && entry.loadingOlder && <div className="ch-history-loader">Đang tải tin cũ…</div>}
        {entry && entry.loaded && !entry.hasMore && list.length > 0 && <div className="ch-history-loader">Bắt đầu cuộc trò chuyện</div>}
        {body}
        {items}
        {entry && entry.hasNewer && <div className="ch-history-loader">Cuộn xuống để tải tin mới hơn</div>}
      </div>

      <div className="ch-typing">{typingLine}</div>

      {bottom}
    </div>
  )
}
