import { useEffect, useState } from 'react'
import { MrootPortal } from '../../common/Mroot'
import '../../common/common.css'
import './sheet.css'

/* Hộp "Thay đổi kích thước hàng & cột" (như Google Sheets, gộp 1 bảng): mỗi phần (Hàng / Cột) có công tắc áp dụng,
   phạm vi (1 hàng / cột, tất cả…) và kích thước (số px hoặc "Phù hợp với dữ liệu").
   Props: title, parts = [{ id: 'row' | 'col', t: 'Hàng', unit, value (px hiện tại), min, scopes [[giá trị, nhãn]], on (bật sẵn) }],
          onApply({ row?: {px | null, scope}, col?: {px | null, scope} }), onClose() */
function Part({ p, st, set }) {
  const n = Math.round(Number(st.px))
  return (
    <div className={`qs-rsz-part${st.on ? '' : ' off'}`}>
      <label className="qs-rsz-ph">
        <input type="checkbox" checked={st.on} onChange={e => set({ on: e.target.checked })} />
        <span>{p.t}</span>
      </label>
      <div className="qs-rsz-pb">
        <div className="qs-rsz-cap">Áp dụng cho</div>
        {p.scopes.map(([v, lb]) => (
          <label key={v} className="qs-rsz-opt">
            <input type="radio" name={'qs-rsz-scope-' + p.id} disabled={!st.on} checked={st.scope === v} onChange={() => set({ scope: v })} />
            <span>{lb}</span>
          </label>
        ))}
        <div className="qs-rsz-cap">Kích thước</div>
        <label className="qs-rsz-opt">
          <input type="radio" name={'qs-rsz-mode-' + p.id} disabled={!st.on} checked={st.mode === 'px'} onChange={() => set({ mode: 'px' })} />
          <span>Chỉ định {p.unit}</span>
        </label>
        <div className="qs-rsz-px">
          <input type="number" min={p.min} max={2000} value={st.px} disabled={!st.on || st.mode !== 'px'}
            onChange={e => set({ px: e.target.value, mode: 'px' })} />
          <span>pixel (tối thiểu {p.min}){st.on && st.mode === 'px' && !(n >= p.min && n <= 2000) ? ' — chưa hợp lệ' : ''}</span>
        </div>
        <label className="qs-rsz-opt">
          <input type="radio" name={'qs-rsz-mode-' + p.id} disabled={!st.on} checked={st.mode === 'fit'} onChange={() => set({ mode: 'fit' })} />
          <span>Phù hợp với dữ liệu</span>
        </label>
      </div>
    </div>
  )
}

export default function ResizeDialog({ title = 'Thay đổi kích thước hàng & cột', parts, onApply, onClose }) {
  const [st, setSt] = useState(() => {
    const o = {}
    parts.forEach(p => { o[p.id] = { on: !!p.on, scope: p.scopes[0][0], mode: 'px', px: String(Math.round(p.value || p.min)) } })
    return o
  })
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  const bad = parts.some(p => { const s = st[p.id]; const n = Math.round(Number(s.px)); return s.on && s.mode === 'px' && !(n >= p.min && n <= 2000) })
  const any = parts.some(p => st[p.id].on)
  function ok() {
    if (bad || !any) return
    const out = {}
    parts.forEach(p => { const s = st[p.id]; if (s.on) out[p.id] = { px: s.mode === 'px' ? Math.round(Number(s.px)) : null, scope: s.scope } })
    onApply(out)
    onClose()
  }
  return (
    <MrootPortal>
      <div className="qsc-ov" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className={`qsc-dlg qs-rsz-dlg${parts.length > 1 ? ' two' : ''}`} role="dialog" aria-modal="true"
          onKeyDown={e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') ok() }}>
          <div className="qs-rsz-h">
            <h3>{title}</h3>
            <button type="button" className="qsc-x" onClick={onClose}>✕</button>
          </div>
          <div className="qs-rsz-parts">
            {parts.map(p => <Part key={p.id} p={p} st={st[p.id]} set={v => setSt(o => ({ ...o, [p.id]: { ...o[p.id], ...v } }))} />)}
          </div>
          <div className="qs-rsz-f">
            <button type="button" className="qsc-btn blue" disabled={bad || !any} onClick={ok}>OK</button>
            <button type="button" className="qsc-btn" onClick={onClose}>Huỷ</button>
          </div>
        </div>
      </div>
    </MrootPortal>
  )
}
