import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import QsIcon from '../../common/QsIcon'
import { mediaUrl } from '../../../api/files'
import { money, ptQty } from '../../../lib/format.js'
import { ctOf_, ptVal_, ptCanEditF_, ptDaCo_ } from '../../../lib/phantho.js'
import { fmtDateTime_ } from '../list/spModel'
import { ptLoaiLabel_, ptLoaiNgan_, ptInfo_ } from './ptCore'
import { ptColW_, ptSelKey_, ptCellEditable_, ptCellVal_, ptAnh1Raw_ } from './ptModel'

/* Bảng công tác của Danh sách SP chế độ 3.1 - CÙNG khung bảng sản phẩm (markup / lớp qspl-* của list/SpTable): ô tích chọn,
   3 cột đầu đóng băng, kéo đổi chỗ / kéo giãn cột, sửa nhanh, hàng nút thao tác, thanh kéo ngang.
   Port spPTCols_ / ptNumCell_ / ptEditCell_ / spRowActions_ nhánh Phần thô / spFilter phần vẽ dòng (PUB/sanpham.js:1166-1208, 1488-1498, 1565-1648).
   Props:
     cols (cột đang hiện {k,label,cls,e}), rows (dòng của trang), no0 (STT bắt đầu - 1), w (độ rộng đã lưu), sel, edit,
     ovr (giá sửa tay), phanTho (bảng khái toán của dự án đang mở, để đánh dấu "đã thêm"), projData, canDuyet, isAdmin,
     on: {move(from, to, before), resize(k, px, done), selAll(on), selToggle(k, on), open(r), fav(r), add(r), duyet(r), editCt(r), del(r),
          nhom(name), save(r, e, raw) -> Promise<bool>} */
const SEL = 38
const SP_FRZ = 3   // số cột dữ liệu đóng băng (như bảng sản phẩm), chưa kể cột chọn
const Dash = () => <span className="qspl-muted">—</span>

export default function PtTable({ cols, rows, no0, w, sel, edit, ovr, phanTho, projData, canDuyet, isAdmin, on }) {
  const [dragCol, setDragCol] = useState(null)
  const [drop, setDrop] = useState(null)
  const [xs, setXs] = useState(false)
  const [ys, setYs] = useState(false)
  const [wrapW, setWrapW] = useState(0)
  const wrapRef = useRef(null), tblRef = useRef(null), barRef = useRef(null)
  const [fk, setFk] = useState(1)
  const [hbW, setHbW] = useState(0)
  const [hbL, setHbL] = useState(0)
  const [hbDrag, setHbDrag] = useState(false)

  /* độ rộng lưu theo chữ 13px của bản gốc; chữ trong QS nhân --fs nên cột chữ nhân cùng hệ số (như SpTable) */
  const cwK = k => (k === 'thumb' ? 1 : fk)
  const cw = k => Math.round(ptColW_(w, k) * cwK(k))
  useLayoutEffect(() => {
    const t = tblRef.current; if (!t) return
    const v = Math.round(((parseFloat(getComputedStyle(t).fontSize) || 13) / 13) * 100) / 100
    if (v > 0 && v !== fk) setFk(v)
    const wr = wrapRef.current
    if (wr && wr.clientWidth !== wrapW) setWrapW(wr.clientWidth)
  })

  function hbSync() {
    const wr = wrapRef.current; if (!wr) return
    const sw = wr.scrollWidth, cwd = wr.clientWidth
    if (sw <= cwd + 1) { setHbW(0); return }
    const bw = barRef.current ? barRef.current.clientWidth : wr.offsetWidth
    const tw = Math.max(48, Math.round(bw * cwd / sw))
    const maxLeft = bw - tw, maxScroll = sw - cwd
    setHbW(tw); setHbL(Math.round(maxScroll ? (wr.scrollLeft / maxScroll) * maxLeft : 0))
  }
  useLayoutEffect(hbSync)
  const zOf = el => ((el && el.offsetWidth) ? (el.getBoundingClientRect().width / el.offsetWidth) || 1 : 1)
  function hbThumbDown(e) {
    e.preventDefault(); e.stopPropagation()
    const wr = wrapRef.current, bar = barRef.current; if (!wr || !bar) return
    const z = zOf(bar), sx = e.clientX, sl = wr.scrollLeft
    const maxLeft = bar.clientWidth - e.currentTarget.offsetWidth, maxScroll = wr.scrollWidth - wr.clientWidth
    setHbDrag(true)
    const mv = ev => { wr.scrollLeft = sl + (maxLeft ? ((ev.clientX - sx) / z) * maxScroll / maxLeft : 0) }
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); setHbDrag(false) }
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up)
  }
  function hbBarDown(e) {
    const wr = wrapRef.current, bar = barRef.current; if (!wr || !bar || !hbW) return
    if (e.target !== bar) return
    const z = zOf(bar), r = bar.getBoundingClientRect(), tw = hbW
    const pos = Math.min(Math.max(0, (e.clientX - r.left) / z - tw / 2), bar.clientWidth - tw)
    const maxScroll = wr.scrollWidth - wr.clientWidth, maxLeft = bar.clientWidth - tw
    wr.scrollLeft = maxLeft ? pos * maxScroll / maxLeft : 0
  }

  let daCot = SEL; cols.forEach(c => { daCot += cw(c.k) })
  const ACT = Math.max(240, (wrapW || 0) - daCot - 2)
  const total = daCot + ACT
  const nFrz = Math.min(SP_FRZ, cols.length)
  const offs = [0]; let left = SEL
  for (let k = 0; k < nFrz; k++) { offs.push(left); left += cw(cols[k].k) }
  const frz = k => (k < nFrz ? { left: offs[k + 1] } : null)
  const frzCls = k => (k < nFrz ? (' qspl-frz' + (k === nFrz - 1 ? ' last' : '')) : '')
  const allOn = rows.length > 0 && rows.every(r => sel[ptSelKey_(r)])
  const ncol = cols.length + 2

  function startResize(e, k) {
    e.preventDefault(); e.stopPropagation()
    const sx = e.clientX, sw = ptColW_(w, k)
    const th = e.currentTarget.closest('th')
    const z = (th && th.offsetWidth ? (th.getBoundingClientRect().width / th.offsetWidth) || 1 : 1) * cwK(k)
    const mv = ev => on.resize(k, Math.max(56, Math.round(sw + (ev.clientX - sx) / z)), false)
    const up = ev => {
      document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up)
      on.resize(k, Math.max(56, Math.round(sw + (ev.clientX - sx) / z)), true)
    }
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up)
  }
  const thCls = c => { const cl = c.cls || ''; if (cl.indexOf('num') >= 0) return 'num'; if (cl.indexOf('ct') >= 0) return 'ct'; if (cl.indexOf('thumbcol') >= 0) return 'thumbcol'; return '' }

  return (
    <>
      <div ref={wrapRef} className={`qspl-tblwrap${xs ? ' xscroll' : ''}${ys ? ' yscroll' : ''}`} data-sp-wrap="1"
        onScroll={e => { const t = e.currentTarget; setXs(t.scrollLeft > 0); setYs(t.scrollTop > 0); hbSync() }}>
        <table ref={tblRef} className="qspl-table qsppt-table" style={{ width: total, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: SEL }} />
            {cols.map(c => <col key={c.k} style={{ width: cw(c.k) }} />)}
            <col style={{ width: ACT }} />
          </colgroup>
          <thead>
            <tr>
              <th className="qspl-selcol qspl-frz" style={{ left: 0 }}>
                <input type="checkbox" className="qspl-ck" checked={allOn} onChange={e => on.selAll(e.target.checked)} />
              </th>
              {cols.map((c, k) => {
                const dcls = drop && drop.k === c.k ? (drop.left ? ' dropL' : ' dropR') : ''
                return (
                  <th key={c.k} className={`${thCls(c)} qspl-th${dragCol === c.k ? ' dragging' : ''}${dcls}${frzCls(k)}`} style={frz(k)}
                    draggable title="Bấm để sắp xếp · kéo để đổi chỗ cột · kéo mép phải để giãn"
                    onDragStart={e => {
                      if (e.target.closest && e.target.closest('.qspl-thrsz')) { e.preventDefault(); return }
                      setDragCol(c.k); try { e.dataTransfer.setData('text/plain', c.k) } catch (x) { /* bỏ qua */ }
                    }}
                    onDragEnd={() => { setDragCol(null); setDrop(null) }}
                    onDragOver={e => {
                      if (!dragCol) return
                      e.preventDefault()
                      const r = e.currentTarget.getBoundingClientRect()
                      const l = e.clientX < r.left + r.width / 2
                      if (!drop || drop.k !== c.k || drop.left !== l) setDrop({ k: c.k, left: l })
                    }}
                    onDrop={e => {
                      if (!dragCol) return
                      e.preventDefault()
                      const r = e.currentTarget.getBoundingClientRect()
                      if (c.k !== dragCol) on.move(dragCol, c.k, e.clientX < r.left + r.width / 2)
                      setDragCol(null); setDrop(null)
                    }}>
                    {/* bảng công tác không sắp xếp (spSort bỏ qua ở Phần thô) */}
                    <span className="thl">{c.label}</span>
                    <span className="qspl-thrsz" onMouseDown={e => startResize(e, c.k)} />
                  </th>
                )
              })}
              <th className="qspl-actcol" />
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((r, i) => {
              const key = ptSelKey_(r), isSel = !!sel[key]
              const da = ptDaCo_(r.sec, r.a, phanTho)
              return (
                // khoá React theo id công tác: sửa Thứ tự làm dòng đổi chỗ (si/ii đổi) mà ô đang sửa vẫn đi theo đúng công tác
                <tr key={(ctOf_(r.a) && ctOf_(r.a).id) || key} className={`qspl-row qsppt-row${da ? ' da' : ''}${isSel ? ' selrow' : ''}${edit ? ' editrow' : ''}`}
                  onClick={edit ? undefined : () => on.open(r)}>
                  <td className="qspl-selcol qspl-frz" style={{ left: 0 }} onClick={e => e.stopPropagation()}>
                    <input type="checkbox" className="qspl-ck" checked={isSel} onChange={e => on.selToggle(key, e.target.checked)} />
                  </td>
                  {cols.map((c, k) => (
                    <td key={c.k} className={`${c.cls}${edit && ptCellEditable_(c, r) ? ' edt' : ''}${frzCls(k)}`} style={frz(k)}>
                      {edit && ptCellEditable_(c, r)
                        ? <PtInp r={r} e={c.e} val={ptCellVal_(r, c.e.f, ovr)} save={on.save} />
                        : <Cell c={c} r={r} i={i} no0={no0} ovr={ovr} da={da} projData={projData} on={on} />}
                    </td>
                  ))}
                  <td className="qspl-actcol" onClick={e => e.stopPropagation()}>
                    <RowActions r={r} da={da} canDuyet={canDuyet} isAdmin={isAdmin} on={on} />
                  </td>
                </tr>
              )
            }) : (
              <tr><td colSpan={ncol}><div className="qspl-empty">Không có công tác nào khớp bộ lọc.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
      {hbW > 0 && (
        <div ref={barRef} className="qspl-hbar" onMouseDown={hbBarDown}>
          <div className={`qspl-hthumb${hbDrag ? ' dragging' : ''}`} style={{ width: hbW, left: hbL }} onMouseDown={hbThumbDown} />
        </div>
      )}
    </>
  )
}

/* ô số: trường không dùng ở kiểu hạng mục này hoặc rỗng -> ô gạch ngang (ptNumCell_) */
function NumCell({ r, f, isMoney, ovr }) {
  if (!ptCanEditF_(r.sec, f)) return <Dash />
  const v = ptVal_(r.sec, r.a, f, ovr)
  if (!v) return <Dash />
  return isMoney ? <>{money(v)}<span className="unit">đ</span></> : ptQty(v)
}

/* Ô ảnh như bản gốc (sanpham.js:1177-1179): không có ảnh -> ô xám trống, ảnh lỗi -> ẩn (onerror visibility:hidden) */
function PtThumb({ ten, src }) {
  const [bad, setBad] = useState('')
  const box = { width: 40, height: 40 }
  if (!src) return <span className="qsc-thumb none qspl-th" style={box} />
  return (
    <span className="qsc-thumb qspl-th" style={bad === src ? { ...box, visibility: 'hidden' } : box}>
      <img src={src} alt={ten || ''} loading="lazy" draggable="false" onError={() => setBad(src)} />
    </span>
  )
}

function Cell({ c, r, i, no0, ovr, da, projData, on }) {
  switch (c.k) {
    case 'stt': return <span className="qspl-stt">{no0 + i + 1}</span>
    case 'thumb': {
      const im = ptAnh1Raw_(r, ctOf_(r.a) ? null : ptInfo_(r.ten, projData))
      return <PtThumb ten={r.ten} src={im ? mediaUrl(im) : ''} />
    }
    case 'duyet': {
      const ct = ctOf_(r.a)
      if (!ct) return <span className="qspl-duyet qsppt-mau" title="Công tác mẫu dựng sẵn trong ứng dụng — nạp vào cơ sở dữ liệu để duyệt / sửa ảnh">Thư viện mẫu</span>
      return (
        <span className={`qspl-duyet${ct.daDuyet ? ' on' : ''}`} title={ct.daDuyet ? ('Duyệt bởi ' + (ct.nguoiDuyet || '?') + (ct.ngayDuyet ? ' · ' + fmtDateTime_(ct.ngayDuyet) : '')) : 'Chưa được duyệt'}>
          {ct.daDuyet ? 'Đã duyệt' : 'Chưa duyệt'}
        </span>
      )
    }
    case 'ten': return (
      <>
        <b>{r.ten}</b>{da && <span className="qsppt-da" title="Đã có trong bảng khái toán của dự án đang chọn">✓ đã thêm</span>}
        <span className="qspl-code qsppt-code">{(r.r ? r.r + '. ' : '') + r.nhom}{r.daSua && <span className="qsppt-sua" title="Đơn giá / thông số đã được sửa lại">Đã sửa</span>}</span>
      </>
    )
    case 'loai': return <span className={'qsppt-tag ' + r.loai} title={ptLoaiLabel_(r.loai)}>{ptLoaiNgan_(r.loai)}</span>
    case 'nhom': return <span className="qsppt-nhom" title="Bấm để chỉ xem hạng mục này" onClick={e => { e.stopPropagation(); on.nhom(r.nhom) }}>{r.nhom}</span>
    case 'dvt': { const v = ptVal_(r.sec, r.a, 'dvt', ovr); return v ? v : <Dash /> }
    case 'kl': case 'dt': case 'hs': return <NumCell r={r} f={c.k} ovr={ovr} />
    case 'dgnt': return <NumCell r={r} f="dgnt" isMoney ovr={ovr} />
    case 'dg':
      if (r.sec.mode === 'area') return <span title="Đơn giá chung của cả hạng mục">{money(r.dg)}<span className="unit">đ</span></span>
      return <NumCell r={r} f="dg" isMoney ovr={ovr} />
    case 'gc': return <span className="qsppt-gc">{ptVal_(r.sec, r.a, 'gc', ovr)}</span>
    case 'thuTu': { const ct = ctOf_(r.a); return ct ? String(Number(ct.thuTu) || 0) : <Dash /> }
    default: return null
  }
}

/* Ô nhập ở chế độ Edit (ptEditCell_ + ptOvrSave): rời ô / Enter là lưu; tiền hiện 930.000. Lỗi -> trả giá trị cũ. */
function PtInp({ r, e, val, save }) {
  const shownOf = v => (e.money ? (v ? money(v) : '') : (e.num ? ((v || v === 0) ? String(v) : '') : String(v == null ? '' : v)))
  const init = shownOf(val)
  const [v, setV] = useState(init)
  const [st, setSt] = useState('')
  const old = useRef(init)
  const focus = useRef(false)
  useEffect(() => {
    if (focus.current) return
    const s = shownOf(val); old.current = s; setV(s)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [val])
  useEffect(() => {
    if (st !== 'ok') return undefined
    const t = setTimeout(() => setSt(''), 1300)
    return () => clearTimeout(t)
  }, [st])
  async function commit(raw) {
    if (raw === old.current) return
    setSt('saving')
    const ok = await save(r, e, raw)
    if (ok) { old.current = raw; setSt('ok') } else { setSt('err'); setV(old.current) }
  }
  return (
    <span className={`qspl-spin-wrap${e.num ? '' : ' tx'}`} onClick={ev => ev.stopPropagation()}>
      <input className={`qspl-spin${e.num ? '' : ' tx'}${st ? ' ' + st : ''}`} value={v} title={v}
        onChange={ev => setV(ev.target.value)}
        onFocus={() => { focus.current = true }}
        onBlur={ev => { focus.current = false; commit(ev.target.value) }}
        onKeyDown={ev => { if (ev.key === 'Enter') ev.currentTarget.blur() }} />
    </span>
  )
}

/* ★ yêu thích · ⊕ thêm vào bảng khái toán · ✓ duyệt · ✎ sửa · 👁 xem · 🗑 xoá (spRowActions_ nhánh Phần thô) */
function RowActions({ r, da, canDuyet, isAdmin, on }) {
  const c = ctOf_(r.a)
  return (
    <>
      {c && <button type="button" className={`qspl-act fav${c.yeuThich ? ' on' : ''}`} title={c.yeuThich ? 'Bỏ khỏi công tác yêu thích' : 'Thêm vào công tác yêu thích'} onClick={() => on.fav(r)}><QsIcon name="star" size={16} /></button>}
      <button type="button" className="qspl-act add" title={da ? 'Đã có trong bảng — bấm để thêm 1 dòng nữa' : 'Thêm vào bảng khái toán của dự án đang chọn'} onClick={() => on.add(r)}><QsIcon name="pluscircle" size={18} /></button>
      {c && canDuyet && <button type="button" className={`qspl-act ${c.daDuyet ? 'undo' : 'ok'}`} title={c.daDuyet ? 'Bỏ duyệt' : 'Duyệt công tác này'} onClick={() => on.duyet(r)}><QsIcon name="check" size={16} /></button>}
      {c && <button type="button" className="qspl-act edit" title="Cập nhật công tác" onClick={() => on.editCt(r)}><QsIcon name="edit" size={16} /></button>}
      <button type="button" className="qspl-act" title="Xem chi tiết" onClick={() => on.open(r)}><QsIcon name="eye" size={16} /></button>
      {c && isAdmin && <button type="button" className="qspl-act del" title="Xoá công tác" onClick={() => on.del(r)}><QsIcon name="trash" size={16} /></button>}
    </>
  )
}
