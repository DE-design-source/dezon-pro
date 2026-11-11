import { Fragment, useEffect, useRef, useState } from 'react'
import { INITIAL_UNIT_HEADS, INITIAL_HR_EMPLOYEES } from '../../../data/hrData'

/* Quản lý mặc định = trưởng phòng của phòng ban phụ trách (theo HR: kddd = KD dân dụng, kdda = KD dự án) */
const DEPT_UNIT = { 'dan-dung': 'kddd', 'du-an': 'kdda' }
const deptHead_ = dept => { const id = INITIAL_UNIT_HEADS[DEPT_UNIT[dept]]; const e = INITIAL_HR_EMPLOYEES.find(x => x.id === id); return e ? e.name : '' }
/* "Admin Kinh doanh" lưu chung mảng assignees (phu_trach) với vai trò này, không cần cột mới */
const ADMIN_KD = 'Admin Kinh doanh'
import {
  LEAD_STEPS, LEAD_STEP_TITLE, LEAD_STEP_TAB_LABEL, LEAD_SOURCES, LEAD_REGIONS, LEAD_PROVINCES, regionOfProvince, LEAD_PROJECT_TYPES, LEAD_DEPT_OPTIONS,
  LEAD_STAGE_OPTIONS, LEAD_CATEGORY_GROUPS, LEAD_CATEGORIES, BOQ_DEFAULT_LABEL,
} from '../../../data/kinhDoanhData'
import { FONT_STACK, lmInitials } from '../utils'
import ShortlistSelect, { useKdMap, useMkChannels } from './ShortlistSelect'

/* ===================== Modal thêm / chỉnh sửa khách hàng tiềm năng (3 cấp độ) =====================
   Component được mount sẵn (ẩn bằng display) như bản HTML; trang cha đổi `key` mỗi lần mở
   để form nạp lại dữ liệu — tương đương openLeadModal(leadId) gán lại toàn bộ ô nhập. */

/* Giá trị ước tính: gõ số tiền đầy đủ (tự chèn dấu chấm nghìn) + đơn vị tiền tệ (mặc định VND); khác VND thì nhập tỷ giá để quy ra VND
   (máy chủ lưu giá trị theo VND - valueVnd). Dòng chữ bên phải đọc gọn: "5,1 tỷ VND", "250 nghìn USD" */
const CURRENCIES = [['VND', 1], ['USD', 25500], ['EUR', 27500], ['JPY', 170], ['CNY', 3550]]
const digits_ = s => String(s || '').replace(/[^\d]/g, '')
const groupNum_ = s => { const d = digits_(s); return d ? Number(d).toLocaleString('vi-VN') : '' }
const nf_ = x => (Math.round(x * 100) / 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 })
export function moneyWords_(n, cur) {
  n = Number(n) || 0
  const c = cur || 'VND'
  if (!n) return '0 ' + c
  if (n >= 1e9) return nf_(n / 1e9) + ' tỷ ' + c
  if (n >= 1e6) return nf_(n / 1e6) + ' triệu ' + c
  if (n >= 1e3) return nf_(n / 1e3) + ' nghìn ' + c
  return nf_(n) + ' ' + c
}
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
    value: lead && lead.value ? String(Math.round(lead.value * 1e9)) : '',   // số tiền đầy đủ (VND) dạng chữ số
    cur: 'VND',
    rate: '',
    concept: lead ? (lead.concept || '') : '',
    notes: lead ? (lead.notes || '') : '',
    partner: lead ? !!lead.partner : false,
    source: lead && lead.source ? lead.source : LEAD_SOURCES[0],
    dept: lead ? (lead.dept || 'dan-dung') : 'dan-dung',
    creator: lead ? (lead.creator || '') : me,
    manager: lead ? (lead.manager || '') : (deptHead_(lead ? lead.dept : 'dan-dung') || me),
    type: lead && lead.projectType ? lead.projectType : 'Nhà phố',
    stage: lead ? lead.stage : 'tiep-can',
    categories: lead && lead.categories ? LEAD_CATEGORIES.filter(c => lead.categories.indexOf(c) !== -1) : [],
  }
}

export default function LeadModal({ open, lead, me, onClose, onSave }) {
  const mkKenh = useMkChannels() // kênh quảng cáo của tab Marketing: gợi ý thêm cho Nguồn khách hàng
  const [form, setForm] = useState(() => initForm(lead, me))
  const [step, setStep] = useState(0)
  const [boqFile, setBoqFile] = useState(lead ? (lead.boqFile || '') : '')
  const [assignees, setAssignees] = useState(lead && lead.assignees ? lead.assignees.filter(a => !a || a.role !== ADMIN_KD) : [])
  /* Admin Kinh doanh: nhiều người, mỗi người 1 ô tròn chữ cái đầu (rê chuột = tên), nút "+" mở ô gõ tên */
  const [admins, setAdmins] = useState(lead && lead.assignees ? lead.assignees.filter(a => a && a.role === ADMIN_KD).map(a => a.name) : [])
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminName, setAdminName] = useState('')
  const addAdmin = () => { const n = adminName.trim(); if (n && admins.indexOf(n) < 0) setAdmins(l => [...l, n]); setAdminName(''); setAdminOpen(false) }
  const [managerTouched, setManagerTouched] = useState(!!lead)
  /* Khu vực + Tỉnh / TP: máy chủ chưa có cột -> lưu chung công ty kdOptions.geo {mã lead: {kv, tinh}} (KinhDoanh.saveLead ghi) */
  const geoMap = useKdMap('geo')
  const geo0 = lead ? geoMap[String(lead.id)] || {} : {}
  const [geo, setGeo] = useState({ kv: geo0.kv || '', tinh: geo0.tinh || '' })
  // dữ liệu công ty tải xong sau khi mở form sửa: điền lại nếu chưa tự chọn
  const geoKey = lead ? geoMap[String(lead.id)] : null
  useEffect(() => { if (geoKey && !geo.kv && !geo.tinh) setGeo({ kv: geoKey.kv || '', tinh: geoKey.tinh || '' }) }, [geoKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const tinhList = geo.kv && LEAD_PROVINCES[geo.kv] ? LEAD_PROVINCES[geo.kv] : [].concat(...Object.values(LEAD_PROVINCES))   // tự sửa Quản lý thì không tự đổi theo phòng ban nữa
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

  useEffect(() => { if (nameFocusTick && nameRef.current) nameRef.current.focus() }, [nameFocusTick])
  useEffect(() => { if (assigneeFocusTick && assigneeNameRef.current) assigneeNameRef.current.focus() }, [assigneeFocusTick])

  /* Bấm ra ngoài → đóng 2 popover; cuộn trang (khung cuộn bất kỳ) → đóng popover hạng mục */
  useEffect(() => {
    const closeAll = () => { setAssigneeOpen(false); setAdminOpen(false); setCatPos(null) }
    const closeCat = () => setCatPos(null)
    document.addEventListener('click', closeAll)
    document.addEventListener('scroll', closeCat, true)
    return () => {
      document.removeEventListener('click', closeAll)
      document.removeEventListener('scroll', closeCat, true)
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
    const pendingAdmin = adminName.trim()
    ;[...admins, ...(pendingAdmin && admins.indexOf(pendingAdmin) < 0 ? [pendingAdmin] : [])].forEach(n => finalAssignees.push({ name: n, role: ADMIN_KD }))
    onSave({
      name,
      _geo: geo,
      type: scale ? `${type} (${scale})` : type,
      value: (Number(digits_(form.value)) || 0) * (form.cur === 'VND' ? 1 : (Number(digits_(form.rate)) || (CURRENCIES.find(c => c[0] === form.cur) || [0, 1])[1])) / 1e9,   // quy ra tỷ VND
      stage: !lead && form.stage === 'tiep-can' && finalAssignees.some(a => a && a.role !== ADMIN_KD) ? 'giao-ns' : form.stage,   // tạo mới đã có nhân sự KD phụ trách -> vào thẳng giai đoạn "Nhân sự KD phụ trách"
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
    })
  }

  const stageInOptions = LEAD_STAGE_OPTIONS.some(([v]) => v === form.stage)

  return (
    <>
      {/* Trang đầy đủ trong vùng nội dung (thay cho hộp nổi): thay chỗ các tab, nút Quay lại / ✕ để về */}
      <div ref={overlayRef} style={{ display: open ? 'block' : 'none' }}>
        <div style={{ background: 'var(--surface)', width: '100%', border: '1px solid var(--border)', borderRadius: 16, display: 'flex', flexDirection: 'column', boxShadow: '0 1px 3px rgba(15,23,42,.06)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
            <button type="button" onClick={onClose} style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>Quay lại
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
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

          <div style={{ padding: '22px 24px' }}>
            {/* ---- Bước 1: Cơ bản - 4 nhóm thẻ: Khách hàng · Địa điểm | Dự án · Phụ trách ---- */}
            <div className="kd-lf-grid" style={stepId === 'basic' ? undefined : { display: 'none' }}>
              <section className="kd-lf-sec">
                <h4><i>1</i>Thông tin khách hàng</h4>
                <div style={grid2}>
                  <div className="kd-field"><label>Tên khách hàng *</label><input ref={nameRef} type="text" placeholder="VD: Anh Nguyễn Văn Phú" value={form.name} onChange={e => set('name', e.target.value)} /></div>
                  <div className="kd-field"><label>Số điện thoại *</label><input type="text" placeholder="09xx xxx xxx" value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
                </div>
                <div style={grid2}>
                  <div className="kd-field"><label>Email</label><input type="text" placeholder="khachhang@email.com" value={form.email} onChange={e => set('email', e.target.value)} /></div>
                  <div className="kd-field"><label>Nguồn khách hàng</label>
                    <ShortlistSelect value={form.source} onChange={v => set('source', v)} base={LEAD_SOURCES} optKey="source" placeholder="Chọn nguồn khách hàng" linked={mkKenh} linkedLabel="Marketing" />
                  </div>
                </div>
              </section>

              <section className="kd-lf-sec">
                <h4><i>2</i>Địa điểm</h4>
                <div style={grid2}>
                  <div className="kd-field"><label>Khu vực</label>
                    <select value={geo.kv} onChange={e => { const kv = e.target.value; setGeo(g => ({ kv, tinh: kv === 'Nước ngoài' || (g.tinh && regionOfProvince(g.tinh) !== kv) ? '' : g.tinh })) }}>
                      <option value="">— Chọn khu vực —</option>
                      {LEAD_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="kd-field"><label>{geo.kv === 'Nước ngoài' ? 'Quốc gia / Thành phố' : 'Tỉnh / Thành phố'}</label>
                    <ShortlistSelect value={geo.tinh} free optKey={geo.kv === 'Nước ngoài' ? 'nuocNgoai' : 'tinhKhac'} base={geo.kv === 'Nước ngoài' ? [] : tinhList}
                      placeholder={geo.kv === 'Nước ngoài' ? 'Gõ quốc gia / thành phố' : 'Chọn tỉnh / thành phố'}
                      onChange={t => setGeo(g => ({ kv: g.kv === 'Nước ngoài' ? g.kv : (regionOfProvince(t) || g.kv), tinh: t }))} />
                  </div>
                </div>
                <div className="kd-field"><label>Địa chỉ</label><input type="text" placeholder="Số nhà, đường, phường/xã, quận/huyện" value={form.address} onChange={e => set('address', e.target.value)} /></div>
              </section>

              <section className="kd-lf-sec">
                <h4><i>3</i>Dự án</h4>
                <div style={grid2}>
                  <div className="kd-field"><label>Loại dự án</label>
                    <ShortlistSelect value={form.type} onChange={v => set('type', v)} base={LEAD_PROJECT_TYPES} optKey="projectType" placeholder="Chọn loại dự án" />
                  </div>
                  <div className="kd-field"><label>Giai đoạn hiện tại</label>
                    <select value={form.stage} onChange={e => set('stage', e.target.value)}>
                      {/* Lead đang ở giai đoạn ngoài các lựa chọn (VD: Dự án thiết kế): ô chọn để trống, nhưng giữ nguyên giai đoạn khi lưu */}
                      {!stageInOptions && <option value={form.stage} hidden />}
                      {LEAD_STAGE_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="kd-field" style={{ position: 'relative' }}>
                  <label>Hạng mục quan tâm</label>
                  <button type="button" onClick={toggleCatPopover} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-alt)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left', width: '100%', boxSizing: 'border-box' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.categories.length ? form.categories.join(', ') : 'Chọn hạng mục...'}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><polyline points="6 9 12 15 18 9" /></svg>
                  </button>
                </div>
                <div className="kd-field"><label>Giá trị ước tính</label>
                  <div className="kd-money">
                    <input type="text" inputMode="numeric" placeholder="VD: 5.100.000.000" value={groupNum_(form.value)} onChange={e => set('value', digits_(e.target.value))} />
                    <select value={form.cur} onChange={e => set('cur', e.target.value)} title="Đơn vị tiền tệ">
                      {CURRENCIES.map(([c]) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <span className="words" title="Đọc gọn">{moneyWords_(digits_(form.value), form.cur)}</span>
                  </div>
                  {form.cur !== 'VND' && (
                    <div className="kd-money-rate">
                      <span>Tỷ giá 1 {form.cur} =</span>
                      <input type="text" inputMode="numeric" placeholder={(CURRENCIES.find(c => c[0] === form.cur) || [0, 1])[1].toLocaleString('vi-VN')} value={groupNum_(form.rate)} onChange={e => set('rate', digits_(e.target.value))} />
                      <span>VND · ≈ {moneyWords_((Number(digits_(form.value)) || 0) * (Number(digits_(form.rate)) || (CURRENCIES.find(c => c[0] === form.cur) || [0, 1])[1]), 'VND')}</span>
                    </div>
                  )}
                </div>
              </section>

              <section className="kd-lf-sec">
                <h4><i>4</i>Phụ trách</h4>
                <div style={grid2}>
                  <div className="kd-field"><label>Phòng ban phụ trách</label>
                    <select value={form.dept} onChange={e => { const d = e.target.value; set('dept', d); if (!managerTouched) { const h = deptHead_(d); if (h) set('manager', h) } }}>{LEAD_DEPT_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
                  </div>
                  {/* Quản lý: mặc định trưởng phòng của phòng ban phụ trách (đổi phòng ban thì đổi theo), vẫn sửa tay được */}
                  <div className="kd-field"><label>Quản lý</label>
                    <ShortlistSelect value={form.manager} onChange={v => { setManagerTouched(true); set('manager', v) }} free optKey="manager" placeholder="Trưởng phòng ban phụ trách"
                      base={[...new Set(Object.keys(DEPT_UNIT).map(deptHead_).filter(Boolean))]} />
                  </div>
                </div>
                {/* Người khởi tạo = chủ tài khoản đang đăng nhập (lead cũ giữ người đã tạo), không sửa */}
                <div className="kd-field"><label>Người khởi tạo</label><input type="text" readOnly title="Chủ tài khoản tạo lead" value={form.creator} style={{ opacity: 0.85, cursor: 'default' }} /></div>
                <div style={grid2}>
                  <div className="kd-field" style={{ position: 'relative' }}>
                    <label>Nhân sự phụ trách</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 6 }}>
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
                    <div className="kd-lm-assignee-popover" style={{ display: assigneeOpen ? 'flex' : 'none', top: 'auto', bottom: '100%', marginTop: 0, marginBottom: 6 }} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Enter') addAssignee() }}>
                      <input type="text" ref={assigneeNameRef} placeholder="Họ tên" value={assigneeName} onChange={e => setAssigneeName(e.target.value)} />
                      <input type="text" placeholder="Vai trò (VD: Sale phụ trách, Kỹ thuật...)" value={assigneeRole} onChange={e => setAssigneeRole(e.target.value)} />
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                        <button type="button" className="kd-lm-assignee-btn" onClick={() => setAssigneeOpen(false)}>Đóng</button>
                        <button type="button" className="kd-lm-assignee-btn primary" onClick={addAssignee}>Thêm</button>
                      </div>
                    </div>
                  </div>
                  <div className="kd-field" style={{ position: 'relative' }}>
                    <label>Admin Kinh doanh</label>
                    <div className="kd-lm-admins">
                      {admins.map(n => (
                        <span key={n} className="kd-lm-admin" title={n}>
                          {lmInitials(n)}
                          <button type="button" title={'Bỏ ' + n} onClick={() => setAdmins(l => l.filter(x => x !== n))}>×</button>
                        </span>
                      ))}
                      <button type="button" title="Thêm admin kinh doanh" onClick={e => { e.stopPropagation(); setAdminOpen(o => !o) }} style={{ width: 28, height: 28, borderRadius: '50%', border: '1.5px dashed var(--border)', background: 'none', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      </button>
                    </div>
                    <div className="kd-lm-assignee-popover" style={{ display: adminOpen ? 'flex' : 'none', top: 'auto', bottom: '100%', marginTop: 0, marginBottom: 6 }} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Enter') addAdmin() }}>
                      <input type="text" placeholder="Họ tên admin kinh doanh" value={adminName} onChange={e => setAdminName(e.target.value)} autoFocus />
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                        <button type="button" className="kd-lm-assignee-btn" onClick={() => setAdminOpen(false)}>Đóng</button>
                        <button type="button" className="kd-lm-assignee-btn primary" onClick={addAdmin}>Thêm</button>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
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
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Bước {step + 1}/{LEAD_STEPS.length} — {LEAD_STEP_TITLE[stepId]}</div>
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
