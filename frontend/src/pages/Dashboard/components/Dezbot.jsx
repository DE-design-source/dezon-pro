import { useEffect, useRef, useState } from 'react'
import { BugChip } from '../../../components/ui/BugReport'
import { AI_KB, AI_CHIPS, matchTopic } from '../../../data/dashboardData'

const MIN_W = 260
const MAX_W = 560
const WIDTH_KEY = 'siteflow-dashboard-chat-width'

function loadWidth() {
  try {
    const saved = parseInt(localStorage.getItem(WIDTH_KEY), 10)
    if (saved) return saved
  } catch { /* localStorage không khả dụng */ }
  return 320
}

/* Khung chat Dezbot nhúng ở cột phải Newsfeed — kéo mép trái để đổi độ rộng */
export default function Dezbot() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [width, setWidth] = useState(loadWidth)
  const [dragging, setDragging] = useState(false)
  const colRef = useRef(null)
  const logRef = useRef(null)
  const timers = useRef([])
  const seq = useRef(0)

  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [messages])

  function send(raw) {
    const text = (raw || '').trim()
    if (!text) return
    const userId = ++seq.current
    const botId = ++seq.current
    // Hiện câu hỏi + "Đang tra dữ liệu workspace…", sau 550ms thay bằng câu trả lời
    setMessages(prev => [...prev, { id: userId, role: 'user', text }, { id: botId, role: 'bot', text: 'Đang tra dữ liệu workspace…' }])
    setInput('')
    timers.current.push(setTimeout(() => {
      const answer = AI_KB[matchTopic(text)] || AI_KB.default
      setMessages(prev => prev.map(m => (m.id === botId ? { ...m, text: answer } : m)))
    }, 550))
  }

  function startResize(e) {
    e.preventDefault()
    const startX = e.clientX
    const startW = colRef.current.getBoundingClientRect().width
    setDragging(true)
    function onMove(ev) {
      setWidth(Math.max(MIN_W, Math.min(MAX_W, startW + (startX - ev.clientX))))
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setDragging(false)
      try { localStorage.setItem(WIDTH_KEY, String(Math.round(colRef.current.getBoundingClientRect().width))) } catch { /* bỏ qua */ }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div ref={colRef} className="db-chat-col" style={{ width }}>
      <div className={`db-resize-handle${dragging ? ' dragging' : ''}`} title="Kéo để thu hẹp / mở rộng" onMouseDown={startResize} />
      <div className="db-chat-card">
        <div className="db-chat-head">
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--surface-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            <svg width="20" height="20" viewBox="0 0 24 24">
              <defs><linearGradient id="dbDezbotGrad" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stopColor="#2FA3E6" /><stop offset="1" stopColor="#8B5CF6" /></linearGradient></defs>
              <path d="M4 12.5a8 8 0 0 1 16 0" fill="none" stroke="url(#dbDezbotGrad)" strokeWidth="1.8" strokeLinecap="round" />
              <rect x="2" y="11.3" width="3.1" height="6.2" rx="1.55" fill="url(#dbDezbotGrad)" />
              <rect x="18.9" y="11.3" width="3.1" height="6.2" rx="1.55" fill="url(#dbDezbotGrad)" />
              <line x1="12" y1="4.6" x2="12" y2="7.6" stroke="url(#dbDezbotGrad)" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="12" cy="3.3" r="1.5" fill="url(#dbDezbotGrad)" />
              <path d="M7.3 7.6h9.4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-4.1l-2.6 2.4v-2.4H7.3a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z" fill="url(#dbDezbotGrad)" />
              <rect x="8.9" y="10.1" width="6.2" height="4.6" rx="1.3" fill="var(--surface-alt)" />
              <circle cx="10.55" cy="12.4" r="0.58" fill="url(#dbDezbotGrad)" />
              <circle cx="13.45" cy="12.4" r="0.58" fill="url(#dbDezbotGrad)" />
              <path d="M10.5 17.1a2.1 2.1 0 0 0 3 0" stroke="var(--surface-alt)" strokeWidth="0.9" fill="none" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3>Dezbot</h3>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Trợ lý AI · hỏi dữ liệu hệ thống</div>
          </div>
          <button className="db-chat-newbtn" title="Hội thoại mới" onClick={() => setMessages([])}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </div>

        <div className="db-chat-log" ref={logRef}>
          {messages.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>Hỏi mình về tiến độ, chấm công, dòng tiền, khách hàng, bóc tách hay quy trình — mình đọc trực tiếp dữ liệu trong workspace.</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {AI_CHIPS.map(c => <button key={c.topic} className="db-embed-chip" onClick={() => send(c.question)}>{c.label}</button>)}
                <BugChip className="db-embed-chip" />
              </div>
            </div>
          )}
          {messages.map(m => <div key={m.id} className={`db-ai-msg ${m.role}`} style={{ maxWidth: '88%' }}>{m.text}</div>)}
        </div>

        <div className="db-chat-input-wrap">
          <div className="db-chat-input">
            <input
              type="text"
              placeholder="Hỏi Dezbot..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(input) } }}
            />
            <button className="db-chat-send" onClick={() => send(input)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
