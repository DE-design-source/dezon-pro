import { useCallback, useMemo, useRef, useState } from 'react'
import SheetBody from '../breakdown/SheetBody'
import { colLetter, ROW_NUM_WIDTH } from '../breakdown/sheet/tkModel'
import '../breakdown/sheet/sheet.css'
import QsIcon from '../common/QsIcon'
import Icon from '../../../../components/ui/Icon'
import { qsToast as toast } from '../common/dialogs'
import { money, tkNum_ } from '../../lib/format.js'
import { PT_ROMAN } from '../../lib/phantho.js'
import { lineFmt_, setLineFmt_ } from '../../lib/sheetModel.js'
import { useQsStore, getState } from '../../state/store'
import { projDataSet_ } from '../../state/projData'
import {
  PT_COLS, PT_CELL_F, PT_NUM_K, ptVisCols_, ptW_, ptSortItems_, ptRowPass_, ptSheetSecVals_, ptSheetItemVals_, ptSheetSua_, ptKeyLabel_,
} from './ptModel'
import { usePtUi, setPtUi, ptUi } from './ptState'
import * as A from './ptActions'
import { PtSheetMenu } from './PtMenus'

/* Bảng ước tính Phần thô - chế độ "Bảng tính" (bản gốc: Jspreadsheet, PUB/bangtinh.js:306-382 ptSheetGrid_ / ptSheetSua_ /
   renderPTSheet_ / ptSheetGhi_ / ptSheetRefresh_, khung btFrame_('pt') 826-866, menu btMenuChung_('pt') 769-787).
   Ở đây dùng lại khung bảng tính của clone (SheetBody/SheetGrid) với "mặt tiền" riêng: nhóm = hạng mục Phần thô, dòng = công tác.
   Ô sửa ghi bằng đúng ptEdit của bảng thường (qua ptSheetWrite); ô không sửa được theo kiểu tính của nhóm thì bỏ qua (ptSheetSua_).
   Hoàn tác / làm lại chỉ lùi các ô người dùng gõ (như onundo của Jspreadsheet); thêm / xoá / kéo dòng xoá lịch sử.
   Định dạng ô lưu projData.btFmt khoá 'pt:<si>:<ii>' như bản gốc (btFmtKey_).
   Props: data = usePhanTho(), tpl, visible (dải chip cột: PtColsModule ở BreakdownTab). */

const NO_FAVS = new Set()
const NO_HIDDEN = new Set()
const INITIAL_SEL = { a: { r: 0, c: 0 }, f: { r: 0, c: 0 } }
// Cột Nội dung công việc mang khoá 'ten' trong lưới để dòng nhóm hiện / sửa tên hạng mục ở đúng cột đó (SheetGrid nameCol)
const K = k => (k === 'noidung' ? 'ten' : k)
const P = k => (k === 'ten' ? 'noidung' : k)
const idOf = (si, ii) => 'pt:' + si + ':' + ii
const parseId = id => { const a = String(id).split(':'); return { si: +a[1], ii: +a[2] } }
const mapKeys = (o, fn) => { if (!o) return o; const r = {}; Object.keys(o).forEach(k => { r[fn(k)] = o[k] }); return r }
const collapsed = {}   // gập nhóm theo dự án (chỉ hiển thị)

export default function PtSheet({ data, tpl, visible, tools, toolsSlot = null, plain = false }) {
  const { phanTho, comp, maDA } = data
  const ui = usePtUi()
  const btFmt = useQsStore(s => (s.projData && s.projData.btFmt) || null)
  const hist = A.ptHistOf(maDA)
  const [panel, setPanel] = useState(null)
  const [full, setFull] = useState(false)
  const [pop, setPop] = useState(null)
  const [, setCv] = useState(0)
  const sheetApi = useRef(null)
  const sheetEl = useRef(null)
  const cKey = maDA

  const col = collapsed[cKey] || {}

  const vis = useMemo(() => ptVisCols_(ui.order, ui.cols), [ui.order, ui.cols])
  const columns = useMemo(() => vis.map((c, i) => ({
    key: K(c[0]), label: c[1] + (ui.sort === c[0] ? (ui.sortDir === 'desc' ? ' ▼' : ' ▲') : ''), w: ptW_(ui.colW, c),
    align: c[2] === 'n' ? 'right' : (c[2] === 'c' ? 'center' : undefined), pin: i < 2,
  })), [vis, ui.colW, ui.sort, ui.sortDir])

  const groups = useMemo(() => phanTho.map((sec, si) => {
    const sv = ptSheetSecVals_(sec, si, comp.sections[si])
    const rows = ptSortItems_(sec.items, ui.sort, ui.sortDir).filter(r => ptRowPass_(ui.filter, sec, r.it)).map((r, pos) => {
      const id = idOf(si, r.oi)
      const fm = lineFmt_(btFmt, id)
      return { id, si, ii: r.oi, vals: ptSheetItemVals_(sec, r.it, pos), fmt: fm ? mapKeys(fm, K) : undefined }
    })
    return { id: 's' + si, si, name: String(sec.t || ''), collapsed: !!col[si], rows, cells: mapKeys(sv, K) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [phanTho, comp, ui.sort, ui.sortDir, ui.filter, btFmt, col])
  const ref = useRef(groups)
  ref.current = groups

  const flatten = useCallback((gs, pred) => {
    const out = []; let n = 0
    gs.forEach(g => {
      n += 1
      out.push({ type: 'group', gi: g.si, n, g, count: g.rows.length, cells: g.cells })
      if (g.collapsed) return
      g.rows.forEach((r, ri) => {
        if (pred && !pred(r, r.vals.stt)) return
        n += 1
        out.push({ type: 'item', g, gi: g.si, r, ri, n, stt: r.vals.stt })
      })
    })
    return out
  }, [])

  const adapter = useMemo(() => ({
    rowId: r => r.id,
    cellText: (r, k) => String(r.vals[P(k)] == null ? '' : r.vals[P(k)]),
    editText: (r, k) => String(r.vals[P(k)] == null ? '' : r.vals[P(k)]),
    applyEdit: (r, k, text) => {
      const f = ptSheetSua_(phanTho, { k: 'it', si: r.si }, P(k))
      if (!f) {                                     // ô chỉ đọc theo kiểu tính của nhóm: không ghi, báo (chữ của ptBulkEditRun_ 1464)
        if (String(text) !== '') toast('Cột này không sửa được')
        return r
      }
      return { ...r, vals: { ...r.vals, [P(k)]: text }, edits: (r.edits || []).concat([[f, text]]) }
    },
    cellNumber: (r, k) => (PT_NUM_K[P(k)] && String(r.vals[P(k)] || '') !== '' ? tkNum_(r.vals[P(k)]) : null),
    entryText: (e, k) => {
      if (e.type === 'item') return String(e.r.vals[P(k)] == null ? '' : e.r.vals[P(k)])
      if (e.type === 'group') return k === 'stt' ? (PT_ROMAN[e.gi] || String(e.gi + 1)) : (k === 'ten' ? e.g.name : ((e.cells && e.cells[k]) || ''))
      return ''
    },
    colLetter,
    // ô sửa được theo kiểu tính của nhóm (ptSheetSua_, ro.push bangtinh.js:351-353); SheetBody truyền dòng của từng ô
    editable: (k, r) => {
      if (!PT_CELL_F[P(k)]) return false
      return r ? !!ptSheetSua_(phanTho, { k: 'it', si: r.si }, P(k)) : true
    },
    isNumeric: k => !!PT_NUM_K[P(k)],
    isFav: () => false,
    priceKeys: [],
    rowNumWidth: ROW_NUM_WIDTH,
    roman: gi => PT_ROMAN[gi] || String(gi + 1),
  }), [phanTho])

  /* commit(label, fn): so trước / sau -> ô sửa (ptSheetWrite), định dạng (btFmt), gập nhóm */
  const setCollapsedFrom = gs => {
    const next = {}; gs.forEach(g => { if (g.collapsed) next[g.si] = true })
    const before = collapsed[cKey] || {}
    if (Object.keys({ ...before, ...next }).some(k => !!before[k] !== !!next[k])) { collapsed[cKey] = next; setCv(v => v + 1) }
  }
  const apply = (label, before, after) => {
    setCollapsedFrom(after)
    const cells = []
    let fmtAll = null
    after.forEach((g, gi) => {
      const og = before[gi]; if (!og || og === g) return
      g.rows.forEach((r, ri) => {
        const o = og.rows[ri]; if (!o || o === r) return
        ;(r.edits || []).forEach(x => cells.push({ si: r.si, ii: r.ii, f: x[0], val: x[1] }))
        if (r.fmt !== o.fmt) {
          fmtAll = setLineFmt_(fmtAll || ((getState().projData || {}).btFmt) || {}, r.id, mapKeys(r.fmt || {}, P))
        }
      })
    })
    if (fmtAll) projDataSet_('btFmt', fmtAll)
    if (cells.length) A.ptSheetWrite(cells, label)
  }
  const facade = {
    groups,
    commit: (label, fn) => { const b = ref.current, a = fn(b); if (a !== b) apply(label, b, a); return Promise.resolve() },
    patch: fn => { const b = ref.current, a = fn(b); if (a !== b) apply('', b, a); return Promise.resolve() },
    undo: () => A.ptUndo('undo'), redo: () => A.ptUndo('redo'),
    jumpTo: i => { let n = hist.past.length - i; while (n-- > 0) A.ptUndo('undo') },
    canUndo: hist.past.length > 0, canRedo: hist.future.length > 0, labels: hist.past.map(p => p.label),
  }

  const cellsOf = list => list.map(c => {
    const { si, ii } = parseId(c.id)
    const f = ptSheetSua_(phanTho, { k: 'it', si }, P(c.key))
    return f ? { si, ii, f, val: c.text } : null
  }).filter(Boolean)
  // vùng chữ nhật đang chọn: các dòng (theo thứ tự trên lưới) x các cột
  function selRect() {
    const host = sheetEl.current
    if (!host) return null
    let tds = host.querySelectorAll('td.in-range')
    if (!tds.length) tds = host.querySelectorAll('td.anchor')
    const trs = [], cs = []
    tds.forEach(td => { if (trs.indexOf(td.parentElement) < 0) trs.push(td.parentElement); if (cs.indexOf(+td.dataset.c) < 0) cs.push(+td.dataset.c) })
    const rows = trs.map(tr => (tr.dataset.row ? { id: tr.dataset.row } : (tr.dataset.group ? { gid: tr.dataset.group } : null))).filter(Boolean)
    const keys = cs.sort((a, b) => a - b).map(i => columns[i] && columns[i].key).filter(Boolean)
    return rows.length && keys.length ? { rows, keys } : null
  }
  function textOf(x, k) {
    if (x.id) {
      const r = groups.reduce((f, g) => f || g.rows.filter(y => y.id === x.id)[0], null)
      return r ? String(r.vals[P(k)] == null ? '' : r.vals[P(k)]) : ''
    }
    const g = groups.filter(y => y.id === x.gid)[0]
    if (!g) return ''
    return k === 'stt' ? (PT_ROMAN[g.si] || String(g.si + 1)) : (k === 'ten' ? g.name : String((g.cells && g.cells[k]) || ''))
  }
  function replaceAll(q, rep) {
    if (!q) { toast('Nhập từ cần tìm'); return }
    const cells = []; const doi = {}
    phanTho.forEach((sec, si) => (sec.items || []).forEach((it, ii) => {
      ;['n', 'dvt', 'gc'].forEach(f => { const v = String(it[f] == null ? '' : it[f]); if (v.indexOf(q) >= 0) { cells.push({ si, ii, f, val: v.split(q).join(rep) }); doi[si + '|' + ii] = 1 } })
    }))
    const m = Object.keys(doi).length
    if (m) A.ptSheetWrite(cells, 'Thay thế')
    toast(m ? ('Đã thay ở ' + m + ' dòng') : 'Không tìm thấy “' + q + '”')
  }
  const delIds = async ids => {
    if (!ids.length) { toast('Chọn ô ở các dòng cần xoá'); return }
    await A.ptDelMany(ids.map(parseId), { title: 'Xoá ' + ids.length + ' dòng công tác đã chọn?', nguyHiem: true, ok: 'Xoá' })
  }
  const sortBy = (key, dir) => {
    setPtUi({ sort: key, sortDir: dir })
    toast('Sắp xếp ' + (dir === 'asc' ? 'A → Z' : 'Z → A') + ' theo "' + ptKeyLabel_(key) + '"')
  }

  /* Ô đơn giá chung của nhóm 'area' sửa ngay trên dòng nhóm (ptSheetSua_: sec + dg -> up) */
  const renderCell = (e, c) => {
    if (e.type !== 'group' || c.key !== 'dg') return undefined
    const sec = phanTho[e.gi]; if (!sec || sec.mode !== 'area') return undefined
    const shown = Number(sec.up) ? money(sec.up) : ''
    return (
      <input key={shown} className="qspt-in qspt-money qspt-upin" type="text" inputMode="numeric" defaultValue={shown}
        onMouseDown={ev => ev.stopPropagation()} onKeyDown={ev => { ev.stopPropagation(); if (ev.key === 'Enter') ev.currentTarget.blur() }}
        onBlur={ev => { if (ev.target.value !== shown) A.ptSheetWrite([{ si: e.gi, ii: -1, f: 'up', val: ev.target.value }], 'Sửa đơn giá nhóm') }} />
    )
  }
  /* Góc phải thanh công cụ (chỗ nút Thêm tầng / Hạng mục của tab Thiết bị đèn): Xoá hết + Thêm hạng mục Phần thô */
  const addNode = (<>
    <button className="qs-bd-tb-btn" title="Xoá hết bảng Phần thô" onMouseDown={e => e.preventDefault()} onClick={A.ptReset}><Icon name="trash" size={18} /></button>
    <button className="qs-bd-add-row" title="Thêm hạng mục Phần thô" onClick={A.ptAddSection}><Icon name="plusCircle" size={16} />Hạng mục</button>
  </>)

  return (
    <div className="qspt-wrap">
      <div className={`qs-card qs-bd-sheet qspt-sheet${full ? ' full' : ''}`} ref={sheetEl}>
        <SheetBody
          sheet={facade}
          plain={plain}
          toolsSlot={full ? null : toolsSlot}
          hiddenCols={NO_HIDDEN} onHiddenCols={() => {}}
          panel={panel} onPanel={setPanel}
          favorites={NO_FAVS}
          onTarget={() => {}} onAddRow={() => {}}
          full={full} onFull={() => setFull(f => !f)} onClearMark={() => {}}
          fileName={'phan-tho-' + maDA}
          printTitle={'Bảng ước tính chi phí — Xây dựng thô'}
          columns={columns} flatten={flatten} initialSel={INITIAL_SEL}
          footerInTools addNode={addNode}
          adapter={adapter} wrapKey="wrap" hideTools={['import', 'csv', 'fav', 'cols']} extraTools={tools}
          onRenameGroup={(g, name) => A.ptSheetWrite([{ si: g.si, ii: -1, f: 't', val: name }], 'Đổi tên hạng mục')}
          onInsertRow={e => (e.type === 'item' ? A.ptInsertItem(e.r.si, e.r.ii) : (e.type === 'group' ? A.ptAddItem(e.gi) : null))}
          onDuplicate={ids => A.ptDupMany(ids.map(parseId))}
          onSort={(key, dir) => sortBy(P(key), dir)}
          onDownload={() => A.ptExportXlsx(tpl)}
          onReplaceAll={replaceAll}
          onApplyEdits={(info, cells) => A.ptSheetWrite(cellsOf(cells), info.label || 'Dán')}
          onDeleteRows={delIds}
          onCellContext={ctx => setPop({ at: { x: ctx.ev.clientX, y: ctx.ev.clientY }, entry: ctx.entry, col: ctx.col, ids: ctx.ids })}
          apiRef={sheetApi}
          onColResize={(key, w) => setPtUi(s => ({ colW: { ...s.colW, [P(key)]: w } }))}
          onColMove={(from, to, before) => {
            if (from === 'stt' || to === 'stt') return
            const ord = (ptUi().order || PT_COLS.map(c => c[0])).filter(x => x !== P(from))
            let i = ord.indexOf(P(to)); if (i < 0) i = ord.length; else if (!before) i++
            ord.splice(i, 0, P(from)); setPtUi({ order: ord })
          }}
          renderCell={renderCell} plainFmt={false}
          gridClass={`qs-tk-grid qspt-sgrid${plain ? ' qs-tk-plain' : ''}`}
          emptyNode={plain
            ? <div className="qs-tk-emptyrow">Bảng đang trống. Chọn hạng mục từ danh sách bên trái — bấm ＋ để thêm từng công tác, hoặc ＋ ở tên nhóm để thêm cả nhóm.</div>
            : <div className="qs-tk-empty qspt-sheet-empty"><QsIcon name="layers" size={30} /><b>Bảng đang trống</b><span>Chọn hạng mục từ danh sách bên trái — bấm ＋ để thêm từng công tác, hoặc ＋ ở tên nhóm để thêm cả nhóm.</span></div>}
          emptyReplace={!plain}
          colCount={{ shown: vis.length, total: PT_COLS.length }}
        />
      </div>
      {visible && pop && (
        <PtSheetMenu at={pop.at} colKey={pop.col ? P(pop.col.key) : ''}
          m={pop.entry ? (pop.entry.type === 'item' ? { k: 'it', si: pop.entry.r.si, ii: pop.entry.r.ii } : (pop.entry.type === 'group' ? { k: 'sec', si: pop.entry.gi } : null)) : null}
          act={{
            insert: () => { const e = pop.entry; if (e && e.type === 'item') A.ptInsertItem(e.r.si, e.r.ii) },
            dup: () => { const ids = pop.ids && pop.ids.length ? pop.ids : (pop.entry && pop.entry.type === 'item' ? [pop.entry.r.id] : []); if (!ids.length) { toast('Chọn ô ở các dòng cần nhân bản'); return } A.ptDupMany(ids.map(parseId)) },
            del: () => delIds(pop.ids && pop.ids.length ? pop.ids : (pop.entry && pop.entry.type === 'item' ? [pop.entry.r.id] : [])),
            sort: sortBy,
            // btDienVung_ (bangtinh.js:229-233): ô ĐẦU của từng cột trong vùng -> các ô bên dưới, bỏ ô chỉ đọc
            fill: () => {
              const v = selRect()
              if (!v || v.rows.length < 2) { toast('Chọn vùng từ ô nguồn kéo xuống các ô cần điền'); return }
              const list = []
              v.keys.forEach(k => {
                const val = textOf(v.rows[0], k)
                list.push(...cellsOf(v.rows.slice(1).filter(x => x.id).map(x => ({ id: x.id, key: k, text: val }))))
              })
              if (!list.length) { toast('Vùng chọn không có ô sửa được'); return }
              A.ptSheetWrite(list, 'Điền xuống'); toast('Đã điền xuống ' + list.length + ' ô')
            },
            // btCopy_ (bangtinh.js:235-238): chép cả vùng chữ nhật, dạng Excel (tab giữa cột, xuống dòng giữa hàng)
            copy: () => {
              const v = selRect()
              if (!v) { toast('Chọn vùng ô trước'); return }
              const q = s => (/["\n\t]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s)
              A.ctxCopy_(v.rows.map(x => v.keys.map(k => q(textOf(x, k))).join('\t')).join('\n'))
              toast('Đã sao chép vùng chọn')
            },
            find: () => setPanel('find'),
          }}
          onClose={() => setPop(null)} />
      )}
    </div>
  )
}
