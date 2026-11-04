import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { DEPTS, deptOf, UNIT_TYPE_LABEL, LEVELS, LEVEL_TONE, companyOf, isBlockLevel, PARENT_COMPANY, isStandaloneCo, motherRoots, MOTHER_KEY, parentLabel, HOLDING, HOLDING_KEY, isHoldingCo } from '../../../data/hrData'
import AddUnitModal from './AddUnitModal'
import { Avatar, Seg, Modal, Field, Empty, Pill, RoleTag } from './shared'
import { useAccess } from './access'

const TONES = ['qs', 'primary', 'attendance', 'finance', 'sales', 'marketing', 'danger', 'success', 'muted']

/* Các chức danh kiêm nhiệm của 1 nhân sự: [{ unit, title, pct }] */
function concurrentRoles(units, extraMembers, empId) {
  return units.filter(u => (extraMembers[u.key] || []).some(m => m.id === empId))
    .map(u => ({ unit: u, ...extraMembers[u.key].find(m => m.id === empId) }))
}
const rolesTitle = list => list.map(c => `Kiêm nhiệm: ${c.title} · ${c.unit.name} · ${c.pct}%`).join('\n')

/* Kéo nền để di chuyển sơ đồ */
function usePan(ref) {
  return function onDown(e) {
    if (e.button !== 0 || e.target.closest('button')) return
    const el = ref.current
    const st = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop }
    el.classList.add('panning')
    const move = ev => { el.scrollLeft = st.l - (ev.clientX - st.x); el.scrollTop = st.t - (ev.clientY - st.y) }
    const up = () => { el.classList.remove('panning'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }
}

/* Các ban có thể thành lập trong 1 công ty / khối (hoặc tự đặt tên) */
const BOARD_PRESETS = [
  { kind: 'bod', label: 'BOD', name: 'Ban Giám đốc (BOD)', desc: 'Ban Giám đốc — họp điều hành định kỳ' },
  { kind: 'bks', label: 'Ban kiểm soát', name: 'Ban kiểm soát', desc: 'Kiểm soát tài chính, tuân thủ & rủi ro', fromParent: true },
  { kind: 'bcl', label: 'Ban chiến lược', name: 'Ban chiến lược', desc: 'Hoạch định chiến lược & đầu tư', fromParent: true },
  { kind: 'hdtv', label: 'Hội đồng thành viên', name: 'Hội đồng thành viên', desc: 'Cơ quan quyết định cao nhất của công ty TNHH' },
  { kind: 'custom', label: '', name: '', desc: '' },
]
const STANDALONE = '__standalone' // vùng thả: tách công ty con khỏi công ty mẹ
function ZoomCtl({ zoom, setZoom }) {
  return (
    <div className="cc-seg icon">
      <button title="Thu nhỏ" onClick={() => setZoom(z => Math.max(0.3, +(z - 0.1).toFixed(1)))}><Icon name="zoomOut" size={14} /></button>
      <button className="cc-zoom-label" onClick={() => setZoom(1)} title="Về 100%">{Math.round(zoom * 100)}%</button>
      <button title="Phóng to" onClick={() => setZoom(z => Math.min(1.5, +(z + 0.1).toFixed(1)))}><Icon name="zoomIn" size={14} /></button>
    </div>
  )
}

/* ================= Cơ cấu phòng ban (theo sơ đồ tổ chức công ty) ================= */
function UnitsView({ company, setCompany, employees, units, heads, extraMembers, onSaveUnit, onDeleteUnit, onAssign, onRemoveExtra, onUpdateExtra, onCommitExtra, onMoveUnit, onCreateUnit, onOpen }) {
  const [addOpen, setAddOpen] = useState(false)
  /* Chế độ chỉnh sửa cơ cấu: kéo 1 đơn vị thả vào đơn vị khác để đổi cấp quản lý */
  const [arrange, setArrange] = useState(false)
  const [dragKey, setDragKey] = useState(null)
  const [overKey, setOverKey] = useState(null)
  const [history, setHistory] = useState([]) // [{ key, from, to }] để hoàn tác
  const { can } = useAccess()
  const [zoom, setZoom] = useState(1)
  const [sel, setSel] = useState(null) // đơn vị đang xem chi tiết — bảng bên phải chỉ hiện khi bấm vào 1 đơn vị
  const [focus, setFocus] = useState('') // lọc: chỉ xem sơ đồ của 1 đơn vị
  const [form, setForm] = useState(null)
  const [picker, setPicker] = useState(null) // { q, ids:Set }
  const [boardForm, setBoardForm] = useState(null) // thành lập ban: { kind, label, name, desc, fromParent }
  const [addMenu, setAddMenu] = useState(null) // nút "+" trên sơ đồ (chế độ chỉnh sửa): key đơn vị đang mở menu
  const [addParent, setAddParent] = useState(null) // cấp trên mặc định khi thêm bộ phận từ nút "+"
  const wrapRef = useRef(null)
  const orgRef = useRef(null)
  const onDown = usePan(wrapRef)
  const editable = can('employees', 'edit')
  // Thu phóng vừa khung: so độ rộng thật của cây (ở 100%) với khung hiển thị
  const fit = () => {
    const w = wrapRef.current, o = orgRef.current
    if (!w || !o) return
    // Độ rộng thật của cây ở 100% = độ rộng đang hiển thị / mức zoom hiện tại (+ lề trái/phải 48px)
    const z = parseFloat(o.style.zoom) || 1
    // Đo độ rộng thật của cây = tổng độ rộng các nút gốc (ul có thể rộng bằng khung nên không dùng được)
    const forest = o.querySelector(':scope > .cc-org-forest')
    const roots = o.querySelectorAll(':scope > ul > li')
    const natural = (forest ? forest.getBoundingClientRect().width : [...roots].reduce((w, li) => w + li.getBoundingClientRect().width, 0)) / z + 48
    setZoom(Math.max(0.35, Math.min(1, Math.floor((w.clientWidth - 8) / natural * 100) / 100)))
  }
  useEffect(() => { requestAnimationFrame(fit) }, [focus, company]) // eslint-disable-line react-hooks/exhaustive-deps

  const current = employees.filter(e => e.status !== 'left')
  const empOf = id => employees.find(e => e.id === id)
  /* company: 'all' = toàn tập đoàn · 'root' = chỉ công ty mẹ · key = 1 công ty con / thành viên.
     Xem 1 công ty → chỉ vẽ đơn vị thuộc pháp nhân đó (công ty con nằm ở trang Tập đoàn / chế độ ALL) */
  const allMode = company === 'all'
  const inScope = u => allMode || companyOf(units, u.key) === company
  const kids = key => units.filter(u => u.parent === key && u.type !== 'board' && inScope(u))
  const boards = key => units.filter(u => u.parent === key && u.type === 'board' && inScope(u))
  const unitOf = key => units.find(u => u.key === key)
  // Phòng ban / khối: thành viên theo phòng ban trong hồ sơ · Ban & HĐQT: thành viên kiêm nhiệm gán riêng
  const isConcurrent = key => ['board', 'governance'].includes(unitOf(key)?.type)
  const extrasOf = key => (extraMembers[key] || []).map(m => empOf(m.id)).filter(e => e && e.status !== 'left')
  // Ban / HĐQT: chỉ thành viên kiêm nhiệm · Phòng ban / công ty con: nhân sự chính thức + người kiêm nhiệm (VD: quản lý kiêm nhiệm)
  const members = key => (isConcurrent(key) ? extrasOf(key) : [...current.filter(e => e.dept === key), ...extrasOf(key).filter(e => e.dept !== key)])
  const isConcRow = (key, e) => isConcurrent(key) || (e.dept !== key && !!(extraMembers[key] || []).some(m => m.id === e.id))
  const concOf = (key, id) => (extraMembers[key] || []).find(m => m.id === id)
  const subtreeKeys = key => [key, ...kids(key).flatMap(k => subtreeKeys(k.key))]
  const total = key => subtreeKeys(key).reduce((n, k) => n + members(k).length, 0)
  // Thả được vào: đơn vị không phải ban, không phải chính nó / đơn vị con của nó, khác cấp trên hiện tại
  const canDropOn = (from, to) => {
    if (!from || from === to) return false
    const f = units.find(x => x.key === from)
    // Công ty con: thả vào nút công ty mẹ (trực thuộc trực tiếp) hoặc vùng "độc lập" (tách khỏi công ty mẹ)
    if (to === MOTHER_KEY) return !!f && f.type === 'subsidiary' && f.parent !== MOTHER_KEY
    if (to === HOLDING_KEY) return !!f && f.type === 'subsidiary' && f.parent !== HOLDING_KEY
    if (to === STANDALONE) return !!f && f.type === 'subsidiary' && !!f.parent
    const t = units.find(x => x.key === to)
    if (!t || !f || t.type === 'board' || f.parent === to) return false
    const sub = []; const walk = k => { sub.push(k); units.filter(x => x.parent === k).forEach(x => walk(x.key)) }; walk(from)
    return !sub.includes(to)
  }
  function move(from, to) {
    const f = units.find(x => x.key === from)
    setHistory(h => [...h, { key: from, from: f.parent, to }])
    onMoveUnit(from, to === STANDALONE ? null : to)
  }
  function undo() {
    const last = history[history.length - 1]
    if (!last) return
    setHistory(h => h.slice(0, -1))
    onMoveUnit(last.key, last.from, true)
  }

  useEffect(() => {
    const el = wrapRef.current
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2
  }, [zoom])

  const Card = ({ u, small }) => {
    const head = empOf(heads[u.key])
    const n = members(u.key).length
    const canDrag = arrange && u.type !== 'governance'
    const valid = dragKey && canDropOn(dragKey, u.key)
    return (
      <button
        className={`cc-unit cc-tone-${u.tone} type-${u.type}${sel === u.key ? ' active' : ''}${small ? ' small' : ''}${canDrag ? ' draggable' : ''}${dragKey === u.key ? ' dragging' : ''}${dragKey && valid ? ' can-drop' : ''}${overKey === u.key && valid ? ' over' : ''}${dragKey && !valid && dragKey !== u.key ? ' no-drop' : ''}`}
        onClick={() => !arrange && setSel(u.key)}
        draggable={canDrag}
        onDragStart={e => { if (!canDrag) return; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', u.key); setDragKey(u.key) }}
        onDragEnd={() => { setDragKey(null); setOverKey(null) }}
        onDragOver={e => { if (dragKey && canDropOn(dragKey, u.key)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverKey(u.key) } }}
        onDragLeave={() => setOverKey(k => (k === u.key ? null : k))}
        onDrop={e => { e.preventDefault(); if (dragKey && canDropOn(dragKey, u.key)) move(dragKey, u.key); setDragKey(null); setOverKey(null) }}
        title={canDrag ? 'Kéo thả vào đơn vị khác để đổi cấp quản lý' : undefined}
      >
        {canDrag && <span className="cc-unit-grip" aria-hidden="true">⠿</span>}
        {u.type === 'subsidiary' && <span className="cc-unit-kicker"><Icon name="building" size={10} />{isStandaloneCo(u) ? 'Độc lập' : isHoldingCo(u) ? 'Công ty thành viên' : 'Công ty con'}</span>}
        <b>{u.label}</b>
        {u.appointedFromParent && !small && <span className="cc-unit-kicker mother">Bổ nhiệm từ công ty mẹ</span>}
        {!small && head && <span className="cc-unit-head"><Avatar emp={head} size={18} />{head.name}</span>}
        {!small && u.type !== 'governance' && <span className="cc-unit-count">{isBlockLevel(u) ? `${total(u.key)} nhân sự` : `${n} nhân sự`}</span>}
        {small && u.appointedFromParent && <span className="cc-unit-mother" title="Thành viên bổ nhiệm từ công ty mẹ">⇡ mẹ</span>}
      </button>
    )
  }
  /* drop: phòng ban trực thuộc trực tiếp một cấp có cả khối điều hành (VD: KD dân dụng, Marketing, R&D dưới CEO)
     được hạ xuống cùng hàng với các phòng ban của COO/CCO — giống sơ đồ gốc */
  const render = (u, drop) => {
    const ch = kids(u.key)
    const side = boards(u.key)
    const hasExec = ch.some(isBlockLevel)
    return (
      <li key={u.key} className={drop ? 'drop' : undefined}>
        <div className={`cc-unit-row${side.length ? ' has-side' : ''}`}>
          {Card({ u })}
          {arrange && editable && addNode(u)}
          {side.length > 0 && (
            <div className="cc-unit-side">{side.map(b => <div key={b.key} className="cc-unit-side-item">{Card({ u: b, small: true })}</div>)}</div>
          )}
        </div>
        {ch.length > 0 && <ul>{ch.map(c => render(c, hasExec && !isBlockLevel(c)))}</ul>}
      </li>
    )
  }

  const focusUnit = focus ? unitOf(focus) : null
  const companyUnit = company !== 'root' && company !== 'all' ? unitOf(company) : null
  const roots = focusUnit ? [focusUnit] : companyUnit ? [companyUnit] : motherRoots(units).filter(inScope)
  const subs = units.filter(u => u.type === 'subsidiary')
  const standalone = subs.filter(isStandaloneCo)
  const holdingCos = subs.filter(isHoldingCo)
  const decoxCos = subs.filter(s => !isStandaloneCo(s) && !isHoldingCo(s))
  const switchCompany = key => { setCompany(key); setFocus(''); setSel(null) }
  const dropProps = key => ({
    onDragOver: e => { if (dragKey && canDropOn(dragKey, key)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverKey(key) } },
    onDragLeave: () => setOverKey(k => (k === key ? null : k)),
    onDrop: e => { e.preventDefault(); if (dragKey && canDropOn(dragKey, key)) move(dragKey, key); setDragKey(null); setOverKey(null) },
  })
  // Đơn vị thuộc công ty đang xem (công ty mẹ: bỏ các công ty thành viên độc lập & đơn vị bên trong)
  const coOf = u => companyOf(units, u.key)
  const inCompany = u => (allMode ? !standalone.some(s => s.key === coOf(u)) : inScope(u))
  const coStaff = key => current.filter(e => companyOf(units, e.dept) === key).length
  // Lọc tới 1 phòng ban không có đơn vị con → vẽ sơ đồ nhân sự riêng của phòng (trưởng phòng → các cấp)
  const deptPeopleMode = focusUnit && kids(focusUnit.key).length === 0
  const renderPerson = (e, inDept, seen = new Set()) => {
    seen.add(e.id)
    const sub = inDept.filter(x => x.managerId === e.id && !seen.has(x.id))
    return (
      <li key={e.id}>
        <div className={`cc-org-node cc-tone-${focusUnit.tone}`}>
          <button className="cc-org-card" onClick={() => onOpen(e.id)} title="Xem hồ sơ">
            <Avatar emp={e} size={36} />
            <span className="cc-org-text"><b>{e.name}</b><span>{e.position}</span><em>{heads[focusUnit.key] === e.id ? 'Trưởng đơn vị' : focusUnit.label}</em></span>
          </button>
        </div>
        {sub.length > 0 && <ul>{sub.map(x => renderPerson(x, inDept, seen))}</ul>}
      </li>
    )
  }
  const deptTree = () => {
    const inDept = members(focusUnit.key)
    const ids = new Set(inDept.map(e => e.id))
    // Gốc = người không có quản lý trong đơn vị; nếu dữ liệu bị vòng thì lấy trưởng đơn vị làm gốc
    let top = inDept.filter(e => !ids.has(e.managerId))
    if (!top.length && inDept.length) top = [inDept.find(e => e.id === heads[focusUnit.key]) || inDept[0]]
    const seen = new Set()
    const out = top.map(e => renderPerson(e, inDept, seen))
    // Người chưa được vẽ (do vòng) → gắn thêm ở hàng gốc
    inDept.filter(e => !seen.has(e.id)).forEach(e => out.push(renderPerson(e, inDept, seen)))
    return out.length ? out : null
  }
  const path = []
  for (let u = focusUnit; u; u = unitOf(u.parent)) path.unshift(u)
  const unit = units.find(u => u.key === sel)
  const parent = unit && units.find(u => u.key === unit.parent)
  const head = unit && empOf(heads[unit.key])
  const list = unit ? members(unit.key) : []

  const canHaveBoards = u => ['subsidiary', 'exec', 'governance'].includes(u.type)
  const linkedCo = u => u.type === 'subsidiary' && !isStandaloneCo(u)
  function openBoard(kind = 'bod', target = unit) {
    const p = BOARD_PRESETS.find(b => b.kind === kind)
    if (target && target.key !== sel) setSel(target.key)
    setBoardForm({ kind, label: p.label, name: p.name, desc: p.desc, fromParent: !!p.fromParent && linkedCo(target) })
  }
  // Nút "+" dưới mỗi thẻ: thêm bộ phận trực thuộc / thành lập ban cho chính đơn vị đó
  const addNode = u => (
    <div className="cc-add-node" onMouseDown={e => e.stopPropagation()}>
      <button type="button" className={`cc-add-btn${addMenu === u.key ? ' open' : ''}`} title={`Thêm vào ${u.label}`} onClick={() => setAddMenu(m => (m === u.key ? null : u.key))}><Icon name="plus" size={14} stroke={2.6} /></button>
      {addMenu === u.key && (
        <div className="cc-add-menu">
          <button type="button" onClick={() => { setAddMenu(null); setAddParent(u.key); setAddOpen(true) }}>
            <Icon name="sitemap" size={14} /><span><b>Thêm bộ phận</b><em>Phòng ban / công ty con trực thuộc {u.label}</em></span>
          </button>
          {canHaveBoards(u) && (
            <button type="button" onClick={() => { setAddMenu(null); openBoard('bod', u) }}>
              <Icon name="users" size={14} /><span><b>Thành lập ban</b><em>BOD, Ban kiểm soát, Ban chiến lược… cạnh {u.label}</em></span>
            </button>
          )}
        </div>
      )}
    </div>
  )
  function saveBoard() {
    const b = boardForm
    const label = b.label.trim()
    if (!label) return
    const slug = label.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10) || 'ban'
    let key = `${unit.key}_${slug}`
    for (let i = 2; units.some(u => u.key === key); i++) key = `${unit.key}_${slug}${i}`
    const full = b.name.trim() || label
    onSaveUnit({ key, label, name: unit.type === 'subsidiary' ? `${full} — ${unit.label}` : full, type: 'board', parent: unit.key, tone: 'qs', desc: b.desc.trim(), ...(b.fromParent ? { appointedFromParent: true } : {}) }, null, null)
    setBoardForm(null)
    setSel(key)
    setPicker({ q: '', ids: new Set() }) // bổ nhiệm thành viên ngay
  }

  function save() {
    const f = form
    const key = f.key || f.label.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12)
    if (!f.label.trim() || !key) return
    if (!f._orig && units.some(u => u.key === key)) { alert('Mã đơn vị đã tồn tại'); return }
    onSaveUnit({ ...f, key, name: f.name.trim() || f.label.trim(), label: f.label.trim() }, f._orig, f.headId ? Number(f.headId) : null)
    setSel(key)
    setForm(null)
  }
  // Không cho chọn chính nó / đơn vị con làm cấp trên (tránh vòng lặp)
  const blocked = form?._orig ? new Set(subtreeKeys(form._orig)) : new Set()

  return (
    <div className={`cc-units-layout${unit ? ' with-panel' : ''}`}>
      <div className="cc-stack cc-fill" style={{ minWidth: 0 }}>
        <div className="cc-card cc-pad cc-org-bar">
          <div>
            <h3 className="cc-h3" style={{ margin: 0 }}>{focusUnit ? `Sơ đồ tổ chức — ${focusUnit.name}` : companyUnit ? `Cơ cấu tổ chức — ${companyUnit.name}` : allMode ? `Toàn cảnh tập đoàn — ${HOLDING.name}` : `Cơ cấu tổ chức — ${PARENT_COMPANY.name}`}</h3>
            {focusUnit
              ? <div className="cc-crumbs"><button className="cc-link-btn" onClick={() => setFocus('')}>Toàn công ty</button>{path.map(u => <span key={u.key}> › {u.key === focus ? <b>{u.label}</b> : <button className="cc-link-btn" onClick={() => setFocus(u.key)}>{u.label}</button>}</span>)}<span className="cc-sub"> · {total(focusUnit.key)} nhân sự</span></div>
              : companyUnit ? <span className="cc-sub">{isStandaloneCo(companyUnit) ? 'Công ty thành viên độc lập' : `Trực thuộc ${parentLabel(units, companyUnit)}`} · {units.filter(u => u.key !== company && inCompany(u) && u.type !== 'board').length} đơn vị · {total(company)} nhân sự</span>
              : allMode ? <span className="cc-sub">1 công ty mẹ · {subs.length} công ty con / thành viên · {units.filter(u => u.type === 'dept').length} phòng ban · {current.length} nhân sự</span>
              : <span className="cc-sub">Công ty mẹ · {units.filter(u => u.type === 'dept' && inCompany(u)).length} phòng ban · {units.filter(u => u.type === 'exec' && inCompany(u)).length} khối điều hành · {coStaff('root')} nhân sự</span>}
          </div>
          <span className="cc-grow" />
          <label className="cc-filter-unit cc-company-pick" title="Chọn công ty"><Icon name="building" size={14} />
            <select value={company} onChange={e => switchCompany(e.target.value)} aria-label="Chọn công ty">
              <option value="all">Toàn tập đoàn {HOLDING.name} (ALL)</option>
              <option value="root">{PARENT_COMPANY.name} — công ty mẹ</option>
              {holdingCos.length > 0 && <optgroup label={`Công ty thành viên ${HOLDING.name}`}>{holdingCos.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}</optgroup>}
              {decoxCos.length > 0 && <optgroup label={`Công ty con của ${PARENT_COMPANY.name}`}>{decoxCos.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}</optgroup>}
              {standalone.length > 0 && <optgroup label="Độc lập (không trực thuộc tập đoàn)">{standalone.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}</optgroup>}
            </select>
          </label>
          {companyUnit && <button className="cc-btn ghost" onClick={() => switchCompany('root')}><Icon name="arrowLeft" size={14} />Về {PARENT_COMPANY.name}</button>}
          <label className="cc-filter-unit"><Icon name="search" size={14} />
            <select value={focus} onChange={e => { setFocus(e.target.value); setSel(e.target.value || null) }} aria-label="Lọc theo đơn vị">
              <option value="">Xem: toàn công ty</option>
              {companyUnit && <optgroup label={companyUnit.name}>{units.filter(u => u.key !== company && inCompany(u)).map(u => <option key={u.key} value={u.key}>{u.name}</option>)}</optgroup>}
              {!companyUnit && units.filter(u => u.type === 'exec').map(x => (
                <optgroup key={x.key} label={x.label}>
                  <option value={x.key}>{x.name} (cả khối)</option>
                  {units.filter(u => u.parent === x.key && u.type === 'dept').map(u => <option key={u.key} value={u.key}>{u.name}</option>)}
                </optgroup>
              ))}
              {!companyUnit && <optgroup label="Ban trực thuộc">{units.filter(u => (u.type === 'board' || u.type === 'governance') && inCompany(u)).map(u => <option key={u.key} value={u.key}>{u.name}</option>)}</optgroup>}
            </select>
          </label>
          <ZoomCtl zoom={zoom} setZoom={setZoom} />
          <button className="cc-btn ghost" onClick={fit}>Vừa khung</button>
          {editable && !focus && (arrange
            ? <>
              <button className="cc-btn" onClick={() => setAddOpen(true)}><Icon name="plus" size={14} stroke={2.4} />Thêm bộ phận</button>
              <button className="cc-btn ghost" disabled={!history.length} onClick={undo}><Icon name="rotate" size={14} />Hoàn tác{history.length ? ` (${history.length})` : ''}</button>
              <button className="cc-btn" onClick={() => { setArrange(false); setHistory([]); setAddMenu(null) }}><Icon name="check" size={14} stroke={2.6} />Xong</button>
            </>
            : <button className="cc-btn ghost" onClick={() => { setArrange(true); setSel(null) }}><Icon name="edit" size={14} />Chỉnh sửa cơ cấu</button>)}
          {editable && !arrange && <button className="cc-btn" onClick={() => setForm({ key: '', label: '', name: '', type: 'dept', parent: sel || 'ceo', tone: 'primary', desc: '', headId: '' })}><Icon name="plus" size={14} stroke={2.4} />Thêm đơn vị</button>}
        </div>
        {arrange && (
          <div className="cc-arrange-hint">
            <Icon name="sitemap" size={15} />
            <span><b>Đang chỉnh sửa cơ cấu</b> — kéo một phòng ban / khối và thả vào đơn vị quản lý mới (VD: kéo <i>Mua hàng</i> vào <i>CCO</i>). Trưởng đơn vị được chuyển sẽ báo cáo cho trưởng đơn vị mới. Bấm nút <b>+</b> dưới mỗi thẻ để thêm bộ phận hoặc thành lập ban.</span>
          </div>
        )}
        <div className={`cc-card cc-org-wrap${arrange ? ' arranging' : ''}`} ref={wrapRef} onMouseDown={e => { if (!arrange || !e.target.closest('.cc-unit')) onDown(e) }}>
          <div className="cc-org cc-org-units" style={{ zoom }} ref={orgRef}>
            {deptPeopleMode
              ? <ul>{deptTree() || <li><Empty icon="users" text="Đơn vị chưa có nhân sự — bấm vào đơn vị để thêm" /></li>}</ul>
              : (focusUnit || companyUnit)
                ? <ul>{roots.map(r => render(r))}</ul>
                : (() => {
                  const decoxLi = (
                    <li className="cc-co-root" key="__decox">
                      <div className="cc-unit-row">
                        <div className={`cc-unit cc-tone-primary type-exec cc-co-node${dragKey && canDropOn(dragKey, MOTHER_KEY) ? ' can-drop' : ''}${overKey === MOTHER_KEY ? ' over' : ''}`} title={PARENT_COMPANY.fullName} {...dropProps(MOTHER_KEY)}><span className="cc-unit-kicker"><Icon name="building" size={10} />Công ty mẹ</span><b>{PARENT_COMPANY.name}</b><span className="cc-unit-sub">{PARENT_COMPANY.fullName}</span><span className="cc-unit-count">{coStaff('root')} nhân sự</span></div>
                      </div>
                      {roots.length > 0 && <ul>{roots.map(r => render(r))}</ul>}
                    </li>
                  )
                  const motherTree = allMode
                    ? (
                      <ul>
                        <li className="cc-co-root">
                          <div className="cc-unit-row">
                            <div className={`cc-unit cc-tone-primary type-exec cc-co-node holding${dragKey && canDropOn(dragKey, HOLDING_KEY) ? ' can-drop' : ''}${overKey === HOLDING_KEY ? ' over' : ''}`} title={HOLDING.fullName} {...dropProps(HOLDING_KEY)}><span className="cc-unit-kicker"><Icon name="building" size={10} />Tập đoàn</span><b>{HOLDING.name}</b><span className="cc-unit-sub">{holdingCos.length + 1} công ty thành viên</span><span className="cc-unit-count">{current.filter(e => !standalone.some(c => c.key === companyOf(units, e.dept))).length} nhân sự</span></div>
                          </div>
                          <ul>{decoxLi}{holdingCos.map(s => render(s))}</ul>
                        </li>
                      </ul>
                    )
                    : <ul>{decoxLi}</ul>
                  return allMode && standalone.length > 0
                    ? (
                      <div className="cc-org-forest">
                        {motherTree}
                        <div className="cc-co-standalone-col">
                          <span className="cc-co-links-title">Độc lập — không trực thuộc {HOLDING.name}</span>
                          <ul>{standalone.map(s => render(s))}</ul>
                        </div>
                      </div>
                    )
                    : motherTree
                })()}
            {arrange && !focusUnit && !companyUnit && (
              <div className={`cc-co-standalone-drop${dragKey && canDropOn(dragKey, STANDALONE) ? ' can-drop' : ''}${overKey === STANDALONE ? ' over' : ''}`} {...dropProps(STANDALONE)}>
                <Icon name="building" size={15} />
                <span><b>Độc lập — không trực thuộc tập đoàn</b><em>Kéo công ty vào đây để tách khỏi {HOLDING.name} · kéo vào nút {PARENT_COMPANY.name}{allMode ? ` / ${HOLDING.name}` : ''} để trực thuộc</em></span>
              </div>
            )}
            {!focusUnit && company === 'root' && decoxCos.length > 0 && (
              <div className="cc-co-links">
                <span className="cc-co-links-title">Công ty con của {PARENT_COMPANY.name} — mỗi công ty có cơ cấu riêng</span>
                {decoxCos.map(s => (
                  <button key={s.key} className={`cc-co-link cc-tone-${s.tone}${dragKey === s.key ? ' dragging' : ''}`} onClick={() => !arrange && switchCompany(s.key)}
                    draggable={arrange} title={arrange ? `Kéo vào nút ${PARENT_COMPANY.name} hoặc một đơn vị để trực thuộc công ty mẹ` : undefined}
                    onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.key); setDragKey(s.key) }}
                    onDragEnd={() => { setDragKey(null); setOverKey(null) }}>
                    <Icon name="building" size={14} /><span><b>{s.label}</b><em>Công ty con · {coStaff(s.key)} nhân sự · xem cơ cấu</em></span><Icon name="arrowRight" size={14} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {unit && (
        <div className={`cc-card cc-pad cc-unit-panel cc-tone-${unit.tone}`}>
          <div className="cc-job-top">
            <span className="cc-ico"><Icon name={unit.type === 'dept' ? 'building' : 'sitemap'} size={15} /></span>
            <div className="cc-grow"><span className="cc-kicker">{isStandaloneCo(unit) ? 'Công ty độc lập' : isHoldingCo(unit) ? `Công ty thành viên ${HOLDING.name}` : UNIT_TYPE_LABEL[unit.type]}</span><b style={{ fontSize: 16 }}>{unit.name}</b></div>
            {editable && <button className="cc-icon-btn" title="Sửa đơn vị" onClick={() => setForm({ ...unit, _orig: unit.key, headId: heads[unit.key] || '' })}><Icon name="edit" size={15} /></button>}
            {editable && unit.type !== 'governance' && <button className="cc-icon-btn danger" title="Xoá đơn vị" onClick={() => onDeleteUnit(unit, isConcurrent(unit.key) ? 0 : members(unit.key).length, kids(unit.key).length + boards(unit.key).length)}><Icon name="trash" size={15} /></button>}
            <button className="cc-icon-btn" title="Đóng" onClick={() => setSel(null)}><Icon name="x" size={15} /></button>
          </div>
          {focus !== unit.key && <button className="cc-link-btn" style={{ marginTop: 8 }} onClick={() => setFocus(unit.key)}><Icon name="sitemap" size={13} />Xem sơ đồ riêng của đơn vị này</button>}
          {unit.desc && <p className="cc-job-desc" style={{ marginTop: 10 }}>{unit.desc}</p>}
          <div className="cc-kv"><span>Trực thuộc</span><b>{parent ? <button className="cc-link-btn" onClick={() => setSel(parent.key)}>{parent.label}</button> : parentLabel(units, unit) || '—'}</b></div>
          <div className="cc-kv"><span>Trưởng đơn vị</span><b>{head ? <button className="cc-link-btn" onClick={() => onOpen(head.id)}>{head.name}</button> : 'Chưa bổ nhiệm'}</b></div>
          <div className="cc-kv"><span>Nhân sự</span><b>{list.length} người{unit.type === 'exec' ? ` · cả khối ${total(unit.key)}` : ''}</b></div>
          {canHaveBoards(unit) && (
            <>
              <div className="cc-row-between" style={{ marginTop: 14, marginBottom: 6 }}>
                <h3 className="cc-h3" style={{ margin: 0 }}>Các ban</h3>
                {editable && <button className="cc-btn ghost" style={{ height: 30 }} onClick={() => openBoard()}><Icon name="plus" size={14} stroke={2.4} />Thành lập ban</button>}
              </div>
              {boards(unit.key).length === 0
                ? <div className="cc-sub">Chưa có ban nào{editable ? ' — bấm "Thành lập ban" để thêm BOD, Ban kiểm soát, Ban chiến lược… hoặc ban tự đặt tên' : ''}</div>
                : <div className="cc-board-list">{boards(unit.key).map(b => (
                  <div key={b.key} className="cc-board-row">
                    <button className="cc-board-main" onClick={() => setSel(b.key)}>
                      <Icon name="users" size={14} />
                      <span><b>{b.label}</b><em>{members(b.key).length} thành viên{b.appointedFromParent ? ' · bổ nhiệm từ công ty mẹ' : ''}{heads[b.key] && empOf(heads[b.key]) ? ` · trưởng ban ${empOf(heads[b.key]).name}` : ''}</em></span>
                    </button>
                    {editable && <button className="cc-icon-btn" title="Sửa ban" onClick={() => setForm({ ...b, _orig: b.key, headId: heads[b.key] || '' })}><Icon name="edit" size={14} /></button>}
                    {editable && <button className="cc-icon-btn danger" title="Xoá ban" onClick={() => onDeleteUnit(b, 0, 0)}><Icon name="trash" size={14} /></button>}
                  </div>
                ))}</div>}
            </>
          )}
          {(kids(unit.key).length > 0 || (!canHaveBoards(unit) && boards(unit.key).length > 0)) && (
            <>
              <h3 className="cc-h3" style={{ marginTop: 14 }}>Đơn vị trực thuộc</h3>
              <div className="cc-checks">{[...(canHaveBoards(unit) ? [] : boards(unit.key)), ...kids(unit.key)].map(k => <button key={k.key} className={`cc-legend-chip cc-tone-${k.tone}`} onClick={() => setSel(k.key)}><i />{k.label} · {k.type === 'board' ? 'ban' : total(k.key)}</button>)}</div>
            </>
          )}
          <div className="cc-row-between" style={{ marginTop: 14, marginBottom: 6 }}>
            <h3 className="cc-h3" style={{ margin: 0 }}>Thành viên{isConcurrent(unit.key) ? ' (kiêm nhiệm)' : ''}</h3>
            {editable && <button className="cc-btn ghost" style={{ height: 30 }} onClick={() => setPicker({ q: '', ids: new Set() })}><Icon name="userPlus" size={14} />Thêm nhân sự</button>}
          </div>
          {list.length === 0 ? <Empty icon="users" text="Chưa có thành viên" /> : list.map(e => (
            <div key={e.id} className="cc-unit-member">
              <button className="cc-unit-member-main" onClick={() => onOpen(e.id)}>
                <Avatar emp={e} size={28} />
                <span className="cc-grow">
                  <b>{e.name}</b>
                  {isConcRow(unit.key, e)
                    ? <>
                      <span className="cc-member-role"><RoleTag kind="conc" />{concOf(unit.key, e.id)?.title || 'Thành viên'}</span>
                      <span className="cc-member-role"><RoleTag kind="main" />{e.position} · {deptOf(e.dept).name}</span>
                    </>
                    : (() => {
                      const others = concurrentRoles(units, extraMembers, e.id)
                      return (
                        <span className="cc-member-role">
                          <RoleTag kind="main" />
                          {others.length > 0 && <span className="cc-role-more" title={rolesTitle(others)}>+{others.length} kiêm nhiệm</span>}
                          <span className="cc-member-pos">{e.position}</span>
                        </span>
                      )
                    })()}
                </span>
              </button>
              {heads[unit.key] === e.id && <Pill tone={unit.tone}>Trưởng</Pill>}
              {isConcRow(unit.key, e) && <span className="cc-conc-pct">{concOf(unit.key, e.id)?.pct ?? 0}%</span>}
              {editable && isConcRow(unit.key, e) && <button className="cc-icon-btn sm danger" title="Gỡ khỏi ban" onClick={() => onRemoveExtra(unit, e)}><Icon name="x" size={13} /></button>}
              {editable && !isConcRow(unit.key, e) && (
                <label className="cc-move" title="Chuyển sang đơn vị khác">
                  <Icon name="arrowRight" size={13} />
                  <select value="" onChange={ev => ev.target.value && onAssign(unitOf(ev.target.value), [e.id])}>
                    <option value="">Chuyển sang...</option>
                    {units.filter(u => (u.type === 'dept' || u.type === 'exec') && u.key !== unit.key).map(u => <option key={u.key} value={u.key}>{u.name}</option>)}
                  </select>
                </label>
              )}
              {isConcRow(unit.key, e) && (() => {
                const m = concOf(unit.key, e.id) || {}
                return (
                  <div className="cc-conc-edit">
                    <label><span>Chức danh</span><input disabled={!editable} value={m.title || ''} onChange={ev => onUpdateExtra(unit, e.id, { title: ev.target.value })} onBlur={() => onCommitExtra(unit, e)} /></label>
                    <label className="pct"><span>Tỉ lệ</span><input type="number" min="0" max="90" step="5" disabled={!editable} value={m.pct ?? 0} onChange={ev => onUpdateExtra(unit, e.id, { pct: Math.max(0, Number(ev.target.value) || 0) })} onBlur={() => onCommitExtra(unit, e)} /><em>%</em></label>
                    <label><span>Phụ cấp/tháng</span><input inputMode="numeric" disabled={!editable} value={Number(m.allowance || 0).toLocaleString('vi-VN')} onChange={ev => onUpdateExtra(unit, e.id, { allowance: Number(ev.target.value.replace(/\D/g, '')) || 0 })} onBlur={() => onCommitExtra(unit, e)} /></label>
                  </div>
                )
              })()}
            </div>
          ))}
          {isConcurrent(unit.key) && list.length > 0 && <div className="cc-sub" style={{ marginTop: 8 }}>Tỉ lệ kiêm nhiệm được trừ vào phòng ban chính, hiển thị trong hồ sơ nhân sự & dùng để phân bổ chi phí lương.</div>}
        </div>
      )}

      <Modal open={!!picker && !!unit} onClose={() => setPicker(null)} width={600} icon="userPlus" title={`Thêm nhân sự vào ${unit?.label || ''}`}
        sub={unit && (isConcurrent(unit.key) || picker?.mode === 'conc') ? 'Thành viên kiêm nhiệm — vẫn giữ phòng ban hiện tại' : 'Nhân sự được điều chuyển sang đơn vị này, quản lý trực tiếp = trưởng đơn vị'}
        footer={<><span className="cc-grow cc-sub">{picker?.ids.size || 0} người được chọn</span><button className="cc-btn ghost" onClick={() => setPicker(null)}>Hủy</button>
          <button className="cc-btn" disabled={!picker?.ids.size} onClick={() => { onAssign(unit, [...picker.ids], picker.mode); setPicker(null) }}><Icon name="check" size={14} stroke={2.6} />Thêm {picker?.ids.size || ''} người</button></>}>
        {picker && unit && (() => {
          const inUnit = new Set(members(unit.key).map(e => e.id))
          const t = picker.q.trim().toLowerCase()
          // Pháp nhân: ban của công ty con "bổ nhiệm từ công ty mẹ" → chỉ nhân sự công ty mẹ; đơn vị khác → chỉ nhân sự cùng pháp nhân
          const unitCo = companyOf(units, unit.key)
          const fromCo = unit.appointedFromParent ? companyOf(units, unitOf(unitCo)?.parent) : unitCo
          const coName = fromCo === 'root' ? 'công ty mẹ' : unitOf(fromCo)?.label
          // Điều chuyển hẳn (độc lập) thì nhận nhân sự từ bất kỳ pháp nhân nào; kiêm nhiệm thì phải cùng pháp nhân (trừ ban bổ nhiệm từ công ty mẹ)
          const concMode = isConcurrent(unit.key) || picker.mode === 'conc'
          const cands = current.filter(e => !inUnit.has(e.id) && (!concMode || companyOf(units, e.dept) === fromCo) && (!t || (e.name + ' ' + e.position + ' ' + deptOf(e.dept).name).toLowerCase().includes(t)))
          const toggle = id => setPicker(p => { const ids = new Set(p.ids); ids.has(id) ? ids.delete(id) : ids.add(id); return { ...p, ids } })
          return (
            <div className="cc-stack" style={{ gap: 10 }}>
              {!isConcurrent(unit.key) && (
                <div className="cc-au-modes two">
                  <button type="button" className={`cc-au-mode${picker.mode !== 'conc' ? ' active' : ''}`} onClick={() => setPicker({ ...picker, mode: 'move' })}><span className="cc-role-tag main">Độc lập</span><b>Điều chuyển</b><em>Chuyển hẳn sang đơn vị này</em></button>
                  <button type="button" className={`cc-au-mode${picker.mode === 'conc' ? ' active' : ''}`} onClick={() => setPicker({ ...picker, mode: 'conc' })}><span className="cc-role-tag conc">Kiêm nhiệm</span><b>Liên kết kiêm nhiệm</b><em>Giữ phòng ban chính, mặc định 10%</em></button>
                </div>
              )}
              {concMode && (unitCo !== 'root' || unit.appointedFromParent) && <div className="cc-au-note"><Icon name="lock" size={13} /><span>{unit.appointedFromParent ? 'Ban này được bổ nhiệm từ công ty mẹ — chỉ hiển thị nhân sự công ty mẹ.' : `Kiêm nhiệm tại ${coName} chỉ dành cho nhân sự của ${coName}. Nhân sự công ty mẹ chỉ kiêm nhiệm qua Ban kiểm soát / Ban chiến lược.`}</span></div>}
              <label className="cc-search" style={{ width: '100%' }}><Icon name="search" size={14} /><input autoFocus placeholder="Tìm theo tên, chức danh, phòng ban..." value={picker.q} onChange={e => setPicker({ ...picker, q: e.target.value })} /></label>
              <div className="cc-pick-list">
                {cands.length === 0 && <Empty icon="search" text="Không còn nhân sự phù hợp" />}
                {cands.map(e => (
                  <label key={e.id} className={`cc-pick${picker.ids.has(e.id) ? ' on' : ''}`}>
                    <input type="checkbox" checked={picker.ids.has(e.id)} onChange={() => toggle(e.id)} />
                    <Avatar emp={e} size={28} />
                    <span className="cc-grow"><b>{e.name}</b><span>{e.position}</span></span>
                    <Pill tone={deptOf(e.dept).tone}>{deptOf(e.dept).name}</Pill>
                  </label>
                ))}
              </div>
            </div>
          )
        })()}
      </Modal>

      {addOpen && <AddUnitModal open onClose={() => { setAddOpen(false); setAddParent(null) }} units={units} employees={employees} defaultParent={addParent || sel || (companyUnit ? company : 'ceo')} onCreate={onCreateUnit} />}

      <Modal open={!!boardForm && !!unit} onClose={() => setBoardForm(null)} width={600} icon="users" title={`Thành lập ban — ${unit?.label || ''}`} sub="Chọn ban có sẵn hoặc tự đặt tên; bổ nhiệm thành viên ngay sau khi tạo"
        footer={<><span className="cc-grow" /><button className="cc-btn ghost" onClick={() => setBoardForm(null)}>Hủy</button><button className="cc-btn" disabled={!boardForm?.label.trim()} onClick={saveBoard}><Icon name="check" size={14} stroke={2.6} />Thành lập & chọn thành viên</button></>}>
        {boardForm && unit && (
          <div className="cc-stack">
            <div className="cc-board-presets">
              {BOARD_PRESETS.map(p => {
                const exists = p.kind !== 'custom' && boards(unit.key).some(b => b.label === p.label)
                return (
                  <button key={p.kind} type="button" disabled={exists} className={`cc-board-preset${boardForm.kind === p.kind ? ' active' : ''}`} onClick={() => openBoard(p.kind)}>
                    <b>{p.kind === 'custom' ? 'Tùy chọn' : p.label}</b><em>{exists ? 'Đã có' : p.kind === 'custom' ? 'Tự đặt tên ban' : p.desc}</em>
                  </button>
                )
              })}
            </div>
            <div className="cc-form" style={{ marginTop: 0 }}>
              <Field label="Tên trên sơ đồ *"><input autoFocus={boardForm.kind === 'custom'} value={boardForm.label} placeholder="VD: Ban đầu tư" onChange={e => setBoardForm({ ...boardForm, label: e.target.value })} /></Field>
              <Field label="Tên đầy đủ"><input value={boardForm.name} placeholder="VD: Ban Đầu tư & Phát triển" onChange={e => setBoardForm({ ...boardForm, name: e.target.value })} /></Field>
              <Field label="Chức năng, nhiệm vụ" full><input value={boardForm.desc} onChange={e => setBoardForm({ ...boardForm, desc: e.target.value })} /></Field>
            </div>
            {linkedCo(unit) && (
              <div>
                <div className="cc-f-label" style={{ marginBottom: 6 }}>Nguồn thành viên</div>
                <div className="cc-au-modes two">
                  <button type="button" className={`cc-au-mode${!boardForm.fromParent ? ' active' : ''}`} onClick={() => setBoardForm({ ...boardForm, fromParent: false })}><b>Nội bộ {unit.label}</b><em>Nhân sự của công ty này kiêm nhiệm</em></button>
                  <button type="button" className={`cc-au-mode${boardForm.fromParent ? ' active' : ''}`} onClick={() => setBoardForm({ ...boardForm, fromParent: true })}><b>Bổ nhiệm từ công ty mẹ</b><em>Nhân sự công ty mẹ kiêm nhiệm (VD: BKS, BCL)</em></button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!form} onClose={() => setForm(null)} width={600} icon="sitemap" title={form?._orig ? `Thiết lập — ${form.label}` : 'Thêm đơn vị tổ chức'} sub="Phòng ban, khối điều hành hoặc ban trực thuộc"
        footer={<><span className="cc-grow" /><button className="cc-btn ghost" onClick={() => setForm(null)}>Hủy</button><button className="cc-btn" onClick={save} disabled={!form?.label.trim()}>Lưu</button></>}>
        {form && <div className="cc-form" style={{ marginTop: 0 }}>
          <Field label="Tên trên sơ đồ *"><input value={form.label} placeholder="VD: Pháp chế" onChange={e => setForm({ ...form, label: e.target.value })} /></Field>
          <Field label="Tên đầy đủ"><input value={form.name} placeholder="VD: Phòng Pháp chế" onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Loại đơn vị"><select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>{Object.entries(UNIT_TYPE_LABEL).filter(([k]) => k !== 'governance' || form.type === 'governance').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Trực thuộc">
            <select value={form.parent || ''} disabled={form.type === 'governance'} onChange={e => setForm({ ...form, parent: e.target.value || null })}>
              {form.type === 'subsidiary' && <option value={HOLDING_KEY}>{HOLDING.name} — công ty thành viên tập đoàn</option>}
              {form.type === 'subsidiary' && <option value={MOTHER_KEY}>{PARENT_COMPANY.name} — trực thuộc trực tiếp công ty mẹ</option>}
              {form.type === 'subsidiary' && <option value="">— Độc lập, không trực thuộc tập đoàn —</option>}
              {units.filter(u => u.type !== 'board' && !blocked.has(u.key)).map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
            </select>
          </Field>
          {form.type === 'board' && linkedCo(unitOf(form.parent) || {}) && (
            <label className="cc-check-line full"><input type="checkbox" checked={!!form.appointedFromParent} onChange={e => setForm({ ...form, appointedFromParent: e.target.checked })} />Thành viên được bổ nhiệm từ công ty mẹ (kiêm nhiệm)</label>
          )}
          <Field label="Trưởng đơn vị">
            <select value={form.headId} onChange={e => setForm({ ...form, headId: e.target.value })}>
              <option value="">— Chưa bổ nhiệm —</option>
              {current.map(e => <option key={e.id} value={e.id}>{e.name} · {e.position}</option>)}
            </select>
          </Field>
          <Field label="Màu nhận diện"><div className="cc-tone-pick">{TONES.map(t => <button type="button" key={t} className={`cc-tone-${t}${form.tone === t ? ' active' : ''}`} onClick={() => setForm({ ...form, tone: t })} aria-label={t} />)}</div></Field>
          <Field label="Chức năng, nhiệm vụ" full><input value={form.desc} onChange={e => setForm({ ...form, desc: e.target.value })} /></Field>
        </div>}
      </Modal>
    </div>
  )
}

/* ================= Sơ đồ nhân sự =================
   Khung là cơ cấu phòng ban; mỗi đơn vị hiển thị trưởng đơn vị và mở ra toàn bộ nhân sự theo cấp bậc
   (Trưởng phòng → Phó phòng / Quản lý / Trưởng nhóm / Điều phối → Chuyên viên / Nhân viên).
   "Thu gọn" ẩn nhân sự, chỉ còn khung cơ cấu phòng ban. */
const rankOf = e => LEVELS.indexOf(e.level)
function PeopleView({ employees, units, heads, extraMembers, onOpen }) {
  const [hidden, setHidden] = useState(() => new Set()) // đơn vị đang thu gọn nhân sự
  const [zoom, setZoom] = useState(1)
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('all')
  const wrapRef = useRef(null)
  const orgRef = useRef(null)
  const onDown = usePan(wrapRef)

  const current = employees.filter(e => e.status !== 'left')
  const empOf = id => employees.find(e => e.id === id)
  const kids = key => units.filter(u => u.parent === key && u.type !== 'board')
  const boards = key => units.filter(u => u.parent === key && u.type === 'board')
  const members = key => {
    const u = units.find(x => x.key === key)
    const extras = (extraMembers[key] || []).map(m => empOf(m.id)).filter(e => e && e.status !== 'left')
    if (u && (u.type === 'board' || u.type === 'governance')) return extras
    return [...current.filter(e => e.dept === key), ...extras.filter(e => e.dept !== key)]
  }
  const subtreeKeys = key => [key, ...kids(key).flatMap(k => subtreeKeys(k.key))]

  const t = q.trim().toLowerCase()
  const isMatch = e => (t && (e.name + ' ' + e.position).toLowerCase().includes(t)) || (dept !== 'all' && e.dept === dept)
  const filtering = !!t || dept !== 'all'
  const unitHasMatch = key => subtreeKeys(key).some(k => members(k).some(isMatch))
  const isOpen = key => (t ? true : !hidden.has(key)) // đang tìm kiếm → mở hết để thấy kết quả

  const fit = () => {
    const w = wrapRef.current, o = orgRef.current
    if (!w || !o || !o.firstElementChild) return
    const z = parseFloat(o.style.zoom) || 1
    // Đo độ rộng thật của cây = tổng độ rộng các nút gốc (ul có thể rộng bằng khung nên không dùng được)
    const forest = o.querySelector(':scope > .cc-org-forest')
    const roots = o.querySelectorAll(':scope > ul > li')
    const natural = (forest ? forest.getBoundingClientRect().width : [...roots].reduce((w, li) => w + li.getBoundingClientRect().width, 0)) / z + 48
    setZoom(Math.max(0.4, Math.min(1, Math.floor((w.clientWidth - 8) / natural * 100) / 100)))
  }
  useEffect(() => { requestAnimationFrame(fit) }, [hidden]) // eslint-disable-line react-hooks/exhaustive-deps

  const RankPill = ({ e, tone }) => <span className={`cc-rank cc-tone-${tone || LEVEL_TONE[e.level] || 'muted'}`}>{e.level}</span>

  /* Một nhân sự (không phải trưởng đơn vị) + các cấp dưới trong cùng đơn vị */
  const renderPerson = (e, pool, seen) => {
    seen.add(e.id)
    const sub = pool.filter(x => x.managerId === e.id && !seen.has(x.id)).sort((a, b) => rankOf(b) - rankOf(a) || a.name.localeCompare(b.name))
    const d = deptOf(e.dept)
    const m = isMatch(e)
    return (
      <li key={'p' + e.id}>
        <div className={`cc-org-node cc-tone-${d.tone}${m ? ' match' : ''}${filtering && !m ? ' dim' : ''}`}>
          <button className="cc-org-card cc-person-card" onClick={() => onOpen(e.id)} title="Xem hồ sơ">
            <Avatar emp={e} size={32} />
            <span className="cc-org-text"><b>{e.name}</b><span>{e.position}</span>
              <span className="cc-card-tags"><RankPill e={e} />{(() => { const r = concurrentRoles(units, extraMembers, e.id); return r.length ? <span className="cc-role-more" title={rolesTitle(r)}>+{r.length} kiêm nhiệm</span> : null })()}</span>
            </span>
          </button>
        </div>
        {sub.length > 0 && <ul>{sub.map(x => renderPerson(x, pool, seen))}</ul>}
      </li>
    )
  }
  /* Nhân sự của đơn vị (trừ trưởng): người có quản lý ngoài đơn vị / là trưởng → treo dưới trưởng đơn vị */
  const staffOf = u => {
    if (u.type === 'board' || u.type === 'governance') return [] // thành viên kiêm nhiệm: chỉ hiện avatar trên ô ban
    const head = heads[u.key]
    const pool = members(u.key).filter(e => e.id !== head)
    const ids = new Set(pool.map(e => e.id))
    const top = pool.filter(e => !ids.has(e.managerId)).sort((a, b) => rankOf(b) - rankOf(a) || a.name.localeCompare(b.name))
    const seen = new Set()
    const out = top.map(e => renderPerson(e, pool, seen))
    pool.filter(e => !seen.has(e.id)).forEach(e => out.push(renderPerson(e, pool, seen)))
    return out
  }

  const render = (u, drop) => {
    const ch = kids(u.key)
    const side = boards(u.key)
    const hasExec = ch.some(isBlockLevel)
    const head = empOf(heads[u.key])
    const staffN = u.type === 'board' || u.type === 'governance' ? 0 : members(u.key).filter(e => e.id !== heads[u.key]).length
    const open = isOpen(u.key)
    const m = head && isMatch(head)
    const dim = filtering && !m && !unitHasMatch(u.key)
    return (
      <li key={u.key} className={drop ? 'drop' : undefined}>
        <div className="cc-unit-row">
          <div className={`cc-punit cc-tone-${u.tone} type-${u.type}${m ? ' match' : ''}${dim ? ' dim' : ''}`}>
            <div className="cc-punit-band">{u.label}</div>
            {head ? (
              <button className="cc-punit-head" onClick={() => onOpen(head.id)} title="Xem hồ sơ">
                <Avatar emp={head} size={30} />
                <span className="cc-org-text"><b>{head.name}</b><span>{head.position}</span></span>
              </button>
            ) : <div className="cc-punit-head empty">Chưa bổ nhiệm trưởng đơn vị</div>}
            {staffN > 0 && (
              <button className="cc-punit-toggle" onClick={() => setHidden(prev => { const n = new Set(prev); n.has(u.key) ? n.delete(u.key) : n.add(u.key); return n })}>
                {open ? <><Icon name="minus" size={11} stroke={3} />Ẩn {staffN} nhân sự</> : <><Icon name="plus" size={11} stroke={3} />{staffN} nhân sự</>}
              </button>
            )}
          </div>
          {side.length > 0 && (
            <div className="cc-unit-side">{side.map(b => (
              <div key={b.key} className="cc-unit-side-item">
                <div className={`cc-unit small cc-tone-${b.tone} type-board`}><b>{b.label}</b><span className="cc-board-avs">{members(b.key).slice(0, 4).map(e => <span key={e.id} title={`${e.name} — kiêm nhiệm: ${(extraMembers[b.key] || []).find(m => m.id === e.id)?.title || 'Thành viên'} · chính thức: ${e.position}`}><Avatar emp={e} size={16} /></span>)}</span></div>
              </div>
            ))}</div>
          )}
        </div>
        {(ch.length > 0 || (open && staffN > 0)) && (
          <ul>
            {open && staffOf(u)}
            {ch.map(c => render(c, hasExec && !isBlockLevel(c)))}
          </ul>
        )}
      </li>
    )
  }

  const roots = motherRoots(units)
  const allKeys = units.map(u => u.key)
  const anyOpen = allKeys.some(k => !hidden.has(k))

  return (
    <div className="cc-stack cc-fill">
      <div className="cc-card cc-pad cc-org-bar">
        <div><h3 className="cc-h3" style={{ margin: 0 }}>Sơ đồ nhân sự</h3><span className="cc-sub">{current.length} nhân sự · theo cơ cấu phòng ban & cấp bậc</span></div>
        <label className="cc-search"><Icon name="search" size={14} /><input placeholder="Tìm người trong sơ đồ..." value={q} onChange={e => setQ(e.target.value)} /></label>
        <select className="cc-select" value={dept} onChange={e => setDept(e.target.value)}>
          <option value="all">Tô sáng phòng ban...</option>
          {DEPTS.map(d => <option key={d.key} value={d.key}>{d.name} · {current.filter(e => e.dept === d.key).length}</option>)}
        </select>
        <span className="cc-grow" />
        <div className="cc-rank-legend">{['Giám đốc', 'Trưởng phòng', 'Trưởng nhóm', 'Điều phối', 'Nhân viên'].map(l => <span key={l} className={`cc-rank cc-tone-${LEVEL_TONE[l]}`}>{l}</span>)}</div>
        <ZoomCtl zoom={zoom} setZoom={setZoom} />
        <button className="cc-btn ghost" onClick={fit}>Vừa khung</button>
        {anyOpen
          ? <button className="cc-btn ghost" onClick={() => setHidden(new Set(allKeys))}><Icon name="minus" size={13} stroke={2.6} />Thu gọn (cơ cấu)</button>
          : <button className="cc-btn" onClick={() => setHidden(new Set())}><Icon name="plus" size={13} stroke={2.6} />Mở rộng tất cả</button>}
      </div>
      <div className="cc-card cc-org-wrap" ref={wrapRef} onMouseDown={onDown}>
        <div className="cc-org cc-org-units cc-org-people" style={{ zoom }} ref={orgRef}><ul>{roots.map(r => render(r))}</ul></div>
      </div>
    </div>
  )
}

/* Phân hệ "Sơ đồ tổ chức": cơ cấu phòng ban + sơ đồ nhân sự */
/* ================= Sơ đồ tập đoàn: chỉ các công ty (mẹ → con; thành viên độc lập đứng riêng) ================= */
function GroupView({ employees, units, heads, onPick, onCreateUnit }) {
  const { can } = useAccess()
  const editable = can('employees', 'edit')
  const [addOpen, setAddOpen] = useState(false)
  const wrapRef = useRef(null)
  const orgRef = useRef(null)
  const onDown = usePan(wrapRef)
  const [zoom, setZoom] = useState(1)
  const fit = () => {
    const w = wrapRef.current, o = orgRef.current?.querySelector('.cc-org-forest')
    if (!w || !o) return
    const z = parseFloat(orgRef.current.style.zoom) || 1
    setZoom(Math.max(0.35, Math.min(1, Math.floor((w.clientWidth - 8) / (o.getBoundingClientRect().width / z + 48) * 100) / 100)))
  }
  useEffect(() => { requestAnimationFrame(fit) }, [units.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const current = employees.filter(e => e.status !== 'left')
  const empOf = id => employees.find(e => e.id === id)
  const subs = units.filter(u => u.type === 'subsidiary')
  const standalone = subs.filter(isStandaloneCo)
  // Công ty sở hữu trực tiếp: pháp nhân chứa đơn vị cấp trên của công ty con ('root' = Decox) · tập đoàn: các công ty thành viên
  const holdingCos = subs.filter(isHoldingCo)
  const childCos = key => subs.filter(s => !isStandaloneCo(s) && !isHoldingCo(s) && companyOf(units, s.parent) === key)
  const staff = key => current.filter(e => companyOf(units, e.dept) === key).length
  const unitCount = key => units.filter(u => u.key !== key && u.type !== 'board' && u.type !== 'subsidiary' && companyOf(units, u.key) === key).length
  const leaderOf = key => empOf(key === 'root' ? heads.ceo : heads[key])
  // Công ty độc lập đứng cùng hàng các công ty thành viên: đo vị trí hàng thành viên để canh lề trên
  const [loneTop, setLoneTop] = useState(0)
  useLayoutEffect(() => {
    const o = orgRef.current
    const forest = o?.querySelector('.cc-org-forest')
    const member = o?.querySelector('.cc-org-forest > ul > li > ul > li > .cc-unit-row')
    const lone = o?.querySelector('.cc-co-standalone-col .cc-unit-row')
    if (!forest || !member || !lone) return
    const z = parseFloat(o.style.zoom) || 1
    // dời cột độc lập đúng bằng độ lệch giữa hàng thành viên và thẻ độc lập
    setLoneTop(t => Math.max(0, Math.round(t + (member.getBoundingClientRect().top - lone.getBoundingClientRect().top) / z)))
  }, [units, employees, zoom])

  const linkedSubs = subs.filter(s => !isStandaloneCo(s) && !isHoldingCo(s))
  const groupStaff = current.filter(e => !standalone.some(c => c.key === companyOf(units, e.dept))).length
  const card = (key, u) => {
    const holding = key === '__h', mother = key === 'root'
    const lone = !!u && isStandaloneCo(u)
    const lead = holding ? null : leaderOf(key)
    return (
      <button className={`cc-co-card cc-tone-${holding || mother ? 'primary' : u.tone}${holding ? ' holding' : ''}${lone ? ' standalone' : ''}`}
        onClick={() => onPick(holding ? 'all' : key)} title={holding ? 'Xem toàn cảnh cơ cấu tập đoàn' : 'Xem cơ cấu tổ chức của công ty này'}>
        <span className="cc-unit-kicker"><Icon name="building" size={10} />{holding ? 'Tập đoàn' : lone ? 'Độc lập' : mother || isHoldingCo(u) ? 'Công ty thành viên' : 'Công ty con'}</span>
        <b>{holding ? HOLDING.name : mother ? PARENT_COMPANY.name : u.name}</b>
        {lead && <span className="cc-unit-head"><Avatar emp={lead} size={18} />{lead.name}</span>}
        <span className="cc-co-card-stats">
          {holding
            ? <><span>{holdingCos.length + 1} công ty</span><span>{groupStaff} nhân sự</span></>
            : <><span>{staff(key)} nhân sự</span><span>{unitCount(key)} đơn vị</span></>}
        </span>
        <span className="cc-co-card-go">{holding ? 'Xem toàn cảnh (ALL)' : 'Xem cơ cấu tổ chức'} <Icon name="arrowRight" size={11} /></span>
      </button>
    )
  }
  const renderCo = (key, u) => {
    const ch = childCos(key)
    return (
      <li key={key}>
        <div className="cc-unit-row">{card(key, u)}</div>
        {ch.length > 0 && <ul>{ch.map(c => renderCo(c.key, c))}</ul>}
      </li>
    )
  }
  return (
    <div className="cc-stack cc-fill">
      <div className="cc-card cc-pad cc-org-bar">
        <div>
          <h3 className="cc-h3" style={{ margin: 0 }}>Sơ đồ tập đoàn — {HOLDING.name}</h3>
          <span className="cc-sub">{holdingCos.length + 1} công ty thành viên · {linkedSubs.length} công ty con · {standalone.length} độc lập · {current.length} nhân sự</span>
        </div>
        <span className="cc-grow" />
        <div className="cc-co-legend"><span><i />Trực thuộc</span><span><i className="dashed" />Độc lập</span></div>
        <ZoomCtl zoom={zoom} setZoom={setZoom} />
        <button className="cc-btn ghost" onClick={fit}>Vừa khung</button>
        <button className="cc-btn ghost" onClick={() => onPick('all')}><Icon name="sitemap" size={14} />Xem toàn cảnh (ALL)</button>
        {editable && <button className="cc-btn" onClick={() => setAddOpen(true)}><Icon name="plus" size={14} stroke={2.4} />Thêm công ty</button>}
      </div>
      <div className="cc-card cc-org-wrap" ref={wrapRef} onMouseDown={onDown}>
        <div className="cc-org cc-org-group" style={{ zoom }} ref={orgRef}>
          <div className="cc-org-forest">
            <ul>
              <li>
                <div className="cc-unit-row">{card('__h', null)}</div>
                <ul>{renderCo('root', null)}{holdingCos.map(c => renderCo(c.key, c))}</ul>
              </li>
            </ul>
            {standalone.length > 0 && <div className="cc-co-standalone-col" style={{ marginTop: loneTop }}><ul>{standalone.map(c => renderCo(c.key, c))}</ul></div>}
          </div>
        </div>
      </div>
      {addOpen && <AddUnitModal open onClose={() => setAddOpen(false)} units={units} employees={employees} defaultParent={HOLDING_KEY} initialKind="subsidiary" onCreate={onCreateUnit} />}
    </div>
  )
}

export default function OrgChart({ employees, units, heads, extraMembers, onSaveUnit, onDeleteUnit, onAssign, onRemoveExtra, onUpdateExtra, onCommitExtra, onMoveUnit, onCreateUnit, onOpen }) {
  const [view, setView] = useState('group') // group: chỉ công ty · units: cơ cấu từng công ty (hoặc ALL) · people: sơ đồ nhân sự
  const [company, setCompany] = useState('root')
  const pick = key => { setCompany(key); setView('units') }
  return (
    <div className="cc-stack cc-fill">
      <Seg value={view} onChange={setView} options={[{ value: 'group', label: 'Tập đoàn', icon: 'building' }, { value: 'units', label: 'Cơ cấu công ty', icon: 'sitemap' }, { value: 'people', label: 'Sơ đồ nhân sự', icon: 'users' }]} />
      {view === 'group'
        ? <GroupView employees={employees} units={units} heads={heads} onPick={pick} onCreateUnit={onCreateUnit} />
        : view === 'units'
        ? <UnitsView company={company} setCompany={setCompany} employees={employees} units={units} heads={heads} extraMembers={extraMembers} onSaveUnit={onSaveUnit} onDeleteUnit={onDeleteUnit} onAssign={onAssign} onRemoveExtra={onRemoveExtra} onUpdateExtra={onUpdateExtra} onCommitExtra={onCommitExtra} onMoveUnit={onMoveUnit} onCreateUnit={onCreateUnit} onOpen={onOpen} />
        : <PeopleView employees={employees} units={units} heads={heads} extraMembers={extraMembers} onOpen={onOpen} />}
      <div className="cc-sub" style={{ textAlign: 'center' }}>Kéo nền để di chuyển · bấm vào thẻ để xem chi tiết</div>
    </div>
  )
}
