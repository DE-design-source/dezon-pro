import { useEffect, useRef, useState } from 'react'
import QsIcon from '../common/QsIcon'

/* Nút "Cột hiển thị n/N" + nút bộ cột nhanh của bảng Tài khoản (dáng như .qs-colmod trên băng dự án).
   Props: cols = [[key, nhãn, fixed?]] các cột đang có, vis = Set key đang hiện, onChange(Set), presets = [[tên, [key...]]]. */
export default function UserColPicker({ cols, vis, onChange, presets }) {
  const [open, setOpen] = useState('')   // '' | 'cols' | 'preset'
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const off = e => { if (ref.current && !ref.current.contains(e.target)) setOpen('') }
    const esc = e => { if (e.key === 'Escape') setOpen('') }
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  const nOn = cols.filter(c => c[2] || vis.has(c[0])).length
  const toggle = k => { const n = new Set(vis); if (n.has(k)) n.delete(k); else n.add(k); onChange(n) }
  const same = keys => cols.every(c => c[2] || (keys.indexOf(c[0]) >= 0) === vis.has(c[0]))
  return (
    <span className="qsa-colmod" ref={ref} role="group" aria-label="Cột hiển thị">
      <button type="button" className={`qsa-colmod-b${open === 'cols' ? ' on' : ''}`} aria-expanded={open === 'cols'}
        onClick={() => setOpen(o => (o === 'cols' ? '' : 'cols'))}>
        Cột hiển thị <b>{nOn}/{cols.length}</b>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={open === 'cols' ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'} /></svg>
      </button>
      <span className="qsa-colmod-sep" />
      <button type="button" className={`qsa-colmod-i${open === 'preset' ? ' on' : ''}`} title="Chọn nhanh bộ cột" aria-expanded={open === 'preset'}
        onClick={() => setOpen(o => (o === 'preset' ? '' : 'preset'))}><QsIcon name="sliders" size={15} /></button>

      {open === 'cols' ? (
        <div className="qsa-colmod-pop" role="menu">
          {cols.map(c => (
            <label key={c[0]} className={`qsa-colmod-it${c[2] ? ' fixed' : ''}`} title={c[2] ? 'Cột luôn hiện' : undefined}>
              <input type="checkbox" checked={!!c[2] || vis.has(c[0])} disabled={!!c[2]} onChange={() => toggle(c[0])} />
              <span>{c[1]}</span>
            </label>
          ))}
          <div className="qsa-colmod-ft">
            <button type="button" onClick={() => onChange(new Set(cols.map(c => c[0])))}>Hiện tất cả</button>
          </div>
        </div>
      ) : null}
      {open === 'preset' ? (
        <div className="qsa-colmod-pop right" role="menu">
          {presets.map(p => (
            <button key={p[0]} type="button" className={`qsa-colmod-pre${same(p[1]) ? ' on' : ''}`}
              onClick={() => { onChange(new Set(p[1])); setOpen('') }}>
              {same(p[1]) ? <QsIcon name="check" size={12} /> : <i />}{p[0]}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  )
}
