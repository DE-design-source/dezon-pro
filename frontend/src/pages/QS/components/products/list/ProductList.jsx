import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import QsIcon from '../../common/QsIcon'
import { useMroot } from '../../common/Mroot'
import { MrootPortal } from '../../common/ModalHost'
import ProductEditModal from '../edit/ProductEditModal'
import ProductsPtMode from '../pt/index.jsx'
import { useQs } from '../../../state/QsData'
import { useQsStore, isAdminRole_, setState as setStore, getState } from '../../../state/store'
import { isAbort } from '../../../api/http'
import * as api from '../../../api/qsApi'
import { mediaUrl } from '../../../api/files'
import { money } from '../../../lib/format.js'
import { nodeName } from '../../../lib/tree.js'
import { csMyCols_, csMyOn_, csMyApply_, csMyKey_, csQuickLabel_, csPresetCols_, csWant_, csPresetList_, csPresetKeys_ } from '../../../lib/columns.js'
import { ctSyncTemplate_, ptTemplateNew_ } from '../../../lib/phantho.js'
import { useSpecs } from '../../breakdown/catalog/useSpecs'
import { useComboCache, loadCombo } from '../../breakdown/catalog/comboCache'
import ProjPanel from './ProjPanel'
import SpTable from './SpTable'
import SpCards from './SpCards'
import { useFitLevel } from '../../common/useFitLevel'
import SpModal from './SpModal'
import { CatPop, FilterPop, PresetPop, BulkEditPop, MorePop, CopyMenu, ColMenu, OverPop } from './SpPops'
import { useSpUi, getU, setU, setPer, clearSel } from './spStore'
import {
  lsJson, lsSet, spKey_, spPanelHidden_, foldCols_, foldColsToggle_, spNganhCur_, spPTMode_, spAllCols_, spSkuMap_, spSkuCount_,
  spColsNg_, spColScope_, spColsLoad_, spCfgLoad_, spCfgSave_, spQuickLoad_, spOrder_, spColOn_, spColList_, spVisCols_, SP_COL_CB, spColset_, spMoveCol_,
  SP_PER, spPageNums_, spNodeCount_, spScopeProducts_, SP_FLT_EMPTY, spFltCount_, spAnyFilter_, spSortNext_,
  spDataList_, spVarGroups2_, spNhomBienThe_, spPageRows_, spSelProds_, spBulkFields_, spLabel2Col_,
} from './spModel'
import {
  spFav, spFavBulk, spDuyet, spDuyetBulk, undoSubscribe, undoGet, spUndo_, spExportXlsx, spAddManyToProject_, spAddToProject,
  spBulkApply, spBulkDelete, spBulkRequest, spDelete, spLoadPerm_,
} from './spActions'
import './list.css'

/* Tab Danh sách sản phẩm (renderSanpham và các hàm sp* của PUB/sanpham.js:1-1130, 1488-1848):
   panel trái "Sản phẩm trong dự án", thanh công cụ (tìm, tab trạng thái duyệt, hạng mục, Hoàn tác, Edit, Bộ lọc, Tải Excel,
   Thêm sản phẩm), hàng chọn cột, bảng (cột theo ngành, biến thể, combo, sửa nhanh), phân trang, thanh chọn nhiều, modal chi tiết.
   Hạng mục của bảng = node trong spStore (S._spFilters.node), chọn ở đây thì đồng bộ hmNode (hmSet_ 'sp'); 3.1 Phần thô hiện products/pt (3B). */
/* Biểu tượng nút thao tác trên băng: cùng bộ nét mảnh (kiểu Lucide), 16px, nét 2 */
const UNDO_IC = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
const EDIT_IC = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.38 3.62a2.12 2.12 0 0 1 3 3L7.37 18.64a2 2 0 0 1-.86.5l-3.51 1 1-3.51a2 2 0 0 1 .5-.86z" /></svg>
const DONE_IC = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
const XLS_IC = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V3" /><path d="m7 10 5 5 5-5" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /></svg>
const NEXT_IC = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
/* Chế độ xem: Bảng (mặc định) · Lưới thẻ · Danh sách — nhớ trong máy (qs_splayout) */
const LAYOUTS = [
  ['table', 'Bảng', <svg key="t" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 10v10" /></svg>],
  ['grid', 'Lưới', <svg key="g" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>],
  ['list', 'Danh sách', <QsIcon key="l" name="list" size={15} />],
]
const FILTER_IC = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h18l-7 8.5V19l-4 2v-8.5z" /></svg>
const SEARCH_IC = <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>

export default function ProductList() {
  const qs = useQs()
  const { products, cur, lines, congTac, setHmNode, toast, confirm, navigate, consumeIntent } = qs
  const visible = qs.panelVisible('sanpham')
  const seq = useQsStore(s => (s.visSeq && s.visSeq.sanpham) || 0)
  const me = useQsStore(s => s.me)
  const U = useSpUi()
  const { specs, error: specErr } = useSpecs()
  const combo = useComboCache()
  const undoSt = useSyncExternalStore(undoSubscribe, undoGet, undoGet)
  const mroot = useMroot()

  const node = U.node || ''
  const PT = spPTMode_(node)
  const ng = spNganhCur_(node)
  const ngCols = spColsNg_(ng)
  const sc = spColScope_(node)
  const isAdmin = isAdminRole_(me)
  const canEdit = U.perm ? !!U.perm.edit : true
  const canDuyet = U.perm ? !!U.perm.duyet : true

  const [panelHidden, setPanelHidden] = useState(spPanelHidden_)
  const [folded, setFolded] = useState(foldCols_)
  const [pop, setPop] = useState(null)          // {kind, anchor, p?}
  const [dlg, setDlg] = useState(null)          // {kind: 'detail' | 'edit', p, mode?: 'edit' | 'copy' | 'variant' | 'nbt'}
  const [xlsBusy, setXlsBusy] = useState(false)
  const [dragOn, setDragOn] = useState(false)
  const [wrapW, setWrapW] = useState(0)
  const [layout, setLayoutSt] = useState(() => { const v = lsJson('qs_splayout', 'table'); return LAYOUTS.some(l => l[0] === v) ? v : 'table' })
  const setLayout = v => { setLayoutSt(v); lsSet('qs_splayout', JSON.stringify(v)) }
  /* Thanh công cụ luôn 1 dòng; thiếu chỗ thì gọn dần (data-fit, list.css): 1 = nút thao tác chỉ còn biểu tượng, 2 = nút chế độ xem
     chỉ còn biểu tượng, 3 = cho xuống dòng */
  const tbRef = useRef(null)
  /* Nút bộ cột (như Bóc tách): mở cùng lúc bảng Chọn nhanh cột + dải chip cột; đóng một bên là đóng cả hai.
     stripByPreset = dải chip do nút bộ cột mở (trước đó đang đóng) -> đóng bảng thì gập dải lại */
  const stripByPreset = useRef(false)
  useFitLevel(tbRef, 3, '.qspl-mod', [PT])
  const dragList = useRef(null)
  const ghost = useRef(null)
  const wsRef = useRef(null)
  const pendingOpen = useRef(null)

  /* ---------- Quyền sửa / duyệt: tải lại mỗi lần vào tab (renderSanpham -> spLoadPerm_) ---------- */
  useEffect(() => {
    if (!visible) return undefined
    const ctl = new AbortController()
    spLoadPerm_(ctl.signal).then(perm => setU({ perm }), e => { if (!isAbort(e)) setU({ perm: { edit: true, duyet: true } }) })
    return () => ctl.abort()
  }, [visible, seq])

  /* ---------- Cột ---------- */
  const hmLoai = U.f.hangMuc || ''   // lọc "Hạng mục SP": dải chip chỉ còn thông số của loại đó
  const cols = useMemo(() => spAllCols_(node, specs, hmLoai), [node, specs, hmLoai])
  const colOn = (U.colSc === sc && U.colOn) ? U.colOn : spColsLoad_(ngCols, sc)
  const savedOrder = U.order != null ? U.order : spCfgLoad_().order
  const w = U.w != null ? U.w : spCfgLoad_().w
  const order = useMemo(() => spOrder_(savedOrder, cols), [savedOrder, cols])
  const colList = useMemo(() => spColList_(cols, order), [cols, order])
  const visCols = useMemo(() => spVisCols_(cols, order, colOn), [cols, order, colOn])
  const tab = useMemo(() => spColset_(colList, ngCols), [colList, ngCols])

  /* đổi hạng mục (spColsSync_): nạp bộ cột đã lưu của hạng mục đó; đang Edit thì vẫn bật hết cột nhập được */
  useEffect(() => {
    const u = getU()
    if (u.colSc === sc && u.colOn) return
    let on = spColsLoad_(ngCols, sc), bak = null
    if (u.edit) { bak = on; on = { ...on, thumb: 1 }; cols.forEach(c => { if (c.e) on[c.k] = 1 }) }
    setU({ colSc: sc, colOn: on, colBak: bak, order: null, w: null })
  }, [sc, ngCols, cols])

  /* Đăng nhập: bật bộ cột "Của tôi" của tài khoản, chưa lưu thì Mặc định (csMyApplyAll_ trong onAuthed_, app.js:2476).
     Lúc đó chưa lọc hạng mục nên bộ cột là của mọi ngành, lưu vào khoá đèn ('on'). */
  const username = (me && me.username) || ''
  useEffect(() => {
    if (!username || getU().colUser === username) return
    if (!specs && !specErr) return     // chờ thông số ngành: thứ tự cột lưu dưới đây phải có đủ cột mọi ngành như bản gốc
    const all = spAllCols_('', specs)
    const ordAll = spOrder_(spCfgLoad_().order, all)
    const t = spColset_(spColList_(all, ordAll), 'den')
    const mine = csMyCols_(t, me.uiPrefs, lsJson(csMyKey_('sp', username), null))
    const m = csMyApply_(t, mine)
    const on = { ...spColsLoad_('den') }
    t.keys().forEach(k => { on[k] = !!m[k] })
    // COLSET.sp.set -> spSaveCols_ lưu S._spOrder = thứ tự gộp mọi ngành (spOrder_ lúc chưa lọc), không phải bản đã lưu (có thể null).
    // Tải thông số ngành lỗi thì thứ tự gộp thiếu cột ngành: giữ bản đã lưu, không ghi đè bằng bản thiếu
    spCfgSave_(specs ? ordAll : spCfgLoad_().order, spCfgLoad_().w, 'den', on)
    // bộ trên chỉ là dự phòng của hạng mục chưa lưu cột riêng (spColsLoad_): nạp lại cột của hạng mục đang xem
    const u = getU(), sc0 = spColScope_(u.node)
    setU(u.colSc === sc0 ? { colUser: username, colOn: spColsLoad_(spColsNg_(spNganhCur_(u.node)), sc0), colBak: null } : { colUser: username })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, specs, specErr])

  function saveCols(patch) {
    const u = getU()
    const next = {
      colOn: patch.colOn || colOn, order: patch.order || order, w: patch.w || w,
    }
    setU({ colSc: sc, ...patch })
    // đang Edit (bật hết cột) -> lưu bộ cột thật của người dùng
    spCfgSave_(next.order, next.w, ngCols, (u.edit && u.colBak) || next.colOn, sc)
  }
  function colSet(m) {
    const on = { ...colOn }
    tab.keys().forEach(k => { on[k] = !!m[k] })
    saveCols({ colOn: on })
  }
  function colToggle(k) {
    if (k === 'ten' || k === 'stt') return
    saveCols({ colOn: { ...colOn, [k]: !colOn[k] } })
  }
  function colAll(on) {
    const m = { ...colOn }
    colList.forEach(c => { if (c.k !== 'ten' && c.k !== 'stt') m[c.k] = !!on })
    saveCols({ colOn: m })
  }
  function colCoBan() { const m = {}; SP_COL_CB.forEach(k => { m[k] = 1 }); colSet(m) }

  /* Bộ cột "Của tôi" (csMyCols_ / csMySave_ / csMyClear_, app.js:1696-1731) */
  const mine = csMyCols_(tab, me && me.uiPrefs, lsJson(csMyKey_('sp', username), null))
  const onMap = useMemo(() => { const m = {}; tab.keys().forEach(k => { m[k] = spColOn_(colOn, k) }); return m }, [tab, colOn])
  const mineOn = csMyOn_(tab, mine, onMap)
  const quick = csQuickLabel_(tab, onMap, mine)
  /* Bộ tự đặt tên chỉ thuộc hạng mục lúc tạo (c.node = khoá hạng mục); bộ cũ chưa có node coi như của "Tất cả hạng mục" */
  const cuKey = 'qs_spcols_custom_' + String(username || '').toLowerCase()
  const [customsAll, setCustomsAll] = useState(() => lsJson(cuKey, []))
  useEffect(() => { setCustomsAll(lsJson(cuKey, [])) }, [cuKey])
  const customs = useMemo(() => (customsAll || []).filter(c => (c.node || '*') === sc), [customsAll, sc])
  const saveCustoms = list => {
    const all = (customsAll || []).filter(c => (c.node || '*') !== sc).concat(list.map(c => ({ ...c, node: sc })))
    setCustomsAll(all); lsSet(cuKey, JSON.stringify(all))
  }
  async function customNew() {
    const r = await qs.ask({ title: 'Lưu bộ cột mới', ok: 'Lưu', fields: [{ key: 'ten', label: 'Tên bộ cột *', placeholder: 'VD: Báo giá nhanh' }] })
    // hộp nhập 1 ô trả về chuỗi (nhiều ô mới trả {key: giá trị}, common/InputDialog)
    const ten = String((r && typeof r === 'object' ? r.ten : r) || '').trim()
    if (!ten) return false
    const keys = tab.keys().filter(k => onMap[k])
    saveCustoms([...customs.filter(c => c.name !== ten), { name: ten, keys }])
    toast('Đã lưu bộ cột "' + ten + '" (' + keys.length + ' cột) cho ' + catLabel)
    return true
  }
  /* Nút nhanh (1)(2) trên băng: gán 1 bộ cột vào mỗi ô ở chế độ sửa của khung Chọn nhanh cột; bấm nút = áp bộ đó.
     id bộ: 'mine' | mã bộ dựng sẵn | 'u:' + tên bộ tự đặt. Lưu trong máy theo tài khoản và hạng mục (qs_spcols_quick_<user>) */
  const qkKey = 'qs_spcols_quick_' + String(username || '').toLowerCase()
  const [quickAll, setQuickAll] = useState(() => spQuickLoad_(qkKey))
  useEffect(() => { setQuickAll(spQuickLoad_(qkKey)) }, [qkKey])
  const quickSlots = quickAll[sc] || [null, null]
  function setQuickSlot(i, id) {
    const n = [0, 1].map(j => (j === i ? id : (quickSlots[j] === id && id ? null : quickSlots[j] || null)))
    const all = { ...quickAll, [sc]: n }
    setQuickAll(all); lsSet(qkKey, JSON.stringify(all))
  }
  function quickPreset(id) {
    if (!id) return null
    if (id === 'mine') return mine ? { name: 'Của tôi', map: csMyApply_(tab, mine) } : null
    if (id.indexOf('u:') === 0) { const c = customs.find(x => x.name === id.slice(2)); return c ? { name: c.name, map: csWant_(tab, c.keys) } : null }
    const ps = csPresetList_(tab).find(x => x[0] === id && id !== 'all')
    return ps ? { name: ps[1], map: csPresetCols_(tab, id) || csWant_(tab, csPresetKeys_(tab, ps)) } : null
  }
  const quickOn = m => tab.keys().every(k => !!onMap[k] === !!m[k])
  const [presetCur, setPresetCur] = useState(null)   // id bộ vừa bấm: khung Chọn nhanh cột chỉ đánh dấu 1 bộ khi nhiều bộ trùng cột
  /* Chế độ sửa của dải chip (như Bóc tách ColsStrip): bật / tắt chip (bảng đổi ngay) rồi Tạo mới / Lưu đè / Huỷ (trả cột cũ).
     stripEdit = {from: tên bộ đang sửa | null, snap: cột lúc bắt đầu} */
  const [stripEdit, setStripEdit] = useState(null)
  const [overAt, setOverAt] = useState(null)
  /* Mở khung Chọn nhanh cột bên trái (nếu đang đóng), neo vào nút bộ cột trên băng */
  const showPresetDock = () => setPop(p => (p && p.kind === 'preset' ? p : { kind: 'preset', anchor: document.querySelector('.qspl-presetbtn') }))
  function startStripEdit(from) {
    if (foldCols_()) setFolded(foldColsToggle_())
    showPresetDock()
    setStripEdit(se => ({ from: from || null, snap: se ? se.snap : colOn }))
  }
  function cancelStripEdit() { if (stripEdit) saveCols({ colOn: stripEdit.snap }); setStripEdit(null) }
  /* Tạo mới xong: bộ mới hiện ngay trong khung Chọn nhanh cột bên trái (mở khung nếu đang đóng) */
  async function stripSaveNew() { if (await customNew()) { setStripEdit(null); showPresetDock() } }
  async function stripSaveOver(name) {
    if (!name) { await mineSave(null, true); setStripEdit(null); return }
    const keys = tab.keys().filter(k => onMap[k])
    saveCustoms(customs.map(c => (c.name === name ? { name, keys } : c)))
    toast('Đã lưu đè bộ cột "' + name + '" (' + keys.length + ' cột)')
    setStripEdit(null)
  }
  async function customDel(name) {
    if (!await confirm('Xoá bộ cột "' + name + '"?')) return
    saveCustoms(customs.filter(c => c.name !== name))
  }
  /* Lưu bộ "Của tôi" = cột đang hiện, hoặc keysIn (đặt 1 bộ làm mặc định); keep = giữ khung Chọn nhanh cột mở */
  async function mineSave(keysIn, keep) {
    const keys = Array.isArray(keysIn) ? keysIn : tab.keys().filter(k => onMap[k])
    lsSet(csMyKey_('sp', username), JSON.stringify(keys))
    if (!keep) setPop(null)
    try {
      const r = await api.setMyPref(tab.pref, keys)
      const m0 = getState().me
      if (m0) setStore({ me: { ...m0, uiPrefs: (r && r.uiPrefs) || { ...(m0.uiPrefs || {}), [tab.pref]: keys } } })
      toast('Đã lưu ' + keys.length + ' cột làm mặc định của tài khoản ' + username)
    } catch (e) { toast('Đã lưu trên máy này. Lưu theo tài khoản lỗi: ' + ((e && e.message) || e)) }
  }
  async function mineClear() {
    setPop(null)
    if (!await confirm('Xoá bộ cột "Của tôi" của bảng ' + tab.ten + '? Lần sau đăng nhập sẽ dùng bộ Mặc định.')) return
    lsSet(csMyKey_('sp', username), null)
    const m0 = getState().me
    try {
      const r = await api.setMyPref(tab.pref, null)
      if (m0) setStore({ me: { ...m0, uiPrefs: (r && r.uiPrefs) || {} } })
    } catch (e) {
      if (m0 && m0.uiPrefs) { const up = { ...m0.uiPrefs }; delete up[tab.pref]; setStore({ me: { ...m0, uiPrefs: up } }) }
      toast('Lỗi xoá bộ cột theo tài khoản: ' + ((e && e.message) || e))
      return
    }
    toast('Đã xoá bộ cột của tôi')
  }

  /* ---------- Dữ liệu ---------- */
  const f = useMemo(() => ({ ...U.f, node }), [U.f, node])
  const full = useMemo(() => (PT ? [] : spDataList_(products, U.q, f, U.view, U.sort, cols)), [PT, products, U.q, f, U.view, U.sort, cols])
  const fullKeys = useMemo(() => { const m = {}; full.forEach(p => { m[spKey_(p)] = 1 }); return m }, [full])
  /* dòng đã tick mà lọc / tìm làm khuất thì bỏ chọn (spFilter) */
  useEffect(() => {
    if (PT) return
    const bo = Object.keys(U.sel).filter(k => !fullKeys[k])
    if (bo.length) setU(s => { const sel = { ...s.sel }; bo.forEach(k => { delete sel[k] }); return { sel } })
  }, [PT, fullKeys, U.sel])

  const groups = useMemo(() => spVarGroups2_(full), [full])
  const cbData = {}
  Object.keys(U.cbOpen).forEach(k => { const c = combo[k]; if (c && c.list) cbData[k] = c.list; else if (c && c.error) cbData[k] = { err: c.error } })
  const pr = spPageRows_(groups, U.page, U.per, U.btOpen, U.cbOpen, cbData)
  useEffect(() => { if (!PT && pr.cur !== U.page) setU({ page: pr.cur }) }, [PT, pr.cur, U.page])
  useEffect(() => { Object.keys(U.cbOpen).forEach(k => { if (!combo[k]) loadCombo(k) }) }, [U.cbOpen, combo])

  const skuMap = useMemo(() => spSkuMap_(products), [products])
  const scope = useMemo(() => spScopeProducts_(products, node), [products, node])
  const ptCount = useMemo(() => ctSyncTemplate_(ptTemplateNew_(), congTac).tpl.filter(s => !s.an).reduce((a, s) => a + (s.items || []).length, 0), [congTac])
  const nodeCount = code => (code === '3.1' ? ptCount : spNodeCount_(products, code))

  const selKeys = Object.keys(U.sel)
  const nSel = selKeys.length
  const selProds = () => spSelProds_(U.sel, pr.rows, full)
  const selNhom = () => {
    const ds = [], da = {}
    selProds().forEach(p => spNhomBienThe_(products, p).forEach(x => { const k = spKey_(x); if (k && !da[k]) { da[k] = 1; ds.push(x) } }))
    return ds
  }

  /* ---------- Ý định từ thông báo: tìm mã và mở SP đầu (notifOpenSP_, app.js:2580-2587) ---------- */
  useEffect(() => {
    if (!visible) return
    const it = consumeIntent('sanpham')
    if (it && it.spSearch) {
      const ma = String(it.spSearch)
      setU({ q: ma, page: 1 })
      if (it.openFirst) pendingOpen.current = ma
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, seq])
  useEffect(() => {
    const ma = pendingOpen.current
    if (!ma || U.q !== ma) return
    pendingOpen.current = null
    const first = pr.rows.filter(r => !r.m.k)[0]
    if (first) setDlg({ kind: 'detail', p: first.p })
    else toast('Không tìm thấy sản phẩm ' + ma + ' (có thể đã bị xoá)')
  })

  /* ---------- Phím: Ctrl+Z hoàn tác (không đang gõ), Esc đóng bảng nổi / bỏ chọn ---------- */
  const keyRef = useRef(null)
  keyRef.current = e => {
    if (!visible) return
    if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      const a = document.activeElement, tg = a ? a.tagName : ''
      if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT' || (a && a.isContentEditable)) return
      e.preventDefault(); spUndo_()
      return
    }
    if (e.key === 'Escape' && !dlg) {
      if (pop && (pop.kind === 'bbedit' || pop.kind === 'bbmore')) { setPop(null); return }
      if (nSel) clearSel()
    }
  }
  useEffect(() => {
    const h = e => keyRef.current && keyRef.current(e)
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  /* ---------- Bảng vừa khít màn hình (spCaoFit_): bảng cuộn bên trong, trang không cuộn ---------- */
  useLayoutEffect(() => {
    const ws = wsRef.current
    if (!ws || !visible) return
    const wrap = ws.querySelector('[data-sp-wrap]')
    const scr = ws.closest('.qs-scroll')
    const padB = scr ? (parseFloat(getComputedStyle(scr).paddingBottom) || 0) : 0
    const zf = (ws.offsetWidth ? ws.getBoundingClientRect().width / ws.offsetWidth : 1) || 1
    if (wrap) {
      if (wrapW !== wrap.clientWidth) setWrapW(wrap.clientWidth)
      if (window.innerWidth <= 900) wrap.style.height = ''
      else {
        let duoi = 0
        for (let e = wrap.nextElementSibling; e; e = e.nextElementSibling) {
          const cs = getComputedStyle(e)
          duoi += e.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0)
        }
        const card = wrap.closest('.qspl-card')
        const cardB = card ? (parseFloat(getComputedStyle(card).borderBottomWidth) || 0) : 0
        const h = Math.max(220, Math.floor((window.innerHeight - wrap.getBoundingClientRect().top) / zf - duoi - cardB - padB - 10))
        wrap.style.height = h + 'px'
      }
    }
    const pn = ws.querySelector('.qspl-pp')
    if (pn) {
      if (window.innerWidth <= 900) pn.style.height = ''
      else pn.style.height = Math.max(220, Math.floor((window.innerHeight - pn.getBoundingClientRect().top) / zf - padB - 10)) + 'px'
    }
  })
  const [, bump] = useState(0)
  useEffect(() => {
    let t = 0
    const rs = () => { clearTimeout(t); t = setTimeout(() => bump(x => x + 1), 120) }
    window.addEventListener('resize', rs)
    const ro = window.ResizeObserver ? new ResizeObserver(rs) : null
    if (ro && wsRef.current) ro.observe(wsRef.current)
    return () => { clearTimeout(t); window.removeEventListener('resize', rs); if (ro) ro.disconnect() }
  }, [])

  /* ---------- Kéo dòng thả vào panel trái (spRowDragStart / spRowDragEnd / spPanelDrop) ---------- */
  function dragStart(e, p) {
    const k = spKey_(p)
    let list = U.sel[k] ? selProds() : [p]
    if (!list.length) list = [p]
    dragList.current = list
    const many = list.length > 1
    try {
      e.dataTransfer.effectAllowed = 'copy'
      e.dataTransfer.setData('text/plain', many ? (list.length + ' sản phẩm') : (p.ten || ''))
      const host = mroot || document.querySelector('.qs-page')
      if (host) {
        const g = document.createElement('div')
        g.className = 'qspl-ghost'
        const im = p.hinhAnh ? mediaUrl(String(p.hinhAnh).split('\n')[0].trim()) : ''
        const t1 = many ? (list.length + ' sản phẩm đã chọn') : (p.ten || '')
        const t2 = many ? ('Tổng ' + money(list.reduce((a, x) => a + (Number(x.donGiaBan) || 0), 0)) + ' đ') : (money(p.donGiaBan) + ' đ')
        if (im) { const i = document.createElement('img'); i.src = im; i.onerror = () => { i.style.visibility = 'hidden' }; g.appendChild(i) } else { const s = document.createElement('span'); s.className = 'img'; g.appendChild(s) }
        const b = document.createElement('span'); b.className = 'b'
        const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = t1
        const pr2 = document.createElement('span'); pr2.className = 'pr'; pr2.textContent = t2
        b.appendChild(nm); b.appendChild(pr2); g.appendChild(b)
        if (many) { const bd = document.createElement('span'); bd.className = 'badge'; bd.textContent = String(list.length); g.appendChild(bd) }
        const ad = document.createElement('span'); ad.className = 'add'; ad.textContent = '+ Thả vào dự án'; g.appendChild(ad)
        host.appendChild(g); ghost.current = g
        e.dataTransfer.setDragImage(g, 24, 28)
      }
    } catch (x) { /* trình duyệt không cho đặt ảnh kéo: vẫn kéo được */ }
    setDragOn(true)
  }
  function dragEnd() {
    if (ghost.current) { try { ghost.current.remove() } catch (x) { /* đã gỡ */ } ghost.current = null }
    setDragOn(false)
  }
  function panelDrop() {
    const list = (dragList.current || []).slice()
    dragList.current = null
    dragEnd()
    if (!list.length) return
    if (!cur) { toast('Chưa chọn dự án — chọn dự án ở ô trên trước'); return }
    spAddManyToProject_(list)
  }
  function panelToggle() {
    const on = !panelHidden
    lsSet('qs_spPanelHide', on ? '1' : '0')
    setPanelHidden(on)
    toast(on ? 'Đã thu gọn panel — bấm nút bên trái để hiện lại' : 'Đã hiện panel Sản phẩm trong dự án')
  }

  /* ---------- Thao tác ---------- */
  const setF = patch => setU(s => ({ f: { ...s.f, ...patch }, page: 1 }))
  function selFilter(key, val) { setU(s => { const n = { ...s.f }; if (!val) delete n[key]; else n[key] = val; return { f: n, page: 1 } }) }
  function fltSpec(fkey, val) {
    setU(s => { const o = { ...(s.f[fkey] || {}) }; if (o[val]) delete o[val]; else o[val] = 1; return { f: { ...s.f, [fkey]: o }, page: 1 } })
  }
  function catPick(code) {
    setPop(null)
    setU({ node: code, f: SP_FLT_EMPTY(), page: 1, sel: {} })
    setHmNode(code, 'sp')                       // đồng bộ sang các tab khác
  }
  function editToggle() {
    const on = !U.edit
    if (on) {
      const n = { ...colOn, thumb: 1 }
      cols.forEach(c => { if (c.e) n[c.k] = 1 })   // hiện TẤT CẢ cột nhập được
      setU({ edit: true, colBak: { ...colOn }, colOn: n, colSc: sc })
    } else setU({ edit: false, colOn: U.colBak || colOn, colBak: null, colSc: sc })
    toast(on ? 'Sửa nhanh: gõ thẳng vào ô, rời ô là tự lưu' : 'Đã tắt chế độ sửa nhanh')
  }
  async function exportXlsx(keysIn) {
    const keys = keysIn || (selKeys.length ? selKeys : full.map(spKey_).filter(Boolean))
    setXlsBusy(true)
    try { await spExportXlsx(keys) } finally { setXlsBusy(false) }
  }
  function editP(p, mode) {
    if (!p.ma) { toast('Sản phẩm chưa có mã — không cập nhật được'); return }
    setDlg({ kind: 'edit', p, mode: mode || 'edit' })
  }
  function cbToggle(p) {
    const k = spKey_(p); if (!k) return
    const mo = !U.cbOpen[k]
    setU(s => { const o = { ...s.cbOpen }; if (mo) o[k] = 1; else delete o[k]; return { cbOpen: o } })
    if (mo && (!combo[k] || combo[k].error)) loadCombo(k, true)
  }
  function btToggle(key) {
    const wrap = wsRef.current && wsRef.current.querySelector('[data-sp-wrap]')
    const t = wrap ? wrap.scrollTop : 0
    setU(s => { const o = { ...s.btOpen }; if (o[key]) delete o[key]; else o[key] = 1; return { btOpen: o } })
    requestAnimationFrame(() => { if (wrap) wrap.scrollTop = t })   // giữ nguyên chỗ đang xem
  }
  function selAll(on) {
    const sel = {}
    if (on) pr.rows.forEach(r => { if (r.m.k === 'cb') return; const k = spKey_(r.p); if (k) sel[k] = 1 })
    setU({ sel })
  }
  function selToggle(k, on) { setU(s => { const sel = { ...s.sel }; if (on) sel[k] = 1; else delete sel[k]; return { sel } }) }
  function goPage(n) {
    setU({ page: n })
    const wrap = wsRef.current && wsRef.current.querySelector('[data-sp-wrap]')
    if (wrap) wrap.scrollTop = 0
  }
  function bulkToProject() {
    const list = selProds(); if (!list.length) return
    if (!cur) { toast('Chưa chọn dự án — chọn ở ô "Sản phẩm trong dự án" bên trái'); return }
    spAddManyToProject_(list); clearSel()
  }
  async function bulkDelete() {
    if (isAdmin) { if (await spBulkDelete(selProds(), nSel)) clearSel() }
    else if (await spBulkRequest(selKeys.filter(k => U.sel[k]))) clearSel()
  }

  const tableOn = {
    sort: k => setU(s => ({ sort: spSortNext_(s.sort, k), page: 1 })),
    move: (from, to, before) => saveCols({ order: spMoveCol_(order, from, to, before) }),
    resize: (k, px, done) => { const nw = { ...w, [k]: px }; if (done) saveCols({ w: nw }); else setU({ w: nw }) },
    selAll, selToggle,
    open: p => setDlg({ kind: 'detail', p }),
    dragStart, dragEnd,
    fav: p => spFav(p, !p.yeuThich),
    add: p => spAddToProject(p),
    duyet: p => spDuyet(p, !p.daDuyet),
    editP: p => editP(p),
    copy: (e, p) => { e.stopPropagation(); setPop({ kind: 'copy', anchor: e.currentTarget, p }) },
    del: p => spDelete(p),
    cbToggle, cbIsOpen: p => !!U.cbOpen[spKey_(p)], btToggle,
    colMenu: (c, a) => setPop(p => (p && p.kind === 'colmenu' && p.col.k === c.k ? null : { kind: 'colmenu', anchor: a, col: c })),
  }

  /* ---------- Vẽ ---------- */
  const fltN = spFltCount_(f)
  const chua = scope.filter(p => !p.daDuyet).length
  const viewTabs = [
    ['all', 'Tất cả', scope.length ? String(scope.length) : ''],
    ['chua', 'Chưa duyệt', chua ? String(chua) : ''],
    ['da', 'Đã duyệt', (scope.length - chua) ? String(scope.length - chua) : ''],
  ]
  const favN = scope.filter(p => p.yeuThich).length
  const catLabel = node ? (node + '.' + nodeName(node)) : 'Tất cả hạng mục'
  const catCnt = node ? nodeCount(node) : (products || []).length
  const catBtn = (
    <div className="qspl-scope">
      <button type="button" className="qspl-catbtn" onClick={e => { const a = e.currentTarget; setPop(p => (p && p.kind === 'cat' ? null : { kind: 'cat', anchor: a })) }}>
        <span className="lbl">{catLabel}</span><span className="cnt">{catCnt}</span><span className="caret">▾</span>
      </button>
    </div>
  )
  const tags = [['brand', 'Thương hiệu'], ['hangMuc', 'Hạng mục SP'], ['dong', 'Dòng SP']].filter(t => f[t[0]])
  const totalSP = full.length
  const per = U.per
  const from = groups.length ? ((pr.cur - 1) * (per || groups.length) + 1) : 0
  const to = per ? Math.min(groups.length, pr.cur * per) : groups.length
  const info = (totalSP === groups.length) ? (groups.length + ' sản phẩm') : (groups.length + ' dòng · ' + totalSP + ' sản phẩm')
  const xlsLbl = xlsBusy ? 'Đang tạo file…' : (nSel ? ('Tải Excel (' + nSel + ')') : 'Tải Excel')
  function openColTools(a) {
    setPop({ kind: 'preset', anchor: a })
    if (folded) { stripByPreset.current = true; setFolded(foldColsToggle_()) }
  }
  function closeColTools() {
    setPop(p => (p && p.kind === 'preset' ? null : p))
    if (stripByPreset.current && !foldCols_()) setFolded(foldColsToggle_())
    stripByPreset.current = false
  }
  function closeStrip() {
    if (stripEdit) cancelStripEdit()
    if (pop && pop.kind === 'preset') { closeColTools(); if (!foldCols_()) setFolded(foldColsToggle_()); return }
    setFolded(foldColsToggle_())
  }
  const showLayout = U.edit ? 'table' : layout   // sửa nhanh chỉ có ở dạng Bảng
  const live = dlg ? ((products || []).filter(x => spKey_(x) === spKey_(dlg.p))[0] || dlg.p) : null

  return (
    <div className={`qspl-ws${panelHidden ? ' panel-hidden' : ''}${PT ? '' : ' banded'}`} ref={wsRef}>
      {/* Băng xanh như băng dự án của Bóc tách: nút chọn hạng mục ở đầu băng (thẳng cột panel, như ô chọn dự án của Bóc tách) + các cụm công cụ */}
      {!PT && (
        <div className="qspl-band">
              <div className="qspl-toolbar" ref={tbRef}>
                <div className="qspl-catmod">{catBtn}</div>
                {/* Bộ lọc: vị trí đầu tiên, chỉ biểu tượng phễu (tên ở chú thích khi rê chuột), số bộ lọc đang bật ở góc */}
                <button type="button" className={`qspl-fltbtn${fltN ? ' on' : ''}`} title={fltN ? 'Bộ lọc (' + fltN + ' đang bật)' : 'Bộ lọc'} aria-label="Bộ lọc"
                  onClick={e => { const a = e.currentTarget; setPop(p => (p && p.kind === 'flt' ? null : { kind: 'flt', anchor: a })) }}>
                  {FILTER_IC}{fltN > 0 && <span className="qspl-fbadge">{fltN}</span>}
                </button>
                <div className="qspl-search">{SEARCH_IC}
                  <input placeholder="Tìm theo tên, mã hoặc thương hiệu…" value={U.q} onChange={e => setU({ q: e.target.value, page: 1 })} />
                </div>
                <div className="qspl-vtabs qspl-mod">
                  {viewTabs.map(t => (
                    <button type="button" key={t[0]} className={`qspl-vt${U.view === t[0] ? ' on' : ''}${t[0] === 'chua' ? ' warn' : (t[0] === 'fav' ? ' fav' : '')}`}
                      onClick={() => setU({ view: t[0], page: 1 })}>
                      {t[1]}{t[2] && <span className="n">{t[2]}</span>}
                    </button>
                  ))}
                </div>
                <div className="qspl-favmod qspl-mod">
                  <button type="button" className={`qspl-vt fav${U.view === 'fav' ? ' on' : ''}`} title="Sản phẩm yêu thích" aria-label="Sản phẩm yêu thích"
                    onClick={() => setU({ view: 'fav', page: 1 })}>
                    <QsIcon name="star" size={15} />{favN > 0 && <span className="n">{favN}</span>}
                  </button>
                </div>
                <div className="qspl-lay qspl-mod" role="group" aria-label="Chế độ xem">
                  {LAYOUTS.map(l => (
                    <button type="button" key={l[0]} className={showLayout === l[0] ? 'on' : ''} disabled={U.edit && l[0] !== 'table'}
                      title={U.edit && l[0] !== 'table' ? 'Đang sửa nhanh — chỉ xem được dạng Bảng' : 'Xem dạng ' + l[1]} onClick={() => setLayout(l[0])}>
                      {l[2]}<span>{l[1]}</span>
                    </button>
                  ))}
                </div>
                <div className="qspl-lay qspl-colmod qspl-mod" role="group" aria-label="Cột hiển thị">
                  <button type="button" className={`qspl-colbtn${folded ? '' : ' on'}`} title="Ẩn / hiện các chip cột" onClick={() => (folded ? setFolded(foldColsToggle_()) : closeStrip())}>
                    <span>Cột hiển thị</span><b>{visCols.length}/{colList.length}</b><i className="fold-ic" />
                  </button>
                  <button type="button" className={`qspl-presetbtn${pop && pop.kind === 'preset' ? ' on' : ''}`} aria-label="Chọn nhanh bộ cột"
                    title={'Chọn nhanh bộ cột — đang dùng: ' + quick.nhan + ' ' + quick.on + '/' + quick.total}
                    onClick={e => { if (pop && pop.kind === 'preset') closeColTools(); else openColTools(e.currentTarget) }}>
                    <QsIcon name="sliders" size={15} />
                  </button>
                {/* nút nhanh (1)(2) chung khung với Cột hiển thị + bộ cột */}
                {(quickSlots || []).some(id => quickPreset(id)) && (
                  <span className="qspl-qbtns" role="group" aria-label="Nút nhanh bộ cột">
                    {(quickSlots || []).map((id, i) => {
                      const q = quickPreset(id)
                      if (!q) return null
                      const on = quickOn(q.map)
                      return (
                        <button type="button" key={i} className={`qspl-qbtn${on ? ' on' : ''}`} title={'Nút nhanh ' + (i + 1) + ': ' + q.name + (on ? ' (đang dùng)' : '')}
                          onClick={() => { setPresetCur(id); colSet(q.map); toast('Đã bật bộ cột: ' + q.name) }}>{i + 1}</button>
                      )
                    })}
                  </span>
                )}
                </div>
                <span className="qspl-flex" />
                {(tags.length > 0 || spAnyFilter_(f)) && (
                <div className="qspl-bar qspl-mod">
                  <div className="qspl-filtrow">
                    {tags.length > 0 && (
                      <div className="qspl-fltags">
                        {tags.map(t => (
                          <span key={t[0]} className="qspl-fltag" title={t[1]}><i>{t[1]}</i>{f[t[0]]}<b title="Bỏ lọc này" onClick={() => selFilter(t[0], '')}>✕</b></span>
                        ))}
                      </div>
                    )}
                    {spAnyFilter_(f) && <button type="button" className="qsc-btn qspl-xs" onClick={() => setU({ f: SP_FLT_EMPTY(), page: 1 })}>Xoá lọc</button>}
                  </div>
                </div>
                )}
                <div className="qspl-acts qspl-mod">
                <button type="button" className="qsc-btn qspl-sm" disabled={!undoSt.length} onClick={() => spUndo_()}
                  title={undoSt.length ? ('Hoàn tác: ' + undoSt[undoSt.length - 1].label + ' (Ctrl+Z) — còn ' + undoSt.length + ' bước') : 'Chưa có thao tác nào để hoàn tác'}>
                  {UNDO_IC}<span className="t">Hoàn tác</span>
                </button>
                {canEdit && (
                  <button type="button" className={`qsc-btn qspl-sm${U.edit ? ' on' : ''}`} onClick={editToggle}
                    title={U.edit ? 'Tắt chế độ sửa nhanh' : 'Sửa nhanh ngay trên bảng — hiện tất cả cột nhập liệu'}>
                    {U.edit ? DONE_IC : EDIT_IC}<span className="t">{U.edit ? 'Xong' : 'Edit'}</span>
                  </button>
                )}
                <button type="button" className="qsc-btn qspl-sm" disabled={xlsBusy} onClick={() => exportXlsx()}
                  title={nSel ? ('Tải ' + nSel + ' sản phẩm đã chọn ra Excel') : 'Tải toàn bộ danh sách đang lọc ra Excel'}>
                  {XLS_IC}<span className="t">{xlsLbl}</span>
                </button>
                </div>
                <button type="button" className="qspl-addbtn" title="Thêm sản phẩm" aria-label="Thêm sản phẩm" onClick={() => navigate('import')}><QsIcon name="plus" size={20} stroke={2.6} /></button>
              </div>
        </div>
      )}
      <button type="button" className="qspl-pp-show" title="Hiện panel Sản phẩm trong dự án" onClick={panelToggle}>
        <QsIcon name="layers" size={15} /><span className="n">{(cur ? lines : []).length}</span>
      </button>
      {!panelHidden && <ProjPanel qs={qs} node={node} dragOn={dragOn} onDrop={panelDrop} onHide={panelToggle} />}
      {/* Bộ lọc / Chọn nhanh cột đang mở: bảng thu hẹp sang phải nhường chỗ (has-dock), không bị che */}
      <div className={`qspl-main${pop && (pop.kind === 'flt' || pop.kind === 'preset') ? ' has-dock' : ''}`}>
        {/* Chọn nhanh cột: bảng neo như Bộ lọc; chọn bộ thì giữ bảng mở để thấy dấu chọn (như Bóc tách) */}
        {pop && pop.kind === 'preset' && (
          <PresetPop anchor={pop.anchor} top={0} tab={tab} on={onMap} mine={mine} mineOn={mineOn} username={username} cur={presetCur}
            onPreset={ps => { setPresetCur(ps[0]); colSet(csPresetCols_(tab, ps[0]) || csWant_(tab, [])); toast('Đã bật bộ cột: ' + ps[1]) }}
            onMine={() => { if (!mine) return; setPresetCur('mine'); colSet(csMyApply_(tab, mine)); toast('Đã bật bộ cột của tôi') }}
            customs={customs} onCustom={c => { setPresetCur('u:' + c.name); colSet(csWant_(tab, c.keys)) }} onNewCustom={customNew} onDelCustom={customDel}
            onSetDefault={keys => mineSave(keys, true)}
            onEditCols={startStripEdit} quick={quickSlots} onQuick={setQuickSlot}
            onSaveMine={() => mineSave(null, true)} onClearMine={mineClear} onClose={closeColTools} />
        )}
        {pop && pop.kind === 'flt' && (
          <FilterPop anchor={pop.anchor} top={0} scope={scope} f={f} fltQ={U.fltQ}
            onSel={selFilter} onSpec={fltSpec} onNhieuXoa={k => setF({ [k]: {} })}
            onTim={(k, v) => setU(s => ({ fltQ: { ...s.fltQ, [k]: v } }))}
            onPrice={(k, v) => setF({ [k]: Number(v) || 0 })}
            onReset={() => setU({ node: '', f: SP_FLT_EMPTY(), fltQ: {}, page: 1 })}
            onClose={() => setPop(null)} />
        )}
        <div className={`qspl-card${PT ? ' ptmode' : ''}`}>
          {PT ? (
            <ProductsPtMode catBtn={catBtn} />
          ) : (
            <>
              {!canDuyet && <div className="qspl-vt-note">Bạn chỉ được sửa — sản phẩm sửa xong sẽ chờ người có quyền duyệt</div>}
              {/* dải chip cột (mở / đóng bằng nút Cột hiển thị trên thanh công cụ), cuối dải: Hiện tất cả · Cột cơ bản; nút đóng góc phải */}
              {!folded && (
                <div className="qs-bd-strip qs-bd-colmod qspl-colbox">
                  {colList.filter(c => c.k !== 'stt' && c.k !== 'ten').map(c => {
                    const on = !!spColOn_(colOn, c.k)
                    return <button type="button" key={c.k} className={`qs-bd-strip-chip qs-colchip${on ? ' on' : ''}`} title={on ? 'Đang hiện — bấm để ẩn' : 'Đang ẩn — bấm để hiện'} onClick={() => colToggle(c.k)}>{c.label}</button>
                  })}
                  <span className="qs-colchip-sep" />
                  {(() => {
                    const allOn = tab.keys().every(k => onMap[k])
                    return <button type="button" className={`qs-bd-strip-btn qs-colchip-act${allOn ? ' on' : ''}`} aria-pressed={allOn}
                      title={allOn ? 'Đang hiện tất cả cột — bấm để về bộ mặc định' : 'Hiện tất cả cột'}
                      onClick={() => (allOn ? colSet(csMyApply_(tab, mine)) : colAll(1))}>Hiện tất cả</button>
                  })()}
                  <button type="button" className="qs-bd-strip-btn qs-colchip-act" onClick={colCoBan}>Cột cơ bản</button>
                  {stripEdit ? (
                    <>
                      <button type="button" className="qs-bd-strip-btn qs-colchip-save" title="Lưu các cột đang bật thành bộ mới (đặt tên)" onClick={stripSaveNew}><QsIcon name="plus" size={13} /> Tạo mới</button>
                      {stripEdit.from
                        ? <button type="button" className="qs-bd-strip-btn qs-colchip-save alt" title={'Ghi đè bộ "' + stripEdit.from + '" bằng các cột đang bật'} onClick={() => stripSaveOver(stripEdit.from)}><QsIcon name="check" size={13} /> Lưu đè "{stripEdit.from}"</button>
                        : <button type="button" className="qs-bd-strip-btn qs-colchip-save alt" title="Ghi đè 1 bộ có sẵn bằng các cột đang bật" onClick={e => { const a = e.currentTarget; setOverAt(o => (o ? null : a)) }}><QsIcon name="check" size={13} /> Lưu đè… <i className="qspl-caret">▾</i></button>}
                      <button type="button" className="qs-bd-strip-btn qs-colchip-act" onClick={cancelStripEdit}>Huỷ</button>
                    </>
                  ) : (
                    <button type="button" className="qs-bd-strip-btn qs-colchip-act qs-colchip-edit" title="Sửa bộ cột: bật / tắt chip rồi lưu thành bộ chọn nhanh mới" onClick={() => startStripEdit(null)}><QsIcon name="edit" size={14} /></button>
                  )}
                  <span style={{ flex: 1 }} />
                  <button type="button" className="qs-bd-strip-close" title="Đóng" onClick={closeStrip}><QsIcon name="close" size={15} /></button>
                </div>
              )}
              {/* khối bảng (hoặc thẻ) + phân trang: module riêng, tách khỏi thanh công cụ / hàng chọn cột */}
              <div className="qspl-tblcard">
              {specErr && <div className="qspl-note err">{specErr}: cột thông số của Thiết bị vệ sinh, Sơn nước, Công tắc - ổ cắm không hiện được.</div>}
              {showLayout === 'table' ? (
                <SpTable cols={visCols} rows={pr.rows} w={w} sel={U.sel} edit={U.edit} sort={U.sort} wrapW={wrapW}
                  skuCount={p => spSkuCount_(skuMap, p)} canEdit={canEdit} canDuyet={canDuyet} isAdmin={isAdmin} on={tableOn} />
              ) : (
                <SpCards layout={showLayout} cols={visCols} rows={pr.rows} sel={U.sel}
                  skuCount={p => spSkuCount_(skuMap, p)} canDuyet={canDuyet} on={tableOn} />
              )}

              <div className="qspl-pgbar">
                <span className="info">{groups.length ? <>Hiện <b>{from}–{to}</b> / {info}</> : 'Không có sản phẩm'}</span>
                <span className="nav">
                  {pr.pages > 1 && (
                    <>
                      <button type="button" className="qspl-pgb" disabled={pr.cur <= 1} onClick={() => goPage(pr.cur - 1)} title="Trang trước"><QsIcon name="left" size={14} /></button>
                      {spPageNums_(pr.cur, pr.pages).map((n, i) => (n === '…'
                        ? <span key={'d' + i} className="dots">…</span>
                        : <button type="button" key={n} className={`qspl-pgn${n === pr.cur ? ' on' : ''}`} onClick={() => goPage(n)}>{n}</button>))}
                      <button type="button" className="qspl-pgb" disabled={pr.cur >= pr.pages} onClick={() => goPage(pr.cur + 1)} title="Trang sau">{NEXT_IC}</button>
                    </>
                  )}
                </span>
                <select className="qspl-per" value={per} onChange={e => setPer(e.target.value)}>
                  {SP_PER.map(v => <option key={v} value={v}>{v ? v + ' SP/trang' : 'Tất cả'}</option>)}
                </select>
              </div>
              </div>
            </>
          )}
        </div>
      </div>

      {!PT && nSel > 0 && (
        <MrootPortal>
          <div className="qspl-bbar">
            <div className="qspl-bb-count"><b>{nSel}</b><span>sản phẩm đã chọn</span><button type="button" className="qspl-bb-x" title="Bỏ chọn (Esc)" onClick={clearSel}>✕</button></div>
            <div className="qspl-bb-sep" />
            <button type="button" className="qspl-bb-b primary" onClick={bulkToProject}><QsIcon name="plus" size={15} /> Thêm vào dự án</button>
            <button type="button" className="qspl-bb-b" onClick={() => spFavBulk(selProds(), 1)} title="Lưu vào danh sách yêu thích"><QsIcon name="star" size={15} /> Yêu thích</button>
            {canDuyet && <button type="button" className="qspl-bb-b" onClick={() => spDuyetBulk(selNhom(), 1)} title="Đánh dấu Đã duyệt"><QsIcon name="check" size={15} /> Duyệt</button>}
            <button type="button" className="qspl-bb-b" onClick={e => { const a = e.currentTarget; setPop(p => (p && p.kind === 'bbedit' ? null : { kind: 'bbedit', anchor: a })) }} title="Đổi một trường cho tất cả dòng đã chọn">
              <QsIcon name="edit" size={15} /> Sửa hàng loạt <i className="car">▾</i>
            </button>
            <div className="qspl-bb-sep" />
            <button type="button" className="qspl-bb-ic" onClick={e => { const a = e.currentTarget; setPop(p => (p && p.kind === 'bbmore' ? null : { kind: 'bbmore', anchor: a })) }} title="Thao tác khác">⋯</button>
          </div>
        </MrootPortal>
      )}

      {overAt && <OverPop anchor={overAt} customs={customs} onPick={stripSaveOver} onClose={() => setOverAt(null)} />}
      {pop && pop.kind === 'colmenu' && (
        <ColMenu anchor={pop.anchor} col={pop.col} sort={U.sort} canHide={pop.col.k !== 'ten' && pop.col.k !== 'stt'}
          onSort={so => setU({ sort: so, page: 1 })} onHide={() => colToggle(pop.col.k)} onClose={() => setPop(null)} />
      )}
      {pop && pop.kind === 'cat' && (
        <CatPop anchor={pop.anchor} node={node} total={(products || []).length} count={nodeCount} onPick={catPick} onClose={() => setPop(null)}
          dock={!PT} top={!PT && tbRef.current && tbRef.current.parentElement ? tbRef.current.parentElement.offsetHeight + 12 : 0} />
      )}
      {pop && pop.kind === 'bbedit' && nSel > 0 && (
        <BulkEditPop anchor={pop.anchor} fields={spBulkFields_(ng, specs)} n={nSel} toast={toast} onClose={() => setPop(null)}
          onApply={(fld, val, label) => spBulkApply(selNhom(), fld, val, label, spLabel2Col_(specs, fld))} />
      )}
      {pop && pop.kind === 'bbmore' && nSel > 0 && (
        <MorePop anchor={pop.anchor} n={nSel} canDuyet={canDuyet} isAdmin={isAdmin} onClose={() => setPop(null)}
          onXlsx={() => exportXlsx(selKeys)} onUnduyet={() => spDuyetBulk(selNhom(), 0)} onUnfav={() => spFavBulk(selProds(), 0)} onDelete={bulkDelete} />
      )}
      {pop && pop.kind === 'copy' && (
        <CopyMenu anchor={pop.anchor} p={pop.p} onClose={() => setPop(null)}
          onCopy={() => editP(pop.p, 'copy')} onVariant={() => editP(pop.p, 'variant')} onQuick={() => editP(pop.p, 'nbt')} />
      )}

      {dlg && dlg.kind === 'detail' && (
        <SpModal product={live} specs={specs} specErr={specErr} canEdit={canEdit} onClose={() => setDlg(null)} onEdit={p => editP(p)} />
      )}
      {dlg && dlg.kind === 'edit' && (
        <ProductEditModal productKey={(dlg.p.recordId != null && dlg.p.recordId !== '') ? String(dlg.p.recordId) : dlg.p.ma} mode={dlg.mode}
          product={live} canDuyet={canDuyet} onClose={() => setDlg(null)} onSaved={() => setDlg(null)} />
      )}
    </div>
  )
}
