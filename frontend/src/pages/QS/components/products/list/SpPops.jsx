import { useEffect, useRef, useState } from 'react'
import QsIcon from '../../common/QsIcon'
import FloatPop from './FloatPop'
import { TREE } from '../../../lib/tree.js'
import { pad2, spNorm_ } from '../../../lib/format.js'
import { ctColor } from '../../../lib/catalogFilters.js'
import { csPresetList_, csPresetKeys_, csPresetOn_ } from '../../../lib/columns.js'
import { spOptList_, spSingleVals_, spSpecOpts_ } from './spModel'

/* Các bảng nổi của tab Danh sách SP (port PUB/sanpham.js): chọn hạng mục spCatToggle (989-998), Bộ lọc spBoLocPop_ (1061-1115),
   chọn nhanh bộ cột csPresetPop_ (app.js:1747-1782), Sửa hàng loạt spBulkEditPop_ (1724-1741), "⋯" spBulkMorePop_ (1750-1769),
   menu Sao chép spCopyMenu_ (2164-2177). Mỗi bảng đặt trong .qs-mroot qua FloatPop. */

/* Cây hạng mục: "Tất cả hạng mục" + TREE (trừ X), số SP của từng hạng mục. count(code) do người gọi tính (spNodeCount_) */
export function CatPop({ anchor, node, total, count, onPick, onClose }) {
  return (
    <FloatPop anchor={anchor} place="below-left" onClose={onClose} className="qspl-tree">
      <div className={`qspl-tn lvl1${!node ? ' on' : ''}`} onClick={() => onPick('')}>
        <span className="nm">Tất cả hạng mục</span><span className="cn">[{pad2(total)}]</span><span className="rd" />
      </div>
      {TREE.filter(t => t[0] !== 'X').map(t => (
        <div key={t[0]} className={`qspl-tn lvl${t[2]}${node === t[0] ? ' on' : ''}`} onClick={() => onPick(t[0])}>
          <span className="nm">{t[0] + '.' + t[1]}</span><span className="cn">[{pad2(count(t[0]))}]</span><span className="rd" />
        </div>
      ))}
    </FloatPop>
  )
}

/* Bộ lọc: 3 ô chọn (thương hiệu / hạng mục SP / dòng SP), chọn nhiều thương hiệu / NCC (có ô tìm khi > 8),
   công suất · nhiệt độ màu · góc chiếu · CRI, khoảng giá. Phạm vi = SP thuộc hạng mục đang lọc (scope). */
export function FilterPop({ anchor, scope, f, fltQ, onSel, onSpec, onNhieuXoa, onTim, onPrice, onReset, onClose }) {
  function fsel(key, lb, field, ph) {
    const opts = spOptList_(scope, field), cur = f[key] || ''
    const v = opts.filter(o => spNorm_(o) === spNorm_(cur))[0] || ''
    return (
      <div className="qspl-fcol"><label>{lb}</label>
        <select className="qspl-fsel" value={v} onChange={e => onSel(key, e.target.value)}>
          <option value="">{ph}</option>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    )
  }
  function multi(title, field, fkey, opt) {
    opt = opt || {}
    const m = spSpecOpts_(scope, field), keys = Object.keys(m)
    if (!keys.length) return null
    keys.sort((a, b) => { const na = parseFloat(a), nb = parseFloat(b); if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb; return a.localeCompare(b) })
    const o = f[fkey] || {}
    return (
      <div className="qspl-fgrp"><div className="qspl-fgt">{title}</div><div className="qspl-fchips">
        {keys.map(k => (
          <span key={k} className={`qspl-chip sm${o[k] ? ' on' : ''}`} onClick={() => onSpec(fkey, k)}>
            {opt.dot && <i className="qspl-cdot" style={{ background: opt.dot(k) }} />}{k}
          </span>
        ))}
      </div></div>
    )
  }
  function nhieu(title, field, fkey, ph) {
    const m = spSingleVals_(scope, field), keys = Object.keys(m)
    if (!keys.length) return null
    keys.sort((a, b) => a.localeCompare(b, 'vi'))
    const o = f[fkey] || {}, daChon = keys.filter(k => o[k]).length
    const q = spNorm_(fltQ[fkey] || '')
    return (
      <div className="qspl-fgrp">
        <div className="qspl-fgt">{title}
          {daChon > 0 && <><span className="qspl-fgt-n">{daChon} đã chọn</span><button type="button" className="qspl-fgt-x" onClick={() => onNhieuXoa(fkey)}>Bỏ chọn</button></>}
        </div>
        {keys.length > 8 && <input className="qspl-fsearch" placeholder={ph || 'Gõ để tìm…'} value={fltQ[fkey] || ''} onChange={e => onTim(fkey, e.target.value)} />}
        <div className="qspl-fchips">
          {keys.filter(k => !q || spNorm_(k).indexOf(q) >= 0).slice(0, 60).map(k => (
            <span key={k} className={`qspl-chip sm${o[k] ? ' on' : ''}`} onClick={() => onSpec(fkey, k)}>{k}<i>{m[k]}</i></span>
          ))}
        </div>
      </div>
    )
  }
  return (
    <FloatPop anchor={anchor} place="below-right" onClose={onClose} className="qspl-flt" deps={[scope.length]}>
      <div className="qspl-fhdr">Bộ lọc</div>
      <div className="qspl-fgrp qspl-fgrp-sel">
        {fsel('brand', 'Thương hiệu', 'thuongHieu', 'Tất cả thương hiệu')}
        {fsel('hangMuc', 'Hạng mục sản phẩm', 'hangMuc', 'Tất cả hạng mục SP')}
        {fsel('dong', 'Dòng sản phẩm', 'nhom', 'Tất cả dòng SP')}
      </div>
      {nhieu('Thương hiệu', 'thuongHieu', 'brands', 'Gõ tên thương hiệu…')}
      {nhieu('Nhà cung cấp / nhà phân phối', 'ncc', 'nccs', 'Gõ tên nhà cung cấp…')}
      {multi('Công suất', 'congSuat', 'watt')}
      {multi('Nhiệt độ màu', 'nhietDo', 'kelvin', { dot: ctColor })}
      {multi('Góc chiếu', 'gocChieu', 'angle')}
      {multi('CRI', 'cri', 'cri')}
      <div className="qspl-fgrp"><div className="qspl-fgt">Khoảng giá (đ)</div><div className="qspl-fprice">
        <input type="number" placeholder="Từ" value={f.min || ''} onChange={e => onPrice('min', e.target.value)} />
        <span>–</span>
        <input type="number" placeholder="Đến" value={f.max || ''} onChange={e => onPrice('max', e.target.value)} />
      </div></div>
      <div className="qspl-fftr">
        <button type="button" className="qsc-btn" onClick={onReset}>Xóa lọc</button>
        <button type="button" className="qsc-btn blue" onClick={onClose}>Xong</button>
      </div>
    </FloatPop>
  )
}

/* Chọn nhanh bộ cột: "Của tôi" (lưu theo tài khoản) + các bộ dựng sẵn khớp bảng SP */
export function PresetPop({ anchor, tab, on, mine, mineOn, username, onPreset, onMine, onSaveMine, onClearMine, onClose }) {
  const dem = tab.keys().filter(k => !!on[k]).length
  return (
    <FloatPop anchor={anchor} place="below-left" onClose={onClose} className="qspl-preset">
      <div className="qspl-bgt-h"><b>Chọn nhanh cột</b><button type="button" className="qspl-x" onClick={onClose}>✕</button></div>
      <div className="qspl-bgt-b">
        {mine && (
          <div className={`qspl-bgt-i mine${mineOn ? ' on' : ''}`} onClick={onMine}>
            <span className="nm"><QsIcon name="check" size={13} /> Của tôi <i className="u">{username}</i></span>
            <span className="cn">{mine.length} cột</span><span className={`rd${mineOn ? ' on' : ''}`} />
          </div>
        )}
        {csPresetList_(tab).map(ps => {
          const act = csPresetOn_(tab, ps, on)
          return (
            <div key={ps[0]} className={`qspl-bgt-i${act ? ' on' : ''}`} onClick={() => onPreset(ps)}>
              <span className="nm">{ps[1]}</span><span className="cn">{csPresetKeys_(tab, ps).length} cột</span><span className={`rd${act ? ' on' : ''}`} />
            </div>
          )
        })}
      </div>
      <div className="qspl-mine-f">
        <button type="button" className="qsc-btn blue" disabled={mineOn} title={mineOn ? 'Bộ cột đang hiện đã là bộ của bạn' : undefined} onClick={onSaveMine}>
          <QsIcon name="check" size={13} /> Lưu {dem} cột đang hiện làm mặc định của tôi
        </button>
        {mine && <button type="button" className="qsc-btn" onClick={onClearMine}>Xoá bộ của tôi</button>}
        <div className="qspl-mine-n">Lưu theo tài khoản — lần sau đăng nhập (kể cả máy khác) tự hiện đúng các cột này.</div>
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
