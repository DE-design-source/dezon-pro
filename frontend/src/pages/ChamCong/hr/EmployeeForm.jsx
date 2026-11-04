import { useEffect, useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { DEPTS, LEVELS, CONTRACT_TYPES, WORK_SITES, STATUS, EMPTY_EMPLOYEE } from '../../../data/hrData'
import { Modal, Field, Seg } from './shared'

const TABS = [
  { value: 'personal', label: 'Cá nhân', icon: 'user' },
  { value: 'job', label: 'Công việc & HĐ', icon: 'briefcase' },
  { value: 'edu', label: 'Học vấn & bằng cấp', icon: 'graduation' },
  { value: 'tax', label: 'Thuế & BHXH', icon: 'shield' },
  { value: 'bank', label: 'Ngân hàng & liên hệ', icon: 'wallet' },
]

/* Danh sách dòng có thể thêm/xoá (học vấn, kinh nghiệm, chứng chỉ) */
function Rows({ title, rows, cols, onChange, blank }) {
  const set = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  return (
    <div className="cc-rows full">
      <div className="cc-rows-head"><span className="cc-f-label">{title}</span>
        <button type="button" className="cc-link-btn" onClick={() => onChange([...rows, { ...blank }])}><Icon name="plus" size={13} stroke={2.4} />Thêm</button>
      </div>
      {rows.length === 0 && <div className="cc-rows-empty">Chưa có dữ liệu</div>}
      {rows.map((r, i) => (
        <div key={i} className="cc-rows-item" style={{ gridTemplateColumns: `${cols.map(c => c.w || '1fr').join(' ')} 30px` }}>
          {cols.map(c => <input key={c.k} type={c.type || 'text'} placeholder={c.label} value={r[c.k] || ''} onChange={e => set(i, c.k, e.target.value)} />)}
          <button type="button" className="cc-icon-btn sm danger" title="Xoá dòng" onClick={() => onChange(rows.filter((_, j) => j !== i))}><Icon name="x" size={13} stroke={2.4} /></button>
        </div>
      ))}
    </div>
  )
}

/* Modal thêm / sửa hồ sơ nhân sự */
export default function EmployeeForm({ open, employee, employees, onClose, onSave }) {
  const [tab, setTab] = useState('personal')
  const [f, setF] = useState(EMPTY_EMPLOYEE)
  const [errors, setErrors] = useState({})
  const isEdit = !!(employee && employee.id)

  useEffect(() => {
    if (!open) return
    setTab('personal')
    setErrors({})
    setF(employee ? JSON.parse(JSON.stringify(employee)) : { ...EMPTY_EMPLOYEE, code: 'NV' + String(Math.max(...employees.map(e => Number(e.code.slice(2)) || 0)) + 1).padStart(3, '0') })
  }, [open, employee, employees])

  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const setIn = (grp, k, v) => setF(p => ({ ...p, [grp]: { ...p[grp], [k]: v } }))
  const inp = (k, props = {}) => <input value={f[k] ?? ''} onChange={e => set(k, e.target.value)} {...props} />

  function save() {
    const err = {}
    if (!f.name.trim()) err.name = 'Bắt buộc'
    if (!f.position.trim()) err.position = 'Bắt buộc'
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) err.email = 'Email không hợp lệ'
    if (f.code && employees.some(e => e.code === f.code && e.id !== f.id)) err.code = 'Mã đã tồn tại'
    setErrors(err)
    if (Object.keys(err).length) { setTab(err.position ? 'job' : 'personal'); return }
    onSave({ ...f, name: f.name.trim(), salary: f.salary === '' ? '' : Number(String(f.salary).replace(/\D/g, '')) })
  }

  const managers = employees.filter(e => e.status !== 'left' && e.id !== f.id)

  return (
    <Modal
      open={open} onClose={onClose} width={720} icon={isEdit ? 'edit' : 'userPlus'}
      title={isEdit ? `Sửa hồ sơ — ${employee.name}` : 'Thêm nhân viên mới'}
      sub={isEdit ? `${employee.code} · cập nhật thông tin nhân sự` : 'Điền thông tin cơ bản — có thể bổ sung chi tiết sau'}
      footer={<>
        <span className="cc-grow cc-sub">{Object.keys(errors).length ? <span style={{ color: 'var(--danger)' }}>Vui lòng kiểm tra các ô được đánh dấu</span> : 'Các ô có dấu * là bắt buộc'}</span>
        <button className="cc-btn ghost" onClick={onClose}>Hủy</button>
        <button className="cc-btn" onClick={save}><Icon name="check" size={14} stroke={2.6} />{isEdit ? 'Lưu thay đổi' : 'Tạo hồ sơ'}</button>
      </>}
    >
      <Seg value={tab} onChange={setTab} options={TABS} />
      <div className="cc-form">
        {tab === 'personal' && <>
          <Field label="Họ và tên *" hint={errors.name}>{inp('name', { placeholder: 'VD: Nguyễn Văn A', className: errors.name ? 'err' : '' })}</Field>
          <Field label="Mã nhân viên" hint={errors.code}>{inp('code', { className: errors.code ? 'err' : '' })}</Field>
          <Field label="Giới tính"><select value={f.gender} onChange={e => set('gender', e.target.value)}><option>Nam</option><option>Nữ</option><option>Khác</option></select></Field>
          <Field label="Ngày sinh">{inp('dob', { type: 'date' })}</Field>
          <Field label="Số CCCD">{inp('cccd', { placeholder: '12 số' })}</Field>
          <Field label="Ngày cấp">{inp('cccdDate', { type: 'date' })}</Field>
          <Field label="Quê quán">{inp('hometown')}</Field>
          <Field label="Tình trạng hôn nhân"><select value={f.marital} onChange={e => set('marital', e.target.value)}><option>Độc thân</option><option>Đã kết hôn</option></select></Field>
          <Field label="Địa chỉ thường trú" full>{inp('address')}</Field>
          <Field label="Số điện thoại">{inp('phone')}</Field>
          <Field label="Email công ty" hint={errors.email}>{inp('email', { type: 'email', className: errors.email ? 'err' : '' })}</Field>
        </>}

        {tab === 'job' && <>
          <Field label="Chức danh *" hint={errors.position}>{inp('position', { placeholder: 'VD: Kỹ sư giám sát', className: errors.position ? 'err' : '' })}</Field>
          <Field label="Cấp bậc"><select value={f.level} onChange={e => set('level', e.target.value)}>{LEVELS.map(l => <option key={l}>{l}</option>)}</select></Field>
          <Field label="Phòng ban"><select value={f.dept} onChange={e => set('dept', e.target.value)}>{DEPTS.map(d => <option key={d.key} value={d.key}>{d.name}</option>)}</select></Field>
          <Field label="Quản lý trực tiếp">
            <select value={f.managerId ?? ''} onChange={e => set('managerId', e.target.value ? Number(e.target.value) : null)}>
              <option value="">— Không có —</option>
              {managers.map(m => <option key={m.id} value={m.id}>{m.name} · {m.position}</option>)}
            </select>
          </Field>
          <Field label="Trạng thái"><select value={f.status} onChange={e => set('status', e.target.value)}>{Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</select></Field>
          <Field label="Nơi làm việc"><select value={f.site} onChange={e => set('site', e.target.value)}>{WORK_SITES.map(s => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Ngày vào làm">{inp('joinDate', { type: 'date' })}</Field>
          <Field label="Loại hợp đồng hiện tại"><select value={f.contractType} onChange={e => set('contractType', e.target.value)}>{CONTRACT_TYPES.map(c => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Lương cơ bản (đ/tháng)">
            <input inputMode="numeric" value={f.salary === '' ? '' : Number(String(f.salary).replace(/\D/g, '') || 0).toLocaleString('vi-VN')} onChange={e => set('salary', e.target.value.replace(/\D/g, ''))} placeholder="VD: 15.000.000" />
          </Field>
          {f.status === 'left' && <Field label="Ngày nghỉ việc">{inp('leaveDate', { type: 'date' })}</Field>}
        </>}

        {tab === 'edu' && <>
          <Rows title="Học vấn" rows={f.education} onChange={v => set('education', v)} blank={{ school: '', major: '', degree: '', from: '', to: '' }}
            cols={[{ k: 'school', label: 'Trường', w: '1.4fr' }, { k: 'major', label: 'Chuyên ngành', w: '1.2fr' }, { k: 'degree', label: 'Bằng cấp' }, { k: 'to', label: 'Năm TN', w: '80px' }]} />
          <Rows title="Kinh nghiệm làm việc" rows={f.experience} onChange={v => set('experience', v)} blank={{ company: '', role: '', from: '', to: '' }}
            cols={[{ k: 'company', label: 'Công ty', w: '1.3fr' }, { k: 'role', label: 'Vị trí', w: '1.3fr' }, { k: 'from', label: 'Từ năm', w: '80px' }, { k: 'to', label: 'Đến năm', w: '80px' }]} />
          <Rows title="Chứng chỉ" rows={f.certificates} onChange={v => set('certificates', v)} blank={{ name: '', issuer: '', date: '', expiry: '' }}
            cols={[{ k: 'name', label: 'Tên chứng chỉ', w: '1.6fr' }, { k: 'issuer', label: 'Nơi cấp' }, { k: 'expiry', label: 'Hết hạn', type: 'date', w: '140px' }]} />
        </>}

        {tab === 'tax' && <>
          <Field label="Mã số thuế cá nhân"><input value={f.tax.mst} onChange={e => setIn('tax', 'mst', e.target.value)} /></Field>
          <Field label="Số người phụ thuộc"><input type="number" min="0" value={f.tax.dependents} onChange={e => setIn('tax', 'dependents', Number(e.target.value))} /></Field>
          <Field label="Cơ quan thuế quản lý" full><input value={f.tax.taxOffice} onChange={e => setIn('tax', 'taxOffice', e.target.value)} /></Field>
          <Field label="Số sổ BHXH"><input value={f.insurance.bhxhNo} onChange={e => setIn('insurance', 'bhxhNo', e.target.value)} /></Field>
          <Field label="Nơi KCB ban đầu"><input value={f.insurance.hospital} onChange={e => setIn('insurance', 'hospital', e.target.value)} /></Field>
          <Field label="Mức lương đóng BH (đ)"><input inputMode="numeric" value={f.insurance.base} onChange={e => setIn('insurance', 'base', e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="Tham gia BH từ"><input type="date" value={f.insurance.since || ''} onChange={e => setIn('insurance', 'since', e.target.value)} /></Field>
        </>}

        {tab === 'bank' && <>
          <Field label="Ngân hàng">{inp('bankName')}</Field>
          <Field label="Số tài khoản">{inp('bankAccount')}</Field>
          <Field label="Người liên hệ khẩn cấp">{inp('emergencyName')}</Field>
          <Field label="SĐT khẩn cấp">{inp('emergencyPhone')}</Field>
        </>}
      </div>
    </Modal>
  )
}
