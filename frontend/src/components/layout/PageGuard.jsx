import { Navigate, useLocation } from 'react-router-dom'
import { useWorkSession } from '../../services/workSession'
import { useAccess } from '../../services/accessService'
import { NAV_MAIN, NAV_BOTTOM, permOfPath } from '../../data/navigation'
import { StatusCard } from './AppGate'

/* Trang đầu tiên (theo thứ tự thanh bên) tài khoản được vào; Cài đặt không tính (luôn vào được) */
export function firstAllowedPath(canPage) {
  const it = NAV_MAIN.concat(NAV_BOTTOM).find(x => x.perm && canPage(x.perm))
  return it ? it.path : null
}

/* Chặn route theo quyền trang (Phân quyền 3 cấp N21: được xem ít nhất 1 tab của module; chưa có phân quyền -> quyền trang cũ):
   không được vào -> chuyển sang trang đầu tiên được phép, không được trang nào -> thẻ báo + Đăng xuất.
   Chờ nạp quyền thực (GET /access/me) để không lộ trang rồi mới bị chuyển; nạp lỗi thì theo quyền trang cũ.
   inline: thẻ nằm trong vùng nội dung của AppShell */
export default function PageGuard({ children, inline }) {
  const { pathname } = useLocation()
  const s = useWorkSession()
  const access = useAccess()
  const perm = permOfPath(pathname)
  if (perm && s.me && s.me.role !== 'super' && !access.ready && !access.error) {
    return <StatusCard inline={inline} text="Đang tải phân quyền…" />
  }
  if (s.canPage(perm)) return children
  const to = firstAllowedPath(s.canPage)
  if (to) return <Navigate to={to} replace />
  return (
    <StatusCard inline={inline} title="Chưa có quyền"
      text="Tài khoản chưa được cấp quyền vào trang nào. Nhờ quản trị viên cấp quyền."
      actions={<button type="button" className="dz-card-btn ghost" onClick={s.logout}>Đăng xuất</button>} />
  )
}
