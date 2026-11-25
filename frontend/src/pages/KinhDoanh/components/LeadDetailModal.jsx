import { STAGE_LABEL, DEPT_LABEL, HANDOFF_CONFIG } from '../../../data/kinhDoanhData'
import { FONT_STACK, fmtTy, stageAccent, lmInitials, boqOf } from '../utils'
import { useKdMap } from './ShortlistSelect'
import { mediaUrl } from '../../QS/api/files'
import RichNote from './RichNote'

/* ===================== Modal: Chi tiết lead (đầy đủ thông tin đã nhập từ modal +Thêm) ===================== */

const capLabel = mb => ({ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: mb })
const noteBox = { fontSize: 12.5, lineHeight: 1.6, background: 'var(--surface-alt)', borderRadius: 10, padding: '10px 12px', whiteSpace: 'pre-line', overflowWrap: 'anywhere' }

function LdRow({ label, value }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div>
      <div style={capLabel(3)}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{value}</div>
    </div>
  )
}

function PersonChip({ name, role }) {
  return (
    <span className="kd-lm-assignee-chip" style={{ marginRight: 0 }}>
      <span className="kd-aa-avatar">{lmInitials(name)}</span>{name}{role ? <span className="kd-aa-role">· {role}</span> : null}
    </span>
  )
}

/* Khối phụ trách: luôn hiện đủ 4 mục, mục chưa có dữ liệu hiện chữ mờ */
function OwnerRow({ label, children, emptyText }) {
  return (
    <div>
      <div style={capLabel(6)}>{label}</div>
      {children || <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{emptyText}</div>}
    </div>
  )
}

function Body({ l }) {
  const h = l.handoff
  const hasAssignees = l.assignees && l.assignees.length
  const hasCategories = l.categories && l.categories.length
  const projName = useKdMap('projName')[String(l.id)] || ''   // Tên dự án (kdOptions.projName)
  const att = useKdMap('attach')[String(l.id)] || {}   // Hình / tệp đính kèm (kdOptions.attach)
  const imgs = att.img || [], docs = att.file || []
  const empty = !imgs.length && !docs.length && !projName && !l.phone && !l.email && !l.source && !l.address && !l.scale && !hasCategories && !hasAssignees && !l.boqFile && !l.concept && !l.notes
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <OwnerRow label="Phòng phụ trách" emptyText="Chưa phân phòng">
          {DEPT_LABEL[l.dept] ? <div style={{ fontSize: 13, fontWeight: 600 }}>{DEPT_LABEL[l.dept]}</div> : null}
        </OwnerRow>
        <OwnerRow label="Người khởi tạo" emptyText="Chưa cập nhật">
          {l.creator ? <PersonChip name={l.creator} /> : null}
        </OwnerRow>
        <OwnerRow label="Quản lý" emptyText="Chưa cập nhật">
          {l.manager ? <PersonChip name={l.manager} /> : null}
        </OwnerRow>
        <OwnerRow label="Nhân viên phụ trách" emptyText="Chưa phân công">
          {hasAssignees ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {l.assignees.map((a, i) => <PersonChip key={i} name={a.name} role={a.role} />)}
            </div>
          ) : null}
        </OwnerRow>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {projName ? <div style={{ gridColumn: '1 / -1' }}><LdRow label="Tên dự án" value={projName} /></div> : null}
        <LdRow label="Số điện thoại" value={l.phone} />
        <LdRow label="Email" value={l.email} />
        <LdRow label="Nguồn khách hàng" value={l.source} />
        <LdRow label="Địa chỉ" value={l.address} />
        <LdRow label="Loại dự án" value={l.projectType || l.type} />
        <LdRow label="Quy mô" value={l.scale} />
        <LdRow label="Giá trị ước tính" value={fmtTy(l.value)} />
        {l.partner ? <LdRow label="Đối tác thi công/thiết kế" value={<span style={{ color: 'var(--primary)' }}>Có chuyển giao đối tác ngoài</span>} /> : null}
        {h && (h.status === 'pending-qs' || h.status === 'pending-handoff') ? (
          <LdRow label={HANDOFF_CONFIG[l.stage] ? HANDOFF_CONFIG[l.stage].title : 'Bàn giao / Báo giá'} value={
            <span style={{ color: 'var(--gold)' }}>
              Đang chờ Phòng {h.dept} xác nhận{h.requestedAt ? ' — hẹn ' + new Date(h.requestedAt).toLocaleString('vi-VN') : ''}{h.assignee ? ' — ' + h.assignee : ''}
            </span>
          } />
        ) : null}
        {h && h.status === 'self-quoted' ? <LdRow label="Bàn giao / Báo giá" value={<span style={{ color: 'var(--sales)' }}>Phòng KD tự đề xuất báo giá</span>} /> : null}
      </div>
      {hasCategories ? (
        <div>
          <div style={capLabel(6)}>Hạng mục quan tâm</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {l.categories.map(c => <span key={c} style={{ padding: '3px 10px', borderRadius: 20, background: 'var(--surface-alt)', fontSize: 11.5, fontWeight: 600 }}>{c}</span>)}
          </div>
        </div>
      ) : null}
      {l.boqFile ? (
        <div>
          <div style={capLabel(6)}>File đính kèm</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px', fontSize: 12.5, fontWeight: 600 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flex: 'none' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
            {(() => { const b = boqOf(l.boqFile); return b.url ? <a href={mediaUrl(b.url)} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>{b.name}</a> : b.name + ' · chưa tải file' })()}
          </div>
        </div>
      ) : null}
      {l.concept ? (
        <div>
          <div style={capLabel(6)}>Concept / Ý tưởng thiết kế</div>
          <div style={noteBox}>{l.concept}</div>
        </div>
      ) : null}
      {imgs.length || docs.length ? (
        <div>
          <div style={capLabel(6)}>Đính kèm</div>
          {imgs.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: docs.length ? 8 : 0 }}>
              {imgs.map((it, i) => (
                <a key={i} href={mediaUrl(it.url)} target="_blank" rel="noopener noreferrer" title={it.name} style={{ width: 64, height: 64, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', display: 'block' }}>
                  <img src={mediaUrl(it.url)} alt={it.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </a>
              ))}
            </div>
          ) : null}
          {docs.map((it, i) => (
            <div key={i} style={{ fontSize: 12.5, marginTop: 2 }}>📎 <a href={mediaUrl(it.url)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>{it.name}</a></div>
          ))}
        </div>
      ) : null}
      {l.notes ? (
        <div>
          <div style={capLabel(6)}>Ghi chú nội bộ</div>
          <div style={noteBox}><RichNote text={l.notes} /></div>
        </div>
      ) : null}
      {empty ? <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5, padding: '12px 0' }}>Lead này chưa có thông tin chi tiết (được tạo trước khi có form đầy đủ).</div> : null}
    </>
  )
}

export default function LeadDetailModal({ open, lead, onClose, onEdit }) {
  const accent = lead ? stageAccent(lead.stage) : null
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ display: open ? 'flex' : 'none', position: 'fixed', inset: 0, background: 'rgba(15,18,25,.5)', zIndex: 100, alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: 'var(--surface)', width: 640, maxWidth: '92vw', maxHeight: '88vh', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 30px 80px rgba(0,0,0,.35)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontFamily: FONT_STACK, fontWeight: 800, fontSize: 17 }}>{lead ? lead.name : ''}</div>
            <div style={{ display: 'inline-flex', marginTop: 6, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, ...(lead ? { background: accent ? accent.bg : 'var(--sales-tint)', color: accent ? accent.color : 'var(--sales)' } : null) }}>{lead ? STAGE_LABEL[lead.stage] : ''}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
            <button title="Chỉnh sửa / bổ sung thông tin" onClick={onEdit} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface-alt)', color: 'var(--text)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="M15 5l4 4" /></svg>
            </button>
            <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, flex: 'none' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 16, fontSize: 13 }}>
          {lead ? <Body l={lead} /> : null}
        </div>
      </div>
    </div>
  )
}
