import { useEffect, useRef, useState } from 'react'
import QsIcon from '../../common/QsIcon'
import FloatPop from './FloatPop'
import { TREE } from '../../../lib/tree.js'
import { pad2, spNorm_ } from '../../../lib/format.js'
import { ctColor } from '../../../lib/catalogFilters.js'
import { csPresetList_, csPresetKeys_, csPresetOn_ } from '../../../lib/columns.js'
import { spOptList_, spSingleVals_, spSpecOpts_, lsJson, lsSet } from './spModel'

/* Các bảng nổi của tab Danh sách SP (port PUB/sanpham.js): chọn hạng mục spCatToggle (989-998), Bộ lọc spBoLocPop_ (1061-1115, nay là bảng neo trong khung, không qua FloatPop),
   chọn nhanh bộ cột csPresetPop_ (app.js:1747-1782), Sửa hàng loạt spBulkEditPop_ (1724-1741), "⋯" spBulkMorePop_ (1750-1769),
   menu Sao chép spCopyMenu_ (2164-2177). Mỗi bảng đặt trong .qs-mroot qua FloatPop. */

/* Cây hạng mục: "Tất cả hạng mục" + TREE (trừ X), số SP của từng hạng mục. count(code) do người gọi tính (spNodeCount_) */
/* Chọn hạng mục. dock (băng xanh, không phải Phần thô): bảng lớn phủ cả cột panel trái, từ dưới băng tới đáy (top = ngay dưới băng);
   không dock: popup nhỏ dưới nút như cũ */
export function CatPop({ anchor, node, total, count, onPick, onClose, dock, top }) {
  const items = (
    <>
      <div className={`qspl-tn lvl1${!node ? ' on' : ''}`} onClick={() => onPick('')}>
        <span className="nm">Tất cả hạng mục</span><span className="cn">[{pad2(total)}]</span><span className="rd" />
      </div>
      {TREE.filter(t => t[0] !== 'X').map(t => (
        <div key={t[0]} className={`qspl-tn lvl${t[2]}${node === t[0] ? ' on' : ''}`} title={t[0] + '.' + t[1]} onClick={() => onPick(t[0])}>
          <span className="nm">{t[0] + '.' + t[1]}</span><span className="cn">[{pad2(count(t[0]))}]</span><span className="rd" />
        </div>
      ))}
    </>
  )
  if (dock) return <DockPanel title="Chọn hạng mục" className="qspl-catdock" anchor={anchor} top={top} onClose={onClose}>{items}</DockPanel>
  return <FloatPop anchor={anchor} place="below-left" onClose={onClose} className="qspl-tree">{items}</FloatPop>
}

/* Bộ lọc: 3 ô chọn (thương hiệu / hạng mục SP / dòng SP), chọn nhiều thương hiệu / NCC (có ô tìm khi > 8),
   công suất · nhiệt độ màu · góc chiếu · CRI, khoảng giá. Phạm vi = SP thuộc hạng mục đang lọc (scope). */
/* Bảng neo bên phải panel "Sản phẩm trong dự án", đè lên phần đầu bảng (như bảng Bộ lọc / Chọn nhanh cột của Bóc tách, .qs-bd-pop):
   khung + tiêu đề + nút đóng, thân cuộn, chân (foot). ProductList đặt nó trong .qspl-main; top = ngay dưới thanh công cụ.
   Bấm ra ngoài (trừ nút mở và popup trong .qs-mroot) hoặc Esc thì đóng. */
function DockPanel({ title, anchor, top, onClose, foot, children, className = '', keep, headBtns }) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const down = e => {
      const t = e.target
      if (ref.current && ref.current.contains(t)) return
      if (anchor && anchor.contains && anchor.contains(t)) return
      if (t && t.closest && t.closest('.qs-mroot')) return
      if (keep && t && t.closest && t.closest(keep)) return     // vùng đi kèm (vd. dải chip cột của bảng Chọn nhanh cột)
      if (closeRef.current) closeRef.current()
    }
    const key = e => { if (e.key === 'Escape' && closeRef.current) closeRef.current() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [anchor])
  return (
    <div className={'qspl-fdock ' + className} ref={ref} style={top != null ? { top } : undefined}>
      <div className="qspl-fdock-head"><span>{title}</span>{headBtns}<button type="button" className="qspl-fdock-x" title="Đóng" onClick={onClose}><QsIcon name="close" size={18} /></button></div>
      <div className="qspl-fdock-body">{children}</div>
      {foot && <div className="qspl-fdock-foot">{foot}</div>}
    </div>
  )
}

/* Bộ lọc (DockPanel), cùng giao diện bảng Bộ lọc của Bóc tách (FilterSections / FltChips / ModHead; lớp .qs-bd-mod / .qs-bd-fsec /
   .qs-bd-fchip của QS.css): các module khung trắng trên nền xám, đầu module có tay nắm ⋮⋮ (kéo đổi thứ tự) + nút ⌃ thu gọn;
   module "Khối hiển thị" bật / tắt từng khối lọc; tiêu đề khối "Công suất · 30", bấm để thu / mở; lựa chọn là lưới ô đều.
   Nhớ theo máy: thứ tự module (qs_spflt_order), khối đang hiện (qs_spflt_show), module thu gọn (qs_spflt_modfold) */
const FLT_SHOW = [['brands', 'Thương hiệu'], ['nccs', 'Nhà cung cấp'], ['price', 'Khoảng giá'], ['watt', 'Công suất'], ['kelvin', 'Nhiệt độ màu'], ['angle', 'Góc chiếu sáng'], ['cri', 'CRI']]
const FLT_MODS = ['show', 'scope', 'brand', 'spec']
const CHEV = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6" /></svg>
const GRIP = <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true"><circle cx="2.5" cy="2.5" r="1.3" /><circle cx="7.5" cy="2.5" r="1.3" /><circle cx="2.5" cy="7" r="1.3" /><circle cx="7.5" cy="7" r="1.3" /><circle cx="2.5" cy="11.5" r="1.3" /><circle cx="7.5" cy="11.5" r="1.3" /></svg>

export function FilterPop({ anchor, top, scope, f, fltQ, onSel, onSpec, onNhieuXoa, onTim, onPrice, onReset, onClose }) {
  const [order, setOrderSt] = useState(() => { const o = lsJson('qs_spflt_order', null); return Array.isArray(o) && FLT_MODS.every(k => o.includes(k)) ? o : FLT_MODS })
  const [show, setShowSt] = useState(() => ({ brands: 1, nccs: 1, price: 1, watt: 1, kelvin: 1, angle: 1, cri: 1, ...lsJson('qs_spflt_show', {}) }))
  const [modFold, setModFoldSt] = useState(() => lsJson('qs_spflt_modfold', { scope: true }))
  const [secFold, setSecFold] = useState({})
  const [drag, setDrag] = useState(null)
  const [over, setOver] = useState(null)     // {k, after}
  const setOrder = v => { setOrderSt(v); lsSet('qs_spflt_order', JSON.stringify(v)) }
  const togShow = k => setShowSt(s0 => { const n = { ...s0, [k]: s0[k] ? 0 : 1 }; lsSet('qs_spflt_show', JSON.stringify(n)); return n })
  const togMod = k => setModFoldSt(s0 => { const n = { ...s0, [k]: !s0[k] }; lsSet('qs_spflt_modfold', JSON.stringify(n)); return n })
  const togSec = k => setSecFold(s0 => ({ ...s0, [k]: !s0[k] }))

  function sec(k, title, cnt, nOn, body, extra) {
    const open = !secFold[k]
    return (
      <div key={k} className={`qs-bd-fsec${open ? '' : ' closed'}`}>
        <button type="button" className="qs-bd-fsec-head" onClick={() => togSec(k)}>
          <span>{title}{cnt ? <em className="qs-bdc-fn">· {cnt}</em> : null}{nOn ? <em className="qs-bdc-fnn" title={nOn + ' đang chọn'}>{nOn}</em> : null}</span>
          <span className={`qs-bd-fsec-tg${open ? '' : ' closed'}`} aria-hidden="true">{CHEV}</span>
        </button>
        {open && extra}
        {body}
      </div>
    )
  }
  function fsel(key, lb, field, ph) {
    const opts = spOptList_(scope, field), cur = f[key] || ''
    const v = opts.filter(o => spNorm_(o) === spNorm_(cur))[0] || ''
    return (
      <label className="qspl-fcol2" key={key}><span>{lb}</span>
        <select className="qspl-fsel" value={v} onChange={e => onSel(key, e.target.value)}>
          <option value="">{ph}</option>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    )
  }
  function multi(title, field, fkey, opt) {
    if (!show[fkey]) return null
    opt = opt || {}
    const m = spSpecOpts_(scope, field), keys = Object.keys(m)
    if (!keys.length) return null
    keys.sort((x, y) => { const na = parseFloat(x), nb = parseFloat(y); if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb; return x.localeCompare(y) })
    const o = f[fkey] || {}
    return sec(fkey, title, keys.length, keys.filter(k => o[k]).length, (
      <div className="qs-bd-fchips">
        {keys.map(k => (
          <button type="button" key={k} title={k} className={`qs-bd-fchip${o[k] ? ' on' : ''}`} onClick={() => onSpec(fkey, k)}>
            {opt.dot && <span className="qs-bdc-dot" style={{ background: opt.dot(k) }} />}{k}
          </button>
        ))}
      </div>
    ))
  }
  function nhieu(title, field, fkey, ph) {
    if (!show[fkey]) return null
    const m = spSingleVals_(scope, field), keys = Object.keys(m)
    if (!keys.length) return null
    keys.sort((x, y) => x.localeCompare(y, 'vi'))
    const o = f[fkey] || {}, daChon = keys.filter(k => o[k]).length
    const q = spNorm_(fltQ[fkey] || '')
    const extra = (
      <>
        {daChon > 0 && <button type="button" className="qspl-fgt-x qspl-fclear" onClick={() => onNhieuXoa(fkey)}>Bỏ chọn {daChon}</button>}
        {keys.length > 8 && <input className="qspl-fsearch" placeholder={ph || 'Gõ để tìm…'} value={fltQ[fkey] || ''} onChange={e => onTim(fkey, e.target.value)} />}
      </>
    )
    return sec(fkey, title, keys.length, daChon, (
      <div className="qs-bd-fchips qspl-fwide">
        {keys.filter(k => !q || spNorm_(k).indexOf(q) >= 0).slice(0, 60).map(k => (
          <button type="button" key={k} title={k} className={`qs-bd-fchip${o[k] ? ' on' : ''}`} onClick={() => onSpec(fkey, k)}>
            <span className="qspl-fcl">{k}</span><small>{m[k]}</small>
          </button>
        ))}
      </div>
    ), extra)
  }
  const onN = FLT_SHOW.filter(x => show[x[0]]).length
  const MODS = {
    show: {
      title: <>Khối hiển thị <b className="qs-bd-mod-n">{onN}/{FLT_SHOW.length}</b></>, cls: 'qs-bd-mod-chips',
      body: [(
        <div key="c" className="qs-bd-pop-chips" role="group" aria-label="Bật / tắt khối lọc">
          {FLT_SHOW.map(x => {
            const on = !!show[x[0]]
            return (
              <button key={x[0]} type="button" className={`qs-bd-pop-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => togShow(x[0])}>
                <span className="qs-fc-tick" aria-hidden="true">{on && <QsIcon name="check" size={10} stroke={3.2} />}</span>
                <span className="qs-fc-lb">{x[1]}</span>
              </button>
            )
          })}
        </div>
      )],
    },
    scope: {
      title: 'Phạm vi sản phẩm',
      body: [sec('sel', 'Thương hiệu · hạng mục · dòng sản phẩm', 0, ['brand', 'hangMuc', 'dong'].filter(k => f[k]).length, (
        <div className="qspl-fsel3">
          {fsel('brand', 'Thương hiệu', 'thuongHieu', 'Tất cả thương hiệu')}
          {fsel('hangMuc', 'Hạng mục sản phẩm', 'hangMuc', 'Tất cả hạng mục SP')}
          {fsel('dong', 'Dòng sản phẩm', 'nhom', 'Tất cả dòng SP')}
        </div>
      ))],
    },
    brand: {
      title: 'Thương hiệu & giá',
      body: [
        nhieu('Thương hiệu', 'thuongHieu', 'brands', 'Gõ tên thương hiệu…'),
        nhieu('Nhà cung cấp / nhà phân phối', 'ncc', 'nccs', 'Gõ tên nhà cung cấp…'),
        show.price ? sec('price', 'Khoảng giá', 0, (f.min || f.max) ? 1 : 0, (
          <div className="qs-bd-fprice">
            <span>Giá từ</span>
            <input type="number" value={f.min || ''} onChange={e => onPrice('min', e.target.value)} />
            <span>Tới</span>
            <input type="number" value={f.max || ''} onChange={e => onPrice('max', e.target.value)} />
          </div>
        )) : null,
      ],
    },
    spec: {
      title: 'Thông số kỹ thuật',
      body: [
        multi('Công suất', 'congSuat', 'watt'),
        multi('Nhiệt độ màu', 'nhietDo', 'kelvin', { dot: ctColor }),
        multi('Góc chiếu sáng', 'gocChieu', 'angle'),
        multi('CRI', 'cri', 'cri'),
      ],
    },
  }
  function move(from, to, after) {
    if (from === to) return
    const o = order.filter(k => k !== from)
    o.splice(o.indexOf(to) + (after ? 1 : 0), 0, from)
    setOrder(o)
  }
  const endDrag = () => { setDrag(null); setOver(null) }
  return (
    <DockPanel title="Bộ lọc" anchor={anchor} top={top} onClose={onClose} className="qspl-fdock-flt" foot={<>
      <button type="button" className="qsc-btn" onClick={onReset}>Xoá lọc</button>
      <button type="button" className="qsc-btn blue" onClick={onClose}>Xong</button>
    </>}>
      <div className="qs-bd-pop-filters">
        {order.map(id => {
          const m = MODS[id], body = m.body.filter(Boolean)
          if (!body.length) return null
          const closed = !!modFold[id]
          const drop = over && over.k === id ? (over.after ? ' drop-after' : ' drop-before') : ''
          return (
            <div key={id} className={`qs-bd-mod${m.cls ? ' ' + m.cls : ''}${closed ? ' folded' : ''}${drag === id ? ' dragging' : ''}${drop}`}
              onDragOver={e => {
                if (!drag || drag === id) return
                e.preventDefault()
                const r = e.currentTarget.getBoundingClientRect()
                const after = e.clientY > r.top + r.height / 2
                if (!over || over.k !== id || over.after !== after) setOver({ k: id, after })
              }}
              onDrop={e => { e.preventDefault(); if (drag && over) move(drag, over.k, over.after); endDrag() }}>
              <div className="qs-bd-mod-h">
                <span className="qs-bd-fsec-grip" draggable title="Kéo lên / xuống để đổi vị trí module"
                  onDragStart={e => {
                    setDrag(id)
                    e.dataTransfer.effectAllowed = 'move'
                    try { e.dataTransfer.setData('text/plain', id) } catch (err) { /* bỏ qua */ }
                    const box = e.currentTarget.closest('.qs-bd-mod')
                    if (box) e.dataTransfer.setDragImage(box, 16, 16)
                  }}
                  onDragEnd={endDrag}>{GRIP}</span>
                <button type="button" className="qs-bd-mod-tg" aria-expanded={!closed} title={closed ? 'Mở rộng' : 'Thu gọn'} onClick={() => togMod(id)}>
                  <span>{m.title}</span>
                  <span className={`qs-bd-mod-chev${closed ? ' closed' : ''}`} aria-hidden="true">{CHEV}</span>
                </button>
              </div>
              {body}
            </div>
          )
        })}
      </div>
    </DockPanel>
  )
}

/* Chọn nhanh cột (như khung "Chọn nhanh cột" của Bóc tách, breakdown/sheet/ColsTools PresetDock; lớp .qs-tk-bgti / .qs-tk-quicktag):
   "Của tôi" (bộ theo tài khoản) · các bộ dựng sẵn · bộ tự đặt tên (customs, lưu trong máy); thẻ "Mặc định của tôi" trên bộ trùng
   bộ của tôi. Bấm 1 bộ để áp, khung không đóng. Nút bút chì = chế độ sửa: lưu cột đang hiện thành bộ mới / làm mặc định,
   mỗi dòng có nút đặt mặc định · xoá (bộ tự đặt tên, bộ của tôi). */
const sameKeys = (a, b) => a.length === b.length && a.every(k => b.includes(k))
export function PresetPop({ anchor, top, tab, on, mine, mineOn, username, customs, cur, onPreset, onMine, onCustom, onSaveMine, onSetDefault, onClearMine, onNewCustom, onDelCustom, onEditCols, quick, onQuick, onClose }) {
  const [editing, setEditing] = useState(false)
  const dem = tab.keys().filter(k => !!on[k]).length
  // bỏ bộ "Hiện tất cả cột": đã có nút Hiện tất cả ở dải chip
  const presets = csPresetList_(tab).filter(ps => ps[0] !== 'all')
  const customOn = c => tab.keys().every(k => !!on[k] === (c.keys.includes(k) || k === tab.luon))
  /* Nhiều bộ có thể trùng cột (vd. Của tôi = Mặc định): chỉ đánh dấu 1 bộ - bộ vừa bấm (cur) nếu còn khớp, không thì bộ khớp đầu tiên */
  const khop = [...(mine ? [['mine', mineOn]] : []), ...presets.map(ps => [ps[0], csPresetOn_(tab, ps, on)]), ...(customs || []).map(c => ['u:' + c.name, customOn(c)])]
  const onId = (khop.find(x => x[0] === cur && x[1]) || khop.find(x => x[1]) || [])[0]
  const act = (icon, title, fn, cls = '') => (
    <button type="button" className={`qs-tk-bgact${cls}`} title={title} onClick={e => { e.stopPropagation(); fn() }}><QsIcon name={icon} size={13} /></button>
  )
  const defTag = <span className="qs-tk-quicktag def" title="Bộ mặc định của tôi (tự áp khi đăng nhập)"><QsIcon name="check" size={11} /> Mặc định của tôi</span>
  const row = (key, cls, isOn, name, nKeys, click, keys, del, editCols) => {
    const isDef = !!mine && sameKeys(mine, keys)
    return (
      <div key={key} className={`qs-tk-bgti${cls}${isOn ? ' on' : ''}`} onClick={click}>
        <span className="nm">{name}{isDef && key !== 'mine' && defTag}
          {(quick || []).map((q, i) => (q === key ? <span key={i} className="qs-tk-quicktag" title={'Gán vào nút nhanh ' + (i + 1) + ' trên băng'}><QsIcon name="sliders" size={11} /> Nút nhanh {i + 1}</span> : null))}
        </span>
        {editing && (
          <span className="qs-tk-bgacts">
            {editCols && act('edit', 'Sửa các cột của bộ này (mở dải chip)', editCols)}
            {[0, 1].map(i => {
              const on = (quick || [])[i] === key
              return (
                <button type="button" key={'q' + i} className={`qs-tk-bgact qspl-qslot${on ? ' on' : ''}`} title={on ? 'Bỏ gán khỏi nút nhanh ' + (i + 1) : 'Gán vào nút nhanh ' + (i + 1) + ' trên băng'}
                  onClick={e => { e.stopPropagation(); onQuick(i, on ? null : key) }}>{i + 1}</button>
              )
            })}
            {key !== 'mine' && act('check', isDef ? 'Đang là mặc định của tôi' : 'Đặt làm mặc định của tôi', () => { if (!isDef) onSetDefault(keys) }, isDef ? ' on' : '')}
            {del && act('close', 'Xoá bộ cột này', del, ' del')}
          </span>
        )}
        <span className="cn">{nKeys} cột</span><span className={`rd${isOn ? ' on' : ''}`} />
      </div>
    )
  }
  return (
    <DockPanel title={editing ? 'Sửa bộ cột' : 'Chọn nhanh cột'} anchor={anchor} top={top} onClose={onClose} keep=".qspl-colbox, .qspl-colbtn" className={'qspl-coldock' + (editing ? ' editing' : '')}
      headBtns={<button type="button" className={`qspl-fdock-x qspl-dockedit${editing ? ' on' : ''}`} title={editing ? 'Xong sửa' : 'Sửa: lưu bộ mới, đặt mặc định, xoá bộ'} onClick={() => { if (!editing) onEditCols(null); setEditing(e => !e) }}><QsIcon name="edit" size={14} /></button>}
      foot={editing ? (
        <div className="qspl-mine-f">
          <button type="button" className="qsc-btn blue" onClick={onNewCustom}><QsIcon name="plus" size={13} /> Lưu {dem} cột đang hiện thành bộ mới…</button>
          <button type="button" className="qsc-btn" disabled={mineOn} title={mineOn ? 'Bộ cột đang hiện đã là bộ của bạn' : undefined} onClick={onSaveMine}><QsIcon name="check" size={13} /> Làm mặc định của tôi</button>
          <button type="button" className="qsc-btn" onClick={() => setEditing(false)}>Xong</button>
          <div className="qspl-mine-n">Bộ "Của tôi" lưu theo tài khoản (đăng nhập máy khác vẫn có); bộ tự đặt tên và nút nhanh lưu trên máy này, riêng cho từng hạng mục.</div>
        </div>
      ) : null}>
      <div className="qs-tk-bgtb">
        {mine && row('mine', ' tkmine', onId === 'mine', <><QsIcon name="check" size={13} /> Của tôi <i className="qs-tk-mineu">{username}</i></>, mine.length, onMine, mine, editing ? onClearMine : null)}
        {presets.map(ps => {
          const keys = csPresetKeys_(tab, ps)
          return row(ps[0], '', onId === ps[0], ps[1], keys.length, () => onPreset(ps), keys, null)
        })}
        {(customs || []).map(c => (
          row('u:' + c.name, ' tkuser', onId === 'u:' + c.name, c.name, c.keys.length, () => onCustom(c), c.keys, editing ? () => onDelCustom(c.name) : null, () => { onCustom(c); onEditCols(c.name) })
        ))}
      </div>
    </DockPanel>
  )
}

/* "Lưu đè…" của dải chip cột (như Bóc tách): ghi các cột đang bật đè lên bộ "Của tôi" hoặc 1 bộ tự đặt tên */
export function OverPop({ anchor, customs, onPick, onClose }) {
  const pick = name => () => { onClose(); onPick(name) }
  return (
    <FloatPop anchor={anchor} place="below-left" onClose={onClose} className="qspl-overpop">
      <div className="qspl-overpop-h">Lưu đè lên bộ</div>
      <div className="qs-tk-bgtb">
        <div className="qs-tk-bgti tkmine" onClick={pick(null)}><span className="nm"><QsIcon name="check" size={13} /> Của tôi</span><span className="cn">mặc định</span></div>
        {(customs || []).map(c => (
          <div key={c.name} className="qs-tk-bgti" onClick={pick(c.name)}><span className="nm">{c.name}</span><span className="cn">{c.keys.length} cột</span></div>
        ))}
        {!(customs || []).length && <div className="qs-tk-overnote">Chưa có bộ tự đặt — dùng "Tạo mới". Bộ dựng sẵn (Mặc định, Hiện tất cả cột) không ghi đè được.</div>}
      </div>
    </FloatPop>
  )
}

/* Sửa hàng loạt: chọn trường + giá trị mới, Enter = Áp dụng */
export function BulkEditPop({ anchor, fields, n, onApply, onClose, toast }) {
  const [fld, setFld] = useState(fields.length ? fields[0][0] : '')
  const [val, setVal] = useState('')
  const inp = useRef(null)
  useEffect(() => { const t = setTimeout(() => { if (inp.current) inp.current.focus() }, 0); return () => clearTimeout(t) }, [])
  function apply() {
    if (String(val).trim() === '') { toast('Chưa nhập giá trị mới'); if (inp.current) inp.current.focus(); return }
    const f = fields.filter(x => x[0] === fld)[0]
    onClose()
    onApply(fld, val, f ? f[1] : fld)
  }
  return (
    <FloatPop anchor={anchor} place="above-center" onClose={onClose} className="qspl-bbpop">
      <div className="qspl-bbpop-h">Sửa hàng loạt <span>{n} dòng</span></div>
      <div className="qspl-bbpop-b">
        <label>Trường cần đổi</label>
        <select value={fld} onChange={e => setFld(e.target.value)}>
          {fields.map(f => <option key={f[0]} value={f[0]}>{f[1]}</option>)}
        </select>
        <label>Giá trị mới</label>
        <input ref={inp} placeholder="Nhập giá trị…" value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') apply() }} />
      </div>
      <div className="qspl-bbpop-f">
        <button type="button" className="qsc-btn" onClick={onClose}>Huỷ</button>
        <button type="button" className="qsc-btn blue" onClick={apply}><QsIcon name="check" size={14} /> Áp dụng</button>
      </div>
    </FloatPop>
  )
}

/* "⋯" của thanh chọn nhiều: tải Excel các dòng chọn, bỏ duyệt, bỏ yêu thích, xoá (Admin) / gửi yêu cầu xoá (nhân viên) */
export function MorePop({ anchor, n, canDuyet, isAdmin, onXlsx, onUnduyet, onUnfav, onDelete, onClose }) {
  const run = fn => () => { onClose(); fn() }
  return (
    <FloatPop anchor={anchor} place="above-center" onClose={onClose} className="qspl-bbpop qspl-mn">
      <button type="button" onClick={run(onXlsx)}><QsIcon name="download" size={15} /> Tải Excel {n} dòng</button>
      {canDuyet && <button type="button" onClick={run(onUnduyet)}><QsIcon name="close" size={15} /> Bỏ duyệt</button>}
      <button type="button" onClick={run(onUnfav)}><QsIcon name="star" size={15} /> Bỏ yêu thích</button>
      <div className="qspl-mn-sep" />
      <button type="button" className="danger" onClick={run(onDelete)}><QsIcon name="trash" size={15} /> {isAdmin ? 'Xoá sản phẩm' : 'Gửi yêu cầu xoá'}</button>
    </FloatPop>
  )
}

/* Nút sao chép trên dòng: SP mới / biến thể cùng mã / tạo nhanh nhiều biến thể */
export function CopyMenu({ anchor, p, onCopy, onVariant, onQuick, onClose }) {
  const mi = (ic, t, sub, fn) => (
    <div className="qspl-cmi" onClick={() => { onClose(); fn() }}><QsIcon name={ic} size={15} /><span><b>{t}</b><i>{sub}</i></span></div>
  )
  return (
    <FloatPop anchor={anchor} place="menu-right" onClose={onClose} className="qspl-ctx">
      {mi('copy', 'Sao chép thành sản phẩm mới', 'Chép toàn bộ thông tin, ảnh, tài liệu — đổi mã & tên', onCopy)}
      {mi('plus', 'Tạo biến thể', 'Giữ mã ' + (p.ma || '') + ', đổi màu / kích thước / công suất…', onVariant)}
      {mi('layers', 'Tạo nhanh biến thể', 'Nhiều mã / màu / bề mặt một lần, giá riêng', onQuick)}
    </FloatPop>
  )
}

/* Menu của 1 cột (nút phễu ở tiêu đề cột, như bảng Bóc tách): sắp xếp tăng / giảm, bỏ sắp xếp, ẩn cột */
export function ColMenu({ anchor, col, sort, canHide, onSort, onHide, onClose }) {
  const run = fn => () => { onClose(); fn() }
  const on = sort.k === col.k
  return (
    <FloatPop anchor={anchor} place="menu-right" onClose={onClose} className="qspl-bbpop qspl-mn">
      <button type="button" className={on && sort.dir === 'asc' ? 'on' : ''} onClick={run(() => onSort({ k: col.k, dir: 'asc' }))}><QsIcon name="up" size={15} /> Sắp xếp tăng dần</button>
      <button type="button" className={on && sort.dir === 'desc' ? 'on' : ''} onClick={run(() => onSort({ k: col.k, dir: 'desc' }))}><QsIcon name="down" size={15} /> Sắp xếp giảm dần</button>
      {on && <button type="button" onClick={run(() => onSort({ k: '', dir: 'asc' }))}><QsIcon name="close" size={15} /> Bỏ sắp xếp</button>}
      {canHide && <><div className="qspl-mn-sep" /><button type="button" onClick={run(onHide)}><QsIcon name="eye" size={15} /> Ẩn cột "{col.label}"</button></>}
    </FloatPop>
  )
}
