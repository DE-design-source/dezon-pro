import { useEffect, useState } from 'react'
import WorkGate from '../../../components/ui/WorkGate'
import { useWorkSession } from '../../../services/workSession'
import { cardStyle, titleStyle, descStyle, primaryBtnStyle, Field } from './shared'

/* Tab "Tài khoản" — tài khoản Dezon Pro (chung với QS) đang đăng nhập, đọc từ /auth/me (services/workSession).
   Tự sửa được Họ tên + Email (PATCH /auth/me); tên đăng nhập, vai trò, phòng ban, công ty chỉ admin đổi (Cài đặt > Admin).
   Đổi mật khẩu: /auth/change-password (đổi xong các phiên khác của tài khoản bị đăng xuất). */
const ROLE_LBL = { super: 'Quản trị hệ thống', admin: 'Quản trị công ty', staff: 'Nhân viên' }
const readOnly = { readOnly: true, style: { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 13, fontFamily: 'inherit', cursor: 'default' } }
const ghostBtn = { border: '1px solid var(--border)', background: 'var(--surface-alt)', color: 'var(--text)', padding: '9px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
// chữ đầu của từ đầu + từ cuối: "Trần Anh" -> "TA", "Nguyễn Văn A" -> "NA"
const initials = s => { const w = String(s || '').trim().split(/\s+/).filter(Boolean); return ((w[0] || '?').charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : '')).toUpperCase() }

function Note({ msg }) {
  if (!msg) return null
  const ok = msg.ok
  return <div role={ok ? 'status' : 'alert'} style={{ fontSize: 12.5, borderRadius: 8, padding: '8px 10px', marginTop: 14, color: ok ? 'var(--success)' : 'var(--danger)', background: ok ? 'var(--success-tint)' : 'var(--danger-tint)' }}>{msg.text}</div>
}

function Profile() {
  const { me, congTy, saveProfile, logout } = useWorkSession()
  const [hoTen, setHoTen] = useState(me.hoTen || '')
  const [email, setEmail] = useState(me.email || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  // đổi tài khoản (đăng nhập người khác) -> nạp lại ô nhập
  useEffect(() => { setHoTen(me.hoTen || ''); setEmail(me.email || ''); setMsg(null) }, [me.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = hoTen.trim() !== (me.hoTen || '') || email.trim().toLowerCase() !== (me.email || '').toLowerCase()
  const cty = (congTy && congTy.ten) || (me.role === 'super' ? 'Toàn hệ thống' : '')
  async function save() {
    if (busy || !dirty) return
    setBusy(true); setMsg(null)
    try {
      const u = await saveProfile({ hoTen: hoTen.trim(), email: email.trim() })
      setHoTen(u.hoTen || ''); setEmail(u.email || '')
      setMsg({ ok: true, text: 'Đã lưu thông tin tài khoản' })
    } catch (e) { setMsg({ ok: false, text: (e && e.message) || 'Không lưu được' }) }
    setBusy(false)
  }

  return (
    <div style={cardStyle}>
      <h3 style={titleStyle(16)}>Thông tin tài khoản</h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--primary-tint)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18, flex: 'none' }}>{initials(me.hoTen || me.username)}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{me.hoTen || me.username}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{[ROLE_LBL[me.role] || 'Nhân viên', cty].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <Field label="Họ tên" type="text" value={hoTen} maxLength={100} placeholder="Chưa đặt họ tên" onChange={e => setHoTen(e.target.value)} />
      <Field label="Email" type="email" value={email} placeholder="Chưa có email" onChange={e => setEmail(e.target.value)} />
      <Field label="Tên đăng nhập" type="text" value={me.username || ''} {...readOnly} />
      <Field label="Phòng ban" type="text" value={me.phongBan || '—'} {...readOnly} />
      <Field label="Vai trò" type="text" value={ROLE_LBL[me.role] || 'Nhân viên'} {...readOnly} />
      <Field label="Công ty" type="text" value={cty || '—'} {...readOnly} last />
      <p style={{ ...descStyle, margin: '10px 0 0' }}>Tên đăng nhập, phòng ban, vai trò và công ty do admin công ty quản lý.</p>
      <Note msg={msg} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
        <button type="button" style={ghostBtn} onClick={logout}>Đăng xuất</button>
        <button type="button" style={{ ...primaryBtnStyle, opacity: dirty && !busy ? 1 : 0.55, cursor: dirty && !busy ? 'pointer' : 'default' }} disabled={!dirty || busy} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</button>
      </div>
    </div>
  )
}

function Password() {
  const { changePassword } = useWorkSession()
  const [f, setF] = useState({ old: '', np: '', np2: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  async function submit(e) {
    e.preventDefault()
    if (busy) return
    if (f.np.length < 4) { setMsg({ ok: false, text: 'Mật khẩu mới phải từ 4 ký tự' }); return }
    if (f.np !== f.np2) { setMsg({ ok: false, text: 'Nhập lại mật khẩu mới chưa khớp' }); return }
    setBusy(true); setMsg(null)
    try {
      await changePassword(f.old, f.np)
      setF({ old: '', np: '', np2: '' })
      setMsg({ ok: true, text: 'Đã đổi mật khẩu. Các phiên đăng nhập khác của tài khoản đã bị đăng xuất.' })
    } catch (x) { setMsg({ ok: false, text: (x && x.message) || 'Không đổi được mật khẩu' }) }
    setBusy(false)
  }
  return (
    <form style={cardStyle} onSubmit={submit}>
      <h3 style={titleStyle(16)}>Đổi mật khẩu</h3>
      <Field label="Mật khẩu hiện tại" type="password" autoComplete="current-password" value={f.old} onChange={set('old')} />
      <Field label="Mật khẩu mới (từ 4 ký tự)" type="password" autoComplete="new-password" value={f.np} onChange={set('np')} />
      <Field label="Nhập lại mật khẩu mới" type="password" autoComplete="new-password" value={f.np2} onChange={set('np2')} last />
      <Note msg={msg} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button type="submit" style={{ ...primaryBtnStyle, opacity: busy ? 0.55 : 1 }} disabled={busy || !f.old || !f.np}>{busy ? 'Đang đổi…' : 'Đổi mật khẩu'}</button>
      </div>
    </form>
  )
}

export default function AccountTab() {
  return (
    <WorkGate title="Tài khoản">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Profile />
        <Password />
      </div>
    </WorkGate>
  )
}
