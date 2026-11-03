import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './Chat.css'
import { BOT_CONVERSATION } from '../../data/chatData'
import ConversationList from './components/ConversationList'
import Thread, { BotThread } from './components/Thread'
import InfoPanel from './components/InfoPanel'
import ContactsView from './components/ContactsView'
import ChatGate from './components/ChatGate'
import NewChatDialog from './components/NewChatDialog'
import Dezbot, { loadAiPanelWidth } from './components/Dezbot'
import JoinGroup from './components/JoinGroup'
import SearchPanel from './components/SearchPanel'
import QrApprove from './components/QrApprove'
import { loadKdRequests, saveKdRequests } from '../../services/kdRequestService'
import { jumpToMessage, setOpenConversation, takeOpenTarget, useChat } from './state/chatStore'
import { JOIN_TOKEN_KEY, joinTokenFromPath } from './state/chatLogic'

/* Token link mời chờ tham gia (chưa đăng nhập chat: qua cổng đăng nhập rồi quay lại) - sessionStorage của tab */
function pendingJoin(v) {
  try {
    if (v === undefined) return sessionStorage.getItem(JOIN_TOKEN_KEY) || ''
    if (v) sessionStorage.setItem(JOIN_TOKEN_KEY, v)
    else sessionStorage.removeItem(JOIN_TOKEN_KEY)
  } catch (e) { /* bỏ qua */ }
  return ''
}

/* Mã QR đăng nhập chờ xác nhận (mở /chat/qr#<mã> khi chưa đăng nhập chat) - sessionStorage của tab, như link mời */
const QR_CODE_KEY = 'chat_qr_code'
function pendingQr(v) {
  try {
    if (v === undefined) return sessionStorage.getItem(QR_CODE_KEY) || ''
    if (v) sessionStorage.setItem(QR_CODE_KEY, v)
    else sessionStorage.removeItem(QR_CODE_KEY)
  } catch (e) { /* bỏ qua */ }
  return ''
}
const isQrPath = p => /^\/chat\/qr\/?$/.test(String(p || ''))
function qrCodeFromHash(hash) {
  const h = String(hash || '').replace(/^#/, '')
  try { return decodeURIComponent(h) } catch (e) { return h }
}

/* Phiếu yêu cầu gửi từ trang Kinh doanh: thêm vào cuối hội thoại cục bộ SiteFlow Bot (như bản cũ) */
function buildBotMessages() {
  const requestMsgs = loadKdRequests().map(r => ({
    bot: true, request: true, reqId: r.id, title: r.title, text: r.leadName,
    time: new Date(r.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
  }))
  return BOT_CONVERSATION.messages.map(m => ({ ...m })).concat(requestMsgs)
}
const waitingRequests = list => list.filter(r => r.status !== 'approved' && r.status !== 'rejected').length

/* #c<id> = hội thoại thật (link trong thông báo đẩy), #bot = SiteFlow Bot */
function idFromHash(hash) {
  const h = String(hash || '').replace('#', '')
  if (h === 'bot') return 'bot'
  const m = /^c(\d+)$/.exec(h)
  return m ? Number(m[1]) : null
}

export default function Chat() {
  const location = useLocation()
  const navigate = useNavigate()
  const chat = useChat()
  const ready = chat.auth === 'ready'
  const [requests, setRequests] = useState(loadKdRequests)
  const [botMsgs, setBotMsgs] = useState(buildBotMessages)
  const [botUnread, setBotUnread] = useState(() => BOT_CONVERSATION.unread + waitingRequests(loadKdRequests()))
  const [activeId, setActiveId] = useState(() => (isQrPath(location.pathname) ? null : idFromHash(location.hash)))
  /* Bảng tìm tin ở cột phải (thay cột thông tin): null | {cid: id hội thoại | null (mọi hội thoại), q: từ khoá ban đầu} */
  const [search, setSearch] = useState(null)
  const [filterTab, setFilterTab] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  /* Popover thêm thành viên đang mở: null | 'head' (đầu thread) | 'info' (cột thông tin) */
  const [memberPop, setMemberPop] = useState(null)
  const [view, setView] = useState(() => ((location.hash || '') === '#contacts' ? 'contacts' : 'chat')) // chat | contacts
  const [dialog, setDialog] = useState(null) // null | 'direct' | 'group'
  const [adding, setAdding] = useState(false) // bộ chọn tài khoản ▸ Thêm tài khoản: cổng đăng nhập ở chế độ thêm

  const [aiOpen, setAiOpen] = useState(false)
  const [aiWidth, setAiWidth] = useState(loadAiPanelWidth)
  const [aiResizing, setAiResizing] = useState(false)

  const serverActive = typeof activeId === 'number' ? activeId : null
  const activeConv = serverActive != null ? chat.convs[serverActive] : null
  /* /chat/join/:token: trang tham gia nhóm thay cho hội thoại đang mở */
  const joinToken = joinTokenFromPath(location.pathname)
  /* /chat/qr#<mã>: màn xác nhận đăng nhập bằng QR thay cho hội thoại đang mở */
  const qrPath = isQrPath(location.pathname)
  const qrCode = qrPath ? qrCodeFromHash(location.hash) : ''

  /* Chưa đăng nhập chat mà mở link QR: giữ mã qua cổng đăng nhập (như link mời). Đăng nhập xong ở /chat thì quay lại
     /chat/qr#<mã>; đang ở /chat/qr thì bỏ mã đã giữ (mất # thì lấy lại từ mã đã giữ). */
  useEffect(() => {
    if (qrPath) {
      const h = qrCodeFromHash(location.hash)
      if (!ready) { if (h) pendingQr(h); return }
      const stored = pendingQr()
      pendingQr('')
      if (!h && stored) navigate('/chat/qr#' + encodeURIComponent(stored), { replace: true })
      return
    }
    if (!ready) return
    const c = pendingQr()
    if (c) { pendingQr(''); navigate('/chat/qr#' + encodeURIComponent(c), { replace: true }) }
  }, [qrPath, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Chưa đăng nhập chat mà mở link mời: giữ token qua cổng đăng nhập. Đăng nhập xong ở /chat (cổng / tải lại trang đưa
     về) thì quay lại trang tham gia; đang ở trang tham gia thì bỏ token đã giữ. */
  useEffect(() => {
    if (joinToken) { pendingJoin(ready ? '' : joinToken); return }
    if (!ready) return
    const t = pendingJoin()
    if (t) { pendingJoin(''); navigate('/chat/join/' + encodeURIComponent(t), { replace: true }) }
  }, [joinToken, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Rời trang tham gia: vào được nhóm -> mở hội thoại; đóng -> về /chat */
  function leaveJoin(cid) {
    pendingJoin('')
    setView('chat')
    setMemberPop(null)
    if (cid) setActiveId(cid)
    navigate(cid ? '/chat#c' + cid : '/chat', { replace: true })
  }

  /* Đổi hash (bấm thông báo đẩy, link #c<id>, #contacts) -> mở đúng chỗ */
  useEffect(() => {
    if (isQrPath(location.pathname)) return // # là mã QR, không phải hội thoại
    const h = location.hash || ''
    if (h === '#contacts') { setView('contacts'); return }
    const id = idFromHash(h)
    if (id !== null) { setView('chat'); setActiveId(id); setMemberPop(null) }
  }, [location.hash])

  /* Đăng xuất (kể cả bị thu hồi phiên) -> về màn tin nhắn, bỏ hộp thoại đang mở */
  useEffect(() => {
    if (chat.auth === 'signedout') { setView('chat'); setDialog(null); setMemberPop(null); setSearch(null) }
  }, [chat.auth])

  /* Tìm trong một hội thoại mà đã chuyển sang hội thoại khác: đóng bảng tìm */
  useEffect(() => {
    setSearch(s => (s && s.cid != null && s.cid !== serverActive ? null : s))
  }, [serverActive])

  /* Đổi tài khoản / đăng xuất: bỏ hội thoại đang mở của tài khoản cũ (tài khoản mới mở là 403) và #c<id> trên URL,
     đóng cổng "thêm tài khoản" / hộp thoại của tài khoản cũ. Lần gắn đầu không đụng tới: link #c<id> từ thông báo đẩy vẫn
     mở đúng hội thoại. Đổi tài khoản do bấm thông báo của tài khoản kia: mở hội thoại của thông báo. */
  const meId = chat.me ? chat.me.id : null
  const prevMe = useRef(meId)
  useEffect(() => {
    const was = prevMe.current
    prevMe.current = meId
    if (was === meId) return
    setAdding(false)
    setSearch(null)
    const target = meId != null ? takeOpenTarget(meId) : null
    if (target != null) { setView('chat'); setActiveId(target); setMemberPop(null); setDialog(null); return }
    if (was == null) return
    setView('chat')
    setDialog(null)
    setMemberPop(null)
    setActiveId(a => (typeof a === 'number' ? null : a))
    setOpenConversation(null)
    if (/^#c\d+$/.test(location.hash)) navigate({ pathname: location.pathname, hash: '' }, { replace: true })
  }, [meId]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Báo store hội thoại đang mở (tải tin, báo đã xem, đăng ký online); rời trang / đang thêm tài khoản thì bỏ */
  useEffect(() => { setOpenConversation(ready && view === 'chat' && !adding && !joinToken && !qrPath ? serverActive : null) }, [ready, serverActive, view, adding, joinToken, qrPath])
  /* Trang vừa mở (kể cả sau khi bấm thông báo ở trang khác): hội thoại lấy từ #c<id>, bỏ hội thoại chờ mở còn sót */
  useEffect(() => { takeOpenTarget(null); return () => setOpenConversation(null) }, [])

  /* Bấm ra ngoài thì đóng popover thêm thành viên */
  useEffect(() => {
    if (!memberPop) return undefined
    const close = () => setMemberPop(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [memberPop])

  function select(id) {
    if (id === 'bot') setBotUnread(0)
    setAdding(false)
    setActiveId(id)
    setMemberPop(null)
    setView('chat')
    if (joinToken) pendingJoin('')
    navigate({ pathname: joinToken || qrPath ? '/chat' : location.pathname, hash: id === 'bot' ? '#bot' : id == null ? '' : '#c' + id }, { replace: true })
  }

  /* Bấm một kết quả tìm: mở hội thoại đó rồi cuộn tới tin (tải trang quanh seq nếu chưa có). Trả promise để bảng tìm
     báo lỗi nếu muốn. */
  function jumpTo(cid, seq) {
    if (cid !== serverActive || view !== 'chat') select(cid)
    const p = jumpToMessage(cid, seq)
    p.catch(e => console.warn('[chat] không mở được tin:', e && e.message))
    return p
  }

  /* Cập nhật một phiếu yêu cầu (xác nhận / điều phối / duyệt) và lưu lại */
  function updateRequest(id, patch) {
    const next = requests.map(r => (r.id === id ? { ...r, ...patch } : r))
    setRequests(next)
    saveKdRequests(next)
  }

  function sendBotMessage(text) {
    setBotMsgs(ms => [...ms, { own: true, text, time: 'Vừa xong' }])
  }

  const toggleMemberPop = which => setMemberPop(cur => (cur === which ? null : which))

  const botConv = { ...BOT_CONVERSATION, local: true, messages: botMsgs }
  const lastBot = botMsgs[botMsgs.length - 1]
  const botItem = {
    name: BOT_CONVERSATION.name,
    conv: botConv,
    unread: botUnread,
    time: lastBot ? lastBot.time : '',
    preview: !lastBot ? '' : lastBot.bot ? (lastBot.title + ': ' + lastBot.text) : 'Bạn: ' + lastBot.text,
  }
  const meName = (chat.me && chat.me.display_name) || 'Bạn'

  /* Bảng tìm tin (cột phải, thay cột thông tin) */
  const searchPanel = search && ready && !joinToken && !qrPath && !adding ? (
    <SearchPanel
      key={'s' + (search.cid == null ? 'all' : search.cid) + ':' + search.q}
      conversationId={search.cid}
      initialQuery={search.q}
      onClose={() => setSearch(null)}
      onJump={jumpTo}
    />
  ) : null

  let main
  if (adding) {
    main = <ChatGate key="add" chat={chat} mode="add" onCancel={() => setAdding(false)} onDone={() => setAdding(false)} />
  } else if (joinToken && ready) {
    main = <JoinGroup key={'j' + joinToken} chat={chat} token={joinToken} onOpen={cid => leaveJoin(cid)} onClose={() => leaveJoin(null)} />
  } else if (joinToken) {
    main = <ChatGate chat={chat} />
  } else if (qrPath && ready) {
    main = <QrApprove key={'q' + qrCode} initialCode={qrCode} onClose={() => navigate('/chat', { replace: true })} />
  } else if (qrPath) {
    main = <ChatGate chat={chat} />
  } else if (activeId === 'bot') {
    main = (
      <>
        <BotThread conv={botConv} requests={requests} onUpdateRequest={updateRequest} onSend={sendBotMessage} meName={meName} />
        <InfoPanel chat={chat} conv={botConv} />
      </>
    )
  } else if (!ready) {
    main = <ChatGate chat={chat} />
  } else if (activeConv) {
    main = (
      <>
        <Thread
          key={'t' + activeConv.id}
          chat={chat}
          conv={activeConv}
          memberPopOpen={memberPop === 'head'}
          onToggleMemberPop={() => toggleMemberPop('head')}
          onCloseMemberPop={() => setMemberPop(null)}
          onLeft={() => select(null)}
          onOpenSearch={() => setSearch({ cid: activeConv.id, q: '' })}
        />
        {searchPanel || (
          <InfoPanel
            key={'i' + activeConv.id}
            chat={chat}
            conv={activeConv}
            memberPopOpen={memberPop === 'info'}
            onToggleMemberPop={() => toggleMemberPop('info')}
            onCloseMemberPop={() => setMemberPop(null)}
            onLeft={() => select(null)}
          />
        )}
      </>
    )
  } else if (serverActive != null) {
    const e = chat.msgs[serverActive]
    main = (
      <>
        <div className="ch-empty">
          <div className="ch-empty-text">{e && e.error ? 'Không mở được cuộc trò chuyện này: ' + e.error : 'Đang mở cuộc trò chuyện…'}</div>
          {e && e.error && <button type="button" className="ch-ct-btn" onClick={() => select(null)}>Đóng</button>}
        </div>
        {searchPanel}
      </>
    )
  } else {
    main = (
      <>
        <div className="ch-empty">
          <div className="ch-empty-title">Chào {meName}!</div>
          <div className="ch-empty-text">Chọn một cuộc trò chuyện bên trái hoặc bắt đầu trò chuyện mới.</div>
          <div className="ch-empty-actions">
            <button type="button" className="ch-ct-btn solid" onClick={() => setDialog('direct')}>Nhắn tin mới</button>
            <button type="button" className="ch-ct-btn" onClick={() => setDialog('group')}>Tạo nhóm</button>
          </div>
        </div>
        {searchPanel}
      </>
    )
  }

  return (
    <div
      className={`ch-page${aiOpen ? ' ch-ai-open' : ''}${aiResizing ? ' ch-ai-resizing' : ''}`}
      style={{ '--ai-panel-width': `${aiWidth}px` }}
    >
      <div className="ch-main">
        {view === 'contacts' && ready && !joinToken
          ? <ContactsView chat={chat} onOpenConv={select} onNewGroup={() => setDialog('group')} onBack={() => setView('chat')} />
          : (
          <div className="ch-chat-shell">
            <ConversationList
              chat={chat}
              bot={botItem}
              activeId={activeId}
              filterTab={filterTab}
              searchTerm={searchTerm}
              onTab={setFilterTab}
              onSearch={setSearchTerm}
              onSelect={select}
              onOpenDirectory={() => { if (ready) { setAdding(false); setView('contacts') } else select(null) }}
              onNewChat={() => { setAdding(false); setDialog('direct') }}
              onAddAccount={() => { setMemberPop(null); setAdding(true) }}
              onSearchMessages={term => { if (ready) setSearch({ cid: null, q: String(term || '') }) }}
            />
            {main}
          </div>
          )}
      </div>

      {dialog && ready && (
        <NewChatDialog chat={chat} initialTab={dialog} onClose={() => setDialog(null)} onOpened={id => { setDialog(null); select(id) }} />
      )}

      <Dezbot
        open={aiOpen}
        onToggle={() => setAiOpen(v => !v)}
        onClose={() => setAiOpen(false)}
        onResize={setAiWidth}
        onResizingChange={setAiResizing}
      />
    </div>
  )
}
