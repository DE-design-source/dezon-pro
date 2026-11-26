import { useEffect, useRef, useState } from 'react'

/* Bánh xe chọn kiểu iOS (UIDatePicker dạng wheels): mỗi cột cuộn dọc, bám từng dòng (scroll-snap), dòng giữa là giá trị.
   Dùng cho hộp Đặt lịch hẹn (MarkUp 2026-11-16 17:26). Cuộn chuột / vuốt / bấm thẳng vào 1 dòng đều chọn được. */
const ROW = 34
const VISIBLE = 5

function Wheel({ items, value, onChange, width, label }) {
  const ref = useRef(null)
  const timer = useRef(0)
  const idx = Math.max(0, items.findIndex(it => it.v === value))
  // giá trị đổi từ ngoài (vd đổi tháng làm ngày bị kẹp) -> cuộn tới đúng dòng
  useEffect(() => {
    const el = ref.current
    if (el && Math.round(el.scrollTop / ROW) !== idx) el.scrollTop = idx * ROW
  }, [idx, items.length])
  useEffect(() => () => clearTimeout(timer.current), [])
  // dòng giữa đổi là nhận giá trị ngay (không chờ cuộn xong): lăn chuột rồi bấm Lưu liền vẫn lưu đúng giá trị đang thấy
  const onScroll = () => {
    const el = ref.current
    if (!el) return
    const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ROW)))
    if (items[i] && items[i].v !== value) onChange(items[i].v)
  }
  return (
    <div className="ios-wheel" ref={ref} style={{ width, height: ROW * VISIBLE }} onScroll={onScroll}
      role="listbox" aria-label={label} tabIndex={0}
      onKeyDown={e => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        e.preventDefault()
        const n = items[Math.min(items.length - 1, Math.max(0, idx + (e.key === 'ArrowDown' ? 1 : -1)))]
        if (n) onChange(n.v)
      }}>
      <div style={{ height: ROW * 2 }} />
      {items.map((it, i) => (
        <div key={it.v} role="option" aria-selected={i === idx} className={'ios-wheel-i' + (i === idx ? ' on' : '')} style={{ height: ROW }}
          onClick={() => { if (ref.current) ref.current.scrollTo({ top: i * ROW, behavior: 'smooth' }); onChange(it.v) }}>{it.label}</div>
      ))}
      <div style={{ height: ROW * 2 }} />
    </div>
  )
}

const pad = n => String(n).padStart(2, '0')
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

/* value / onChange: 'YYYY-MM-DD' */
export function DateWheel({ value, onChange }) {
  const now = new Date()
  const [y, m, d] = (value || now.toISOString().slice(0, 10)).split('-').map(Number)
  const dim = new Date(y, m, 0).getDate()
  const set = (yy, mm, dd) => onChange(yy + '-' + pad(mm) + '-' + pad(Math.min(dd, new Date(yy, mm, 0).getDate())))
  const y0 = now.getFullYear()
  return (
    <div className="ios-wheels">
      <Wheel label="Ngày" width={64} items={range(1, dim).map(n => ({ v: n, label: n }))} value={Math.min(d, dim)} onChange={v => set(y, m, v)} />
      <Wheel label="Tháng" width={112} items={range(1, 12).map(n => ({ v: n, label: 'Tháng ' + n }))} value={m} onChange={v => set(y, v, d)} />
      <Wheel label="Năm" width={80} items={range(Math.min(y0 - 1, y), Math.max(y0 + 5, y)).map(n => ({ v: n, label: n }))} value={y} onChange={v => set(v, m, d)} />
    </div>
  )
}

/* value / onChange: 'HH:MM' (24 giờ) */
export function TimeWheel({ value, onChange }) {
  const [h, mi] = (value || '09:00').split(':').map(Number)
  return (
    <div className="ios-wheels">
      <Wheel label="Giờ" width={72} items={range(0, 23).map(n => ({ v: n, label: pad(n) }))} value={h} onChange={v => onChange(pad(v) + ':' + pad(mi))} />
      <span className="ios-wheel-sep">:</span>
      <Wheel label="Phút" width={72} items={range(0, 59).map(n => ({ v: n, label: pad(n) }))} value={mi} onChange={v => onChange(pad(h) + ':' + pad(v))} />
    </div>
  )
}

/* Lịch dạng tháng kiểu iOS (UIDatePicker inline, MarkUp 2026-11-16 17:29): tiêu đề "Tháng 11 2026" + mũi tên ‹ ›,
   hàng thứ T2 ... CN, lưới ngày; ngày chọn = vòng tròn màu, hôm nay = chữ màu. value / onChange: 'YYYY-MM-DD' */
const DOW = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
const isoOf = (y, m, d) => y + '-' + pad(m) + '-' + pad(d)
export function MonthCalendar({ value, onChange }) {
  const today = new Date()
  const todayIso = isoOf(today.getFullYear(), today.getMonth() + 1, today.getDate())
  const [sy, sm] = (value || todayIso).split('-').map(Number)
  const [view, setView] = useState({ y: sy, m: sm })
  const first = new Date(view.y, view.m - 1, 1)
  const lead = (first.getDay() + 6) % 7          // số ô trống trước ngày 1 (tuần bắt đầu thứ 2)
  const dim = new Date(view.y, view.m, 0).getDate()
  const cells = Array.from({ length: lead }, () => null).concat(range(1, dim))
  const go = n => setView(v => { const d = new Date(v.y, v.m - 1 + n, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 } })
  return (
    <div className="ios-cal">
      <div className="ios-cal-h">
        <b>Tháng {view.m} {view.y}</b>
        <span>
          <button type="button" aria-label="Tháng trước" onClick={() => go(-1)}>‹</button>
          <button type="button" aria-label="Tháng sau" onClick={() => go(1)}>›</button>
        </span>
      </div>
      <div className="ios-cal-g">
        {DOW.map(d => <span key={d} className="dow">{d}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={'e' + i} />
          const iso = isoOf(view.y, view.m, d)
          return (
            <button key={iso} type="button" className={'day' + (iso === value ? ' on' : '') + (iso === todayIso ? ' today' : '')}
              aria-pressed={iso === value} onClick={() => onChange(iso)}>{d}</button>
          )
        })}
      </div>
    </div>
  )
}
