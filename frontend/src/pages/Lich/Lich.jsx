import { useEffect, useRef, useState } from 'react'
import './Lich.css'
import { useTheme } from '../../hooks/useTheme'
import {
  INITIAL_EVENTS, CAL_COLOR_VARS, DAYCOL_ROW_HEIGHT, GRID_START, COLLEAGUE_DIRECTORY, COLLEAGUE_DEMO_SLOTS, FOLLOWED_CALENDARS,
  CAL_DOW, WEEK_DATES, DAY_DATE_LABELS, TODAY_IDX, timeToDecimalHour, evdRandomLink,
} from '../../data/lichData'
import CalSidebar from './components/CalSidebar'
import WeekView from './components/WeekView'
import MonthView from './components/MonthView'
import CreateEventModal from './components/CreateEventModal'
import EventDetailPopover from './components/EventDetailPopover'
import SyncStatus from './components/SyncStatus'
import Dezbot, { loadAiPanelWidth } from './components/Dezbot'

const VIEWS = [['day', 'Ngày'], ['week', 'Tuần'], ['month', 'Tháng']]

/* Trạng thái ô đánh dấu ban đầu của các lịch ở sidebar */
const INITIAL_CHECKED = FOLLOWED_CALENDARS.reduce((m, f) => ({ ...m, [f.key]: f.checked }), { me: true })

let evSeq = 0
const newEventId = () => 'n' + (++evSeq)

/* Thêm đồng nghiệp vào danh sách "Đang quản lý" nếu chưa có (ensureColleagueTracked) */
function ensureTracked(list, name) {
  const found = list.find(c => c.name === name)
  if (found) return [list, found]
  const entry = COLLEAGUE_DIRECTORY.find(c => c.name === name)
  const tracked = { name, calKey: 'colleague-' + list.length, color: entry ? entry.color : '#8892A6' }
  return [[...list, tracked], tracked]
}

export default function Lich() {
  const { theme, toggleTheme } = useTheme()
  const [aiOpen, setAiOpen] = useState(false)
  const [aiWidth, setAiWidth] = useState(loadAiPanelWidth)
  const [aiResizing, setAiResizing] = useState(false)

  const [view, setView] = useState('week')
  const [dayIdx, setDayIdx] = useState(TODAY_IDX)
  const [events, setEvents] = useState(INITIAL_EVENTS)
  const [checked, setChecked] = useState(INITIAL_CHECKED)
  const [colleagues, setColleagues] = useState([]) // [{name, calKey, color}]
  const [modalOpen, setModalOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [bannerShown, setBannerShown] = useState(true)
  const [conflictOpen, setConflictOpen] = useState(false)
  const conflictRef = useRef(null)
  const popRef = useRef(null)

  /* Pop-up xung đột: bấm ra ngoài / Esc thì đóng */
  useEffect(() => {
    if (!conflictOpen) return undefined
    const down = e => { if (conflictRef.current && !conflictRef.current.contains(e.target)) setConflictOpen(false) }
    const esc = e => { if (e.key === 'Escape') setConflictOpen(false) }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', esc) }
  }, [conflictOpen])

  /* Bấm chuột ra ngoài popover (và không phải vào sự kiện) thì đóng chi tiết */
  useEffect(() => {
    if (!detail) return
    function onDown(e) {
      if (popRef.current && !popRef.current.contains(e.target) && !e.target.closest('.lc-cal-event')) setDetail(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [detail])

  /* Bật/tắt hiển thị: chỉ áp dụng cho các sự kiện đang có của lịch đó (như bản HTML) */
  function toggleDot(key, cal) {
    const on = !checked[key]
    setChecked(prev => ({ ...prev, [key]: on }))
    if (cal) setEvents(prev => prev.map(ev => (ev.cal === cal ? { ...ev, dim: !on } : ev)))
  }

  function trackMany(names) {
    let list = colleagues
    const out = names.map(n => { const [l, t] = ensureTracked(list, n); list = l; return t })
    if (list !== colleagues) {
      const added = list.slice(colleagues.length)
      setColleagues(list)
      setChecked(prev => added.reduce((m, c) => ({ ...m, [c.calKey]: true }), prev))
    }
    return [list, out]
  }

  /* Theo dõi lịch đồng nghiệp: thêm 1 khung giờ bận mẫu */
  function addColleague(val) {
    if (!val) return
    const name = val.split('|')[0]
    const [list, [tracked]] = trackMany([name])
    const slot = COLLEAGUE_DEMO_SLOTS[(list.length - 1) % COLLEAGUE_DEMO_SLOTS.length]
    setEvents(prev => [...prev, {
      id: newEventId(), cal: tracked.calKey, day: slot.day, dim: false, allday: false, compact: false,
      color: tracked.color, tint: tracked.color + '22',
      top: (slot.start - GRID_START) * DAYCOL_ROW_HEIGHT, height: (slot.end - slot.start) * DAYCOL_ROW_HEIGHT,
      title: name + ' — ' + slot.title,
    }])
  }

  /* Tạo sự kiện từ modal (+ bản sao trên lịch của từng khách mời) */
  function createEvent({ title, dayIdx: day, startStr, endStr, calKey, isAllDay, guests, color }) {
    const guestSuffix = guests.length ? (' · ' + guests.map(g => g.name).join(', ')) : ''
    let top, height, timeLabel
    if (isAllDay) {
      top = 2; height = 22; timeLabel = 'Cả ngày'
    } else {
      const startH = timeToDecimalHour(startStr)
      const endH = timeToDecimalHour(endStr)
      top = Math.max(0, (startH - GRID_START) * DAYCOL_ROW_HEIGHT)
      height = Math.max(18, (endH - startH) * DAYCOL_ROW_HEIGHT)
      timeLabel = startStr + ' - ' + endStr
    }
    let colors = CAL_COLOR_VARS[calKey] || CAL_COLOR_VARS.me
    if (color) colors = [color, color + '22']
    const isCompact = height < 34 && !isAllDay

    const created = [{
      id: newEventId(), cal: calKey, day, top, height, dim: false, allday: isAllDay, compact: isCompact,
      color: colors[0], tint: colors[1], title, sub: isCompact ? startStr : (timeLabel + guestSuffix),
    }]
    /* Khách bên ngoài (nhập tay) chỉ ghi vào tên sự kiện, không tạo lịch theo dõi */
    const [, trackedList] = trackMany(guests.filter(g => !g.external).map(g => g.name))
    trackedList.forEach((tracked, i) => {
      created.push({
        id: newEventId(), cal: tracked.calKey, day, top, height, left: 18 + i * 10, dim: false, allday: isAllDay, compact: false,
        color: tracked.color, tint: tracked.color + '22', title: title + ' · Bạn',
      })
    })
    setEvents(prev => [...prev, ...created])
  }

  function openDetail(ev, rect) {
    setDetail({
      id: ev.id,
      title: ev.title.split(' · ')[0],
      meta: DAY_DATE_LABELS[ev.day] + ' · ' + (ev.sub != null ? ev.sub.split(' · ')[0] : 'Cả ngày') + ' (GMT+7)',
      color: ev.color || 'var(--primary)',
      link: evdRandomLink(),
      rect,
    })
  }

  function deleteDetailEvent() {
    if (detail) setEvents(prev => prev.filter(ev => ev.id !== detail.id))
    setDetail(null)
  }

  /* Trước / Sau / Hôm nay chỉ có tác dụng ở dạng xem Ngày (giống bản HTML) */
  const prev = () => { if (view === 'day') setDayIdx(i => Math.max(0, i - 1)) }
  const next = () => { if (view === 'day') setDayIdx(i => Math.min(6, i + 1)) }
  const today = () => { if (view === 'day') setDayIdx(TODAY_IDX) }

  /* Tiêu đề kiểu lịch macOS: phần chính đậm + năm nhạt; dạng Ngày có thêm dòng thứ */
  const title = view === 'day'
    ? { main: WEEK_DATES[dayIdx] + ' tháng 9', year: ', 2026', sub: CAL_DOW[dayIdx] }
    : { main: 'Tháng 9', year: ' 2026', sub: view === 'week' ? '20 – 26/9' : '' }

  function resolveConflict() {
    const choice = confirm('Xung đột: "Họp Vua Thầu"\n\nGoogle Calendar: 15:00 - 16:00, phòng B122\nLark Calendar: 15:30 - 16:30, phòng B123\n\nBấm OK để giữ bản Google, Cancel để giữ bản Lark.')
    setBannerShown(false)
    alert('Đã áp dụng bản ' + (choice ? 'Google' : 'Lark') + ' và đồng bộ lại sang bên còn lại.')
  }

  return (
    <div
      className={`lc-page${aiOpen ? ' lc-ai-open' : ''}${aiResizing ? ' lc-ai-resizing' : ''}`}
      style={{ '--ai-panel-width': `${aiWidth}px` }}
    >
      {/* HEADER */}
      <div style={{ height: 64, flex: 'none', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 var(--page-gutter)', boxSizing: 'border-box', background: 'var(--surface)', gap: 12 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--primary-tint)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
        </div>
        <span style={{ fontSize: 14.5, fontWeight: 700 }}>Lịch</span>
        {/* Xung đột đồng bộ (demo): icon cảnh báo ngay sau tiêu đề, bấm mở pop-up Xem & xử lý / Bỏ qua */}
        {bannerShown && (
          <div className="lc-conflict" ref={conflictRef}>
            <button type="button" className={`lc-conflict-btn${conflictOpen ? ' on' : ''}`} title="1 xung đột lịch trình" aria-expanded={conflictOpen} onClick={() => setConflictOpen(o => !o)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><path d="M12 17h.01" /></svg>
              <span className="lc-conflict-n">1</span>
            </button>
            {conflictOpen && (
              <div className="lc-conflict-pop" role="dialog" aria-label="Xung đột lịch trình">
                <div className="lc-conflict-h">Xung đột lịch trình</div>
                <div className="lc-conflict-msg">&quot;Họp Vua Thầu&quot; bị sửa khác nhau trên Google và Lark.</div>
                <div className="lc-conflict-acts">
                  <button type="button" className="lc-dismiss" onClick={() => { setConflictOpen(false); setBannerShown(false) }}>Bỏ qua</button>
                  <button type="button" className="lc-go" onClick={() => { setConflictOpen(false); resolveConflict() }}>Xem &amp; xử lý</button>
                </div>
              </div>
            )}
          </div>
        )}
        <div style={{ flex: 1 }} />
        <SyncStatus />
        <button title="Chuyển giao diện sáng/tối" onClick={toggleTheme} style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface-alt)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {theme === 'dark'
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'block' }}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'block' }}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>}
        </button>
      </div>

      <div style={{ flex: 1, padding: 'var(--page-gutter) var(--page-gutter) 22px', boxSizing: 'border-box', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>

        {/* BODY: 1 khung cửa sổ kiểu lịch macOS — sidebar nền mờ bên trái, thanh công cụ + lưới bên phải */}
        <div className="lc-cal-window">
          <CalSidebar checkedMap={checked} onToggleDot={toggleDot} colleagues={colleagues} onAddColleague={addColleague} />
          <div className="lc-cal-main">
            <div className="lc-cal-toolbar">
              <div className="lc-cal-title">
                <div><b>{title.main}</b>{title.year}</div>
                {title.sub && <span>{title.sub}</span>}
              </div>
              <div className="lc-cal-view-toggle">
                {VIEWS.map(([k, l]) => (
                  <button key={k} className={`lc-cal-view-btn${view === k ? ' active' : ''}`} onClick={() => setView(k)}>{l}</button>
                ))}
              </div>
              <div className="lc-cal-toolbar-r">
                <div className="lc-cal-nav">
                  <button className="lc-cal-icon-btn" title="Trước" onClick={prev}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
                  <button className="lc-cal-today-btn" onClick={today}>Hôm nay</button>
                  <button className="lc-cal-icon-btn" title="Sau" onClick={next}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg></button>
                </div>
                <button className="lc-cal-create-btn" onClick={() => setModalOpen(true)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  Tạo sự kiện
                </button>
              </div>
            </div>
            <WeekView hidden={view === 'month'} view={view} dayIdx={dayIdx} events={events} setEvents={setEvents} onOpenDetail={openDetail} />
            <MonthView hidden={view !== 'month'} onGotoDay={i => { setDayIdx(i); setView('day') }} />
          </div>
        </div>
      </div>

      <CreateEventModal open={modalOpen} onClose={() => setModalOpen(false)} onCreate={createEvent} events={events} />
      <EventDetailPopover ref={popRef} detail={detail} onClose={() => setDetail(null)} onDelete={deleteDetailEvent} />

      <Dezbot
        open={aiOpen}
        onToggle={() => setAiOpen(o => !o)}
        onClose={() => setAiOpen(false)}
        onResize={setAiWidth}
        onResizingChange={setAiResizing}
      />
    </div>
  )
}
