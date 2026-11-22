import { useEffect, useState } from 'react'
import * as api from '../../api/qsApi'
import QsIcon from '../common/QsIcon'
import AdmDlg from './AdmDlg'
import '../congty/congty.css'
import { PERM_TABS, WORK_TABS, PAGE_TABS } from '../../state/store'
import { ROLE_LBL, fmtDateTime_ } from './adminUtil'
import { expandGrants, countModules } from './accessUtil'
import { loadAccessCatalog } from '../../../../services/accessService'

/* Quyền con ngoài các nhóm trang (UserModal.jsx SUB_KEYS) */
export const SUB_LBL = { sp_edit: 'SP: chỉ được sửa (chờ duyệt)', sp_duyet: 'SP: được sửa và duyệt', da_duyet: 'Duyệt sửa thông tin dự án' }
const GROUPS = [['Trang QS Pro', PERM_TABS], ['Nghiệp vụ', WORK_TABS], ['Trang khác', PAGE_TABS]]

/* Hộp chi tiết 1 tài khoản (bấm vào dòng ở bảng Tài khoản): thông tin + toàn bộ quyền theo nhóm + thao tác.
   Props: u, approved (admin được giao duyệt sản phẩm, M14.6), ctName (tên công ty hoặc ''), apt ({unit, position, head} | null), aptKnown (có dữ liệu bổ nhiệm HR của tài khoản này), canAppoint, các hàm thao tác như UsersCard. */
export default function UserDetail({ u, approved, ctName, apt, aptKnown, canAppoint, readOnly, onClose, onEdit, onAppoint, onResetPw, onToggle, onDelete }) {
  const full = u.role === 'admin' || u.role === 'super'
  const p = u.perms || []
  const av = (u.hoTen || u.username || '?').trim().charAt(0).toUpperCase()
  const known = {}
  GROUPS.forEach(g => g[1].forEach(t => { known[t[0]] = 1 }))
  const extra = p.filter(k => !known[k])
  const act = fn => () => { onClose(); fn() }
  // Quyền thực Phân hệ > Tab > Thao tác (N21, GET /api/v1/users/:id/access); chưa tải được -> hiện kiểu cũ theo khoá trang
  const [acc, setAcc] = useState(null)
  useEffect(() => {
    if (u.role === 'super') return undefined
    const ctl = new AbortController()
    Promise.all([loadAccessCatalog(), api.getUserAccess(u.id, ctl.signal)])
      .then(([cat, r]) => setAcc({ cat, eff: expandGrants(r && r.effective, cat), custom: !!(r && r.grants) }), () => {})
    return () => ctl.abort()
  }, [u.id, u.role])
  const accMods = acc ? acc.cat.modules.filter(m => acc.eff[m.key]) : []
  const accNone = acc ? acc.cat.modules.filter(m => !acc.eff[m.key]) : []
  const actLbl = {}
  if (acc) acc.cat.actions.forEach(a => { actLbl[a.key] = a.label })
  return (
    <AdmDlg icon="lock" title="Chi tiết tài khoản" wide className="qsco-dlg qsa-ud-dlg" onClose={onClose}>
      <div className="qsco-wz">
        <aside className="qsco-wz-side">
          <div className="qsa-ud-hd">
            <span className={`qsa-ud-av${u.role !== 'staff' ? ' adm' : ''}`}>{av}</span>
            <div className="qsa-ud-t">
              <b>{u.hoTen || u.username}</b>
              <span>@{u.username}</span>
            </div>
          </div>
          <span className={`qsa-role ${u.role === 'super' ? 'sup' : (u.role === 'admin' ? 'adm' : 'stf')}`} style={{ alignSelf: 'flex-start' }}>{ROLE_LBL[u.role] || u.role}</span>
          {approved ? <span className="qsa-apr" style={{ alignSelf: 'flex-start', marginLeft: 0 }} title="Được quản trị hệ thống giao quyền duyệt sản phẩm">Duyệt SP</span> : null}
          <div className="qsa-ud-info">
            <div><i>Email</i><b title={u.email || ''}>{u.email || '—'}</b></div>
            <div><i>Công ty</i><b>{ctName || '—'}</b></div>
            {u.role === 'admin' ? <div><i>Duyệt sản phẩm</i>{approved ? <span className="qsa-st-ok">Được giao</span> : <span className="qsa-muted">Chưa giao</span>}</div> : null}
            <div><i>Trạng thái</i>{u.active ? <span className="qsa-st-ok">● Hoạt động</span> : <span className="qsa-st-lk">● Đã khóa</span>}</div>
            {aptKnown ? <div><i>Bổ nhiệm</i><b>{apt ? <>{apt.unit || '—'}{apt.position ? ' · ' + apt.position : ''}{apt.head ? ' (Trưởng)' : ''}</> : <span className="qsa-muted">Chưa bổ nhiệm</span>}</b></div> : null}
            <div><i>Đăng nhập gần nhất</i><b>{u.lastLogin ? fmtDateTime_(u.lastLogin) : '—'}</b></div>
            <div><i>Ngày tạo</i><b>{u.createdAt ? fmtDateTime_(u.createdAt) : '—'}</b></div>
          </div>
        </aside>

        <section className="qsco-wz-main">
          {acc ? (
            <>
              <div className="qsco-sec-h"><h4>Quyền truy cập <span className="qsa-ud-cnt">{countModules(acc.eff)} / {acc.cat.modules.length} phân hệ</span>
                <span className="qsa-ud-mode">{acc.custom ? 'Tuỳ chỉnh' : 'Theo mặc định cũ'}</span></h4>
                <p>{u.role === 'admin' ? 'Quản trị công ty: quyền trong trần của công ty' + (acc.custom ? ', đã giới hạn riêng.' : '.')
                  : 'Quyền thực = trần công ty ∩ quyền được cấp. Tab chỉ ghi tên = đủ mọi thao tác.'}</p></div>
              {accMods.map(m => (
                <div key={m.key} className="qsa-ud-grp">
                  <span className="qsa-ud-gt">{m.label}</span>
                  <div className="qsa-ud-chips">
                    {m.tabs.filter(t => acc.eff[m.key][t.key]).map(t => {
                      const a = acc.eff[m.key][t.key]
                      const all = a.length === t.actions.length
                      return <span key={t.key} className="qsa-ud-chip on" title={a.map(x => actLbl[x] || x).join(', ')}>
                        <QsIcon name="check" size={10} />{t.label}{all ? null : <i>· {a.map(x => actLbl[x] || x).join(', ')}</i>}</span>
                    })}
                  </div>
                </div>
              ))}
              {accNone.length ? (
                <div className="qsa-ud-grp">
                  <span className="qsa-ud-gt">Chưa có quyền</span>
                  <div className="qsa-ud-chips">{accNone.map(m => <span key={m.key} className="qsa-ud-chip">{m.label}</span>)}</div>
                </div>
              ) : null}
            </>
          ) : (
          <div className="qsco-sec-h"><h4>Quyền truy cập {full ? <span className="qsa-ud-cnt">Toàn quyền</span> : <span className="qsa-ud-cnt">{p.length} quyền</span>}</h4>
            <p>{full ? (ROLE_LBL[u.role] || u.role) + ' dùng được mọi trang và tính năng của công ty.' : 'Quyền đã cấp có dấu ✓; quyền chưa cấp hiện mờ.'}</p></div>
          )}
          {full || acc ? null : GROUPS.map(g => (
            <div key={g[0]} className="qsa-ud-grp">
              <span className="qsa-ud-gt">{g[0]}</span>
              <div className="qsa-ud-chips">
                {g[1].map(t => {
                  const on = p.indexOf(t[0]) >= 0
                  return <span key={t[0]} className={`qsa-ud-chip${on ? ' on' : ''}`}>{on ? <QsIcon name="check" size={10} /> : null}{t[1]}</span>
                })}
              </div>
            </div>
          ))}
          {!full && extra.length ? (
            <div className="qsa-ud-grp">
              <span className="qsa-ud-gt">Quyền đặc biệt</span>
              <div className="qsa-ud-chips">{extra.map(k => <span key={k} className="qsa-ud-chip on"><QsIcon name="check" size={10} />{SUB_LBL[k] || k}</span>)}</div>
            </div>
          ) : null}
        </section>
      </div>

      {readOnly ? (
        <div className="qsco-f-btn"><span className="qsa-muted qsa-ro"><QsIcon name="lock" size={13} /> Tài khoản quản trị công ty — chỉ quản trị hệ thống sửa được</span>
          <span className="qsco-f-sp" /><button type="button" className="qsa-btn ghost sm" onClick={onClose}>Đóng</button></div>
      ) : (
      <div className="qsco-f-btn">
        <button type="button" className="qsa-btn ghost sm danger" onClick={act(() => onDelete(u))}><QsIcon name="trash" size={13} /> Xóa</button>
        <span className="qsco-f-sp" />
        <button type="button" className="qsa-btn ghost sm" onClick={act(() => onToggle(u.id, !u.active))}>{u.active ? 'Khóa' : 'Mở khóa'}</button>
        <button type="button" className="qsa-btn ghost sm" onClick={act(() => onResetPw(u.id))}>Đặt MK</button>
        {canAppoint ? <button type="button" className="qsa-btn ghost sm" onClick={act(() => onAppoint(u))}>Bổ nhiệm</button> : null}
        <button type="button" className="qsa-btn blue" onClick={act(() => onEdit(u))}><QsIcon name="edit" size={14} /> Sửa</button>
      </div>
      )}
    </AdmDlg>
  )
}
