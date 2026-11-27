import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import './QS.css'
import './qsSettings.css'
import AdminTab from './components/admin/AdminTab'
import CongTyTab from './components/congty/CongTyTab'
import ModalHost from './components/common/ModalHost'
import ErrorBoundary from './components/common/ErrorBoundary'
import { useQsStore, getState, setState, showTab } from './state/store'
import { useQsSession } from './session/QsSession'
import { reportClientError } from './api/http'

/* Tab Công ty / Admin của QS, đặt trong trang Cài đặt (không còn nút trên thanh tab của /qs).
   Dùng lại nguyên AdminTab / CongTyTab: chúng tải dữ liệu khi panelVisible(tab) (= tab của store QS), nên lúc mục
   Cài đặt tương ứng đang mở thì đặt tab của store sang 'admin' / 'congty', rời mục thì trả lại tab cũ cho trang /qs.
   Trang Cài đặt phải bọc trong <QsDataProvider> (phiên QS + thông báo). */
export const QS_SETTINGS = [
  { key: 'qs-congty', tab: 'congty', label: 'Công ty' },
  { key: 'qs-admin', tab: 'admin', label: 'Admin' },
  /* Yêu cầu xoá sản phẩm + mua hàng tách khỏi Admin (MarkUp 2026-11-12): cùng tab 'admin' của store, AdminTab view='yeucau' */
  { key: 'qs-yeucau', tab: 'admin', view: 'yeucau', label: 'Yêu cầu', adminOnly: true },
  { key: 'qs-nhatky', tab: 'admin', view: 'nhatky', label: 'Nhật ký hoạt động', adminOnly: true },
  /* adminOnly: chỉ admin / super (vai trò 'subadmin' vào tab 'admin' nhưng chỉ thấy mục Admin = tài khoản nhân viên) */
  /* Tài khoản super tách khỏi bảng của Admin (MarkUp 2026-11-12 17:43); chỉ super thấy */
  { key: 'qs-sieu', tab: 'admin', view: 'super', label: 'Tài khoản siêu quản trị viên', superOnly: true },
]

/* Đường dẫn mở thẳng 1 mục (vd. chuông thông báo của /qs mở chi tiết đơn ở Admin) */
export const qsSettingsPath = tab => '/cai-dat?tab=qs-' + tab

/* Các mục QS tài khoản đang đăng nhập được thấy (Công ty: super; Admin: admin / super / subadmin; Yêu cầu, Nhật ký: admin / super) */
export function useQsSettingsTabs() {
  const { me, canTab, isSuper, isAdmin } = useQsSession()
  return me ? QS_SETTINGS.filter(t => canTab(t.tab) && (!t.superOnly || isSuper) && (!t.adminOnly || isAdmin)) : []
}

const PANEL_STYLE = { flexDirection: 'column', gap: 10 }

/* Props: active = khoá mục Cài đặt đang mở ('qs-admin' / 'qs-congty' / mục khác của Cài đặt) */
export default function QsSettingsPanels({ active }) {
  const session = useQsSession()
  const visSeq = useQsStore(s => s.visSeq)
  const cur = QS_SETTINGS.find(t => t.key === active)
  const tab = cur ? cur.tab : ''
  const me = session.me
  const allowed = !!me && !!tab && session.canTab(tab) && !(cur.superOnly && !session.isSuper) && !(cur.adminOnly && !session.isAdmin)

  useEffect(() => {
    if (!allowed) return undefined
    const prev = getState().tab
    showTab(tab)
    return () => { if (getState().tab === tab) setState({ tab: prev }) }
  }, [tab, allowed])

  /* Màu chính công ty, như .qs-page của /qs */
  const mau = session.congTy && session.congTy.mauChinh
  const brand = mau ? { '--primary': mau, '--blue': mau, '--dash-accent': mau } : null

  const guard = (key, el) => (
    <ErrorBoundary resetKey={key + '|' + (visSeq[key] || 0)} onError={e => reportClientError(e && e.message, 'render ' + key, key)}>{el}</ErrorBoundary>
  )
  const panel = key => ({ display: tab === key && allowed ? 'flex' : 'none', ...PANEL_STYLE })

  let note = null
  if (cur && !allowed) {
    const a = session.auth
    note = a === 'login' || a === 'unconfigured' || a === 'unreachable'
      ? <>Đăng nhập QS để dùng mục này. <Link to="/qs">Mở QS</Link></>
      : me ? 'Tài khoản không có quyền vào mục này.' : 'Đang tải…'
  }

  return (
    <div className="qs-page qs-embed" style={{ ...brand, display: cur ? 'flex' : 'none' }}>
      <div className="qs-scroll qs-scroll-dash">
        {note && <div className="qsc-state">{note}</div>}
        {me && session.canTab('congty') && <div style={panel('congty')}>{guard('congty', <CongTyTab />)}</div>}
        {me && session.canTab('admin') && <div style={panel('admin')}>{guard('admin', <AdminTab view={(allowed && cur && cur.view) || 'admin'} />)}</div>}
      </div>
      <ModalHost />
    </div>
  )
}
