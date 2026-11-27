import { forwardRef, useLayoutEffect, useRef, useState, useImperativeHandle } from 'react'
import { CURRENT_USER, EVD_GUESTS } from '../../../data/lichData'
import Avatar from './Avatar'

const ic = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
const ic16 = { ...ic, width: 16, height: 16 }
const DoneIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>

const yesCount = EVD_GUESTS.filter(g => g.status === 'yes').reduce((s, g) => s + (g.count || 1), 0)
const pendingCount = EVD_GUESTS.filter(g => g.status === 'pending').reduce((s, g) => s + (g.count || 1), 0)
/* Số avatar khách hiện ở hàng thu gọn, phần còn lại gộp vào ô "+N" */
const STACK_MAX = 5

function GuestAvatar({ g }) {
  return <Avatar person={g} className="lc-evd-avatar" title={g.name}>{g.status === 'yes' && <span className="lc-ok">✓</span>}</Avatar>
}

/*
 * Popover chi tiết sự kiện (bấm vào 1 cuộc họp).
 * detail = { key, title, meta, color, link, rect } — chụp lại lúc mở như bản HTML.
 */
const EventDetailPopover = forwardRef(function EventDetailPopover({ detail, onClose, onDelete, canEdit = true }, ref) {
  const popRef = useRef(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const [rsvp, setRsvp] = useState(null)
  const [groupDone, setGroupDone] = useState(false)
  const [noteDone, setNoteDone] = useState(false)
  const [guestsOpen, setGuestsOpen] = useState(false)
  useImperativeHandle(ref, () => popRef.current)

  /* Mỗi lần mở: reset RSVP + nút nhanh, rồi đặt vị trí cạnh sự kiện */
  useLayoutEffect(() => {
    if (!detail) return
    setRsvp(null); setGroupDone(false); setNoteDone(false); setGuestsOpen(false)
  }, [detail])

  /* Mở / thu gọn danh sách khách làm đổi chiều cao nên phải canh lại vị trí */
  useLayoutEffect(() => {
    if (!detail) return
    const pop = popRef.current
    const r = detail.rect
    const pw = pop.offsetWidth, ph = pop.offsetHeight
    let left = r.right + 14
    if (left + pw > window.innerWidth - 10) left = Math.max(10, r.left - pw - 14)
    const top = Math.min(Math.max(10, r.top), window.innerHeight - ph - 10)
    setPos({ left, top })
  }, [detail, guestsOpen])

  const d = detail || {}

  return (
    <div ref={popRef} className={`lc-evd-popover${detail ? ' open' : ''}`} style={{ left: pos.left + 'px', top: pos.top + 'px', '--ev-c': d.color }}>
      <div className="lc-evd-top">
        <div className="lc-evd-head-icons">
          {canEdit && <button className="lc-evd-icon-btn" title="Sửa"><svg {...ic}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg></button>}
          <button className="lc-evd-icon-btn" title="Chia sẻ"><svg {...ic}><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg></button>
          {onDelete && <button className="lc-evd-icon-btn" title="Xóa" onClick={onDelete}><svg {...ic}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button>}
          <button className="lc-evd-icon-btn" title="Khác"><svg {...ic}><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg></button>
          <button className="lc-evd-icon-btn" title="Đóng" onClick={onClose}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>
        <div className="lc-evd-title-row">
          <span className="lc-evd-color-dot" style={{ background: d.color }} />
          <span className="lc-evd-title">{d.title}</span>
        </div>
        <div className="lc-evd-meta">{d.meta}</div>
        <div className="lc-evd-quick-row">
          <button type="button" className="lc-evd-quick-btn" onClick={() => setGroupDone(true)}>
            {groupDone
              ? <><DoneIcon /> Đã tạo nhóm</>
              : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>Tạo nhóm</>}
          </button>
          <button type="button" className="lc-evd-quick-btn" onClick={() => setNoteDone(true)}>
            {noteDone
              ? <><DoneIcon /> Đã tạo ghi chú</>
              : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>Tạo ghi chú</>}
          </button>
        </div>
      </div>
      <div className="lc-evd-body">
        <div className="lc-evd-row">
          <span className="lc-ic"><svg {...ic16}><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <button type="button" className="lc-evd-video-btn" onClick={() => alert('Đang mở phòng họp:\n' + d.link)}>Bắt đầu cuộc họp video</button>
            <div className="lc-evd-link">{d.link}</div>
          </div>
          <button className="lc-evd-copy-btn" title="Sao chép link" onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(d.link).catch(() => {}) }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          </button>
        </div>
        <div className="lc-evd-row center">
          <span className="lc-ic"><svg {...ic16}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg></span>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <Avatar person={CURRENT_USER} className="lc-evd-avatar"><span className="lc-ok">✓</span></Avatar>
            <span>{CURRENT_USER.name}<span className="lc-evd-organizer-tag">Người tổ chức</span></span>
          </div>
        </div>
        <div className="lc-evd-row">
          <span className="lc-ic"><svg {...ic16}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Bấm để mở / thu gọn danh sách tên khách */}
            <button type="button" className={`lc-evd-guest-head${guestsOpen ? ' open' : ''}`} onClick={() => setGuestsOpen(o => !o)}>
              <span>{(yesCount + pendingCount) + ' khách'}</span>
              <svg {...ic16}><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            <div className="lc-evd-guest-summary">{yesCount + ' có, ' + pendingCount + ' đang đợi'}</div>
            {guestsOpen ? (
              <div className="lc-evd-guest-list">
                {EVD_GUESTS.map(g => (
                  <div key={g.name} className="lc-evd-guest-row">
                    <GuestAvatar g={g} />
                    <span className="lc-name">{g.name + (g.count ? ' (' + g.count + ')' : '')}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="lc-evd-guest-stack">
                {EVD_GUESTS.slice(0, STACK_MAX).map(g => <GuestAvatar key={g.name} g={g} />)}
                {EVD_GUESTS.length > STACK_MAX && <span className="lc-evd-avatar more">+{EVD_GUESTS.length - STACK_MAX}</span>}
              </div>
            )}
          </div>
        </div>
        <div className="lc-evd-row center">
          <span className="lc-ic"><svg {...ic16}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg></span>
          <span>5 phút trước</span>
        </div>
        <div className="lc-evd-row center">
          <span className="lc-ic"><svg {...ic16}><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg></span>
          <span>{CURRENT_USER.name}</span>
        </div>
        <div className="lc-evd-rsvp-row">
          {[['yes', 'Có'], ['no', 'Không'], ['maybe', 'Có thể']].map(([k, l]) => (
            <button key={k} type="button" className={`lc-evd-rsvp-btn ${k}${rsvp === k ? ' active' : ''}`} onClick={() => setRsvp(k)}>{l}</button>
          ))}
        </div>
      </div>
    </div>
  )
})

export default EventDetailPopover
