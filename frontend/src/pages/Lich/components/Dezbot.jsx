import { useEffect, useRef, useState } from 'react'
import { BugChip } from '../../../components/ui/BugReport'

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

/* Câu trả lời mẫu (giống AI_KB trong lich.html) */
const AI_KB = {
  tiendo: 'Dự án "Chung cư Riverside GĐ2" đang hoàn thành 62% khối lượng — đúng tiến độ tổng thể. Hạng mục "Hoàn thiện" có 2 đầu việc đang trễ hạn, cần ưu tiên xử lý trong tuần này.',
  chamcong: 'Hôm nay có 18/21 nhân sự đã chấm công đúng giờ, 2 người chấm công trễ và 1 người xin nghỉ phép. Tỷ lệ chuyên cần tuần này đạt 94%.',
  dongtien: 'Dòng tiền tháng này: Thu về 1.85 tỷ, Chi ra 1.42 tỷ — dương 430 triệu. Có 3 hoá đơn nhà cung cấp sắp đến hạn thanh toán trong 7 ngày tới.',
  khachhang: 'Hiện có 12 khách hàng đang trong giai đoạn đàm phán, 4 khách vừa ký hợp đồng trong tuần này. Cơ hội "Nhà phố Lô B12" có giá trị lớn nhất, đang chờ chốt hợp đồng.',
  tinnhan: 'Bạn có 6 tin nhắn chưa đọc trong Chat, tập trung ở nhóm "Dự án Riverside" và "Ban giám đốc". Muốn mình tóm tắt nội dung chính không?',
  boctach: 'Bóc tách khối lượng mới nhất từ QS ghi nhận tổng giá trị vật tư khoảng 11.93 triệu trên 5 đơn mua hàng, trong đó 2 đơn chưa đặt hàng.',
  quytrinh: 'Quy trình thi công hiện tại gồm 5 bước: Khảo sát → Thiết kế → Xin phép → Thi công → Nghiệm thu. Bước "Thi công" đang được nhiều dự án thực hiện nhất.',
  lich: 'Tuần này (20 - 26/9) bạn có 12 sự kiện, đông nhất vào thứ 4 với 5 cuộc họp liên tiếp buổi sáng và chiều. Không có cuộc họp nào bị trùng giờ.',
  default: 'Mình đã tra trong dữ liệu workspace nhưng chưa tìm thấy câu trả lời chính xác cho câu hỏi này — bạn thử hỏi cụ thể hơn về tiến độ, chấm công, dòng tiền, khách hàng, lịch họp, bóc tách hoặc quy trình nhé.',
}

function matchTopic(text) {
  const t = text.toLowerCase()
  const has = s => t.indexOf(s) > -1
  if (has('lịch') || has('cuộc họp') || has('trùng giờ')) return 'lich'
  if (has('tiến độ') || has('tien do') || has('dự án')) return 'tiendo'
  if (has('chấm công') || has('nhân công') || has('nhân sự') || has('nghỉ phép')) return 'chamcong'
  if (has('dòng tiền') || has('hoá đơn') || has('hóa đơn') || has('thu') || has('chi')) return 'dongtien'
  if (has('khách hàng') || has('hợp đồng')) return 'khachhang'
  if (has('tin nhắn') || has('chat')) return 'tinnhan'
  if (has('bóc tách') || has('mua hàng') || has('vật tư')) return 'boctach'
  if (has('quy trình')) return 'quytrinh'
  return 'default'
}

const iconProps = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
const toolIconProps = { ...iconProps, width: 13, height: 13 }

/* Các chủ đề ở màn hình chào (giống data-ai-topic trong lich.html) */
const TOPICS = [
  { key: 'tiendo', label: 'Tiến độ', prompt: 'Tiến độ dự án đang thế nào?', icon: <svg {...iconProps}><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="10" y2="18" /></svg> },
  { key: 'chamcong', label: 'Chấm công', prompt: 'Tình hình chấm công hôm nay?', icon: <svg {...iconProps}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg> },
  { key: 'dongtien', label: 'Dòng tiền', prompt: 'Dòng tiền tháng này ra sao?', icon: <svg {...iconProps}><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 10h20" /></svg> },
  { key: 'khachhang', label: 'Khách hàng', prompt: 'Khách hàng nào đang tiềm năng?', icon: <svg {...iconProps}><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><path d="M2 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><circle cx="8" cy="7" r="4" /></svg> },
  { key: 'tinnhan', label: 'Tin nhắn', prompt: 'Tôi có tin nhắn nào chưa đọc?', icon: <svg {...iconProps}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg> },
]

const SUGGESTS = ['Hôm nay tôi có lịch gì?', 'Tuần này có cuộc họp nào trùng giờ không?', 'Tóm tắt tình hình dự án hôm nay']

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
      <button className="lc-ai-fab" title="Trợ lý ảo Dezbot" onClick={onToggle}>
        <svg width="30" height="30" viewBox="0 0 24 24">
          <defs><linearGradient id="lcDezbotGrad" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stopColor="#2FA3E6" /><stop offset="1" stopColor="#8B5CF6" /></linearGradient></defs>
          <path d="M4 12.5a8 8 0 0 1 16 0" fill="none" stroke="url(#lcDezbotGrad)" strokeWidth="1.8" strokeLinecap="round" />
          <rect x="2" y="11.3" width="3.1" height="6.2" rx="1.55" fill="url(#lcDezbotGrad)" />
          <rect x="18.9" y="11.3" width="3.1" height="6.2" rx="1.55" fill="url(#lcDezbotGrad)" />
          <line x1="12" y1="4.6" x2="12" y2="7.6" stroke="url(#lcDezbotGrad)" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="3.3" r="1.5" fill="url(#lcDezbotGrad)" />
          <path d="M7.3 7.6h9.4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-4.1l-2.6 2.4v-2.4H7.3a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z" fill="url(#lcDezbotGrad)" />
          <rect x="8.9" y="10.1" width="6.2" height="4.6" rx="1.3" fill="#fff" />
          <circle cx="10.55" cy="12.4" r="0.58" fill="url(#lcDezbotGrad)" />
          <circle cx="13.45" cy="12.4" r="0.58" fill="url(#lcDezbotGrad)" />
          <path d="M10.5 17.1a2.1 2.1 0 0 0 3 0" stroke="#fff" strokeWidth="0.9" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      <div ref={panelRef} className={`lc-ai-panel${open ? ' open' : ''}${resizing ? ' resizing' : ''}`}>
        <div className="lc-ai-resize-handle" title="Kéo để thu hẹp / mở rộng" onMouseDown={startResize} />
        <div className="lc-ai-panel-head">
          <h4>Dezbot</h4>
          <button className="lc-ai-newchat-btn" onClick={() => setMessages([])}>Hội thoại mới</button>
          <button className="lc-ai-close-btn" onClick={onClose}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="lc-ai-panel-body" ref={bodyRef}>
          {messages.length === 0 && (
            <div className="lc-ai-welcome">
              <h2>Tôi có thể giúp gì,<br /><span className="muted">hôm nay?</span></h2>
              <p>Hỏi về tiến độ, nhân công, dòng tiền, khách hàng, bóc tách hay quy trình — trợ lý đọc trực tiếp dữ liệu trong workspace.</p>
              <div className="lc-ai-topic-grid">
                {TOPICS.map(t => (
                  <div key={t.key} className={`lc-ai-topic-chip${t.wide ? ' wide' : ''}`}>
                    <button className="lc-ai-chip" onClick={() => sendAiMessage(t.prompt)}>{t.icon}{t.label}</button>
                  </div>
                ))}
                <div className="lc-ai-topic-chip"><BugChip className="lc-ai-chip" onBefore={onClose} /></div>
              </div>
            </div>
          )}
          <div className={`lc-ai-log${messages.length ? ' open' : ''}`}>
            {messages.map(m => <div key={m.id} className={`lc-ai-msg ${m.role}`}>{m.text}</div>)}
          </div>
        </div>
        <div className="lc-ai-suggest-row">
          {SUGGESTS.map(s => <button key={s} className="lc-ai-suggest-chip" onClick={() => sendAiMessage(s)}>{s}</button>)}
        </div>
        <div className="lc-ai-input-area">
          <textarea
            ref={inputRef}
            placeholder="Hỏi về tiến độ, chấm công, dòng tiền, khách hàng…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiMessage(input) } }}
          />
          <div className="lc-ai-input-row">
            <div className="lc-ai-tool-btn"><svg {...toolIconProps}><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="10" y2="18" /></svg></div>
            <div className="lc-ai-tool-btn"><svg {...toolIconProps}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg></div>
            <div className="lc-ai-tool-btn"><svg {...toolIconProps}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg></div>
            <button className="lc-ai-send-btn" onClick={() => sendAiMessage(input)}>Gửi</button>
          </div>
        </div>
      </div>
    </>
  )
}
