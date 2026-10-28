import { Fragment, useEffect, useRef, useState } from 'react'
import {
  LEAD_STEPS, LEAD_STEP_TITLE, LEAD_STEP_TAB_LABEL, LEAD_SOURCES, LEAD_PROJECT_TYPES, LEAD_DEPT_OPTIONS,
  LEAD_STAGE_OPTIONS, LEAD_CATEGORY_GROUPS, LEAD_CATEGORIES, BOQ_DEFAULT_LABEL,
} from '../../../data/kinhDoanhData'
import { FONT_STACK, lmInitials } from '../utils'
import { listQsProjects } from '../api'

/* ===================== Modal thêm / chỉnh sửa khách hàng tiềm năng (3 cấp độ) =====================
   Component được mount sẵn (ẩn bằng display) như bản HTML; trang cha đổi `key` mỗi lần mở
   để form nạp lại dữ liệu — tương đương openLeadModal(leadId) gán lại toàn bộ ô nhập. */

const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }
const stepStyle = active => ({ display: active ? 'flex' : 'none', flexDirection: 'column', gap: 14 })
const closeIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>

function initForm(lead, me) {
  return {
    name: lead ? lead.name : '',
    phone: lead ? (lead.phone || '') : '',
    email: lead ? (lead.email || '') : '',
    address: lead ? (lead.address || '') : '',
    scale: lead ? (lead.scale || '') : '',
    value: lead && lead.valueVnd ? String(lead.valueVnd / 1e9) : '',
    concept: lead ? (lead.concept || '') : '',
    notes: lead ? (lead.notes || '') : '',
    partner: lead ? !!lead.partner : false,
    source: lead && lead.source ? lead.source : 'Giới thiệu',
    dept: lead ? (lead.dept || 'dan-dung') : 'dan-dung',
    creator: lead ? (lead.creator || '') : (me || ''),
    manager: lead ? (lead.manager || '') : (me || ''),
    maDA: lead ? (lead.maDA || '') : '',
    type: lead && lead.projectType ? lead.projectType : 'Nhà phố',
    stage: lead ? lead.stage : 'tiep-can',
    categories: lead && lead.categories ? LEAD_CATEGORIES.filter(c => lead.categories.indexOf(c) !== -1) : [],
  }
}

export default function LeadModal({ open, lead, me, onClose, onSave }) {
  const [form, setForm] = useState(() => initForm(lead, me))
  const [qsProjects, setQsProjects] = useState(null) // null = đang tải
  const [step, setStep] = useState(0)
  const [boqFile, setBoqFile] = useState(lead ? (lead.boqFile || '') : '')
  const [assignees, setAssignees] = useState(lead && lead.assignees ? lead.assignees.slice() : [])
  const [assigneeOpen, setAssigneeOpen] = useState(false)
  const [assigneeName, setAssigneeName] = useState('')
  const [assigneeRole, setAssigneeRole] = useState('')
  const [catPos, setCatPos] = useState(null) // vị trí popover hạng mục (null = đóng)
  const [nameFocusTick, setNameFocusTick] = useState(0)
  const [assigneeFocusTick, setAssigneeFocusTick] = useState(0)
  const overlayRef = useRef(null)
  const nameRef = useRef(null)
  const assigneeNameRef = useRef(null)

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))
  const stepId = LEAD_STEPS[step]
  const isLast = step === LEAD_STEPS.length - 1

  useEffect(() => {
    if (!open) return
    listQsProjects().then(ps => setQsProjects(ps || []), () => setQsProjects([]))
  }, [open])
  useEffect(() => { if (nameFocusTick && nameRef.current) nameRef.current.focus() }, [nameFocusTick])
  useEffect(() => { if (assigneeFocusTick && assigneeNameRef.current) assigneeNameRef.current.focus() }, [assigneeFocusTick])

  /* Bấm ra ngoài → đóng 2 popover; cuộn trong modal → đóng popover hạng mục */
  useEffect(() => {
    const closeAll = () => { setAssigneeOpen(false); setCatPos(null) }
    const closeCat = () => setCatPos(null)
    const overlay = overlayRef.current
    document.addEventListener('click', closeAll)
    overlay.addEventListener('scroll', closeCat, true)
    return () => {
      document.removeEventListener('click', closeAll)
      overlay.removeEventListener('scroll', closeCat, true)
    }
  }, [])

  function pickBoq() {
    const name = window.prompt('Tên file BOQ (mô phỏng tải lên):', 'BOQ_du_toan.xlsx')
    if (name === null || !name.trim()) return
    setBoqFile(name.trim())
  }

  function toggleAssigneePopover(e) {
    e.stopPropagation()
    setAssigneeName(''); setAssigneeRole('')
    if (!assigneeOpen) setAssigneeFocusTick(t => t + 1)
    setAssigneeOpen(!assigneeOpen)
  }
  function addAssignee() {
    const name = assigneeName.trim()
    const role = assigneeRole.trim()
    if (!name) { assigneeNameRef.current.focus(); return }
    setAssignees(list => [...list, { name, role }])
    setAssigneeName(''); setAssigneeRole('')
    assigneeNameRef.current.focus()
  }

  function toggleCatPopover(e) {
    e.stopPropagation()
    if (catPos) { setCatPos(null); return }
    const r = e.currentTarget.getBoundingClientRect()
    setCatPos({ left: r.left, width: r.width, top: r.bottom + 4, maxHeight: Math.min(420, window.innerHeight - r.bottom - 16) })
  }
  function toggleCat(value, checked) {
    setForm(f => {
      const has = f.categories.indexOf(value) !== -1
      if (checked === has) return f
      /* Giữ thứ tự theo danh sách checkbox như bản HTML (querySelectorAll('.lm-cat:checked')) */
      const next = checked ? [...f.categories, value] : f.categories.filter(c => c !== value)
      return { ...f, categories: LEAD_CATEGORIES.filter(c => next.indexOf(c) !== -1) }
    })
  }

  function next() {
    if (step === 0 && !form.name.trim()) { nameRef.current.focus(); return }
    setStep(Math.min(step + 1, LEAD_STEPS.length - 1))
  }
  function save() {
    const name = form.name.trim()
    if (!name) { setStep(0); setNameFocusTick(t => t + 1); return }
    const type = form.type || 'Chưa xác định'
    const scale = form.scale.trim()
    /* Tên đã gõ trong popover nhưng chưa bấm "Thêm" vẫn được lưu */
    const pendingName = assigneeName.trim()
    const finalAssignees = pendingName ? [...assignees, { name: pendingName, role: assigneeRole.trim() }] : assignees.slice()
    onSave({
      name,
      type: scale ? `${type} (${scale})` : type,
      value: parseFloat(form.value.replace(',', '.')) || 0,
      stage: form.stage,
      dept: form.dept || 'dan-dung',
      creator: form.creator.trim(),
      manager: form.manager.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      source: form.source,
      address: form.address.trim(),
      projectType: type,
      scale,
      categories: form.categories,
      boqFile,
      concept: form.concept.trim(),
      notes: form.notes.trim(),
      partner: form.partner,
      assignees: finalAssignees,
      maDA: form.maDA,
    })
  }

  const stageInOptions = LEAD_STAGE_OPTIONS.some(([v]) => v === form.stage)

  return (
    <>
      <div
        ref={overlayRef}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
        style={{ display: open ? 'flex' : 'none', position: 'fixed', inset: 0, background: 'rgba(15,18,25,.5)', zIndex: 100, alignItems: 'center', justifyContent: 'center' }}
      >
        <div style={{ background: 'var(--surface)', width: 720, maxWidth: '92vw', maxHeight: '88vh', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 30px 80px rgba(0,0,0,.35)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontFamily: FONT_STACK, fontWeight: 800, fontSize: 17 }}>{lead ? 'Chỉnh sửa lead' : 'Thêm khách hàng tiềm năng'}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Điền thông tin theo 3 cấp độ — càng đầy đủ, hồ sơ chuyển giao sang thi công càng chính xác.</div>
            </div>
            <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, flex: 'none' }}>{closeIcon}</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '12px 24px 0', borderBottom: '1px solid var(--border)' }}>
            {LEAD_STEPS.map((id, i) => {
              const active = id === stepId
              /* Bản HTML: tab đầu có font-weight 700, 2 tab còn lại 600 (không đổi khi chuyển bước) */
              return (
                <button
                  key={id} className={active ? 'active' : undefined} onClick={() => setStep(i)}
                  style={{ border: 'none', cursor: 'pointer', padding: '8px 14px', borderRadius: '8px 8px 0 0', background: active ? 'var(--sales-tint)' : 'none', color: active ? 'var(--sales)' : 'var(--text-muted)', fontWeight: i === 0 ? 700 : 600, fontSize: 12.5, fontFamily: 'inherit' }}
                >{LEAD_STEP_TAB_LABEL[id]}</button>
              )
            })}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px' }}>
            {/* ---- Bước 1: Cơ bản ---- */}
            <div style={stepStyle(stepId === 'basic')}>
              <div style={grid2}>
                <div className="kd-field"><label>Tên khách hàng *</label><input ref={nameRef} type="text" placeholder="VD: Anh Nguyễn Văn Phú" value={form.name} onChange={e => set('name', e.target.value)} /></div>
                <div className="kd-field"><label>Số điện thoại *</label><input type="text" placeholder="09xx xxx xxx" value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
              </div>
              <div style={grid2}>
                <div className="kd-field"><label>Email</label><input type="text" placeholder="khachhang@email.com" value={form.email} onChange={e => set('email', e.target.value)} /></div>
                <div className="kd-field"><label>Nguồn khách hàng</label>
                  <select value={form.source} onChange={e => set('source', e.target.value)}>{LEAD_SOURCES.map(s => <option key={s}>{s}</option>)}</select>
                </div>
              </div>
              <div style={grid2}>
                <div className="kd-field"><label>Địa chỉ</label><input type="text" placeholder="Số nhà, đường, phường/xã, quận/huyện" value={form.address} onChange={e => set('address', e.target.value)} /></div>
                <div className="kd-field"><label>Phòng ban phụ trách</label>
                  <select value={form.dept} onChange={e => set('dept', e.target.value)}>{LEAD_DEPT_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
                </div>
              </div>
              <div style={grid2}>
                <div className="kd-field"><label>Người khởi tạo</label><input type="text" placeholder="Họ tên người tạo lead" value={form.creator} onChange={e => set('creator', e.target.value)} /></div>
                <div className="kd-field"><label>Quản lý</label><input type="text" placeholder="Họ tên quản lý phụ trách" value={form.manager} onChange={e => set('manager', e.target.value)} /></div>
              </div>
              <div className="kd-field" style={{ position: 'relative' }}>
                <label>Nhân viên phụ trách</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    {assignees.map((a, i) => (
                      <span className="kd-lm-assignee-chip" key={i}>
                        <span className="kd-aa-avatar">{lmInitials(a.name)}</span>
                        {a.name}{a.role ? <span className="kd-aa-role">· {a.role}</span> : null}
                        <button type="button" className="kd-aa-remove" title="Xoá" onClick={() => setAssignees(list => list.filter((_, idx) => idx !== i))}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                      </span>
                    ))}
                  </div>
                  <button type="button" title="Thêm người phụ trách" onClick={toggleAssigneePopover} style={{ width: 28, height: 28, borderRadius: '50%', border: '1.5px dashed var(--border)', background: 'none', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  </button>
                </div>
                {/* Mở lên trên: ô này nằm cuối bước 1 nên mở xuống sẽ bị vùng cuộn của modal che mất nút "Thêm" */}
                <div className="kd-lm-assignee-popover" style={{ display: assigneeOpen ? 'flex' : 'none', top: 'auto', bottom: '100%', marginTop: 0, marginBottom: 6 }} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Enter') addAssignee() }}>
                  <input type="text" ref={assigneeNameRef} placeholder="Họ tên" value={assigneeName} onChange={e => setAssigneeName(e.target.value)} />
                  <input type="text" placeholder="Vai trò (VD: Sale phụ trách, Kỹ thuật...)" value={assigneeRole} onChange={e => setAssigneeRole(e.target.value)} />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                    <button type="button" className="kd-lm-assignee-btn" onClick={() => setAssigneeOpen(false)}>Đóng</button>
                    <button type="button" className="kd-lm-assignee-btn primary" onClick={addAssignee}>Thêm</button>
                  </div>
                </div>
              </div>
            </div>

            {/* ---- Bước 2: Chi tiết ---- */}
            <div style={stepStyle(stepId === 'detail')}>
              <div style={grid2}>
                <div className="kd-field"><label>Loại dự án</label>
                  <select value={form.type} onChange={e => set('type', e.target.value)}>{LEAD_PROJECT_TYPES.map(s => <option key={s}>{s}</option>)}</select>
                </div>
                <div className="kd-field"><label>Quy mô</label><input type="text" placeholder="VD: 5x20m, 1 trệt 3 lầu" value={form.scale} onChange={e => set('scale', e.target.value)} /></div>
              </div>
              <div className="kd-field" style={{ position: 'relative' }}>
                <label>Hạng mục quan tâm</label>
                <button type="button" onClick={toggleCatPopover} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-alt)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left', width: '100%', boxSizing: 'border-box' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.categories.length ? form.categories.join(', ') : 'Chọn hạng mục...'}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><polyline points="6 9 12 15 18 9" /></svg>
                </button>
              </div>
              <div style={grid2}>
                <div className="kd-field"><label>Giá trị ước tính (tỷ){form.maDA ? ' · đang lấy theo báo giá QS' : ''}</label><input type="text" placeholder="VD: 2.5" value={form.value} onChange={e => set('value', e.target.value)} /></div>
                <div className="kd-field"><label>Giai đoạn hiện tại</label>
                  <select value={form.stage} onChange={e => set('stage', e.target.value)}>
                    {/* Lead đang ở giai đoạn ngoài 5 lựa chọn (VD: Dự án thiết kế): ô chọn để trống như bản HTML, nhưng giữ nguyên giai đoạn khi lưu */}
                    {!stageInOptions && <option value={form.stage} hidden />}
                    {LEAD_STAGE_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  </select>
                </div>
              </div>
              <div className="kd-field"><label>Gắn dự án QS (giá trị lấy theo tổng báo giá)</label>
                <select value={form.maDA} onChange={e => set('maDA', e.target.value)}>
                  <option value="">{qsProjects === null ? 'Đang tải dự án QS…' : '— Chưa gắn —'}</option>
                  {form.maDA && qsProjects && !qsProjects.some(p => p.maDA === form.maDA) && <option value={form.maDA}>{form.maDA}</option>}
                  {(qsProjects || []).map(p => <option key={p.maDA} value={p.maDA}>{(p.ten || p.maDA) + (p.tenBanNhap ? ' › ' + p.tenBanNhap : '') + ' · ' + p.maDA}</option>)}
                </select>
              </div>
            </div>

            {/* ---- Bước 3: Nâng cao ---- */}
            <div style={stepStyle(stepId === 'advanced')}>
              <div className="kd-field">
                <label>BOQ (Bảng khối lượng dự toán)</label>
                <div onClick={pickBoq} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1.5px dashed var(--border)', borderRadius: 10, padding: 16, justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12.5, cursor: 'pointer' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17,8 12,3 7,8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                  <span>{boqFile ? '📎 ' + boqFile : BOQ_DEFAULT_LABEL}</span>
                </div>
              </div>
              <div className="kd-field"><label>Concept / Ý tưởng thiết kế</label><textarea rows={3} placeholder="Mô tả phong cách, ý tưởng thiết kế mong muốn của khách hàng..." value={form.concept} onChange={e => set('concept', e.target.value)} /></div>
              <div className="kd-field"><label>Ghi chú nội bộ</label><textarea rows={2} placeholder="Ghi chú cho đội kinh doanh / kỹ thuật..." value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
              <div className="kd-field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600 }}>
                  <input type="checkbox" checked={form.partner} onChange={e => set('partner', e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--primary)', cursor: 'pointer' }} />
                  Chuyển giao cho đối tác thi công/thiết kế ngoài
                </label>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Bước {step + 1}/3 — {LEAD_STEP_TITLE[stepId]}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setStep(Math.max(step - 1, 0))} style={{ display: step === 0 ? 'none' : 'inline-block', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', padding: '9px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Quay lại</button>
              <button onClick={next} style={{ display: isLast ? 'none' : 'inline-block', border: 'none', background: 'var(--sales)', color: '#fff', padding: '9px 18px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Tiếp theo</button>
              {/* Khi chỉnh sửa: cho lưu ngay ở mọi bước, không bắt đi hết 3 bước */}
              <button onClick={save} style={{ display: isLast || lead ? 'inline-block' : 'none', border: 'none', background: 'var(--sales)', color: '#fff', padding: '9px 18px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{lead ? 'Lưu thay đổi' : 'Lưu khách hàng'}</button>
            </div>
          </div>
        </div>
      </div>

      {/* Popover hạng mục: bản HTML chuyển ra <body> và định vị fixed theo nút bấm */}
      <div
        className="kd-lm-cat-popover"
        onClick={e => e.stopPropagation()}
        style={catPos ? { display: 'block', left: catPos.left, width: catPos.width, top: catPos.top, maxHeight: catPos.maxHeight } : { display: 'none' }}
      >
        {LEAD_CATEGORY_GROUPS.map((g, gi) => (
          <Fragment key={g.title}>
            <div className="kd-lm-cat-group-title" style={gi > 0 ? { marginTop: 8 } : undefined}>{g.title}</div>
            {g.items.map(c => (
              <label className="kd-lm-cat-option" key={c}>
                <input type="checkbox" value={c} checked={form.categories.indexOf(c) !== -1} onChange={e => toggleCat(c, e.target.checked)} /> {c}
              </label>
            ))}
          </Fragment>
        ))}
      </div>
    </>
  )
}
