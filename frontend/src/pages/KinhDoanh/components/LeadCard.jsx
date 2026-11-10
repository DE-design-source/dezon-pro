import { STAGES, STAGE_LABEL, DEPT_COLOR, DEPT_SHORT, DEPT_TINT } from '../../../data/kinhDoanhData'
import { fmtTy, stageAccent } from '../utils'
import CardMembers from './CardMembers'
import { RatingStars } from './CustomerPage'

/* Thẻ lead trong Kanban pipeline (renderKanban) */

const clamp2 = { display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', overflow: 'hidden' }
const pill = { fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 20, whiteSpace: 'nowrap' }

export default function LeadCard({ lead: l, dragging, onDragStart, onDragEnd, onOpen, onDelete, onMove, memberOpen, onToggleMember, onCloseMember, onAddAssignee, onRemoveAssignee }) {
  const stageId = l.stage
  const accent = stageAccent(stageId)
  const isLostStage = stageId === 'truot-thau' || stageId === 'spam' || stageId === 'khong-tham-gia'
  const isQuoteStage = stageId === 'bao-gia' || stageId === 'bao-gia-thi-cong'
  const h = l.handoff
  return (
    <div
      className={`kd-lead-card${dragging ? ' dragging' : ''}${memberOpen ? ' pop-open' : ''}`}
      draggable
      onDragStart={e => { e.dataTransfer.setData('text/plain', l.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(l.id) }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(l.id)}
      style={{
        cursor: 'pointer', height: 205, boxSizing: 'border-box', overflow: memberOpen ? 'visible' : 'hidden', position: 'relative', zIndex: memberOpen ? 30 : undefined,   // mở hộp người phụ trách: không cắt hộp, nổi trên thẻ khác
        ...(accent ? { borderColor: accent.border } : null),
        ...(isQuoteStage ? { borderColor: 'var(--danger)' } : null),
        ...(isLostStage ? { background: stageId === 'truot-thau' ? 'var(--danger-tint)' : 'var(--surface-alt)' } : null),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
        <div title={l.name} style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3, minHeight: 34, flex: 1, minWidth: 0, ...clamp2 }}>{l.name}</div>
        <button title="Xoá" onClick={e => { e.stopPropagation(); onDelete(l.id) }} style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, display: 'flex', flex: 'none' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-.9 14a2 2 0 0 1-2 1.9H7.9a2 2 0 0 1-2-1.9L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
        </button>
      </div>
      <div title={l.type} style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.3, minHeight: 30, ...clamp2 }}>{l.type}</div>
      <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 6, minHeight: 22, maxHeight: 48, overflow: 'hidden' }}>
        {/* chỉ 1 nhãn phòng ban: Dân dụng hoặc Dự án (bỏ chip '→ Dự án' dễ nhầm là 2 phòng) */}
        <span style={{ ...pill, color: DEPT_COLOR[l.dept], background: DEPT_TINT[l.dept] }}>{DEPT_SHORT[l.dept]}</span>
        {h && (h.status === 'pending-qs' || h.status === 'pending-handoff') && <span style={{ ...pill, color: 'var(--gold)', background: 'var(--gold-tint)' }}>⏳ Chờ {h.dept} xác nhận</span>}
        {h && h.status === 'self-quoted' && <span style={{ ...pill, color: 'var(--sales)', background: 'var(--sales-tint)' }}>KD tự đề xuất</span>}
      </div>
      <CardMembers lead={l} open={memberOpen} onToggle={onToggleMember} onClose={onCloseMember} onAdd={onAddAssignee} onRemove={onRemoveAssignee} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
        <span className="mono" style={{ fontSize: 12.5, color: 'var(--sales)', fontWeight: 700 }}>{fmtTy(l.value)}</span>
        <RatingStars id={String(l.id)} small />
      </div>
      <select
        value={stageId}
        onClick={e => e.stopPropagation()}
        onChange={e => onMove(l.id, e.target.value)}
        style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', fontSize: 10.5, padding: '5px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontFamily: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
      </select>
    </div>
  )
}
