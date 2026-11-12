import { useEffect, useRef, useState } from 'react'
import { BugChip } from '../../../components/ui/BugReport'
import { PROJECTS, IDEAS, isActiveProject } from '../../../data/rdData'

const MIN_W = 320
const MAX_W = 720
/* mặc định rộng bằng cột trái QS trên màn hình (CATALOG_DEFAULT 440 x zoom .75 = 330); khoá _v2 bỏ độ rộng 440 cũ đã nhớ */
const WIDTH_KEY = 'siteflow-ai-panel-width-v2'
const FALLBACK = 'Tôi có thể hỗ trợ thông tin về dự án nghiên cứu, ý tưởng & đề xuất, ngân sách R&D và bằng sáng chế. Bạn thử hỏi lại theo các chủ đề này nhé.'

export function loadAiPanelWidth() {
  try {
    const saved = parseInt(localStorage.getItem(WIDTH_KEY), 10)
    if (saved) return saved
  } catch { /* localStorage không khả dụng */ }
  return 330
}

/* Các chủ đề của Dezbot bộ phận R&D (giống AI_TOPICS trong rd.html) */
const TOPICS = [
  {
    key: 'duan', label: 'Dự án nghiên cứu', keywords: ['dự án', 'nghiên cứu', 'giai đoạn'],
    reply: () => {
      const active = PROJECTS.filter(isActiveProject).length
      const pilot = PROJECTS.filter(p => p.stage === 'trienkhai').map(p => p.name).join(', ')
      return <>Hiện có <strong>{active}</strong> dự án R&amp;D đang triển khai trên tổng {PROJECTS.length} dự án. Các dự án đang ở giai đoạn triển khai thí điểm gồm: {pilot}.</>
    },
  },
  {
    key: 'ytuong', label: 'Ý tưởng & đề xuất', keywords: ['ý tưởng', 'đề xuất', 'sáng kiến'],
    reply: () => {
      const pending = IDEAS.filter(i => i.status === 'xet').length
      return <>Có <strong>{IDEAS.length}</strong> ý tưởng được gửi lên gần đây, trong đó <strong>{pending}</strong> ý tưởng đang chờ xét duyệt.</>
    },
  },
  {
    key: 'nganSach', label: 'Ngân sách R&D', keywords: ['ngân sách', 'chi phí', 'kinh phí'],
    reply: () => <>Ngân sách R&amp;D năm 2026 là 3.9 tỷ đồng, đã sử dụng khoảng <strong>62%</strong> (2.4 tỷ đồng) cho các dự án vật liệu và công nghệ thi công.</>,
  },
  {
    key: 'bangSangChe', label: 'Bằng sáng chế', keywords: ['bằng sáng chế', 'tiêu chuẩn', 'sở hữu trí tuệ'],
    reply: () => <>Đang theo đuổi <strong>3</strong> hồ sơ bằng sáng chế / tiêu chuẩn kỹ thuật, hiện đang trong giai đoạn thẩm định.</>,
  },
  {
    key: 'tiendo', label: 'Dự án sắp hoàn thành', keywords: ['sắp hoàn thành', 'tiến độ cao', 'gần xong'], wide: true,
    reply: () => {
      const near = PROJECTS.filter(p => isActiveProject(p) && p.progress >= 70)
      if (!near.length) return 'Hiện chưa có dự án nào đạt tiến độ trên 70% ngoài các dự án đã hoàn thành.'
      return `Các dự án gần hoàn thành: ${near.map(p => `${p.name} (${p.progress}%)`).join(', ')}.`
    },
  },
]
const matchTopic = text => TOPICS.find(t => t.keywords.some(kw => text.toLowerCase().includes(kw))) || null

const BulbIcon = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2.05V17h6v-.25c0-.85.4-1.55 1-2.05A7 7 0 0 0 12 2z" /></svg>
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
      <button className="rd-ai-fab" title="Trợ lý AI Dezbot" onClick={onOpen}>
        <svg width="30" height="30" viewBox="0 0 24 24">
          <defs><linearGradient id="rdDezbotGrad" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stopColor="#2FA3E6" /><stop offset="1" stopColor="#8B5CF6" /></linearGradient></defs>
          <path d="M4 12.5a8 8 0 0 1 16 0" fill="none" stroke="url(#rdDezbotGrad)" strokeWidth="1.8" strokeLinecap="round" />
          <rect x="2" y="11.3" width="3.1" height="6.2" rx="1.55" fill="url(#rdDezbotGrad)" />
          <rect x="18.9" y="11.3" width="3.1" height="6.2" rx="1.55" fill="url(#rdDezbotGrad)" />
          <line x1="12" y1="4.6" x2="12" y2="7.6" stroke="url(#rdDezbotGrad)" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="3.3" r="1.5" fill="url(#rdDezbotGrad)" />
          <path d="M7.3 7.6h9.4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-4.1l-2.6 2.4v-2.4H7.3a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z" fill="url(#rdDezbotGrad)" />
          <rect x="8.9" y="10.1" width="6.2" height="4.6" rx="1.3" fill="#fff" />
          <circle cx="10.55" cy="12.4" r="0.58" fill="url(#rdDezbotGrad)" />
          <circle cx="13.45" cy="12.4" r="0.58" fill="url(#rdDezbotGrad)" />
          <path d="M10.5 17.1a2.1 2.1 0 0 0 3 0" stroke="#fff" strokeWidth="0.9" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      <div ref={panelRef} className={`rd-ai-panel${open ? ' open' : ''}${resizing ? ' resizing' : ''}`}>
        <div className="rd-ai-resize" title="Kéo để thu hẹp / mở rộng" onMouseDown={startResize} />
        <div className="rd-ai-head">
          <div className="rd-ai-avatar"><BulbIcon size={17} /></div>
          <h4>Dezbot</h4>
          <button className="rd-ai-newchat" onClick={() => setMessages([])}>+ Trò chuyện mới</button>
          <button className="rd-close-btn" onClick={onClose}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="rd-ai-body" ref={bodyRef}>
          {messages.length === 0 ? (
            <div className="rd-ai-welcome">
              <h2>Xin chào, <span className="muted">Trần Anh</span></h2>
              <p>Tôi là Dezbot — trợ lý AI cho bộ phận R&amp;D. Hỏi tôi về dự án nghiên cứu, ý tưởng cải tiến hoặc ngân sách.</p>
              <div className="rd-ai-topic-grid">
                {TOPICS.map(t => (
                  <button key={t.key} className={`rd-ai-chip rd-ai-topic-chip${t.wide ? ' wide' : ''}`} onClick={() => openTopic(t)}>{t.label}</button>
                ))}
                <BugChip className="rd-ai-chip rd-ai-topic-chip" onBefore={onClose} />
              </div>
            </div>
          ) : (
            <div className="rd-ai-log">
              {messages.map(m => <div key={m.id} className={`rd-ai-msg ${m.role}`}>{m.content}</div>)}
            </div>
          )}
        </div>
        <div className="rd-ai-input-area">
          <textarea
            placeholder="Nhắn tin cho Dezbot..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          />
          <div className="rd-ai-input-row">
            <span style={{ flex: 1 }} />
            <button className="rd-ai-send" onClick={send}>Gửi</button>
          </div>
        </div>
      </div>
    </>
  )
}
