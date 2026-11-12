import { useState } from 'react'
import './BIM.css'
import { useTheme } from '../../hooks/useTheme'
import { BIM_STORAGE, INITIAL_PROJECTS, INITIAL_LEVELS, INITIAL_MATERIALS, answerTopic } from '../../data/bimData'
import { Icon } from './components/shared'
import UnlinkedView from './components/UnlinkedView'
import ProjectListView from './components/ProjectListView'
import LinkedView from './components/LinkedView'
import Dezbot, { loadAiPanelWidth } from './components/Dezbot'
import DeptStaff from '../../components/hr/DeptStaff'
import { BIM_TABS } from '../../data/pageTabs'
import { usePageTabsHidden, useTabFallback } from '../../hooks/usePageTabs'

const DEFAULT_SUBTITLE = 'Không gian dữ liệu BIM liên kết SketchUp'

function readStorage(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeStorage(key, value) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value) } catch { /* bỏ qua */ }
}

/* Màn hình ban đầu theo trạng thái liên kết đã lưu (giống IIFE khởi tạo của bản HTML) */
function initialView() {
  if (readStorage(BIM_STORAGE.linked) !== '1') return { view: 'unlinked', project: null }
  const saved = readStorage(BIM_STORAGE.project)
  return saved ? { view: 'linked', project: saved } : { view: 'list', project: null }
}

const UNLINK_CONFIRM = 'Ngắt liên kết với Dezon Bim? Dữ liệu BIM đã đồng bộ sẽ được giữ lại, chỉ ngắt kết nối realtime.'

export default function BIM() {
  const { theme, toggleTheme } = useTheme()
  const [{ view, project: projectCode }, setNav] = useState(initialView)
  const [projects, setProjects] = useState(INITIAL_PROJECTS)
  const [levels, setLevels] = useState(INITIAL_LEVELS)
  const [materials, setMaterials] = useState(INITIAL_MATERIALS)

  const [aiOpen, setAiOpen] = useState(false)
  const [aiWidth, setAiWidth] = useState(loadAiPanelWidth)
  const [aiResizing, setAiResizing] = useState(false)
  const [pageTab, setPageTab] = useState('main') // main | nhansu
  // tab ẩn ở Cài đặt > Hiển thị; tab đang mở bị ẩn thì sang tab hiện đầu tiên
  const tabHidden = usePageTabsHidden('/bim')
  useTabFallback(tabHidden, pageTab, BIM_TABS.map(t => t.key), setPageTab)

  const project = projects.find(p => p.code === projectCode) || null
  const subtitle = view === 'linked' && project ? `${project.name} · ${DEFAULT_SUBTITLE}` : DEFAULT_SUBTITLE

  /* ---------- Điều hướng giữa 3 màn hình ---------- */
  function showList() {
    writeStorage(BIM_STORAGE.linked, '1')
    setNav({ view: 'list', project: null })
  }
  function openProject(code) {
    writeStorage(BIM_STORAGE.project, code)
    setNav({ view: 'linked', project: code })
  }
  function backToList() {
    writeStorage(BIM_STORAGE.project, null)
    setNav({ view: 'list', project: null })
  }
  function unlink() {
    if (!confirm(UNLINK_CONFIRM)) return
    writeStorage(BIM_STORAGE.linked, null)
    writeStorage(BIM_STORAGE.project, null)
    setNav({ view: 'unlinked', project: null })
  }

  /* ---------- Thêm liên kết file SketchUp ---------- */
  function addFileLink(form) {
    const fileName = form.fileName.trim()
    if (form.project === '__new__') {
      const name = form.newName.trim()
      const code = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3) || 'NEW'
      setProjects(prev => [{
        code, name,
        projectCode: form.newCode.trim() || `MOA-26-${code}`,
        client: form.newClient.trim() || '— Chưa cập nhật —',
        models: 1, objects: 0, pct: 0, primaryFile: fileName, guid: '—', lastSync: 'Chưa đồng bộ',
      }, ...prev])
    } else {
      setProjects(prev => prev.map(p => p.code === form.project ? { ...p, models: p.models + 1 } : p))
    }
  }

  /* ---------- Level & Material (Dezbot đọc trực tiếp dữ liệu này) ---------- */
  function createLevel() {
    setLevels(prev => {
      const last = prev[prev.length - 1]
      return [...prev, { code: 'L0' + prev.length, name: 'Tầng mới', elevation: last.elevation + last.height, height: 3.0, status: 'recorded' }]
    })
  }
  function toggleMaterial(idx, checked) {
    setMaterials(prev => prev.map((m, i) => i === idx ? { ...m, checked } : m))
  }
  function assignMaterials() {
    setMaterials(prev => prev.map(m => m.checked ? { ...m, status: 'linked', checked: false } : m))
  }

  return (
    <div
      className={`bim-page${aiOpen ? ' bim-ai-open' : ''}${aiResizing ? ' bim-ai-resizing' : ''}`}
      style={{ '--ai-panel-width': `${aiWidth}px` }}
    >
      <div className="bim-header">
        <div className="bim-header-icon"><Icon name="cube" size={16} /></div>
        <span style={{ fontSize: 14.5, fontWeight: 700 }}>BIM</span>
        <div className="hdr-tabs" role="tablist">
          {BIM_TABS.filter(t => tabHidden.indexOf(t.key) < 0).map(t => (
            <button key={t.key} className={`hdr-tab${pageTab === t.key ? ' active' : ''}`} onClick={() => setPageTab(t.key)}>{t.label}</button>
          ))}
        </div>
        <button className="bim-theme-toggle" title="Chuyển giao diện sáng/tối" onClick={toggleTheme}>
          {theme === 'dark'
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>}
        </button>
      </div>

      {/* Cả 3 màn hình luôn được mount (ẩn bằng display) để giữ dữ liệu đã thao tác, giống bản HTML */}
      <div className="bim-scroll" style={pageTab === 'nhansu' ? { display: 'none' } : undefined}>
        <UnlinkedView visible={view === 'unlinked'} onLinked={showList} />
        <ProjectListView visible={view === 'list'} projects={projects} onOpen={openProject} onUnlink={unlink} onAddFileLink={addFileLink} />
        <LinkedView
          visible={view === 'linked'}
          project={project}
          onBack={backToList}
          onUnlink={unlink}
          levels={levels}
          onCreateLevel={createLevel}
          materials={materials}
          onToggleMaterial={toggleMaterial}
          onAssignMaterials={assignMaterials}
        />
      </div>

      {pageTab === 'nhansu' && (
        <div className="bim-scroll">
          <DeptStaff units={['thietke']} note="Mô hình BIM do phòng Thiết kế thực hiện — nhân sự lấy theo phòng Thiết kế trong HR" />
        </div>
      )}

      <Dezbot
        open={aiOpen}
        onToggle={() => setAiOpen(o => !o)}
        onClose={() => setAiOpen(false)}
        onResize={setAiWidth}
        onResizingChange={setAiResizing}
        answer={topic => answerTopic(topic, { levels, materials })}
      />
    </div>
  )
}
