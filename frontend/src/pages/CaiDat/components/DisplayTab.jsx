import { NAV_MAIN, NAV_BOTTOM } from '../../../data/navigation'
import { useNavHidden, toggleNavHidden, setNavHidden, NAV_LOCKED } from '../../../hooks/useNavHidden'
import { cardStyle, titleStyle, descStyle, RowText, ToggleSwitch } from './shared'
import { PAGE_TABS } from '../../../data/pageTabs'
import { useAllPageTabsHidden, togglePageTab, showAllPageTabs } from '../../../hooks/usePageTabs'

/* Tab "Hiển thị" — bật / tắt từng tab chính trên menu bên trái và từng module (tab đầu trang) trong các trang chính
   theo nhu cầu của người dùng (lưu trên máy này) */
function NavIcon({ pathData }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      style={{ flex: 'none', color: 'var(--text-muted)' }} dangerouslySetInnerHTML={{ __html: pathData }} />
  )
}

const linkBtn = { border: '1px solid var(--border)', background: 'var(--surface-alt)', color: 'var(--text)', padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }

function NavGroup({ title, items, hidden }) {
  const shown = items.filter(i => hidden.indexOf(i.path) < 0).length
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <h3 style={{ ...titleStyle(0), flex: 1 }}>{title}</h3>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Đang hiện {shown}/{items.length}</span>
      </div>
      {items.map(item => {
        const locked = NAV_LOCKED.indexOf(item.path) >= 0
        const on = locked || hidden.indexOf(item.path) < 0
        return (
          <div key={item.path} className="cd-settings-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <NavIcon pathData={item.icon} />
              <RowText title={item.label} desc={locked ? 'Luôn hiện để còn vào được Cài đặt' : on ? 'Đang hiện trên menu' : 'Đã ẩn khỏi menu'} />
            </div>
            {locked
              ? <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Bắt buộc</span>
              : <ToggleSwitch on={on} onClick={() => toggleNavHidden(item.path)} />}
          </div>
        )
      })}
    </div>
  )
}

/* Module (tab đầu trang) của từng trang chính: mỗi trang 1 dòng chip, bấm chip để ẩn / hiện; luôn còn ít nhất 1 tab hiện */
const chip = on => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600,
  fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
  border: '1px solid ' + (on ? 'color-mix(in srgb, var(--primary) 45%, var(--border))' : 'var(--border)'),
  background: on ? 'var(--primary-tint)' : 'transparent', color: on ? 'var(--primary)' : 'var(--text-muted)',
  textDecoration: on ? 'none' : 'line-through',
})
function PageTabsCard() {
  const all = useAllPageTabsHidden()
  const nHidden = Object.keys(all).reduce((n, p) => n + all[p].length, 0)
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <h3 style={{ ...titleStyle(0), flex: 1 }}>Module trong từng trang</h3>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{nHidden ? 'Đang ẩn ' + nHidden + ' module' : 'Đang hiện mọi module'}</span>
        <button type="button" style={linkBtn} disabled={!nHidden} onClick={() => showAllPageTabs()}>Hiện tất cả</button>
      </div>
      <p style={descStyle}>Bật / tắt từng tab trên thanh đầu trang của các trang chính (vd Marketing: Chiến dịch, Danh mục, Báo giá…). Bấm vào tab để ẩn / hiện; mỗi trang luôn giữ ít nhất 1 tab. Chỉ ẩn khỏi thanh tab, không đổi quyền. Lưu trên máy / trình duyệt này.</p>
      {PAGE_TABS.map(pg => {
        const h = all[pg.path] || []
        const keys = pg.tabs.map(t => t[0])
        const shown = keys.filter(k => h.indexOf(k) < 0).length
        return (
          <div key={pg.path} className="cd-settings-row" style={{ alignItems: 'flex-start', gap: 16 }}>
            <div style={{ width: 150, flex: 'none', paddingTop: 5 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{pg.label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Đang hiện {shown}/{keys.length}</div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>
              {pg.tabs.map(([k, l]) => {
                const on = h.indexOf(k) < 0
                const last = on && shown <= 1
                return (
                  <button key={k} type="button" style={{ ...chip(on), ...(last ? { cursor: 'not-allowed', opacity: .7 } : null) }} aria-pressed={on}
                    title={last ? 'Phải giữ ít nhất 1 tab hiện' : on ? 'Bấm để ẩn "' + l + '"' : 'Bấm để hiện lại "' + l + '"'}
                    onClick={() => togglePageTab(pg.path, k, keys)}>
                    {on ? '✓ ' : ''}{l}
                  </button>
                )
              })}
            </div>
            {h.length > 0 && <button type="button" style={{ ...linkBtn, flex: 'none' }} onClick={() => showAllPageTabs(pg.path)}>Hiện lại</button>}
          </div>
        )
      })}
    </div>
  )
}

export default function DisplayTab() {
  const hidden = useNavHidden()
  return (
    <>
      <div style={cardStyle}>
        <h3 style={titleStyle(4)}>Hiển thị tab chính</h3>
        <p style={descStyle}>Ẩn những tab bạn không dùng (Kinh doanh, Marketing…) cho menu bên trái gọn hơn. Chỉ ẩn khỏi menu, không đổi quyền: vào thẳng đường dẫn vẫn mở được. Lưu trên máy / trình duyệt này.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={linkBtn} disabled={!hidden.length} onClick={() => setNavHidden([])}>Hiện tất cả</button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>{hidden.length ? 'Đang ẩn ' + hidden.length + ' tab' : 'Đang hiện mọi tab'}</span>
        </div>
      </div>
      <PageTabsCard />
      <NavGroup title="Tab chính" items={NAV_MAIN} hidden={hidden} />
      <NavGroup title="Tiện ích" items={NAV_BOTTOM} hidden={hidden} />
    </>
  )
}
