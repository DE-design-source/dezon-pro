import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MINI_CAL_DAYS, CAL_DOW_SHORT, FOLLOWED_CALENDARS, COLLEAGUE_DIRECTORY, MINI_TASKS, MINI_CHATS, MINI_DOCS } from '../../../data/lichData'

const TABS = [['lich', 'Lịch'], ['nhiemvu', 'Nhiệm vụ'], ['chat', 'Chat'], ['taileu', 'Tài liệu']]
/* Sidebar kiểu lịch macOS trên nền mờ; mỗi khối là 1 module có viền (.lc-side-card) */
const listCardStyle = { padding: '4px 0' }
const noteStyle = { fontSize: 10.5, color: 'var(--text-muted)', padding: '0 2px' }
const linkStyle = { color: 'var(--primary)', fontWeight: 600 }
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()

/* Một dòng lịch có ô đánh dấu (bật/tắt hiển thị sự kiện của lịch đó) */
function CalRow({ color, checked, onToggle, label, tag }) {
  return (
    <div className="lc-cal-list-row">
      <div className={`lc-cal-list-dot${checked ? ' checked' : ''}`} style={{ '--dot-c': color }} onClick={onToggle} />
      {label}
      {tag && <span className="lc-cal-list-tag">{tag}</span>}
    </div>
  )
}

const DocIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
)

/* Độ rộng sidebar: kéo vạch mép phải để đổi, nhớ ở localStorage lc_side_w */
const SIDE_LS = 'lc_side_w'
const SIDE_DEF = 320, SIDE_MIN = 240, SIDE_MAX = 520
function readSide() {
  try { const v = Number(localStorage.getItem(SIDE_LS)); return v >= SIDE_MIN && v <= SIDE_MAX ? v : SIDE_DEF } catch { return SIDE_DEF }
}
function saveSide(w) { try { localStorage.setItem(SIDE_LS, String(w)) } catch { /* bỏ qua */ } }

export default function CalSidebar({ checkedMap, onToggleDot, colleagues, onAddColleague }) {
  const [tab, setTab] = useState('lich')
  const available = COLLEAGUE_DIRECTORY.filter(c => !colleagues.some(t => t.name === c.name))
  /* Ô tìm: gợi ý đồng nghiệp chưa thêm + lịch nhóm đang tắt; gõ chữ thì lọc luôn danh sách bên dưới */
  const [q, setQ] = useState('')
  const [findOpen, setFindOpen] = useState(false)
  const term = norm(q.trim())
  const match = s => !term || norm(s).includes(term)
  const hits = [
    ...available.filter(c => match(c.name)).map(c => ({ key: 'p:' + c.name, kind: 'person', label: c.name, color: c.color, val: `${c.name}|${c.color}` })),
    ...FOLLOWED_CALENDARS.filter(f => !checkedMap[f.key] && match(f.label)).map(f => ({ key: 'c:' + f.key, kind: 'cal', label: f.label, color: f.color, f })),
  ].slice(0, 8)
  function pickHit(h) {
    if (h.kind === 'person') onAddColleague(h.val)
    else onToggleDot(h.f.key, h.f.cal)
    setQ('')
    setFindOpen(false)
  }
  const [sideW, setSideW] = useState(readSide)
  const drag = useRef(null)
  const [dragging, setDragging] = useState(false)
  function rzDown(e) {
    e.preventDefault()
    drag.current = { x: e.clientX, w: sideW }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function rzMove(e) {
    const d = drag.current
    if (d) setSideW(Math.min(SIDE_MAX, Math.max(SIDE_MIN, Math.round(d.w + e.clientX - d.x))))
  }
  function rzUp() {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    setSideW(w => { saveSide(w); return w })
  }

  return (
    <div className="lc-cal-side" style={{ '--lc-side-w': sideW + 'px' }}>
      <span className={`lc-side-rz${dragging ? ' on' : ''}`} role="separator" aria-orientation="vertical" aria-label="Độ rộng khung bên trái"
        title="Kéo để đổi độ rộng · nhấp đúp: mặc định"
        onPointerDown={rzDown} onPointerMove={rzMove} onPointerUp={rzUp} onPointerCancel={rzUp}
        onDoubleClick={() => { setSideW(SIDE_DEF); saveSide(SIDE_DEF) }} />
      <div className="lc-cal-sidebar-tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={`lc-cal-sidebar-tab${tab === key ? ' active' : ''}`} type="button" onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {/* Tab Lịch: danh sách lịch ở trên, lịch nhỏ dưới đáy (như macOS) */}
      <div className={`lc-cal-sidebar-pane${tab === 'lich' ? ' active' : ''}`} style={{ gap: 14 }}>
        {/* 1 module: ô tìm (thêm đồng nghiệp / bật lịch nhóm) + Đang quản lý + Đang theo dõi, danh sách cuộn trong khung thấp */}
        <div className="lc-side-card lc-cal-lists">
          <div className="lc-cal-find" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFindOpen(false) }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input value={q} placeholder="Thêm người hoặc lịch nhóm..." onFocus={() => setFindOpen(true)} onChange={e => { setQ(e.target.value); setFindOpen(true) }}
              onKeyDown={e => { if (e.key === 'Escape') { setQ(''); setFindOpen(false) } else if (e.key === 'Enter' && hits[0]) pickHit(hits[0]) }} />
            {q && <button type="button" className="lc-cal-find-x" title="Xoá" onClick={() => setQ('')}>✕</button>}
            {findOpen && (
              <div className="lc-cal-find-pop">
                {hits.length ? hits.map(h => (
                  <button key={h.key} type="button" onClick={() => pickHit(h)}>
                    <i style={{ background: h.color }} />
                    <span>{h.label}</span>
                    <em>{h.kind === 'person' ? 'Đồng nghiệp' : 'Lịch nhóm'}</em>
                  </button>
                )) : <div className="lc-cal-find-none">{q ? 'Không tìm thấy' : 'Đã thêm hết'}</div>}
                <div className="lc-cal-find-note">Chỉ hiện lịch đã được đồng nghiệp chia sẻ với bạn.</div>
              </div>
            )}
          </div>
          <div className="lc-cal-lists-body">
            <div className="lc-side-h">Đang quản lý</div>
            {match('Chu Quang Thành') && <CalRow color="var(--primary)" checked={checkedMap.me} onToggle={() => onToggleDot('me', 'me')} label="Chu Quang Thành" />}
            {colleagues.filter(c => match(c.name)).map(c => (
              <CalRow key={c.calKey} color={c.color} checked={checkedMap[c.calKey]} onToggle={() => onToggleDot(c.calKey, c.calKey)} label={c.name} tag="Đã chia sẻ" />
            ))}
            <div className="lc-side-h" style={{ marginTop: 8 }}>Đang theo dõi</div>
            {FOLLOWED_CALENDARS.filter(f => match(f.label)).map(f => (
              <CalRow key={f.key} color={f.color} checked={checkedMap[f.key]} onToggle={() => onToggleDot(f.key, f.cal)} label={f.label} tag="Bên ngoài" />
            ))}
          </div>
        </div>

        <div className="lc-mini-cal lc-side-card grow">
          <div className="lc-mini-cal-h">Tháng 9 2026</div>
          <div className="lc-mini-cal-grid" style={{ marginBottom: 2 }}>
            {CAL_DOW_SHORT.map(d => <div key={d} className="lc-mini-cal-dow">{d}</div>)}
          </div>
          <div className="lc-mini-cal-grid">
            {MINI_CAL_DAYS.map(([d, cls], i) => <div key={i} className={`lc-mini-cal-day${cls ? ' ' + cls : ''}`}>{d}</div>)}
          </div>
        </div>
      </div>

      {/* Tab Nhiệm vụ */}
      <div className={`lc-cal-sidebar-pane${tab === 'nhiemvu' ? ' active' : ''}`}>
        <div className="lc-side-card">
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>Nhiệm vụ liên kết hôm nay</div>
          {MINI_TASKS.map(t => (
            <div key={t.text} className={`lc-mini-task-row${t.done ? ' done' : ''}`}>
              <input type="checkbox" defaultChecked={!!t.done} />
              <div className="lc-txt">{t.text}<span className="lc-meta">{t.meta}</span></div>
            </div>
          ))}
        </div>
        <div style={noteStyle}>Nhiệm vụ được tạo tự động từ sự kiện lịch có gắn nhãn công việc. Xem đầy đủ tại <Link to="/nhiem-vu" style={linkStyle}>Nhiệm vụ</Link>.</div>
      </div>

      {/* Tab Chat */}
      <div className={`lc-cal-sidebar-pane${tab === 'chat' ? ' active' : ''}`}>
        <div className="lc-side-card" style={listCardStyle}>
          <div style={{ fontWeight: 700, fontSize: 12.5, margin: '6px 6px 4px' }}>Trò chuyện liên quan</div>
          {MINI_CHATS.map(c => (
            <div key={c.name} className="lc-mini-chat-row">
              <span className="lc-avatar" style={{ background: c.color }}>{c.initials}</span>
              <div className="lc-txt"><div className="lc-name">{c.name}</div><div className="lc-preview">{c.preview}</div></div>
            </div>
          ))}
        </div>
        <div style={noteStyle}>Mở đầy đủ tại <Link to="/chat" style={linkStyle}>Chat</Link>.</div>
      </div>

      {/* Tab Tài liệu */}
      <div className={`lc-cal-sidebar-pane${tab === 'taileu' ? ' active' : ''}`}>
        <div className="lc-side-card" style={listCardStyle}>
          <div style={{ fontWeight: 700, fontSize: 12.5, margin: '6px 6px 4px' }}>Tài liệu gắn với sự kiện</div>
          {MINI_DOCS.map(d => (
            <div key={d.name} className="lc-mini-doc-row">
              <span className="lc-ic"><DocIcon /></span>
              <div className="lc-txt"><div className="lc-name">{d.name}</div><div className="lc-meta">{d.meta}</div></div>
            </div>
          ))}
        </div>
        <div style={noteStyle}>Mở đầy đủ tại <Link to="/wiki" style={linkStyle}>Wiki / Tài liệu</Link>.</div>
      </div>
    </div>
  )
}
