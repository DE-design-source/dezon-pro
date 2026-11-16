import { useEffect, useRef, useState } from 'react'
import { DEPTS, DEPT_LABEL, TIME_FILTER_OPTIONS } from '../../../data/kinhDoanhData'

/* Bộ lọc phòng ban + mốc thời gian — xuất hiện ở cả tab Tổng quan và tab Pipeline,
   dùng chung một state (bản HTML đồng bộ 2 bộ điều khiển qua setDeptFilter / syncTimeFilterUI) */

const deptBtnStyle = active => ({
  border: 'none', cursor: 'pointer', padding: '7px 12px', fontSize: 12, fontWeight: 600,
  background: active ? 'var(--sales-tint)' : 'none', color: active ? 'var(--sales)' : 'var(--text-muted)', fontFamily: 'inherit',
})
const dateInputStyle = { border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px', fontSize: 12, background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit' }

export function DeptFilter({ dept, onChange }) {
  return (
    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      {[['all', 'Tất cả'], ...DEPTS.map(d => [d, DEPT_LABEL[d]])].map(([key, label]) => (
        <button key={key} className={dept === key ? 'active' : undefined} style={deptBtnStyle(dept === key)} onClick={() => onChange(key)}>{label}</button>
      ))}
    </div>
  )
}

/* pill: kiểu nút + hộp chọn như các bộ lọc sao / nguồn / nhân sự của thanh Pipeline (MarkUp 2026-11-16 18:03) */
export function TimeFilter({ filter, onChange, pill }) {
  if (pill) return <TimePill filter={filter} onChange={onChange} />
  return (
    <>
      <select
        value={filter.time}
        onChange={e => onChange({ ...filter, time: e.target.value })}
        style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontSize: 12, fontWeight: 600, background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer' }}
      >
        {TIME_FILTER_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <div style={{ display: filter.time === 'custom' ? 'flex' : 'none', alignItems: 'center', gap: 6 }}>
        <input type="date" value={filter.from} onChange={e => onChange({ ...filter, from: e.target.value })} style={dateInputStyle} />
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>→</span>
        <input type="date" value={filter.to} onChange={e => onChange({ ...filter, to: e.target.value })} style={dateInputStyle} />
      </div>
    </>
  )
}

const fmtD = iso => (iso ? iso.split('-').reverse().join('/') : '…')
function TimePill({ filter, onChange }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const out = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', out)
    return () => document.removeEventListener('mousedown', out)
  }, [open])
  const cur = TIME_FILTER_OPTIONS.find(o => o[0] === filter.time) || TIME_FILTER_OPTIONS[0]
  const label = filter.time === 'custom' ? fmtD(filter.from) + ' → ' + fmtD(filter.to) : cur[1]
  const pick = v => { onChange({ ...filter, time: v }); if (v !== 'custom') setOpen(false) }
  return (
    <div className="kd-pl-sdd" ref={box}>
      <button type="button" className={'kd-pl-sbtn' + (filter.time !== 'all' ? ' on' : '')} onClick={() => setOpen(o => !o)} aria-expanded={open} title={label}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
        <span>{label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div className="kd-pl-spop" role="listbox">
          {TIME_FILTER_OPTIONS.map(([v, lb]) => (
            <label key={v} className={filter.time === v ? 'on' : ''}>
              <input type="radio" name="kd-time" checked={filter.time === v} onChange={() => pick(v)} />
              <span className="st nm">{lb.replace('...', '')}</span>
            </label>
          ))}
          {filter.time === 'custom' && (
            <div className="kd-pl-trange">
              <input type="date" value={filter.from} max={filter.to || undefined} onChange={e => onChange({ ...filter, from: e.target.value })} aria-label="Từ ngày" />
              <span>→</span>
              <input type="date" value={filter.to} min={filter.from || undefined} onChange={e => onChange({ ...filter, to: e.target.value })} aria-label="Đến ngày" />
            </div>
          )}
          <div className="ft">
            <button type="button" onClick={() => { onChange({ ...filter, time: 'all' }); setOpen(false) }} disabled={filter.time === 'all'}>Bỏ lọc</button>
            <button type="button" className="pri" onClick={() => setOpen(false)}>Xong</button>
          </div>
        </div>
      )}
    </div>
  )
}
