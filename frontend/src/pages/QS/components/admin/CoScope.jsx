import { useState } from 'react'
import QsIcon from '../common/QsIcon'
import { mediaUrl } from '../../api/files'
import { ROLE_LBL } from './adminUtil'

function CoLogo({ co }) {
  const [bad, setBad] = useState(false)
  const ini = String((co && (co.ten || co.ma)) || '?').trim().charAt(0).toUpperCase()
  return co && co.logoUrl && !bad
    ? <img className="qsa-cs-lg" src={mediaUrl(co.logoUrl)} alt="" onError={() => setBad(true)} />
    : <span className="qsa-cs-ini">{ini}</span>
}

/* Mục Yêu cầu / Nhật ký của quản trị hệ thống: chọn công ty trước (thẻ công ty + số tài khoản) */
export function CoPicker({ cts, users, kind, cnt, logCap, onPick }) {
  const n = id => users.filter(u => u.role !== 'super' && String(u.congTyId) === String(id)).length
  const what = kind === 'nhatky' ? 'nhật ký hoạt động' : 'yêu cầu'
  // Số yêu cầu (chờ duyệt / tổng) hoặc số mục nhật ký của từng công ty; đang tải = "…"
  const stat = id => {
    const v = cnt[String(id)]
    if (!v) return <span className="qsa-cs-stat wait">…</span>
    if (v.err) return <span className="qsa-cs-stat" title="Không tải được">—</span>
    if (kind === 'nhatky') return <span className="qsa-cs-stat" title="Số mục nhật ký hoạt động"><b>{v.logs >= logCap ? logCap + '+' : v.logs}</b> hoạt động</span>
    return (
      <span className="qsa-cs-stat" title={v.pend + ' chờ duyệt / ' + v.total + ' yêu cầu'}>
        {v.pend ? <span className="qsa-cs-pend">{v.pend} chờ duyệt</span> : null}<b>{v.total}</b> yêu cầu
      </span>
    )
  }
  return (
    <div className="qsa-cs-pick">
      <p className="qsa-cs-hint"><QsIcon name="building" size={14} /> Chọn công ty để xem {what} của nhân viên công ty đó.</p>
      <div className="qsa-cs-grid">
        {cts.map(c => (
          <button key={c.id} type="button" className={`qsa-cs-card${c.active === false ? ' off' : ''}`} onClick={() => onPick(String(c.id))}>
            <CoLogo co={c} />
            <span className="qsa-cs-t"><b>{c.ten || c.ma}</b><i>{c.ma} · {n(c.id)} tài khoản</i></span>
            {stat(c.id)}
            <svg className="qsa-cs-go" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        ))}
      </div>
      {!cts.length ? <div className="qsa-empty">Chưa có công ty nào.</div> : null}
    </div>
  )
}

/* Đầu mục khi đã chọn công ty: tên công ty (+ nút về danh sách công ty) và dải nhân viên để lọc theo người */
export function CoScope({ co, users, sel, onSel, onBack }) {
  return (
    <div className="qsa-cs-scope">
      <div className="qsa-cs-hd">
        {onBack ? <button type="button" className="qsa-btn ghost sm" onClick={onBack}><QsIcon name="left" size={13} /> Tất cả công ty</button> : null}
        <CoLogo co={co} />
        <b className="qsa-cs-name">{(co && (co.ten || co.ma)) || 'Công ty'}</b>
        <span className="qsa-cs-cnt">{users.length} tài khoản</span>
      </div>
      <div className="qsa-cs-users" role="group" aria-label="Lọc theo nhân viên">
        <button type="button" className={`qsa-cs-u${!sel ? ' on' : ''}`} aria-pressed={!sel} onClick={() => onSel('')}>Tất cả nhân viên</button>
        {users.map(u => {
          const av = (u.hoTen || u.username || '?').trim().charAt(0).toUpperCase()
          return (
            <button key={u.id} type="button" aria-pressed={sel === String(u.id)} className={`qsa-cs-u${sel === String(u.id) ? ' on' : ''}`} title={(ROLE_LBL[u.role] || u.role) + ' · @' + u.username}
              onClick={() => onSel(sel === String(u.id) ? '' : String(u.id))}>
              <span className={`qsa-cs-av${u.role !== 'staff' ? ' adm' : ''}`}>{av}</span>{u.hoTen || u.username}
            </button>
          )
        })}
      </div>
    </div>
  )
}
