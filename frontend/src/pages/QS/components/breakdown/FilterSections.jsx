import { chipGroupVals_, ctColor, brandOptions, comboCounts_, favCount_, FLT_REG, fltHien_, fltPinned_ } from '../../lib/catalogFilters.js'
import { useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import { setF, toggleFsec, toggleIn } from './catalog/filterStore'
import { useFltOrder, useModFold, sortFlt, moveFlt, modOf, modTitle } from './catalog/fltOrder'
import ModHead from './catalog/ModHead'

/* Các khối lọc đang hiện trên panel danh mục (port renderFilters / chipGroup / renderVsFilters_ / favChips_ / comboChips_ /
   fltApplyPins_, PUB/app.js:476-664, 913-964). Props:
     st       trạng thái lọc (catalog/filterStore)
     node     đề mục đang bóc
     products danh mục đầy đủ (chip đèn, thương hiệu, combo, yêu thích đếm trên toàn bộ danh mục như bản gốc)
     vsModel  kết quả vsFilterModel_ (null khi đề mục không có spec riêng)
     hideDen  ẩn Công suất / Nhiệt độ / Góc chiếu (đề mục có thư viện công tác, app.js:1022)
     favMode  bảng mở bằng nút trái tim: hiện module Yêu thích (đứng đầu); ngoài ra Yêu thích chỉ hiện khi đang lọc yêu thích
     lead     module dựng sẵn ở CatalogPanel [{id, title, cls, body}] (Khối hiển thị / Đang lọc / Phạm vi sản phẩm):
              xếp + kéo thả chung một danh sách với các module khối lọc
   Các khối gom thành module (catalog/fltOrder FLT_MODS: Thông số ngành / Thương hiệu & giá / Thông số đèn / Combo / Yêu thích),
   mỗi module một khung; kéo tay nắm ⋮⋮ ở đầu module lên / xuống để đổi chỗ module. */
const DEN = {
  watt: { field: 'congSuat', map: 'fWatt', wide: true },
  kelvin: { field: 'nhietDo', map: 'fKelvin', dot: true },
  angle: { field: 'gocChieu', map: 'fAngle' },
}

export default function FilterSections({ st, node, products, vsModel, hideDen, favMode, lead }) {
  const order = useFltOrder()
  const modFold = useModFold()
  const [drag, setDrag] = useState(null)   // id module đang kéo
  const [over, setOver] = useState(null)   // {key, after}: chỗ thả (trước / sau module key)
  const out = []        // dòng báo đứng đầu (lỗi thông số)
  const secs = {}       // khoá -> khối
  const keys = []       // khoá các khối đang hiện, thứ tự mặc định
  const tail = []       // dòng gợi ý đứng cuối
  const endDrag = () => { setDrag(null); setOver(null) }

  function sec(foldKey, title, badge, body) {
    const open = st.fsecOpen[foldKey] !== false
    keys.push(foldKey)
    secs[foldKey] = (
      <div key={foldKey} className={`qs-bd-fsec${open ? '' : ' closed'}`}>
        <button className="qs-bd-fsec-head" onClick={() => toggleFsec(foldKey)}>
          <span>{title}{badge ? <em className="qs-bdc-fn">{badge}</em> : null}</span>
          <span className={`qs-bd-fsec-tg${open ? '' : ' closed'}`} aria-hidden="true"><Icon name="chevronUp" size={14} /></span>
        </button>
        {body}
      </div>
    )
  }
  const none = <div className="qs-bd-fchips"><span className="qs-bdc-nil">—</span></div>

  /* Ngành có spec (vệ sinh / sơn / công tắc): khối Hạng mục + thông số dạng chọn của hạng mục */
  if (vsModel) {
    if (vsModel.noSpec) out.push(<p key="nospec" className="qs-bd-hint qs-bdc-err">Không tải được thông số ngành</p>)
    vsModel.sections.forEach(s => {
      if (!fltHien_(st.fltShow, 'vs_' + s.key)) return
      const chips = s.chips.length ? (
        <div className="qs-bd-fchips">
          {s.chips.map(c => (
            <button key={c.v} className={`qs-bd-fchip${c.on ? ' on' : ''}`}
              onClick={() => (c.c === '__hm' ? toggleIn('fNhomSet', c.v) : setF(f => {
                const o = { ...(f.fVs[c.c] || {}) }
                if (o[c.v]) delete o[c.v]; else o[c.v] = 1
                return { fVs: { ...f.fVs, [c.c]: o } }
              }))}>
              {c.v}<small>{c.n}</small>
            </button>
          ))}
        </div>
      ) : none
      sec('vs_' + s.key, s.title, s.selN ? s.selN + ' đã chọn' : '', chips)
    })
    if (vsModel.note) tail.push(<p key="note" className="qs-bd-hint in-list">Chọn 1 hạng mục để lọc theo thông số riêng của hạng mục đó.</p>)
  }

  /* Khối cố định theo thứ tự FLT_REG (fltApplyPins_) */
  FLT_REG.forEach(([k, title]) => {
    if (k === 'yeuthich') { if (!favMode && !st.fFav) return } else if (!fltPinned_(st.fltShow, k, node)) return
    const den = DEN[k]
    if (den) {
      if (hideDen) return
      const g = chipGroupVals_(products, den.field, st[den.map])
      sec(k, title, g.badge, g.all.length ? (
        <div className={`qs-bd-fchips${den.wide ? ' qs-bdc-eq' : ''}`}>
          {g.all.map(v => (
            <button key={v} title={v} className={`qs-bd-fchip${den.wide ? ' qs-bdc-wide' : ''}${st[den.map][v] ? ' on' : ''}`} onClick={() => toggleIn(den.map, v)}>
              {den.dot && <span className="qs-bdc-dot" style={{ background: ctColor(v) }} />}{v}
            </button>
          ))}
        </div>
      ) : none)
    } else if (k === 'yeuthich') {
      sec(k, title, st.fFav ? '1' : '', (
        <div className="qs-bd-fchips">
          <button className={`qs-bd-fchip${st.fFav ? ' on' : ''}`} onClick={() => setF(f => ({ fFav: !f.fFav }))}>
            ★ Chỉ sản phẩm yêu thích<small>{favCount_(products)}</small>
          </button>
        </div>
      ))
    } else if (k === 'combo') {
      const n = comboCounts_(products)
      /* chọn 1 trong 3 (fCombo: '' = tất cả, 'co', 'khong'), chip viên cùng dáng hàng "Khối hiển thị" (.qs-bd-pop-chip) */
      sec(k, title, st.fCombo ? '1' : '', (
        <div className="qs-bd-pop-chips qs-bd-combo" role="radiogroup" aria-label="Lọc theo combo">
          {[['', 'Tất cả', n.co + n.khong], ['co', 'Sản phẩm có combo', n.co], ['khong', 'Sản phẩm không combo', n.khong]].map(([v, lb, c]) => {
            const on = (st.fCombo || '') === v
            return (
              <button key={v || 'all'} type="button" role="radio" aria-checked={on} className={`qs-bd-pop-chip${on ? ' on' : ''}`}
                onClick={() => setF({ fCombo: v })}>
                {on && <Icon name="check" size={12} stroke={2.6} />}{lb}<small>{c}</small>
              </button>
            )
          })}
        </div>
      ))
    } else if (k === 'brand') {
      sec(k, title, '', (
        <div className="qs-bd-fbrand">
          <select value={st.fBrand} onChange={e => setF({ fBrand: e.target.value })}>
            <option value="">Tất cả thương hiệu</option>
            {brandOptions(products).map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <span className="qs-bd-acc-plus"><Icon name="plus" size={10} stroke={3} /></span>
        </div>
      ))
    } else if (k === 'price') {
      sec(k, title, '', (
        <div className="qs-bd-fprice">
          <span>Giá từ</span>
          <input type="number" value={st.min} onChange={e => setF({ min: e.target.value })} />
          <span>Tới</span>
          <input type="number" value={st.max} onChange={e => setF({ max: e.target.value })} />
        </div>
      ))
    }
  })
  /* Module: module đầu bảng (lead) + khối gom theo FLT_MODS; xếp theo thứ tự đã kéo, mở bằng trái tim thì Yêu thích đứng đầu */
  const own = []
  keys.forEach(k => { const m = modOf(k); if (own.indexOf(m) < 0) own.push(m) })
  const items = (lead || []).filter(Boolean).concat(own.map(id => {
    const ks = keys.filter(k => modOf(k) === id)
    /* module chỉ 1 khối (Combo, Yêu thích): ẩn tiêu đề khối bên trong (CSS .single), thu / mở bằng nút của module */
    return { id, title: modTitle(id) || 'Khác', cls: ks.length === 1 ? 'single' : '', body: ks.map(k => secs[k]) }
  }))
  const ids = items.map(m => m.id)
  let ordered = sortFlt(ids, order)
  if (favMode && ordered.indexOf('fav') > 0) ordered = ['fav'].concat(ordered.filter(m => m !== 'fav'))
  const modEls = ordered.map(id => {
    const m = items.find(x => x.id === id)
    const drop = over && over.key === id ? (over.after ? ' drop-after' : ' drop-before') : ''
    return (
      <div key={'m_' + id} className={`qs-bd-mod${m.cls ? ' ' + m.cls : ''}${modFold[id] ? ' folded' : ''}${drag === id ? ' dragging' : ''}${drop}${favMode && id === 'fav' ? ' hl' : ''}`}
        onDragOver={e => {
          if (!drag || drag === id) return
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          const after = e.clientY > r.top + r.height / 2
          if (!over || over.key !== id || over.after !== after) setOver({ key: id, after })
        }}
        onDrop={e => { e.preventDefault(); if (drag && over) moveFlt(ids, drag, over.key, over.after); endDrag() }}>
        <ModHead id={id} title={m.title} grip={(
          <span className="qs-bd-fsec-grip" draggable title="Kéo lên / xuống để đổi vị trí module"
            onDragStart={e => {
              setDrag(id)
              e.dataTransfer.effectAllowed = 'move'
              try { e.dataTransfer.setData('text/plain', id) } catch (err) { /* bỏ qua */ }
              const box = e.currentTarget.closest('.qs-bd-mod')
              if (box) e.dataTransfer.setDragImage(box, 16, 16)
            }}
            onDragEnd={endDrag}>
            <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true"><circle cx="2.5" cy="2.5" r="1.3" /><circle cx="7.5" cy="2.5" r="1.3" /><circle cx="2.5" cy="7" r="1.3" /><circle cx="7.5" cy="7" r="1.3" /><circle cx="2.5" cy="11.5" r="1.3" /><circle cx="7.5" cy="11.5" r="1.3" /></svg>
          </span>
        )} />
        {m.body}
      </div>
    )
  })
  return out.concat(modEls, tail)
}
