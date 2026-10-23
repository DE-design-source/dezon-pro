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
import { csMyCols_, csMyOn_, csMyApply_, csMyKey_, csQuickLabel_, csPresetCols_, csWant_ } from '../../../lib/columns.js'
import { ctSyncTemplate_, ptTemplateNew_ } from '../../../lib/phantho.js'
import { useSpecs } from '../../breakdown/catalog/useSpecs'
import { useComboCache, loadCombo } from '../../breakdown/catalog/comboCache'
import ProjPanel from './ProjPanel'
import SpTable from './SpTable'
import SpModal from './SpModal'
import { CatPop, FilterPop, PresetPop, BulkEditPop, MorePop, CopyMenu } from './SpPops'
import { useSpUi, getU, setU, setPer, clearSel } from './spStore'
import {
  lsJson, lsSet, spKey_, spPanelHidden_, foldCols_, foldColsToggle_, spNganhCur_, spPTMode_, spAllCols_, spSkuMap_, spSkuCount_,
  spColsNg_, spColsLoad_, spCfgLoad_, spCfgSave_, spOrder_, spColOn_, spColList_, spVisCols_, SP_COL_CB, spColset_, spMoveCol_,
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
const UNDO_IC = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-4" /></svg>
const NEXT_IC = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
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
  const cols = useMemo(() => spAllCols_(ng, specs), [ng, specs])
  const colOn = (U.colNg === ngCols && U.colOn) ? U.colOn : spColsLoad_(ngCols)
  const savedOrder = U.order != null ? U.order : spCfgLoad_().order
  const w = U.w != null ? U.w : spCfgLoad_().w
  const order = useMemo(() => spOrder_(savedOrder, cols), [savedOrder, cols])
  const colList = useMemo(() => spColList_(cols, order), [cols, order])
  const visCols = useMemo(() => spVisCols_(cols, order, colOn), [cols, order, colOn])
  const tab = useMemo(() => spColset_(colList, ngCols), [colList, ngCols])

  /* đổi ngành của bộ cột (spColsSync_): nạp bộ cột đã lưu của ngành đó; đang Edit thì vẫn bật hết cột nhập được */
  useEffect(() => {
    const u = getU()
    if (u.colNg === ngCols && u.colOn) return
    let on = spColsLoad_(ngCols), bak = null
    if (u.edit) { bak = on; on = { ...on, thumb: 1 }; cols.forEach(c => { if (c.e) on[c.k] = 1 }) }
    setU({ colNg: ngCols, colOn: on, colBak: bak, order: null, w: null })
  }, [ngCols, cols])

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
    setU(getU().colNg === 'den' ? { colUser: username, colNg: 'den', colOn: on, colBak: null } : { colUser: username })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, specs, specErr])

  function saveCols(patch) {
    const u = getU()
    const next = {
      colOn: patch.colOn || colOn, order: patch.order || order, w: patch.w || w,
    }
    setU({ colNg: ngCols, ...patch })
    // đang Edit (bật hết cột) -> lưu bộ cột thật của người dùng
    spCfgSave_(next.order, next.w, ngCols, (u.edit && u.colBak) || next.colOn)
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
  async function mineSave() {
    const keys = tab.keys().filter(k => onMap[k])
    lsSet(csMyKey_('sp', username), JSON.stringify(keys))
    setPop(null)
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
      setU({ edit: true, colBak: { ...colOn }, colOn: n, colNg: ngCols })
    } else setU({ edit: false, colOn: U.colBak || colOn, colBak: null, colNg: ngCols })
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
  }

  /* ---------- Vẽ ---------- */
  const fltN = spFltCount_(f)
  const chua = scope.filter(p => !p.daDuyet).length
  const viewTabs = [
    ['all', node ? ('Tất cả · ' + (nodeName(node) || node)) : 'Tất cả', scope.length ? String(scope.length) : ''],
    ['chua', 'Chưa duyệt', chua ? String(chua) : ''],
    ['da', 'Đã duyệt', (scope.length - chua) ? String(scope.length - chua) : ''],
    ['fav', '★ Yêu thích', (() => { const n = scope.filter(p => p.yeuThich).length; return n ? String(n) : '' })()],
  ]
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
  const live = dlg ? ((products || []).filter(x => spKey_(x) === spKey_(dlg.p))[0] || dlg.p) : null

  return (
    <div className={`qspl-ws${panelHidden ? ' panel-hidden' : ''}`} ref={wsRef}>
      <button type="button" className="qspl-pp-show" title="Hiện panel Sản phẩm trong dự án" onClick={panelToggle}>
        <QsIcon name="layers" size={15} /><span className="n">{(cur ? lines : []).length}</span>
      </button>
      {!panelHidden && <ProjPanel qs={qs} dragOn={dragOn} onDrop={panelDrop} onHide={panelToggle} />}
      <div className="qspl-main">
        <div className={`qspl-card${PT ? ' ptmode' : ''}`}>
          {PT ? (
            <ProductsPtMode catBtn={catBtn} />
          ) : (
            <>
              <div className="qspl-toolbar">
                <div className="qspl-search">{SEARCH_IC}
                  <input placeholder="Tìm theo tên, mã hoặc thương hiệu…" value={U.q} onChange={e => setU({ q: e.target.value, page: 1 })} />
                </div>
                <div className="qspl-vtabs">
                  {viewTabs.map(t => (
                    <button type="button" key={t[0]} className={`qspl-vt${U.view === t[0] ? ' on' : ''}${t[0] === 'chua' ? ' warn' : (t[0] === 'fav' ? ' fav' : '')}`}
                      onClick={() => setU({ view: t[0], page: 1 })}>
                      {t[1]}{t[2] && <span className="n">{t[2]}</span>}
                    </button>
                  ))}
                  {!canDuyet && <span className="qspl-vt-note">Bạn chỉ được sửa — sản phẩm sửa xong sẽ chờ người có quyền duyệt</span>}
                </div>
                <span className="qspl-flex" />
                <div className="qspl-bar">
                  <div className="qspl-filtrow">
                    {catBtn}
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
                <button type="button" className="qsc-btn qspl-sm" disabled={!undoSt.length} onClick={() => spUndo_()}
                  title={undoSt.length ? ('Hoàn tác: ' + undoSt[undoSt.length - 1].label + ' (Ctrl+Z) — còn ' + undoSt.length + ' bước') : 'Chưa có thao tác nào để hoàn tác'}>
                  {UNDO_IC} Hoàn tác
                </button>
                {canEdit && (
                  <button type="button" className={`qsc-btn qspl-sm${U.edit ? ' on' : ''}`} onClick={editToggle}
                    title={U.edit ? 'Tắt chế độ sửa nhanh' : 'Sửa nhanh ngay trên bảng — hiện tất cả cột nhập liệu'}>
                    <QsIcon name={U.edit ? 'check' : 'edit'} size={14} /> {U.edit ? 'Xong' : 'Edit'}
                  </button>
                )}
                <button type="button" className={`qsc-btn qspl-sm${fltN ? ' on' : ''}`} onClick={e => { const a = e.currentTarget; setPop(p => (p && p.kind === 'flt' ? null : { kind: 'flt', anchor: a })) }}>
                  <QsIcon name="sliders" size={14} /> Bộ lọc{fltN > 0 && <span className="qspl-fbadge">{fltN}</span>}
                </button>
                <button type="button" className="qsc-btn qspl-sm" disabled={xlsBusy} onClick={() => exportXlsx()}
                  title={nSel ? ('Tải ' + nSel + ' sản phẩm đã chọn ra Excel') : 'Tải toàn bộ danh sách đang lọc ra Excel'}>
                  <QsIcon name="download" size={14} /> <span>{xlsLbl}</span>
                </button>
                <button type="button" className="qsc-btn blue qspl-sm" onClick={() => navigate('import')}><QsIcon name="plus" size={14} /> Thêm sản phẩm</button>
              </div>

              <div className="qspl-colbox">
                <div className="qspl-colhr">
                  <button type="button" className={`qspl-colh${folded ? ' folded' : ''}`} onClick={() => setFolded(foldColsToggle_())} title="Ẩn / hiện các chip cột">
                    Cột hiển thị <b>{visCols.length}/{colList.length}</b><i className="fold-ic" />
                  </button>
                  <button type="button" className="qspl-quick" onClick={e => { const a = e.currentTarget; setPop(p => (p && p.kind === 'preset' ? null : { kind: 'preset', anchor: a })) }}
                    title="Bật cả một bộ cột theo mục đích / bộ cột của tôi">
                    <QsIcon name="sliders" size={13} /><span>{quick.nhan}</span><b>{quick.on}/{quick.total}</b><i>▾</i>
                  </button>
                  <button type="button" className="qspl-pgq" onClick={() => colAll(1)}>Hiện tất cả</button>
                  <button type="button" className="qspl-pgq" onClick={colCoBan}>Cột cơ bản</button>
                </div>
                {!folded && (
                  <div className="qspl-colchips">
                    {colList.filter(c => c.k !== 'stt' && c.k !== 'ten').map(c => (
                      <span key={c.k} className={`qspl-chip${spColOn_(colOn, c.k) ? ' on' : ''}`} onClick={() => colToggle(c.k)}>{c.label}</span>
                    ))}
                  </div>
                )}
              </div>

              {specErr && <div className="qspl-note err">{specErr}: cột thông số của Thiết bị vệ sinh, Sơn nước, Công tắc - ổ cắm không hiện được.</div>}
              <SpTable cols={visCols} rows={pr.rows} w={w} sel={U.sel} edit={U.edit} sort={U.sort} wrapW={wrapW}
                skuCount={p => spSkuCount_(skuMap, p)} canEdit={canEdit} canDuyet={canDuyet} isAdmin={isAdmin} on={tableOn} />

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

      {pop && pop.kind === 'cat' && <CatPop anchor={pop.anchor} node={node} total={(products || []).length} count={nodeCount} onPick={catPick} onClose={() => setPop(null)} />}
      {pop && pop.kind === 'flt' && (
        <FilterPop anchor={pop.anchor} scope={scope} f={f} fltQ={U.fltQ}
          onSel={selFilter} onSpec={fltSpec} onNhieuXoa={k => setF({ [k]: {} })}
          onTim={(k, v) => setU(s => ({ fltQ: { ...s.fltQ, [k]: v } }))}
          onPrice={(k, v) => setF({ [k]: Number(v) || 0 })}
          onReset={() => setU({ node: '', f: SP_FLT_EMPTY(), fltQ: {}, page: 1 })}
          onClose={() => setPop(null)} />
      )}
      {pop && pop.kind === 'preset' && (
        <PresetPop anchor={pop.anchor} tab={tab} on={onMap} mine={mine} mineOn={mineOn} username={username}
          onPreset={ps => { setPop(null); colSet(csPresetCols_(tab, ps[0]) || csWant_(tab, [])); toast('Đã bật bộ cột: ' + ps[1]) }}
          onMine={() => { setPop(null); if (!mine) return; colSet(csMyApply_(tab, mine)); toast('Đã bật bộ cột của tôi') }}
          onSaveMine={mineSave} onClearMine={mineClear} onClose={() => setPop(null)} />
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
