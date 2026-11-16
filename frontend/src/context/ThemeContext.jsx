import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { loadAppFont } from '../data/fontCatalog'
import { sysSection, useSysDefaults } from '../services/systemDefaultsService'

const ThemeContext = createContext(null)

/* Giới hạn cỡ chữ tự chỉnh (phần trăm) */
/* (index.html lặp lại hai số này trong đoạn script chạy trước khi vẽ trang) */
export const FONT_SCALE_MIN = 10
export const FONT_SCALE_MAX = 130
/* Kích thước chuẩn của cả giao diện (phần trăm, Cài đặt ▸ Giao diện): mọi trang cùng một tỉ lệ (index.html lặp lại 2 số này) */
export const UI_SCALE_MIN = 70
export const UI_SCALE_MAX = 120
export const uiScaleOf = c => Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(Number(c && c.uiScale) || 100)))

function systemPrefersDark() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches } catch { return false }
}

const MODES = ['light', 'dark', 'system']
/* Lựa chọn RIÊNG của người dùng (null = chưa tự chọn -> theo mặc định hệ thống của Siêu quản trị viên, N17).
   Cờ "-own" ghi khi người dùng tự chọn; bản cũ không có cờ: giá trị khác mặc định gốc ('system' / 'default') coi là tự chọn. */
function readOwn(key, flag, base) {
  try {
    const v = localStorage.getItem(key)
    return v && (localStorage.getItem(flag) === '1' || v !== base) ? v : null
  } catch { return null }
}
function writeOwn(key, flag, v) {
  try {
    if (v) { localStorage.setItem(key, v); localStorage.setItem(flag, '1') } else { localStorage.removeItem(key); localStorage.removeItem(flag) }
  } catch { /* bỏ qua */ }
}
const PERSONAL = ['fontPins', 'fontRecent']   // danh sách cá nhân, không thuộc mặc định hệ thống

export function ThemeProvider({ children }) {
  const sysA = sysSection('appearance', useSysDefaults()) || {}

  /* Chế độ: 'light' | 'dark' | 'system' (theo hệ điều hành). Hiệu lực = người dùng tự chọn > mặc định hệ thống > 'system' */
  const [ownMode, setOwnMode] = useState(() => readOwn('siteflow-theme-mode', 'siteflow-theme-own', 'system'))
  const themeMode = ownMode || (MODES.includes(sysA.themeMode) ? sysA.themeMode : 'system')
  const setThemeMode = m => setOwnMode(MODES.includes(m) ? m : null)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  /* own = chỉ các khoá người dùng tự chỉnh; customize hiệu lực = mặc định hệ thống + phần tự chỉnh */
  const [own, setOwn] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('siteflow-customize') || '{}')
    } catch { return {} }
  })
  const sysC = sysA.customize && typeof sysA.customize === 'object' ? sysA.customize : null
  const customize = useMemo(() => (sysC ? { ...sysC, ...own } : own), [sysC, own])

  const [ownUi, setOwnUi] = useState(() => readOwn('siteflow-ui-theme', 'siteflow-ui-theme-own', 'default'))
  const uiTheme = ownUi || (typeof sysA.uiTheme === 'string' && sysA.uiTheme) || 'default'
  const setUiTheme = v => setOwnUi(v || null)

  /* Giao diện thực tế đang áp dụng (các trang chỉ cần biết sáng hay tối) */
  const theme = themeMode === 'system' ? (systemDark ? 'dark' : 'light') : themeMode

  /* Đang ở chế độ "theo hệ thống" thì đổi theo ngay khi hệ điều hành đổi sáng/tối */
  useEffect(() => {
    let mq
    try { mq = window.matchMedia('(prefers-color-scheme: dark)') } catch { return undefined }
    const onChange = e => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('siteflow-theme', theme) } catch {}
  }, [theme])
  useEffect(() => { writeOwn('siteflow-theme-mode', 'siteflow-theme-own', ownMode) }, [ownMode])
  useEffect(() => { writeOwn('siteflow-ui-theme', 'siteflow-ui-theme-own', ownUi) }, [ownUi])

  useEffect(() => {
    const c = customize
    const root = document.documentElement
    root.setAttribute('data-accent', c.accent || 'blue')
    root.setAttribute('data-density', c.density || 'comfortable')
    /* Tỉ lệ zoom của cả app = kích thước chuẩn x mật độ (Gọn = 0,88); global.css đọc --z-app */
    const zApp = Math.round(uiScaleOf(c) / 100 * (c.density === 'compact' ? 0.88 : 1) * 1000) / 1000
    root.style.setProperty('--z-app', String(zApp))
    root.setAttribute('data-zoomed', zApp === 1 ? 'off' : 'on')
    root.setAttribute('data-sidebar-pos', c.sidebarPos || 'left')
    /* Cỡ chữ tự chỉnh (fontSize = 'custom'): fontScale là phần trăm, gán thẳng vào --fs-user (mức cỡ chữ người dùng chọn) */
    const scale = c.fontSize === 'custom' ? Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Number(c.fontScale) || 100)) : null
    root.setAttribute('data-fontsize', scale ? 'custom' : (c.fontSize || 'medium'))
    if (scale) root.style.setProperty('--fs-user', String(scale / 100))
    else root.style.removeProperty('--fs-user')
    /* Nền hệ thống + độ đậm của nền (global: liquid-glass.css đọc data-wallpaper và --wp-strength) */
    root.setAttribute('data-wallpaper', c.wallpaper || 'none')
    if (c.wallpaperStrength) root.style.setProperty('--wp-strength', String(c.wallpaperStrength / 100))
    else root.style.removeProperty('--wp-strength')
    root.setAttribute('data-motion', c.motion === 'off' ? 'off' : 'on')
    root.setAttribute('data-mono', c.monoNumbers ? 'on' : 'off')
    root.setAttribute('data-glass', c.glassLevel || 'medium')
    if (c.fontFamily) root.style.setProperty('--app-font', c.fontFamily)
    else root.style.removeProperty('--app-font')
    loadAppFont(c.fontFamily)
    /* Màu chủ đạo tự chọn (data-accent="custom") — global.css đọc biến này */
    if (c.accent === 'custom' && c.accentCustom) root.style.setProperty('--custom-accent', c.accentCustom)
    else root.style.removeProperty('--custom-accent')
  }, [customize])
  useEffect(() => { try { localStorage.setItem('siteflow-customize', JSON.stringify(own)) } catch {} }, [own])

  useEffect(() => {
    document.documentElement.setAttribute('data-ui-theme', uiTheme)
  }, [uiTheme])

  function toggleTheme() {
    setThemeMode(theme === 'dark' ? 'light' : 'dark')
  }

  function updateCustomize(patch) {
    setOwn(prev => ({ ...prev, ...patch }))
  }

  /* Đưa toàn bộ tuỳ chỉnh giao diện về mặc định (= mặc định hệ thống nếu Siêu quản trị viên đã đặt) */
  function resetAppearance() {
    setOwnMode(null)
    setOwnUi(null)
    /* Font đã ghim / dùng gần đây là danh sách cá nhân, không phải tuỳ chỉnh hiển thị nên giữ lại */
    setOwn(prev => ({
      ...(prev.fontPins ? { fontPins: prev.fontPins } : {}),
      ...(prev.fontRecent ? { fontRecent: prev.fontRecent } : {}),
    }))
  }

  /* Giao diện đang hiệu lực, dạng lưu làm mặc định hệ thống (Siêu quản trị viên) */
  function appearanceSnapshot() {
    const c = {}
    Object.keys(customize).forEach(k => { if (!PERSONAL.includes(k) && customize[k] !== undefined) c[k] = customize[k] })
    return { themeMode, uiTheme, customize: c }
  }

  return (
    <ThemeContext.Provider value={{ theme, themeMode, setThemeMode, toggleTheme, customize, updateCustomize, uiTheme, setUiTheme, resetAppearance, appearanceSnapshot }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useThemeContext() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useThemeContext must be used inside ThemeProvider')
  return ctx
}
