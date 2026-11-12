import { useMemo, useRef, useState } from 'react'
import { EVENT_COLORS, DATE_OPTIONS, CAL_OPTIONS, ROOMS, COLLEAGUE_DIRECTORY, COLLEAGUE_SCHEDULE, CURRENT_USER, DAYCOL_ROW_HEIGHT, GRID_START, decHourToLabel, timeToDecimalHour, randCode } from '../../../data/lichData'
import GuestSchedulePanel from './GuestSchedulePanel'
import Avatar from './Avatar'

const EyeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
)
const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
)
const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
)
const ROOM_PLACEHOLDER = 'Chọn phòng họp (không bắt buộc)'
const EXTERNAL_COLOR = '#8892A6' // màu cho khách ngoài danh bạ (nhập tay tên hoặc email)
/* So tên không phân biệt hoa thường và dấu tiếng Việt ("kien" khớp "Kiên") */
const fold = s => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
const sameName = (a, b) => fold(a) === fold(b)

/*
 * Modal "Tạo sự kiện" — luôn được mount (như bản HTML) để giữ các ô
 * không bị reset khi đóng: quyền khách, ngày, giờ, lịch, lặp lại, ô khách mời...
 */
export default function CreateEventModal({ open, onClose, onCreate, events = [] }) {
  const [title, setTitle] = useState('')
  const [color, setColor] = useState('')
  const [guestPerm, setGuestPerm] = useState('Mời người khác')
  const [date, setDate] = useState('3')
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('10:00')
  const [cal, setCal] = useState('me')
  const [allDay, setAllDay] = useState(false)
  const [recur, setRecur] = useState('Không lặp lại')
  const [meet, setMeet] = useState('none')
  const [meetLink, setMeetLink] = useState('')
  const [videoMeeting, setVideoMeeting] = useState(true)
  const [guestQuery, setGuestQuery] = useState('')
  const [guests, setGuests] = useState([]) // [{name, color, external?}]
  const [roomListOpen, setRoomListOpen] = useState(false)
  const [room, setRoom] = useState(null)
  const [chatLinked, setChatLinked] = useState(false)
  const [docLinked, setDocLinked] = useState(false)
  const [photos, setPhotos] = useState({}) // ảnh tự chọn cho từng người: { tên: đường dẫn ảnh }
  const photoInput = useRef(null)
  const photoFor = useRef(null)

  /* Cảnh báo trùng lịch với khách mời (checkConflicts) */
  const conflicts = useMemo(() => {
    if (!guests.length) return []
    const dayIdx = parseInt(date, 10)
    const startH = allDay ? 0 : timeToDecimalHour(start)
    const endH = allDay ? 24 : timeToDecimalHour(end)
    const list = []
    guests.forEach(g => {
      (COLLEAGUE_SCHEDULE[g.name] || []).forEach(s => {
        if (s.day === dayIdx && startH < s.end && s.start < endH) {
          list.push(g.name + ' đang bận ' + decHourToLabel(s.start) + '–' + decHourToLabel(s.end) + ' (' + s.title + ')')
        }
      })
    })
    return list
  }, [guests, date, start, end, allDay])

  /* closeCalModal: chỉ reset những ô mà bản HTML reset */
  function close() {
    setTitle('')
    setGuests([])
    setAllDay(false)
    setMeet('none'); setMeetLink('')
    setRoomListOpen(false); setRoom(null)
    setChatLinked(false); setDocLinked(false)
    setColor('')
    onClose()
  }

  function toggleGuest(c) {
    setGuests(prev => (prev.some(g => g.name === c.name) ? prev.filter(g => g.name !== c.name) : [...prev, { name: c.name, color: c.color }]))
  }

  /* Ô "Khách mời": gợi ý từ danh bạ theo chữ đang gõ; Enter mời người gợi ý đầu tiên,
     không khớp ai thì mời đúng tên / email vừa gõ như một khách bên ngoài */
  const query = guestQuery.trim()
  const suggestions = query
    ? COLLEAGUE_DIRECTORY.filter(c => fold(c.name).includes(fold(query)) && !guests.some(g => g.name === c.name))
    : []
  const canInviteTyped = query !== '' && !sameName(query, CURRENT_USER.name)
    && !COLLEAGUE_DIRECTORY.some(c => sameName(c.name, query)) && !guests.some(g => sameName(g.name, query))
  function inviteColleague(c) {
    setGuests(prev => (prev.some(g => g.name === c.name) ? prev : [...prev, { name: c.name, color: c.color }]))
    setGuestQuery('')
  }
  function inviteExternal() {
    setGuests(prev => (prev.some(g => sameName(g.name, query)) ? prev : [...prev, { name: query, color: EXTERNAL_COLOR, external: true }]))
    setGuestQuery('')
  }
  function inviteTyped() {
    if (suggestions.length) inviteColleague(suggestions[0])
    else if (canInviteTyped) inviteExternal()
  }

  /* Bấm avatar ở danh sách khách để chọn ảnh từ máy (chỉ giữ trong phiên làm việc) */
  const withPhoto = p => ({ ...p, avatar: photos[p.name] || p.avatar })
  function pickPhoto(name) {
    photoFor.current = name
    photoInput.current.click()
  }
  function onPhoto(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    const name = photoFor.current
    setPhotos(prev => {
      if (prev[name]) URL.revokeObjectURL(prev[name])
      return { ...prev, [name]: URL.createObjectURL(file) }
    })
  }

  function pickMeet(kind) {
    setMeet(kind)
    if (kind === 'none') setMeetLink('')
    else if (kind === 'google') setMeetLink('meet.google.com/' + randCode())
    else setMeetLink('lark.com/meeting/' + randCode())
  }

  function submit() {
    const t = title.trim()
    if (!t) { alert('Vui lòng nhập tiêu đề sự kiện.'); return }
    if (!allDay) {
      const startH = timeToDecimalHour(start)
      const endH = timeToDecimalHour(end)
      if (endH <= startH) { alert('Giờ kết thúc phải sau giờ bắt đầu.'); return }
    }
    onCreate({ title: t, dayIdx: parseInt(date, 10), startStr: start, endStr: end, calKey: cal, isAllDay: allDay, guests, color })
    close()
  }

  /* Sự kiện của mình trong ngày đang chọn, hiện ở cột đầu của bảng so lịch */
  const dayIdx = parseInt(date, 10)
  const myEvents = events
    .filter(ev => ev.cal === 'me' && ev.day === dayIdx && !ev.allday)
    .map(ev => ({ id: ev.id, title: ev.title, color: ev.color, tint: ev.tint, start: GRID_START + ev.top / DAYCOL_ROW_HEIGHT, end: GRID_START + (ev.top + ev.height) / DAYCOL_ROW_HEIGHT }))

  const host = withPhoto(CURRENT_USER)
  const shownGuests = guests.map(withPhoto)

  const roomSummary = room ? room.room + (room.status === 'busy' ? ' (đang dùng — vẫn có thể đặt)' : ' — đã đặt') : ROOM_PLACEHOLDER

  return (
    <div className={`lc-cal-modal-overlay${open ? ' open' : ''}`} onClick={e => { if (e.target === e.currentTarget) close() }}>
      <div className="lc-cal-modal-box">
        <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '.04em' }}>Tạo sự kiện</h3>
        <div className="lc-cal-modal-field" style={{ marginBottom: 10 }}>
          <input type="text" placeholder="Thêm tiêu đề" value={title} onChange={e => setTitle(e.target.value)} style={{ border: 'none', background: 'transparent', padding: '4px 0', fontSize: 21, fontWeight: 700, fontFamily: "var(--app-font, 'Montserrat'), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: 'var(--text)' }} />
        </div>
        <div className="lc-cal-modal-field" style={{ marginBottom: 18 }}>
          <label>Màu sự kiện</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {EVENT_COLORS.map(c => (
              <div key={c.color} className={`lc-ev-color-dot${color === c.color ? ' active' : ''}`} data-color={c.color} style={{ '--dot-c': c.dot || c.color }} title={c.title} onClick={() => setColor(c.color)} />
            ))}
          </div>
        </div>
        <div className="lc-cal-modal-cols">
          <div className="lc-cal-modal-col">
            <div className="lc-cal-modal-field">
              <label>Quyền của khách</label>
              <select value={guestPerm} onChange={e => setGuestPerm(e.target.value)}>
                <option>Mời người khác</option>
                <option>Xem danh sách khách</option>
                <option>Chỉ xem sự kiện</option>
              </select>
            </div>
            <div className="lc-cal-modal-field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>Ngày</label>
              <select value={date} onChange={e => setDate(e.target.value)}>
                {DATE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="lc-cal-modal-row">
              <div className="lc-cal-modal-field">
                <label>Bắt đầu</label>
                <input type="time" value={start} onChange={e => setStart(e.target.value)} min="08:00" max="21:30" step="1800" disabled={allDay} />
              </div>
              <div className="lc-cal-modal-field">
                <label>Kết thúc</label>
                <input type="time" value={end} onChange={e => setEnd(e.target.value)} min="08:30" max="22:00" step="1800" disabled={allDay} />
              </div>
            </div>
            <div className="lc-cal-modal-field">
              <label>Lịch</label>
              <select value={cal} onChange={e => setCal(e.target.value)}>
                {CAL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="lc-cal-modal-row" style={{ alignItems: 'center', marginBottom: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--text)', cursor: 'pointer' }}>
                <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} /> Cả ngày
              </label>
              <span style={{ fontSize: 12.5, color: 'var(--primary)', fontWeight: 600, cursor: 'pointer' }}>Múi giờ ›</span>
              <select value={recur} onChange={e => setRecur(e.target.value)} style={{ flex: 1 }}>
                <option>Không lặp lại</option>
                <option>Hằng ngày</option>
                <option>Hằng tuần</option>
                <option>Hằng tháng</option>
              </select>
            </div>
            <div className="lc-cal-modal-field">
              <label>Cuộc họp video</label>
              <div className="lc-meet-provider-row">
                {[['none', 'Không tạo link'], ['google', 'Google Meet'], ['lark', 'Lark Meeting']].map(([k, l]) => (
                  <button key={k} type="button" className={`lc-meet-provider-btn${meet === k ? ' selected' : ''}`} onClick={() => pickMeet(k)}>{l}</button>
                ))}
              </div>
              <div className={`lc-meet-link-preview${meet !== 'none' ? ' show' : ''}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                <span className="lc-lnk">{meetLink}</span>
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={videoMeeting} onChange={e => setVideoMeeting(e.target.checked)} style={{ marginTop: 2 }} /> Cho phép khách tham dự sự kiện để bắt đầu cuộc họp
            </label>
          </div>
          <div className="lc-cal-modal-col">
            <div className="lc-cal-modal-field">
              <label>Khách mời</label>
              <input
                type="text" placeholder="Thêm liên hệ, nhóm hoặc email" value={guestQuery} style={{ marginBottom: 4 }}
                onChange={e => setGuestQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && query) { e.preventDefault(); inviteTyped() } }}
              />
              {(suggestions.length > 0 || canInviteTyped) && (
                <div className="lc-ev-guest-suggest">
                  {suggestions.map(c => (
                    <button key={c.name} type="button" onClick={() => inviteColleague(c)}>
                      <Avatar person={withPhoto(c)} /><span className="lc-name">{c.name}</span>
                    </button>
                  ))}
                  {canInviteTyped && (
                    <button type="button" onClick={inviteExternal}>
                      <span className="lc-avatar" style={{ background: EXTERNAL_COLOR }}>+</span><span className="lc-name">Mời “{query}”</span><span className="lc-ext-tag">Bên ngoài</span>
                    </button>
                  )}
                </div>
              )}
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', margin: '6px 0 4px' }}>Khách ({1 + guests.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                <input ref={photoInput} type="file" accept="image/*" onChange={onPhoto} style={{ display: 'none' }} />
                {/* Người tạo sự kiện luôn có sẵn trong danh sách, đánh dấu tích xanh để phân biệt với khách mời */}
                <div className="lc-ev-guest-row" style={{ '--row-c': host.color, '--row-tint': 'var(--primary-tint)' }}>
                  <Avatar person={host} className="lc-avatar pick" title="Bấm để chọn ảnh" onClick={() => pickPhoto(host.name)}><span className="lc-ok">✓</span></Avatar><span className="lc-name">{host.name}</span>
                  <span className="lc-icon-btn-sm static" title="Người tổ chức"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><polyline points="16 11 18 13 22 9" /></svg></span>
                  <button type="button" className="lc-icon-btn-sm" title="Hiện trên lịch"><EyeIcon /></button>
                </div>
                {shownGuests.map(g => (
                  <div key={g.name} className="lc-ev-guest-row" style={{ '--row-c': g.color, '--row-tint': g.color + '1c' }}>
                    <Avatar person={g} className="lc-avatar pick" title="Bấm để chọn ảnh" onClick={() => pickPhoto(g.name)} /><span className="lc-name">{g.name}</span>{g.external && <span className="lc-ext-tag">Bên ngoài</span>}
                    <button className="lc-icon-btn-sm" title="Hiện trên lịch"><EyeIcon /></button>
                    <button type="button" className="lc-icon-btn-sm" title="Bỏ mời" onClick={() => setGuests(prev => prev.filter(x => x.name !== g.name))}><CloseIcon /></button>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 6 }}>Bấm để mời thêm từ danh bạ:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {COLLEAGUE_DIRECTORY.map(c => (
                  <div key={c.name} className={`lc-ev-guest-pill${guests.some(g => g.name === c.name) ? ' selected' : ''}`} style={{ '--pill-c': c.color, '--pill-tint': c.color + '1c' }} onClick={() => toggleGuest(c)}>
                    <Avatar person={withPhoto(c)} /><span>{c.name}</span><span className="lc-check">✓</span>
                  </div>
                ))}
              </div>
            </div>
            <div className={`lc-ev-conflict-warning${conflicts.length ? ' show' : ''}`}>
              {conflicts.length > 0 && <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><path d="M12 17h.01" /></svg>
                <div><strong>Trùng lịch với khách mời:</strong>{conflicts.map(c => <span key={c}><br />{c}</span>)}</div>
              </>}
            </div>
            <div className="lc-cal-modal-field">
              <label>Smart Room Booking</label>
              <button type="button" onClick={() => setRoomListOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--border)', background: 'var(--surface-alt)', borderRadius: 8, padding: '9px 12px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" /></svg>
                <span style={{ flex: 1, fontSize: 13, color: room ? 'var(--text)' : 'var(--text-muted)' }}>{roomSummary}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', color: 'var(--text-muted)' }}><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              <div style={{ display: roomListOpen ? 'block' : 'none', marginTop: 8 }}>
                {ROOMS.map(r => (
                  <div key={r.room} className={`lc-room-option${room && room.room === r.room ? ' selected' : ''}`} onClick={() => { setRoom(r); setRoomListOpen(false) }}>
                    <div className="lc-room-option-row"><span className="lc-name">{r.room}</span><span className={`lc-room-status ${r.status}`}>{r.statusLabel}</span></div>
                    <div className="lc-room-equip">{r.equip}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="lc-cal-modal-field">
              <label>Liên kết nhanh</label>
              <div className="lc-quick-link-row">
                <button type="button" className={`lc-quick-link-btn${chatLinked ? ' linked' : ''}`} onClick={() => setChatLinked(true)}>
                  {chatLinked
                    ? <><CheckIcon /> Đã tạo nhóm chat</>
                    : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                      Tạo nhóm chat</>}
                </button>
                <button type="button" className={`lc-quick-link-btn${docLinked ? ' linked' : ''}`} onClick={() => setDocLinked(true)}>
                  {docLinked
                    ? <><CheckIcon /> Đã đính kèm tài liệu</>
                    : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                      Đính kèm tài liệu</>}
                </button>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          <button className="lc-cal-modal-btn cancel" onClick={close}>Hủy</button>
          <button className="lc-cal-modal-btn submit" onClick={submit}>Tạo sự kiện</button>
        </div>
      </div>
      {/* Mời khách xong thì hiện bảng so lịch bận của từng người bên cạnh */}
      {guests.length > 0 && (
        <GuestSchedulePanel
          dayIdx={dayIdx} onDay={i => setDate(String(i))}
          host={host} guests={shownGuests} myEvents={myEvents}
          startH={allDay ? 8 : timeToDecimalHour(start)} endH={allDay ? 22 : timeToDecimalHour(end)}
          conflict={conflicts.length > 0}
        />
      )}
    </div>
  )
}
