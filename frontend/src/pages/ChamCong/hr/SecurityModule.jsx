import { useEffect, useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { deptOf } from '../../../data/hrData'
import { ROLES, PERM_MODULES, PERM_ACTIONS, AUDIT_ACTION_LABEL } from '../../../data/hrData2'
import { Avatar, Pill, Seg, Empty, downloadCsv } from './shared'
import { useAccess, NoAccess } from './access'
import * as hrApi from '../api'

const MODULE_LABEL = { ...Object.fromEntries(PERM_MODULES.map(m => [m.key, m.label])), auth: 'Đăng nhập' }
const fmtAt = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }) }

/* Phân hệ "Phân quyền & bảo mật" - dữ liệu thật (GET /hr/security):
   ma trận quyền theo vai trò, gắn tài khoản đăng nhập với hồ sơ + vai trò HR, ẩn lương mặc định, nhật ký HR (audit_logs).
   Quyền và phạm vi được kiểm ở máy chủ; admin công ty luôn là System Admin. onReloadHr: tải lại hồ sơ sau khi đổi vai trò / tài khoản. */
export default function SecurityModule({ employees, toast, onReloadHr }) {
  const { can } = useAccess()
  const [tab, setTab] = useState('roles')
  const [selRole, setSelRole] = useState('manager')
  const [q, setQ] = useState('')
  const [fModule, setFModule] = useState('all')
  const [fAction, setFAction] = useState('all')
  const [fUser, setFUser] = useState('')
  const [sec, setSec] = useState(null)
  const allowed = can('security', 'view')

  const reload = () => hrApi.loadSecurity().then(setSec, e => toast(e.message || 'Lỗi tải phân quyền', 'danger'))
  useEffect(() => { if (allowed) reload() }, [allowed]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!allowed) return <NoAccess text="Chỉ System Admin / HR Admin được truy cập phân quyền & nhật ký." />
  if (!sec) return <div className="cc-card cc-noaccess"><b>Đang tải phân quyền…</b></div>
  const editable = can('security', 'edit')
  const perms = sec.perms
  const save = (promise, msg) => promise.then(() => reload()).then(() => msg && toast(msg), e => toast(e.message || 'Lỗi lưu dữ liệu', 'danger'))

  function togglePerm(role, mod, act) {
    if (!editable || role === 'sysadmin') return
    const cur = perms[role]?.[mod] || []
    const has = cur.includes(act)
    let next = has ? cur.filter(a => a !== act) : [...cur, act]
    if (!has && act !== 'view' && !next.includes('view')) next = ['view', ...next] // có quyền thao tác thì phải xem được
    if (has && act === 'view') next = []
    save(hrApi.saveSecurity({ perms: { ...perms, [role]: { ...perms[role], [mod]: next } } }),
      `${has ? 'Thu hồi' : 'Cấp'} quyền "${PERM_ACTIONS.find(a => a.key === act).label}" ${MODULE_LABEL[mod]} — ${ROLES[role].label}`)
  }
  function setUser(emp, patch, msg) {
    save(hrApi.setUserRole({ empId: emp.id, ...patch }), msg).then(onReloadHr)
  }

  const t = q.trim().toLowerCase()
  const users = employees.filter(e => e.status !== 'left' && (!t || e.name.toLowerCase().includes(t)))
  const roleCount = r => employees.filter(e => e.status !== 'left' && e.userId && (e.hrRole || 'employee') === r).length
  const linkedTo = uid => employees.find(e => e.userId === uid)
  const audit = sec.audit.map(a => { const [, module, action] = String(a.action).split('.'); return { ...a, module, act: action } })
  const logs = audit.filter(a => (fModule === 'all' || a.module === fModule) && (fAction === 'all' || a.act === fAction) &&
    (!fUser.trim() || `${a.user} ${a.detail}`.toLowerCase().includes(fUser.trim().toLowerCase())))

  return (
    <div className="cc-stack">
      <div className="cc-toolbar" style={{ marginBottom: 0 }}>
        <Seg value={tab} onChange={setTab} options={[
          { value: 'roles', label: 'Vai trò & quyền', icon: 'shield' }, { value: 'users', label: 'Tài khoản & vai trò', icon: 'users' },
          { value: 'settings', label: 'Cài đặt bảo mật', icon: 'lock' }, { value: 'audit', label: 'Nhật ký thao tác', icon: 'file', count: audit.length },
        ]} />
        {!editable && <Pill tone="finance" dot>Chế độ chỉ xem</Pill>}
      </div>

      {tab === 'roles' && (
        <div className="cc-sec-roles">
          <div className="cc-stack" style={{ gap: 8 }}>
            {Object.entries(ROLES).map(([k, r]) => (
              <button key={k} className={`cc-role-card cc-tone-${r.tone}${selRole === k ? ' active' : ''}`} onClick={() => setSelRole(k)}>
                <span className="cc-ico"><Icon name="shield" size={15} /></span>
                <div className="cc-grow"><b>{r.label}</b><span>{r.desc}</span></div>
                <span className="cc-chip-sm">{roleCount(k)} người</span>
              </button>
            ))}
          </div>
          <div className="cc-card cc-pad">
            <div className="cc-toolbar"><div><h3 className="cc-h3" style={{ margin: 0 }}>Quyền của {ROLES[selRole].label}</h3>
              <span className="cc-sub">Phạm vi dữ liệu: {ROLES[selRole].scope === 'all' ? 'toàn công ty' : ROLES[selRole].scope === 'dept' ? 'phòng ban của mình' : 'chỉ bản thân'}</span></div></div>
            <div className="cc-table-wrap">
              <table className="cc-table2 cc-matrix">
                <thead><tr><th>Phân hệ</th>{PERM_ACTIONS.map(a => <th key={a.key} className="c">{a.label}</th>)}</tr></thead>
                <tbody>
                  {PERM_MODULES.map(m => (
                    <tr key={m.key}>
                      <td><b>{m.label}</b></td>
                      {PERM_ACTIONS.map(a => {
                        const on = selRole === 'sysadmin' || (perms[selRole]?.[m.key] || []).includes(a.key)
                        return <td key={a.key} className="c"><button className={`cc-perm${on ? ' on' : ''}`} disabled={!editable || selRole === 'sysadmin'} onClick={() => togglePerm(selRole, m.key, a.key)} aria-pressed={on} aria-label={`${a.label} ${m.label}`}>{on && <Icon name="check" size={12} stroke={3} />}</button></td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="cc-sub" style={{ marginTop: 10 }}>Máy chủ kiểm quyền và lọc dữ liệu theo phạm vi ở mỗi thao tác. System Admin (và admin công ty) luôn có toàn quyền.</div>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="cc-card cc-pad">
          <div className="cc-toolbar">
            <label className="cc-search"><Icon name="search" size={14} /><input placeholder="Tìm nhân sự..." value={q} onChange={e => setQ(e.target.value)} /></label>
            <span className="cc-sub">Gắn tài khoản đăng nhập với hồ sơ để người đó vào HR theo vai trò. Tài khoản chưa gắn (trừ admin công ty) không vào được HR.</span>
          </div>
          <div className="cc-table-wrap">
            <table className="cc-table2">
              <thead><tr><th>Nhân sự</th><th>Phòng ban</th><th>Tài khoản đăng nhập</th><th>Vai trò HR</th></tr></thead>
              <tbody>
                {users.map(e => {
                  const role = e.hrRole || 'employee'
                  return (
                    <tr key={e.id}>
                      <td><div className="cc-person2"><Avatar emp={e} size={28} /><div><b>{e.name}</b><span>{e.code}</span></div></div></td>
                      <td>{deptOf(e.dept).name}</td>
                      <td><select className="cc-select" disabled={!editable} value={e.userId || ''}
                        onChange={ev => setUser(e, { userId: ev.target.value }, ev.target.value ? `Đã gắn tài khoản cho ${e.name}` : `Đã bỏ gắn tài khoản của ${e.name}`)}>
                        <option value="">— Chưa gắn —</option>
                        {sec.accounts.filter(u => u.active && (!linkedTo(u.id) || u.id === e.userId)).map(u => <option key={u.id} value={u.id}>{u.username}{u.name ? ' · ' + u.name : ''}{u.role === 'admin' ? ' (admin công ty)' : ''}</option>)}
                      </select></td>
                      <td><select className={`cc-select cc-role-select cc-tone-${ROLES[role].tone}`} disabled={!editable} value={role}
                        onChange={ev => setUser(e, { role: ev.target.value }, `Đổi vai trò ${e.name} → ${ROLES[ev.target.value].label}`)}>
                        {Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
                      </select></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="cc-grid2">
          <div className="cc-card cc-pad">
            <h3 className="cc-h3">Hiển thị dữ liệu nhạy cảm</h3>
            <label className={`cc-switch-row${editable ? '' : ' disabled'}`}>
              <span>Ẩn số tiền lương mặc định (bấm để hiện)</span>
              <button type="button" role="switch" aria-checked={sec.maskSalary} className={`cc-switch${sec.maskSalary ? ' on' : ''}`} disabled={!editable}
                onClick={() => save(hrApi.saveSecurity({ maskSalary: !sec.maskSalary }), sec.maskSalary ? 'Đã tắt ẩn lương mặc định' : 'Đã bật ẩn lương mặc định').then(onReloadHr)}><i /></button>
            </label>
          </div>
          <div className="cc-card cc-pad">
            <h3 className="cc-h3">Đang áp dụng</h3>
            <ul className="cc-arch">
              <li><b>Phân quyền</b><span>Vai trò → quyền theo phân hệ, kiểm ở máy chủ; dữ liệu lọc theo phạm vi (toàn công ty / phòng ban / bản thân)</span></li>
              <li><b>Đăng nhập</b><span>Dùng chung tài khoản Dezon Pro; hạn phiên theo cấu hình máy chủ (TOKEN_TTL_DAYS)</span></li>
              <li><b>Nhật ký</b><span>Mọi thao tác ghi HR lưu vào nhật ký hệ thống (audit_logs)</span></li>
              <li><b>Chưa hỗ trợ</b><span>2FA, đăng nhập Google (SSO), giới hạn IP, tự đăng xuất theo thời gian không hoạt động</span></li>
            </ul>
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="cc-card cc-pad">
          <div className="cc-toolbar">
            <label className="cc-search"><Icon name="search" size={14} /><input placeholder="Tìm người dùng / nội dung..." value={fUser} onChange={e => setFUser(e.target.value)} /></label>
            <select className="cc-select" value={fModule} onChange={e => setFModule(e.target.value)}><option value="all">Mọi phân hệ</option>{Object.entries(MODULE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <select className="cc-select" value={fAction} onChange={e => setFAction(e.target.value)}><option value="all">Mọi thao tác</option>{Object.entries(AUDIT_ACTION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <span className="cc-grow" />
            {can('security', 'export') && <button className="cc-btn ghost" onClick={() => downloadCsv('nhat-ky-hr.csv', [['Thời gian', 'Tài khoản', 'Phân hệ', 'Thao tác', 'Nội dung'], ...logs.map(a => [fmtAt(a.at), a.user, MODULE_LABEL[a.module] || a.module, AUDIT_ACTION_LABEL[a.act] || a.act, a.detail])])}><Icon name="download" size={14} />Xuất CSV</button>}
          </div>
          {logs.length === 0 ? <Empty icon="file" text="Không có nhật ký phù hợp" /> : (
            <div className="cc-table-wrap">
              <table className="cc-table2">
                <thead><tr><th>Thời gian</th><th>Tài khoản</th><th>Phân hệ</th><th>Thao tác</th><th>Nội dung</th></tr></thead>
                <tbody>
                  {logs.map(a => (
                    <tr key={a.id}>
                      <td className="mono cc-muted" style={{ whiteSpace: 'nowrap' }}>{fmtAt(a.at)}</td>
                      <td><b>{a.user}</b></td>
                      <td>{MODULE_LABEL[a.module] || a.module}</td>
                      <td><Pill tone={a.act === 'delete' || a.act === 'reject' ? 'danger' : a.act === 'approve' ? 'success' : a.act === 'export' ? 'qs' : a.act === 'role' ? 'finance' : 'primary'}>{AUDIT_ACTION_LABEL[a.act] || a.act}</Pill></td>
                      <td>{a.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
