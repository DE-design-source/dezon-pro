import { useEffect, useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import QsIcon from '../common/QsIcon'
import ImgViewer from '../common/ImgViewer'
import ProductThumb from '../common/ProductThumb'
import { DocRows, safeUrl_ } from '../common/DocsPopover'
import './catalog/catalog.css'
import { useQs } from '../../state/QsData'
import * as api from '../../api/qsApi'
import { mediaUrl } from '../../api/files'
import { money } from '../../lib/format.js'
import { coSpec_, nganhCuaSP_, prodDocs_ } from '../../lib/productFields.js'
import { catCbKey_, pdImgs_, pdKeyItems_, pdSpecBlocks_ } from './catalog/catalogModel'
import { putCombo } from './catalog/comboCache'
import { useSpecs } from './catalog/useSpecs'

/* Cột "Thông tin sản phẩm" (#pdPanel) mở khi bấm 1 SP ở danh mục - port showDetail / showDetailObj_ / pdContent_ / pdMedia_ /
   pdSpecs_* / pdPriceFoot_ / pdPanelKey_ (PUB/app.js:1076-1282) và khối "Sản phẩm đi kèm" pdLoadCombo_ / pdComboVe_ /
   pdCbBoSet_ / pdCbSL_ / pdAddCombo_ (PUB/sanpham.js:1849-1930).
   Props: product (SP của danh mục), width (px, = bề rộng cột Hạng mục để 2 khung bằng nhau; thiếu thì 344 theo CSS), onClose(), onAdd(product, opts?) (như CatalogPanel; trả Promise được),
          addSl (tuỳ chọn: SP là thành phần combo -> "Thêm vào bóc tách" thêm đúng SL đi kèm),
          onDragProduct(product, sl) / onDragEnd() (tuỳ chọn: kéo 1 dòng "Sản phẩm đi kèm" thả vào bảng). */
/* Ô số SL / Số bộ: tính lại ngay khi đổi (mũi tên tăng giảm hay gõ số hợp lệ, như onchange của bản gốc); ô trống thì giữ số cũ (pdCbBoSet_ / pdCbSL_, sanpham.js:1897-1910) */
function NumIn({ value, onCommit, ...rest }) {
  const [d, setD] = useState(String(value))
  useEffect(() => { setD(String(value)) }, [value])
  return (
    <input type="number" min="1" step="1" {...rest} value={d}
      onChange={e => { const v = e.target.value; setD(v); if (v !== '' && Number(v) >= 1) onCommit(v) }}
      onBlur={() => { if (d !== '') onCommit(d); setD(String(value)) }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
  )
}

export default function ProductInfo({ product, width, onClose, onAdd, addSl, onDragProduct, onDragEnd }) {
  const p = product || {}
  const { toast } = useQs()
  const { specs, error: specErr } = useSpecs()
  const imgs = pdImgs_(p).map(v => mediaUrl(v))
  const [idx, setIdx] = useState(0)
  const [view, setView] = useState('')
  const [bad, setBad] = useState('')
  const bodyRef = useRef(null)
  const k = catCbKey_(p)

  /* Mở SP khác: về ảnh đầu, cuộn lên đầu panel */
  useEffect(() => {
    setIdx(0); setView('')
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [k])
  const n = imgs.length
  const at = n ? (((idx % n) + n) % n) : 0
  const go = d => { if (n > 1) setIdx(i => (((i + d) % n) + n) % n) }

  /* ←/→ lật ảnh trong panel (bỏ qua khi đang gõ hoặc đang xem ảnh lớn) */
  const goRef = useRef(go)
  goRef.current = go
  const viewRef = useRef(view)
  viewRef.current = view
  useEffect(() => {
    const key = e => {
      if (viewRef.current) return
      const a = document.activeElement
      const tg = a ? a.tagName : ''
      if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return
      if (e.key === 'ArrowLeft') { e.preventDefault(); goRef.current(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goRef.current(1) }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])

  const ng = nganhCuaSP_(p, specs)
  const keyItems = pdKeyItems_(p, specs)
  const blocks = pdSpecBlocks_(p, specs)
  const docs = prodDocs_(p)
  const specMissing = coSpec_(ng) && !specs

  async function addThis() {
    if (addSl) {
      await onAdd(p, { sl: addSl })
      toast('Đã thêm: ' + String(p.ten || '').split('\n')[0])
    } else await onAdd(p)
  }

  const main = imgs[at]
  return (
    <div className="qs-card qs-bd-info" style={width ? { width } : undefined}>
      <div className="qs-bd-info-head">
        <span>Thông tin sản phẩm</span>
        <button className="qs-bd-info-close" title="Đóng" onClick={onClose}><Icon name="x" size={15} /></button>
      </div>
      <div className="qs-bd-info-body" ref={bodyRef}>
        <div className="qs-bdc-gal">
          <div className="qs-bd-info-image">
            {main
              ? <img className={`qs-bdc-gal-main${bad === main ? ' bad' : ''}`} src={main} alt="" title="Bấm để xem ảnh lớn" onError={() => setBad(main)} onClick={() => setView(main)} />
              : <span className="qs-bdc-noimg"><QsIcon name="image" size={26} /><i>Chưa có ảnh</i></span>}
            {n > 1 && <button className="qs-bdc-gal-nav prev" title="Ảnh trước (←)" onClick={e => { e.stopPropagation(); go(-1) }}>‹</button>}
            {n > 1 && <button className="qs-bdc-gal-nav next" title="Ảnh sau (→)" onClick={e => { e.stopPropagation(); go(1) }}>›</button>}
            {n > 1 && <span className="qs-bdc-gal-count">{at + 1}/{n}</span>}
            {main && <a className="qs-bd-info-dl" href={safeUrl_(imgs[0])} target="_blank" rel="noopener noreferrer" title="Mở ảnh gốc"><Icon name="download" size={14} /></a>}
          </div>
          {n > 1 && (
            <div className="qs-bdc-gal-thumbs">
              {imgs.map((v, i) => (
                <button key={i} className={`qs-bdc-gal-thumb${i === at ? ' on' : ''}`} title={'Ảnh ' + (i + 1)} onClick={() => setIdx(i)}>
                  <img src={v} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="qs-bd-info-code">{p.ma || p.ten}</div>
        {p.ten && <div className="qs-bd-info-name">{p.ten}</div>}

        {keyItems.length > 0 && (
          <>
            <div className="qs-bd-info-sec">Key Product Info <i>(Thông tin chính)</i></div>
            <div className="qs-bdc-keys">
              {keyItems.map((x, i) => <div key={i} className="qs-bdc-key"><span className="ic"><QsIcon name={x[0]} size={15} /></span><span>{x[1]}</span></div>)}
            </div>
          </>
        )}
        {specMissing && <div className="qs-bdc-err qs-bdc-pdnote">{specErr ? 'Không tải được thông số ngành' : 'Đang tải thông số ngành…'}</div>}
        {blocks.map((b, i) => (
          <div key={i}>
            <div className="qs-bd-info-sec">{b.en}{b.vn ? <> <i>({b.vn})</i></> : null}</div>
            {b.type === 'bullets'
              ? <ul className="qs-bd-info-list">{b.items.map((t, j) => <li key={j}>{t}</li>)}</ul>
              : b.rows.map((r, j) => (r[0] == null
                ? <div key={j} className="qs-bd-info-kv"><b className="qs-bdc-kv-line">{r[1]}</b></div>
                : <div key={j} className="qs-bd-info-kv"><span>{r[0]}</span><b>{r[1]}</b></div>))}
          </div>
        ))}

        <div className="qs-bd-info-sec">Tài liệu <i>({docs.length} file)</i></div>
        {docs.length
          ? <div className="qs-bdc-docs"><DocRows docs={docs} /></div>
          : <div className="qs-bdc-docs-empty">Sản phẩm chưa có tài liệu — thêm ở Nhập dữ liệu hoặc Sửa sản phẩm.</div>}

        <div className="qs-bd-info-price"><span>Đơn giá</span><b>{money(p.donGiaBan)} đ</b></div>

        <PdCombo key={k} product={p} onAdd={onAdd} toast={toast} onDragProduct={onDragProduct} onDragEnd={onDragEnd} />

        <div className="qs-bd-info-actions">
          <button className="qs-modal-btn" onClick={onClose}>Đóng</button>
          {onAdd && <button className="qs-modal-btn primary" onClick={addThis}><Icon name="plus" size={14} />Thêm vào bóc tách</button>}
        </div>
      </div>
      {view && <ImgViewer src={view} gallery={imgs} onClose={() => setView('')} onIndexChange={i => setIdx(i)} />}
    </div>
  )
}

/* Khối "Sản phẩm đi kèm" của SP đang mở: số bộ, SL kèm mỗi dòng (sửa tạm, không lưu), "Thêm combo" */
function PdCombo({ product, onAdd, toast, onDragProduct, onDragEnd }) {
  const k = catCbKey_(product)
  const [st, setSt] = useState({ loading: !!k, list: [], error: '' })
  const [bo, setBo] = useState(1)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!k) return undefined
    const ctl = new AbortController()
    api.getCombo(k, ctl.signal).then(list => {
      list = list || []
      putCombo(k, list)
      setSt({ loading: false, list: list.map(x => ({ ...x })), error: '' })
    }, e => {
      if (ctl.signal.aborted || (e && e.name === 'QsAbortError')) return
      setSt({ loading: false, list: [], error: (e && e.message) || 'lỗi' })
    })
    return () => ctl.abort()
  }, [k])

  if (st.error) return <div className="qs-bdc-err qs-bdc-pdnote">Không tải được sản phẩm đi kèm: {st.error}</div>
  const list = st.list
  if (!list.length) return null
  const boN = Math.max(1, Math.min(999, Number(bo) || 1))
  const tong = list.reduce((a, x) => a + (Number(x.donGiaBan) || 0) * (Number(x.comboSL) || 1) * boN, 0)
  const setBoTo = v => setBo(Math.max(1, Math.min(999, Math.round(Number(String(v).replace(',', '.')) || 0) || 1)))
  const setSl = (j, v) => setSt(s => ({
    ...s,
    list: s.list.map((x, i) => (i === j ? { ...x, comboSL: Math.max(1, Math.min(9999, Math.round(Number(String(v).replace(',', '.')) || 0) || 1)) } : x)),
  }))

  async function addAll() {
    if (busy) return
    setBusy(true)
    try {
      await onAdd(product, { sl: boN })
      for (const x of list) await onAdd(x, { sl: (Number(x.comboSL) || 1) * boN })
      toast('Đã thêm ' + (boN > 1 ? boN + ' bộ combo' : 'combo') + ': sản phẩm chính + ' + list.length + ' sản phẩm đi kèm')
    } finally { setBusy(false) }
  }

  return (
    <div className="qs-bdc-pcb">
      <div className="qs-bdc-pcb-h"><span className="t"><Icon name="layers" size={14} /> Sản phẩm đi kèm</span><span className="n">{list.length}</span></div>
      <div className="qs-bdc-pcb-list">
        {list.map((x, j) => {
          const sl = Number(x.comboSL) || 1
          const dg = Number(x.donGiaBan) || 0
          const slTong = sl * boN
          return (
            <div key={j} className="qs-bdc-pcb-r" title={x.comboNguoc ? 'Liên kết đặt từ phía sản phẩm kia — đi kèm 2 chiều' : undefined}
              draggable={!!onDragProduct}
              onDragStart={onDragProduct ? e => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', String(x.recordId || x.ma || '')); onDragProduct(x, sl) } : undefined}
              onDragEnd={onDragProduct ? () => onDragEnd && onDragEnd() : undefined}>
              <ProductThumb product={x} size={34} src={x.hinhAnh ? mediaUrl(String(x.hinhAnh).split('\n')[0].trim()) : ''} />
              <div className="qs-bdc-pcb-m">
                <b>{x.ten || ''}{x.comboNguoc && <span className="rev"> ↔</span>}</b>
                <span>{x.ma || ''}{x.ma ? ' · ' : ''}{money(dg)} đ</span>
                {String(x.comboGhiChu || '').trim() && (
                  <span className="qs-bdc-ccr-gc" title="Ghi chú của sản phẩm đi kèm">Ghi chú: {String(x.comboGhiChu).trim()}</span>
                )}
              </div>
              <div className="qs-bdc-pcb-p">
                <b>{money(dg * slTong)} đ</b>
                <label title="Số lượng đi kèm cho MỖI bộ">SL <NumIn value={sl} onClick={e => e.stopPropagation()} onCommit={v => setSl(j, v)} />
                  {boN > 1 && <em>× {boN} = {slTong}</em>}</label>
              </div>
            </div>
          )
        })}
      </div>
      <div className="qs-bdc-pcb-tot"><span>Tổng {boN > 1 ? boN + ' bộ' : 'combo'}</span><b>{money(tong)} đ</b></div>
      {onAdd && (
        <div className="qs-bdc-pcb-ft">
          <span className="qs-bdc-pcb-bo" title="Số bộ combo cần thêm"><label>Số bộ</label>
            <button onClick={() => setBoTo(boN - 1)} aria-label="Bớt 1 bộ">−</button>
            <NumIn value={boN} onCommit={setBoTo} />
            <button onClick={() => setBoTo(boN + 1)} aria-label="Thêm 1 bộ">+</button></span>
          <button className="qs-modal-btn primary" disabled={busy} title="Thêm sản phẩm chính và toàn bộ sản phẩm đi kèm vào bóc tách" onClick={addAll}>
            <Icon name="plus" size={14} />Thêm {boN > 1 ? boN + ' bộ' : 'combo'}
          </button>
        </div>
      )}
    </div>
  )
}
