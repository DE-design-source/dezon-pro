import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { useQs } from '../state/QsData'
import { useLinesSheet } from '../state/useLinesSheet'
import SheetBody from './breakdown/SheetBody'
import ProductThumb from './common/ProductThumb'
import ImgViewer from './common/ImgViewer'
import ProductModal from './purchase/ProductModal'
import DocsPopover from './common/DocsPopover'
import { mediaUrl } from '../api/files'
import { useTkCols, setColW } from './breakdown/sheet/tkCols'
import { RecentPop, PriceSyncModal } from './breakdown/sheet/SyncPops'
import * as bocAct from './breakdown/sheet/bocActions'
import './breakdown/sheet/sheet.css'
import { useFold, foldToggle_, projCtx_, usePdState, pdRetry_ } from './project/projectShell'
import PageHead, { Stat, VatStat, PtNote, LacNote, SaiNote, PtErrNote } from './cost/PageHead'
import { ColFrame, ColChips, ColChipsModule, PresetPop, PresetDock } from './cost/ColTools'
import { useQbSlotEl, useQbQuery, setQbQuery } from './project/qbSlot'
import CpCtxMenu from './cost/CpCtxMenu'
import TickStt from './cost/TickStt'
import TickBar from './cost/TickBar'
import { useColSet, setColsMap, moveCol, toggleCol } from './cost/cpCols'
import { sheetColumns, lineAdapter, daSearch_, daGroups_, daFlatten, daXlsxBody } from './cost/lineSheet'
import { applyCells, exportBang, dropRow, fillDown, replaceAll, copySel } from './cost/costActions'
import { useTicks, tickClick_ } from '../state/tickSel'
import './cost/cost.css'
import { DA_KEYS, PHONG_LIST, cpLabel_ } from '../lib/columns.js'
import { money } from '../lib/format.js'
import { daScope_, daTotals_, cpTong_ } from '../lib/totals.js'
import { lineDocs_ } from '../lib/productFields.js'
import { giaLechList_, spOfLine_ } from '../lib/bocSync.js'
import { CHUA_PHAN_TANG } from '../lib/sheetModel.js'

const TAB = 'duan'
const INITIAL_SEL = { a: { r: 0, c: 0 }, f: { r: 0, c: 0 } }
const NO_FAVS = new Set()
const DATALISTS = { khuVuc: PHONG_LIST }
const dong = n => `${money(n)} đ`
const img1 = v => mediaUrl(String(v || '').split('\n')[0].trim())

function lsGet(k) { try { return localStorage.getItem(k) } catch (e) { return null } }
function lsSet(k, v) { try { localStorage.setItem(k, v) } catch (e) { /* bỏ qua */ } }
const btMode = () => (lsGet('qs_bt_mode') === 'cu' ? 'plain' : 'sheet')

/* Tab "Dự án" (port PUB/duan.js, bangtinh.js:741-760): mọi dòng của hạng mục dùng chung (hmNode, '' = tất cả) gom theo tầng
   (tầng giữ thứ tự của dự án, bỏ tầng trống), dòng tầng mang tổng tầng, dòng TỔNG cuối. Dải tổng = cpTong_ (như Chi phí);
   chân bảng = đúng các dòng đang hiện. Ô tìm, sắp xếp trong từng tầng, kéo đổi chỗ cột / dòng / tầng, bộ cột daCols
   ("Của tôi" lưu theo tài khoản), Excel du-an-<maDA>.xlsx. Ô sửa dùng chung với Bóc tách (useLinesSheet({hm})). */
export default function ProjectsTab() {
  const qs = useQs()
  const { cur, lines, products, projData, hmNode, setHmNode, mutate, toast, navigate, status } = qs
  const visible = qs.panelVisible(TAB)
  const seq = qs.visibleSeq(TAB)
  const facade = useLinesSheet({ hm: hmNode })
  const colSet = useColSet('da')
  const tkCols = useTkCols()
  const pd = usePdState(cur, status)
  const foldCols = useFold('cols')
  const [dock, setDock] = useState(false)   // khung "Chọn nhanh cột" bên trái vùng bảng (nút bộ cột trên băng)
  const colsOnBar = !!useQbSlotEl('pc:duan')    // băng dự án mở rộng: Cột hiển thị lên băng (PageHead)
  const foldTools = useFold('tools')
  const ticks = useTicks(cur && cur.maDA)
  const sheetBox = useRef(null)

  const [view, setViewState] = useState(btMode)
  // chữ tìm = ô tìm của thanh công cụ nhanh (QuickBar, Ctrl K) - gộp 2 ô tìm làm 1
  const q = useQbQuery('duan')
  const setQ = v => setQbQuery('duan', v)
  const [sort, setSort] = useState({ key: '', dir: 'asc' })
  const [closed, setClosed] = useState(() => new Set())
  const [panel, setPanel] = useState(null)
  const [full, setFull] = useState(false)
  const [pop, setPop] = useState(null)
  const [xls, setXls] = useState(false)
  const [flash, setFlash] = useState(null)
  const [imgView, setImgView] = useState('')
  const [xemSP, setXemSP] = useState(null)        // xem nhanh SP của 1 dòng (ảnh lớn + thông số), bấm ảnh dòng để mở

  useEffect(() => { if (visible) setViewState(btMode()) }, [visible, seq])
  function setView(v) {
    if (v === view) return
    setViewState(v); lsSet('qs_bt_mode', v === 'plain' ? 'cu' : 'moi')
    toast(v === 'plain' ? 'Đã chuyển sang Bảng thường' : 'Đã chuyển sang Bảng tính')
  }

  /* ---- Dòng: hạng mục (dải tổng) -> ô tìm (chỉ lọc bảng) -> gom tầng + sắp trong tầng ---- */
  const ctx = projCtx_(cur, projData)
  const scope = useMemo(() => daScope_(lines, hmNode), [lines, hmNode])
  const visibleLines = useMemo(() => daSearch_(scope, q), [scope, q])
  const TT = daTotals_(scope, visibleLines, hmNode, ctx)
  const ptErr = cpTong_(scope, hmNode, ctx).ptErr
  const plain = view === 'plain'
  const dg = useMemo(() => daGroups_(visibleLines, cur, lines, sort.key, sort.dir), [visibleLines, cur, lines, sort])
  const pending = pd.err
    ? <button type="button" className="qs-cp-retry" title={pd.err} onClick={() => pdRetry_(cur.maDA)}>Lỗi tải dữ liệu · Thử lại</button>
    : <span className="qs-cp-wait">{pd.slow ? 'Đang tải… (lâu hơn thường lệ)' : 'Đang tải…'}</span>

  /* ---- Cột ---- */
  const keys = colSet.order.filter(k => colSet.cols[k])
  const firstKey = keys[0] || 'ten'
  const columns = useMemo(() => sheetColumns(colSet.order, colSet.cols, tkCols.w, sort.key, sort.dir), [colSet, tkCols.w, sort])
  const hiddenCols = useMemo(() => new Set(DA_KEYS.filter(k => !colSet.cols[k])), [colSet.cols])
  const onHiddenCols = useCallback(set => { const m = {}; DA_KEYS.forEach(k => { m[k] = !set.has(k) }); setColsMap('da', m) }, [])
  const adapter = useMemo(() => lineAdapter(r => { const p = spOfLine_(r, products); return !!(p && p.yeuThich) }), [products])
  const flatten = useCallback((gs, pred) => {
    if (!visibleLines.length) return []
    if (!pred) return daFlatten(dg, visibleLines, firstKey, closed, plain)
    const kept = visibleLines.filter(l => pred(l, ''))
    const d2 = { order: dg.order.filter(g => dg.groups[g].some(l => pred(l, ''))), groups: {} }
    d2.order.forEach(g => { d2.groups[g] = dg.groups[g].filter(l => pred(l, '')) })
    return daFlatten(d2, kept, firstKey, closed, plain)
  }, [dg, visibleLines, firstKey, closed, plain])
  const tickSet = useMemo(() => new Set(ticks), [ticks])
  const tickLines = useMemo(() => (ticks.length ? lines.filter(l => tickSet.has(l.lineId)) : []), [lines, ticks, tickSet])
  const shownIds = useMemo(() => (plain ? dg.order.reduce((a, g) => (closed.has(g) ? a : a.concat(dg.groups[g].map(l => l.lineId))), []) : []), [plain, dg, closed])
  const rowClass = e => (plain && e.type === 'item' && tickSet.has(e.r.lineId) ? ' qs-tk-rowsel' : '')
  const toggleGroup = useCallback(id => setClosed(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }), [])

  /* Ô vẽ riêng: tên tầng ở cột dữ liệu đầu tiên (Bảng thường: kèm "Tổng tầng", duan.js:99), ô tick STT (Bảng thường), ảnh, tài liệu */
  const renderCell = (e, c, info) => {
    if (e.type === 'group') {
      if (info.i === 1) {
        if (!plain) return e.cells[firstKey]
        return <span className="qs-cp-gh"><b>{e.g.name}</b><span className="qs-cp-gsum">Tổng tầng: <b>{money(e.sum)} đ</b></span></span>
      }
      if (c.key === 'khuVuc' || c.key === 'ten') return (e.cells && e.cells[c.key]) || null
      return undefined
    }
    if (e.type !== 'item') return undefined
    const l = e.r
    if (c.key === 'stt' && plain) return <TickStt stt={e.stt} on={tickSet.has(l.lineId)} onTick={ev => tickClick_(ev, cur.maDA, l.lineId, shownIds)} />
    if (c.key === 'hinhAnh') {
      if (!l.hinhAnh) return ''
      const src = img1(l.hinhAnh)
      return <ProductThumb product={l} size={view === 'plain' ? 72 : 44} src={src} onClick={() => setXemSP(l)} title="Bấm để xem nhanh sản phẩm (ảnh lớn, thông số)" className="qs-tk-img" />
    }
    if (c.key === 'taiLieu') {
      const dl = lineDocs_(l, products)
      if (!dl.length) return ''
      return (
        <button className="qs-tk-tlbadge" title={'Xem ' + dl.length + ' tài liệu'} onMouseDown={ev => ev.stopPropagation()}
          onClick={ev => setPop({ kind: 'docs', anchor: ev.currentTarget, line: l, docs: dl })}>
          <Icon name="fileText" size={13} /> {dl.length}
        </button>
      )
    }
    return undefined
  }

  async function xuatExcel() {
    if (!cur || xls) return
    setXls(true)
    const ok = await exportBang(daXlsxBody(cur, keys, dg, visibleLines), 'du-an-' + cur.maDA + '.xlsx')
    setXls(false)
    if (ok) toast('Đã xuất ' + visibleLines.length + ' dòng ra Excel')
  }

  const giaLech = useMemo(() => giaLechList_(lines, products), [lines, products])
  function openGiaSync() {
    if (!cur) { toast('Chưa chọn dự án'); return }
    if (!giaLech.length) { toast('Mọi dòng trong dự án đã khớp giá danh mục'); return }
    setPop({ kind: 'gia', ds: giaLech })
  }
  const recentBtn = useRef(null)
  const extraTools = (
    <>
      <button ref={recentBtn} className={`qs-bd-tb-btn${pop && pop.kind === 'recent' ? ' on' : ''}`} title="Vừa thêm vào bảng — xem lại / thêm lại"
        onMouseDown={e => e.preventDefault()} onClick={() => setPop(p => (p && p.kind === 'recent' ? null : { kind: 'recent', anchor: recentBtn.current }))}>
        <Icon name="clock" size={18} />
      </button>
      <button className="qs-bd-tb-btn badged" title={giaLech.length ? (giaLech.length + ' dòng đang lệch giá so với Danh sách sản phẩm — bấm để cập nhật') : 'Cập nhật giá dòng theo Danh sách sản phẩm (đang khớp hết)'}
        onMouseDown={e => e.preventDefault()} onClick={openGiaSync}>
        <Icon name="refresh" size={18} />{giaLech.length ? <span className="qs-bd-tb-badge">{giaLech.length}</span> : null}
      </button>
    </>
  )
  const flashTo = id => setFlash(f => ({ rowId: id, text: null, mark: true, n: (f ? f.n : 0) + 1 }))
  /* Bảng thường: hàng đầu khối công cụ "Công cụ bảng" (pgColFrame_ chiphi.js:47-61: 2 nút pgToolsHtml_ + nút gập qs_fold.tools;
     gập thì chỉ còn hàng này, index.html:6260-6264). Bảng tính không có hàng này: 2 nút nằm trên thanh bảng tính */
  const toolHr = () => (
    <div className="qs-tk-toolbox qs-cp-toolhr">
      <span className="qs-tk-toolh">Công cụ bảng</span>
      <span className="qs-tk-tgrp">{extraTools}</span>
      <button type="button" className={`qs-bd-round-btn accent qs-cp-fold${foldTools ? ' on' : ''}`} title={(foldTools ? 'Mở lại ' : 'Thu gọn ') + 'khối công cụ'}
        onClick={() => foldToggle_('tools')}><Icon name="chevronDown" size={14} /></button>
    </div>
  )
  /* Menu chuột phải ở Bảng tính (btMenuChung_ bangtinh.js:765-787) */
  const ctxAct = {
    insertRow: ids => { const id = ids[ids.length - 1]; if (!id) { toast('Chọn 1 ô ở dòng sản phẩm trước'); return } bocAct.insertRowBelow(id, hmNode || qs.node, '') },
    dupRows: ids => (ids.length ? bocAct.dupRows(ids) : toast('Chọn ô ở các dòng cần nhân bản')),
    delRows: ids => (ids.length ? mutate.deleteLines(ids, { confirm: true }) : toast('Chọn ô ở các dòng cần xoá')),
    sort: (key, dir) => { setSort({ key, dir }); toast('Sắp xếp ' + (dir === 'asc' ? 'A → Z' : 'Z → A') + ' theo "' + cpLabel_(key) + '"') },
    resetSort: () => setSort({ key: '', dir: 'asc' }),
    fillDown,
    hideCol: k => { if (colSet.cols[k]) toggleCol('da', k) },
    copy: () => copySel(sheetBox.current),
    find: () => setPanel('find'),
  }

  const rowDrag = useMemo(() => ({
    canGroup: g => g.id !== CHUA_PHAN_TANG,
    onDrop: (src, dst, before) => {
      if (sort.key) { toast('Đang sắp xếp theo cột — bỏ sắp xếp rồi kéo'); return }
      dropRow('da', '', src, dst, before)
    },
  }), [sort.key, toast])
  const cycleSort = k => setSort(s => (s.key !== k ? { key: k, dir: 'asc' } : s.dir === 'asc' ? { key: k, dir: 'desc' } : { key: '', dir: 'asc' }))
  const colMarks = useMemo(() => (sort.key ? { [sort.key]: 'sort' } : {}), [sort.key])

  /* Trên băng: nút bộ cột mở khung dọc + dải chip cột (như Bóc tách), đóng bên nào cũng đóng cả hai; băng gập: hộp nổi như cũ */
  const dockOn = dock && colsOnBar
  const closeDock = () => { setDock(false); if (!foldCols) foldToggle_('cols') }
  const colFrame = bar => (
    <ColFrame t="da" cols={colSet.cols} foldCols={foldCols} bar={bar}
      onFoldCols={() => { if (!foldCols) setDock(false); foldToggle_('cols') }}
      presetOpen={bar ? dockOn : !!pop && pop.kind === 'preset'}
      onPreset={bar
        ? () => { if (dockOn) closeDock(); else { setDock(true); if (foldCols) foldToggle_('cols') } }
        : e => { const at = e.currentTarget; setPop(p => (p && p.kind === 'preset' ? null : { kind: 'preset', anchor: at })) }} />
  )
  if (!cur) {
    return (
      <div className="qs-card qs-cp-empty">
        <Icon name="scan" size={30} />
        <b>Sản phẩm trong dự án</b>
        <span>Chưa chọn dự án. Vào <b>Bảng điều khiển</b> để chọn/tạo dự án.</span>
      </div>
    )
  }

  const stats = (
    <>
      <Stat label="Sản phẩm" value={TT.n} />
      <Stat label="Số lượng" value={TT.sl} />
      <Stat label="Chưa VAT" value={pd.ready ? dong(TT.ban) : pending} />
      <VatStat vatPct={Number(cur.vat) || 0} amount={TT.vat} amountNode={pd.ready ? null : pending} onVat={bocAct.setVat} />
      <Stat label="Tổng" value={pd.ready ? dong(TT.total) : pending} cls="grand" />
    </>
  )
  const emptyNode = <div className="qs-tk-emptyrow">Chưa có sản phẩm. Vào <b>Danh sách sản phẩm</b> bấm ＋ để ghi danh, hoặc <b>Bóc tách</b> để thêm.</div>

  return (
    <>
      <PageHead n={scope.length} hm={hmNode} lines={lines} onHm={code => setHmNode(code)} view={view} onView={setView} stats={stats} slotKey="duan"
        colTools={colsOnBar ? colFrame(true) : null} />
      <PtNote hm={hmNode} onBoc={() => navigate('boc')} />
      {pd.ready && <PtErrNote msg={ptErr} />}
      <SaiNote lines={lines} products={products} />
      <LacNote lines={lines} hm={hmNode} soHien={visibleLines.length} onHm={code => setHmNode(code)} />

      {/* hàng: khung "Chọn nhanh cột" (bên trái, khi mở) | khối công cụ + bảng */}
      <div className="qs-cp-dockrow">
        {visible && dockOn && <PresetDock t="da" cols={colSet.cols} onEdit={() => { if (foldCols) foldToggle_('cols') }} onClose={closeDock} />}
        <div className="qs-cp-dockmain">
        {/* dải chip cột: module riêng phía trên khối công cụ, như Bóc tách; đóng = đóng cả khung Chọn nhanh cột */}
        {!foldCols && <ColChipsModule t="da" cols={colSet.cols} onClose={() => { setDock(false); foldToggle_('cols') }} />}
        <div className={`qs-card qs-ct-filters qs-cp-tools${plain && foldTools ? ' folded' : ''}`}>
          {plain && toolHr()}
          {!(plain && foldTools) && <>
          <div className="qs-ct-filters-main">
            {q && <span className="qs-cp-found">{visibleLines.length} / {scope.length} dòng</span>}
            {sort.key && <button className="qs-ct-btn outline" title="Bỏ sắp xếp" onClick={() => setSort({ key: '', dir: 'asc' })}><Icon name="x" size={13} />Bỏ sắp xếp</button>}
            <span style={{ flex: 1 }} />
            <button className="qs-ct-btn" disabled={xls} title="Bảng đang xem (đúng cột, tìm, sắp xếp) ra file Excel" onClick={xuatExcel}><Icon name="download" size={14} />Xuất Excel</button>
          </div>
          {!colsOnBar && <div className="qs-ct-filters-cols">{colFrame(false)}</div>}
          </>}
        </div>

        <div ref={sheetBox} className={`qs-card qs-bd-sheet qs-ct-sheet qs-pj-sheet${full ? ' full' : ''}`}>
          <SheetBody
            sheet={facade}
            plain={plain}
            hiddenCols={hiddenCols} onHiddenCols={onHiddenCols}
            panel={panel} onPanel={setPanel}
            favorites={NO_FAVS}
            onTarget={() => {}}
            onAddRow={() => {}}
            full={full} onFull={() => setFull(f => !f)}
            flash={flash} onClearMark={() => setFlash(f => (f && f.mark ? { ...f, mark: false } : f))}
            fileName={'du-an-' + cur.maDA}
            printTitle={(cur.ten || cur.maDA) + ' — Sản phẩm trong dự án'}
            columns={columns} flatten={flatten} initialSel={INITIAL_SEL} rowClass={rowClass} onToggleGroupOverride={toggleGroup}
            footer={false}
            adapter={adapter} wrapKey="wrap" hideTools={['import', 'csv']} extraTools={extraTools}
            onRenameGroup={(g, name) => { if (g.id !== CHUA_PHAN_TANG) bocAct.renameFloor(g.id, name) }}
            onInsertRow={e => (e.type === 'item' ? bocAct.insertRowBelow(e.r.lineId, e.r.nhom || hmNode || qs.node, '') : null)}
            onDuplicate={ids => bocAct.dupRows(ids)}
            onSort={(key, dir, label) => { setSort({ key, dir }); toast('Sắp xếp ' + (dir === 'asc' ? 'A → Z' : 'Z → A') + ' theo "' + label + '"') }}
            onDownload={xuatExcel}
            onApplyEdits={(info, cells) => applyCells(info, cells, plain)}
            onReplaceAll={(fq, rep) => replaceAll(fq, rep, visibleLines, keys)}
            onCellContext={plain ? null : ctx => setPop({ kind: 'ctx', at: { x: ctx.ev.clientX, y: ctx.ev.clientY }, entry: ctx.entry, col: ctx.col, ids: ctx.ids, keys: ctx.keys })}
            plainTools={() => null}
            onDeleteRows={ids => (ids.length ? mutate.deleteLines(ids, { confirm: true }) : toast('Chọn ô ở các dòng cần xoá'))}
            onColResize={setColW} onColMove={(from, to, before) => { if (from !== 'stt' && to !== 'stt') moveCol('da', from, to, before) }}
            onColMenu={key => { if (key !== 'stt') cycleSort(key) }} colMarks={colMarks}
            rowDrag={rowDrag} plainFmt={false} datalists={DATALISTS}
            renderCell={renderCell}
            gridClass={`qs-tk-grid qs-cp-grid${plain ? ' qs-tk-plain' : ''}`} emptyNode={emptyNode}
            colCount={{ shown: keys.length, total: DA_KEYS.length }}
            colsPanel={<ColChips t="da" cols={colSet.cols} />}
          />
        </div>
        </div>
      </div>

      {visible && <TickBar maDA={cur.maDA} lines={tickLines} keys={keys} shownIds={shownIds} />}
      {visible && pop && pop.kind === 'preset' && <PresetPop t="da" anchor={pop.anchor} cols={colSet.cols} onClose={() => setPop(null)} />}
      {visible && pop && pop.kind === 'gia' && <PriceSyncModal ds={pop.ds} onClose={() => setPop(null)} />}
      {visible && pop && pop.kind === 'ctx' && (
        <CpCtxMenu at={pop.at} entry={pop.entry} col={pop.col} ids={pop.ids} keys={pop.keys} sortKey={sort.key} act={ctxAct} onClose={() => setPop(null)} />
      )}
      {visible && pop && pop.kind === 'docs' && <DocsPopover anchor={pop.anchor} title={pop.line.ten} docs={pop.docs} onClose={() => setPop(null)} />}
      {visible && pop && pop.kind === 'recent' && (
        <RecentPop anchor={pop.anchor} lines={lines} onClose={() => setPop(null)}
          onGo={l => { if (hmNode && !daScope_([l], hmNode).length) setHmNode(''); setQ(''); flashTo(l.lineId) }}
          onPlus={l => { mutate.updateLine(l.lineId, { soLuong: (Number(l.soLuong) || 0) + 1 }); toast('+1 số lượng: ' + l.ten) }} />
      )}
      {visible && imgView && <ImgViewer src={imgView} onClose={() => setImgView('')} />}
      {visible && xemSP && <ProductModal ctx="du-an" line={(lines || []).find(x => x.lineId === xemSP.lineId) || xemSP} products={products} onClose={() => setXemSP(null)}
        onOpenBoc={() => { setXemSP(null); navigate('boc') }} />}
    </>
  )
}
