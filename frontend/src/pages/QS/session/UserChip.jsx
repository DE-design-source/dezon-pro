import { useEffect, useRef, useState } from 'react'
import { useQsSession } from './QsSession'
import { qsAsk, qsToast } from '../components/common/dialogs'

const ROLE_LBL = { super: 'Quản trị hệ thống', admin: 'Quản trị công ty', subadmin: 'Admin', staff: 'Nhân viên' }

/* Nút tài khoản trên thanh trên + menu Đổi mật khẩu / Đăng xuất — port #userChip (PUB/index.html:6597-6604),
   applyRoleUI_ (app.js:2516-2526), openChangePw (app.js:2602-2610), authLogout_ (app.js:8-11). */
export default function UserChip() {
  const { me, congTy, logout, changePassword } = useQsSession()
  const [open, setOpen] = useState(false)
  const box = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const out = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', out)
    return () => document.removeEventListener('mousedown', out)
  }, [open])

  if (!me) return null
  const nm = me.hoTen || me.username || ''
  const cty = (congTy && congTy.ten) || (me.role === 'super' ? 'Toàn hệ thống' : '')

  async function openChangePw() {
    setOpen(false)
    const r = await qsAsk({
      title: 'Đổi mật khẩu', confirmText: 'Đổi mật khẩu', fields: [
        { key: 'old', label: 'Mật khẩu hiện tại', type: 'password' },
        { key: 'np', label: 'Mật khẩu mới (≥4 ký tự)', type: 'password' },
      ],
    })
    if (!r) return
    if (String(r.np).length < 4) { qsToast('Mật khẩu mới phải từ 4 ký tự'); return }
    changePassword(r.old, r.np).then(() => qsToast('Đã đổi mật khẩu'), e => qsToast('Lỗi: ' + e.message))
  }

  return (
    <div className="qs-uc" ref={box} onClick={() => setOpen(o => !o)} title={nm}>
      <span className="qs-uc-av">{(nm || '?').trim().charAt(0).toUpperCase()}</span>
      <span className="qs-uc-name">{me.username || ''}</span>
      {open && (
        <div className="qs-uc-dd" onClick={e => e.stopPropagation()}>
          <div className="qs-uc-hd">
            <b>{nm}</b>
            <span className="qs-uc-role">{ROLE_LBL[me.role] || 'Nhân viên'}</span>
            {cty ? <div className="qs-uc-cty">{cty}</div> : null}
          </div>
          <a onClick={openChangePw}>Đổi mật khẩu</a>
          <a className="danger" onClick={() => { setOpen(false); logout() }}>Đăng xuất</a>
        </div>
      )}
    </div>
  )
}
