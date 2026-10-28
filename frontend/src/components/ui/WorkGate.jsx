import { useState } from 'react'
import { useWorkSession } from '../../services/workSession'

/* Cổng đăng nhập của các trang nghiệp vụ (Kinh doanh, Quản lý thiết kế, Quản lý dự án): chưa sẵn sàng thì hiện
   thẻ đăng nhập / trạng thái thay cho nội dung; thiếu quyền tab thì báo. children chỉ được vẽ khi đã đăng nhập. */
const box = { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg)' }
const card = { width: 360, maxWidth: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '26px 26px 22px', boxShadow: '0 12px 40px rgba(15,30,60,.12)', display: 'flex', flexDirection: 'column', gap: 12, color: 'var(--text)' }
const input = { border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', fontSize: 13.5, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text)' }
const btn = { border: 'none', borderRadius: 9, padding: '10px 14px', fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', background: 'var(--primary)', color: '#fff' }

function Msg({ title, text, action }) {
  return (
    <div style={box}><div style={card}>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{text}</div>
      {action}
    </div></div>
  )
}

export default function WorkGate({ tab, title, children }) {
  const s = useWorkSession()
  const [user, setUser] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (s.auth === 'unconfigured') return <Msg title={title} text="Chưa cấu hình địa chỉ máy chủ (VITE_API_URL) nên chưa lưu được dữ liệu." />
  if (s.auth === 'checking') return <Msg title={title} text="Đang kiểm tra phiên đăng nhập…" />
  if (s.auth === 'unreachable') return <Msg title={title} text={s.error || 'Không kết nối được máy chủ.'} action={<button style={btn} onClick={s.retry}>Thử lại</button>} />
  if (s.auth === 'login') {
    const submit = async e => {
      e.preventDefault()
      if (busy) return
      setBusy(true); setErr('')
      try { await s.login(user, pw); setPw('') } catch (x) { setErr((x && x.message) || 'Đăng nhập thất bại') }
      setBusy(false)
    }
    return (
      <div style={box}>
        <form style={card} onSubmit={submit}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Đăng nhập {title}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Dùng tài khoản Dezon Pro (chung với QS).</div>
          {(err || s.error) && <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger)', background: 'var(--danger-tint)', borderRadius: 8, padding: '8px 10px' }}>{err || s.error}</div>}
          <input style={input} autoFocus autoComplete="username" placeholder="Tên đăng nhập" value={user} onChange={e => setUser(e.target.value)} />
          <input style={input} type="password" autoComplete="current-password" placeholder="Mật khẩu" value={pw} onChange={e => setPw(e.target.value)} />
          <button style={btn} disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
        </form>
      </div>
    )
  }
  if (tab && !s.canTab(tab)) {
    const msg = s.me && s.me.role === 'super' ? 'Quản trị hệ thống: chọn "Xem như công ty" ở trang QS trước.' : 'Tài khoản chưa được cấp quyền vào phần này. Nhờ admin công ty cấp quyền.'
    return <Msg title={title} text={msg} action={<button style={{ ...btn, background: 'var(--surface-alt)', color: 'var(--text)' }} onClick={s.logout}>Đăng xuất</button>} />
  }
  return children
}
