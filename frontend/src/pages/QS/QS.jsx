import { useEffect, useState } from 'react'
import './QS.css'
import { useTheme } from '../../hooks/useTheme'
import Icon from '../../components/ui/Icon'
import OverviewTab from './components/OverviewTab'
import ProjectsTab from './components/ProjectsTab'
import BreakdownTab from './components/BreakdownTab'
import ProductsTab from './components/ProductsTab'
import CostTab from './components/CostTab'
import QuoteTab from './components/QuoteTab'
import PurchaseTab from './components/PurchaseTab'
import Dezbot, { loadAiPanelWidth } from './components/Dezbot'
import ImportTab from './components/importer/ImportTab'
import PCard from './components/project/PCard'
import QuickBar from './components/project/QuickBar'
import NotificationBell from './components/notifications/NotificationBell'
import ModalHost from './components/common/ModalHost'
import ExpiryBanner from './components/common/ExpiryBanner'
import UpdateBanner from './components/common/UpdateBanner'
import StatusView from './components/common/StatusView'
import ErrorBoundary from './components/common/ErrorBoundary'
import { QsDataProvider } from './state/QsData'
import { useQsStore, showTab, retryBoot } from './state/store'
import { useQsSession } from './session/QsSession'
import LoginScreen from './session/LoginScreen'
import UserChip from './session/UserChip'
import { API_BASE, apiConfigured, reportClientError } from './api/http'
import { logoUrl } from './api/files'
import DevSheetProbe from './state/DevSheetProbe'

/* Tab chính, đúng thứ tự + mã tab của bản gốc (PUB/index.html:6580-6587); quyền theo canTab */
const TABS = [
  { key: 'dash', label: 'Bảng điều khiển' },
  { key: 'boc', label: 'Bóc tách' },
  { key: 'chiphi', label: 'Chi phí' },
  { key: 'export', label: 'Xuất báo giá' },
  { key: 'muahang', label: 'Mua hàng' },
  { key: 'duan', label: 'Dự án' },
]
/* Băng dự án ẩn ở trang không thuộc 1 dự án và ở Bảng điều khiển (PUB/app.js:350-353) */
const NO_PCARD = { dash: 1, sanpham: 1, import: 1 }
/* Công ty / Admin đã chuyển sang trang Cài đặt (QsSettingsPanels): tab của store còn trỏ tới đó thì /qs về tab đầu tiên được phép */
const SETTINGS_TABS = { admin: 1, congty: 1 }
const QB_TABS = { boc: 1, chiphi: 1, duan: 1, muahang: 1 }

/* Hướng bố cục và khoảng cách của từng tab (giống style inline của các .qs-panel trong bản HTML) */
const PANEL_LAYOUT = {
  dash: { flexDirection: 'column', gap: 16 },   // = khoảng cách giữa các khối trong Bảng điều khiển (dashboard.css)
  duan: { flexDirection: 'column', gap: 8, minHeight: '100%' },
  /* PCard nằm trên panel trong .qs-scroll: panel lấy phần còn lại (flex) để vừa khít màn hình như #v-boc (requests/1-1B.txt) */
  boc: { flexDirection: 'column', gap: 10, flex: '1 1 0', minHeight: 560 },
  chiphi: { flexDirection: 'column', gap: 8, minHeight: '100%' },
  sanpham: { flexDirection: 'row', gap: 16, minHeight: 0 },
  /* không min-height:100%: chế độ "Xem trước & Xuất" tự vừa đáy .qs-scroll (bgVpApply_), min-height làm trang cuộn dư (requests/2-2B.txt) */
  export: { flexDirection: 'column', gap: 8 },
  muahang: { flexDirection: 'column', gap: 8 },
  import: { flexDirection: 'column', gap: 10 },
}

let splashShown = false   // màn chờ chỉ hiện ở lần nạp đầu của trang, không hiện lại khi quay lại /qs

export default function QS() {
  return (
    <QsDataProvider>
      <QsRoot />
    </QsDataProvider>
  )
}

function QsRoot() {
  const { theme, toggleTheme } = useTheme()
  const session = useQsSession()
  const tab = useQsStore(s => s.tab)
  const boot = useQsStore(s => s.boot)
  const bootStep = useQsStore(s => s.bootStep)
  const bootError = useQsStore(s => s.bootError)
  const bootErrorKind = useQsStore(s => s.bootErrorKind)
  const visSeq = useQsStore(s => s.visSeq)
  const curMa = useQsStore(s => (s.cur ? s.cur.maDA : ''))
  const [aiOpen, setAiOpen] = useState(false)
  const [aiWidth, setAiWidth] = useState(loadAiPanelWidth)
  const [aiResizing, setAiResizing] = useState(false)
  const [splashGone, setSplashGone] = useState(splashShown)

  const configured = apiConfigured()
  const auth = configured ? session.auth : 'unconfigured'
  const ready = auth === 'ready'
  const me = session.me
  const can = t => !!me && session.canTab(t)

  useEffect(() => { if (SETTINGS_TABS[tab]) showTab(session.firstAllowedTab() || 'dash') }, [tab, me])   // eslint-disable-line react-hooks/exhaustive-deps

  const loading = configured && (auth === 'init' || auth === 'checking' || (ready && (boot === 'idle' || boot === 'loading')))
  const showSplash = configured && !splashGone
  /* Màu chính công ty (PUB/app.js:2512 đặt --blue); màu nhấn của QS clone là --dash-accent nên đặt cả biến này, chỉ trong .qs-page */
  const mau = session.congTy && session.congTy.mauChinh
  const brand = mau ? { '--primary': mau, '--blue': mau, '--dash-accent': mau } : null

  const panel = key => ({ display: tab === key ? 'flex' : 'none', ...PANEL_LAYOUT[key] })
  /* Panel lỗi được vẽ lại khi panel đó hiện lại (visSeq) hoặc đổi dự án; PCard / QuickBar thì theo tab (requests/0-F-C.txt) */
  const guard = (key, el) => (
    <ErrorBoundary resetKey={key + '|' + (PANEL_LAYOUT[key] ? (visSeq[key] || 0) : tab) + '|' + curMa} onError={e => reportClientError(e && e.message, 'render ' + key, key)}>{el}</ErrorBoundary>
  )

  let body = null
  if (auth === 'unconfigured') body = <StatusView kind="notConfigured" />
  else if (auth === 'unreachable' || (ready && boot === 'error' && bootErrorKind === 'unreachable'))
    body = <StatusView kind="unreachable" apiUrl={API_BASE} onRetry={() => (auth === 'unreachable' ? session.retry() : retryBoot())} />
  else if (ready && boot === 'error') body = <StatusView kind="error" message={bootError} onRetry={() => retryBoot()} />
  else if (me) {
    body = (
      <>
        {/* Dải nhắc gia hạn cho admin (M17.3): tự ẩn khi không phải admin hoặc hạn dùng còn > 30 ngày */}
        {guard('expiry', <ExpiryBanner />)}
        {!NO_PCARD[tab] && guard('pcard', <PCard />)}
        {QB_TABS[tab] && guard('qbar', <QuickBar tab={tab} />)}
        {/* Các tab luôn được mount (ẩn bằng display) để giữ trạng thái bộ lọc, giống bản HTML */}
        <div style={panel('dash')}>{guard('dash', <OverviewTab />)}</div>
        <div style={panel('duan')}>{guard('duan', <ProjectsTab />)}</div>
        <div style={panel('boc')}>{guard('boc', <BreakdownTab />)}</div>
        <div style={panel('chiphi')}>{guard('chiphi', <CostTab />)}</div>
        <div style={panel('sanpham')}>{guard('sanpham', <ProductsTab />)}</div>
        <div style={panel('export')}>{guard('export', <QuoteTab />)}</div>
        <div style={panel('muahang')}>{guard('muahang', <PurchaseTab />)}</div>
        <div style={panel('import')}>{guard('import', <ImportTab />)}</div>
      </>
    )
  }

  return (
    <div
      className={`qs-page${aiOpen ? ' qs-ai-open' : ''}${aiResizing ? ' qs-ai-resizing' : ''}`}
      style={{ '--ai-panel-width': `${aiWidth}px`, ...brand }}
    >
      <div className="qs-topbar">
        {/* đầu trang giống các trang khác (vd. Tài chính): ô biểu tượng + tên trang | vạch | các tab */}
        <div className="qs-hdr-icon" aria-hidden="true">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 14l2 2 4-4" /></svg>
        </div>
        <span className="qs-hdr-title">QS</span>
        <div className="qs-tabs-row">
          {me && TABS.filter(t => can(t.key)).map(t => (
            <button key={t.key} className={`qs-tab${tab === t.key ? ' active' : ''}`} onClick={() => showTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="qs-top-actions">
          {can('sanpham') && <button className={`qs-top-btn${tab === 'sanpham' ? ' on' : ''}`} title="Danh sách sản phẩm" onClick={() => showTab('sanpham')}><Icon name="listLines" size={14} /><span>Danh sách sản phẩm</span></button>}
          {can('import') && <button className={`qs-top-btn primary${tab === 'import' ? ' on' : ''}`} title="Nhập dữ liệu" onClick={() => showTab('import')}><Icon name="upload" size={14} /><span>Nhập dữ liệu</span></button>}
          <button className="qs-top-btn icon" title="Chuyển giao diện sáng/tối" onClick={toggleTheme}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
          </button>
          {ready && <NotificationBell />}
          {ready && <UserChip />}
        </div>
      </div>

      <div className={`qs-scroll${tab === 'sanpham' ? '' : ' qs-scroll-dash'}${tab === 'dash' ? ' qs-scroll-home' : ''}`} style={tab === 'boc' || tab === 'export' ? { display: 'flex', flexDirection: 'column', gap: 12, padding: 12 } : undefined}>
        {body}
      </div>

      <ModalHost />
      {/* Dải nhắc "Đã có bản cập nhật mới" (M1.1): hiện cả ở màn đăng nhập như bản gốc */}
      <UpdateBanner />
      {import.meta.env.DEV && ready && <DevSheetProbe />}

      <Dezbot
        open={aiOpen}
        onToggle={() => setAiOpen(o => !o)}
        onClose={() => setAiOpen(false)}
        onResize={setAiWidth}
        onResizingChange={setAiResizing}
      />

      {auth === 'login' && <LoginScreen message={session.loginMsg} />}
      {showSplash && (
        <StatusView kind="splash" message={bootStep || 'Đang khởi động…'} done={!loading} logoSrc={logoUrl()}
          onHidden={() => { splashShown = true; setSplashGone(true) }} />
      )}
    </div>
  )
}
