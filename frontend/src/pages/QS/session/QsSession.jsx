/* Phiên đăng nhập nhìn từ trang QS. Đăng nhập / đăng xuất đi qua phiên chung của ứng dụng (services/workSession.js);
   store QS chỉ nhận me / congTy (adoptSession) và nạp dữ liệu riêng.
   useQsSession() -> {auth, loginMsg, me, congTy, viewAs, isAdmin, isSubAdmin, canManageUsers, isSuper, canTab(tab), firstAllowedTab(),
                      login(user, pw), logout(), changePassword(oldPw, newPw), setViewAs(id|null), retry()}
   isAdmin: admin / super; isSubAdmin: 'subadmin' (nhãn "Admin", chỉ quản lý tài khoản nhân viên); canManageUsers = isAdmin || isSubAdmin.
   auth: 'init' | 'unconfigured' | 'checking' | 'login' | 'unreachable' | 'ready' (xem state/store.js). */
import {
  useQsStore, canTab, firstAllowedTab_, isAdminRole_, isSubAdminRole_, canManageUsers_, changePassword, setViewAs, retrySession,
} from '../state/store'
import { login, logout } from '../../../services/workSession'

export function useQsSession() {
  const auth = useQsStore(s => s.auth)
  const loginMsg = useQsStore(s => s.loginMsg)
  const me = useQsStore(s => s.me)
  const congTy = useQsStore(s => s.congTy)
  const viewAs = useQsStore(s => s.viewAs)
  return {
    auth, loginMsg, me, congTy, viewAs,
    isAdmin: isAdminRole_(me),
    isSubAdmin: isSubAdminRole_(me),     // 'subadmin' (nhãn "Admin"): quản lý tài khoản nhân viên, isAdmin vẫn false
    canManageUsers: canManageUsers_(me), // admin / super / subadmin: vào được mục Cài đặt > Admin
    isSuper: !!me && me.role === 'super',
    canTab: tab => canTab(tab, me, congTy),
    firstAllowedTab: () => firstAllowedTab_(me, congTy),
    login, logout, changePassword, setViewAs, retry: retrySession,
  }
}
