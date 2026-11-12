import { useEffect, useRef, useState } from 'react'
import { BugChip } from '../../../components/ui/BugReport'
import { AI_KB, AI_TOPIC_LABELS, AI_SUGGESTIONS, matchTopic } from '../../../data/caiDatData'

const MIN_W = 320
const MAX_W = 720
/* mặc định rộng bằng cột trái QS trên màn hình (CATALOG_DEFAULT 440 x zoom .75 = 330); khoá _v2 bỏ độ rộng 440 cũ đã nhớ */
const WIDTH_KEY = 'siteflow-ai-panel-width-v2'

export function loadAiPanelWidth() {
  try {
    const saved = parseInt(localStorage.getItem(WIDTH_KEY), 10)
    if (saved) return saved
  } catch { /* localStorage không khả dụng */ }
  return 330
}

const svgProps = size => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })

/* Biểu tượng dùng trong chip chủ đề & nút công cụ (giữ nguyên path của HTML) */
const IconLines = ({ size }) => <svg {...svgProps(size)}><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="10" y2="18" /></svg>
const IconUsers = ({ size }) => <svg {...svgProps(size)}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
const IconCard = ({ size }) => <svg {...svgProps(size)}><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 10h20" /></svg>
const IconClients = ({ size }) => <svg {...svgProps(size)}><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><path d="M2 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><circle cx="8" cy="7" r="4" /></svg>
const IconChat = ({ size }) => <svg {...svgProps(size)}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
const IconFolder = ({ size }) => <svg {...svgProps(size)}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>

const TOPICS = [
  { key: 'tiendo', label: 'Tiến độ', Icon: IconLines },
  { key: 'chamcong', label: 'Chấm công', Icon: IconUsers },
  { key: 'dongtien', label: 'Dòng tiền', Icon: IconCard },
  { key: 'khachhang', label: 'Khách hàng', Icon: IconClients },
  { key: 'tinnhan', label: 'Tin nhắn', Icon: IconChat },
]

/* Trợ lý ảo Dezbot — nút tròn bật/tắt panel, kéo cạnh trái để đổi độ rộng */
export default function Dezbot({ open, onToggle, onClose, onResize, onResizingChange }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [resizing, setResizing] = useState(false)
  const inputRef = useRef(null)
  const bodyRef = useRef(null)
  const panelRef = useRef(null)
  const timers = useRef([])
  const seq = useRef(0)

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages])

  /* Gửi câu hỏi: hiện "Đang tra dữ liệu…" rồi thay bằng câu trả lời sau 550ms */
  function sendMessage(raw) {
    const text = (raw || '').trim()
    if (!text) return
    const userId = ++seq.current
    const botId = ++seq.current
    setMessages(prev => [...prev, { id: userId, role: 'user', text }, { id: botId, role: 'bot', text: 'Đang tra dữ liệu workspace…' }])
    setInput('')
    timers.current.push(setTimeout(() => {
      setMessages(prev => prev.map(m => m.id === botId ? { ...m, text: AI_KB[matchTopic(text)] || AI_KB.default } : m))
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
      <button className="cd-ai-fab" title="Trợ lý ảo Dezbot" onClick={onToggle}>
        <svg width="30" height="30" viewBox="0 0 24 24">
          <defs><linearGradient id="cdDezbotGrad" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stopColor="#2FA3E6" /><stop offset="1" stopColor="#8B5CF6" /></linearGradient></defs>
          <path d="M4 12.5a8 8 0 0 1 16 0" fill="none" stroke="url(#cdDezbotGrad)" strokeWidth="1.8" strokeLinecap="round" />
          <rect x="2" y="11.3" width="3.1" height="6.2" rx="1.55" fill="url(#cdDezbotGrad)" />
          <rect x="18.9" y="11.3" width="3.1" height="6.2" rx="1.55" fill="url(#cdDezbotGrad)" />
          <line x1="12" y1="4.6" x2="12" y2="7.6" stroke="url(#cdDezbotGrad)" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="3.3" r="1.5" fill="url(#cdDezbotGrad)" />
          <path d="M7.3 7.6h9.4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-4.1l-2.6 2.4v-2.4H7.3a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z" fill="url(#cdDezbotGrad)" />
          <rect x="8.9" y="10.1" width="6.2" height="4.6" rx="1.3" fill="#fff" />
          <circle cx="10.55" cy="12.4" r="0.58" fill="url(#cdDezbotGrad)" />
          <circle cx="13.45" cy="12.4" r="0.58" fill="url(#cdDezbotGrad)" />
          <path d="M10.5 17.1a2.1 2.1 0 0 0 3 0" stroke="#fff" strokeWidth="0.9" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      <div ref={panelRef} className={`cd-ai-panel${open ? ' open' : ''}${resizing ? ' resizing' : ''}`}>
        <div className="cd-ai-resize" title="Kéo để thu hẹp / mở rộng" onMouseDown={startResize} />
        <div className="cd-ai-head">
          <h4>Dezbot</h4>
          <button className="cd-ai-newchat" onClick={() => setMessages([])}>Hội thoại mới</button>
          <button className="cd-ai-close" onClick={onClose}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="cd-ai-body" ref={bodyRef}>
          {messages.length === 0 ? (
            <div className="cd-ai-welcome">
              <h2>Tôi có thể giúp gì,<br /><span className="muted">hôm nay?</span></h2>
              <p>Hỏi về tiến độ, nhân công, dòng tiền, khách hàng, bóc tách hay quy trình — trợ lý đọc trực tiếp dữ liệu trong workspace.</p>
              <div className="cd-ai-topic-grid">
                {TOPICS.map(({ key, label, Icon, wide }) => (
                  <div key={key} className={`cd-ai-topic-chip${wide ? ' wide' : ''}`}>
                    <button className="cd-ai-chip" onClick={() => sendMessage(AI_TOPIC_LABELS[key] || label)}><Icon size={14} />{label}</button>
                  </div>
                ))}
                <div className="cd-ai-topic-chip"><BugChip className="cd-ai-chip" onBefore={onClose} /></div>
              </div>
            </div>
          ) : (
            <div className="cd-ai-log">
              {messages.map(m => <div key={m.id} className={`cd-ai-msg ${m.role}`}>{m.text}</div>)}
            </div>
          )}
        </div>
        <div className="cd-ai-suggest-row">
          {AI_SUGGESTIONS.map(s => <button key={s} className="cd-ai-suggest-chip" onClick={() => sendMessage(s)}>{s}</button>)}
        </div>
        <div className="cd-ai-input-area">
          <textarea
            ref={inputRef}
            placeholder="Hỏi về tiến độ, chấm công, dòng tiền, khách hàng…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
          />
          <div className="cd-ai-input-row">
            <div className="cd-ai-tool-btn"><IconLines size={13} /></div>
            <div className="cd-ai-tool-btn"><IconFolder size={13} /></div>
            <div className="cd-ai-tool-btn"><IconUsers size={13} /></div>
            <button className="cd-ai-send" onClick={() => sendMessage(input)}>Gửi</button>
          </div>
        </div>
      </div>
    </>
  )
}
