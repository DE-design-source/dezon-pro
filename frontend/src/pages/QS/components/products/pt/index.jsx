import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import QsIcon from '../../common/QsIcon'
import { MrootPortal } from '../../common/ModalHost'
import CtEditModal from '../../phantho/CtEditModal'
import { useQs } from '../../../state/QsData'
import { useQsStore, isAdminRole_, setState as setStore, getState } from '../../../state/store'
import { useCongTac } from '../../../state/useCongTac'
import * as api from '../../../api/qsApi'
import { money } from '../../../lib/format.js'
import { csMyCols_, csMyOn_, csMyApply_, csMyKey_, csQuickLabel_, csPresetCols_, csWant_ } from '../../../lib/columns.js'
import { useSpUi, setU, clearSel } from '../list/spStore'
import { lsJson, lsSet, lsGet, foldCols_, foldColsToggle_, spMoveCol_, SP_PER, spPageNums_ } from '../list/spModel'
import { setPer } from '../list/spStore'
import { PresetPop, BulkEditPop } from '../list/SpPops'
import { ptTpl_, ptVals_, ptLoaiNgan_, CT_BULK_F, ptOvrAll_ } from './ptCore'
import {
  PT_COLS, ptColOn_, ptColList_, ptVisCols_, ptColset_, ptCfgSave_, spPTAll_, spPTList_, ptSelKey_, ptTabs_, ptFltCount_, PT_FLT_KEYS,
} from './ptModel'
import { usePt, setP, getP, ptCfg_ } from './ptStore'
import {
  ctFav_, ctFavBulk_, ctDuyet_, ctDelete_, ctDuyetBulk_, ctBulkEditRun_, ctDeleteBulk_, ptOvrSave, ptResetOvr_, ptAddOne_, ptBulkAdd_, ptExportXlsx,
} from './ptActions'
import { PtFilterPop, PtMorePop } from './PtPops'
import PtTable from './PtTable'
import PtDetailModal from './PtDetailModal'
import './pt.css'

/* Danh sách sản phẩm · Phần thô (đề mục 3.1) - port PUB/sanpham.js:1140-1471 và các nhánh spPTMode_ của bảng dùng chung
   (spFilter / spViewTabs_ / renderSpChips_ / spColChips_ / spBulkBar_ / spPager_ / spEditToggle). Bảng liệt kê THƯ VIỆN CÔNG TÁC
   (khái toán chi tiết · sơ bộ · dự toán) thay cho sản phẩm, cùng khung bảng / ô tìm / phân trang / thanh chọn nhiều của tab.
   Thêm công tác vào bảng khái toán của dự án đang mở (projData.phanTho), duyệt / yêu thích / xoá / sửa qua useCongTac,
   sửa công tác bằng phantho/CtEditModal, tải Excel qua /export/cong-tac.
   Props (chỉ thêm, tuỳ chọn): catBtn - nút chọn hạng mục của ProductList; có thì vẽ trong hàng lọc như bản gốc (#spBar). */
const SEARCH_IC = <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
const NEXT_IC = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>

export default function ProductsPtMode({ catBtn } = {}) {
  const qs = useQs()
  const { cur, projData, toast, confirm } = qs
  const visible = qs.panelVisible('sanpham')
  const me = useQsStore(s => s.me)
  const { congTac, status: ctStatus, error: ctError, ctReload } = useCongTac()
  const U = useSpUi()
  const P = usePt()
  const cfg = P.cfg || ptCfg_()
  const [pop, setPop] = useState(null)       // {kind, anchor}
  const [dlg, setDlg] = useState(null)       // {kind: 'detail', r} | {kind: 'ct', id}
  const [folded, setFolded] = useState(foldCols_)
  const [xlsBusy, setXlsBusy] = useState(false)
  const rootRef = useRef(null)

  const isAdmin = isAdminRole_(me)
  const canDuyet = U.perm ? !!U.perm.duyet : true
  const maDA = cur ? cur.maDA : ''
  const f = U.f || {}

  /* ---------- Dữ liệu ---------- */
  const tpl = useMemo(() => ptTpl_(maDA, congTac), [maDA, congTac])
  const ovrStr = lsGet('qs_ptovr') || ''     // Bóc tách 3.1 cũng sửa giá này -> đọc lại mỗi lần vẽ
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ovr = useMemo(() => ptOvrAll_(), [ovrStr, P.ovrVer])
  const all = useMemo(() => spPTAll_(tpl, ovr), [tpl, ovr])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const phanTho = useMemo(() => ptVals_().phanTho, [projData, maDA])
  const list = useMemo(() => spPTList_(all, U.q, f, P.view, phanTho), [all, U.q, f, P.view, phanTho])
  const listKeys = useMemo(() => { const m = {}; list.forEach(r => { m[ptSelKey_(r)] = 1 }); return m }, [list])
  /* dòng đã tick mà lọc / tìm làm khuất thì bỏ chọn (spFilter) */
  useEffect(() => {
    const bo = Object.keys(U.sel).filter(k => !listKeys[k])
    if (bo.length) setU(s => { const sel = { ...s.sel }; bo.forEach(k => { delete sel[k] }); return { sel } })
  }, [listKeys, U.sel])
  const per = U.per
  const pages = per ? Math.max(1, Math.ceil(list.length / per)) : 1
  const page = Math.min(Math.max(1, U.page || 1), pages)
  useEffect(() => { if (page !== U.page) setU({ page }) }, [page, U.page])
  const no0 = per ? (page - 1) * per : 0
  const pageRows = per ? list.slice(no0, page * per) : list
  const nSel = Object.keys(U.sel).length
  const selRows = () => all.filter(r => U.sel[ptSelKey_(r)])

  /* ---------- Cột ---------- */
  const colList = useMemo(() => ptColList_(cfg.order), [cfg.order])
  const visCols = useMemo(() => ptVisCols_(cfg.order, cfg.on), [cfg.order, cfg.on])
  const tab = useMemo(() => ptColset_(colList), [colList])
  const onMap = useMemo(() => { const m = {}; tab.keys().forEach(k => { m[k] = ptColOn_(cfg.on, k) }); return m }, [tab, cfg.on])
  const username = (me && me.username) || ''
  const mine = csMyCols_(tab, me && me.uiPrefs, lsJson(csMyKey_('sp', username), null))
  const mineOn = csMyOn_(tab, mine, onMap)
  const quick = csQuickLabel_(tab, onMap, mine)
  function saveCfg(patch) {
    const p0 = getP(), next = { ...(p0.cfg || cfg), ...patch }
    setP({ cfg: next })
    ptCfgSave_({ ...next, edit: p0.edit, onBak: p0.onBak })
  }
  function colSet(m) { const on = { ...cfg.on }; tab.keys().forEach(k => { on[k] = !!m[k] }); saveCfg({ on }) }
  function colToggle(k) { if (k === 'ten' || k === 'stt') return; saveCfg({ on: { ...cfg.on, [k]: !cfg.on[k] } }) }
  function colAll(on) { const m = { ...cfg.on }; colList.forEach(c => { if (c.k !== 'ten' && c.k !== 'stt') m[c.k] = !!on }); saveCfg({ on: m }) }
  function colCoBan() { const m = {}; tab.keys().slice(0, 4).forEach(k => { m[k] = 1 }); colSet(m) }
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
  /* Edit: hiện TẤT CẢ cột nhập được; tắt thì trả bộ cột cũ (spEditToggle nhánh Phần thô) */
  function editToggle() {
    const on = !P.edit
    if (on) { const bak = { ...cfg.on }, n = { ...cfg.on }; PT_COLS.forEach(c => { if (c.e) n[c.k] = 1 }); setP({ edit: true, onBak: bak, cfg: { ...cfg, on: n } }) }
    else setP({ edit: false, onBak: null, cfg: { ...cfg, on: P.onBak || cfg.on } })
    toast(on ? 'Sửa nhanh: gõ đơn giá / thông số ngay trên bảng, rời ô là lưu (áp cho cả thư viện)' : 'Đã tắt chế độ sửa nhanh')
  }

  /* ---------- Lọc ---------- */
  function selFilter(key, val) { setU(s => { const n = { ...s.f }; if (!val) delete n[key]; else n[key] = val; return { f: n, page: 1 } }) }
  function fltReset() { setU(s => { const n = { ...s.f }; PT_FLT_KEYS.forEach(k => { delete n[k] }); return { f: n, page: 1 } }) }
  const fltN = ptFltCount_(f)
  // thẻ các bộ lọc đang bật (spPTChips_): [khoá, nhãn, giá trị, bỏ lọc]
  const tags = []
  const tag = (k, lb, v) => tags.push([k, lb, v, () => selFilter(k, '')])
  if (f.ptLoai) tag('ptLoai', 'Loại báo giá', ptLoaiNgan_(f.ptLoai))
  if (f.ptNhom) tag('ptNhom', 'Hạng mục', f.ptNhom)
  if (f.ptDvt) tag('ptDvt', 'ĐVT', f.ptDvt)
  if (f.ptDa === '1') tag('ptDa', 'Trạng thái', 'Đã có trong bảng')
  if (f.ptDa === '0') tag('ptDa', 'Trạng thái', 'Chưa thêm')
  if (f.ptSua === '1') tag('ptSua', 'Lọc', 'Đã sửa giá')
  if (f.min || f.max) tags.push(['minmax', 'Khoảng giá', (f.min ? money(f.min) : '0') + ' – ' + (f.max ? money(f.max) : '∞'),
    () => setU(s => { const n = { ...s.f }; delete n.min; delete n.max; return { f: n, page: 1 } })])
  const nS = Object.keys(ovr).length

  /* ---------- Bảng vừa khít màn hình (spCaoFit_), như ProductList ---------- */
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || !visible) return
    const wrap = root.querySelector('[data-sp-wrap]')
    if (!wrap) return
    const scr = root.closest('.qs-scroll')
    const padB = scr ? (parseFloat(getComputedStyle(scr).paddingBottom) || 0) : 0
    const zf = (root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth : 1) || 1
    if (window.innerWidth <= 900) { wrap.style.height = ''; return }
    let duoi = 0
    for (let e = wrap.nextElementSibling; e; e = e.nextElementSibling) {
      const cs = getComputedStyle(e)
      duoi += e.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0)
    }
    for (let e = root.nextElementSibling; e; e = e.nextElementSibling) duoi += e.offsetHeight
    const card = wrap.closest('.qspl-card')
    const cardB = card ? (parseFloat(getComputedStyle(card).borderBottomWidth) || 0) : 0
    const h = Math.max(220, Math.floor((window.innerHeight - wrap.getBoundingClientRect().top) / zf - duoi - cardB - padB - 10))
    wrap.style.height = h + 'px'
  })

  /* ---------- Thao tác ---------- */
  const ctOfRow = r => (r.a && r.a.ct) || null
  const tableOn = {
    move: (from, to, before) => saveCfg({ order: spMoveCol_(cfg.order, from, to, before) }),
    resize: (k, px, done) => { const nw = { ...cfg.w, [k]: px }; if (done) saveCfg({ w: nw }); else setP({ cfg: { ...cfg, w: nw } }) },
    selAll: on => { const sel = {}; if (on) pageRows.forEach(r => { sel[ptSelKey_(r)] = 1 }); setU({ sel }) },
    selToggle: (k, on) => setU(s => { const sel = { ...s.sel }; if (on) sel[k] = 1; else delete sel[k]; return { sel } }),
    open: r => setDlg({ kind: 'detail', r }),
    fav: r => { const c = ctOfRow(r); if (c) ctFav_(c.id, !c.yeuThich) },
    add: r => ptAddOne_(tpl, r),
    duyet: r => { const c = ctOfRow(r); if (c) ctDuyet_(c.id, !c.daDuyet) },
    editCt: r => { const c = ctOfRow(r); if (c) setDlg({ kind: 'ct', id: c.id }) },
    del: r => { const c = ctOfRow(r); if (c) ctDelete_(c.id, r.ten) },
    nhom: name => selFilter('ptNhom', name),
    save: (r, e, raw) => ptOvrSave(r, e, raw),
  }
  /* dòng đang mở ở popup: lấy bản mới nhất sau khi duyệt / yêu thích / sửa (theo id công tác, bản dựng sẵn theo vị trí + tên) */
  const liveRow = r0 => {
    const c0 = ctOfRow(r0)
    const x = c0 ? all.filter(r => { const c = ctOfRow(r); return c && c.id === c0.id })[0]
      : all.filter(r => r.si === r0.si && r.ii === r0.ii && r.ten === r0.ten)[0]
    return x || r0
  }
  async function exportXlsx(rows) {
    setXlsBusy(true)
    try { await ptExportXlsx(rows) } finally { setXlsBusy(false) }
  }
  const goPage = n => {
    setU({ page: n })
    const wrap = rootRef.current && rootRef.current.querySelector('[data-sp-wrap]')
    if (wrap) wrap.scrollTop = 0
  }

  /* ---------- Vẽ ---------- */
  const tabs = ptTabs_(all)
  const view = P.view || 'all'
  const from = list.length ? (no0 + 1) : 0
  const to = per ? Math.min(list.length, page * per) : list.length
  const ctNote = ctStatus === 'error'
    ? <div className="qspl-note err qsppt-ctnote">Không tải được công tác: {ctError} <button type="button" className="qsc-btn qspl-xs" onClick={() => ctReload()}>Thử lại</button></div>
    : ((ctStatus === 'loading' && !(congTac || []).length) ? <div className="qspl-note qsppt-ctnote">Đang tải…</div> : null)

  return (
    <div className="qsppt-root" ref={rootRef}>
      <div className="qspl-toolbar">
        <div className="qspl-search">{SEARCH_IC}
          <input placeholder="Tìm công tác, hạng mục hoặc ghi chú…" value={U.q} onChange={e => setU({ q: e.target.value, page: 1 })} />
        </div>
        <div className="qspl-vtabs">
          {tabs.map(t => (
            <button type="button" key={t[0]} className={`qspl-vt${view === t[0] ? ' on' : ''}${t[0] === '__chua' ? ' warn' : (t[0] === '__fav' ? ' fav' : '')}`}
              onClick={() => { setP({ view: t[0] }); setU({ page: 1 }) }}>
              {t[1]}{t[2] ? <span className="n">{t[2]}</span> : null}
            </button>
          ))}
        </div>
        <span className="qspl-flex" />
        <div className="qspl-bar">
          <div className="qspl-filtrow">
            {catBtn || null}
            {tags.length > 0 && (
              <div className="qspl-fltags">
                {tags.map(t => <span key={t[0]} className="qspl-fltag" title={t[1]}><i>{t[1]}</i>{t[2]}<b title="Bỏ lọc này" onClick={t[3]}>✕</b></span>)}
              </div>
            )}
            {nS > 0 && <button type="button" className="qsc-btn qspl-xs qsppt-sua" title="Trả các công tác đã sửa về đúng bảng giá gốc" onClick={ptResetOvr_}>{nS} công tác đã sửa giá ✕</button>}
            {fltN > 0 && <button type="button" className="qsc-btn qspl-xs" onClick={fltReset}>Xoá lọc</button>}
          </div>
        </div>
        <button type="button" className={`qsc-btn qspl-sm${P.edit ? ' on' : ''}`} onClick={editToggle}
          title={P.edit ? 'Tắt chế độ sửa nhanh' : 'Sửa nhanh ngay trên bảng — hiện tất cả cột nhập liệu'}>
          <QsIcon name={P.edit ? 'check' : 'edit'} size={14} /> {P.edit ? 'Xong' : 'Edit'}
        </button>
        <button type="button" className={`qsc-btn qspl-sm${fltN ? ' on' : ''}`} onClick={e => { const a = e.currentTarget; setPop(p => (p && p.kind === 'flt' ? null : { kind: 'flt', anchor: a })) }}>
          <QsIcon name="sliders" size={14} /> Bộ lọc{fltN > 0 && <span className="qspl-fbadge">{fltN}</span>}
        </button>
        <button type="button" className="qsc-btn qspl-sm" disabled={xlsBusy} onClick={() => exportXlsx(nSel ? selRows() : list)}
          title={nSel ? ('Tải ' + nSel + ' công tác đã chọn ra Excel') : 'Tải toàn bộ danh sách đang lọc ra Excel'}>
          <QsIcon name="download" size={14} /> <span>{nSel ? ('Tải Excel (' + nSel + ')') : 'Tải Excel'}</span>
        </button>
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
              <span key={c.k} className={`qspl-chip${ptColOn_(cfg.on, c.k) ? ' on' : ''}`} onClick={() => colToggle(c.k)}>{c.label}</span>
            ))}
          </div>
        )}
      </div>

      {ctNote}
      <PtTable cols={visCols} rows={pageRows} no0={no0} w={cfg.w} sel={U.sel} edit={P.edit} ovr={ovr} phanTho={phanTho} projData={projData}
        canDuyet={canDuyet} isAdmin={isAdmin} on={tableOn} />

      <div className="qspl-pgbar">
        <span className="info">{list.length ? <>Hiện <b>{from}–{to}</b> / {list.length} sản phẩm</> : 'Không có sản phẩm'}</span>
        <span className="nav">
          {pages > 1 && (
            <>
              <button type="button" className="qspl-pgb" disabled={page <= 1} onClick={() => goPage(page - 1)} title="Trang trước"><QsIcon name="left" size={14} /></button>
              {spPageNums_(page, pages).map((n, i) => (n === '…'
                ? <span key={'d' + i} className="dots">…</span>
                : <button type="button" key={n} className={`qspl-pgn${n === page ? ' on' : ''}`} onClick={() => goPage(n)}>{n}</button>))}
              <button type="button" className="qspl-pgb" disabled={page >= pages} onClick={() => goPage(page + 1)} title="Trang sau">{NEXT_IC}</button>
            </>
          )}
        </span>
        <select className="qspl-per" value={per} onChange={e => setPer(e.target.value)}>
          {SP_PER.map(v => <option key={v} value={v}>{v ? v + ' SP/trang' : 'Tất cả'}</option>)}
        </select>
      </div>

      {nSel > 0 && visible && (
        <MrootPortal>
          <div className="qspl-bbar">
            <div className="qspl-bb-count"><b>{nSel}</b><span>công tác đã chọn</span><button type="button" className="qspl-bb-x" title="Bỏ chọn (Esc)" onClick={clearSel}>✕</button></div>
            <div className="qspl-bb-sep" />
            <button type="button" className="qspl-bb-b primary" onClick={() => ptBulkAdd_(tpl, selRows())}><QsIcon name="plus" size={15} /> Thêm vào bảng khái toán</button>
            <button type="button" className="qspl-bb-b" onClick={() => ctFavBulk_(selRows(), 1)} title="Lưu vào danh sách yêu thích"><QsIcon name="star" size={15} /> Yêu thích</button>
            {canDuyet && <button type="button" className="qspl-bb-b" onClick={() => ctDuyetBulk_(selRows(), 1)} title="Đánh dấu Đã duyệt"><QsIcon name="check" size={15} /> Duyệt</button>}
            <button type="button" className="qspl-bb-b" onClick={e => { const a = e.currentTarget; setPop(p => (p && p.kind === 'bbedit' ? null : { kind: 'bbedit', anchor: a })) }} title="Đổi một trường cho tất cả dòng đã chọn">
              <QsIcon name="edit" size={15} /> Sửa hàng loạt <i className="car">▾</i>
            </button>
            <div className="qspl-bb-sep" />
            <button type="button" className="qspl-bb-ic" onClick={e => { const a = e.currentTarget; setPop(p => (p && p.kind === 'bbmore' ? null : { kind: 'bbmore', anchor: a })) }} title="Thao tác khác">⋯</button>
          </div>
        </MrootPortal>
      )}

      {pop && pop.kind === 'flt' && (
        <PtFilterPop anchor={pop.anchor} all={all} f={f} onSet={(k, v) => selFilter(k, v)} onReset={fltReset} onClose={() => setPop(null)} />
      )}
      {pop && pop.kind === 'preset' && (
        <PresetPop anchor={pop.anchor} tab={tab} on={onMap} mine={mine} mineOn={mineOn} username={username}
          onPreset={ps => { setPop(null); colSet(csPresetCols_(tab, ps[0]) || csWant_(tab, [])); toast('Đã bật bộ cột: ' + ps[1]) }}
          onMine={() => { setPop(null); if (!mine) return; colSet(csMyApply_(tab, mine)); toast('Đã bật bộ cột của tôi') }}
          onSaveMine={mineSave} onClearMine={mineClear} onClose={() => setPop(null)} />
      )}
      {pop && pop.kind === 'bbedit' && nSel > 0 && (
        <BulkEditPop anchor={pop.anchor} fields={CT_BULK_F.map(x => [x[0], x[1]])} n={nSel} toast={toast} onClose={() => setPop(null)}
          onApply={(fld, val) => ctBulkEditRun_(selRows(), fld, val)} />
      )}
      {pop && pop.kind === 'bbmore' && nSel > 0 && (
        <PtMorePop anchor={pop.anchor} n={nSel} canDuyet={canDuyet} onClose={() => setPop(null)}
          onXlsx={() => exportXlsx(selRows())} onUnduyet={() => ctDuyetBulk_(selRows(), 0)} onUnfav={() => ctFavBulk_(selRows(), 0)} onDelete={() => ctDeleteBulk_(selRows())} />
      )}

      {dlg && dlg.kind === 'detail' && (
        <PtDetailModal r={liveRow(dlg.r)} ovr={ovr} projData={projData} onClose={() => setDlg(null)}
          onEditCt={c => setDlg({ kind: 'ct', id: c.id })} onAdd={r => ptAddOne_(tpl, r)} />
      )}
      {dlg && dlg.kind === 'ct' && (
        <CtEditModal ctId={dlg.id} onClose={() => setDlg(null)} onSaved={() => setDlg(null)} />
      )}
    </div>
  )
}
