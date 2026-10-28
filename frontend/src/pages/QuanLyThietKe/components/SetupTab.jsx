import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ORG_ICON, ORG_HUB, INITIAL_ORG_PARALLEL, INITIAL_ORG_CHILDREN, ORG_EXTRA_COLORS, SUB_STATUS_LABEL,
} from '../../../data/quanLyThietKeData'
import { useMembers, MemberCell, FlowNodeMembers, FlowNodePopover } from './ProjectMembers'
import { ORG_CHILDREN_STORAGE_KEY, ORG_PARALLEL_STORAGE_KEY, readStoredOrgRow, writeStored } from './storage'
import { useDelivery, STATUS_OPTIONS, STATUS_STYLE, fmtTy } from '../delivery'

/* Ghi state xuống localStorage mỗi khi thay đổi (bỏ qua lần render đầu) */
function usePersist(key, value) {
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    writeStored(key, value)
  }, [key, value])
}

const SUBTABS = [
  { key: 'setup', label: 'Thiết lập chung' },
  { key: 'detail', label: 'Sơ đồ tổ chức' },
  { key: 'thauphu', label: 'Thầu phụ' },
]

const Svg = ({ size, stroke = 'currentColor', html }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: html }} />
)

const ICONS = {
  qs: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/>',
  gantt: '<rect x="3" y="5" width="12" height="3" rx="1"/><rect x="3" y="11" width="17" height="3" rx="1"/><rect x="3" y="17" width="8" height="3" rx="1"/>',
  pin: '<path d="M12 21s-7-7.5-7-12a7 7 0 0 1 14 0c0 4.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.3"/>',
  wallet: '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
  trophy: '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M17 4H7v4a5 5 0 0 0 10 0V4z"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  building: '<path d="M6 22V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v18"/><path d="M6 12h12M6 8h12M6 16h12"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-.9 14a2 2 0 0 1-2 1.9H7.9a2 2 0 0 1-2-1.9L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
}

const INIT_CARDS = [
  { color: 'qs', icon: ICONS.qs, title: 'QS', desc: 'Tạo hồ sơ bóc tách trống' },
  { color: 'primary', icon: ICONS.gantt, title: 'Tiến độ', desc: 'Khung Gantt mẫu theo loại hình' },
  { color: 'attendance', icon: ICONS.pin, title: 'Chấm công', desc: 'Địa điểm công trường từ địa chỉ' },
  { color: 'finance', icon: ICONS.wallet, title: 'Tài chính', desc: 'Ngân sách trống theo dự kiến' },
  { color: 'game', icon: ICONS.trophy, title: 'Nhiệm vụ', desc: 'Gán quy trình game hoá theo loại hình' },
  { color: 'primary', icon: ICONS.chat, title: 'Chat', desc: 'Tạo nhóm chat dự án tự động' },
]

const DEPT_FLOW = [
  { dept: 'kinh-doanh', color: 'sales', icon: ICONS.trend, name: 'Kinh doanh', desc: ['Đã chốt từ pipeline', 'Giá trị 8.5 tỷ'], to: '/kinh-doanh', link: 'Mở Kinh doanh ›' },
  { dept: 'qs', color: 'qs', icon: ICONS.qs, name: 'QS', desc: ['4 dự án con', '64,9tr đã bóc tách'], to: '/qs', link: 'Mở QS ›' },
  { dept: 'qldth', color: 'primary', icon: ICONS.gantt, name: 'Thi công', desc: ['58% hoàn thành', '17 công việc'], goto: 'tiendo', link: 'Mở Thi công ›' },
  { dept: 'hr', color: 'attendance', icon: ICONS.pin, name: 'HR', desc: ['128/150 có mặt', '3 địa điểm'], to: '/cham-cong', link: 'Mở HR ›' },
  { dept: 'tai-chinh', color: 'finance', icon: ICONS.wallet, name: 'Tài chính', desc: ['Chi 5.2 / 8.5 tỷ', '1 hoá đơn quá hạn'], to: '/tai-chinh', link: 'Mở Tài chính ›' },
  { dept: 'chat', color: 'primary', icon: ICONS.chat, name: 'Chat', desc: ['Nhóm Riverside GĐ2', '24 thành viên'], to: { pathname: '/chat', hash: '#g1' }, link: 'Mở nhóm chat ›' },
  { dept: 'nhiem-vu', color: 'game', icon: ICONS.trophy, name: 'Nhiệm vụ', desc: ['4/15 bước', '330/1.450 điểm'], goto: 'nhiemvu', link: 'Mở Nhiệm vụ ›' },
]

/* ---------------- Thiết lập chung ---------------- */
const FORM_KEYS = ['name', 'status', 'client', 'contact', 'email', 'phone', 'address', 'projectType', 'startDate', 'handoverDate', 'note']
function formOf(p) {
  const f = {}
  FORM_KEYS.forEach(k => { f[k] = (p && p[k]) || '' })
  f.contractValue = p && p.contractValueVnd ? String(p.contractValueVnd) : ''
  f.approvedBudget = p && p.approvedBudgetVnd ? String(p.approvedBudgetVnd) : ''
  return f
}
const toVnd = s => Number(String(s || '').replace(/[^\d]/g, '')) || 0
const groupVnd = s => { const n = toVnd(s); return n ? n.toLocaleString('vi-VN') : '' }

/* Dự án đang chọn (dùng chung cho cả trang): ô chọn dự án đặt ở đầu mỗi tab con */
export function ProjectPicker({ style }) {
  const dv = useDelivery()
  return (
    <select value={dv.currentId} onChange={e => dv.select(e.target.value)} style={style}>
      {!dv.projects.length && <option value="">— Chưa có dự án —</option>}
      {dv.projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
    </select>
  )
}

function SetupGeneral({ onGoto }) {
  const dv = useDelivery()
  const p = dv.current
  const [form, setForm] = useState(() => formOf(p))
  const [busy, setBusy] = useState(false)
  useEffect(() => { setForm(formOf(p)) }, [p && p.id, p && p.updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const setField = key => e => setForm(f => ({ ...f, [key]: e.target.value }))

  async function handleSave() {
    if (!p) return
    if (!form.name.trim()) { alert('Nhập tên dự án.'); return }
    setBusy(true)
    const { contractValue, approvedBudget, ...rest } = form
    const ok = await dv.updateProject({ ...rest, contractValueVnd: toVnd(contractValue), approvedBudgetVnd: toVnd(approvedBudget) })
    setBusy(false)
    if (ok) onGoto('tiendo')
  }
  async function handleDelete() {
    if (!p || !window.confirm(`Xoá dự án "${p.name}" cùng toàn bộ tiến độ, thành viên, thầu phụ? Không hoàn tác được.`)) return
    if (await dv.deleteProject(p.id)) onGoto('list')
  }

  const field = (label, key, extra) => (
    <div className="tk-field"><label>{label}</label><input type="text" value={form[key]} onChange={setField(key)} {...extra} /></div>
  )
  return (
    <>
      <div className="tk-card tk-setup-card">
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Thiết lập chung cho dự án</h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 18px' }}>
          Hồ sơ khách hàng tạo ở mục <Link to="/kinh-doanh" style={{ color: 'var(--sales)', fontWeight: 600 }}>Kinh doanh</Link>. Khi một khách hàng được kéo vào cột "Dự án (Thiết kế)" hoặc "Dự án (Thi công)" ở đó, dự án tự xuất hiện ở trang tương ứng, mang theo thông tin khách hàng và giá trị.
        </p>

        <div className="tk-field" style={{ marginBottom: 16 }}>
          <label>Chọn dự án cần thiết lập *</label>
          <ProjectPicker />
        </div>
        {!p ? <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Chưa có dự án để thiết lập.</p> : <>
          <div className="tk-field-grid">
            {field('Tên dự án *', 'name')}
            <div className="tk-field"><label>Trạng thái</label>
              <select value={form.status} onChange={setField('status')}>{STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </div>
          </div>

          <div className="tk-divider" style={{ margin: '4px 0 18px' }} />
          <h4 className="tk-section-title" style={{ marginBottom: 14 }}>
            Thông tin khách hàng {p.leadId ? <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--text-faint)' }}>— lấy từ Kinh doanh, sửa được</span> : null}
          </h4>
          <div className="tk-field-grid">{field('Tên chủ đầu tư', 'client')}{field('Người liên hệ', 'contact')}</div>
          <div className="tk-field-grid">{field('Email', 'email')}{field('Số điện thoại', 'phone')}</div>
          <div className="tk-field-grid">{field('Địa chỉ', 'address')}{field('Loại công trình', 'projectType')}</div>

          <div className="tk-divider" style={{ margin: '4px 0 18px' }} />
          <h4 className="tk-section-title" style={{ marginBottom: 14 }}>Thông tin quan trọng</h4>
          <div className="tk-field-grid">
            {field('Ngày khởi công', 'startDate', { type: 'date' })}
            {field('Ngày hoàn công (dự kiến)', 'handoverDate', { type: 'date' })}
          </div>
          <div className="tk-field-grid">
            {field('Giá trị hợp đồng (đồng)', 'contractValue', { placeholder: 'VD: 8.500.000.000', inputMode: 'numeric', onBlur: () => setForm(f => ({ ...f, contractValue: groupVnd(f.contractValue) })) })}
            {field('Ngân sách được duyệt (đồng)', 'approvedBudget', { placeholder: 'VD: 2.500.000.000', inputMode: 'numeric', onBlur: () => setForm(f => ({ ...f, approvedBudget: groupVnd(f.approvedBudget) })) })}
          </div>
          <div className="tk-field"><label>Ghi chú</label><textarea rows={3} placeholder="Yêu cầu đặc biệt từ khách hàng, lưu ý về mặt bằng..." value={form.note} onChange={setField('note')} /></div>
          {p.maDA && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>Dự án QS đã gắn: <Link to="/qs" style={{ color: 'var(--qs)', fontWeight: 600 }}>{p.maDA}</Link></p>}

          <div className="tk-divider" style={{ margin: '20px 0 18px' }} />
          <h4 className="tk-section-title" style={{ marginBottom: 4 }}>Sau khi lưu, dữ liệu vận hành sẽ được khởi tạo tới</h4>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px' }}>Không cần nhập lại thông tin khách hàng hay địa điểm ở từng module.</p>
          <div className="tk-init-grid">
            {INIT_CARDS.map(c => (
              <div key={c.title} className="tk-init-card">
                <div className="tk-init-icon" style={{ background: `var(--${c.color}-tint)`, color: `var(--${c.color})` }}><Svg size={17} html={c.icon} /></div>
                <div><div className="tk-init-title">{c.title}</div><div className="tk-init-desc">{c.desc}</div></div>
              </div>
            ))}
          </div>
        </>}
      </div>

      {p && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="tk-btn-ghost" style={{ marginRight: 'auto', color: 'var(--danger)' }} onClick={handleDelete}>Xoá dự án</button>
          <button className="tk-btn-ghost" onClick={() => { setForm(formOf(p)); onGoto('list') }}>Huỷ</button>
          <button className="tk-btn-project" style={{ padding: '10px 20px', fontWeight: 700 }} disabled={busy} onClick={handleSave}>{busy ? 'Đang lưu…' : 'Lưu thiết lập & mở tiến độ'}</button>
        </div>
      )}
    </>
  )
}

/* ---------------- Thầu phụ ---------------- */
const EMPTY_SUB = { name: '', scope: '', contact: '', phone: '', value: '' }

function Subcontractors() {
  const dv = useDelivery()
  const subs = (dv.detail && dv.detail.subcontractors) || []
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_SUB)
  const setField = key => e => setForm(f => ({ ...f, [key]: e.target.value }))

  async function submit() {
    const name = form.name.trim()
    if (!name) { alert('Vui lòng nhập tên nhà thầu phụ.'); return }
    if (!dv.currentId) { alert('Chọn dự án trước.'); return }
    const ok = await dv.addSubcontractor({
      name, scope: form.scope.trim(), contact: form.contact.trim(), phone: form.phone.trim(),
      valueVnd: Number(form.value.replace(/[^\d]/g, '')) || 0, status: 'pending',
    })
    if (!ok) return
    setForm(EMPTY_SUB)
    setModalOpen(false)
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ fontSize: 14.5, fontWeight: 700 }}>Thầu phụ</h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>Quản lý các nhà thầu phụ tham gia dự án.</p>
        </div>
        <ProjectPicker style={{ marginLeft: 'auto', marginRight: 10, border: '1px solid var(--border)', background: 'var(--surface-alt)', color: 'var(--text)', padding: '7px 10px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit' }} />
        <button className="tk-btn-project" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', fontWeight: 600 }} onClick={() => setModalOpen(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Thêm thầu phụ
        </button>
      </div>

      <div className="tk-card" style={{ padding: '6px 20px 16px', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Nhà thầu phụ', 'Hạng mục phụ trách', 'Người liên hệ', 'SĐT', 'Giá trị hợp đồng', 'Trạng thái', ''].map(h => <th key={h} className="tk-th">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {!subs.length && <tr><td className="tk-td" colSpan={7} style={{ color: 'var(--text-muted)' }}>{dv.currentId ? 'Chưa có thầu phụ.' : 'Chưa chọn dự án.'}</td></tr>}
            {subs.map(s => {
              const st = SUB_STATUS_LABEL[s.status] || SUB_STATUS_LABEL.pending
              return (
                <tr key={s.id}>
                  <td className="tk-td" style={{ fontWeight: 700 }}>{s.name}</td>
                  <td className="tk-td" style={{ color: 'var(--text-dim)' }}>{s.scope || 'Chưa xác định'}</td>
                  <td className="tk-td">{s.contact || '—'}</td>
                  <td className="tk-td mono">{s.phone || '—'}</td>
                  <td className="tk-td mono">{s.valueVnd ? s.valueVnd.toLocaleString('vi-VN') : '—'}</td>
                  <td className="tk-td">
                    <select value={s.status} onChange={e => dv.updateSubcontractor(s.id, { status: e.target.value })}
                      style={{ border: 'none', borderRadius: 999, padding: '3px 8px', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', background: st[2], color: st[1], cursor: 'pointer' }}>
                      {Object.entries(SUB_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
                    </select>
                  </td>
                  <td className="tk-td"><button className="tk-btn-ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => { if (window.confirm('Xoá thầu phụ "' + s.name + '"?')) dv.removeSubcontractor(s.id) }}>Xoá</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="tk-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}>
          <div className="tk-modal-box">
            <h3>Thêm thầu phụ</h3>
            <p className="tk-modal-sub">Bổ sung một nhà thầu phụ mới cho dự án.</p>
            <div className="tk-modal-field"><label>Tên nhà thầu phụ *</label><input type="text" placeholder="VD: Công ty Cơ điện Phúc An" value={form.name} onChange={setField('name')} /></div>
            <div className="tk-modal-field"><label>Hạng mục phụ trách</label><input type="text" placeholder="VD: Thi công M&E" value={form.scope} onChange={setField('scope')} /></div>
            <div className="tk-modal-field"><label>Người liên hệ</label><input type="text" placeholder="VD: Anh Hùng" value={form.contact} onChange={setField('contact')} /></div>
            <div className="tk-modal-field"><label>Số điện thoại</label><input type="text" placeholder="VD: 0909 xxx xxx" value={form.phone} onChange={setField('phone')} /></div>
            <div className="tk-modal-field"><label>Giá trị hợp đồng</label><input type="text" placeholder="VD: 850.000.000" value={form.value} onChange={setField('value')} /></div>
            <div className="tk-modal-actions">
              <button className="tk-modal-btn" onClick={() => setModalOpen(false)}>Huỷ</button>
              <button className="tk-modal-btn primary project" onClick={submit}>Thêm thầu phụ</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ---------------- Sơ đồ tổ chức ---------------- */
function OrgNode({ item, rowKey, idx, project, dragState, onDragStart, onDragEnd, onDrop }) {
  const isChildren = rowKey === 'children'
  const key = `${rowKey}-${idx}`
  const [over, setOver] = useState(false)
  return (
    <div
      className="tk-flow-node tk-org-node"
      draggable="true"
      style={{
        flex: isChildren ? '1' : 'none',
        ...(isChildren ? { minWidth: 150 } : { width: 170 }),
        opacity: dragState.current && dragState.current.key === key ? 0.4 : undefined,
        outline: over ? '2px dashed var(--project)' : undefined,
      }}
      onDragStart={() => onDragStart(rowKey, idx)}
      onDragEnd={onDragEnd}
      onDragOver={e => {
        if (!dragState.current || dragState.current.row !== rowKey) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); onDrop(rowKey, idx) }}
    >
      {isChildren && <div className="tk-flow-vline" style={{ height: 20 }} />}
      <div className="tk-flow-circle" style={{ background: `var(--${item.color}-tint)`, color: `var(--${item.color})`, ...(item.dashed ? { border: `2px dashed var(--${item.color})` } : {}) }}>
        <Svg size={20} html={item.icon} />
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, textAlign: 'center' }}>{item.label}</div>
      {item.caption && <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>{item.caption}</div>}
      <FlowNodeMembers project={project} dept={item.dept} />
      <FlowNodePopover project={project} dept={item.dept} />
    </div>
  )
}

function OrgChart({ project, onGoto }) {
  const { addDept } = useMembers()
  const [parallel, setParallel] = useState(() => readStoredOrgRow(ORG_PARALLEL_STORAGE_KEY, INITIAL_ORG_PARALLEL, ORG_ICON.dept))
  const [children, setChildren] = useState(() => readStoredOrgRow(ORG_CHILDREN_STORAGE_KEY, INITIAL_ORG_CHILDREN, ORG_ICON.dept))
  usePersist(ORG_PARALLEL_STORAGE_KEY, parallel)
  usePersist(ORG_CHILDREN_STORAGE_KEY, children)
  const [trashOver, setTrashOver] = useState(false)
  const [, forceRender] = useState(0)
  const dragSrc = useRef(null)
  const seq = useRef(0)

  const rowState = rowKey => rowKey === 'parallel' ? [parallel, setParallel] : [children, setChildren]

  function addOrgDept(rowKey) {
    const name = prompt('Tên bộ phận mới:', '')
    if (name === null || !name.trim()) return
    const color = ORG_EXTRA_COLORS[seq.current % ORG_EXTRA_COLORS.length]
    seq.current++
    const dept = `custom-${Date.now()}-${seq.current}`
    addDept({ value: dept, label: name.trim() })
    const [, setRow] = rowState(rowKey)
    setRow(prev => [...prev, {
      dept, label: name.trim(), color, icon: ORG_ICON.dept, removable: true,
      dashed: rowKey === 'parallel',
      caption: rowKey === 'parallel' ? 'Song song · không thuộc quyền' : undefined,
    }])
  }

  function handleDragStart(row, idx) {
    dragSrc.current = { row, idx, key: `${row}-${idx}` }
    forceRender(n => n + 1)
  }
  function handleDragEnd() {
    dragSrc.current = null
    forceRender(n => n + 1)
  }
  function handleDrop(row, targetIdx) {
    const src = dragSrc.current
    if (!src || src.row !== row) return
    dragSrc.current = null
    if (src.idx === targetIdx) { forceRender(n => n + 1); return }
    const [, setRow] = rowState(row)
    setRow(prev => {
      const arr = [...prev]
      const [moved] = arr.splice(src.idx, 1)
      arr.splice(targetIdx, 0, moved)
      return arr
    })
  }
  function handleTrashDrop(e) {
    e.preventDefault()
    setTrashOver(false)
    const src = dragSrc.current
    if (!src) return
    const [arr, setRow] = rowState(src.row)
    const item = arr[src.idx]
    dragSrc.current = null
    forceRender(n => n + 1)
    if (!item) return
    if (item.removable === false) {
      alert(`Không thể xoá bộ phận mặc định "${item.label}".`)
      return
    }
    if (confirm(`Xoá bộ phận "${item.label}"?`)) setRow(prev => prev.filter(x => x !== item))
  }

  const nodeProps = { project, dragState: dragSrc, onDragStart: handleDragStart, onDragEnd: handleDragEnd, onDrop: handleDrop }

  return (
    <div className="tk-card" style={{ padding: '26px 24px 30px' }}>
      <h3 style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 4, textAlign: 'center' }}>Sơ đồ tổ chức dự án</h3>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, maxWidth: 560 }}>Bổ nhiệm nhân sự phụ trách cho từng vai trò trong quy trình thiết kế. Kéo-thả các thẻ để sắp xếp lại trong cùng một hàng, hoặc thả vào biểu tượng thùng rác để xoá bộ phận tuỳ biến.</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
          <div
            className={`tk-org-trash${trashOver ? ' over' : ''}`}
            title="Kéo thẻ vào đây để xoá bộ phận"
            onDragOver={e => { if (!dragSrc.current) return; e.preventDefault(); setTrashOver(true) }}
            onDragLeave={() => setTrashOver(false)}
            onDrop={handleTrashDrop}
          >
            <Svg size={17} html={ICONS.trash} />
          </div>
          <button
            className="tk-btn-project"
            style={{ padding: '0 18px', height: 38, borderRadius: 10, fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', flex: 'none', display: 'flex', alignItems: 'center' }}
            onClick={() => {
              /* Lưu sơ đồ (giữ logic cũ) rồi quay về danh sách như bản HTML */
              writeStored(ORG_CHILDREN_STORAGE_KEY, children)
              writeStored(ORG_PARALLEL_STORAGE_KEY, parallel)
              onGoto('list')
            }}
          >Lưu sơ đồ tổ chức</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 4 }}>
          {parallel.map((item, i) => <OrgNode key={item.dept} item={item} rowKey="parallel" idx={i} {...nodeProps} />)}
        </div>
        <button className="tk-dashed-btn" style={{ marginTop: 6 }} onClick={() => addOrgDept('parallel')}>+ Thêm bộ phận song song</button>

        <div style={{ marginTop: 10 }}>
          <div className="tk-flow-node" style={{ flexDirection: 'column', alignItems: 'center', cursor: 'default' }}>
            <div className="tk-flow-circle" style={{ background: `var(--${ORG_HUB.color})`, color: '#fff', width: 56, height: 56, borderRadius: 16 }}>
              <Svg size={24} stroke="#fff" html={ORG_HUB.icon} />
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 8 }}>{ORG_HUB.label}</div>
            <FlowNodeMembers project={project} dept={ORG_HUB.dept} style={{ marginTop: 4 }} />
            <FlowNodePopover project={project} dept={ORG_HUB.dept} />
          </div>
        </div>

        <div className="tk-flow-vline" style={{ height: 26, marginTop: 10 }} />
        <div style={{ width: '100%', maxWidth: 900, height: 2, background: 'var(--border)' }} />

        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', width: '100%', maxWidth: 900, gap: 20 }}>
          {children.map((item, i) => <OrgNode key={item.dept} item={item} rowKey="children" idx={i} {...nodeProps} />)}
        </div>
        <button className="tk-dashed-btn" style={{ marginTop: 14 }} onClick={() => addOrgDept('children')}>+ Thêm bộ phận trực thuộc</button>
      </div>
    </div>
  )
}

function ProjectDetail({ onGoto }) {
  const dv = useDelivery()
  const p = dv.current
  if (!p) return <div className="tk-card" style={{ padding: 24, fontSize: 13, color: 'var(--text-muted)' }}>Chưa có dự án. Tạo ở tab "Danh sách dự án".</div>
  const project = p.id
  const statusColors = STATUS_STYLE[p.status] || STATUS_STYLE.nhap
  const d = { status: (STATUS_OPTIONS.find(o => o[0] === p.status) || STATUS_OPTIONS[0])[1], client: p.client || '—', contact: p.contact || '—', phone: p.phone || '—', email: p.email || '—',
    budget: fmtTy(p.approvedBudgetVnd || p.contractValueVnd) }

  return (
    <>
      <div className="tk-card" style={{ padding: '20px 24px', display: 'flex', justifyContent: 'space-between', gap: 20 }}>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--project-tint)', color: 'var(--project)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            <Svg size={26} html={ICONS.building} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="tk-display" style={{ fontWeight: 800, fontSize: 16 }}>{p.name}</div>
              <span className="tk-pill" style={{ background: statusColors[0], color: statusColors[1] }}>{d.status}</span>
              <ProjectPicker style={{ marginLeft: 'auto', flex: 'none', position: 'relative', zIndex: 2, border: '1px solid var(--border)', background: 'var(--surface-alt)', color: 'var(--text)', padding: '6px 10px', borderRadius: 7, fontSize: 11.5, fontFamily: 'inherit', cursor: 'pointer' }} />
            </div>
            <div style={{ display: 'flex', gap: 18, marginTop: 4, fontSize: 12.5 }}>
              <span><span style={{ color: 'var(--text-muted)' }}>Khách hàng: </span><strong>{d.client}</strong></span>
              <span><span style={{ color: 'var(--text-muted)' }}>Liên hệ: </span><strong>{d.contact}</strong></span>
              <span className="mono"><span style={{ color: 'var(--text-muted)' }}>SĐT: </span>{d.phone}</span>
              <span className="mono"><span style={{ color: 'var(--text-muted)' }}>Email: </span>{d.email}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, fontSize: 12.5 }}>
              <span style={{ color: 'var(--text-muted)' }}>Nhân sự tham gia:</span>
              <MemberCell project={project} />
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <div className="mono tk-display" style={{ fontWeight: 800, fontSize: 20 }}>{d.budget}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{p.approvedBudgetVnd ? 'Ngân sách duyệt' : 'Giá trị hợp đồng'}</div>
        </div>
      </div>

      <div className="tk-card" style={{ padding: '26px 24px 22px' }}>
        <h3 style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 20, textAlign: 'center' }}>Sơ đồ phòng ban</h3>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="tk-flow-circle" style={{ background: 'var(--project)', color: '#fff', width: 60, height: 60, borderRadius: 16 }}>
            <Svg size={28} stroke="#fff" html={ICONS.folder} />
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, marginTop: 6 }}>{p.name}</div>
          <div className="tk-flow-vline" style={{ height: 22, marginTop: 6 }} />
          <div style={{ width: '100%', maxWidth: 1140, height: 2, background: 'var(--border)' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: 1140, marginTop: 0 }}>
            {DEPT_FLOW.map(n => (
              <div key={n.dept} className="tk-flow-node">
                <div className="tk-flow-vline" style={{ height: 20 }} />
                <div className="tk-flow-circle" style={{ background: `var(--${n.color}-tint)`, color: `var(--${n.color})` }}><Svg size={22} html={n.icon} /></div>
                <div className="tk-flow-name">{n.name}</div>
                <div className="tk-flow-desc">{n.desc[0]}<br />{n.desc[1]}</div>
                <FlowNodeMembers project={project} dept={n.dept} />
                {n.to
                  ? <Link to={n.to} className="tk-flow-link" style={{ color: `var(--${n.color})` }}>{n.link}</Link>
                  : <span className="tk-flow-link" style={{ color: `var(--${n.color})` }} onClick={() => onGoto(n.goto)}>{n.link}</span>}
                <FlowNodePopover project={project} dept={n.dept} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <OrgChart project={project} onGoto={onGoto} />
    </>
  )
}

export default function SetupTab({ sub, onSubChange, onGoto }) {
  return (
    <>
      <div className="tk-create-subtabs">
        {SUBTABS.map(t => (
          <button key={t.key} className={`tk-create-subtab${sub === t.key ? ' active' : ''}`} onClick={() => onSubChange(t.key)}>{t.label}</button>
        ))}
      </div>

      <div className={`tk-create-subpanel${sub === 'setup' ? ' active' : ''}`}>
        <SetupGeneral onGoto={onGoto} />
      </div>
      <div className={`tk-create-subpanel${sub === 'thauphu' ? ' active' : ''}`}>
        <Subcontractors />
      </div>
      <div className={`tk-create-subpanel${sub === 'detail' ? ' active' : ''}`}>
        <ProjectDetail onGoto={onGoto} />
      </div>
    </>
  )
}
