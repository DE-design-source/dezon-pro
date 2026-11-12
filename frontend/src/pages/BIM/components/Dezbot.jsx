import { useEffect, useRef, useState } from 'react'
import { BugChip } from '../../../components/ui/BugReport'
import { AI_TOPICS, matchTopic } from '../../../data/bimData'

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

/* Dezbot bản BIM: không có hàng gợi ý / nút công cụ, câu trả lời đọc dữ liệu model qua `answer(topic)` */
export default function Dezbot({ open, onToggle, onClose, onResize, onResizingChange, answer }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [resizing, setResizing] = useState(false)
  const inputRef = useRef(null)
  const bodyRef = useRef(null)
  const panelRef = useRef(null)
  const timers = useRef([])
  const seq = useRef(0)
  const answerRef = useRef(answer)
  answerRef.current = answer

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight }, [messages])

  function sendMessage(raw) {
    const text = (raw || '').trim()
    if (!text) return
    const userId = ++seq.current
    const botId = ++seq.current
    setMessages(prev => [...prev, { id: userId, role: 'user', text }, { id: botId, role: 'bot', text: 'Đang tra dữ liệu model…' }])
    setInput('')
    timers.current.push(setTimeout(() => {
      // Đọc dữ liệu tại thời điểm trả lời, giống bản HTML
      const reply = answerRef.current(matchTopic(text))
      setMessages(prev => prev.map(m => m.id === botId ? { ...m, text: reply } : m))
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
      <button className="bim-ai-fab" title="Trợ lý ảo Dezbot" onClick={onToggle}>
        <svg width="30" height="30" viewBox="0 0 24 24">
          <defs><linearGradient id="bimDezbotGrad" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stopColor="#2FA3E6" /><stop offset="1" stopColor="#8B5CF6" /></linearGradient></defs>
          <path d="M4 12.5a8 8 0 0 1 16 0" fill="none" stroke="url(#bimDezbotGrad)" strokeWidth="1.8" strokeLinecap="round" />
          <rect x="2" y="11.3" width="3.1" height="6.2" rx="1.55" fill="url(#bimDezbotGrad)" />
          <rect x="18.9" y="11.3" width="3.1" height="6.2" rx="1.55" fill="url(#bimDezbotGrad)" />
          <line x1="12" y1="4.6" x2="12" y2="7.6" stroke="url(#bimDezbotGrad)" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="3.3" r="1.5" fill="url(#bimDezbotGrad)" />
          <path d="M7.3 7.6h9.4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-4.1l-2.6 2.4v-2.4H7.3a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z" fill="url(#bimDezbotGrad)" />
          <rect x="8.9" y="10.1" width="6.2" height="4.6" rx="1.3" fill="#fff" />
          <circle cx="10.55" cy="12.4" r="0.58" fill="url(#bimDezbotGrad)" />
          <circle cx="13.45" cy="12.4" r="0.58" fill="url(#bimDezbotGrad)" />
          <path d="M10.5 17.1a2.1 2.1 0 0 0 3 0" stroke="#fff" strokeWidth="0.9" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      <div ref={panelRef} className={`bim-ai-panel${open ? ' open' : ''}${resizing ? ' resizing' : ''}`}>
        <div className="bim-ai-resize" title="Kéo để thu hẹp / mở rộng" onMouseDown={startResize} />
        <div className="bim-ai-head">
          <h4>Dezbot</h4>
          <button className="bim-ai-newchat" onClick={() => setMessages([])}>Hội thoại mới</button>
          <button className="bim-ai-close" onClick={onClose}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="bim-ai-body" ref={bodyRef}>
          {messages.length === 0 ? (
            <div className="bim-ai-welcome">
              <h2>Hỏi Dezbot về<br /><span className="muted">dữ liệu BIM?</span></h2>
              <p>Hỏi về object, level, room/space, vật liệu, filter hay BOQ — Dezbot đọc trực tiếp dữ liệu model đã liên kết.</p>
              <div className="bim-ai-topic-grid">
                {AI_TOPICS.map(t => (
                  <div key={t.key} className={`bim-ai-topic-chip${t.wide ? ' wide' : ''}`}>
                    <button className="bim-ai-chip" onClick={() => sendMessage(t.prompt)}>{t.label}</button>
                  </div>
                ))}
                <div className="bim-ai-topic-chip"><BugChip className="bim-ai-chip" onBefore={onClose} /></div>
              </div>
            </div>
          ) : (
            <div className="bim-ai-log">
              {messages.map(m => <div key={m.id} className={`bim-ai-msg ${m.role}`}>{m.text}</div>)}
            </div>
          )}
        </div>
        <div className="bim-ai-input-area">
          <textarea
            ref={inputRef}
            placeholder="Hỏi về object, level, vật liệu, BOQ…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
          />
          <div className="bim-ai-input-row">
            <span style={{ flex: 1 }} />
            <button className="bim-ai-send" onClick={() => sendMessage(input)}>Gửi</button>
          </div>
        </div>
      </div>
    </>
  )
}
