import { useEffect, useRef, useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { DEPTS, deptOf, WORK_SITES, siteOptions, LEVELS } from '../../../data/hrData'
import { Field } from './shared'
import { uploadRaw } from '../../QS/api/files'

/* Trang nhận việc: nhập hồ sơ nhân sự đầy đủ theo chuẩn hồ sơ lao động (sơ yếu lý lịch, BLLĐ)
   & tờ khai tham gia BHXH-BHYT-BHTN (TK1-TS) — kèm đính kèm giấy tờ. */
const TABS = [
  { key: 'personal', label: 'Thông tin cá nhân', icon: 'users' },
  { key: 'contact', label: 'Liên hệ & cư trú', icon: 'building' },
  { key: 'job', label: 'Công việc & hợp đồng', icon: 'briefcase' },
  { key: 'insurance', label: 'BHXH · BHYT · BHTN', icon: 'shield' },
  { key: 'tax', label: 'Thuế TNCN & ngân hàng', icon: 'wallet' },
  { key: 'edu', label: 'Học vấn & kinh nghiệm', icon: 'award' },
  { key: 'docs', label: 'Hồ sơ đính kèm', icon: 'file' },
]
const DOCS = [
  { key: 'cv', label: 'Sơ yếu lý lịch (có xác nhận địa phương)', required: true },
  { key: 'cccd', label: 'Bản sao CCCD / CMND (công chứng)', required: true },
  { key: 'degree', label: 'Bằng cấp, chứng chỉ chuyên môn (bản sao)', required: true },
  { key: 'health', label: 'Giấy khám sức khoẻ (trong 6 tháng)', required: true },
  { key: 'photo', label: 'Ảnh 3×4 (nền trắng)', required: true },
  { key: 'resident', label: 'Xác nhận thông tin cư trú (mẫu CT07)', required: false },
  { key: 'bhxh', label: 'Sổ BHXH / tờ rời quá trình đóng (nếu đã có)', required: false },
  { key: 'tk1', label: 'Tờ khai tham gia BHXH, BHYT (TK1-TS)', required: false },
  { key: 'dependents', label: 'Giấy tờ chứng minh người phụ thuộc (giảm trừ gia cảnh)', required: false },
]
const DEGREES = ['THPT', 'Trung cấp', 'Cao đẳng', 'Đại học', 'Thạc sĩ', 'Tiến sĩ']
const CONTRACTS = ['Thử việc', 'Xác định thời hạn (12 tháng)', 'Xác định thời hạn (24 tháng)', 'Không xác định thời hạn', 'Thời vụ / khoán việc']
const RELATIONS = ['Con', 'Vợ / chồng', 'Cha', 'Mẹ', 'Anh / chị / em', 'Khác']
const money = v => (Number(v) || 0).toLocaleString('vi-VN')
const digits = v => String(v || '').replace(/\D/g, '')

export default function OnboardPage({ candidate: c, job = {}, initial, employees, defaultManagerOf, onCancel, onConfirm }) {
  const [tab, setTab] = useState('personal')
  const [tried, setTried] = useState(false)
  const salary0 = (Number(((job.salary || '').match(/\d+/) || [12])[0]) || 12) * 1000000
  const [f, setF] = useState(() => ({
    code: initial.code, name: c.name, gender: 'Nam', dob: '', birthplace: '', hometown: '', ethnic: 'Kinh', religion: 'Không', nationality: 'Việt Nam',
    cccd: '', cccdDate: '', cccdPlace: 'Cục Cảnh sát QLHC về TTXH', marital: 'Độc thân', photo: null,
    phone: c.phone || '', email: c.email || '', workEmail: '', address: '', currentAddress: '', sameAddress: true,
    emergencyName: '', emergencyRelation: 'Cha', emergencyPhone: '',
    dept: initial.dept, position: initial.position, level: initial.level, managerId: initial.managerId, site: initial.site, joinDate: initial.joinDate,
    workMode: 'Toàn thời gian', contractType: 'Thử việc', probationMonths: 2, probationRate: 85, salary: salary0,
    allowLunch: 730000, allowTransport: 500000, allowPhone: 0,
    hasBhxh: false, bhxhNo: '', hospital: '', insBase: salary0, insSince: initial.joinDate, householdNo: '',
    mst: '', taxOffice: '', dependents: [], bankName: 'Vietcombank', bankAccount: '', bankBranch: '', bankHolder: c.name.toUpperCase(),
    degree: 'Đại học', school: '', major: '', gradYear: '', languages: '', computer: '',
    experience: [{ company: '', role: '', from: '', to: '' }],
    docs: Object.fromEntries(DOCS.map(d => [d.key, d.key === 'cv' && c.cv ? [{ name: c.cv, url: c.cvUrl || null }] : []])),
  }))
  const set = p => setF(x => ({ ...x, ...p }))
  const inp = (k, props = {}) => <input value={f[k] ?? ''} onChange={e => set({ [k]: e.target.value })} {...props} />

  /* Kiểm tra bắt buộc theo từng tab */
  const errs = {
    personal: [!f.name.trim() && 'Họ và tên', !f.dob && 'Ngày sinh', digits(f.cccd).length !== 12 && 'Số CCCD (12 số)', !f.cccdDate && 'Ngày cấp CCCD'].filter(Boolean),
    contact: [!f.phone.trim() && 'Số điện thoại', !f.address.trim() && 'Địa chỉ thường trú', !f.emergencyName.trim() && 'Người liên hệ khẩn cấp', !f.emergencyPhone.trim() && 'SĐT khẩn cấp'].filter(Boolean),
    job: [!/^NV\d{3,}$/.test(f.code) && 'Mã NV (NV + số)', employees.some(e => e.code === f.code) && 'Mã NV đã tồn tại', !f.position.trim() && 'Chức danh', !f.joinDate && 'Ngày bắt đầu', !(Number(f.salary) > 0) && 'Lương'].filter(Boolean),
    insurance: [f.hasBhxh && digits(f.bhxhNo).length !== 10 && 'Mã số BHXH (10 số)', !f.hospital.trim() && 'Nơi KCB ban đầu'].filter(Boolean),
    tax: [!f.bankAccount.trim() && 'Số tài khoản'].filter(Boolean),
    edu: [!f.school.trim() && 'Trường đào tạo'].filter(Boolean),
    docs: DOCS.filter(d => d.required && !f.docs[d.key].length).map(d => d.label.split(' (')[0]),
  }
  const total = Object.values(errs).reduce((n, l) => n + l.length, 0)
  const curIdx = TABS.findIndex(t => t.key === tab)

  /* BH bắt buộc (2026): NLĐ 10,5% (8 BHXH + 1,5 BHYT + 1 BHTN) · DN 21,5% (17,5 + 3 + 1) */
  const insBase = Number(f.insBase) || 0
  const deptStaff = employees.filter(e => e.status !== 'left' && ['Giám đốc', 'Trưởng phòng', 'Phó phòng', 'Quản lý', 'Trưởng nhóm'].includes(e.level))

  const fileRef = useRef({})
  const addFiles = (key, files) => set({ docs: { ...f.docs, [key]: [...f.docs[key], ...[...files].map(x => ({ name: x.name, url: URL.createObjectURL(x), size: x.size, file: x }))] } })
  const removeFile = (key, i) => set({ docs: { ...f.docs, [key]: f.docs[key].filter((_, j) => j !== i) } })
  useEffect(() => { const k = e => { if (e.key === 'Escape') onCancel() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [onCancel])

  const [busy, setBusy] = useState('')
  /* Giấy tờ chọn từ máy (link blob: tạm của trình duyệt) tải lên kho file (/files/...) trước khi tạo hồ sơ */
  async function upload(x) {
    if (!x.file) return x.url
    return (await uploadRaw(x.file)).url
  }
  async function submit() {
    setTried(true)
    if (total) { setTab(TABS.find(t => errs[t.key].length).key); return }
    if (busy) return
    let attachments
    try {
      setBusy('Đang tải giấy tờ lên…')
      const docs = DOCS.flatMap(d => f.docs[d.key].map(x => ({ x, type: d.label }))).concat(f.photo ? [{ x: f.photo, type: 'Ảnh 3×4' }] : [])
      attachments = []
      for (const { x, type } of docs) attachments.push({ name: x.name, url: await upload(x), type })
    } catch (e) {
      alert('Tải giấy tờ lỗi: ' + e.message + ' - hồ sơ chưa được tạo')
      return
    } finally { setBusy('') }
    onConfirm({
      code: f.code, dept: f.dept, position: f.position.trim(), level: f.level, managerId: f.managerId, site: f.site, joinDate: f.joinDate,
      probationMonths: Number(f.probationMonths) || 2, probationRate: Number(f.probationRate) || 85, salary: Number(f.salary),
      record: {
        name: f.name.trim(), gender: f.gender, dob: f.dob, hometown: f.hometown, cccd: digits(f.cccd), cccdDate: f.cccdDate, cccdPlace: f.cccdPlace, marital: f.marital,
        phone: f.phone, email: f.workEmail || f.email, address: f.address, emergencyName: `${f.emergencyName} (${f.emergencyRelation})`, emergencyPhone: f.emergencyPhone,
        bankName: f.bankName, bankAccount: f.bankAccount,
        tax: { mst: f.mst, dependents: f.dependents.length, taxOffice: f.taxOffice },
        insurance: { bhxhNo: digits(f.bhxhNo), hospital: f.hospital, base: insBase, since: f.insSince || f.joinDate },
        education: f.school ? [{ school: f.school, major: f.major, degree: f.degree === 'Đại học' ? 'Cử nhân / Kỹ sư' : f.degree, from: '', to: f.gradYear }] : [],
        experience: f.experience.filter(x => x.company.trim()),
        attachments,
        profile: { birthplace: f.birthplace, ethnic: f.ethnic, religion: f.religion, nationality: f.nationality, currentAddress: f.sameAddress ? f.address : f.currentAddress, personalEmail: f.email, workMode: f.workMode, contractPlan: f.contractType, allowances: { lunch: Number(f.allowLunch) || 0, transport: Number(f.allowTransport) || 0, phone: Number(f.allowPhone) || 0 }, householdNo: f.householdNo, dependents: f.dependents, bankBranch: f.bankBranch, bankHolder: f.bankHolder, languages: f.languages, computer: f.computer },
      },
    })
  }
  const E = key => tried && errs[key].length > 0
  const miss = label => tried && Object.values(errs).flat().includes(label)

  return (
    <div className="cc-ob">
      <div className="cc-ob-head">
        <button className="cc-btn ghost" onClick={onCancel}><Icon name="arrowLeft" size={14} />Tuyển dụng</button>
        <span className="cc-av" style={{ width: 42, height: 42, background: 'var(--success)' }}>{c.name.split(' ').slice(-2).map(w => w[0]).join('').toUpperCase()}</span>
        <div className="cc-ob-title">
          <h2>Nhận việc — {f.name || c.name}</h2>
          <span>{f.code} · {f.position} · {deptOf(f.dept).name} · ứng tuyển qua {c.source}</span>
        </div>
        <span className="cc-grow" />
        {tried && total > 0 && <span className="cc-ob-miss"><Icon name="alert" size={13} />Còn {total} mục bắt buộc</span>}
        <button className="cc-btn ghost" onClick={onCancel}>Hủy</button>
        <button className="cc-btn" onClick={submit} disabled={!!busy}><Icon name="checkCircle" size={14} />{busy || 'Hoàn tất nhận việc'}</button>
      </div>

      <div className="cc-ob-body">
        <nav className="cc-ob-nav">
          {TABS.map((t, i) => (
            <button key={t.key} className={`${tab === t.key ? 'active' : ''}${E(t.key) ? ' err' : ''}`} onClick={() => setTab(t.key)}>
              <span className="cc-ob-num">{!errs[t.key].length ? <Icon name="check" size={12} stroke={3} /> : i + 1}</span>
              <span className="cc-ob-lab">{t.label}{errs[t.key].length > 0 && <em>{errs[t.key].length} mục còn thiếu</em>}</span>
            </button>
          ))}
          <div className="cc-ob-progress"><i style={{ width: `${Math.round(TABS.filter(t => !errs[t.key].length).length / TABS.length * 100)}%` }} /></div>
          <span className="cc-sub">Chuẩn hồ sơ lao động & tờ khai TK1-TS (BHXH)</span>
        </nav>

        <section className="cc-ob-panel">
          <h3>{TABS[curIdx].label}</h3>
          {tab === 'personal' && (
            <div className="cc-form">
              <div className="cc-ob-photo full">
                <label className="cc-ob-photo-box">{f.photo ? <img src={f.photo.url} alt="Ảnh 3x4" /> : <><Icon name="users" size={20} /><span>Ảnh 3×4</span></>}
                  <input type="file" accept="image/*" hidden onChange={e => { const x = e.target.files[0]; if (x) set({ photo: { name: x.name, url: URL.createObjectURL(x), file: x } }) }} />
                </label>
                <div className="cc-sub">Ảnh chân dung nền trắng, chụp trong 6 tháng — dùng cho thẻ nhân viên & hồ sơ BHXH.</div>
              </div>
              <Field label="Họ và tên (viết hoa có dấu) *" hint={miss('Họ và tên') ? 'Bắt buộc' : ''}>{inp('name')}</Field>
              <Field label="Giới tính"><select value={f.gender} onChange={e => set({ gender: e.target.value })}><option>Nam</option><option>Nữ</option></select></Field>
              <Field label="Ngày sinh *" hint={miss('Ngày sinh') ? 'Bắt buộc' : ''}>{inp('dob', { type: 'date' })}</Field>
              <Field label="Nơi sinh (tỉnh / thành)">{inp('birthplace', { placeholder: 'VD: Nghệ An' })}</Field>
              <Field label="Quê quán">{inp('hometown')}</Field>
              <Field label="Dân tộc">{inp('ethnic')}</Field>
              <Field label="Tôn giáo">{inp('religion')}</Field>
              <Field label="Quốc tịch">{inp('nationality')}</Field>
              <Field label="Số CCCD *" hint={miss('Số CCCD (12 số)') ? 'Đủ 12 chữ số' : ''}>{inp('cccd', { inputMode: 'numeric', maxLength: 12, placeholder: '12 chữ số' })}</Field>
              <Field label="Ngày cấp *" hint={miss('Ngày cấp CCCD') ? 'Bắt buộc' : ''}>{inp('cccdDate', { type: 'date' })}</Field>
              <Field label="Nơi cấp" full>{inp('cccdPlace')}</Field>
              <Field label="Tình trạng hôn nhân"><select value={f.marital} onChange={e => set({ marital: e.target.value })}><option>Độc thân</option><option>Đã kết hôn</option><option>Ly hôn</option></select></Field>
            </div>
          )}

          {tab === 'contact' && (
            <div className="cc-form">
              <Field label="Số điện thoại *">{inp('phone')}</Field>
              <Field label="Email cá nhân">{inp('email', { type: 'email' })}</Field>
              <Field label="Email công ty (cấp mới)">{inp('workEmail', { type: 'email', placeholder: `${(f.name.split(' ').pop() || '').toLowerCase()}@dezon.vn` })}</Field>
              <Field label="Hình thức làm việc"><select value={f.workMode} onChange={e => set({ workMode: e.target.value })}><option>Toàn thời gian</option><option>Bán thời gian</option><option>Làm việc từ xa</option></select></Field>
              <Field label="Địa chỉ thường trú *" full hint={miss('Địa chỉ thường trú') ? 'Bắt buộc' : ''}>{inp('address', { placeholder: 'Số nhà, đường, phường/xã, tỉnh/thành' })}</Field>
              <label className="cc-ob-check full"><input type="checkbox" checked={f.sameAddress} onChange={e => set({ sameAddress: e.target.checked })} />Nơi ở hiện tại trùng địa chỉ thường trú</label>
              {!f.sameAddress && <Field label="Nơi ở hiện tại" full>{inp('currentAddress')}</Field>}
              <div className="cc-ob-sep full">Liên hệ khẩn cấp</div>
              <Field label="Họ tên *">{inp('emergencyName')}</Field>
              <Field label="Quan hệ"><select value={f.emergencyRelation} onChange={e => set({ emergencyRelation: e.target.value })}>{RELATIONS.map(r => <option key={r}>{r}</option>)}</select></Field>
              <Field label="Số điện thoại *">{inp('emergencyPhone')}</Field>
            </div>
          )}

          {tab === 'job' && (
            <div className="cc-form">
              <Field label="Mã nhân viên (tự động) *" hint={miss('Mã NV đã tồn tại') ? 'Mã đã tồn tại' : miss('Mã NV (NV + số)') ? 'Dạng NV + số' : ''}>{inp('code', { onChange: e => set({ code: e.target.value.toUpperCase() }) })}</Field>
              <Field label="Ngày bắt đầu *">{inp('joinDate', { type: 'date' })}</Field>
              <Field label="Phòng ban"><select value={f.dept} onChange={e => set({ dept: e.target.value, managerId: defaultManagerOf?.(e.target.value)?.id || '' })}>{DEPTS.map(d => <option key={d.key} value={d.key}>{d.name}</option>)}</select></Field>
              <Field label="Chức danh *">{inp('position')}</Field>
              <Field label="Cấp bậc"><select value={f.level} onChange={e => set({ level: e.target.value })}>{LEVELS.map(l => <option key={l}>{l}</option>)}</select></Field>
              <Field label="Quản lý trực tiếp"><select value={f.managerId} onChange={e => set({ managerId: e.target.value })}><option value="">— Chưa chọn —</option>{deptStaff.map(e => <option key={e.id} value={e.id}>{e.name} · {e.position}</option>)}</select></Field>
              <Field label="Nơi làm việc"><select value={f.site} onChange={e => set({ site: e.target.value })}><option value="">— Chọn địa điểm —</option>{siteOptions(f.site).map(s => <option key={s}>{s}</option>)}</select></Field>
              <Field label="Loại hợp đồng sau thử việc"><select value={f.contractType} onChange={e => set({ contractType: e.target.value })}>{CONTRACTS.map(x => <option key={x}>{x}</option>)}</select></Field>
              <div className="cc-ob-sep full">Thử việc & lương</div>
              <Field label="Thời gian thử việc (tháng)"><select value={f.probationMonths} onChange={e => set({ probationMonths: e.target.value })}>{[1, 2].map(m => <option key={m} value={m}>{m} tháng</option>)}</select></Field>
              <Field label="Lương thử việc (% lương chính, tối thiểu 85%)"><input type="number" min="85" max="100" value={f.probationRate} onChange={e => set({ probationRate: e.target.value })} /></Field>
              <Field label="Lương cơ bản (đ/tháng) *"><input inputMode="numeric" value={money(f.salary)} onChange={e => set({ salary: digits(e.target.value) })} /></Field>
              <Field label="Lương thử việc (đ/tháng)"><input disabled value={money(Math.round((Number(f.salary) || 0) * (Number(f.probationRate) || 0) / 100))} /></Field>
              <Field label="Phụ cấp ăn trưa"><input inputMode="numeric" value={money(f.allowLunch)} onChange={e => set({ allowLunch: digits(e.target.value) })} /></Field>
              <Field label="Phụ cấp xăng xe"><input inputMode="numeric" value={money(f.allowTransport)} onChange={e => set({ allowTransport: digits(e.target.value) })} /></Field>
              <Field label="Phụ cấp điện thoại"><input inputMode="numeric" value={money(f.allowPhone)} onChange={e => set({ allowPhone: digits(e.target.value) })} /></Field>
              <div className="cc-ob-note full"><Icon name="file" size={13} />Sẽ lập <b>HĐTV-{f.code}</b> ({f.probationMonths} tháng · {f.probationRate}% lương), sau đó chuyển sang <b>{f.contractType}</b> khi đạt thử việc.</div>
            </div>
          )}

          {tab === 'insurance' && (
            <div className="cc-form">
              <label className="cc-ob-check full"><input type="checkbox" checked={f.hasBhxh} onChange={e => set({ hasBhxh: e.target.checked })} />Người lao động đã có mã số BHXH (từng tham gia trước đây)</label>
              {f.hasBhxh
                ? <Field label="Mã số BHXH (10 số) *" hint={miss('Mã số BHXH (10 số)') ? 'Đủ 10 chữ số' : ''}>{inp('bhxhNo', { inputMode: 'numeric', maxLength: 10 })}</Field>
                : <div className="cc-ob-note"><Icon name="shield" size={13} />Chưa có mã số — công ty kê khai TK1-TS để cơ quan BHXH cấp mới.</div>}
              <Field label="Mã hộ gia đình (nếu có)">{inp('householdNo')}</Field>
              <Field label="Nơi đăng ký KCB ban đầu *" full hint={miss('Nơi KCB ban đầu') ? 'Bắt buộc' : ''}>{inp('hospital', { placeholder: 'VD: BV Đa khoa Tâm Anh TP.HCM' })}</Field>
              <Field label="Mức lương đóng BH (đ/tháng)"><input inputMode="numeric" value={money(f.insBase)} onChange={e => set({ insBase: digits(e.target.value) })} /></Field>
              <Field label="Tham gia từ ngày">{inp('insSince', { type: 'date' })}</Field>
              <div className="cc-ob-ins full">
                <div><span>NLĐ đóng (10,5%)</span><b>{money(insBase * 0.105)} đ</b><em>BHXH 8% · BHYT 1,5% · BHTN 1%</em></div>
                <div><span>Doanh nghiệp đóng (21,5%)</span><b>{money(insBase * 0.215)} đ</b><em>BHXH 17,5% · BHYT 3% · BHTN 1%</em></div>
                <div><span>Tổng / tháng</span><b>{money(insBase * 0.32)} đ</b><em>Bắt đầu sau thử việc nếu HĐ ≥ 1 tháng</em></div>
              </div>
            </div>
          )}

          {tab === 'tax' && (
            <div className="cc-form">
              <Field label="Mã số thuế cá nhân">{inp('mst', { placeholder: 'Để trống — công ty đăng ký hộ' })}</Field>
              <Field label="Cơ quan thuế quản lý">{inp('taxOffice')}</Field>
              <div className="cc-ob-sep full">Người phụ thuộc (giảm trừ gia cảnh) · {f.dependents.length}</div>
              {f.dependents.map((d, i) => (
                <div key={i} className="cc-ob-row full">
                  <input placeholder="Họ tên" value={d.name} onChange={e => set({ dependents: f.dependents.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <select value={d.relation} onChange={e => set({ dependents: f.dependents.map((x, j) => (j === i ? { ...x, relation: e.target.value } : x)) })}>{RELATIONS.map(r => <option key={r}>{r}</option>)}</select>
                  <input type="date" value={d.dob} onChange={e => set({ dependents: f.dependents.map((x, j) => (j === i ? { ...x, dob: e.target.value } : x)) })} />
                  <input placeholder="CCCD / MST" value={d.id} onChange={e => set({ dependents: f.dependents.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) })} />
                  <button className="cc-icon-btn danger" onClick={() => set({ dependents: f.dependents.filter((_, j) => j !== i) })} title="Bỏ"><Icon name="x" size={14} /></button>
                </div>
              ))}
              <button className="cc-btn ghost full" style={{ justifySelf: 'start' }} onClick={() => set({ dependents: [...f.dependents, { name: '', relation: 'Con', dob: '', id: '' }] })}><Icon name="plus" size={13} />Thêm người phụ thuộc</button>
              <div className="cc-ob-sep full">Tài khoản nhận lương</div>
              <Field label="Ngân hàng"><select value={f.bankName} onChange={e => set({ bankName: e.target.value })}>{['Vietcombank', 'Techcombank', 'BIDV', 'VietinBank', 'ACB', 'MB Bank', 'VPBank', 'TPBank', 'Agribank'].map(b => <option key={b}>{b}</option>)}</select></Field>
              <Field label="Số tài khoản *">{inp('bankAccount', { inputMode: 'numeric' })}</Field>
              <Field label="Chi nhánh">{inp('bankBranch')}</Field>
              <Field label="Chủ tài khoản">{inp('bankHolder')}</Field>
            </div>
          )}

          {tab === 'edu' && (
            <div className="cc-form">
              <Field label="Trình độ cao nhất"><select value={f.degree} onChange={e => set({ degree: e.target.value })}>{DEGREES.map(d => <option key={d}>{d}</option>)}</select></Field>
              <Field label="Năm tốt nghiệp">{inp('gradYear', { inputMode: 'numeric', placeholder: 'VD: 2020' })}</Field>
              <Field label="Trường đào tạo *">{inp('school')}</Field>
              <Field label="Chuyên ngành">{inp('major')}</Field>
              <Field label="Ngoại ngữ">{inp('languages', { placeholder: 'VD: Tiếng Anh — IELTS 6.5' })}</Field>
              <Field label="Tin học / phần mềm">{inp('computer', { placeholder: 'VD: AutoCAD, Revit, MISA' })}</Field>
              <div className="cc-ob-sep full">Quá trình công tác</div>
              {f.experience.map((x, i) => (
                <div key={i} className="cc-ob-row full">
                  <input placeholder="Công ty" value={x.company} onChange={e => set({ experience: f.experience.map((y, j) => (j === i ? { ...y, company: e.target.value } : y)) })} />
                  <input placeholder="Vị trí" value={x.role} onChange={e => set({ experience: f.experience.map((y, j) => (j === i ? { ...y, role: e.target.value } : y)) })} />
                  <input placeholder="Từ năm" value={x.from} onChange={e => set({ experience: f.experience.map((y, j) => (j === i ? { ...y, from: e.target.value } : y)) })} />
                  <input placeholder="Đến năm" value={x.to} onChange={e => set({ experience: f.experience.map((y, j) => (j === i ? { ...y, to: e.target.value } : y)) })} />
                  <button className="cc-icon-btn danger" onClick={() => set({ experience: f.experience.filter((_, j) => j !== i) })} title="Bỏ"><Icon name="x" size={14} /></button>
                </div>
              ))}
              <button className="cc-btn ghost full" style={{ justifySelf: 'start' }} onClick={() => set({ experience: [...f.experience, { company: '', role: '', from: '', to: '' }] })}><Icon name="plus" size={13} />Thêm nơi công tác</button>
            </div>
          )}

          {tab === 'docs' && (
            <div className="cc-ob-docs">
              {DOCS.map(d => {
                const files = f.docs[d.key]
                return (
                  <div key={d.key} className={`cc-ob-doc${files.length ? ' done' : ''}${tried && d.required && !files.length ? ' err' : ''}`}
                    onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(d.key, e.dataTransfer.files) }}>
                    <span className="cc-ob-doc-ic">{files.length ? <Icon name="check" size={14} stroke={3} /> : <Icon name="file" size={14} />}</span>
                    <div className="cc-ob-doc-main">
                      <b>{d.label}{d.required && <i> *</i>}</b>
                      {files.length === 0
                        ? <span>{d.required ? 'Bắt buộc' : 'Không bắt buộc'} · kéo thả file vào đây</span>
                        : <div className="cc-ob-files">{files.map((x, i) => (
                          <span key={i}>{x.url ? <a href={x.url} target="_blank" rel="noreferrer">{x.name}</a> : x.name}<button onClick={() => removeFile(d.key, i)} title="Bỏ file">×</button></span>
                        ))}</div>}
                    </div>
                    <button className="cc-btn ghost" onClick={() => fileRef.current[d.key]?.click()}><Icon name="upload" size={13} />Tải lên</button>
                    <input ref={el => { fileRef.current[d.key] = el }} type="file" multiple hidden accept="image/*,.pdf,.doc,.docx" onChange={e => { addFiles(d.key, e.target.files); e.target.value = '' }} />
                  </div>
                )
              })}
              <div className="cc-sub">Đã nộp {DOCS.filter(d => f.docs[d.key].length).length}/{DOCS.length} loại giấy tờ · chấp nhận ảnh, PDF, Word.</div>
            </div>
          )}

          {tried && errs[tab].length > 0 && <div className="cc-ob-errs"><Icon name="alert" size={13} />Còn thiếu: {errs[tab].join(', ')}</div>}
          <div className="cc-ob-foot">
            <button className="cc-btn ghost" disabled={curIdx === 0} onClick={() => setTab(TABS[curIdx - 1].key)}><Icon name="arrowLeft" size={14} />Trước</button>
            <span className="cc-grow" />
            {curIdx < TABS.length - 1
              ? <button className="cc-btn" onClick={() => setTab(TABS[curIdx + 1].key)}>Tiếp: {TABS[curIdx + 1].label}<Icon name="arrowRight" size={14} /></button>
              : <button className="cc-btn" onClick={submit} disabled={!!busy}><Icon name="checkCircle" size={14} />{busy || 'Hoàn tất nhận việc'}</button>}
          </div>
        </section>
      </div>
    </div>
  )
}
