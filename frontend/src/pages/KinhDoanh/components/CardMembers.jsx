import { useRef, useState } from 'react'
import { avatarColor, initialsOfK } from '../utils'

/* Hàng avatar người phụ trách trên thẻ lead + popover thêm/xoá (renderCardMembers / buildCardMemberPopover) */

function MemberPopover({ lead, onAdd, onRemove, onClose }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const nameRef = useRef(null)
  const assignees = lead.assignees || []

  function add() {
    const n = name.trim()
    if (!n) { nameRef.current.focus(); return }
    onAdd(lead.id, { name: n, role: role.trim() })
    /* Bản HTML dựng lại popover sau khi thêm → 2 ô nhập trở về rỗng */
    setName(''); setRole('')
  }
  function remove(i) {
    onRemove(lead.id, i)
    setName(''); setRole('')
  }

  return (
    <div className="kd-pjm-popover" draggable={false} onClick={e => e.stopPropagation()}>
      <div className="kd-pjm-title">Người phụ trách — {lead.name}</div>
      <div className="kd-pjm-list">
        {assignees.length
          ? assignees.map((a, i) => (
            <span className="kd-pjm-chip" key={i}>
              <span className="kd-pjm-avatar" style={{ background: avatarColor(a.name), marginRight: 0 }}>{initialsOfK(a.name)}</span>
              {a.name}{a.role ? <> <span style={{ opacity: 0.7 }}>· {a.role}</span></> : null}
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)', marginLeft: 2 }} onClick={() => remove(i)}>✕</span>
            </span>
          ))
          : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Chưa có người phụ trách</span>}
      </div>
      <input type="text" placeholder="Họ tên" ref={nameRef} value={name} onChange={e => setName(e.target.value)} />
      <input type="text" placeholder="Vai trò (VD: Sale phụ trách, Kỹ thuật...)" value={role} onChange={e => setRole(e.target.value)} />
      <div className="kd-pjm-actions">
        <button type="button" className="kd-pjm-btn" onClick={onClose}>Đóng</button>
        <button type="button" className="kd-pjm-btn primary" onClick={add}>Thêm</button>
      </div>
    </div>
  )
}

/* Không có onAdd (N21: không có quyền Sửa): chỉ hiện avatar, không có nút thêm / popover */
export default function CardMembers({ lead, open, onToggle, onClose, onAdd, onRemove }) {
  const assignees = lead.assignees || []
  const shown = assignees.slice(0, 3)
  const extra = assignees.length - shown.length
  return (
    <div className="kd-card-members" draggable={false} style={{ minHeight: 20 }}>
      <div className="kd-pjm-stack">
        {shown.map((a, i) => (
          <span key={i} className="kd-pjm-avatar" style={{ background: avatarColor(a.name) }} title={a.name + (a.role ? ' — ' + a.role : '')}>{initialsOfK(a.name)}</span>
        ))}
        {extra > 0 && <span className="kd-pjm-more" title={`${extra} người khác`}>+{extra}</span>}
      </div>
      {onAdd && <button type="button" className="kd-pjm-add-btn" title="Thêm người phụ trách" onClick={e => { e.stopPropagation(); onToggle(lead.id) }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 5v14M5 12h14" /></svg>
      </button>}
      {open && onAdd && <MemberPopover lead={lead} onAdd={onAdd} onRemove={onRemove} onClose={onClose} />}
    </div>
  )
}
