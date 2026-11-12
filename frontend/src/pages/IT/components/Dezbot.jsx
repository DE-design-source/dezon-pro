import { useEffect, useRef, useState } from 'react'
import { BugChip } from '../../../components/ui/BugReport'
import { TICKETS, ASSETS, isOpenTicket } from '../../../data/itData'

const MIN_W = 320
const MAX_W = 720
/* mặc định rộng bằng cột trái QS trên màn hình (CATALOG_DEFAULT 440 x zoom .75 = 330); khoá _v2 bỏ độ rộng 440 cũ đã nhớ */
const WIDTH_KEY = 'siteflow-ai-panel-width-v2'
const FALLBACK = 'Tôi có thể hỗ trợ thông tin về ticket, thiết bị CNTT, mạng & máy chủ, uptime hệ thống và các yêu cầu ưu tiên cao. Bạn thử hỏi lại theo các chủ đề này nhé.'

export function loadAiPanelWidth() {
  try {
    const saved = parseInt(localStorage.getItem(WIDTH_KEY), 10)
    if (saved) return saved
  } catch { /* localStorage không khả dụng */ }
  return 330
}

const ticketLine = t => `${t.requester} — ${t.issue}`

/* Các chủ đề của Dezbot bộ phận IT (giống AI_TOPICS trong it.html) */
const TOPICS = [
  {
    key: 'ticket', label: 'Ticket hỗ trợ', keywords: ['ticket', 'yêu cầu hỗ trợ', 'yêu cầu', 'sự cố'],
    reply: () => {
      const open = TICKETS.filter(isOpenTicket)
      const high = open.filter(t => t.priority === 'high')
      return <>Hiện có <strong>{open.length}</strong> ticket đang mở trên tổng {TICKETS.length} ticket gần đây. {high.length
        ? `Ưu tiên cao: ${high.map(ticketLine).join('; ')}.`
        : 'Không có ticket ưu tiên cao nào đang mở.'}</>
    },
  },
  {
    key: 'thietbi', label: 'Thiết bị CNTT', keywords: ['thiết bị', 'laptop', 'máy in', 'camera', 'tài sản'],
    reply: () => {
      const broken = ASSETS.filter(a => a.status === 'broken')
      const maint = ASSETS.filter(a => a.status === 'maintenance')
      return <>Đang quản lý <strong>186</strong> thiết bị CNTT (laptop, máy chủ, camera, thiết bị mạng...). {broken.length > 0 && `${broken.map(a => a.name).join(', ')} đang hỏng, chờ sửa. `}
        {maint.length > 0 && `${maint.map(a => a.name).join(', ')} cần bảo trì định kỳ.`}</>
    },
  },
  {
    key: 'mang', label: 'Mạng & máy chủ', keywords: ['mạng', 'wifi', 'máy chủ', 'server', 'vpn'],
    reply: () => 'Hệ thống mạng và máy chủ hoạt động ổn định. Wifi công trường Quận 9 đang được kỹ thuật viên xử lý do tín hiệu chậm — dự kiến hoàn tất trong hôm nay.',
  },
  {
    key: 'uptime', label: 'Uptime hệ thống', keywords: ['uptime', 'thời gian hoạt động', 'downtime', 'sự cố hệ thống'],
    reply: () => <>Uptime hệ thống tháng này đạt <strong>99.8%</strong>, không có sự cố nghiêm trọng nào ảnh hưởng đến vận hành.</>,
  },
  {
    key: 'uutien', label: 'Yêu cầu ưu tiên cao', keywords: ['ưu tiên cao', 'cần xử lý gấp', 'gấp'], wide: true,
    reply: () => {
      const high = TICKETS.filter(t => t.priority === 'high' && isOpenTicket(t))
      if (!high.length) return 'Hiện không có yêu cầu ưu tiên cao nào đang chờ xử lý.'
      return `Các yêu cầu ưu tiên cao cần xử lý: ${high.map(ticketLine).join('; ')}.`
    },
  },
]
const matchTopic = text => TOPICS.find(t => t.keywords.some(kw => text.toLowerCase().includes(kw))) || null

const MonitorIcon = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
)

export default function Dezbot({ open, onOpen, onClose, onResize, onResizingChange }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [resizing, setResizing] = useState(false)
  const bodyRef = useRef(null)
  const panelRef = useRef(null)
  const timers = useRef([])
  const seq = useRef(0)

  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight }, [messages])

  const push = (...msgs) => setMessages(prev => [...prev, ...msgs.map(m => ({ ...m, id: ++seq.current }))])

  function openTopic(topic) {
    push({ role: 'user', content: topic.label }, { role: 'bot', content: topic.reply() })
  }

  function send() {
    const text = input.trim()
    if (!text) return
    push({ role: 'user', content: text })
    setInput('')
    const topic = matchTopic(text)
    timers.current.push(setTimeout(() => {
      push({ role: 'bot', content: topic ? topic.reply() : FALLBACK })
    }, 300))
  }

  function startResize(e) {
    e.preventDefault()
    const startX = e.clientX
    const startW = panelRef.current.getBoundingClientRect().width
    let latest = startW
    setResizing(true)
    onResizingChange(true)
    function onMove(ev) {
      latest = Math.max(MIN_W, Math.min(MAX_W, startW + (startX - ev.clientX)))
      onResize(latest)
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setResizing(false)
      onResizingChange(false)
      try { localStorage.setItem(WIDTH_KEY, String(parseInt(latest, 10))) } catch { /* bỏ qua */ }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <>
      {/* Bản HTML: nút tròn chỉ mở panel (không đóng) */}
      <button className="it-ai-fab" title="Trợ lý AI Dezbot" onClick={onOpen}>
        <svg width="30" height="30" viewBox="0 0 24 24">
          <defs><linearGradient id="itDezbotGrad" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stopColor="#2FA3E6" /><stop offset="1" stopColor="#8B5CF6" /></linearGradient></defs>
          <path d="M4 12.5a8 8 0 0 1 16 0" fill="none" stroke="url(#itDezbotGrad)" strokeWidth="1.8" strokeLinecap="round" />
          <rect x="2" y="11.3" width="3.1" height="6.2" rx="1.55" fill="url(#itDezbotGrad)" />
          <rect x="18.9" y="11.3" width="3.1" height="6.2" rx="1.55" fill="url(#itDezbotGrad)" />
          <line x1="12" y1="4.6" x2="12" y2="7.6" stroke="url(#itDezbotGrad)" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="3.3" r="1.5" fill="url(#itDezbotGrad)" />
          <path d="M7.3 7.6h9.4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-4.1l-2.6 2.4v-2.4H7.3a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z" fill="url(#itDezbotGrad)" />
          <rect x="8.9" y="10.1" width="6.2" height="4.6" rx="1.3" fill="#fff" />
          <circle cx="10.55" cy="12.4" r="0.58" fill="url(#itDezbotGrad)" />
          <circle cx="13.45" cy="12.4" r="0.58" fill="url(#itDezbotGrad)" />
          <path d="M10.5 17.1a2.1 2.1 0 0 0 3 0" stroke="#fff" strokeWidth="0.9" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      <div ref={panelRef} className={`it-ai-panel${open ? ' open' : ''}${resizing ? ' resizing' : ''}`}>
        <div className="it-ai-resize" title="Kéo để thu hẹp / mở rộng" onMouseDown={startResize} />
        <div className="it-ai-head">
          <div className="it-ai-avatar"><MonitorIcon size={17} /></div>
          <h4>Dezbot</h4>
          <button className="it-ai-newchat" onClick={() => setMessages([])}>+ Trò chuyện mới</button>
          <button className="it-close-btn" onClick={onClose}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="it-ai-body" ref={bodyRef}>
          {messages.length === 0 ? (
            <div className="it-ai-welcome">
              <h2>Xin chào, <span className="muted">Trần Anh</span></h2>
              <p>Tôi là Dezbot — trợ lý AI cho bộ phận IT. Hỏi tôi về ticket hỗ trợ, thiết bị, hệ thống mạng hoặc uptime.</p>
              <div className="it-ai-topic-grid">
                {TOPICS.map(t => (
                  <button key={t.key} className={`it-ai-chip it-ai-topic-chip${t.wide ? ' wide' : ''}`} onClick={() => openTopic(t)}>{t.label}</button>
                ))}
                <BugChip className="it-ai-chip it-ai-topic-chip" onBefore={onClose} />
              </div>
            </div>
          ) : (
            <div className="it-ai-log">
              {messages.map(m => <div key={m.id} className={`it-ai-msg ${m.role}`}>{m.content}</div>)}
            </div>
          )}
        </div>
        <div className="it-ai-input-area">
          <textarea
            placeholder="Nhắn tin cho Dezbot..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          />
          <div className="it-ai-input-row">
            <span style={{ flex: 1 }} />
            <button className="it-ai-send" onClick={send}>Gửi</button>
          </div>
        </div>
      </div>
    </>
  )
}
