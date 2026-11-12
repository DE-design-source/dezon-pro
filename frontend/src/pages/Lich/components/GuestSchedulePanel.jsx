import { useEffect, useRef } from 'react'
import {
  CAL_DOW, WEEK_DATES, TODAY_IDX, HOUR_LABELS, GRID_HEIGHT, GRID_START, DAYCOL_ROW_HEIGHT, COLLEAGUE_SCHEDULE,
  decHourToLabel,
} from '../../../data/lichData'
import Avatar from './Avatar'

const GRID_END = GRID_START + GRID_HEIGHT / DAYCOL_ROW_HEIGHT
const COL_WIDTH = 150
const GUTTER_WIDTH = 52
const hourToPx = h => (Math.min(GRID_END, Math.max(GRID_START, h)) - GRID_START) * DAYCOL_ROW_HEIGHT

function Block({ color, tint, start, end, title }) {
  const top = hourToPx(start)
  const height = Math.max(18, hourToPx(end) - top)
  return (
    <div className={`lc-gs-block${height < 34 ? ' compact' : ''}`} style={{ '--ev-c': color, '--ev-tint': tint, top, height }} title={title}>
      <span className="lc-t">{title}</span>
      <span className="lc-s">{decHourToLabel(start)} - {decHourToLabel(end)}</span>
    </div>
  )
}

/*
 * Bảng so lịch bên cạnh modal "Tạo sự kiện": mỗi cột là một người (mình + khách mời),
 * liệt kê giờ bận trong ngày đang chọn và tô khung giờ của sự kiện sắp tạo.
 * myEvents = [{ id, title, color, tint, start, end }] (giờ dạng thập phân).
 */
export default function GuestSchedulePanel({ dayIdx, onDay, host, guests, myEvents, startH, endH, conflict }) {
  const scrollRef = useRef(null)

  /* Cuộn tới khung giờ đang chọn mỗi khi đổi giờ / ngày / khách */
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, hourToPx(startH) - DAYCOL_ROW_HEIGHT)
  }, [startH, dayIdx, guests.length])

  const people = [
    { ...host, blocks: myEvents },
    ...guests.map(g => ({
      ...g, note: 'Chỉ hiện giờ bận',
      blocks: (COLLEAGUE_SCHEDULE[g.name] || []).filter(s => s.day === dayIdx).map((s, i) => ({
        id: g.name + i, title: 'Bận · ' + s.title, color: g.color, tint: g.color + '22', start: s.start, end: s.end,
      })),
    })),
  ]
  const bandTop = hourToPx(startH)
  const bandHeight = hourToPx(endH) - bandTop

  return (
    <div className="lc-gs-panel" style={{ width: Math.min(460, GUTTER_WIDTH + people.length * COL_WIDTH) }}>
      <div className="lc-gs-head">
        <button type="button" className="lc-cal-today-btn" onClick={() => onDay(TODAY_IDX)}>Hôm nay</button>
        <button type="button" className="lc-cal-icon-btn" title="Ngày trước" disabled={dayIdx === 0} onClick={() => onDay(dayIdx - 1)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
        <button type="button" className="lc-cal-icon-btn" title="Ngày sau" disabled={dayIdx === 6} onClick={() => onDay(dayIdx + 1)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg></button>
        <span className="lc-gs-date">{(dayIdx === TODAY_IDX ? 'Hôm nay, ' : CAL_DOW[dayIdx] + ', ') + WEEK_DATES[dayIdx] + '/9'}</span>
      </div>
      <div className="lc-gs-scroll" ref={scrollRef}>
        <div style={{ minWidth: GUTTER_WIDTH + people.length * 120 }}>
          <div className="lc-gs-people">
            <div className="lc-gs-gutter">GMT+7</div>
            {people.map(p => (
              <div key={p.name} className="lc-gs-person">
                <Avatar person={p} />
                <span className="lc-name">{p.name}</span>
                {p.note && <span className="lc-note">{p.note}</span>}
              </div>
            ))}
          </div>
          <div className="lc-gs-grid" style={{ height: GRID_HEIGHT }}>
            <div className="lc-gs-gutter">
              {HOUR_LABELS.map(([top, label]) => <span key={label} style={{ top }}>{label}</span>)}
            </div>
            <div className="lc-gs-cols">
              {bandHeight > 0 && <div className={`lc-gs-band${conflict ? ' conflict' : ''}`} style={{ top: bandTop, height: bandHeight }} />}
              {people.map(p => (
                <div key={p.name} className="lc-gs-col">
                  {p.blocks.map(b => <Block key={b.id} {...b} />)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="lc-gs-foot"><i className={conflict ? 'conflict' : ''} />{conflict ? 'Khung giờ đang chọn trùng giờ bận của khách' : 'Khung giờ sự kiện đang chọn'}</div>
    </div>
  )
}
