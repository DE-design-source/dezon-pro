import { useEffect, useRef, useState } from 'react'
import { BugChip } from '../../../components/ui/BugReport'
import { AI_KB, AI_TOPIC_LABELS, AI_SUGGESTS } from '../../../data/chatData'

const MIN_W = 320
const MAX_W = 720
/* mặc định rộng bằng cột trái QS trên màn hình (CATALOG_DEFAULT 440 x zoom .75 = 330); khoá _v2 bỏ độ rộng 440 cũ đã nhớ */
const WIDTH_KEY = 'siteflow-ai-panel-width-v2'
const THINKING = 'Đang tra dữ liệu workspace…'

export function loadAiPanelWidth() {
  try {
    const saved = parseInt(localStorage.getItem(WIDTH_KEY), 10)
    if (saved) return saved
  } catch { /* localStorage không khả dụng */ }
  return 330
}

/* matchTopic() trong chat.html */
function matchTopic(text) {
  const t = text.toLowerCase()
  const has = s => t.indexOf(s) > -1
  if (has('tiến độ') || has('tien do') || has('dự án')) return 'tiendo'
  if (has('chấm công') || has('nhân công') || has('nhân sự') || has('nghỉ phép')) return 'chamcong'
  if (has('dòng tiền') || has('hoá đơn') || has('hóa đơn') || has('thu') || has('chi')) return 'dongtien'
  if (has('khách hàng') || has('hợp đồng')) return 'khachhang'
  if (has('tin nhắn') || has('chat') || has('cảnh báo') || has('hội thoại')) return 'tinnhan'
  if (has('bóc tách') || has('mua hàng') || has('vật tư')) return 'boctach'
  if (has('quy trình')) return 'quytrinh'
  return 'default'
}

const iconProps = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
const toolIconProps = { ...iconProps, width: 13, height: 13 }

/* Các chủ đề ở màn hình chào (data-ai-topic trong chat.html) */
const TOPICS = [
  { key: 'tiendo', label: 'Tiến độ', icon: <svg {...iconProps}><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="10" y2="18" /></svg> },
  { key: 'chamcong', label: 'Chấm công', icon: <svg {...iconProps}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg> },
  { key: 'dongtien', label: 'Dòng tiền', icon: <svg {...iconProps}><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 10h20" /></svg> },
  { key: 'khachhang', label: 'Khách hàng', icon: <svg {...iconProps}><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><path d="M2 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><circle cx="8" cy="7" r="4" /></svg> },
  { key: 'tinnhan', label: 'Tin nhắn', icon: <svg {...iconProps}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg> },
]

/* Trợ lý ảo Dezbot: nút tròn + panel trượt bên phải (kéo đổi độ rộng) */
export default function Dezbot({ open, onToggle, onClose, onResize, onResizingChange }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [resizing, setResizing] = useState(false)
  const bodyRef = useRef(null)
  const panelRef = useRef(null)
  const inputRef = useRef(null)
  const timers = useRef([])
  const seq = useRef(0)

  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight }, [messages])
  /* Bản HTML: mở panel thì focus ô nhập */
  useEffect(() => { if (open && inputRef.current) inputRef.current.focus() }, [open])

  function sendAiMessage(raw) {
    const text = (raw || '').trim()
    if (!text) return
    const userId = ++seq.current
    const botId = ++seq.current
    setMessages(prev => [...prev, { id: userId, role: 'user', text }, { id: botId, role: 'bot', text: THINKING }])
    setInput('')
    /* Sau 550ms thay dòng "đang tra…" bằng câu trả lời mẫu */
    timers.current.push(setTimeout(() => {
      const answer = AI_KB[matchTopic(text)] || AI_KB.default
      setMessages(prev => prev.map(m => (m.id === botId ? { ...m, text: answer } : m)))
    }, 550))
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
      {/* Bản HTML: nút tròn bật/tắt panel */}
      <button className="ch-ai-fab" title="Trợ lý ảo Dezbot" onClick={onToggle}>
        <svg width="30" height="30" viewBox="0 0 24 24">
          <defs><linearGradient id="chDezbotGrad" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stopColor="#2FA3E6" /><stop offset="1" stopColor="#8B5CF6" /></linearGradient></defs>
          <path d="M4 12.5a8 8 0 0 1 16 0" fill="none" stroke="url(#chDezbotGrad)" strokeWidth="1.8" strokeLinecap="round" />
          <rect x="2" y="11.3" width="3.1" height="6.2" rx="1.55" fill="url(#chDezbotGrad)" />
          <rect x="18.9" y="11.3" width="3.1" height="6.2" rx="1.55" fill="url(#chDezbotGrad)" />
          <line x1="12" y1="4.6" x2="12" y2="7.6" stroke="url(#chDezbotGrad)" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="3.3" r="1.5" fill="url(#chDezbotGrad)" />
          <path d="M7.3 7.6h9.4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-4.1l-2.6 2.4v-2.4H7.3a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z" fill="url(#chDezbotGrad)" />
          <rect x="8.9" y="10.1" width="6.2" height="4.6" rx="1.3" fill="#fff" />
          <circle cx="10.55" cy="12.4" r="0.58" fill="url(#chDezbotGrad)" />
          <circle cx="13.45" cy="12.4" r="0.58" fill="url(#chDezbotGrad)" />
          <path d="M10.5 17.1a2.1 2.1 0 0 0 3 0" stroke="#fff" strokeWidth="0.9" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      <div ref={panelRef} className={`ch-ai-panel${open ? ' open' : ''}${resizing ? ' resizing' : ''}`}>
        <div className="ch-ai-resize-handle" title="Kéo để thu hẹp / mở rộng" onMouseDown={startResize} />
        <div className="ch-ai-panel-head">
          <h4>Dezbot</h4>
          <button className="ch-ai-newchat-btn" onClick={() => setMessages([])}>Hội thoại mới</button>
          <button className="ch-ai-close-btn" onClick={onClose}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="ch-ai-panel-body" ref={bodyRef}>
          {messages.length === 0 && (
            <div className="ch-ai-welcome">
              <h2>Tôi có thể giúp gì,<br /><span className="ch-muted">hôm nay?</span></h2>
              <p>Hỏi về tiến độ, nhân công, dòng tiền, khách hàng, bóc tách hay quy trình — trợ lý đọc trực tiếp dữ liệu trong workspace.</p>
              <div className="ch-ai-topic-grid">
                {TOPICS.map(t => (
                  <div key={t.key} className={`ch-ai-topic-chip${t.wide ? ' wide' : ''}`}>
                    <button className="ch-ai-chip" onClick={() => sendAiMessage(AI_TOPIC_LABELS[t.key] || t.label)}>{t.icon}{t.label}</button>
                  </div>
                ))}
                <div className="ch-ai-topic-chip"><BugChip className="ch-ai-chip" onBefore={onClose} /></div>
              </div>
            </div>
          )}
          <div className={`ch-ai-log${messages.length ? ' open' : ''}`}>
            {messages.map(m => <div key={m.id} className={`ch-ai-msg ${m.role}`}>{m.text}</div>)}
          </div>
        </div>
        <div className="ch-ai-suggest-row">
          {AI_SUGGESTS.map(s => <button key={s} className="ch-ai-suggest-chip" onClick={() => sendAiMessage(s)}>{s}</button>)}
        </div>
        <div className="ch-ai-input-area">
          <textarea
            ref={inputRef}
            placeholder="Hỏi về tiến độ, chấm công, dòng tiền, khách hàng…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiMessage(input) } }}
          />
          <div className="ch-ai-input-row">
            <div className="ch-ai-tool-btn"><svg {...toolIconProps}><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="10" y2="18" /></svg></div>
            <div className="ch-ai-tool-btn"><svg {...toolIconProps}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg></div>
            <div className="ch-ai-tool-btn"><svg {...toolIconProps}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg></div>
            <button className="ch-ai-send-btn" onClick={() => sendAiMessage(input)}>Gửi</button>
          </div>
        </div>
      </div>
    </>
  )
}
