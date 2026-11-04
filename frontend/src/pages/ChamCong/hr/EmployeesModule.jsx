import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { DEPTS, STATUS, LEVELS, HR_TODAY, MONTHS, deptOf, fmtDate, fmtMoney, yearsBetween, daysBetween } from '../../../data/hrData'
import { Avatar, DeptPill, StatusPill, Pill, Seg, Empty, downloadCsv, RoleList } from './shared'
import { useAccess } from './access'
import { DEFAULT_PAYROLL_CONFIG } from '../../../data/hrData2'
import { AllocationMatrix, distinctTones } from './PayrollModule'

const DETAIL_TABS = [
  { value: 'info', label: 'Thông tin cá nhân', icon: 'user' },
  { value: 'cv', label: 'Sơ yếu lý lịch', icon: 'graduation' },
  { value: 'contract', label: 'Hợp đồng', icon: 'file' },
  { value: 'tax', label: 'Thuế & BHXH', icon: 'shield' },
  { value: 'history', label: 'Quá trình công tác', icon: 'trending' },
]

const Row = ({ k, v }) => <div className="cc-kv"><span>{k}</span><b>{v || '—'}</b></div>

/* Trang chi tiết hồ sơ một nhân viên */
/* Tỉ lệ phân bổ công việc: phòng ban chính = 100% − tổng kiêm nhiệm */
function Allocation({ emp, concurrent, boardUnits = [], editable, onSave, pay, showMoney, editSignal }) {
  // Đang sửa: draft = các dòng kiêm nhiệm, homeDraft = tỉ lệ phòng ban chính — mỗi dòng nhập độc lập, không tự chia lại
  const [draft, setDraft] = useState(null)
  const [homeDraft, setHomeDraft] = useState(100)
  const [err, setErr] = useState('')
  const cardRef = useRef(null)
  const barRef = useRef(null)
  const saved = concurrent.map(c => ({ unitKey: c.unit.key, title: c.title, pct: c.pct, allowance: c.allowance }))
  const savedUsed = Math.round(saved.reduce((s, c) => s + c.pct, 0) * 10) / 10

  function startEdit() {
    setErr('')
    setDraft(saved.map(r => ({ ...r })))
    setHomeDraft(Math.round((100 - savedUsed) * 10) / 10)
  }
  // Bấm "Sửa" ở ô Kiêm nhiệm phía trên → mở chế độ sửa & cuộn tới thẻ này
  useEffect(() => {
    if (!editSignal || !editable) return
    startEdit()
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [editSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  const r1 = n => Math.round((Number(n) || 0) * 10) / 10
  const rows = draft || saved
  const homePct = draft ? r1(homeDraft) : r1(100 - savedUsed)
  const sumPct = r1(homePct + rows.reduce((s, c) => s + (Number(c.pct) || 0), 0)) // SUM(tỉ lệ)
  const diff = r1(100 - sumPct)
  const unitOf = k => boardUnits.find(u => u.key === k)
  const home = deptOf(emp.dept)
  const parts = distinctTones([{ key: 'home', label: home.name, tone: home.tone, pct: homePct, title: emp.position, main: true },
    ...rows.map((c, i) => ({ key: 'r' + i, label: unitOf(c.unitKey)?.name || 'Chưa chọn ban', tone: unitOf(c.unitKey)?.tone || 'muted', pct: Number(c.pct) || 0, title: c.title, allowance: c.allowance }))])
  const setRow = (i, patch) => { setErr(''); setDraft(d => d.map((r, j) => (j === i ? { ...r, ...patch } : r))) }
  const free = boardUnits.filter(u => !rows.some(r => r.unitKey === u.key))
  const salary = Number(emp.salary) || 0
  const money = pct => Math.round(salary * (Number(pct) || 0) / 100)
  const fmt = v => v.toLocaleString('vi-VN') + ' đ'
  const pctFromMoney = s => { const v = Number(String(s).replace(/\D/g, '')) || 0; return salary ? Math.round(v / salary * 1000) / 10 : 0 }
  const sumAllowance = rows.reduce((s, r) => s + (Number(r.allowance) || 0), 0)

  /* Kéo vạch chia giữa 2 phần liền kề trên thanh: phần trái tăng thì phần phải giảm tương ứng (bước 1%) */
  function startDrag(e, idx) {
    e.preventDefault()
    const bar = barRef.current.getBoundingClientRect()
    const startX = e.clientX
    const vals = parts.map(p => p.pct)
    const total = vals.reduce((s, v) => s + v, 0) || 100
    const a0 = vals[idx], b0 = vals[idx + 1]
    const minA = idx === 0 ? 10 : 0
    const move = ev => {
      let d = Math.round((ev.clientX - startX) / bar.width * total)
      d = Math.max(minA - a0, Math.min(b0 - (idx + 1 === 0 ? 10 : 0), d))
      const a = a0 + d, b = b0 - d
      setErr('')
      if (idx === 0) setHomeDraft(a)
      else setDraft(dd => dd.map((r, j) => (j === idx - 1 ? { ...r, pct: a } : r)))
      setDraft(dd => dd.map((r, j) => (j === idx ? { ...r, pct: b } : r)))
    }
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.body.style.cursor = '' }
    document.body.style.cursor = 'ew-resize'
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  function save() {
    if (rows.some(r => !r.unitKey)) { setErr('Chọn ban cho tất cả các dòng kiêm nhiệm'); return }
    if (new Set(rows.map(r => r.unitKey)).size !== rows.length) { setErr('Mỗi ban chỉ được chọn một lần'); return }
    if (rows.some(r => (Number(r.pct) || 0) <= 0)) { setErr('Tỉ lệ của mỗi ban kiêm nhiệm phải lớn hơn 0%'); return }
    if (homePct < 10) { setErr('Phòng ban chính phải giữ ít nhất 10%'); return }
    if (diff !== 0) { setErr(diff > 0 ? `Chưa đủ tỉ trọng 100% — còn thiếu ${diff}%` : `Vượt tỉ trọng 100% — đang thừa ${-diff}%`); return }
    onSave(rows.map(r => ({ ...r, pct: r1(r.pct), allowance: Number(r.allowance) || 0, title: (r.title || '').trim() || 'Thành viên' })))
    setDraft(null)
  }

  const visible = parts.filter(p => p.pct > 0)
  return (
    <div ref={cardRef} className={`cc-card cc-pad${draft ? ' cc-alloc-editing' : ''}`}>
      <div className="cc-row-between">
        <h3 className="cc-h3" style={{ margin: 0 }}>Kiêm nhiệm & phân bổ công việc</h3>
        <div className="cc-actions">
          <span className="cc-sub">{rows.length ? `Kiêm nhiệm ${rows.length} ban · ${r1(sumPct - homePct)}%` : 'Không kiêm nhiệm'}</span>
          {editable && !draft && <button className="cc-btn ghost" style={{ height: 30 }} onClick={startEdit}><Icon name="edit" size={13} />Chỉnh sửa</button>}
        </div>
      </div>

      {/* Thanh tỉ trọng — ở chế độ sửa có vạch kéo giữa các phần */}
      <div className={`cc-alloc-bar${draft ? ' editing' : ''}`} ref={barRef}>
        {parts.map((p, i) => (p.pct > 0 || draft) && (
          <span key={p.key} className={`cc-tone-${p.tone}`} style={{ flex: Math.max(p.pct, 0.0001) }} title={`${p.label}: ${p.pct}%`}>
            {p.pct >= 8 ? p.pct + '%' : ''}
            {draft && i < parts.length - 1 && <i className="cc-alloc-handle" role="separator" aria-label={`Kéo để đổi tỉ trọng ${p.label} / ${parts[i + 1].label}`} onPointerDown={e => startDrag(e, i)} />}
          </span>
        ))}
        {draft && diff > 0 && <span className="cc-alloc-gap" style={{ flex: diff }} title={`Còn thiếu ${diff}%`}>{diff >= 6 ? `thiếu ${diff}%` : ''}</span>}
      </div>
      {draft && <div className="cc-sub" style={{ marginBottom: 8 }}>Kéo các vạch trắng trên thanh để chuyển tỉ trọng giữa 2 phần liền kề (bước 1%), hoặc nhập trực tiếp từng dòng.</div>}

      {!draft && visible.map(p => (
        <div key={p.key} className="cc-alloc-row">
          <i className={`cc-tone-${p.tone}`} />
          <div className="cc-grow"><b>{p.label}</b><span>{p.main ? 'Phòng ban chính · ' : 'Kiêm nhiệm · '}{p.title}</span></div>
          {!p.main && <span className="cc-sub">{p.allowance ? `Phụ cấp ${Number(p.allowance).toLocaleString('vi-VN')} đ/tháng` : 'Không phụ cấp'}</span>}
          <div className="cc-alloc-val"><b className="mono">{p.pct}%</b>{salary > 0 && <span className="mono">≈ {fmt(money(p.pct))}</span>}</div>
        </div>
      ))}

      {draft && (
        <div className="cc-alloc-edit">
          <div className="cc-alloc-erow head"><span>Đơn vị tham gia</span><span>Chức danh</span><span>Tỉ lệ</span><span>Tương ứng / tháng</span><span>Phụ cấp / tháng</span><span /></div>
          <div className="cc-alloc-erow main">
            <span className="cc-alloc-name"><i className={`cc-dot cc-tone-${parts[0].tone}`} />{home.name}</span>
            <span className="cc-muted">{emp.position} · phòng ban chính</span>
            <label className="cc-pct-in"><input type="number" min="10" max="100" step="1" className={homePct < 10 ? 'err' : ''} value={homeDraft} onChange={e => { setErr(''); setHomeDraft(e.target.value === '' ? '' : Math.max(0, Number(e.target.value))) }} /><em>%</em></label>
            <label className="cc-pct-in money"><input inputMode="numeric" disabled={!salary} value={money(homePct).toLocaleString('vi-VN')} onChange={e => { setErr(''); setHomeDraft(pctFromMoney(e.target.value)) }} /><em>đ</em></label>
            <span className="cc-sub">Tối thiểu 10%</span><span />
          </div>
          {draft.map((r, i) => (
            <div key={i} className="cc-alloc-erow">
              <select value={r.unitKey || ''} onChange={e => setRow(i, { unitKey: e.target.value })}>
                <option value="">— Chọn ban —</option>
                {boardUnits.filter(u => u.key === r.unitKey || !draft.some(x => x.unitKey === u.key)).map(u => <option key={u.key} value={u.key}>{u.name}</option>)}
              </select>
              <input value={r.title} placeholder="VD: Thành viên" onChange={e => setRow(i, { title: e.target.value })} />
              <label className="cc-pct-in"><input type="number" min="0" max="90" step="1" value={r.pct} onChange={e => setRow(i, { pct: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })} /><em>%</em></label>
              <label className="cc-pct-in money" title="Nhập số tiền để quy đổi ra %">
                <input inputMode="numeric" disabled={!salary} value={money(r.pct).toLocaleString('vi-VN')} onChange={e => setRow(i, { pct: pctFromMoney(e.target.value) })} /><em>đ</em>
              </label>
              <input inputMode="numeric" value={Number(r.allowance || 0).toLocaleString('vi-VN')} onChange={e => setRow(i, { allowance: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
              <button className="cc-icon-btn sm danger" title="Bỏ kiêm nhiệm này" onClick={() => { setErr(''); setDraft(d => d.filter((_, j) => j !== i)) }}><Icon name="x" size={13} /></button>
            </div>
          ))}
          {/* Hàng tổng: SUM của tỉ lệ, số tiền tương ứng & phụ cấp */}
          <div className={`cc-alloc-erow sum${diff === 0 ? ' ok' : ' bad'}`}>
            <span className="cc-alloc-name">Tổng cộng (SUM)</span>
            <span className="cc-sub">= {parts.map(p => `${p.pct}%`).join(' + ')}</span>
            <b className="mono cc-sum-pct">{sumPct}%</b>
            <b className="mono cc-sum-money">{fmt(money(sumPct))}</b>
            <b className="mono cc-sum-money">{fmt(sumAllowance)}</b>
            <span>{diff === 0 ? <Icon name="checkCircle" size={16} /> : <Icon name="alert" size={16} />}</span>
          </div>
          {diff !== 0 && (
            <div className="cc-alloc-warn">
              <Icon name="alert" size={14} />
              {diff > 0 ? <>Chưa đủ tỉ trọng 100% — còn thiếu <b>{diff}%</b> (≈ {fmt(money(diff))}). Nhập thêm cho các dòng hoặc kéo trên thanh.</>
                : <>Vượt tỉ trọng 100% — đang thừa <b>{-diff}%</b> (≈ {fmt(money(-diff))}). Giảm tỉ lệ ở một hoặc nhiều dòng.</>}
            </div>
          )}
          {free.length > 0 && <button className="cc-link-btn" style={{ marginTop: 8 }} onClick={() => setDraft(d => [...d, { unitKey: free[0].key, title: 'Thành viên', pct: 0, allowance: 0 }])}><Icon name="plus" size={13} stroke={2.4} />Thêm kiêm nhiệm</button>}
          <div className="cc-sub" style={{ marginTop: 6 }}>Số tiền tương ứng tính theo lương cơ bản {fmt(salary)}/tháng — nhập % hoặc nhập số tiền, ô còn lại tự quy đổi.</div>
          {err && <div className="cc-alloc-err">{err}</div>}
          <div className="cc-alloc-foot">
            <span className="cc-sub cc-grow">Thay đổi áp dụng cho sơ đồ tổ chức, hồ sơ & phân bổ chi phí trong Bảng lương</span>
            <button className="cc-btn ghost" onClick={() => { setDraft(null); setErr('') }}>Hủy</button>
            <button className="cc-btn" onClick={save} disabled={diff !== 0} title={diff !== 0 ? 'Tổng tỉ trọng phải bằng 100%' : ''}><Icon name="check" size={14} stroke={2.6} />Lưu phân bổ</button>
          </div>
        </div>
      )}
      {!draft && rows.length > 0 && <div className="cc-sub" style={{ marginTop: 8 }}>Tỉ trọng này được dùng để phân bổ chi phí lương theo đơn vị trong Bảng lương.</div>}
      {!draft && pay && showMoney && (
        <AllocationMatrix p={pay} title={`Phân bổ chi tiết theo khoản lương · ${MONTHS[0].label}`} sub="Tổng (100%) của từng khoản & phần chia cho mỗi đơn vị theo tỉ trọng kiêm nhiệm" />
      )}
    </div>
  )
}

function EmployeeDetail({ emp, employees, concurrent = [], boardUnits, onSaveConcurrent, pay, onBack, onEdit, onDelete, onOffboard, onOpen }) {
  const { can, role } = useAccess()
  const [tab, setTab] = useState('info')
  const [editSignal, setEditSignal] = useState(0)
  const manager = employees.find(e => e.id === emp.managerId)
  const reports = employees.filter(e => e.managerId === emp.id && e.status !== 'left')
  const activeContract = (emp.contracts || []).find(c => c.status === 'active')
  const d = deptOf(emp.dept)

  return (
    <div className="cc-stack">
      {role !== 'employee' && <button className="cc-back" onClick={onBack}><Icon name="arrowLeft" size={15} />Danh sách nhân sự</button>}

      <div className={`cc-card cc-profile cc-tone-${d.tone}`}>
        <Avatar emp={emp} size={64} />
        <div className="cc-grow">
          <div className="cc-kicker">{emp.code} · {d.name}</div>
          <h2 className="cc-h2">{emp.name}</h2>
          {concurrent.length > 0 && <RoleList emp={emp} concurrent={concurrent} deptName={d.name} />}
          <div className="cc-profile-meta">
            {!concurrent.length && <span><Icon name="briefcase" size={13} />{emp.position}</span>}
            <span><Icon name="mapPin" size={13} />{emp.site}</span>
            <span><Icon name="phone" size={13} />{emp.phone}</span>
            <span><Icon name="mail" size={13} />{emp.email}</span>
          </div>
        </div>
        <div className="cc-profile-side">
          <StatusPill status={emp.status} />
          <div className="cc-actions">
            {can('employees', 'edit') && <button className="cc-btn ghost" onClick={() => onEdit(emp)}><Icon name="edit" size={14} />Sửa</button>}
            {emp.status !== 'left' && can('employees', 'edit') && <button className="cc-btn ghost" onClick={() => onOffboard(emp)}><Icon name="logIn" size={14} />Cho nghỉ việc</button>}
            {can('employees', 'delete') && <button className="cc-icon-btn danger" title="Xoá hồ sơ" onClick={() => onDelete(emp)}><Icon name="trash" size={15} /></button>}
          </div>
        </div>
      </div>

      <div className="cc-mini-stats">
        <div><span>Thâm niên</span><b>{yearsBetween(emp.joinDate) > 0 ? `${yearsBetween(emp.joinDate)} năm` : `${Math.max(0, Math.round(daysBetween(emp.joinDate, HR_TODAY) / 30))} tháng`}</b></div>
        <div><span>Hợp đồng hiện tại</span><b>{activeContract ? activeContract.type : '—'}</b></div>
        <div><span>Quản lý trực tiếp</span>{manager ? <button className="cc-link-btn" onClick={() => onOpen(manager.id)}>{manager.name}</button> : <b>—</b>}</div>
        <div><span>Cấp dưới trực tiếp</span><b>{reports.length} người</b></div>
        <div className="cc-mini-edit">
          <span>Kiêm nhiệm {can('employees', 'edit') && emp.status !== 'left' && <button className="cc-link-btn" onClick={() => { setTab('info'); setEditSignal(n => n + 1) }}><Icon name="edit" size={11} />Sửa</button>}</span>
          <b>{concurrent.length ? concurrent.map(c => `${c.unit.label} ${c.pct}%`).join(' · ') : 'Không'}</b>
          {pay && can('payroll', 'view') && <em>100% = {Math.round(pay.cost).toLocaleString('vi-VN')} đ/tháng{concurrent.length ? ` · phòng chính ${+(100 - concurrent.reduce((t, c) => t + c.pct, 0)).toFixed(1)}%` : ''}</em>}
        </div>
      </div>

      <Seg value={tab} onChange={setTab} options={DETAIL_TABS} />

      {tab === 'info' && (concurrent.length > 0 || can('employees', 'edit')) && emp.status !== 'left' && (
        <Allocation key={emp.id} emp={emp} concurrent={concurrent} boardUnits={boardUnits} editable={can('employees', 'edit')} onSave={list => onSaveConcurrent(emp, list)} pay={pay} showMoney={can('payroll', 'view')} editSignal={editSignal} />
      )}
      {tab === 'info' && (
        <div className="cc-grid2">
          <div className="cc-card cc-pad">
            <h3 className="cc-h3">Thông tin cá nhân</h3>
            <Row k="Giới tính" v={emp.gender} /><Row k="Ngày sinh" v={emp.dob ? `${fmtDate(emp.dob)} (${yearsBetween(emp.dob)} tuổi)` : ""} />
            <Row k="Quê quán" v={emp.hometown} /><Row k="Hôn nhân" v={emp.marital} />
            <Row k="Số CCCD" v={emp.cccd} /><Row k="Ngày cấp / nơi cấp" v={emp.cccdDate ? `${fmtDate(emp.cccdDate)} · ${emp.cccdPlace}` : ''} />
            <Row k="Địa chỉ" v={emp.address} />
          </div>
          <div className="cc-stack">
            <div className="cc-card cc-pad">
              <h3 className="cc-h3">Công việc</h3>
              <Row k="Chức danh" v={emp.position} /><Row k="Cấp bậc" v={emp.level} />
              <Row k="Phòng ban" v={d.name} /><Row k="Ngày vào làm" v={fmtDate(emp.joinDate)} />
              {emp.leaveDate && <Row k="Ngày nghỉ việc" v={fmtDate(emp.leaveDate)} />}
            </div>
            <div className="cc-card cc-pad">
              <h3 className="cc-h3">Ngân hàng & liên hệ khẩn cấp</h3>
              <Row k="Tài khoản" v={emp.bankAccount ? `${emp.bankName} · ${emp.bankAccount}` : ''} />
              <Row k="Liên hệ khẩn cấp" v={emp.emergencyName ? `${emp.emergencyName} · ${emp.emergencyPhone}` : ''} />
            </div>
          </div>
        </div>
      )}

      {tab === 'cv' && (
        <div className="cc-grid2">
          <div className="cc-card cc-pad">
            <h3 className="cc-h3">Học vấn</h3>
            {(emp.education || []).length === 0 && <Empty icon="graduation" text="Chưa cập nhật" />}
            {(emp.education || []).map((e, i) => <div key={i} className="cc-tl"><b>{e.school}</b><span>{e.major} · {e.degree}</span><em>{e.from}–{e.to}</em></div>)}
            <h3 className="cc-h3" style={{ marginTop: 18 }}>Kinh nghiệm</h3>
            {emp.experience.length === 0 && <Empty icon="briefcase" text="Chưa có kinh nghiệm trước đây" />}
            {emp.experience.map((e, i) => <div key={i} className="cc-tl"><b>{e.company}</b><span>{e.role}</span><em>{e.from}–{e.to}</em></div>)}
          </div>
          <div className="cc-stack">
            <div className="cc-card cc-pad">
              <h3 className="cc-h3">Bằng cấp & chứng chỉ</h3>
              {emp.certificates.length === 0 && <Empty icon="award" text="Chưa có chứng chỉ" />}
              {emp.certificates.map((c, i) => {
                const soon = c.expiry && daysBetween(HR_TODAY, c.expiry) < 365
                return (
                  <div key={i} className="cc-doc">
                    <span className="cc-ico sm cc-tone-qs"><Icon name="award" size={13} /></span>
                    <div className="cc-grow"><b>{c.name}</b><span>{c.issuer}{c.date ? ' · cấp ' + fmtDate(c.date) : ''}</span></div>
                    {c.expiry && <Pill tone={soon ? 'finance' : 'muted'}>Hết hạn {fmtDate(c.expiry)}</Pill>}
                  </div>
                )
              })}
            </div>
            <div className="cc-card cc-pad">
              <h3 className="cc-h3">Tài liệu đính kèm</h3>
              {(emp.attachments || []).length === 0 && <Empty icon="file" text="Chưa có tài liệu" />}
              {(emp.attachments || []).map((a, i) => (
                <div key={i} className="cc-doc"><span className="cc-ico sm cc-tone-primary"><Icon name="file" size={13} /></span><div className="cc-grow"><b>{a.name}</b></div><Icon name="download" size={15} /></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'contract' && (
        <div className="cc-card cc-pad">
          <h3 className="cc-h3">Hợp đồng lao động</h3>
          <div className="cc-table-wrap">
            <table className="cc-table2">
              <thead><tr><th>Số hợp đồng</th><th>Loại</th><th>Hiệu lực</th><th>Hết hạn</th><th className="r">Lương</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {(emp.contracts || []).length === 0 && <tr><td colSpan={6}><Empty icon="file" text="Chưa có hợp đồng" /></td></tr>}
                {[...(emp.contracts || [])].reverse().map(c => {
                  const left = c.end ? daysBetween(HR_TODAY, c.end) : null
                  return (
                    <tr key={c.no}>
                      <td className="mono">{c.no}</td><td>{c.type}</td><td>{fmtDate(c.start)}</td>
                      <td>{c.end ? fmtDate(c.end) : 'Không thời hạn'}{c.status === 'active' && left != null && left <= 30 && <Pill tone="danger">còn {left} ngày</Pill>}</td>
                      <td className="r mono">{fmtMoney(c.salary)}</td>
                      <td><Pill tone={c.status === 'active' ? 'success' : 'muted'} dot>{c.status === 'active' ? 'Đang hiệu lực' : 'Đã kết thúc'}</Pill></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'tax' && (
        <div className="cc-grid2">
          <div className="cc-card cc-pad">
            <h3 className="cc-h3">Thuế thu nhập cá nhân</h3>
            <Row k="Mã số thuế" v={emp.tax.mst} /><Row k="Người phụ thuộc" v={`${emp.tax.dependents} người`} />
            <Row k="Giảm trừ gia cảnh" v={fmtMoney(DEFAULT_PAYROLL_CONFIG.personalDeduction + emp.tax.dependents * DEFAULT_PAYROLL_CONFIG.dependentDeduction) + '/tháng'} />
            <Row k="Cơ quan thuế" v={emp.tax.taxOffice} />
          </div>
          <div className="cc-card cc-pad">
            <h3 className="cc-h3">Bảo hiểm xã hội</h3>
            <Row k="Số sổ BHXH" v={emp.insurance.bhxhNo} /><Row k="Nơi KCB ban đầu" v={emp.insurance.hospital} />
            <Row k="Mức lương đóng BH" v={fmtMoney(emp.insurance.base)} />
            <Row k="Tham gia từ" v={emp.insurance.since ? fmtDate(emp.insurance.since) : 'Chưa tham gia (thử việc)'} />
            {emp.insurance.base && emp.insurance.since && <Row k="NLĐ đóng (10.5%)" v={fmtMoney(Math.round(emp.insurance.base * 0.105))} />}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="cc-card cc-pad">
          <h3 className="cc-h3">Quá trình công tác</h3>
          <ol className="cc-flow">
            {[...(emp.promotions || [])].reverse().map((p, i) => (
              <li key={i} className="done"><span className="cc-flow-dot"><Icon name="trending" size={12} /></span><div><b>{p.note}</b><span>{fmtDate(p.date)}</span></div></li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

/* Phân hệ "Hồ sơ nhân sự" — danh sách + lọc + CRUD + chi tiết */
export default function EmployeesModule({ employees, openId, onOpen, onAdd, onEdit, onDelete, onOffboard, concurrentOf = () => [], boardUnits = [], onSaveConcurrent, payOf = () => null }) {
  const { can } = useAccess()
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('all')
  const [level, setLevel] = useState('all')
  const [status, setStatus] = useState('current')
  const [view, setView] = useState('table')
  const [sort, setSort] = useState({ k: 'code', dir: 1 })

  const counts = useMemo(() => ({
    all: employees.length,
    current: employees.filter(e => e.status !== 'left').length,
    active: employees.filter(e => e.status === 'active').length,
    probation: employees.filter(e => e.status === 'probation').length,
    left: employees.filter(e => e.status === 'left').length,
  }), [employees])

  const expiring = employees.filter(e => e.status !== 'left' && (e.contracts || []).some(c => c.status === 'active' && c.end && daysBetween(HR_TODAY, c.end) >= 0 && daysBetween(HR_TODAY, c.end) <= 30))

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    const r = employees.filter(e =>
      (status === 'all' || (status === 'current' ? e.status !== 'left' : e.status === status)) &&
      (dept === 'all' || e.dept === dept) && (level === 'all' || e.level === level) &&
      (!t || [e.name, e.code, e.position, e.email, e.phone].join(' ').toLowerCase().includes(t)))
    const key = e => (sort.k === 'dept' ? deptOf(e.dept).name : e[sort.k])
    return r.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * sort.dir)
  }, [employees, q, dept, level, status, sort])

  const opened = openId != null && employees.find(e => e.id === openId)
  if (opened) {
    return <EmployeeDetail emp={opened} employees={employees} concurrent={concurrentOf(opened.id)} boardUnits={boardUnits} onSaveConcurrent={onSaveConcurrent} pay={payOf(opened.id)} onBack={() => onOpen(null)} onEdit={onEdit} onDelete={onDelete} onOffboard={onOffboard} onOpen={onOpen} />
  }

  const th = (k, label, cls = '') => (
    <th className={`sortable ${cls}`} onClick={() => setSort(s => ({ k, dir: s.k === k ? -s.dir : 1 }))}>
      {label}{sort.k === k && <span className="cc-sort">{sort.dir > 0 ? '▲' : '▼'}</span>}
    </th>
  )

  function exportCsv() {
    downloadCsv('ho-so-nhan-su.csv', [
      ['Mã NV', 'Họ tên', 'Giới tính', 'Ngày sinh', 'Phòng ban', 'Chức danh', 'Cấp bậc', 'Trạng thái', 'Ngày vào làm', 'Loại HĐ', 'Điện thoại', 'Email'],
      ...list.map(e => [e.code, e.name, e.gender, fmtDate(e.dob), deptOf(e.dept).name, e.position, e.level, STATUS[e.status].label, fmtDate(e.joinDate), e.contractType, e.phone, e.email]),
    ])
  }

  return (
    <div className="cc-stack">
      <div className="cc-kpis">
        <div className="cc-card cc-kpi2 cc-tone-primary"><span className="cc-ico"><Icon name="users" size={15} /></span><div><span>Đang làm việc</span><b>{counts.current}</b><em>{DEPTS.length} phòng ban</em></div></div>
        <div className="cc-card cc-kpi2 cc-tone-success"><span className="cc-ico"><Icon name="checkCircle" size={15} /></span><div><span>Chính thức</span><b>{counts.active}</b><em>{Math.round(counts.active / Math.max(1, counts.current) * 100)}% nhân sự</em></div></div>
        <div className="cc-card cc-kpi2 cc-tone-finance"><span className="cc-ico"><Icon name="clock" size={15} /></span><div><span>Thử việc</span><b>{counts.probation}</b><em>cần đánh giá chuyển chính thức</em></div></div>
        <div className={`cc-card cc-kpi2 cc-tone-${expiring.length ? 'danger' : 'muted'}`}><span className="cc-ico"><Icon name="file" size={15} /></span><div><span>HĐ sắp hết hạn (30 ngày)</span><b>{expiring.length}</b><em>{expiring.map(e => e.name).join(', ') || 'Không có'}</em></div></div>
      </div>

      <div className="cc-card cc-pad">
        <div className="cc-toolbar">
          <label className="cc-search"><Icon name="search" size={14} /><input placeholder="Tìm tên, mã, chức danh, email..." value={q} onChange={e => setQ(e.target.value)} /></label>
          <select className="cc-select" value={dept} onChange={e => setDept(e.target.value)}>
            <option value="all">Tất cả phòng ban</option>{DEPTS.map(d => <option key={d.key} value={d.key}>{d.name}</option>)}
          </select>
          <select className="cc-select" value={level} onChange={e => setLevel(e.target.value)}>
            <option value="all">Mọi cấp bậc</option>{LEVELS.map(l => <option key={l}>{l}</option>)}
          </select>
          <span className="cc-grow" />
          <div className="cc-seg icon">
            <button className={view === 'table' ? 'active' : ''} title="Dạng bảng" onClick={() => setView('table')}><Icon name="table" size={14} /></button>
            <button className={view === 'grid' ? 'active' : ''} title="Dạng thẻ" onClick={() => setView('grid')}><Icon name="grid" size={14} /></button>
          </div>
          {can('employees', 'export') && <button className="cc-btn ghost" onClick={exportCsv}><Icon name="download" size={14} />Xuất CSV</button>}
          {can('employees', 'create') && <button className="cc-btn" onClick={() => onAdd()}><Icon name="userPlus" size={14} />Thêm nhân viên</button>}
        </div>
        <Seg value={status} onChange={setStatus} options={[
          { value: 'current', label: 'Đang làm việc', count: counts.current },
          { value: 'active', label: 'Chính thức', count: counts.active },
          { value: 'probation', label: 'Thử việc', count: counts.probation },
          { value: 'left', label: 'Đã nghỉ việc', count: counts.left },
          { value: 'all', label: 'Tất cả', count: counts.all },
        ]} />

        {list.length === 0 && <Empty icon="search" text="Không tìm thấy nhân sự phù hợp bộ lọc" />}

        {list.length > 0 && view === 'table' && (
          <div className="cc-table-wrap">
            <table className="cc-table2 hover">
              <thead><tr>{th('name', 'Nhân viên')}{th('position', 'Chức danh')}{th('dept', 'Phòng ban')}{th('status', 'Trạng thái')}{th('joinDate', 'Ngày vào làm')}{th('contractType', 'Hợp đồng')}<th /></tr></thead>
              <tbody>
                {list.map(e => (
                  <tr key={e.id} onClick={() => onOpen(e.id)}>
                    <td><div className="cc-person2"><Avatar emp={e} /><div><b>{e.name}</b><span className="mono">{e.code}</span></div></div></td>
                    <td><div className="cc-cell2"><b>{e.position}</b>{concurrentOf(e.id).length ? <RoleList emp={e} concurrent={concurrentOf(e.id)} compact /> : <span>{e.level}</span>}</div></td>
                    <td><DeptPill dept={e.dept} /></td>
                    <td><StatusPill status={e.status} /></td>
                    <td>{fmtDate(e.joinDate)}</td>
                    <td className="cc-muted">{e.contractType}</td>
                    <td className="r" onClick={ev => ev.stopPropagation()}>
                      <div className="cc-row-actions">
                        {can('employees', 'edit') && <button className="cc-icon-btn sm" title="Sửa" onClick={() => onEdit(e)}><Icon name="edit" size={14} /></button>}
                        {can('employees', 'delete') && <button className="cc-icon-btn sm danger" title="Xoá" onClick={() => onDelete(e)}><Icon name="trash" size={14} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {list.length > 0 && view === 'grid' && (
          <div className="cc-emp-cards">
            {list.map(e => (
              <button key={e.id} className="cc-emp-card2" onClick={() => onOpen(e.id)}>
                <div className="cc-emp-card-top"><Avatar emp={e} size={44} /><StatusPill status={e.status} /></div>
                <b>{e.name}</b>
                <span className="cc-muted">{e.position}</span>
                {concurrentOf(e.id).length > 0 && <RoleList emp={e} concurrent={concurrentOf(e.id)} compact />}
                <div className="cc-emp-card-foot"><DeptPill dept={e.dept} /><span className="mono cc-muted">{e.code}</span></div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
