import { useRef, useState } from 'react'
import { fmtTy } from '../utils'

/* Bảng con: Thiết kế & Thi công (kiểu Lark Base/Task) — renderSubBoard */

function AddCardRow({ onCommit }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const doneRef = useRef(false)

  function open() {
    if (editing) return
    doneRef.current = false
    setValue('')
    setEditing(true)
  }
  /* Enter / blur → lưu (nếu có tên); Escape → huỷ. doneRef chặn việc lưu 2 lần khi ô nhập bị gỡ khỏi DOM */
  function finish(save) {
    if (doneRef.current) return
    doneRef.current = true
    const name = value.trim()
    setEditing(false)
    if (save && name) onCommit(name)
  }

  return (
    <div onClick={open} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 2px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12 }}>
      {editing ? (
        <input
          type="text" autoFocus placeholder="Tên khách hàng / dự án, Enter để lưu"
          value={value} onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false) }}
          onBlur={() => finish(true)}
          style={{ width: '100%', padding: '7px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-alt)', color: 'var(--text)', fontSize: 12.5, fontFamily: 'inherit' }}
        />
      ) : (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Thêm thẻ
        </>
      )}
    </div>
  )
}

/* N21: không có onSetSub (không có quyền Sửa) -> không kéo thẻ; không có onAddCard (không có quyền Thêm) -> ẩn "Thêm thẻ" */
export default function SubBoard({ leads, parentStage, subStages, subLabel, subColor, onSetSub, onAddCard }) {
  const [draggingId, setDraggingId] = useState(null)
  const [hoverSub, setHoverSub] = useState(null)
  const items = leads.filter(l => l.stage === parentStage)

  return (
    <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 }}>
      {subStages.map(sub => {
        const cards = items.filter(l => (l.sub || subStages[0]) === sub)
        const color = subColor[sub]
        return (
          <div
            key={sub}
            className={`kd-stage-col${hoverSub === sub ? ' drop-hover' : ''}`}
            style={{ minWidth: 230 }}
            onDragOver={onSetSub ? e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (hoverSub !== sub) setHoverSub(sub) } : undefined}
            onDragLeave={onSetSub ? () => setHoverSub(cur => (cur === sub ? null : cur)) : undefined}
            onDrop={onSetSub ? e => {
              e.preventDefault()
              setHoverSub(null)
              setDraggingId(null)
              onSetSub(e.dataTransfer.getData('text/plain'), sub)
            } : undefined}
          >
            <div style={{ height: 4, borderRadius: 4, background: color, marginBottom: 8 }} />
            <div className="kd-stage-head">
              <span style={{ fontWeight: 700, fontSize: 13, color }}>{subLabel[sub]}</span>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{cards.length}</span>
            </div>
            <div style={{ minHeight: 30, borderRadius: 8 }}>
              {cards.map(l => (
                <div
                  key={l.id}
                  className={`kd-lead-card${draggingId === l.id ? ' dragging' : ''}`}
                  draggable={!!onSetSub}
                  onDragStart={onSetSub ? e => { e.dataTransfer.setData('text/plain', l.id); e.dataTransfer.effectAllowed = 'move'; setDraggingId(l.id) } : undefined}
                  onDragEnd={onSetSub ? () => setDraggingId(null) : undefined}
                  style={{ cursor: onSetSub ? 'grab' : 'default', borderLeft: `3px solid ${color}`, minHeight: 74, boxSizing: 'border-box' }}
                >
                  <div title={l.name} style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                  <div title={l.type} style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.type}</div>
                  <div className="mono" style={{ fontSize: 12.5, color: 'var(--sales)', fontWeight: 700, marginTop: 2 }}>{fmtTy(l.value)}</div>
                </div>
              ))}
            </div>
            {onAddCard && <AddCardRow onCommit={name => onAddCard(name, parentStage, sub)} />}
          </div>
        )
      })}
    </div>
  )
}
