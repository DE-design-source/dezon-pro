import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../../../../components/ui/Icon'
import SheetToolbar from './SheetToolbar'
import SheetGrid from './SheetGrid'
import GroupAdder from './GroupAdder'
import {
  ROW_NUM_WIDTH, TK_SO, TK_PRICE_KEYS, colLetter, lineText, lineApply, lineNumber, tkEntryText, tkFlatten, tkSheetSua_,
} from './sheet/tkModel'

const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))

/* Tách văn bản dạng bảng (TSV / CSV như Excel: ô trong ngoặc kép được chứa tab, xuống dòng) thành ma trận */
function parseTable(text, delim = '\t') {
  const rows = [[]]
  let cell = ''
  let quoted = false
  const src = text.replace(/\r\n?/g, '\n')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === delim) { rows[rows.length - 1].push(cell); cell = '' } else if (ch === '\n') { rows[rows.length - 1].push(cell); cell = ''; rows.push([]) } else cell += ch
  }
  rows[rows.length - 1].push(cell)
  if (rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop()
  return rows
}
/* Ghép ma trận thành văn bản dạng bảng, bọc ngoặc kép khi ô có ký tự đặc biệt */
function formatTable(matrix, delim = '\t') {
  const q = v => (new RegExp(`["\n${delim === '\t' ? '\t' : delim}]`).test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return matrix.map(row => row.map(v => q(String(v))).join(delim)).join('\n')
}

/* Cách đọc / ghi ô mặc định: dòng = Line của server, khoá cột = COLS (sheet/tkModel). Mọi bảng hiện tại (Bóc tách, Chi phí,
   Dự án, Phần thô) đều truyền adapter + columns + flatten riêng; mặc định chỉ để bảng không truyền vẫn chạy. */
const LINE_ADAPTER = {
  rowId: r => r.lineId,
  cellText: (r, k, stt) => lineText(r, k, stt),
  editText: (r, k) => lineText(r, k, ''),
  applyEdit: lineApply,
  cellNumber: lineNumber,
  entryText: tkEntryText,
  colLetter,
  editable: k => tkSheetSua_(k),
  isNumeric: k => !!TK_SO[k],
  isFav: () => false,
  priceKeys: TK_PRICE_KEYS,
  rowNumWidth: ROW_NUM_WIDTH,
}
const NO_COLS = []
const LINE_FLATTEN = (groups, pred) => tkFlatten(groups, pred, null)

/* Áp fn lên các dòng có id trong ids; không dòng nào đổi thì trả lại đúng mảng cũ (để lịch sử bỏ qua) */
function mapRows(groups, ids, fn, rid) {
  const out = groups.map(g => {
    let changed = false
    const rows = g.rows.map(r => {
      if (!ids.has(rid(r))) return r
      const n = fn(r)
      if (n !== r) changed = true
      return n
    })
    return changed ? { ...g, rows } : g
  })
  return out.some((g, i) => g !== groups[i]) ? out : groups
}

/* Phần thân của bảng bóc tách: thanh công cụ, dải tuỳ chọn, lưới và hàng nút dưới cùng.
   Giữ toàn bộ trạng thái chọn ô / sửa ô / lọc / tìm và mọi thao tác của thanh công cụ.
   Các prop sau đều không bắt buộc (bảng Chi phí / Dự án không truyền thì chạy như cũ):
     adapter            cách đọc / ghi ô (xem LINE_ADAPTER); editable(key, row) nhận thêm dòng để bảng sửa được theo từng ô
     onRenameGroup(g, name) · onInsertRow(entry) · onDuplicate(ids) · onSort(key, dir) · onDownload() · onReplaceAll(q, rep)
     onCellContext({entry, col, r, c, ev, ids, keys}) (keys = khoá các cột của vùng chọn, hoặc cột được bấm) · onSelItems(ids) · apiRef (selectRows(ids), selectAll())
     wrapKey = 'nowrap' | 'wrap' (nút "Xuống dòng" bật / tắt khoá nào trong fmt) · hideTools [tên nút ẩn] · extraTools (node, cuối thanh) · leadTools (node, đầu thanh)
     · quickTool {title, count, on, onClick}: thay nút ẩn / hiện cột giá ở vị trí số 2 bằng nút bộ cột nhanh
     printTitle · và các prop chuyển thẳng cho SheetGrid: renderCell, onColMenu, colMarks, rowDrag, rowHeights, onRowHeight,
     frozenRows, gridClass, emptyNode, frozenDefault, onColResize, onColMove, rowAction, emptyReplace, plainFmt, fitCols
     onSelItems(ids, {fullRow})  fullRow = vùng chọn phủ hết các cột (bấm số dòng / chọn cả dòng)
     onApplyEdits(info, cells)  dán / xoá / cắt / điền nhiều ô: bảng cha tự ghi theo lô (tkApplyEdits_) thay vì commit từng dòng.
                                info {kind: 'paste'|'fill'|'clear', label, value}, cells [{id, key, text}]
     onDeleteRows(ids)          nút "Xoá dòng đang chọn": bảng cha tự xoá (hỏi lại) thay vì commit
     plainTools(a, s) -> node   Bảng thường: khối công cụ gọn thay cho thanh công cụ bảng tính + thanh công thức
     adderOpenKey               đổi giá trị = mở hộp "Thêm tầng / phòng" */
export default function SheetBody({
  sheet, plain, hiddenCols, onHiddenCols, panel, onPanel, favorites, targetName, onTarget, groupNames, onAddGroup, onAddRow, onAddBlank,
  full, onFull, dropMark, flash, onClearMark, dropHint, fileName,
  /* Tuỳ biến cho bảng khác (tab Chi phí): bộ cột, cách trải dòng, lọc thêm, ô chọn ban đầu, lớp CSS của dòng… */
  columns = NO_COLS, flatten = LINE_FLATTEN, extraPred = null, initialSel = null, rowClass = null, onToggleGroupOverride = null,
  footer = true, footerInTools = false, colCount = null, letters = true,
  adapter = LINE_ADAPTER, onRenameGroup = null, onInsertRow = null, onDuplicate = null, onSort = null, onDownload = null,
  onReplaceAll = null, onCellContext = null, onSelItems = null, apiRef = null, wrapKey = 'nowrap', hideTools = null, extraTools = null, leadTools = null, quickTool = null,
  printTitle = null, renderCell, onColMenu, colMarks, rowDrag, rowHeights, onRowHeight, onGroupHeight, onHeadHeight, frozenRows, gridClass, emptyNode, frozenDefault = true,
  compactDefault = true, colsPanel = null, datalists = null, toolsSlot = null, onViewMode = null,
  onApplyEdits = null, onDeleteRows = null, plainTools = null, adderOpenKey, onColResize, onColMove, rowAction, emptyReplace, plainFmt, fitCols,
}) {
  const A = adapter
  const rid = A.rowId
  const { groups, commit } = sheet
  const [fontSize, setFontSize] = useState(12)
  const [compact, setCompact] = useState(compactDefault)
  const [frozen, setFrozen] = useState(frozenDefault)
  const [zoom, setZoom] = useState(100)
  const [showStats, setShowStats] = useState(true)
  const [findQ, setFindQ] = useState('')
  const [repQ, setRepQ] = useState('')
  const [hitIdx, setHitIdx] = useState(0)
  const [filterText, setFilterText] = useState('')
  const [colFilter, setColFilter] = useState(null)
  const [favOnly, setFavOnly] = useState(false)
  /* Màu chữ / màu nền chọn gần nhất (tô vạch dưới hai nút màu và là màu mở sẵn trong bảng màu) */
  const [lastColor, setLastColor] = useState({ color: '#E11D48', bg: '#FACC15' })
  /* Ô đang chọn mặc định giống giao diện mẫu: tên nhóm thứ hai (B15:C15) */
  const [sel, setSel] = useState(() => {
    if (initialSel) return initialSel
    const r = groups.length ? groups[0].rows.length + 1 : 0
    return { a: { r, c: 1 }, f: { r, c: 2 } }
  })
  const [editing, setEditingState] = useState(null)
  const edRef = useRef(null)
  const setEditing = v => { edRef.current = v; setEditingState(v) }
  const gridRef = useRef(null)
  /* Cỡ chữ bảng chia sẻ cho cả vùng (.qs-bd-body): cột Hạng mục bên trái dùng cùng cỡ chữ với bảng (QS.css --qs-tbl-fs) */
  useEffect(() => {
    const body = gridRef.current && gridRef.current.closest('.qs-bd-body')
    /* bảng vẽ ở cỡ fontSize + 1 (SheetGrid bên dưới) nên cột trái lấy đúng cỡ đó */
    if (body) body.style.setProperty('--qs-tbl-fs', (fontSize + 1) + 'px')
  }, [fontSize])
  const clipRef = useRef(null)
  const dragSel = useRef(false)
  const reveal = useRef(false)

  const cols = useMemo(() => columns.filter(c => !hiddenCols.has(c.key)), [columns, hiddenCols])
  const pred = useMemo(() => {
    const ft = filterText.trim().toLowerCase()
    if (!ft && !colFilter && !favOnly && !extraPred) return null
    return (r, stt) => {
      if (extraPred && !extraPred(r, stt)) return false
      if (favOnly && !A.isFav(r, favorites)) return false
      if (colFilter && A.cellText(r, colFilter.key, stt) !== colFilter.value) return false
      if (ft && !columns.some(c => A.cellText(r, c.key, stt).toLowerCase().includes(ft))) return false
      return true
    }
  }, [filterText, colFilter, favOnly, favorites, extraPred, columns, A])
  const flat = useMemo(() => flatten(groups, pred), [flatten, groups, pred])

  /* Vùng chọn, đã ép vào trong phạm vi bảng hiện tại */
  const maxR = Math.max(0, flat.length - 1)
  const maxC = Math.max(0, cols.length - 1)
  const clamp = p => ({ r: Math.max(0, Math.min(maxR, p.r)), c: Math.max(0, Math.min(maxC, p.c)) })
  const A0 = clamp(sel.a)
  const F = clamp(sel.f)
  const range = { r0: Math.min(A0.r, F.r), r1: Math.max(A0.r, F.r), c0: Math.min(A0.c, F.c), c1: Math.max(A0.c, F.c) }
  const single = range.r0 === range.r1 && range.c0 === range.c1
  const anchorEntry = flat[A0.r]
  const anchorCol = cols[A0.c]
  const selEntries = flat.slice(range.r0, range.r1 + 1)
  const selItems = selEntries.filter(e => e.type === 'item')
  const selIds = new Set(selItems.map(e => rid(e.r)))
  const selKeys = cols.slice(range.c0, range.c1 + 1).map(c => c.key)
  const refLabel = !anchorEntry || !anchorCol ? ''
    : single ? `${A.colLetter(A0.c)}${anchorEntry.n}`
      : `${A.colLetter(range.c0)}${flat[range.r0].n}:${A.colLetter(range.c1)}${flat[range.r1].n}`

  /* Báo cho bảng cha các dòng sản phẩm đang chọn (thanh thao tác hàng loạt) */
  const fullRow = range.c0 === 0 && range.c1 === maxC
  const selSig = selItems.map(e => rid(e.r)).join('|')
  useEffect(() => {
    if (onSelItems) onSelItems(selSig ? selSig.split('|') : [], { fullRow })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selSig, fullRow])
  if (apiRef) {
    apiRef.current = {
      selectAll: () => setSel({ a: { r: 0, c: 0 }, f: { r: maxR, c: maxC } }),
      selectRows: ids => {
        const rs = flat.map((e, i) => (e.type === 'item' && ids.indexOf(rid(e.r)) >= 0 ? i : -1)).filter(i => i >= 0)
        if (rs.length) setSel({ a: { r: Math.min(...rs), c: 0 }, f: { r: Math.max(...rs), c: maxC } })
      },
      focus: () => { if (gridRef.current) gridRef.current.focus({ preventScroll: true }) },
      clear: () => setSel(s => ({ a: s.a, f: s.a })),
      /* Xoá định dạng: ô đang chọn (clearFmt) · cả bảng: mọi ô về mặc định (màu, đậm, nghiêng, gạch chân, căn lề) + cỡ chữ mặc định */
      clearFmt: () => clearFmt(),
      clearAllFmt: () => {
        setFontSize(12)
        commit('Xoá toàn bộ định dạng', gs => gs.map(g => (g.rows && g.rows.some(r => r.fmt && Object.keys(r.fmt).length)
          ? { ...g, rows: g.rows.map(r => (r.fmt && Object.keys(r.fmt).length ? { ...r, fmt: {} } : r)) } : g)))
      },
    }
  }

  /* Dòng nhóm tự sinh (gom theo NCC…) và dòng tổng không sửa được */
  const canEdit = (e, col) => Boolean(e && col) && (e.type === 'item' ? A.editable(col.key, e.r) : e.type === 'group' && !e.synthetic && (col.key === 'room' || col.key === 'name' || col.key === 'khuVuc' || col.key === 'ten'))
  const rawText = (e, col) => (e.type === 'item' ? A.editText(e.r, col.key) : e.g.name)

  /* Chọn ô do người dùng thao tác: nhóm chứa ô đó thành nơi nhận hạng mục mới */
  function pick(a, f = a, show = false) {
    const na = clamp(a)
    reveal.current = show
    setSel({ a: na, f: clamp(f) })
    if (flat[na.r] && flat[na.r].type !== 'total' && !flat[na.r].synthetic) onTarget(flat[na.r].g.id)
  }
  function move(dr, dc, extend) {
    const next = clamp({ r: F.r + dr, c: F.c + dc })
    if (extend) { reveal.current = true; setSel({ a: A0, f: next }) } else pick(next, next, true)
  }

  /* Cuộn ô tiêu điểm vào tầm nhìn sau khi di chuyển bằng phím / tìm kiếm */
  useEffect(() => {
    if (!reveal.current || !gridRef.current) return
    reveal.current = false
    const td = gridRef.current.querySelector(`td[data-r="${F.r}"][data-c="${F.c}"]`)
    if (td) td.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
  useEffect(() => {
    const up = () => { dragSel.current = false }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])
  /* Vừa thêm / tăng số lượng một sản phẩm: chọn ô tên của dòng đó và cuộn tới */
  const flashN = flash ? flash.n : 0
  useEffect(() => {
    if (!flash) return
    const r = flat.findIndex(e => e.type === 'item' && rid(e.r) === flash.rowId)
    if (r < 0) return
    const c = Math.max(0, cols.findIndex(col => col.key === 'name' || col.key === 'ten'))
    reveal.current = true
    setSel({ a: { r, c }, f: { r, c } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashN, flash && flash.rowId])

  /* ---------- Sửa ô ---------- */
  function startEdit(r, c, initial, bar = false) {
    const e = flat[r]
    const col = cols[c]
    if (!canEdit(e, col)) return
    setEditing({ r, c, bar, value: initial === undefined ? rawText(e, col) : initial })
  }
  function commitEdit(dr = 0, dc = 0) {
    const ed = edRef.current
    if (!ed) return
    setEditing(null)
    const e = flat[ed.r]
    const col = cols[ed.c]
    if (e && col) {
      if (e.type === 'group') {
        const name = ed.value.trim()
        if (name && name !== e.g.name) {
          if (onRenameGroup) onRenameGroup(e.g, name)
          else commit('Đổi tên nhóm', gs => gs.map(g => (g.id === e.g.id ? { ...g, name } : g)))
        }
      } else commit(`Sửa ô ${A.colLetter(ed.c)}${e.n}`, gs => mapRows(gs, new Set([rid(e.r)]), r => A.applyEdit(r, col.key, ed.value), rid))
    }
    if (dr || dc) pick({ r: ed.r + dr, c: ed.c + dc }, undefined, true)
    if (gridRef.current) gridRef.current.focus({ preventScroll: true })
  }
  function cancelEdit() {
    setEditing(null)
    if (gridRef.current) gridRef.current.focus({ preventScroll: true })
  }
  function onEditKey(ev) {
    ev.stopPropagation()
    if (ev.key === 'Escape') { ev.preventDefault(); cancelEdit() } else if (ev.key === 'Tab') { ev.preventDefault(); commitEdit(0, ev.shiftKey ? -1 : 1) } else if (ev.key === 'Enter' && !ev.shiftKey && !ev.altKey) { ev.preventDefault(); commitEdit(1, 0) }
  }

  /* ---------- Định dạng ---------- */
  const anchorFmt = (anchorEntry && anchorCol && anchorEntry.type === 'item' && anchorEntry.r.fmt && anchorEntry.r.fmt[anchorCol.key]) || {}
  function setFmt(label, patch, merge = false) {
    commit(label, gs => mapRows(gs, selIds, r => {
      const fmt = { ...(r.fmt || {}) }
      selKeys.forEach(k => { fmt[k] = patch(fmt[k] || {}) })
      return { ...r, fmt }
    }, rid), merge)
  }
  function toggleFmt(flag) {
    const allOn = selItems.length > 0 && selItems.every(e => selKeys.every(k => e.r.fmt && e.r.fmt[k] && e.r.fmt[k][flag]))
    setFmt({ b: 'In đậm', i: 'In nghiêng', u: 'Gạch chân', wrap: 'Xuống dòng trong ô' }[flag], f => ({ ...f, [flag]: !allOn }))
  }
  function clearFmt() {
    commit('Xoá định dạng', gs => mapRows(gs, selIds, r => {
      if (!r.fmt || !selKeys.some(k => r.fmt[k])) return r
      const fmt = { ...r.fmt }
      selKeys.forEach(k => { delete fmt[k] })
      return { ...r, fmt }
    }, rid))
  }

  /* ---------- Thống kê vùng chọn ---------- */
  const stats = useMemo(() => {
    if (single) return null
    const nums = []
    let count = 0
    selEntries.forEach(e => selKeys.forEach(k => {
      if (A.entryText(e, k) !== '') count += 1
      if (e.type === 'item') { const n = A.cellNumber(e.r, k); if (n !== null) nums.push(n) }
    }))
    const sum = nums.reduce((s, n) => s + n, 0)
    return { sum, avg: nums.length ? sum / nums.length : 0, min: nums.length ? Math.min(...nums) : 0, max: nums.length ? Math.max(...nums) : 0, count }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, cols, range.r0, range.r1, range.c0, range.c1])

  /* ---------- Cắt / sao chép / dán ---------- */
  function copy() {
    const matrix = selEntries.map(e => selKeys.map(k => A.entryText(e, k)))
    clipRef.current = matrix
    try { navigator.clipboard.writeText(formatTable(matrix)).catch(() => {}) } catch {}
  }
  function clearCells(label) {
    if (onApplyEdits) {
      const cells = []
      selItems.forEach(e => selKeys.forEach(k => { if (A.editable(k, e.r)) cells.push({ id: rid(e.r), key: k, text: '' }) }))
      if (cells.length > 1) { onApplyEdits({ kind: 'clear', label, value: '' }, cells); return }
    }
    commit(label, gs => mapRows(gs, selIds, r => selKeys.reduce((row, k) => (A.editable(k, r) ? A.applyEdit(row, k, '') : row), r), rid))
  }
  function cut() { copy(); clearCells('Cắt') }
  /* Nút Dán: thử đọc bộ nhớ tạm của hệ thống; nếu trình duyệt chưa cấp quyền (hoặc đang hỏi) thì dùng vùng vừa sao chép trong bảng */
  async function paste() {
    let text = null
    try { text = await Promise.race([navigator.clipboard.readText(), new Promise(res => { setTimeout(() => res(null), 400) })]) } catch {}
    pasteMatrix(text ? parseTable(text) : clipRef.current)
  }
  /* Ctrl+V: dùng luôn nội dung trình duyệt đưa trong sự kiện paste, không cần xin quyền */
  function onPaste(ev) {
    if (edRef.current) return
    const text = ev.clipboardData ? ev.clipboardData.getData('text/plain') : ''
    if (!text) return
    ev.preventDefault()
    pasteMatrix(parseTable(text))
  }
  function pasteMatrix(matrix) {
    if (!matrix || !matrix.length) return
    /* Dán 1 ô vào vùng nhiều ô = điền cả vùng */
    const fill = matrix.length === 1 && matrix[0].length === 1 && !single
    const h = fill ? range.r1 - range.r0 + 1 : matrix.length
    const w = fill ? range.c1 - range.c0 + 1 : Math.max(...matrix.map(row => row.length))
    const edits = new Map()
    const renames = new Map()
    for (let i = 0; i < h; i++) {
      const e = flat[range.r0 + i]
      if (!e) break
      for (let j = 0; j < w; j++) {
        const col = cols[range.c0 + j]
        const text = fill ? matrix[0][0] : matrix[i][j]
        if (!col || text === undefined || !canEdit(e, col)) continue
        if (e.type === 'group') { if (text.trim()) renames.set(e.g.id, text.trim()) } else edits.set(rid(e.r), [...(edits.get(rid(e.r)) || []), [col.key, text]])
      }
    }
    if (onRenameGroup) {
      renames.forEach((name, gid) => { const g = groups.find(x => x.id === gid); if (g && name !== g.name) onRenameGroup(g, name) })
      renames.clear()
    }
    const cells = []
    edits.forEach((list, id) => list.forEach(([k, t]) => cells.push({ id, key: k, text: t })))
    if (onApplyEdits && cells.length > 1) {
      onApplyEdits({ kind: fill ? 'fill' : 'paste', label: 'Dán', value: fill ? matrix[0][0] : null }, cells)
      pick({ r: range.r0, c: range.c0 }, { r: range.r0 + h - 1, c: range.c0 + w - 1 })
      return
    }
    commit('Dán', gs => {
      const renamed = renames.size ? gs.map(g => (renames.has(g.id) && renames.get(g.id) !== g.name ? { ...g, name: renames.get(g.id) } : g)) : gs
      const base = renamed.some((g, i) => g !== gs[i]) ? renamed : gs
      return mapRows(base, new Set(edits.keys()), r => edits.get(rid(r)).reduce((row, [k, t]) => A.applyEdit(row, k, t), r), rid)
    })
    pick({ r: range.r0, c: range.c0 }, { r: range.r0 + h - 1, c: range.c0 + w - 1 })
  }

  /* ---------- Dòng ---------- */
  function insertRow() {
    const e = flat[F.r]
    if (!e || e.type === 'total' || e.synthetic) return
    if (onInsertRow) onInsertRow(e)
  }
  function duplicate() {
    if (!selItems.length) return
    if (onDuplicate) onDuplicate(selItems.map(e => rid(e.r)))
  }
  function deleteRows() {
    if (onDeleteRows) { onDeleteRows(selItems.map(e => rid(e.r))); return }
    /* Dòng nhóm đang chọn chỉ bị xoá khi nhóm đó trống (sau khi xoá) và vẫn còn nhóm khác */
    const groupIds = new Set(selEntries.filter(e => e.type === 'group' && !e.synthetic).map(e => e.g.id))
    if (!selIds.size && !groupIds.size) return
    commit('Xoá dòng', gs => {
      const cleaned = selIds.size ? gs.map(g => (g.rows.some(r => selIds.has(rid(r))) ? { ...g, rows: g.rows.filter(r => !selIds.has(rid(r))) } : g)) : gs
      const kept = cleaned.filter(g => !(groupIds.has(g.id) && g.rows.length === 0))
      const out = kept.length ? kept : cleaned
      return out.length === gs.length && out.every((g, i) => g === gs[i]) ? gs : out
    })
    pick({ r: range.r0, c: A0.c })
  }
  function sort(dir) {
    if (!anchorCol || anchorCol.key === 'stt' || anchorCol.key === 'image' || anchorCol.key === 'hinhAnh') return
    const key = anchorCol.key
    if (onSort) { onSort(key, dir > 0 ? 'asc' : 'desc', anchorCol.label); return }
    const val = r => (A.isNumeric(key) ? (A.cellNumber(r, key) ?? -Infinity) : A.cellText(r, key, ''))
    const cmp = (x, y) => {
      const a = val(x)
      const b = val(y)
      return dir * (typeof a === 'number' ? a - b : a.localeCompare(b, 'vi'))
    }
    commit(`Sắp xếp ${dir > 0 ? 'tăng' : 'giảm'} theo ${anchorCol.label}`, gs => {
      const out = gs.map(g => {
        const rows = [...g.rows].sort(cmp)
        return rows.every((r, i) => r === g.rows[i]) ? g : { ...g, rows }
      })
      return out.some((g, i) => g !== gs[i]) ? out : gs
    })
  }
  /* ---------- Tìm kiếm ---------- */
  const matches = useMemo(() => {
    const q = findQ.trim().toLowerCase()
    if (panel !== 'find' || !q) return []
    const out = []
    flat.forEach((e, r) => cols.forEach((c, i) => { if (A.entryText(e, c.key).toLowerCase().includes(q)) out.push({ r, c: i }) }))
    return out
  }, [findQ, panel, flat, cols, A])
  const hits = useMemo(() => new Set(matches.map(m => `${m.r}:${m.c}`)), [matches])
  const curHit = matches.length ? matches[((hitIdx % matches.length) + matches.length) % matches.length] : null
  function goHit(delta) {
    if (!matches.length) return
    const i = (((hitIdx + delta) % matches.length) + matches.length) % matches.length
    setHitIdx(i)
    pick(matches[i], undefined, true)
  }

  /* ---------- Hiển thị / xuất ---------- */
  const numW = plain ? 0 : A.rowNumWidth
  const tableWidth = cols.reduce((s, c) => s + c.w, numW)
  /* Vừa chiều rộng: bấm lần 1 = thu phóng cho bảng vừa khung; bấm lần 2 (vẫn đang ở mức vừa tính) = trả về 100%.
     Đã tự đổi thu phóng sau đó thì bấm lại = tính vừa khung lần nữa. */
  const fitRef = useRef(null)
  const fitOn = fitRef.current != null && zoom === fitRef.current && zoom !== 100
  function fitWidth() {
    if (fitOn) { fitRef.current = null; setZoom(100); return }
    if (!gridRef.current || !tableWidth) return
    const z = Math.max(30, Math.min(150, Math.floor((gridRef.current.clientWidth / tableWidth) * 100)))
    fitRef.current = z
    setZoom(z)
  }
  const priceShown = A.priceKeys.filter(k => !hiddenCols.has(k)).length
  function togglePrice() {
    const next = new Set(hiddenCols)
    A.priceKeys.forEach(k => { if (priceShown) next.add(k); else next.delete(k) })
    onHiddenCols(next)
  }
  function toggleCol(key) {
    const next = new Set(hiddenCols)
    if (next.has(key)) next.delete(key); else if (cols.length > 1) next.add(key)
    onHiddenCols(next)
  }
  function toggleColFilter() {
    if (colFilter) { setColFilter(null); return }
    if (!anchorEntry || !anchorCol || anchorEntry.type !== 'item') return
    setColFilter({ key: anchorCol.key, label: anchorCol.label, value: A.entryText(anchorEntry, anchorCol.key) })
  }
  const exportMatrix = () => [cols.map(c => c.label), ...flat.map(e => cols.map(c => A.entryText(e, c.key)))]
  function download() {
    if (onDownload) { onDownload(); return }
    const blob = new Blob([`﻿${formatTable(exportMatrix(), ',')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${fileName}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }
  function print() {
    const [head, ...body] = exportMatrix()
    const title = printTitle || fileName
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font:12px Arial,sans-serif;margin:16px} h3{margin:0 0 10px} table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #999;padding:4px 6px;vertical-align:top;white-space:pre-line;text-align:left}
      th{background:#1E2F52;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact} tr.g td{background:#eee;font-weight:bold}
    </style></head><body><h3>${esc(title)}</h3><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${
      body.map((row, i) => `<tr${flat[i].type === 'group' ? ' class="g"' : ''}>${row.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')
    }</tbody></table></body></html>`
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.focus()
    w.print()
  }

  /* ---------- Chuột & bàn phím trên lưới ---------- */
  const roomIdx = cols.findIndex(c => c.key === 'room' || c.key === 'khuVuc')
  const nameIdx = cols.findIndex(c => c.key === 'name' || c.key === 'ten')
  function onCellDown(r, c, ev) {
    if (ev.button !== 0) return
    if (edRef.current) commitEdit()
    onClearMark()
    dragSel.current = true
    if (ev.shiftKey) { setSel({ a: A0, f: { r, c } }); return }
    /* Tên nhóm chiếm cả hai cột Phòng + Tên sản phẩm */
    if (flat[r].type === 'group' && roomIdx >= 0 && nameIdx >= 0 && (c === roomIdx || c === nameIdx)) pick({ r, c: roomIdx }, { r, c: nameIdx })
    else pick({ r, c })
  }
  function onCellEnter(r, c, ev) {
    if (dragSel.current && ev.buttons === 1) setSel(s => ({ a: s.a, f: { r, c } }))
  }
  /* Chuột phải: chuột ngoài vùng chọn thì chọn ô đó (như bản gốc), rồi mở menu của bảng cha */
  function onCellContextMenu(r, c, ev) {
    if (!onCellContext) return
    ev.preventDefault()
    if (edRef.current) commitEdit()
    const inSel = r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1
    let ids = selItems.map(e => rid(e.r))
    if (!inSel) {
      pick({ r, c })
      ids = flat[r] && flat[r].type === 'item' ? [rid(flat[r].r)] : []
    }
    onCellContext({ entry: flat[r], col: cols[c], r, c, ev, ids, keys: inSel ? selKeys : [cols[c].key] })
  }
  function onKeyDown(ev) {
    if (edRef.current && !edRef.current.bar) return
    const k = ev.key
    if (ev.ctrlKey || ev.metaKey) {
      const map = {
        z: () => (ev.shiftKey ? sheet.redo() : sheet.undo()), y: sheet.redo, c: copy, x: cut,
        b: () => toggleFmt('b'), i: () => toggleFmt('i'), u: () => toggleFmt('u'),
        a: () => setSel({ a: { r: 0, c: 0 }, f: { r: maxR, c: maxC } }), f: () => onPanel('find'),
        ...(onReplaceAll ? { h: () => onPanel('find') } : null),
      }
      const fn = map[k.toLowerCase()]
      if (fn) { ev.preventDefault(); fn() }
      return
    }
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (arrows[k]) { ev.preventDefault(); move(arrows[k][0], arrows[k][1], ev.shiftKey) } else if (k === 'Tab') { ev.preventDefault(); move(0, ev.shiftKey ? -1 : 1, false) } else if (k === 'Enter' || k === 'F2') { ev.preventDefault(); startEdit(A0.r, A0.c) } else if (k === 'Delete' || k === 'Backspace') { ev.preventDefault(); clearCells('Xoá nội dung ô') } else if (k.length === 1 && !ev.altKey && canEdit(anchorEntry, anchorCol)) { ev.preventDefault(); startEdit(A0.r, A0.c, k) }
  }

  const togglePanel = name => onPanel(panel === name ? null : name)
  const wrapOn = wrapKey === 'wrap' ? !!anchorFmt.wrap : !anchorFmt.nowrap
  const addTools = (
    <>
      <GroupAdder existing={new Set(groupNames)} onAdd={onAddGroup} openKey={adderOpenKey} />
      <button className="qs-bd-add-row" onClick={onAddBlank} title={'Thêm hạng mục' + (targetName ? ' vào ' + targetName : '')}><Icon name="plusCircle" size={16} />Hạng mục</button>
    </>
  )
  const s = {
    canUndo: sheet.canUndo, canRedo: sheet.canRedo, fontSize, fmt: anchorFmt, showStats, stats, panel, frozen, compact, zoom,
    filterOn: filterText.trim() !== '', colFilterOn: Boolean(colFilter), favOnly, priceShown, full,
    fitOn, cols: colCount || { shown: cols.length, total: columns.length }, lastColor, wrapOn, hide: new Set([...(hideTools || []), 'import']), extraTools, leadTools, quick: quickTool,
    wrapTitle: wrapKey === 'wrap' ? 'Xuống dòng trong ô' : undefined,
    /* footerInTools: nút Thêm tầng / phòng + Thêm hạng mục lên khối công cụ (plainTools tự đặt st.addTools) thay cho chân bảng */
    addTools: footer && footerInTools ? addTools : null,
  }
  const a = {
    undo: sheet.undo, redo: sheet.redo, cut, copy, paste,
    fontDown: () => setFontSize(v => Math.max(9, v - 1)), fontUp: () => setFontSize(v => Math.min(20, v + 1)),
    toggleFmt, togglePanel, clearFmt,
    /* Kéo trong bảng màu bắn sự kiện liên tục: gộp thành một bước hoàn tác cho cùng vùng chọn */
    setColor: (key, value) => { setLastColor(c => ({ ...c, [key]: value })); setFmt(`${key === 'color' ? 'Màu chữ' : 'Màu nền'} ${refLabel}`, f => ({ ...f, [key]: value }), true) },
    align: v => setFmt('Căn lề', f => ({ ...f, align: f.align === v ? undefined : v })),
    toggleWrap: () => (wrapKey === 'wrap' ? toggleFmt('wrap') : setFmt('Xuống dòng tự động', f => ({ ...f, nowrap: !anchorFmt.nowrap }))),
    toggleStats: () => setShowStats(v => !v),
    insertRow, duplicate, deleteRows, sort, importFile: null,
    toggleFrozen: () => setFrozen(v => !v), toggleCompact: () => { setCompact(!compact); if (onViewMode) onViewMode(compact) }   /* onViewMode(true) = vừa bật xem tối ưu */,
    setZoom, zoomOut: () => setZoom(z => Math.max(30, z - 10)), fitWidth, print, download,
    toggleColFilter, toggleFav: () => setFavOnly(v => !v), togglePrice, toggleFull: onFull,
  }
  const barEditing = editing && editing.bar
  const formula = {
    ref: refLabel,
    value: editing ? editing.value : anchorEntry && anchorCol ? A.entryText(anchorEntry, anchorCol.key) : '',
    editable: canEdit(anchorEntry, anchorCol),
    onFocus: () => { if (!edRef.current) startEdit(A0.r, A0.c, undefined, true) },
    onChange: value => { if (edRef.current) setEditing({ ...edRef.current, value }) },
    onKeyDown: ev => { if (ev.key === 'Enter') { ev.preventDefault(); ev.target.blur() } else if (ev.key === 'Escape') { ev.preventDefault(); cancelEdit(); ev.target.blur() } },
    onBlur: () => { if (barEditing) commitEdit() },
  }

  /* plainTools: bảng tự vẽ khối công cụ riêng cho Bảng thường; không có thì Bảng thường dùng chung thanh công cụ (không ô công thức) */
  const tools = plain && plainTools ? plainTools(a, s) : <SheetToolbar s={s} a={a} formula={plain ? null : formula} />
  return (
    <>
      {/* toolsSlot: trang gọi có khung riêng cho thanh công cụ (Bóc tách: module tách khỏi bảng) thì vẽ vào đó */}
      {toolsSlot ? createPortal(tools, toolsSlot) : tools}

      {/* colsPanel === false: trang gọi tự vẽ dải chip cột ở chỗ khác (Bóc tách: ngay dưới hàng đầu bảng) */}
      {panel && !(panel === 'cols' && colsPanel === false) && (
        <div className="qs-bd-strip">
          {panel === 'find' && (
            <>
              <span className="qs-bd-strip-label">Tìm</span>
              <input
                autoFocus className="qs-bd-strip-input" value={findQ} placeholder="Nội dung cần tìm…"
                onChange={e => { setFindQ(e.target.value); setHitIdx(0) }}
                onKeyDown={e => { if (e.key === 'Enter') goHit(e.shiftKey ? -1 : 1); else if (e.key === 'Escape') onPanel(null) }}
              />
              <span className="qs-bd-strip-note">{matches.length ? `${matches.indexOf(curHit) + 1}/${matches.length}` : findQ.trim() ? 'Không thấy' : ''}</span>
              <button className="qs-bd-strip-btn" onClick={() => goHit(-1)}>Trước</button>
              <button className="qs-bd-strip-btn" onClick={() => goHit(1)}>Sau</button>
              {onReplaceAll && (
                <>
                  <span className="qs-bd-strip-note">→</span>
                  <input className="qs-bd-strip-input" value={repQ} placeholder="Thay bằng…"
                    onChange={e => setRepQ(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') onReplaceAll(findQ, repQ); else if (e.key === 'Escape') onPanel(null) }} />
                  <button className="qs-bd-strip-btn" onClick={() => onReplaceAll(findQ, repQ)}>Thay tất cả</button>
                </>
              )}
            </>
          )}
          {panel === 'filter' && (
            <>
              <span className="qs-bd-strip-label">Lọc dòng</span>
              <input autoFocus className="qs-bd-strip-input" value={filterText} placeholder="Chỉ hiện dòng có chứa…" onChange={e => setFilterText(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') onPanel(null) }} />
              <span className="qs-bd-strip-note">{selItemsCount(flat)} dòng đang hiện</span>
              <button className="qs-bd-strip-btn" onClick={() => setFilterText('')}>Bỏ lọc</button>
            </>
          )}
          {panel === 'cols' && (colsPanel || (
            <>
              <span className="qs-bd-strip-label">Cột hiển thị</span>
              {columns.map(c => <button key={c.key} className={`qs-bd-strip-chip qs-colchip${hiddenCols.has(c.key) ? '' : ' on'}`} aria-pressed={!hiddenCols.has(c.key)} onClick={() => toggleCol(c.key)}>{c.label}</button>)}
              <button className="qs-bd-strip-btn" onClick={() => onHiddenCols(new Set())}>Hiện tất cả</button>
            </>
          ))}
          {panel === 'history' && (
            <>
              <span className="qs-bd-strip-label">Lịch sử</span>
              {!sheet.labels.length && <span className="qs-bd-strip-note">Chưa có thao tác nào.</span>}
              {sheet.labels.map((label, i) => ({ label, i })).reverse().map(({ label, i }) => (
                <button key={i} className="qs-bd-strip-chip" title="Quay về trước thao tác này" onClick={() => sheet.jumpTo(i)}>{i + 1}. {label}</button>
              ))}
            </>
          )}
          <span style={{ flex: 1 }} />
          <button className="qs-bd-strip-close" title="Đóng" onClick={() => onPanel(null)}><Icon name="x" size={15} /></button>
        </div>
      )}
      {colFilter && (
        <div className="qs-bd-strip slim">
          <span className="qs-bd-strip-note">Đang lọc {colFilter.label} = “{colFilter.value || 'trống'}”</span>
          <button className="qs-bd-strip-btn" onClick={() => setColFilter(null)}>Bỏ lọc</button>
        </div>
      )}

      <SheetGrid
        gridRef={gridRef} flat={flat} cols={cols} plain={plain} frozen={frozen} fontSize={fontSize + 1} compact={compact} zoom={zoom / 100}
        range={range} anchor={A0} editing={editing} hits={hits} hitKey={curHit ? `${curHit.r}:${curHit.c}` : ''} dropMark={dropMark} flashRowId={flash && flash.mark ? flash.rowId : null}
        onCellDown={onCellDown} onCellEnter={onCellEnter} onCellDouble={(r, c) => startEdit(r, c)}
        onEditChange={value => setEditing({ ...edRef.current, value })} onEditKey={onEditKey} onEditBlur={() => commitEdit()}
        onToggleGroup={onToggleGroupOverride || (id => sheet.patch(gs => gs.map(g => (g.id === id ? { ...g, collapsed: !g.collapsed } : g))))}
        rowClass={rowClass} letters={letters}
        onSelectRow={(r, ev) => { if (!ev.currentTarget.draggable) ev.preventDefault(); if (ev.shiftKey) setSel({ a: { r: A0.r, c: 0 }, f: { r, c: maxC } }); else pick({ r, c: 0 }, { r, c: maxC }); if (gridRef.current) gridRef.current.focus({ preventScroll: true }) }}
        onSelectCol={(c, ev) => { ev.preventDefault(); if (ev.shiftKey) setSel({ a: { r: 0, c: A0.c }, f: { r: maxR, c } }); else setSel({ a: { r: 0, c }, f: { r: maxR, c } }); if (gridRef.current) gridRef.current.focus({ preventScroll: true }) }}
        onSelectAll={ev => { ev.preventDefault(); setSel({ a: { r: 0, c: 0 }, f: { r: maxR, c: maxC } }); if (gridRef.current) gridRef.current.focus({ preventScroll: true }) }}
        onKeyDown={onKeyDown} onPaste={onPaste}
        rowId={rid} entryText={A.entryText} colLetter={A.colLetter} rowNumWidth={A.rowNumWidth}
        renderCell={renderCell} onCellContext={onCellContext ? onCellContextMenu : undefined} onColMenu={onColMenu} colMarks={colMarks}
        rowDrag={rowDrag} rowHeights={rowHeights} onRowHeight={onRowHeight} onGroupHeight={onGroupHeight} onHeadHeight={onHeadHeight} frozenRows={frozenRows} gridClass={gridClass} emptyNode={emptyNode} datalists={datalists}
        roman={A.roman} onColResize={onColResize} onColMove={onColMove} rowAction={rowAction} emptyReplace={emptyReplace} plainFmt={plainFmt} fitCols={fitCols}
      />
      {dropHint && <div className="qs-bd-drop-hint">{dropHint}</div>}
      {footer && !footerInTools && <div className="qs-bd-foot">{addTools}</div>}
    </>
  )
}

const selItemsCount = flat => flat.filter(e => e.type === 'item').length
