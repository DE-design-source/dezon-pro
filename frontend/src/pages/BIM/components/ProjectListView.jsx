import { useState } from 'react'
import { Icon } from './shared'
import { useAccess } from '../../../services/accessService'

const NEW_PROJECT = '__new__'
const EMPTY_FORM = { project: NEW_PROJECT, fileName: '', newName: '', newCode: '', newClient: '' }

/* Modal "Thêm liên kết file SketchUp" */
function AddFileLinkModal({ projects, onClose, onSubmit }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, project: projects.length ? projects[0].code : NEW_PROJECT }))
  const bind = key => ({ value: form[key], onChange: e => setForm(f => ({ ...f, [key]: e.target.value })) })

  function submit() {
    const fileName = form.fileName.trim()
    if (!fileName) { alert('Vui lòng nhập tên file SketchUp (.skp).'); return }
    if (form.project === NEW_PROJECT && !form.newName.trim()) { alert('Vui lòng nhập tên dự án mới.'); return }
    onSubmit(form)
  }

  return (
    <div className="bim-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bim-modal" style={{ width: 440 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Thêm liên kết file SketchUp</h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px' }}>Khai báo file .skp thuộc dự án nào — sau đó mở file này trong SketchUp, bấm Scan trong Dezon Bim để đồng bộ dữ liệu thật.</p>

        <div className="bim-field" style={{ marginBottom: 14 }}>
          <label>Dự án</label>
          <select {...bind('project')}>
            {projects.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
            <option value={NEW_PROJECT}>+ Tạo dự án mới</option>
          </select>
        </div>

        {form.project === NEW_PROJECT && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 14, padding: 14, background: 'var(--surface-alt)', borderRadius: 10 }}>
            <div className="bim-field"><label>Tên dự án *</label><input type="text" placeholder="VD: Nhà phố Lô B12" {...bind('newName')} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="bim-field"><label>Mã dự án</label><input type="text" placeholder="VD: MOA-26-LB2" {...bind('newCode')} /></div>
              <div className="bim-field"><label>Chủ đầu tư</label><input type="text" placeholder="VD: Anh Quang Huy" {...bind('newClient')} /></div>
            </div>
          </div>
        )}

        <div className="bim-field" style={{ marginBottom: 14 }}>
          <label>Tên file SketchUp (.skp) *</label>
          <input type="text" placeholder="VD: Kết cấu.skp" {...bind('fileName')} />
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', background: 'var(--bim-tint)', borderRadius: 10, marginBottom: 6 }}>
          <Icon html={'<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'} size={15} stroke="var(--bim)" style={{ flex: 'none', marginTop: 1 }} />
          <span style={{ fontSize: 11.5, color: 'var(--bim)', lineHeight: 1.5 }}>Model GUID sẽ được Dezon Bim tự động gán khi bạn mở file này trong SketchUp và bấm "Scan / Đồng bộ" lần đầu.</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button className="bim-btn-ghost" onClick={onClose}>Hủy</button>
          <button className="bim-btn-dark" onClick={submit}>Liên kết file này</button>
        </div>
      </div>
    </div>
  )
}

/* Danh sách dự án đã đồng bộ từ Dezon Bim */
export default function ProjectListView({ visible, projects, onOpen, onUnlink, onAddFileLink }) {
  const { can } = useAccess()
  const [modalOpen, setModalOpen] = useState(false)

  function handleSubmit(form) {
    setModalOpen(false)
    onAddFileLink(form)
    alert(`Đã thêm liên kết "${form.fileName.trim()}". Mở file này trong SketchUp và bấm "Scan / Đồng bộ" trong Dezon Bim để lấy dữ liệu thật.`)
  }

  return (
    <div className="bim-view" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="bim-card" style={{ padding: '22px 24px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <span className="bim-badge success" style={{ gap: 5, display: 'inline-flex', alignItems: 'center', marginBottom: 8 }}>
            <Icon name="check" size={12} sw={3} />
            Đã liên kết Dezon Bim
          </span>
          <h2 className="bim-title">Chọn dự án để xem dữ liệu BIM</h2>
          <p className="bim-desc" style={{ maxWidth: 480 }}>Danh sách dự án đã đồng bộ từ Dezon Bim. Chọn một dự án để vào Objects, Level, Room/Space, BOQ...</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
          {can('bim', 'main', 'delete') && <button className="bim-btn-ghost" style={{ padding: '8px 12px', fontSize: 12 }} onClick={onUnlink}>Ngắt liên kết</button>}
          {can('bim', 'main', 'create') && (
            <button className="bim-btn-dark" style={{ padding: '9px 14px', fontSize: 12.5 }} onClick={() => setModalOpen(true)}>
              <Icon name="plus" stroke="#fff" sw={2.6} />
              Thêm liên kết file SketchUp
            </button>
          )}
        </div>
      </div>

      <div className="bim-card" style={{ padding: 4 }}>
        {projects.map(p => (
          <div key={p.code} className="bim-data-row" style={{ cursor: 'pointer' }} onClick={() => onOpen(p.code)}>
            <div className="bim-level-chip active" style={{ borderRadius: 9 }}>{p.code}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{p.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{p.projectCode} · {p.client}</div>
            </div>
            <div style={{ textAlign: 'center', width: 80 }}>
              <div className="mono" style={{ fontWeight: 700, fontSize: 13 }}>{p.models}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>models</div>
            </div>
            <div style={{ textAlign: 'center', width: 100 }}>
              <div className="mono" style={{ fontWeight: 700, fontSize: 13 }}>{p.objects.toLocaleString('vi-VN')}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>objects</div>
            </div>
            <div style={{ width: 120 }}>
              <div className="bim-track" style={{ height: 6 }}><div style={{ width: `${p.pct}%` }} /></div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{p.pct}% dữ liệu</div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 110, textAlign: 'right' }}>{p.lastSync}</span>
            <Icon name="chevronRight" size={16} stroke="var(--text-muted)" style={{ flex: 'none' }} />
          </div>
        ))}
      </div>

      {modalOpen && <AddFileLinkModal projects={projects} onClose={() => setModalOpen(false)} onSubmit={handleSubmit} />}
    </div>
  )
}
