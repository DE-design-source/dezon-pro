import { useWorkSession } from '../../services/workSession'

/* Cổng quyền của các trang nghiệp vụ (Kinh doanh, Quản lý thiết kế, Quản lý dự án, HR...). Đăng nhập đã do màn chung
   (components/layout/AppGate.jsx) lo; ở đây chỉ còn thẻ trạng thái và báo thiếu quyền tab. children chỉ được vẽ khi được phép. */
const box = { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg)' }
const card = { width: 360, maxWidth: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '26px 26px 22px', boxShadow: '0 12px 40px rgba(15,30,60,.12)', display: 'flex', flexDirection: 'column', gap: 12, color: 'var(--text)', boxSizing: 'border-box' }
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

  if (s.auth === 'unconfigured') return <Msg title={title} text="Chưa cấu hình địa chỉ máy chủ (VITE_API_URL) nên chưa lưu được dữ liệu." />
  if (s.auth === 'unreachable') return <Msg title={title} text={s.error || 'Không kết nối được máy chủ.'} action={<button style={btn} onClick={s.retry}>Thử lại</button>} />
  if (s.auth !== 'ready' || !s.me) return <Msg title={title} text="Đang kiểm tra phiên đăng nhập…" />
  if (tab && !s.canTab(tab)) {
    const msg = s.me.role === 'super'
      ? 'Quản trị hệ thống: chọn công ty ở "Cài đặt > Công ty" (Xem như công ty) để xem dữ liệu phần này.'
      : 'Tài khoản chưa được cấp quyền vào phần này. Nhờ quản trị viên cấp quyền.'
    return <Msg title={title} text={msg} action={<button style={{ ...btn, background: 'var(--surface-alt)', color: 'var(--text)' }} onClick={s.logout}>Đăng xuất</button>} />
  }
  return children
}
