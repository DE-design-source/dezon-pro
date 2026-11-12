import { useState } from 'react'
import { useThemeContext, FONT_SCALE_MIN, FONT_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_MAX, uiScaleOf } from '../../../context/ThemeContext'
import { ACCENTS, EXTRA_ACCENTS, FONTS, FONT_SIZES, GLASS_LEVELS, WALLPAPERS } from '../../../data/caiDatData'
import { FONT_CATALOG, findFont, isFontAvailable } from '../../../data/fontCatalog'
import FontPicker from './FontPicker'
import { cardStyle, titleStyle, descStyle, RowText, ToggleSwitch } from './shared'

const pickCard = { border: '2px solid var(--border)', borderRadius: 12, padding: 14, cursor: 'pointer' }
const cardLabel = { fontSize: 12.5, fontWeight: 600 }
const cardSub = { fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }
const grid = n => ({ display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 12 })
const subTitle = { fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', margin: '18px 0 10px' }

/* Viền thẻ đang chọn — HTML gán style.borderColor bằng JS (syncThemeCards / syncUiThemeCards) */
const activeBorder = active => ({ ...pickCard, border: `2px solid ${active ? 'var(--primary)' : 'var(--border)'}` })

function Section({ title, desc, titleMb = 4, children }) {
  return (
    <div style={cardStyle}>
      <h3 style={titleStyle(titleMb)}>{title}</h3>
      {desc && <p style={descStyle}>{desc}</p>}
      {children}
    </div>
  )
}

/* Dấu tích ở góc thẻ đang chọn */
function Check({ show }) {
  if (!show) return null
  return (
    <span style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, width: 18, height: 18, borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 12 10 17 19 7" /></svg>
    </span>
  )
}

/* Mức có sẵn của "Kích thước chuẩn" (customize.uiScale, phần trăm; 100 = không lưu) */
const UI_SCALES = [
  { pct: 80, label: 'Rất gọn', note: 'Xem được nhiều nhất', box: 30 },
  { pct: 90, label: 'Gọn', note: 'Như QS trước đây', box: 36 },
  { pct: 100, label: 'Chuẩn', note: 'Mặc định', box: 42 },
  { pct: 110, label: 'Lớn', note: 'Dễ đọc', box: 48 },
]

const clampScale = v => Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(Number(v) || 100)))

function readSidebarCollapsed() {
  try { return localStorage.getItem('siteflow-sidebar-collapsed') === '1' } catch { return false }
}

const UI_THEMES = [
  { key: 'default', label: 'Mặc định', sub: 'Phẳng, rõ ràng, tối giản' },
  { key: 'glass', label: 'Liquid Glass', sub: 'Kính mờ, ánh sáng phản chiếu' },
  { key: 'super-glass', label: 'Super Liquid Glass', sub: 'Nền mesh gradient, kính siêu mỏng' },
]

/* Hình xem trước của từng bộ giao diện */
function UiThemePreview({ kind }) {
  const box = { height: 56, borderRadius: 8, marginBottom: 10, position: 'relative', overflow: 'hidden' }
  if (kind === 'default') {
    return (
      <div style={{ ...box, background: 'linear-gradient(135deg, var(--surface-alt), var(--surface))', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 36, height: 20, borderRadius: 6, background: 'var(--primary)' }} />
      </div>
    )
  }
  if (kind === 'glass') {
    return (
      <div style={{ ...box, background: 'linear-gradient(135deg, #4A7FE0 0%, #8B5CF6 60%, #C084FC 100%)' }}>
        <div style={{ position: 'absolute', inset: 6, borderRadius: 6, background: 'rgba(255,255,255,.22)', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,.45)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.6)' }} />
      </div>
    )
  }
  return (
    <div style={{ ...box, background: '#eef0f5' }}>
      <div style={{ position: 'absolute', width: 34, height: 34, borderRadius: '50%', background: '#5A96FF', opacity: 0.65, filter: 'blur(10px)', top: -8, left: -6 }} />
      <div style={{ position: 'absolute', width: 30, height: 30, borderRadius: '50%', background: '#BE78FF', opacity: 0.6, filter: 'blur(10px)', top: 6, right: -4 }} />
      <div style={{ position: 'absolute', width: 28, height: 28, borderRadius: '50%', background: '#FF9EC0', opacity: 0.55, filter: 'blur(10px)', bottom: -8, left: 18 }} />
      <div style={{ position: 'absolute', inset: 6, borderRadius: 6, background: 'rgba(255,255,255,.12)', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,.5)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.3), inset 0 1px 0 rgba(255,255,255,.7)' }} />
    </div>
  )
}

/* Tab "Giao diện" — mọi lựa chọn đi qua ThemeContext để toàn app cập nhật ngay */
export default function AppearanceTab() {
  const { theme, themeMode, setThemeMode, customize, updateCustomize, uiTheme, setUiTheme, resetAppearance } = useThemeContext()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)
  const [fontPickerOpen, setFontPickerOpen] = useState(false)

  const accent = customize.accent || 'blue'
  const accentCustom = customize.accentCustom || '#2F5DA8'
  const fontFamily = customize.fontFamily || ''
  const fontSize = customize.fontSize || 'medium'
  const density = customize.density || 'comfortable'
  const sidebarPos = customize.sidebarPos || 'left'
  const glassLevel = customize.glassLevel || 'medium'
  const motionOn = customize.motion !== 'off'
  const monoNumbers = !!customize.monoNumbers
  const currentUi = uiTheme || 'default'
  const isGlass = currentUi !== 'default'
  const pickedFont = findFont(fontFamily)
  /* Font đã lưu nhưng không còn trong danh mục (vd. Georgia trước đây) thì lấy tên đầu tiên trong giá trị */
  const currentFont = {
    label: pickedFont ? pickedFont.name : (fontFamily ? fontFamily.split(',')[0].replace(/['"]/g, '').trim() : 'Montserrat'),
    preview: fontFamily || "'Montserrat', sans-serif",
    missing: !!pickedFont && !isFontAvailable(pickedFont),
  }
  const fontPins = customize.fontPins || []
  const fontRecent = customize.fontRecent || []
  const wallpaper = customize.wallpaper || 'none'
  const wallpaperStrength = customize.wallpaperStrength || 60
  const presetSize = FONT_SIZES.find(s => s.key === fontSize)
  const fontPct = fontSize === 'custom' ? clampScale(customize.fontScale) : (presetSize ? presetSize.percent : 100)
  const uiScale = uiScaleOf(customize)
  const setUiScale = v => { const p = uiScaleOf({ uiScale: v }); updateCustomize({ uiScale: p === 100 ? undefined : p }) }

  function pickFont(f) {
    updateCustomize({ fontFamily: f.value, fontRecent: [f.name, ...fontRecent.filter(n => n !== f.name)].slice(0, 5) })
  }
  function togglePin(name) {
    updateCustomize({ fontPins: fontPins.includes(name) ? fontPins.filter(n => n !== name) : [...fontPins, name] })
  }
  /* Cỡ chữ tự chỉnh: trúng đúng một mức có sẵn thì lưu như mức đó */
  function applyScale(value) {
    const pct = clampScale(value)
    const preset = FONT_SIZES.find(p => p.percent === pct)
    updateCustomize(preset ? { fontSize: preset.key, fontScale: undefined } : { fontSize: 'custom', fontScale: pct })
  }

  /* Giống #toggleSidebar: lưu cờ thu gọn mặc định và xoá mức sidebar đã nhớ */
  function toggleSidebarDefault() {
    const collapsed = !sidebarCollapsed
    setSidebarCollapsed(collapsed)
    try { localStorage.setItem('siteflow-sidebar-collapsed', collapsed ? '1' : '0') } catch { /* bỏ qua */ }
    try { localStorage.removeItem('siteflow-sidebar-level') } catch { /* bỏ qua */ }
  }

  function resetAll() {
    if (!window.confirm('Đưa toàn bộ tuỳ chỉnh giao diện về mặc định?')) return
    resetAppearance()
    setSidebarCollapsed(false)
    try { localStorage.removeItem('siteflow-sidebar-collapsed') } catch { /* bỏ qua */ }
  }

  const modeCards = [
    { key: 'light', label: 'Sáng', bg: '#F3F4F7', border: '#E2E5EC' },
    { key: 'dark', label: 'Tối', bg: '#12151C', border: '#2B303C' },
    { key: 'system', label: 'Theo hệ thống', sub: `Đang dùng: ${theme === 'dark' ? 'Tối' : 'Sáng'}`, bg: 'linear-gradient(105deg, #F3F4F7 0 50%, #12151C 50% 100%)', border: '#8A93A3' },
  ]

  return (
    <>
      <Section title="Chế độ hiển thị" desc="Áp dụng cho toàn bộ giao diện SiteFlow trên trình duyệt này.">
        <div style={grid(3)}>
          {modeCards.map(m => (
            <div key={m.key} style={{ ...activeBorder(themeMode === m.key), position: 'relative' }} onClick={() => setThemeMode(m.key)}>
              <Check show={themeMode === m.key} />
              <div style={{ height: 56, borderRadius: 8, background: m.bg, border: `1px solid ${m.border}`, marginBottom: 10 }} />
              <div style={cardLabel}>{m.label}</div>
              {m.sub ? <div style={cardSub}>{m.sub}</div> : null}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Bộ giao diện" desc="Đổi toàn bộ phong cách hiển thị của SiteFlow — áp dụng trên mọi trang.">
        <div style={grid(3)}>
          {UI_THEMES.map(t => (
            <div key={t.key} style={{ ...activeBorder(currentUi === t.key), position: 'relative' }} onClick={() => setUiTheme(t.key)}>
              <Check show={currentUi === t.key} />
              <UiThemePreview kind={t.key} />
              <div style={cardLabel}>{t.label}</div>
              <div style={cardSub}>{t.sub}</div>
            </div>
          ))}
        </div>
        {isGlass ? (
          <>
            <div style={subTitle}>Độ trong suốt của bề mặt kính</div>
            <div style={grid(3)}>
              {GLASS_LEVELS.map(g => (
                <div key={g.key} style={{ ...activeBorder(glassLevel === g.key), padding: '10px 14px' }} onClick={() => updateCustomize({ glassLevel: g.key })}>
                  <div style={cardLabel}>{g.label}</div>
                  <div style={cardSub}>{g.note}</div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </Section>

      <Section title="Nền hệ thống" desc="Nền phía sau toàn bộ SiteFlow, áp dụng trên mọi trang. Đẹp nhất khi dùng cùng bộ giao diện Liquid Glass hoặc Super Liquid Glass.">
        <div style={grid(3)}>
          {WALLPAPERS.map(w => (
            <div key={w.key} style={{ ...activeBorder(wallpaper === w.key), position: 'relative' }} onClick={() => updateCustomize({ wallpaper: w.key })}>
              <Check show={wallpaper === w.key} />
              <div style={{ height: 56, borderRadius: 8, marginBottom: 10, background: w.preview, border: '1px solid var(--border)' }} />
              <div style={cardLabel}>{w.label}</div>
              <div style={cardSub}>{w.sub}</div>
            </div>
          ))}
        </div>
        {wallpaper !== 'none' ? (
          <div className="cd-settings-row" style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingBottom: 0 }}>
            <RowText title="Độ đậm của nền" desc="Giảm xuống nếu chữ nằm trực tiếp trên nền khó đọc" />
            <div className="cd-range">
              <input type="range" min="30" max="100" step="5" value={wallpaperStrength} title="Độ đậm của nền" onChange={e => updateCustomize({ wallpaperStrength: Number(e.target.value) })} />
              <span className="cd-range-value">{wallpaperStrength}%</span>
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="Màu chủ đạo" desc="Áp dụng cho nút, tab và trạng thái active trên toàn bộ SiteFlow.">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          {ACCENTS.map(a => (
            <div
              key={a.key}
              className={`cd-accent-swatch${accent === a.key ? ' active' : ''}`}
              style={{ background: a.color }}
              title={a.title}
              onClick={() => updateCustomize({ accent: a.key })}
            />
          ))}
          <span style={{ width: 1, height: 26, background: 'var(--border)' }} />
          {EXTRA_ACCENTS.map(a => (
            <div
              key={a.color}
              className={`cd-accent-swatch${accent === 'custom' && accentCustom.toLowerCase() === a.color.toLowerCase() ? ' active' : ''}`}
              style={{ background: a.color }}
              title={a.title}
              onClick={() => updateCustomize({ accent: 'custom', accentCustom: a.color })}
            />
          ))}
        </div>
        <div className="cd-settings-row" style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingBottom: 0 }}>
          <RowText title="Màu tự chọn" desc="Chọn bất kỳ màu nào làm màu chủ đạo (ví dụ màu thương hiệu của công ty)" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{accent === 'custom' ? accentCustom : '—'}</span>
            <input
              type="color" value={accentCustom} title="Chọn màu chủ đạo"
              onChange={e => updateCustomize({ accent: 'custom', accentCustom: e.target.value })}
              style={{ width: 44, height: 30, border: `2px solid ${accent === 'custom' ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 8, padding: 2, background: 'none', cursor: 'pointer' }}
            />
          </div>
        </div>
      </Section>

      <Section title="Font chữ" desc="Một font duy nhất cho toàn bộ SiteFlow — tiêu đề, nội dung, nút bấm và ô nhập liệu.">
        <div style={grid(4)}>
          {FONTS.map(f => (
            <div
              key={f.label}
              className={`cd-font-card${fontFamily === f.font ? ' active' : ''}`}
              style={{ border: '2px solid var(--border)', borderRadius: 12, padding: '12px 8px', cursor: 'pointer', textAlign: 'center' }}
              onClick={() => updateCustomize({ fontFamily: f.font })}
            >
              <div style={{ fontFamily: f.preview, fontWeight: 700, fontSize: 20, marginBottom: 4 }}>Aa</div>
              <div style={{ fontFamily: f.preview, fontSize: 12, fontWeight: 600 }}>{f.label}</div>
              <div style={{ ...cardSub, fontFamily: f.preview }}>{f.note}</div>
            </div>
          ))}
        </div>
        <div className="cd-settings-row" style={{ marginTop: 6, borderBottom: 'none', paddingBottom: 0 }}>
          <RowText title="Font khác" desc={`Chọn trong ${FONT_CATALOG.length} font có hỗ trợ tiếng Việt — tìm theo tên, ghim font hay dùng`} />
          <button className={`cd-sidebar-pos-btn${fontPickerOpen ? ' active' : ''}`} onClick={() => setFontPickerOpen(o => !o)}>{fontPickerOpen ? 'Đóng danh sách' : 'Mở danh sách font'}</button>
        </div>
        {fontPickerOpen ? <FontPicker value={fontFamily} pins={fontPins} recent={fontRecent} onPick={pickFont} onTogglePin={togglePin} /> : null}
        <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 10, border: '1px dashed var(--border)', fontFamily: currentFont.preview }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Xem thử — {currentFont.label}</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Công trình Riverside — Giai đoạn 2</div>
          <div style={{ fontSize: 13 }}>Tổng giá trị hợp đồng 1.250.000.000 đ · tiến độ 62% · hạn bàn giao 09/11/2026</div>
          {currentFont.missing ? (
            <div style={{ fontSize: 11.5, color: 'var(--finance)', marginTop: 6 }}>
              Máy hoặc trình duyệt này chưa có {currentFont.label} (có sẵn trên {pickedFont.src}) nên đang hiển thị bằng font thay thế. Trên máy có sẵn font này, SiteFlow sẽ hiện đúng.
            </div>
          ) : null}
        </div>
        <div className="cd-settings-row" style={{ marginTop: 6, paddingBottom: 0 }}>
          <RowText title="Số liệu dùng font đơn cách" desc="Tắt: số tiền, mã, ngày dùng chung font của app. Bật: dùng font kiểu máy đánh chữ như trước đây" />
          <ToggleSwitch on={monoNumbers} onClick={() => updateCustomize({ monoNumbers: !monoNumbers })} />
        </div>
      </Section>

      <Section title="Kích thước chuẩn" desc="Một tiêu chuẩn kích thước cho tất cả các tab (QS, Mua hàng, Kinh doanh, HR…): khung, nút, chữ, khoảng cách cùng phóng / thu theo một tỉ lệ để các trang hiện giống nhau.">
        <div style={grid(4)}>
          {UI_SCALES.map(s => (
            <div key={s.pct} className={`cd-fontsize-card${uiScale === s.pct ? ' active' : ''}`}
              style={{ ...pickCard, textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', minHeight: 92 }}
              onClick={() => updateCustomize({ uiScale: s.pct === 100 ? undefined : s.pct })}>
              <div style={{ margin: '0 auto 8px', width: s.box, height: s.box * 0.62, borderRadius: 4, border: '2px solid currentColor', opacity: .55 }} />
              <div style={cardLabel}>{s.label} · {s.pct}%</div>
              <div style={cardSub}>{s.note}</div>
            </div>
          ))}
        </div>
        <div className="cd-settings-row" style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingBottom: 0 }}>
          <RowText title="Tự chỉnh kích thước" desc={`Kéo để chọn mức bất kỳ từ ${UI_SCALE_MIN}% đến ${UI_SCALE_MAX}% — áp ngay cho mọi tab, lưu trên máy này`} />
          <div className="cd-range">
            <button type="button" className="cd-step-btn" title="Nhỏ hơn" disabled={uiScale <= UI_SCALE_MIN} onClick={() => setUiScale(uiScale - 5)}>−</button>
            <input type="range" min={UI_SCALE_MIN} max={UI_SCALE_MAX} step="1" value={uiScale} title="Kích thước chuẩn" onChange={e => setUiScale(e.target.value)} />
            <button type="button" className="cd-step-btn" title="Lớn hơn" disabled={uiScale >= UI_SCALE_MAX} onClick={() => setUiScale(uiScale + 5)}>+</button>
            <span className="cd-range-value">{uiScale}%</span>
          </div>
        </div>
      </Section>

      <Section title="Cỡ chữ" desc="Chỉ đổi độ lớn của chữ trên toàn bộ SiteFlow — khung, nút, biểu tượng và khoảng cách giữ nguyên kích thước.">
        <div style={grid(4)}>
          {FONT_SIZES.map(s => (
            <div
              key={s.key}
              className={`cd-fontsize-card${fontSize === s.key ? ' active' : ''}`}
              style={{ ...pickCard, textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', minHeight: 92 }}
              onClick={() => updateCustomize({ fontSize: s.key, fontScale: undefined })}
            >
              <div style={{ fontWeight: 700, fontSize: s.previewSize, marginBottom: 6, lineHeight: 1 }}>Aa</div>
              <div style={cardLabel}>{s.label}</div>
              <div style={cardSub}>{s.note}</div>
            </div>
          ))}
        </div>
        <div className="cd-settings-row" style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingBottom: 0 }}>
          <RowText title="Tự chỉnh cỡ chữ" desc={`Kéo để chọn mức bất kỳ từ ${FONT_SCALE_MIN}% đến ${FONT_SCALE_MAX}%`} />
          <div className="cd-range">
            <button type="button" className="cd-step-btn" title="Nhỏ hơn" disabled={fontPct <= FONT_SCALE_MIN} onClick={() => applyScale(fontPct - 2)}>−</button>
            <input
              type="range" min={FONT_SCALE_MIN} max={FONT_SCALE_MAX} step="1" value={fontPct} title="Cỡ chữ"
              onChange={e => applyScale(e.target.value)}
            />
            <button type="button" className="cd-step-btn" title="Lớn hơn" disabled={fontPct >= FONT_SCALE_MAX} onClick={() => applyScale(fontPct + 2)}>+</button>
            <span className="cd-range-value">{fontPct}%</span>
          </div>
        </div>
      </Section>

      <Section title="Mật độ hiển thị" desc="Thu nhỏ khoảng cách & cỡ chữ để xem được nhiều nội dung hơn trên màn hình. Kết hợp được với Cỡ chữ.">
        <div style={grid(2)}>
          <div className={`cd-density-card${density !== 'compact' ? ' active' : ''}`} style={pickCard} onClick={() => updateCustomize({ density: 'comfortable' })}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              {[0, 1, 2].map(i => <div key={i} style={{ height: 8, borderRadius: 3, background: 'var(--surface-alt)' }} />)}
            </div>
            <div style={cardLabel}>Thoải mái</div>
          </div>
          <div className={`cd-density-card${density === 'compact' ? ' active' : ''}`} style={pickCard} onClick={() => updateCustomize({ density: 'compact' })}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
              {[0, 1, 2, 3, 4].map(i => <div key={i} style={{ height: 5, borderRadius: 2, background: 'var(--surface-alt)' }} />)}
            </div>
            <div style={cardLabel}>Gọn (Compact)</div>
          </div>
        </div>
      </Section>

      <Section title="Hiệu ứng" titleMb={14}>
        <div className="cd-settings-row">
          <RowText title="Hiệu ứng chuyển động" desc="Chuyển cảnh, trượt menu, nền động của Super Liquid Glass. Tắt nếu máy chậm hoặc bạn thấy rối mắt" />
          <ToggleSwitch on={motionOn} onClick={() => updateCustomize({ motion: motionOn ? 'off' : 'on' })} />
        </div>
      </Section>

      <Section title="Sidebar" titleMb={14}>
        <div className="cd-settings-row">
          <RowText title="Vị trí sidebar" desc="Đặt thanh điều hướng bên trái hoặc bên phải màn hình" />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={`cd-sidebar-pos-btn${sidebarPos !== 'right' ? ' active' : ''}`} onClick={() => updateCustomize({ sidebarPos: 'left' })}>Trái</button>
            <button className={`cd-sidebar-pos-btn${sidebarPos === 'right' ? ' active' : ''}`} onClick={() => updateCustomize({ sidebarPos: 'right' })}>Phải</button>
          </div>
        </div>
        <div className="cd-settings-row">
          <RowText title="Thu gọn menu mặc định" desc="Chỉ hiện biểu tượng, ẩn tên mục" />
          <ToggleSwitch on={sidebarCollapsed} onClick={toggleSidebarDefault} />
        </div>
      </Section>

      <Section title="Khôi phục" titleMb={14}>
        <div className="cd-settings-row">
          <RowText title="Đưa giao diện về mặc định" desc="Chế độ theo hệ thống, bộ giao diện Mặc định, không dùng nền hệ thống, màu xanh dương, font Montserrat, cỡ chữ Vừa" />
          <button className="cd-sidebar-pos-btn" onClick={resetAll}>Khôi phục mặc định</button>
        </div>
      </Section>
    </>
  )
}
