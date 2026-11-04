import { useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { deptOf } from '../../../data/hrData'
import { ROLES, PERM_MODULES, PERM_ACTIONS, BRANCHES, SESSION_OPTIONS, AUDIT_ACTION_LABEL } from '../../../data/hrData2'
import { Avatar, Pill, Seg, Empty, downloadCsv } from './shared'
import { useAccess, NoAccess } from './access'

const MODULE_LABEL = { ...Object.fromEntries(PERM_MODULES.map(m => [m.key, m.label])), auth: 'Đăng nhập' }

/* Phân hệ "Phân quyền & bảo mật": vai trò, quyền theo phân hệ, phạm vi dữ liệu, cài đặt, nhật ký thao tác */
export default function SecurityModule({ employees, security, setSecurity, audit, toast }) {
  const { can, log } = useAccess()
  const [tab, setTab] = useState('roles')
  const [selRole, setSelRole] = useState('manager')
  const [q, setQ] = useState('')
  const [fModule, setFModule] = useState('all')
  const [fAction, setFAction] = useState('all')
  const [fUser, setFUser] = useState('')

  if (!can('security', 'view')) return <NoAccess text="Chỉ System Admin / HR Admin được truy cập phân quyền & nhật ký hệ thống." />
  const editable = can('security', 'edit')
  const { perms, userRoles, settings, session } = security
  const set = patch => setSecurity(s => ({ ...s, ...patch }))

  function togglePerm(role, mod, act) {
    if (!editable) return
    if (role === 'sysadmin') { toast('Không thể thu hồi quyền của System Admin', 'danger'); return }
    const cur = perms[role][mod] || []
    const has = cur.includes(act)
    let next = has ? cur.filter(a => a !== act) : [...cur, act]
    if (!has && act !== 'view' && !next.includes('view')) next = ['view', ...next] // có quyền thao tác thì phải xem được
    if (has && act === 'view') next = []
    set({ perms: { ...perms, [role]: { ...perms[role], [mod]: next } } })
    log('security', 'edit', `${has ? 'Thu hồi' : 'Cấp'} quyền "${PERM_ACTIONS.find(a => a.key === act).label}" ${MODULE_LABEL[mod]} — ${ROLES[role].label}`)
  }
  function setUserRole(empId, patch) {
    const emp = employees.find(e => e.id === empId)
    const cur = userRoles[empId] || { role: 'employee', branches: [] }
    set({ userRoles: { ...userRoles, [empId]: { ...cur, ...patch } } })
    if (patch.role) log('security', 'role', `Đổi vai trò ${emp.name} → ${ROLES[patch.role].label}`)
  }
  function toggleSetting(k) {
    if (!editable) return
    set({ settings: { ...settings, [k]: { ...settings[k], value: !settings[k].value } } })
    log('security', 'edit', `${settings[k].value ? 'Tắt' : 'Bật'}: ${settings[k].label}`)
  }

  const t = q.trim().toLowerCase()
  const users = employees.filter(e => e.status !== 'left' && (!t || e.name.toLowerCase().includes(t)))
  const roleCount = r => employees.filter(e => e.status !== 'left' && (userRoles[e.id]?.role || 'employee') === r).length
  const logs = audit.filter(a => (fModule === 'all' || a.module === fModule) && (fAction === 'all' || a.action === fAction) && (!fUser.trim() || (a.user + ' ' + a.target).toLowerCase().includes(fUser.trim().toLowerCase())))

  return (
    <div className="cc-stack">
      <div className="cc-toolbar" style={{ marginBottom: 0 }}>
        <Seg value={tab} onChange={setTab} options={[
          { value: 'roles', label: 'Vai trò & quyền', icon: 'shield' }, { value: 'users', label: 'Người dùng & phạm vi', icon: 'users' },
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
                        const on = (perms[selRole][m.key] || []).includes(a.key)
                        return <td key={a.key} className="c"><button className={`cc-perm${on ? ' on' : ''}`} disabled={!editable || selRole === 'sysadmin'} onClick={() => togglePerm(selRole, m.key, a.key)} aria-pressed={on} aria-label={`${a.label} ${m.label}`}>{on && <Icon name="check" size={12} stroke={3} />}</button></td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="cc-sub" style={{ marginTop: 10 }}>Thay đổi có hiệu lực ngay — thử đổi vai trò ở góc trên bên phải để xem giao diện theo từng vai trò.</div>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="cc-card cc-pad">
          <div className="cc-toolbar">
            <label className="cc-search"><Icon name="search" size={14} /><input placeholder="Tìm người dùng..." value={q} onChange={e => setQ(e.target.value)} /></label>
            <span className="cc-sub">Phân quyền dữ liệu: Trưởng phòng mặc định thấy phòng ban mình, có thể mở rộng theo chi nhánh</span>
          </div>
          <div className="cc-table-wrap">
            <table className="cc-table2">
              <thead><tr><th>Người dùng</th><th>Phòng ban</th><th>Vai trò</th><th>Chi nhánh được truy cập thêm</th><th>2FA</th></tr></thead>
              <tbody>
                {users.map(e => {
                  const ur = userRoles[e.id] || { role: 'employee', branches: [] }
                  const needs2fa = settings.require2faAll.value || (settings.require2fa.value && ['sysadmin', 'hradmin'].includes(ur.role))
                  return (
                    <tr key={e.id}>
                      <td><div className="cc-person2"><Avatar emp={e} size={28} /><div><b>{e.name}</b><span>{e.email}</span></div></div></td>
                      <td>{deptOf(e.dept).name}</td>
                      <td><select className={`cc-select cc-role-select cc-tone-${ROLES[ur.role].tone}`} disabled={!editable} value={ur.role} onChange={ev => setUserRole(e.id, { role: ev.target.value })}>{Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</select></td>
                      <td>
                        <div className="cc-checks">{BRANCHES.map(b => (
                          <label key={b} className={ur.role === 'manager' ? '' : 'disabled'}><input type="checkbox" disabled={!editable || ur.role !== 'manager'} checked={ur.branches?.includes(b) || false}
                            onChange={ev => setUserRole(e.id, { branches: ev.target.checked ? [...(ur.branches || []), b] : ur.branches.filter(x => x !== b) })} />{b}</label>
                        ))}</div>
                      </td>
                      <td>{needs2fa ? <Pill tone={e.id % 3 ? 'success' : 'danger'} dot>{e.id % 3 ? 'Đã bật' : 'Chưa kích hoạt'}</Pill> : <span className="cc-muted">Tuỳ chọn</span>}</td>
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
            <h3 className="cc-h3">Xác thực & truy cập</h3>
            {Object.entries(settings).map(([k, s]) => (
              <label key={k} className={`cc-switch-row${editable ? '' : ' disabled'}`}>
                <span>{s.label}</span>
                <button type="button" role="switch" aria-checked={s.value} className={`cc-switch${s.value ? ' on' : ''}`} onClick={() => toggleSetting(k)} disabled={!editable}><i /></button>
              </label>
            ))}
            <div className="cc-kv"><span>Tự đăng xuất khi không hoạt động</span>
              <select className="cc-select" disabled={!editable} value={session} onChange={e => { set({ session: e.target.value }); log('security', 'edit', `Thời gian phiên: ${e.target.value}`) }}>{SESSION_OPTIONS.map(o => <option key={o}>{o}</option>)}</select>
            </div>
          </div>
          <div className="cc-card cc-pad">
            <h3 className="cc-h3">Kiến trúc bảo mật đề xuất (khi có backend)</h3>
            <ul className="cc-arch">
              <li><b>Xác thực</b><span>JWT access token 15 phút + refresh token xoay vòng (httpOnly cookie), OAuth2 Google, 2FA TOTP</span></li>
              <li><b>Phân quyền</b><span>RBAC (vai trò → quyền) kiểm tra ở API guard; phạm vi dữ liệu lọc ở tầng truy vấn theo phòng ban / chi nhánh</span></li>
              <li><b>Dữ liệu nhạy cảm</b><span>Mã hoá lương, CCCD, tài khoản ngân hàng (AES-256) trong PostgreSQL; ẩn mặc định trên giao diện</span></li>
              <li><b>Nhật ký</b><span>Audit log ghi bất biến (append-only) mọi thao tác tạo/sửa/xoá/xuất/duyệt kèm IP & user-agent</span></li>
              <li><b>Tác vụ nền</b><span>Redis + BullMQ: gửi email phiếu lương, xuất PDF, đồng bộ máy chấm công</span></li>
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
            {can('security', 'export') && <button className="cc-btn ghost" onClick={() => downloadCsv('nhat-ky-thao-tac.csv', [['Thời gian', 'Người dùng', 'Vai trò', 'Phân hệ', 'Thao tác', 'Nội dung', 'IP'], ...logs.map(a => [a.time, a.user, ROLES[a.role]?.label, MODULE_LABEL[a.module], AUDIT_ACTION_LABEL[a.action], a.target, a.ip])])}><Icon name="download" size={14} />Xuất CSV</button>}
          </div>
          {logs.length === 0 ? <Empty icon="file" text="Không có nhật ký phù hợp" /> : (
            <div className="cc-table-wrap">
              <table className="cc-table2">
                <thead><tr><th>Thời gian</th><th>Người dùng</th><th>Phân hệ</th><th>Thao tác</th><th>Nội dung</th><th>IP</th></tr></thead>
                <tbody>
                  {logs.map(a => (
                    <tr key={a.id} className={a.warn ? 'cc-row-warn' : ''}>
                      <td className="mono cc-muted" style={{ whiteSpace: 'nowrap' }}>{a.time}</td>
                      <td><div className="cc-cell2"><b>{a.user}</b><span>{ROLES[a.role]?.label}</span></div></td>
                      <td>{MODULE_LABEL[a.module]}</td>
                      <td><Pill tone={a.warn ? 'danger' : a.action === 'delete' ? 'danger' : a.action === 'approve' ? 'success' : a.action === 'export' ? 'qs' : a.action === 'role' ? 'finance' : 'primary'}>{AUDIT_ACTION_LABEL[a.action]}</Pill></td>
                      <td>{a.target}</td>
                      <td className="mono cc-muted">{a.ip}</td>
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
