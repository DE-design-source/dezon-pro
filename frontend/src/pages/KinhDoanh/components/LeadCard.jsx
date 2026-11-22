import { DEPT_COLOR, DEPT_SHORT, DEPT_TINT } from '../../../data/kinhDoanhData'
import { fmtTy, stageAccent, sourceColor } from '../utils'
import CardMembers from './CardMembers'
import { RatingStars } from './CustomerPage'
import { useKdMap } from './ShortlistSelect'

/* Thẻ lead trong Kanban pipeline (renderKanban) */

const clamp2 = { display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', overflow: 'hidden' }
const pill = { fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 20, whiteSpace: 'nowrap' }
/* Quy mô gõ tự do: chỉ là số thì thêm đơn vị m2 */
const fmtScale = s => (/^\d+([.,]\d+)?$/.test(String(s).trim()) ? String(s).trim() + ' m²' : String(s).trim())

/* onMove giữ trong chữ ký cho caller cũ (đã bỏ ô chọn giai đoạn trên thẻ: màu kanban đã cho biết giai đoạn) */
/* projMode (lọc Phòng KD Dự Án, MarkUp 2026-11-19): dòng 1 = Tên dự án, dòng 2 = Chủ đầu tư,
   dòng 3 = Người phụ trách bên CĐT (= tên khách) · chức vụ (kdOptions.cdtContact) */
/* readOnly (N21: không có quyền Sửa): không kéo thẻ, không đổi người phụ trách / số sao; không có onDelete: ẩn nút xoá */
export default function LeadCard({ lead: l, projMode, dups, dragging, onDragStart, onDragEnd, onOpen, onDelete, onMove, memberOpen, onToggleMember, onCloseMember, onAddAssignee, onRemoveAssignee, readOnly }) {
  const stageId = l.stage
  const accent = stageAccent(stageId)
  const isLostStage = stageId === 'truot-thau' || stageId === 'spam' || stageId === 'khong-tham-gia'
  const isQuoteStage = stageId === 'bao-gia' || stageId === 'bao-gia-thi-cong'
  const h = l.handoff
  /* Tỉnh / TP lưu chung công ty ở kdOptions.geo {mã lead: {kv, tinh}} (LeadModal) */
  const geo = useKdMap('geo')[String(l.id)] || {}
  const noi = geo.tinh || geo.kv || ''
  const addr = String(l.address || '').trim()
  const noiTitle = [geo.kv, geo.tinh, addr].filter(Boolean).join(' · ')
  const srcC = l.source ? sourceColor(l.source) : null
  const dupList = Array.isArray(dups) ? dups : []
  const projName = String(useKdMap('projName')[String(l.id)] || '').trim()
  const investor = String(useKdMap('investor')[String(l.id)] || '').trim()
  const cdt = useKdMap('cdtContact')[String(l.id)] || {}
  const contact = [l.name, cdt.role].map(x => String(x || '').trim()).filter(Boolean).join(' · ')
  const title = projMode && projName ? projName : l.name
  const dupPill = dupList.length > 0 && <span title={'Trùng SĐT/email với: ' + dupList.map(d => (d.name || '') + (d.source ? ' (' + d.source + ')' : '')).join(', ')} style={{ ...pill, color: 'var(--danger)', background: 'var(--danger-tint)' }}>⚠ Trùng {dupList.length}</span>
  const pendingPill = h && (h.status === 'pending-qs' || h.status === 'pending-handoff') && <span style={{ ...pill, color: 'var(--gold)', background: 'var(--gold-tint)' }}>⏳ Chờ {h.dept} xác nhận</span>
  const muted = { opacity: 0.6 }
  return (
    <div
      className={`kd-lead-card${dragging ? ' dragging' : ''}${memberOpen ? ' pop-open' : ''}`}
      draggable={!readOnly}
      onDragStart={readOnly ? undefined : e => { e.dataTransfer.setData('text/plain', l.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(l.id) }}
      onDragEnd={readOnly ? undefined : onDragEnd}
      onClick={() => onOpen(l.id)}
      style={{
        cursor: 'pointer', minHeight: 200,   /* bỏ ô chọn giai đoạn: 236 -> 200; minHeight (không cố định height): cỡ chữ lớn / thêm dòng tỉnh thành không bị cắt chữ (MarkUp 2026-11-16 16:41) */ boxSizing: 'border-box', overflow: memberOpen ? 'visible' : 'hidden', position: 'relative', zIndex: memberOpen ? 30 : undefined,   // mở hộp người phụ trách: không cắt hộp, nổi trên thẻ khác
        ...(accent ? { borderColor: accent.border } : null),
        ...(isQuoteStage ? { borderColor: 'var(--danger)' } : null),
        ...(isLostStage ? { background: stageId === 'truot-thau' ? 'var(--danger-tint)' : 'var(--surface-alt)' } : null),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
        <div title={projMode ? (projName ? 'Dự án: ' + projName + ' - Khách: ' : 'Chưa có tên dự án - Khách: ') + l.name : l.name} style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3, minHeight: 34, flex: 1, minWidth: 0, ...clamp2 }}>{title}</div>
        {onDelete && <button title="Xoá" onClick={e => { e.stopPropagation(); onDelete(l.id) }} style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, display: 'flex', flex: 'none' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-.9 14a2 2 0 0 1-2 1.9H7.9a2 2 0 0 1-2-1.9L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
        </button>}
      </div>
      {projMode ? (
        <>
          <div title={investor ? 'Chủ đầu tư: ' + investor : ''} style={{ fontSize: 11.5, color: 'var(--text)', lineHeight: 1.3, minHeight: 30, ...clamp2 }}>
            {investor ? <><span style={{ color: 'var(--text-muted)' }}>CĐT: </span><b style={{ fontWeight: 600 }}>{investor}</b></> : <span style={{ ...muted, color: 'var(--text-muted)' }}>Chưa có thông tin chủ đầu tư</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, minHeight: 22, maxHeight: 48, overflow: 'hidden', fontSize: 11.5 }}>
            <span title={contact ? 'Người phụ trách (CĐT): ' + [contact, cdt.dept].filter(Boolean).join(' · ') : ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, maxWidth: '100%', color: contact ? 'var(--text)' : 'var(--text-muted)', fontWeight: contact ? 600 : 400 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact || <span style={muted}>Chưa có người phụ trách</span>}</span>
            </span>
            {dupPill}
            {pendingPill}
          </div>
          {/* gạch ngang chia phần: thông tin dự án (tên / CĐT / người phụ trách) | phần còn lại (MarkUp 2026-11-19) */}
          <div aria-hidden="true" style={{ flex: 'none', height: 0, borderTop: '1px solid var(--border)', margin: '2px 0' }} />
        </>
      ) : (<>
      {/* loại công trình · quy mô m2 (MarkUp 2026-11-16 16:16) */}
      <div title={l.type} style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.3, minHeight: 30, ...clamp2 }}>
        {l.projectType || 'Chưa xác định'}{' · '}
        {l.scale ? <b style={{ fontWeight: 600, color: 'var(--text)' }}>{fmtScale(l.scale)}</b> : <span style={{ opacity: 0.6 }}>chưa có m²</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 6, minHeight: 22, maxHeight: 48, overflow: 'hidden' }}>
        {/* chỉ 1 nhãn phòng ban: Dân dụng hoặc Dự án (bỏ chip '→ Dự án' dễ nhầm là 2 phòng) */}
        <span style={{ ...pill, color: DEPT_COLOR[l.dept], background: DEPT_TINT[l.dept] }}>{DEPT_SHORT[l.dept]}</span>
        {/* khách trùng SĐT / email: đặt ngay sau phòng ban để không bị ẩn bởi maxHeight */}
        {dupPill}
        {/* nguồn khách hàng: màu riêng theo nguồn (sourceColor) */}
        {l.source ? <span title={'Nguồn: ' + l.source} style={{ ...pill, fontWeight: 700, color: srcC ? srcC.color : 'var(--text-muted)', background: srcC ? srcC.bg : 'var(--surface-alt)', border: srcC ? '1px solid ' + srcC.border : undefined, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.source}</span> : null}
        {pendingPill}
        {h && h.status === 'self-quoted' && <span style={{ ...pill, color: 'var(--sales)', background: 'var(--sales-tint)' }}>KD tự đề xuất</span>}
      </div>
      </>)}
      <CardMembers lead={l} open={memberOpen} onToggle={onToggleMember} onClose={onCloseMember} onAdd={readOnly ? undefined : onAddAssignee} onRemove={onRemoveAssignee} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
        <span className="mono" style={{ fontSize: 12.5, color: 'var(--sales)', fontWeight: 700 }}>{fmtTy(l.value)}</span>
        <RatingStars id={String(l.id)} small readOnly={readOnly} />
      </div>
      {/* địa chỉ công trình: đậm, to (thông tin quan trọng khi chọn thầu); tỉnh · địa chỉ chi tiết */}
      <div title={noiTitle} style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, flex: 'none', minHeight: 19, lineHeight: 1.5, fontSize: 12.5, fontWeight: 700, color: noi || addr ? 'var(--text)' : 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
        {noi || addr ? (
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {noi}
            {addr ? <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)' }}>{(noi ? ' · ' : '') + addr}</span> : null}
          </span>
        ) : <span style={{ opacity: 0.6, fontSize: 11, fontWeight: 400 }}>Chưa có tỉnh thành</span>}
      </div>
    </div>
  )
}
