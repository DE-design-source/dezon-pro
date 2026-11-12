import { Outlet } from 'react-router-dom'
import { useWorkSession } from '../../services/workSession'
import LoginPage from './LoginPage'
import './AppGate.css'

/* Thẻ trạng thái giữa màn hình. inline: nằm trong vùng nội dung của AppShell (thanh bên vẫn hiện) thay vì phủ kín */
export function StatusCard({ title, text, actions, inline }) {
  return (
    <div className={inline ? 'dz-inline' : 'dz-gate plain'}>
      <div className="dz-card">
        {title ? <div className="dz-card-t">{title}</div> : null}
        <div className="dz-card-x">{text}</div>
        {actions ? <div className="dz-card-acts">{actions}</div> : null}
      </div>
    </div>
  )
}

/* Cổng chung của MỌI route (App.jsx): chưa cấu hình / đang kiểm tra / mất kết nối -> thẻ trạng thái,
   chưa đăng nhập -> 1 màn đăng nhập duy nhất, đã đăng nhập -> trang (AppShell kiểm quyền từng trang) */
export default function AppGate() {
  const s = useWorkSession()
  if (s.auth === 'unconfigured') return <StatusCard title="Dezon" text="Chưa cấu hình địa chỉ máy chủ (VITE_API_URL) nên chưa đăng nhập được." />
  if (s.auth === 'checking') return <StatusCard title="Dezon" text="Đang kiểm tra phiên đăng nhập…" />
  if (s.auth === 'unreachable') {
    return <StatusCard title="Không kết nối được máy chủ" text={s.error || 'Không kết nối được máy chủ.'}
      actions={<button type="button" className="dz-card-btn" onClick={s.retry}>Thử lại</button>} />
  }
  if (s.auth !== 'ready' || !s.me) return <LoginPage />
  return <Outlet />
}
