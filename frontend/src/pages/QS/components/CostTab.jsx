import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { useQs } from '../state/QsData'
import { useLinesSheet } from '../state/useLinesSheet'
import SheetBody from './breakdown/SheetBody'
import { useTkCols, setColW } from './breakdown/sheet/tkCols'
import { RecentPop, PriceSyncModal } from './breakdown/sheet/SyncPops'
import * as bocAct from './breakdown/sheet/bocActions'
import './breakdown/sheet/sheet.css'
import { useFold, foldToggle_, projCtx_, usePdState, pdRetry_ } from './project/projectShell'
import CostOverview, { MinBienInput } from './cost/CostOverview'
import BienMucTieuDialog from './cost/BienMucTieuDialog'
import CompareDrafts from './cost/CompareDrafts'
import PageHead, { Stat, VatStat, PtNote, LacNote, PtErrNote } from './cost/PageHead'
import ChangeInput from './purchase/ChangeInput'
import { ColFrame, ColChips, ColChipsModule, PresetPop, PresetDock } from './cost/ColTools'
import { useQbSlotEl, setQbSlotEl, useQbQuery, setQbQuery } from './project/qbSlot'
import CpCtxMenu from './cost/CpCtxMenu'
import TickStt, { Signed } from './cost/TickStt'
import TickBar from './cost/TickBar'
import { useColSet, setColsMap, moveCol, toggleCol } from './cost/cpCols'
import { sheetColumns, lineAdapter, cpRows_, cpCounts_, cpFlatten, cpXlsxBody } from './cost/lineSheet'
import { applyCells, applyEditsRec, exportBang, dropRow, fillDown, replaceAll, copySel } from './cost/costActions'
import { useTicks, tickClick_ } from '../state/tickSel'
import './cost/cost.css'
import { CP_KEYS, TK_LN_QUICK, cpLabel_ } from '../lib/columns.js'
import { giaDaiLy_, tkFieldsFor_ } from '../lib/calc.js'
import { money, pctIn_ } from '../lib/format.js'
import { cpTong_, cpMinBien_, cpMinBienIn_, cpBienMTIn_, daScope_ } from '../lib/totals.js'
import { currentGroup } from '../lib/dashModel.js'
import { giaLechList_, spOfLine_ } from '../lib/bocSync.js'

const TAB = 'chiphi'
const INITIAL_SEL = { a: { r: 0, c: 0 }, f: { r: 0, c: 0 } }
const NO_FAVS = new Set()
const BY = [['hm', 'Hạng mục'], ['tang', 'Tầng'], ['ncc', 'NCC'], ['', 'Không gom']]
const dong = n => `${money(n)} đ`

function lsGet(k) { try { return localStorage.getItem(k) } catch (e) { return null } }
function lsSet(k, v) { try { localStorage.setItem(k, v) } catch (e) { /* bỏ qua */ } }
const btMode = () => (lsGet('qs_bt_mode') === 'cu' ? 'plain' : 'sheet')

/* Tab "Chi phí" (port PUB/chiphi.js, bangtinh.js:688-708): dòng bóc tách của hạng mục dùng chung (hmNode, '' = tất cả).
   Dải tổng + Tổng quan theo cpTong_ (gồm Phần thô khi xem tất cả / 3.1, trừ CK báo giá khi xem tất cả). Bảng dùng chung
   ô sửa với Bóc tách (useLinesSheet({hm}) -> updateLine), cột CP_KEYS + bộ cột "Của tôi" (cpCols), gom theo hạng mục / tầng / NCC,
   chip lọc cảnh báo, sắp xếp, đặt nhanh % lợi nhuận, biên mục tiêu (projData.cpCfg), so sánh bản nháp, Excel chi-phi-<maDA>.xlsx. */
export default function CostTab() {
  const qs = useQs()
  const { cur, lines, products, projects, projData, setProjData, hmNode, setHmNode, mutate, toast, confirm, ask, navigate, selectProject, status } = qs
  const visible = qs.panelVisible(TAB)
  const seq = qs.visibleSeq(TAB)
  const facade = useLinesSheet({ hm: hmNode })
  const colSet = useColSet('cp')
  const tkCols = useTkCols()
  const pd = usePdState(cur, status)
  const foldCols = useFold('cols')
  const [dock, setDock] = useState(false)   // khung "Chọn nhanh cột" bên trái vùng bảng (nút bộ cột trên băng)
  const colsOnBar = !!useQbSlotEl('pc:chiphi')
  const toolSlotRef = useCallback(n => setQbSlotEl('tools:chiphi', n), [])   // ô tìm kiếm của thanh công cụ nhanh vẽ vào hàng công cụ    // băng dự án mở rộng: Cột hiển thị lên băng (PageHead)
  const foldTools = useFold('tools')
  const ticks = useTicks(cur && cur.maDA)
  const sheetBox = useRef(null)

  const [view, setViewState] = useState(btMode)
  // chữ tìm = ô tìm của thanh công cụ nhanh (QuickBar, Ctrl K) - gộp 2 ô tìm làm 1
  const q = useQbQuery('chiphi')
  const setQ = v => setQbQuery('chiphi', v)
  const [flt, setFlt] = useState('')
  const [bmt, setBmt] = useState(null)   // hộp Biên mục tiêu đang mở: {lines, skipped, scopeLbl}
  const [sort, setSort] = useState({ key: '', dir: 'asc' })
  const [by, setByState] = useState(() => { const v = lsGet('qs_cpBy'); return v == null ? 'hm' : v })
  const [ovHide, setOvHide] = useState(() => lsGet('qs_cpOvHide') === '1')
  const [closed, setClosed] = useState(() => new Set())
  const [panel, setPanel] = useState(null)
  const [full, setFull] = useState(false)
  const [pop, setPop] = useState(null)
  const [selIds, setSelIds] = useState([])
  const [cmp, setCmp] = useState(false)
  const [xls, setXls] = useState(false)
  const [flash, setFlash] = useState(null)

  /* Kiểu bảng chung mọi bảng (qs_bt_mode): đọc lại mỗi lần tab hiện */
  useEffect(() => { if (visible) setViewState(btMode()) }, [visible, seq])
  function setView(v) {
    if (v === view) return
    setViewState(v); lsSet('qs_bt_mode', v === 'plain' ? 'cu' : 'moi')
    toast(v === 'plain' ? 'Đã chuyển sang Bảng thường' : 'Đã chuyển sang Bảng tính')
  }
  function setBy(v) { setByState(v); lsSet('qs_cpBy', v) }
  function ovToggle() { const v = !ovHide; setOvHide(v); lsSet('qs_cpOvHide', v ? '1' : '') }
  const setFltToggle = v => setFlt(f => (f === v ? '' : v))

  /* ---- Số liệu: tính trên ĐÚNG hạng mục đang chọn (ô tìm / chip lọc chỉ lọc bảng) ---- */
  const cpCfg = (projData && projData.cpCfg) || {}
  const minBien = cpMinBien_(cpCfg)
  const ctx = projCtx_(cur, projData)
  const scope = useMemo(() => daScope_(lines, hmNode), [lines, hmNode])
  const T = cpTong_(scope, hmNode, ctx)
  const rows = useMemo(() => cpRows_(scope, q, flt, minBien, sort.key, sort.dir), [scope, q, flt, minBien, sort])
  const counts = useMemo(() => cpCounts_(scope, minBien), [scope, minBien])
  const loc = !!(q || flt)
  const plain = view === 'plain'
  const lnCls = T.ln < 0 ? ' red' : (T.ln > 0 ? ' green' : '')
  const pending = pd.err
    ? <button type="button" className="qs-cp-retry" title={pd.err} onClick={() => pdRetry_(cur.maDA)}>Lỗi tải dữ liệu · Thử lại</button>
    : <span className="qs-cp-wait">{pd.slow ? 'Đang tải… (lâu hơn thường lệ)' : 'Đang tải…'}</span>
  const vOf = x => (pd.ready ? dong(x) : pending)

  /* ---- Cột ---- */
  const keys = colSet.order.filter(k => colSet.cols[k])
  const firstKey = keys[0] || 'ten'
  const columns = useMemo(() => sheetColumns(colSet.order, colSet.cols, tkCols.w, sort.key, sort.dir), [colSet, tkCols.w, sort])
  const hiddenCols = useMemo(() => new Set(CP_KEYS.filter(k => !colSet.cols[k])), [colSet.cols])
  const onHiddenCols = useCallback(set => { const m = {}; CP_KEYS.forEach(k => { m[k] = !set.has(k) }); setColsMap('cp', m) }, [])
  const adapter = useMemo(() => lineAdapter(r => { const p = spOfLine_(r, products); return !!(p && p.yeuThich) }), [products])
  const flatOf = useCallback(pred => (rows.length ? cpFlatten(pred ? rows.filter(l => pred(l, '')) : rows, by, firstKey, closed, minBien, plain) : []), [rows, by, firstKey, closed, minBien, plain])
  const flatten = useCallback((gs, pred) => flatOf(pred), [flatOf])
  const tickSet = useMemo(() => new Set(ticks), [ticks])
  const tickLines = useMemo(() => (ticks.length ? lines.filter(l => tickSet.has(l.lineId)) : []), [lines, ticks, tickSet])
  const shownIds = useMemo(() => (plain ? flatOf(null).filter(e => e.type === 'item').map(e => e.r.lineId) : []), [plain, flatOf])
  const rowClass = e => (e.type === 'item'
    ? (e.w === 'lo' ? ' qs-cp-lo' : e.w === 'thap' ? ' warn' : '') + (plain && tickSet.has(e.r.lineId) ? ' qs-tk-rowsel' : '')
    : e.sub ? ' qs-cp-sub' : '')
  const toggleGroup = useCallback(id => setClosed(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }), [])
  /* Tên nhóm / dòng TỔNG nằm ở cột dữ liệu đầu tiên (r[1] của cpSheetGrid_). Bảng thường (cpTableHtml_ / cpRowHtml_):
     ô STT có ô tick dòng (cpSttCell_), dòng nhóm "tên · N dòng · Vốn · Bán · LN", ô Lợi nhuận của dòng cộng tô màu (cpSigned_) */
  const renderCell = (e, c, info) => {
    if (e.type === 'group') {
      if (info.i === 1) {
        if (!plain || !e.t) return e.cells[firstKey]
        return (
          <span className="qs-cp-gh"><b>{e.g.name}</b><span className="qs-cp-gn">{e.count} dòng</span>
            <span className="qs-cp-gsum">Vốn <b>{money(e.t.von)}</b> · Bán <b>{money(e.t.ban)}</b> · LN <Signed v={e.t.ln} /></span></span>
        )
      }
      if (c.key === 'khuVuc' || c.key === 'ten') return (e.cells && e.cells[c.key]) || null
      return undefined
    }
    if (!plain) return undefined
    if (e.type === 'total' && c.key === 'lnVnd' && e.t) return <Signed v={e.t.ln} />
    if (e.type === 'item' && c.key === 'stt') return <TickStt stt={e.stt} on={tickSet.has(e.r.lineId)} onTick={ev => tickClick_(ev, cur.maDA, e.r.lineId, shownIds)} />
    return undefined
  }

  /* ---- Phạm vi đặt nhanh % LN / biên mục tiêu (cpLnBulkHien_ / cpLnRows_ / cpLnScopeLbl_ chiphi.js:343-372):
     vùng ô nhiều dòng của Bảng thường (S._rng chỉ có ở bảng .cpflat, Bảng tính không đặt) > dòng đã tick > các dòng đang hiện ---- */
  const rngLines = plain && selIds.length > 1 ? selIds.map(id => rows.filter(l => l.lineId === id)[0]).filter(Boolean) : []
  const lnBulkOn = rngLines.length > 1 || tickLines.length > 0
  const lnRows = () => (rngLines.length > 1 ? rngLines : tickLines.length ? tickLines : rows)
  const lnScopeLbl = () => {
    if (rngLines.length > 1) return 'áp cho ' + rngLines.length + ' dòng đang chọn'
    if (tickLines.length) return 'áp cho ' + tickLines.length + ' dòng đã tick bên Bóc tách'
    return loc ? ('áp cho ' + rows.length + ' dòng đang hiện') : ('áp cho tất cả ' + rows.length + ' dòng — chọn vùng ô để thu hẹp')
  }
  async function quickLn(v) {
    const ls = lnRows(); if (!ls.length) { toast('Chưa có dòng nào'); return }
    if (ls.length > 1 && !await confirm('Đặt lợi nhuận ' + v + '% cho ' + ls.length + ' dòng?')) return
    applyEditsRec(ls.map(l => ({ id: l.lineId, fields: { lnPct: Number(v) } })), 'Đã đặt lợi nhuận ' + v + '%')
  }
  async function quickLnAsk() {
    let v = await ask({ title: 'Đặt % lợi nhuận', label: '% lợi nhuận trên giá vốn', value: '', placeholder: 'VD: 20', ok: 'Áp dụng' })
    if (v == null) return
    v = pctIn_(v); if (v == null) { toast('% không hợp lệ'); return }
    quickLn(v)
  }
  const cfgSet = (k, v) => setProjData('cpCfg', { ...((qs.projData && qs.projData.cpCfg) || {}), [k]: v })
  function setMinBien(v) {
    const r = cpMinBienIn_(v)
    if (r.msg) { toast(r.msg); return false }
    cfgSet('minBien', r.value)
    return pd.ready ? r.value : false   // dữ liệu dự án chưa tải: projDataSet_ không lưu (toast + tải lại) -> ô trả về số đang có
  }
  /* Biên mục tiêu: hộp 2 ô liên thông Margin (LN / giá bán) ⇄ Markup (LN / giá vốn) - BienMucTieuDialog;
     hộp đã ghi rõ số dòng + xem trước tổng tiền nên không hỏi xác nhận lần nữa (Hoàn tác được) */
  function bienMucTieu() {
    const ls = lnRows(); const co = ls.filter(l => giaDaiLy_(l) > 0)
    if (!co.length) { toast('Các dòng đang chọn chưa có giá vốn — nhập giá vốn trước'); return }
    setBmt({ lines: co, skipped: ls.length - co.length, scopeLbl: lnScopeLbl() })
  }
  function bienMucTieuApply({ mode, v, margin }) {
    const r = cpBienMTIn_(Math.round(margin * 100) / 100)
    if (r.msg) { toast(r.msg); return }
    const edits = bmt.lines.map(l => ({ id: l.lineId, fields: tkFieldsFor_(l, mode, v) })).filter(e => e.fields)
    if (!edits.length) { toast('Không tính được giá bán cho dòng nào'); return }
    cfgSet('bienMT', r.value)
    setBmt(null)
    applyEditsRec(edits, mode === 'margin' ? 'Đã đặt lợi nhuận ' + v + '% trên giá bán' : 'Đã đặt lợi nhuận ' + v + '% trên giá vốn')
  }

  /* ---- So sánh bản nháp · Excel ---- */
  const group = currentGroup(projects, cur)
  const soNhap = group ? group.drafts.length : 0
  function openCmp() {
    if (!group || group.drafts.length < 2) { toast('Dự án này mới có 1 bản nháp'); return }
    setCmp(true)
  }
  async function xuatExcel() {
    if (!cur || xls) return
    if (!rows.length) { toast('Không có dòng nào để xuất'); return }
    setXls(true)
    const ok = await exportBang(cpXlsxBody(cur, keys, rows, by, loc, hmNode, ctx), 'chi-phi-' + cur.maDA + '.xlsx')
    setXls(false)
    if (ok) toast('Đã xuất ' + rows.length + ' dòng ra Excel')
  }

  /* ---- Cập nhật giá theo danh mục · Vừa thêm (2 nút công cụ bảng, pgToolsHtml_) ---- */
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
    hideCol: k => { if (colSet.cols[k]) toggleCol('cp', k) },
    copy: () => copySel(sheetBox.current),
    find: () => setPanel('find'),
  }

  /* Bỏ vùng chọn khi đổi dự án / hạng mục */
  useEffect(() => { setSelIds([]) }, [cur && cur.maDA, hmNode])

  const rowDrag = useMemo(() => ({
    canGroup: () => false,
    onDrop: (src, dst, before) => {
      if (sort.key) { toast('Đang sắp xếp theo cột — bỏ sắp xếp rồi kéo'); return }
      dropRow('cp', by, src, dst, before)
    },
  }), [sort.key, by, toast])

  const cycleSort = k => setSort(s => (s.key !== k ? { key: k, dir: 'asc' } : s.dir === 'asc' ? { key: k, dir: 'desc' } : { key: '', dir: 'asc' }))
  const colMarks = useMemo(() => (sort.key ? { [sort.key]: 'sort' } : {}), [sort.key])

  /* Trên băng: nút bộ cột mở khung dọc + dải chip cột (như Bóc tách), đóng bên nào cũng đóng cả hai; băng gập: hộp nổi như cũ */
  const dockOn = dock && colsOnBar
  const closeDock = () => { setDock(false); if (!foldCols) foldToggle_('cols') }
  const colFrame = bar => (
    <ColFrame t="cp" cols={colSet.cols} foldCols={foldCols} bar={bar}
      onFoldCols={() => { if (!foldCols) setDock(false); foldToggle_('cols') }}
      presetOpen={bar ? dockOn : !!pop && pop.kind === 'preset'}
      onPreset={bar
        ? () => { if (dockOn) closeDock(); else { setDock(true); if (foldCols) foldToggle_('cols') } }
        : e => { const at = e.currentTarget; setPop(p => (p && p.kind === 'preset' ? null : { kind: 'preset', anchor: at })) }} />
  )
  if (!cur) {
    return (
      <div className="qs-card qs-cp-empty">
        <Icon name="banknote" size={30} />
        <b>Chưa chọn dự án</b>
        <span>Vào <b>Bảng điều khiển</b> chọn hoặc tạo một dự án để xem bảng chi phí.</span>
      </div>
    )
  }

  /* Vốn · Giá bán · (CK) · Lợi nhuận · Biên · VAT · Tổng: lên khung tiền của băng dự án khi băng mở rộng (PageHead barStats);
     inline = dáng ô khi băng gập (hiện ở hàng dưới băng như cũ) */
  const barStats = [
    { label: 'Vốn', value: vOf(T.von) },
    { label: 'Giá bán', value: vOf(T.ban) },
    ...(pd.ready && T.ck ? [{ label: 'CK báo giá', value: '−' + dong(T.ck) }] : []),
    { label: 'Lợi nhuận', value: vOf(T.ln), tone: lnCls.trim() },
    { label: 'Biên', value: pd.ready ? T.bien.toFixed(1) + '%' : '…', tone: lnCls.trim() },
    {
      label: 'VAT',
      value: <span className="qs-pc-vat"><ChangeInput className="qs-bd-vatin" type="number" step="any" min="0" value={Number(cur.vat) || 0} title="Thuế VAT (%)" onCommit={bocAct.setVat} />%<em>{vOf(T.vat)}</em></span>,
      inline: <VatStat key="VAT" vatPct={Number(cur.vat) || 0} amount={T.vat} amountNode={pd.ready ? null : pending} onVat={bocAct.setVat} />,
    },
    { label: 'Tổng', value: vOf(T.total), tone: 'total', cls: 'grand' },
  ]
  const stats = null
  const chip = (k, nhan, n, warn) => (!n && k ? null : (
    <button key={k || 'all'} className={`qs-ct-chip${flt === k ? ' on' : ''}${warn ? ' red' : ''}`} onClick={() => setFltToggle(k)}>{nhan}<span>{n}</span></button>
  ))
  const emptyNode = !lines.length
    ? <div className="qs-tk-emptyrow">Chưa có hạng mục nào. Vào tab <b>Bóc tách</b> để thêm sản phẩm.</div>
    : <div className="qs-tk-emptyrow">Không có dòng nào khớp bộ lọc. <button type="button" className="qs-qt-btn qs-cp-inl" onClick={() => { setQ(''); setFlt('') }}>Xoá lọc</button></div>

  return (
    <>
      <PageHead n={scope.length} hm={hmNode} lines={lines} onHm={code => setHmNode(code)} view={view} onView={setView} stats={stats} barStats={barStats} slotKey="chiphi"
        colTools={colsOnBar ? colFrame(true) : null} />
      <PtNote hm={hmNode} onBoc={() => navigate('boc')} />
      {pd.ready && <PtErrNote msg={T.ptErr} />}
      <LacNote lines={lines} hm={hmNode} soHien={scope.length} onHm={code => setHmNode(code)} />

      <CostOverview T={T} scope={scope} minBien={minBien}
        onHm={code => setHmNode(code)} onCollapse={ovToggle} collapsed={ovHide} />

      {/* hàng: khung "Chọn nhanh cột" (bên trái, khi mở) | khối công cụ + bảng */}
      <div className="qs-cp-dockrow">
        {visible && dockOn && <PresetDock t="cp" cols={colSet.cols} onEdit={() => { if (foldCols) foldToggle_('cols') }} onClose={closeDock} />}
        <div className="qs-cp-dockmain">
        {/* dải chip cột: module riêng phía trên khối công cụ, như Bóc tách; đóng = đóng cả khung Chọn nhanh cột */}
        {!foldCols && <ColChipsModule t="cp" cols={colSet.cols} onClose={() => { setDock(false); foldToggle_('cols') }} />}
        <div className={`qs-card qs-ct-filters qs-cp-tools${plain && foldTools ? ' folded' : ''}`}>
          {plain && toolHr()}
          {!(plain && foldTools) && <>
          <div className="qs-ct-filters-main">
            <button className={`qs-ct-chip${!flt ? ' on' : ''}`} onClick={() => setFlt('')}>Tất cả<span>{scope.length}</span></button>
            {chip('lo', 'Đang lỗ', counts.lo, true)}
            {chip('chuaGia', 'Chưa có giá bán', counts.chuaGia)}
            {chip('chuaVon', 'Chưa có giá vốn', counts.chuaVon)}
            {/* module Biên: nút cảnh báo (đỏ khi có dòng biên dưới mức, bấm = lọc các dòng đó; xanh "Đạt biên" khi không có)
                + ô Biên tối thiểu, chung 1 khung */}
            <span className={`qs-cp-bienmod${counts.thap ? ' warn' : ' ok'}`} role="group" aria-label="Biên tối thiểu">
              <button type="button" className={`qs-cp-bienwarn${flt === 'thap' ? ' on' : ''}`} disabled={!counts.thap && flt !== 'thap'}
                title={counts.thap ? counts.thap + ' dòng có biên dưới ' + minBien + '% — bấm để lọc' : 'Mọi dòng đạt biên tối thiểu ' + minBien + '%'}
                onClick={() => setFltToggle('thap')}>
                <Icon name={counts.thap ? 'alert' : 'check'} size={14} />
                {counts.thap ? <>Biên &lt; {minBien}%<b>{counts.thap}</b></> : 'Đạt biên'}
              </button>
              <span className="qs-cp-bienmod-sep" aria-hidden="true" />
              <MinBienInput minBien={minBien} onMinBien={setMinBien} />
            </span>
            {loc && <span className="qs-cp-found">{rows.length} / {scope.length} dòng</span>}
            <div className="qs-qb-slot" ref={toolSlotRef} />
            <div className="qs-bd-seg qs-cp-seg" title="Gom các dòng và cộng tổng từng nhóm">
              <span className="qs-cp-seg-l">Gom theo</span>
              {BY.map(x => <button key={x[0] || 'none'} className={by === x[0] ? 'on' : ''} onClick={() => setBy(x[0])}>{x[1]}</button>)}
            </div>
            <button className="qs-ct-btn outline" title="Tính lại giá bán để đạt biên lợi nhuận mong muốn" onClick={bienMucTieu}><Icon name="target" size={14} />Biên mục tiêu…</button>
            {soNhap > 1 && <button className="qs-ct-btn outline" title="So tổng tiền các bản nháp của dự án này" onClick={openCmp}><Icon name="layers" size={14} />So sánh {soNhap} bản nháp</button>}
            <button className="qs-ct-btn" disabled={xls} title="Bảng đang xem (đúng cột, lọc, cách gom) ra file Excel" onClick={xuatExcel}><Icon name="download" size={14} />Xuất Excel</button>
          </div>
          {!colsOnBar && <div className="qs-ct-filters-cols">{colFrame(false)}</div>}
          </>}
        </div>

        {lnBulkOn && (
          <div className="qs-card qs-cp-lnq">
            <span className="qs-cp-lnq-l"><Icon name="gauge" size={13} /> Đặt nhanh lợi nhuận</span>
            <div className="qs-cp-lnq-b">
              {TK_LN_QUICK.map(v => <button key={v} title={'Đặt lợi nhuận ' + v + '% trên giá vốn'} onClick={() => quickLn(v)}>{v}%</button>)}
              <button className="khac" title="Nhập % khác" onClick={quickLnAsk}>Khác…</button>
            </div>
            <span className="qs-cp-lnq-sc">{lnScopeLbl()}</span>
          </div>
        )}

        <div ref={sheetBox} className={`qs-card qs-bd-sheet qs-ct-sheet${full ? ' full' : ''}`}>
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
            fileName={'chi-phi-' + cur.maDA}
            printTitle={(cur.ten || cur.maDA) + ' — Chi phí'}
            columns={columns} flatten={flatten} initialSel={INITIAL_SEL} rowClass={rowClass} onToggleGroupOverride={toggleGroup}
            footer={false}
            adapter={adapter} wrapKey="wrap" hideTools={['import', 'csv']} extraTools={extraTools}
            onInsertRow={e => (e.type === 'item' ? bocAct.insertRowBelow(e.r.lineId, e.r.nhom || hmNode || qs.node, '') : null)}
            onDuplicate={ids => bocAct.dupRows(ids)}
            onSort={(key, dir, label) => { setSort({ key, dir }); toast('Sắp xếp ' + (dir === 'asc' ? 'A → Z' : 'Z → A') + ' theo "' + label + '"') }}
            onDownload={xuatExcel}
            onSelItems={ids => setSelIds(ids)}
            onApplyEdits={(info, cells) => applyCells(info, cells, plain)}
            onReplaceAll={(fq, rep) => replaceAll(fq, rep, rows, keys)}
            onCellContext={plain ? null : ctx => setPop({ kind: 'ctx', at: { x: ctx.ev.clientX, y: ctx.ev.clientY }, entry: ctx.entry, col: ctx.col, ids: ctx.ids, keys: ctx.keys })}
            plainTools={() => null}
            onDeleteRows={ids => (ids.length ? mutate.deleteLines(ids, { confirm: true }) : toast('Chọn ô ở các dòng cần xoá'))}
            onColResize={setColW} onColMove={(from, to, before) => { if (from !== 'stt' && to !== 'stt') moveCol('cp', from, to, before) }}
            onColMenu={key => { if (key !== 'stt') cycleSort(key) }} colMarks={colMarks}
            rowDrag={rowDrag} plainFmt={false}
            renderCell={renderCell}
            gridClass={`qs-tk-grid qs-cp-grid${plain ? ' qs-tk-plain' : ''}`} emptyNode={emptyNode}
            colCount={{ shown: keys.length, total: CP_KEYS.length }}
            colsPanel={<ColChips t="cp" cols={colSet.cols} />}
          />
        </div>
        </div>
      </div>

      {visible && cmp && group && (
        <CompareDrafts group={group} curMa={cur.maDA} curLines={lines} onOpen={ma => selectProject(ma)} onClose={() => setCmp(false)} />
      )}
      {visible && <TickBar maDA={cur.maDA} lines={tickLines} keys={keys} shownIds={shownIds} />}
      {visible && pop && pop.kind === 'preset' && <PresetPop t="cp" anchor={pop.anchor} cols={colSet.cols} onClose={() => setPop(null)} />}
      {visible && bmt && <BienMucTieuDialog lines={bmt.lines} skipped={bmt.skipped} scopeLbl={bmt.scopeLbl} init={cpCfg.bienMT}
        onApply={bienMucTieuApply} onClose={() => setBmt(null)} />}
      {visible && pop && pop.kind === 'gia' && <PriceSyncModal ds={pop.ds} onClose={() => setPop(null)} />}
      {visible && pop && pop.kind === 'ctx' && (
        <CpCtxMenu at={pop.at} entry={pop.entry} col={pop.col} ids={pop.ids} keys={pop.keys} sortKey={sort.key} act={ctxAct} onClose={() => setPop(null)} />
      )}
      {visible && pop && pop.kind === 'recent' && (
        <RecentPop anchor={pop.anchor} lines={lines} onClose={() => setPop(null)}
          onGo={l => { if (hmNode && !daScope_([l], hmNode).length) setHmNode(''); setQ(''); setFlt(''); flashTo(l.lineId) }}
          onPlus={l => { mutate.updateLine(l.lineId, { soLuong: (Number(l.soLuong) || 0) + 1 }); toast('+1 số lượng: ' + l.ten) }} />
      )}
    </>
  )
}

