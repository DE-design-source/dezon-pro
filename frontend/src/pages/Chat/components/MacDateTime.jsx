import { useEffect, useRef, useState } from 'react'

/* Chọn ngày giờ kiểu macOS (NSDatePicker, MarkUp 2026-11-16 hẹn giờ gửi): ô ngày dạng viên thuốc -> lịch tháng nhỏ nổi
   (‹ • › , ngày chọn = vòng tròn màu nhấn, hôm nay = chữ màu nhấn); ô giờ HH:MM chia 2 đoạn - bấm chọn đoạn, gõ số,
   phím ↑ ↓ hoặc nút tăng / giảm bên phải (phút bước 5). value / onChange: 'YYYY-MM-DDTHH:MM' giờ máy; min cùng dạng (tuỳ chọn) */
const pad = n => String(n).padStart(2, '0')
const DOW = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
const parse = v => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || ''); return m ? { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] } : null }
const fmt = p => p.y + '-' + pad(p.mo) + '-' + pad(p.d) + 'T' + pad(p.h) + ':' + pad(p.mi)

export default function MacDateTime({ value, onChange, min, ariaLabel }) {
  const p = parse(value) || parse(min) || (() => { const n = new Date(); return { y: n.getFullYear(), mo: n.getMonth() + 1, d: n.getDate(), h: n.getHours(), mi: 0 } })()
  const set = patch => onChange(fmt({ ...p, ...patch }))
  const [cal, setCal] = useState(false)
  const [pos, setPos] = useState(null)   // lịch nổi đặt cố định theo nút ngày (không bị khung cuộn cắt)
  const [view, setView] = useState({ y: p.y, mo: p.mo })
  const [seg, setSeg] = useState('mi')   // đoạn giờ đang chọn: 'h' | 'mi'
  const typed = useRef('')
  const box = useRef(null)
  useEffect(() => {
    if (!cal) return undefined
    const out = e => { if (box.current && !box.current.contains(e.target)) setCal(false) }
    document.addEventListener('mousedown', out)
    return () => document.removeEventListener('mousedown', out)
  }, [cal])
  const mn = parse(min)
  const minDay = mn ? mn.y * 10000 + mn.mo * 100 + mn.d : 0
  const now = new Date(); const today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate()
  const first = new Date(view.y, view.mo - 1, 1)
  const lead = (first.getDay() + 6) % 7
  const dim = new Date(view.y, view.mo, 0).getDate()
  const cells = Array.from({ length: lead }, () => 0).concat(Array.from({ length: dim }, (_, i) => i + 1))
  const go = n => setView(v => { const d = new Date(v.y, v.mo - 1 + n, 1); return { y: d.getFullYear(), mo: d.getMonth() + 1 } })
  const step = (k, dir) => {
    if (k === 'h') set({ h: (p.h + dir + 24) % 24 })
    else { const t = Math.round(p.mi / 5) * 5 + dir * 5; set({ mi: ((t % 60) + 60) % 60 }) }
  }
  const key = e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); typed.current = ''; step(seg, e.key === 'ArrowUp' ? 1 : -1) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === ':') { e.preventDefault(); typed.current = ''; setSeg(seg === 'h' ? 'mi' : 'h') }
    else if (/^\d$/.test(e.key)) {
      e.preventDefault()
      const t = (typed.current + e.key).slice(-2); typed.current = t
      const n = Number(t)
      if (seg === 'h') { set({ h: Math.min(23, n) }); if (t.length === 2 || n > 2) { typed.current = ''; setSeg('mi') } }
      else { set({ mi: Math.min(59, n) }); if (t.length === 2 || n > 5) typed.current = '' }
    }
  }
  return (
    <span className="mdt" ref={box} aria-label={ariaLabel}>
      <button type="button" className={'mdt-date' + (cal ? ' on' : '')} onClick={e => { setView({ y: p.y, mo: p.mo }); const r = e.currentTarget.getBoundingClientRect(); const up = r.bottom + 290 > window.innerHeight; setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 248)), ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) }); setCal(c => !c) }} aria-haspopup="dialog" aria-expanded={cal}>
        {pad(p.d)}/{pad(p.mo)}/{p.y}
      </button>
      <span className="mdt-time" tabIndex={0} role="group" aria-label="Giờ" onKeyDown={key} onBlur={() => { typed.current = '' }}>
        <span className={'mdt-seg' + (seg === 'h' ? ' on' : '')} onMouseDown={() => { typed.current = ''; setSeg('h') }}>{pad(p.h)}</span>:
        <span className={'mdt-seg' + (seg === 'mi' ? ' on' : '')} onMouseDown={() => { typed.current = ''; setSeg('mi') }}>{pad(p.mi)}</span>
      </span>
      <span className="mdt-step" aria-hidden="true">
        <button type="button" tabIndex={-1} onClick={() => step(seg, 1)}>▲</button>
        <button type="button" tabIndex={-1} onClick={() => step(seg, -1)}>▼</button>
      </span>
      {cal && (
        <div className="mdt-pop" role="dialog" aria-label="Chọn ngày" style={pos || undefined}>
          <div className="mdt-pop-h">
            <b>Tháng {view.mo} {view.y}</b>
            <span>
              <button type="button" aria-label="Tháng trước" onClick={() => go(-1)}>‹</button>
              <button type="button" aria-label="Hôm nay" className="dot" onClick={() => { const n = new Date(); setView({ y: n.getFullYear(), mo: n.getMonth() + 1 }) }}>●</button>
              <button type="button" aria-label="Tháng sau" onClick={() => go(1)}>›</button>
            </span>
          </div>
          <div className="mdt-grid">
            {DOW.map(d => <span key={d} className="dow">{d}</span>)}
            {cells.map((d, i) => {
              if (!d) return <span key={'e' + i} />
              const num = view.y * 10000 + view.mo * 100 + d
              const on = view.y === p.y && view.mo === p.mo && d === p.d
              const off = minDay && num < minDay
              return (
                <button key={num} type="button" disabled={!!off} className={'day' + (on ? ' on' : '') + (num === today ? ' today' : '')}
                  onClick={() => { set({ y: view.y, mo: view.mo, d }); setCal(false) }}>{d}</button>
              )
            })}
          </div>
        </div>
      )}
    </span>
  )
}
