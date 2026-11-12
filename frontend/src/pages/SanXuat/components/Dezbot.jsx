import { useEffect, useRef, useState } from 'react'
import { BugChip } from '../../../components/ui/BugReport'
import { WORKERS, EQUIPMENT, materialStatus } from '../../../data/sanXuatData'

const MIN_W = 320
const MAX_W = 720
/* mặc định rộng bằng cột trái QS trên màn hình (CATALOG_DEFAULT 440 x zoom .75 = 330); khoá _v2 bỏ độ rộng 440 cũ đã nhớ */
const WIDTH_KEY = 'siteflow-ai-panel-width-v2'
const FALLBACK = 'Tôi có thể hỗ trợ thông tin về đơn sản xuất, kho vật tư, nhân công, máy móc và tiến độ hôm nay. Bạn thử hỏi lại theo các chủ đề này nhé.'

export function loadAiPanelWidth() {
  try {
    const saved = parseInt(localStorage.getItem(WIDTH_KEY), 10)
    if (saved) return saved
  } catch { /* localStorage không khả dụng */ }
  return 330
}

/* Các chủ đề của Dezbot xưởng mộc — câu trả lời đọc dữ liệu hiện tại của trang */
const TOPICS = [
  {
    key: 'donsx', label: 'Đơn sản xuất', keywords: ['đơn sản xuất', 'đơn hàng', 'sx-', 'trễ tiến độ', 'đơn nào'],
    reply: ({ orders }) => {
      const active = orders.filter(o => o.stage !== 'hoanThanh').length
      const late = orders.filter(o => o.late)
      return <>Xưởng hiện có <strong>{active}</strong> đơn đang sản xuất trên tổng {orders.length} đơn. {late.length
        ? <>Có <strong>{late.length}</strong> đơn trễ tiến độ: {late.map(o => `${o.code} (${o.name})`).join(', ')}.</>
        : 'Không có đơn nào đang trễ tiến độ.'}</>
    },
  },
  {
    key: 'vattu', label: 'Kho vật tư', keywords: ['vật tư', 'kho', 'nguyên liệu', 'tồn kho', 'gỗ', 'sơn'],
    reply: ({ materials }) => {
      const low = materials.filter(m => materialStatus(m) === 'low')
      return <>Kho vật tư hiện có <strong>{materials.length}</strong> mặt hàng. {low.length
        ? `Sắp hết: ${low.map(m => m.name).join(', ')}. Bạn có thể dùng nút Nhập kho để bổ sung.`
        : 'Tất cả vật tư đều đủ định mức tối thiểu.'}</>
    },
  },
  {
    key: 'nhancong', label: 'Nhân công', keywords: ['nhân công', 'thợ', 'nhân sự', 'tổ sản xuất'],
    reply: () => {
      const working = WORKERS.filter(w => w.status === 'working').length
      return <>Xưởng có <strong>{WORKERS.length}</strong> thợ, trong đó <strong>{working}</strong> người đang có việc. Năng suất trung bình khoảng 5 sản phẩm/thợ/tháng.</>
    },
  },
  {
    key: 'maymoc', label: 'Máy móc', keywords: ['máy móc', 'máy', 'bảo trì', 'hỏng'],
    reply: () => {
      const broken = EQUIPMENT.filter(e => e.status === 'broken')
      const maint = EQUIPMENT.filter(e => e.status === 'maintenance')
      return <>Xưởng có <strong>{EQUIPMENT.length}</strong> máy. {broken.length > 0 && `${broken.map(e => e.name).join(', ')} đang hỏng, cần kỹ thuật viên xử lý gấp. `}
        {maint.length > 0 && `${maint.map(e => e.name).join(', ')} đang bảo trì định kỳ. `}
        {!broken.length && !maint.length && 'Tất cả máy đều hoạt động tốt.'}</>
    },
  },
  {
    key: 'tiendo', label: 'Tiến độ hôm nay', keywords: ['tiến độ hôm nay', 'ưu tiên', 'hôm nay', 'cần làm gấp'], wide: true,
    reply: ({ orders }) => {
      const prio = orders.filter(o => o.priority === 'high' && o.stage !== 'hoanThanh')
      if (!prio.length) return 'Hôm nay không có đơn ưu tiên cao nào cần xử lý gấp.'
      return `Các đơn ưu tiên cao cần chú ý hôm nay: ${prio.map(o => `${o.code} — ${o.name}`).join('; ')}.`
    },
  },
]
const matchTopic = text => TOPICS.find(t => t.keywords.some(kw => text.toLowerCase().includes(kw))) || null

const WrenchIcon = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>
)

export default function Dezbot({ open, onOpen, onClose, onResize, onResizingChange, data }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [resizing, setResizing] = useState(false)
  const bodyRef = useRef(null)
  const panelRef = useRef(null)
  const timers = useRef([])
  const seq = useRef(0)
  const dataRef = useRef(data)
  dataRef.current = data

  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight }, [messages])

  const push = (...msgs) => setMessages(prev => [...prev, ...msgs.map(m => ({ ...m, id: ++seq.current }))])

  function openTopic(topic) {
    push({ role: 'user', content: topic.label }, { role: 'bot', content: topic.reply(dataRef.current) })
  }

  function send() {
    const text = input.trim()
    if (!text) return
    push({ role: 'user', content: text })
    setInput('')
    const topic = matchTopic(text)
    timers.current.push(setTimeout(() => {
      push({ role: 'bot', content: topic ? topic.reply(dataRef.current) : FALLBACK })
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
      <button className="sx-ai-fab" title="Trợ lý AI Dezbot" onClick={onOpen}>
        <svg width="30" height="30" viewBox="0 0 24 24">
          <defs><linearGradient id="sxDezbotGrad" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stopColor="#2FA3E6" /><stop offset="1" stopColor="#8B5CF6" /></linearGradient></defs>
          <path d="M4 12.5a8 8 0 0 1 16 0" fill="none" stroke="url(#sxDezbotGrad)" strokeWidth="1.8" strokeLinecap="round" />
          <rect x="2" y="11.3" width="3.1" height="6.2" rx="1.55" fill="url(#sxDezbotGrad)" />
          <rect x="18.9" y="11.3" width="3.1" height="6.2" rx="1.55" fill="url(#sxDezbotGrad)" />
          <line x1="12" y1="4.6" x2="12" y2="7.6" stroke="url(#sxDezbotGrad)" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="3.3" r="1.5" fill="url(#sxDezbotGrad)" />
          <path d="M7.3 7.6h9.4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-4.1l-2.6 2.4v-2.4H7.3a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z" fill="url(#sxDezbotGrad)" />
          <rect x="8.9" y="10.1" width="6.2" height="4.6" rx="1.3" fill="#fff" />
          <circle cx="10.55" cy="12.4" r="0.58" fill="url(#sxDezbotGrad)" />
          <circle cx="13.45" cy="12.4" r="0.58" fill="url(#sxDezbotGrad)" />
          <path d="M10.5 17.1a2.1 2.1 0 0 0 3 0" stroke="#fff" strokeWidth="0.9" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      <div ref={panelRef} className={`sx-ai-panel${open ? ' open' : ''}${resizing ? ' resizing' : ''}`}>
        <div className="sx-ai-resize" title="Kéo để thu hẹp / mở rộng" onMouseDown={startResize} />
        <div className="sx-ai-head">
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--wood-tint)', color: 'var(--wood)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            <WrenchIcon size={17} />
          </div>
          <h4>Dezbot</h4>
          <button className="sx-ai-newchat" onClick={() => setMessages([])}>+ Trò chuyện mới</button>
          <button className="sx-close-btn" onClick={onClose}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="sx-ai-body" ref={bodyRef}>
          {messages.length === 0 ? (
            <div className="sx-ai-welcome">
              <h2>Xin chào, <span className="muted">Trần Anh</span></h2>
              <p>Tôi là Dezbot — trợ lý AI cho xưởng sản xuất. Hỏi tôi về đơn hàng, vật tư, nhân công hoặc máy móc.</p>
              <div className="sx-ai-topic-grid">
                {TOPICS.map(t => (
                  <button key={t.key} className={`sx-ai-chip sx-ai-topic-chip${t.wide ? ' wide' : ''}`} onClick={() => openTopic(t)}>{t.label}</button>
                ))}
                <BugChip className="sx-ai-chip sx-ai-topic-chip" onBefore={onClose} />
              </div>
            </div>
          ) : (
            <div className="sx-ai-log">
              {messages.map(m => <div key={m.id} className={`sx-ai-msg ${m.role}`}>{m.content}</div>)}
            </div>
          )}
        </div>
        <div className="sx-ai-input-area">
          <textarea
            placeholder="Nhắn tin cho Dezbot..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          />
          <div className="sx-ai-input-row">
            <span style={{ flex: 1 }} />
            <button className="sx-ai-send" onClick={send}>Gửi</button>
          </div>
        </div>
      </div>
    </>
  )
}
