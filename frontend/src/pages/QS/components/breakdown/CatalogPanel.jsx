import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import ProductThumb from '../common/ProductThumb'
import FilterPopover from './FilterPopover'
import FltChips, { FltChipsTitle } from './catalog/FltChips'
import FilterSections from './FilterSections'
import ChildBox from './catalog/ChildBox'
import CtLibrary from './catalog/CtLibrary'
import './catalog/catalog.css'
import { useQs } from '../../state/QsData'
import { setState } from '../../state/store'
import * as api from '../../api/qsApi'
import { mediaUrl } from '../../api/files'
import { money, ptQty } from '../../lib/format.js'
import { nodeName } from '../../lib/tree.js'
import { coSpec_, nganhCuaSP_, dbLabelMaps_ } from '../../lib/productFields.js'
import {
  filteredProducts, vsFilterModel_, vsFltOn_, vsFltNganh_, fltSecs_, activeFiltCount_, catActiveTags_, hmucOptions,
  favCount_, catVarGroups_, spTenDay_, catVarLbl_, inProjKeys_,
} from '../../lib/catalogFilters.js'
import { catCbKey_, ccSpecTxt_, spSpecs_, spMauCss_, catVarMau_, ctSecsOfNode_, popMatch_ } from './catalog/catalogModel'
import { useSpecs } from './catalog/useSpecs'
import { useComboCache, loadCombo } from './catalog/comboCache'
import { useFilters, setF, toggleIn, clearAllFilters, clearTag } from './catalog/filterStore'

const Caret = ({ up }) => <span className={`qs-bd-caret${up ? ' up' : ''}`} />
const LIMIT = 300      // bản gốc chỉ vẽ 300 thẻ đầu (app.js:1040), số đếm vẫn là cả danh sách

/* Cột trái tab Bóc tách: bộ lọc + danh mục sản phẩm THẬT (port PUB/app.js:463-1075, boc.js:1653-1726, phantho.js:574-610).
   Dữ liệu lấy từ useQs() (products, lines, projects, cur, node, congTac); trạng thái lọc ở catalog/filterStore (như S.f* của bản gốc).
   Props (giữ tương thích bản cũ):
     onAdd(product, opts?)        thêm 1 SP vào bảng (addProdObj). opts = {sl} khi thêm thành phần combo đúng số lượng đi kèm.
                                  Có thể trả Promise. Kéo thả: nơi thả (BreakdownTab) gọi onAdd(product, {tang, at, sl}).
     onOpen(product, opts?)       mở panel "Thông tin sản phẩm" cho SP này (showDetail luôn MỞ, không bật/tắt);
                                  opts = {sl} khi là thành phần combo (nút "Thêm vào bóc tách" của panel thêm đúng SL đó).
     activeId                     khoá SP đang mở ở panel chi tiết (catCbKey_ = recordId || ma)
     width                        bề rộng cột (px bố cục)
     dragId                       khoá SP đang được kéo (catCbKey_), để làm mờ thẻ
     onDragProduct(product, sl)   bắt đầu kéo 1 SP (dataTransfer 'text/plain' = recordId, như PLAN 1C); sl = số lượng khi thả
     onDragEnd()                  kết thúc kéo
     favorites, onToggleFav       (cũ, bỏ qua: yêu thích giờ là p.yeuThich lưu trên máy chủ)
     onOpenCt(sec, item, ii)      (tuỳ chọn) bấm 1 công tác ở thư viện công tác của đề mục -> mở panel thông tin công tác
                                  (ptShowDetail_, PUB/phantho.js:603, 1908); activeCt = ctItemKey_(sec, ii) của công tác đang mở
     Đề mục 3.1 Phần thô (renderCatalog -> renderPTLibrary, PUB/app.js:1025, phantho.js:1226-1296) - chỗ để 3A cắm vào:
     ptCount                      chữ đếm cạnh tiêu đề, vd "156 công việc"
     ptFilters                    khối lọc riêng của Phần thô (#ptFilters, nằm chỗ khối lọc)
     ptLib                        thư viện nội dung công việc (#catList, vùng cuộn) */
/* Bảng "Sản phẩm yêu thích" (nút ★ ở đầu cột): mọi SP yêu thích trong hạng mục đang chọn - bỏ các lọc khác */
const FAV_SCOPE = { fWatt: {}, fKelvin: {}, fAngle: {}, fIP: {}, fCRI: {}, fVolt: {}, fBrand: '', fCombo: '', fVs: {}, min: '', max: '', q: '', fFav: true }

export default function CatalogPanel({ onAdd, onOpen, activeId, width, dragId, onDragProduct, onDragEnd, onOpenCt, activeCt, ptCount, ptFilters, ptLib, headTools = null }) {
  const { products, lines, projects, cur, node, congTac, toast } = useQs()
  const { specs, error: specErr } = useSpecs()
  const st = useFilters()
  const combos = useComboCache()
  const [popOpen, setPopOpen] = useState(false)   // false | 'filter' (nút Bộ lọc) | 'fav' (nút ★: bảng Sản phẩm yêu thích)
  const [acc, setAcc] = useState({ nhom: false, inproj: false })
  const [accQ, setAccQ] = useState({ nhom: '', inproj: '' })
  const [filterH, setFilterH] = useState(null)
  const [dragging, setDragging] = useState(false)
  const filtersRef = useRef(null)
  const dragRef = useRef(null)
  const scaleRef = useRef(1)
  const filtBtnRef = useRef(null)
  const ghostRef = useRef(null)
  const searchRef = useRef(null)

  const isPT = node === '3.1'
  const vsOn = vsFltOn_(node)
  const ng = vsFltNganh_(node) || 'den'
  /* Đổi ngành (đèn <-> vệ sinh / sơn / công tắc): bỏ lọc hạng mục / thông số của ngành cũ (renderVsFilters_, app.js:574-577) */
  useLayoutEffect(() => {
    if (st.fltNg === ng) return
    setF(st.fltNg ? { fNhomSet: {}, fVs: {}, fltNg: ng } : { fltNg: ng })
  }, [ng, st.fltNg])

  /* Khối lọc theo ngành; spec chưa tải xong thì chưa vẽ khối nào, tải lỗi thì báo */
  const vsModel = useMemo(() => {
    if (!vsOn) return null
    if (specs) return vsFilterModel_({ ...st, node, products }, specs)
    return specErr ? { fVs: st.fVs, sections: [], note: false, noSpec: true } : { fVs: st.fVs, sections: [], note: false }
  }, [vsOn, specs, specErr, st, node, products])
  /* Bản gốc xoá tại chỗ lọc của thông số không còn áp dụng -> dùng fVs đã gọt cho mọi phép lọc / đếm */
  const stEff = useMemo(() => ({
    ...st, fVs: vsModel ? vsModel.fVs : st.fVs, node, products, lines, projects,
    demucKw: node && node !== 'X' ? (nodeName(node) || '') : '',
  }), [st, vsModel, node, products, lines, projects])

  const list = useMemo(() => (isPT ? [] : filteredProducts(stEff, specs)), [isPT, stEff, specs])
  const favList = useMemo(() => (popOpen === 'fav' && !isPT ? filteredProducts({ ...stEff, ...FAV_SCOPE }, specs) : []), [popOpen, isPT, stEff, specs])
  const ctSecs = useMemo(() => (isPT ? [] : ctSecsOfNode_(node, congTac)), [isPT, node, congTac])
  const shown = useMemo(() => list.slice(0, LIMIT), [list])
  const groups = useMemo(() => catVarGroups_(shown), [shown])
  const favN = favCount_(products)
  const nCt = ctSecs.reduce((a, s) => a + s.items.length, 0)
  const countText = ctSecs.length ? nCt + ' công tác' + (list.length ? ' · ' + list.length + ' SKU' : '') : list.length + ' SKU'
  const filtN = activeFiltCount_(stEff)
  const tags = useMemo(() => catActiveTags_(stEff, specs, dbLabelMaps_(specs).SP_COL2LABEL_), [stEff, specs])
  const hideDen = isPT || ctSecs.length > 0 || node === '3.2.5'

  /* ---------- Yêu thích (catFav / spFavSet_ / spFavChk_, boc.js:1718-1725, sanpham.js:374-381) ---------- */
  function favSet(k, on) {
    setState(s => ({ products: s.products.map(p => (catCbKey_(p) === k ? { ...p, yeuThich: !!on } : p)) }))
  }
  async function catFav(p, on) {
    const k = catCbKey_(p)
    if (!k) return
    favSet(k, on)
    try {
      const r = await api.setYeuThich([k], !!on)
      if (r && r.ok === 0 && r.errors && r.errors.length) throw new Error(r.errors[0].error)
    } catch (e) { favSet(k, !on); toast(e.message); return }
    toast(on ? 'Đã thêm vào sản phẩm yêu thích' : 'Đã bỏ khỏi sản phẩm yêu thích')
  }

  /* ---------- Combo / biến thể bung ngay dưới thẻ ---------- */
  function comboToggle(p) {
    const k = catCbKey_(p)
    if (!k) return
    const mo = !st.cbOpen[k]
    setF(f => { const cbOpen = { ...f.cbOpen }; if (mo) cbOpen[k] = 1; else delete cbOpen[k]; return { cbOpen } })
    if (mo && !(combos[k] && combos[k].list)) loadCombo(k)
  }
  function varToggle(p) {
    const k = catCbKey_(p)
    if (!k) return
    setF(f => { const varOpen = { ...f.varOpen }; if (varOpen[k]) delete varOpen[k]; else varOpen[k] = 1; return { varOpen } })
  }
  async function addChild(x) {
    await onAdd(x, { sl: Number(x.comboSL) || 1 })
    toast('Đã thêm: ' + String(x.ten || '').split('\n')[0])
  }

  /* ---------- "Đèn / Thiết bị trong dự án" (pickInProj, app.js:769-778) ---------- */
  async function pickInProj(maDA) {
    setAcc(a => ({ ...a, inproj: false }))
    if (!maDA) { setF({ inProjMa: '', inProjKeys: null, onlyProject: false }); return }
    let ls
    if (cur && cur.maDA === maDA) ls = lines || []
    else {
      try { ls = (await api.getLines(maDA)) || [] } catch (e) { toast('Không tải được dòng của dự án: ' + e.message); return }
    }
    setF({ inProjMa: maDA, inProjKeys: inProjKeys_(ls), onlyProject: true })
  }

  /* ---------- Kéo SP sang bảng (prodDragObj_, app.js:2018-2043) ---------- */
  function dragStart(e, p, sl) {
    if (!p) { e.preventDefault(); return }
    sl = Math.max(1, Math.round(Number(sl) || 1))
    try {
      e.dataTransfer.effectAllowed = 'copy'
      e.dataTransfer.setData('text/plain', String(p.recordId || p.ma || ''))
      const host = e.currentTarget.closest('.qs-page') || e.currentTarget.parentNode
      const g = document.createElement('div')
      g.className = 'qs-bdc-ghost'
      const src = p.hinhAnh ? mediaUrl(String(p.hinhAnh).split('\n')[0].trim()) : ''
      if (src) { const im = document.createElement('img'); im.src = src; im.onerror = () => { im.style.visibility = 'hidden' }; g.appendChild(im) } else { const s = document.createElement('span'); s.className = 'qs-bdc-ghost-img'; g.appendChild(s) }
      const b = document.createElement('span'); b.className = 'qs-bdc-ghost-b'
      const nm = document.createElement('span'); nm.className = 'qs-bdc-ghost-nm'; nm.textContent = p.ten || ''
      const pr = document.createElement('span'); pr.className = 'qs-bdc-ghost-pr'; pr.textContent = (sl > 1 ? sl + ' × ' : '') + money(p.donGiaBan) + ' đ'
      b.appendChild(nm); b.appendChild(pr); g.appendChild(b)
      const ad = document.createElement('span'); ad.className = 'qs-bdc-ghost-add'; ad.textContent = '+ Thả vào bảng'; g.appendChild(ad)
      host.appendChild(g)
      ghostRef.current = g
      e.dataTransfer.setDragImage(g, 24, 28)
    } catch (x) { /* trình duyệt không cho đặt ảnh kéo: vẫn kéo được, chỉ thiếu ảnh */ }
    if (onDragProduct) onDragProduct(p, sl)
  }
  function dragEnd() {
    if (ghostRef.current) { ghostRef.current.remove(); ghostRef.current = null }
    if (onDragEnd) onDragEnd()
  }

  /* Kéo thanh nắm để thu/mở khối bộ lọc. filterH: null = cao tự nhiên (tối đa nửa cột), 0 = gập hẳn.
     Toạ độ chuột tính theo màn hình còn chiều cao tính theo px bố cục (trang đang zoom) nên phải quy đổi qua scale. */
  function startGrip(e) {
    const el = filtersRef.current
    const h = el.offsetHeight
    if (h > 0) scaleRef.current = el.getBoundingClientRect().height / h || 1
    dragRef.current = { y: e.clientY, h }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* trình duyệt cũ */ }
    setDragging(true)
  }
  function moveGrip(e) {
    const d = dragRef.current
    if (!d) return
    if (e.buttons === 0) { endGrip(); return }
    const natural = filtersRef.current.scrollHeight
    setFilterH(Math.max(0, Math.min(natural, Math.round(d.h + (e.clientY - d.y) / scaleRef.current))))
  }
  function endGrip() { dragRef.current = null; setDragging(false) }

  const open = (p, opts) => { if (onOpen) onOpen(p, opts) }
  const isKey = (v, p) => v != null && v !== '' && (v === catCbKey_(p) || v === p.id)

  /* ---------- Ô chọn "Hạng mục sản phẩm" (openNhomMsel, app.js:730-747) ---------- */
  const nhomSel = Object.keys(st.fNhomSet).filter(k => st.fNhomSet[k])
  const nhomLabel = nhomSel.length ? (nhomSel.length === 1 ? nhomSel[0] : nhomSel.length + ' hạng mục đã chọn') : 'Hạng mục sản phẩm'
  const hmOpts = useMemo(() => (acc.nhom ? hmucOptions(products, node, specs) : {}), [acc.nhom, products, node, specs])
  const hmKeys = Object.keys(hmOpts).sort()
  const allOn = hmKeys.length > 0 && hmKeys.every(k => st.fNhomSet[k])
  const inProjName = (() => {
    if (!st.inProjMa) return ''
    const p = (projects || []).filter(x => x.maDA === st.inProjMa)[0]
    return p ? (p.ten || p.maDA) : st.inProjMa
  })()
  const inProjTitle = vsOn ? 'Thiết bị trong dự án' : 'Đèn trong dự án'

  function renderCard(G) {
    const i = G.i
    const p = shown[i]
    const k = catCbKey_(p)
    const cbMo = !!st.cbOpen[k]
    const varMo = !!st.varOpen[k]
    const brand = p.thuongHieu || ''
    const specsChips = spSpecs_(p, specs)
    const kids = G.kids.map(ix => shown[ix])
    const mau = kids.length ? catVarMau_([p].concat(kids)) : []
    const out = [(
      <div
        key={'p' + i}
        className={`qs-bd-product${isKey(dragId, p) ? ' dragging' : ''}${isKey(activeId, p) ? ' active' : ''}${cbMo ? ' qs-bdc-cbopen' : ''}`}
        onClick={() => open(p)}
        draggable
        title="Bấm để xem thông tin · kéo thả vào bảng để bóc sản phẩm này"
        onDragStart={e => dragStart(e, p, 1)}
        onDragEnd={dragEnd}
      >
        <span className="qs-bd-product-no">{i + 1}</span>
        <div className="qs-bd-product-thumb">
          <ProductThumb product={p} size={76} src={p.hinhAnh ? mediaUrl(String(p.hinhAnh).split('\n')[0].trim()) : ''} />
        </div>
        <div className="qs-bd-product-main">
          <div className="qs-bd-product-name">{spTenDay_(p)}</div>
          <div className="qs-bd-product-price">{money(p.donGiaBan)} đ</div>
        </div>
        <div className="qs-bd-product-actions">
          <button className={`qs-bd-heart${p.yeuThich ? ' on' : ''}`} title={p.yeuThich ? 'Bỏ khỏi sản phẩm yêu thích' : 'Thêm vào sản phẩm yêu thích'}
            onClick={e => { e.stopPropagation(); catFav(p, !p.yeuThich) }}><Icon name="star" size={18} /></button>
          <button className="qs-bd-add" title="Thêm vào bóc tách" onClick={e => { e.stopPropagation(); onAdd(p) }}><Icon name="plus" size={16} stroke={2.8} /></button>
        </div>
        {(brand || p.comboN > 0 || kids.length > 0 || specsChips.length > 0) && (
          <div className="qs-bd-product-tags">
            {(brand || p.comboN > 0 || kids.length > 0) && (
              <div className="qs-bd-chips">
                {brand && <span className="qs-bd-chip brand">{brand}</span>}
                {p.comboN > 0 && (
                  <button className={`qs-bd-chip combo qs-bdc-chipbtn${cbMo ? ' on' : ''}`} title={'Xem ' + p.comboN + ' sản phẩm đi kèm'}
                    onClick={e => { e.stopPropagation(); comboToggle(p) }}>
                    <Icon name="layers" size={11} />Combo {p.comboN}<Caret up={cbMo} />
                  </button>
                )}
                {kids.length > 0 && (
                  <button className={`qs-bd-chip variant qs-bdc-chipbtn${varMo ? ' on' : ''}`} title={'Xem ' + (kids.length + 1) + ' biến thể của sản phẩm này'}
                    onClick={e => { e.stopPropagation(); varToggle(p) }}>
                    <Icon name="copy" size={11} />Biến thể {kids.length + 1}<Caret up={varMo} />
                  </button>
                )}
                {mau.length > 0 && (
                  <span className="qs-bdc-mau" title={mau.length + ' màu: ' + mau.join(' · ')}>
                    {mau.slice(0, 6).map(m => { const c = spMauCss_(m); return <i key={m} className={c ? '' : 'x'} style={c ? { background: c } : undefined} /> })}
                    {mau.length > 6 && <b>+{mau.length - 6}</b>}
                  </span>
                )}
              </div>
            )}
            {specsChips.length > 0 && (
              <div className="qs-bdc-specs">{specsChips.map((s, j) => <span key={j} className={s.k ? 'k' : ''} title={s.t}>{s.t}</span>)}</div>
            )}
          </div>
        )}
      </div>
    )]
    if (cbMo) {
      const c = combos[k]
      if (!c || c.loading) out.push(<div key={'c' + i} className="qs-bdc-ccnote">Đang tải sản phẩm đi kèm…</div>)
      else if (c.error) out.push(<div key={'c' + i} className="qs-bdc-ccnote err">Không tải được sản phẩm đi kèm: {c.error}</div>)
      else if (!c.list.length) out.push(<div key={'c' + i} className="qs-bdc-ccnote">Không có sản phẩm đi kèm.</div>)
      else {
        const ds = c.list
        const tong = ds.reduce((a, x) => a + (Number(x.donGiaBan) || 0) * (Number(x.comboSL) || 1), 0)
        out.push(
          <ChildBox key={'c' + i} title="Sản phẩm đi kèm" n={ds.length}
            rows={ds.map((x, j) => {
              const sl = Number(x.comboSL) || 1
              const phu = [x.thuongHieu, sl > 1 ? '×' + ptQty(sl) : '', ccSpecTxt_(x)].map(t => String(t || '').trim()).filter(Boolean).join(' · ')
              return { stt: (i + 1) + '.' + (j + 1), x, phu, gc: String(x.comboGhiChu || '').trim(), onOpen: () => open(x, { sl }), onAdd: () => addChild(x) }
            })}
            foot={<div className="qs-bdc-ccfoot">Tổng combo · {ds.length} sản phẩm đi kèm <b>{money(tong)} đ</b></div>}
          />,
        )
      }
    }
    if (varMo && kids.length) {
      out.push(
        <ChildBox key={'v' + i} title="Biến thể của sản phẩm" n={kids.length + 1} cls="bt"
          rows={G.kids.map((ix, j) => {
            const x = shown[ix]
            const lbl = catVarLbl_(x) || x.ten || ''
            /* biến thể: không ghi lại thương hiệu (trùng sản phẩm chính ngay trên) */
            const phu = [catVarLbl_(x) ? '' : ccSpecTxt_(x), x.comboN ? 'Combo ' + x.comboN : ''].map(t => String(t || '').trim()).filter(Boolean).join(' · ')
            return {
              stt: (i + 1) + '.' + (j + 2), x, phu, ten: coSpec_(nganhCuaSP_(x, specs)) ? spTenDay_(x) : lbl,
              onOpen: () => open(x), onAdd: () => onAdd(x),
              drag: { onStart: e => dragStart(e, x, 1), onEnd: dragEnd },
            }
          })}
        />,
      )
    }
    return out
  }

  /* Bảng Bộ lọc (mở bên phải cột) = danh sách module chung, kéo thả đổi thứ tự (FilterSections): 3 module đầu bảng dựng ở đây
     (Khối hiển thị = chip bật / tắt khối, Đang lọc = thẻ, Phạm vi sản phẩm = Hạng mục sản phẩm + Đèn trong dự án)
     + các module khối lọc. Cột Hạng mục chỉ còn ô tìm + danh sách sản phẩm. */
  const fltSecs = fltSecs_(stEff, specs)
  const lead = [
    { id: 'chips', cls: 'qs-bd-mod-chips', title: <FltChipsTitle secs={fltSecs} st={stEff} />, body: <FltChips secs={fltSecs} st={stEff} /> },
    tags.length > 0 && {
      id: 'tags', cls: 'qs-bd-mod-tags', title: 'Đang lọc', body: (
        <div className="qs-bdc-tags">
          {tags.map(t => (
            <span key={t.clear} className="qs-bdc-tag" title={t.lb}><i>{t.lb}</i>{t.val}<b onClick={() => clearTag(t.clear)} title="Bỏ lọc này">✕</b></span>
          ))}
          <button className="qs-bdc-tags-x" onClick={() => { clearAllFilters(); clearTag('nhom') }}>Xoá hết</button>
        </div>
      ),
    },
    {
      id: 'scope', cls: 'qs-bd-mod-scope', title: 'Phạm vi sản phẩm', body: (
        <>
          <button className={`qs-bd-accordion${nhomSel.length ? ' qs-bdc-on' : ''}`} onClick={() => setAcc(a => ({ ...a, nhom: !a.nhom }))}>
            <span className="qs-bdc-acc-lb">{nhomLabel}</span>
            <span className="qs-bd-acc-plus"><Icon name={acc.nhom ? 'minus' : 'plus'} size={10} stroke={3} /></span>
          </button>
          {acc.nhom && (
            <div className="qs-bd-acc-body qs-bdc-pick">
              <div className="qs-bdc-pick-h">Chọn hạng mục (nhiều)</div>
              <input className="qs-bdc-pick-q" placeholder="Tìm hạng mục…" value={accQ.nhom} onChange={e => setAccQ(q => ({ ...q, nhom: e.target.value }))} />
              <div className="qs-bdc-pick-list">
                <div className={`qs-bdc-chk${allOn ? ' on' : ''}`} onClick={() => {
                  const m = {}
                  if (!allOn) hmKeys.forEach(k => { m[k] = 1 })
                  setF({ fNhomSet: m }); setAcc(a => ({ ...a, nhom: false }))
                }}><span className="bx">{allOn ? '✓' : ''}</span><b>Chọn tất cả</b></div>
                {hmKeys.filter(k => popMatch_(k, accQ.nhom)).map(k => {
                  const on = !!st.fNhomSet[k]
                  return (
                    <div key={k} className={`qs-bdc-chk${on ? ' on' : ''}`} onClick={() => toggleIn('fNhomSet', k)}>
                      <span className="bx">{on ? '✓' : ''}</span>{k} <span className="qs-bdc-pick-n">({hmOpts[k]})</span>
                    </div>
                  )
                })}
                {!hmKeys.length && <div className="qs-bdc-pick-none">Chưa có nhóm (SP chưa gán nhóm).</div>}
              </div>
            </div>
          )}
          <button className={`qs-bd-accordion${st.inProjMa ? ' qs-bdc-on' : ''}`} onClick={() => setAcc(a => ({ ...a, inproj: !a.inproj }))}>
            <span className="qs-bdc-acc-lb">{st.inProjMa ? inProjName : inProjTitle}</span>
            <span className="qs-bd-acc-plus"><Icon name={acc.inproj || st.inProjMa ? 'minus' : 'plus'} size={10} stroke={3} /></span>
          </button>
          {acc.inproj && (
            <div className="qs-bd-acc-body qs-bdc-pick">
              <div className="qs-bdc-pick-h">{inProjTitle}</div>
              <input className="qs-bdc-pick-q" placeholder="Tìm dự án…" value={accQ.inproj} onChange={e => setAccQ(q => ({ ...q, inproj: e.target.value }))} />
              <div className="qs-bdc-pick-list">
                {popMatch_('tất cả sản phẩm', accQ.inproj) && (
                  <div className={`qs-bdc-opt${!st.inProjMa ? ' on' : ''}`} onClick={() => pickInProj('')}>Tất cả sản phẩm</div>
                )}
                {(projects || []).filter(p => popMatch_(p.ten, accQ.inproj)).map(p => (
                  <div key={p.maDA} className={`qs-bdc-opt${st.inProjMa === p.maDA ? ' on' : ''}`} onClick={() => pickInProj(p.maDA)}>{p.ten || p.maDA}</div>
                ))}
                {!(projects || []).length && <div className="qs-bdc-pick-none">Chưa có dự án nào.</div>}
              </div>
            </div>
          )}
        </>
      ),
    },
  ]
  const filtersInner = (
    <FilterSections st={stEff} node={node} products={products} vsModel={vsModel} hideDen={hideDen} favMode={popOpen === 'fav'} lead={lead} />
  )

  return (
    <div className={`qs-card qs-bd-catalog${popOpen ? ' pop-open' : ''}`} style={{ width }}>
      <div className="qs-bd-catalog-head">
        {isPT && <span className="qs-bd-h">Nội dung công việc</span>}
        {isPT ? (ptCount ? <span className="qs-bd-badge">{ptCount}</span> : null) : <span className="qs-bd-badge qs-bd-badge-pill">{countText}</span>}
        {/* headTools: nút của bảng đặt giữa ô đếm SKU và Bộ lọc (Bóc tách: Vừa thêm + Lịch sử thao tác) */}
        {!isPT && headTools && <><span className="qs-bd-headsep" /><span className="qs-bd-headtools">{headTools}</span></>}
        {/* có nhóm nút đầu cột thì các nhóm dàn đều (space-between, QS.css), không cần khoảng đẩy */}
        {!(headTools && !isPT) && <span style={{ flex: 1 }} />}
        {!isPT && headTools && <span className="qs-bd-headsep" />}
        {!isPT && (
          <button ref={filtBtnRef} title={'Bộ lọc' + (filtN > 0 ? ' (' + filtN + ' đang lọc)' : '')} aria-label="Bộ lọc" className={`qs-bd-pill-btn qs-bd-icononly qs-bd-pop-anchor${popOpen === 'filter' ? ' on' : ''}`} onClick={() => setPopOpen(o => (o === 'filter' ? false : 'filter'))}>
            <Icon name="filter" size={15} />{filtN > 0 && <span className="qs-bdc-badge">{filtN}</span>}
          </button>
        )}
        {!isPT && headTools && <span className="qs-bd-headsep" />}
        {!isPT && (
          <button className={`qs-bd-fav-count qs-bdc-favgo qs-bd-pop-anchor${st.fFav || popOpen === 'fav' ? ' on' : ''}${favN ? '' : ' empty'}`}
            title="Sản phẩm yêu thích" aria-label="Sản phẩm yêu thích"
            onClick={() => setPopOpen(o => (o === 'fav' ? false : 'fav'))}>
            <Icon name="star" size={15} />
          </button>
        )}
      </div>
      {popOpen && !isPT && (
        popOpen === 'fav'
          ? (
            <FilterPopover title={'Sản phẩm yêu thích · ' + favList.length} anchorRef={filtBtnRef} onClose={() => setPopOpen(false)}
              foot={<button className="qs-modal-btn primary" onClick={() => setPopOpen(false)}>Đóng</button>}>
              {favList.length
                ? (
                  <ChildBox title="Trong hạng mục đang chọn" n={favList.length} cls="fav"
                    rows={favList.map((x, j) => ({
                      stt: String(j + 1), x, phu: x.thuongHieu || '',
                      onOpen: () => open(x), onAdd: () => onAdd(x),
                      drag: { onStart: e => dragStart(e, x, 1), onEnd: dragEnd },
                    }))}
                  />
                )
                : <div className="qs-bdc-favnone">Chưa có sản phẩm yêu thích trong hạng mục này. Bấm ☆ trên một sản phẩm để thêm.</div>}
            </FilterPopover>
          )
          : <FilterPopover anchorRef={filtBtnRef} onClose={() => setPopOpen(false)}>{filtersInner}</FilterPopover>
      )}

      {/* Thân cột (ô tìm + danh sách sản phẩm): module riêng, tách khỏi hàng nút đầu cột */}
      <div className="qs-bd-catbody">
      {isPT && ptFilters ? (
        <div className="qs-bdc-ptf" ref={filtersRef} style={filterH === null ? undefined : { height: filterH, maxHeight: 'none' }}>{ptFilters}</div>
      ) : null}
      {/* 3.1 cũng có thanh kéo + ô tìm như bản gốc (.catpanel-top -> cat-split -> #catFind, PUB/index.html:6670-6720);
          ô tìm ở đây không lọc thư viện Phần thô (renderPTLibrary bỏ qua catQ) */}
      {isPT && ptFilters && (
        <div
          className={`qs-bd-grip${dragging ? ' dragging' : ''}`}
          title="Kéo lên/xuống để thu gọn · bấm đúp để gập nhanh"
          onPointerDown={startGrip}
          onPointerMove={moveGrip}
          onPointerUp={endGrip}
          onPointerCancel={endGrip}
          onDoubleClick={() => setFilterH(h => (h === 0 ? null : 0))}
        ><span /></div>
      )}

      {(!isPT || ptFilters) && (
        <div className="qs-bd-search">
          <Icon name="search" size={14} />
          <input ref={searchRef} value={st.q} onChange={e => setF({ q: e.target.value })} placeholder="Gõ tên, mã hoặc thương hiệu…" autoComplete="off" spellCheck="false" />
          {String(st.q || '').trim() && (
            <button className="qs-bdc-qx" title="Xoá tìm" onClick={() => { setF({ q: '' }); if (searchRef.current) searchRef.current.focus() }}>✕</button>
          )}
        </div>
      )}

      <div className="qs-bd-products">
        {ctSecs.length > 0 && <CtLibrary secs={ctSecs} node={node} lines={lines} col={st.ctCol} onAdd={prod => onAdd(prod)} onOpenCt={onOpenCt} activeCt={activeCt} />}
        {isPT && ptLib}
        {ctSecs.length > 0 && list.length > 0 && <div className="qs-bdc-sph"><Icon name="tag" size={13} /> Sản phẩm<span>{list.length}</span></div>}
        {!isPT && groups.map(G => renderCard(G))}
        {!isPT && !list.length && !ctSecs.length && (st.fFav ? (
          <div className="qs-bdc-empty fav">
            <Icon name="star" size={22} />
            <b>Chưa có sản phẩm yêu thích</b>
            <span>Bấm biểu tượng trái tim ở một sản phẩm (tại đây hoặc trong Danh sách sản phẩm) để lưu lại, lần sau mở dự án mới là lấy ra dùng ngay.</span>
          </div>
        ) : <div className="qs-bdc-empty">Không có sản phẩm khớp lọc.</div>)}
      </div>
      </div>
    </div>
  )
}
