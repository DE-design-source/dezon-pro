/* Ô chọn ngày dùng chung, lịch kiểu iOS thay cho lịch của trình duyệt (không đổi được font / màu).
   <DatePicker value="2026-11-04" onChange={iso => ...} min max clearable ariaLabel /> — giá trị dạng YYYY-MM-DD như input type=date.
   Lịch vẽ trong cây DOM của ô (position:fixed) nên ăn font / màu của trang chứa nó. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from './Icon'
import './DatePicker.css'

const THU = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
const pad = n => String(n).padStart(2, '0')
const toIso = (y, m, d) => y + '-' + pad(m + 1) + '-' + pad(d)
const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null }
const today = () => { const n = new Date(); return toIso(n.getFullYear(), n.getMonth(), n.getDate()) }
const POP_W = 312, POP_H = 380

export default function DatePicker({ value, onChange, min, max, clearable, ariaLabel, className, placeholder = 'dd/mm/yyyy' }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(null)    // {y, m}: tháng đang xem
  const [mode, setMode] = useState('day')   // 'day' | 'month': bảng chọn tháng / năm
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const popRef = useRef(null)
  const v = parse(value)

  function place() {
    const b = btnRef.current && btnRef.current.getBoundingClientRect()
    if (!b) return
    const left = Math.max(8, Math.min(b.left, window.innerWidth - POP_W - 8))
    const top = b.bottom + 6 + POP_H > window.innerHeight && b.top - 6 - POP_H > 0 ? b.top - 6 - POP_H : b.bottom + 6
    setPos({ left, top })
  }
  function show() {
    const base = v || parse(today())
    setView({ y: base.y, m: base.m }); setMode('day'); setOpen(true)
  }
  useLayoutEffect(() => { if (open) place() }, [open])
  useEffect(() => {
    if (!open) return
    const down = e => { if (!popRef.current.contains(e.target) && !btnRef.current.contains(e.target)) setOpen(false) }
    const key = e => { if (e.key === 'Escape') { setOpen(false); btnRef.current.focus() } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  const off = iso => (min && iso < min) || (max && iso > max)
  function pick(iso) { if (off(iso)) return; onChange(iso); setOpen(false) }
  const shift = n => setView(w => { const d = new Date(w.y, w.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() } })

  let body = null
  if (open && view) {
    if (mode === 'day') {
      const lead = (new Date(view.y, view.m, 1).getDay() + 6) % 7   // ô trống trước ngày 1 (tuần bắt đầu thứ Hai)
      const n = new Date(view.y, view.m + 1, 0).getDate()
      const t = today()
      const cells = []
      for (let i = 0; i < lead; i++) cells.push(<span key={'e' + i} />)
      for (let d = 1; d <= n; d++) {
        const iso = toIso(view.y, view.m, d)
        const cls = ['dp-day', iso === value ? 'on' : '', iso === t ? 'today' : '', off(iso) ? 'off' : ''].filter(Boolean).join(' ')
        cells.push(<button type="button" key={iso} className={cls} disabled={off(iso)} onClick={() => pick(iso)}>{d}</button>)
      }
      body = (
        <>
          <div className="dp-week">{THU.map(x => <span key={x}>{x}</span>)}</div>
          <div className="dp-grid">{cells}</div>
        </>
      )
    } else {
      body = (
        <div className="dp-months">
          {Array.from({ length: 12 }, (_, i) => (
            <button type="button" key={i} className={i === view.m ? 'on' : ''} onClick={() => { setView({ ...view, m: i }); setMode('day') }}>Th {i + 1}</button>
          ))}
        </div>
      )
    }
  }

  return (
    <span className={'dp' + (className ? ' ' + className : '')}>
      <button type="button" ref={btnRef} className={'dp-trigger' + (open ? ' open' : '')} aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}>
        <span className={v ? '' : 'dp-ph'}>{v ? pad(v.d) + '/' + pad(v.m + 1) + '/' + v.y : placeholder}</span>
        <Icon name="calendar" size={15} />
      </button>
      {open && view && (
        <div ref={popRef} className="dp-pop" role="dialog" aria-label={ariaLabel || 'Chọn ngày'} style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}>
          <div className="dp-head">
            <button type="button" className={'dp-title' + (mode === 'month' ? ' on' : '')} onClick={() => setMode(m => (m === 'day' ? 'month' : 'day'))}>
              {mode === 'day' ? 'Tháng ' + (view.m + 1) + ' ' + view.y : view.y}<Icon name="chevron" size={15} stroke={2.5} />
            </button>
            <span className="dp-nav">
              <button type="button" title={mode === 'day' ? 'Tháng trước' : 'Năm trước'} onClick={() => shift(mode === 'day' ? -1 : -12)}><Icon name="chevron" size={18} stroke={2.5} /></button>
              <button type="button" title={mode === 'day' ? 'Tháng sau' : 'Năm sau'} onClick={() => shift(mode === 'day' ? 1 : 12)}><Icon name="chevron" size={18} stroke={2.5} /></button>
            </span>
          </div>
          {body}
          <div className="dp-foot">
            <button type="button" disabled={off(today())} onClick={() => pick(today())}>Hôm nay</button>
            {clearable && value ? <button type="button" onClick={() => { onChange(''); setOpen(false) }}>Xoá</button> : null}
          </div>
        </div>
      )}
    </span>
  )
}
