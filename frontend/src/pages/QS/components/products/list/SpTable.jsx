import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import QsIcon from '../../common/QsIcon'
import ProductThumb from '../../common/ProductThumb'
import { mediaUrl } from '../../../api/files'
import { money, fmtDate, safeUrl_, ptQty } from '../../../lib/format.js'
import { SP_ALWAYS, spColVal_, spEditRaw_, spColW_, spKey_, fmtDateTime_, spMauCss_ } from './spModel'
import { spInlineSave, spPrivateCopy } from './spActions'

/* Bảng Danh sách SP (spRenderHead_ / spFilter / spAllCols_ / spInp_ / spNameEdit_ / spEditCell_ / spRowActions_ / spFreeze_ /
   spInitCols_, PUB/sanpham.js:218-293, 597-600, 616-655, 803-856, 920-950, 1488-1666).
   Props:
     cols       cột đang hiện (spVisCols_), mỗi cột {k, label, cls, kind, e}
     rows       dòng của trang (spPageRows_): {p, m, kid, bt}
     w          độ rộng đã lưu, sel (khoá đã tick), edit (chế độ sửa nhanh), sort {k, dir}
     skuCount(p), canEdit, canDuyet, isAdmin
     on: {sort(k), move(from, to, before), resize(k, w, done), selAll(on), selToggle(k, on), open(p), dragStart(e, p), dragEnd(),
          fav(p), add(p), duyet(p), editP(p), copy(e, p), del(p), cbToggle(p), cbIsOpen(p), btToggle(key), colMenu(c, anchorEl)?} */
const SEL = 38
const SP_FRZ = 3   // số cột dữ liệu đóng băng (STT · Ảnh · Sản phẩm), chưa kể cột chọn

const img1 = v => (v ? mediaUrl(String(v).split('\n')[0].trim()) : '')
const Dash = () => <span className="qspl-muted">—</span>
const FUNNEL = <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h18l-7 8.5V19l-4 2v-8.5z" /></svg>

export default function SpTable({ cols, rows, w, sel, edit, sort, wrapW, skuCount, canEdit, canDuyet, isAdmin, on }) {
  const [dragCol, setDragCol] = useState(null)
  const [drop, setDrop] = useState(null)   // {k, left}
  const [xs, setXs] = useState(false)
  const [ys, setYs] = useState(false)
  const wrapRef = useRef(null), tblRef = useRef(null), barRef = useRef(null)
  const [fk, setFk] = useState(1)          // hệ số bù cỡ chữ của bảng (--fs), xem cw
  // thanh kéo ngang: hbW = bề rộng thumb (0 = ẩn), hbL = vị trí. Giữ số thay vì object: cập nhật trùng giá trị thì React bỏ qua,
  // không thì layout effect gán object mới mỗi lần -> vòng render vô hạn khi đang có cập nhật nền (đăng nhập lại)
  const [hbW, setHbW] = useState(0)
  const [hbL, setHbL] = useState(0)
  const [hbDrag, setHbDrag] = useState(false)

  /* Bề rộng cột của bản gốc tính theo chữ 13px, còn chữ trong QS được nhân --fs (bù thu nhỏ 75%) nên cột chữ nhân cùng hệ số,
     không thì tiêu đề bị cắt ("Công s…"). Độ rộng lưu (w, qs_spcolcfg) vẫn theo đơn vị của bản gốc. Cột ảnh không có chữ. */
  const cwK = k => (k === 'thumb' ? 1 : fk)
  const cw = k => Math.round(spColW_(w, k) * cwK(k))
  useLayoutEffect(() => {
    const t = tblRef.current; if (!t) return
    const v = Math.round(((parseFloat(getComputedStyle(t).fontSize) || 13) / 13) * 100) / 100
    if (v > 0 && v !== fk) setFk(v)
  })

  /* Thanh kéo ngang tự dựng dưới bảng (hbarSync_ / hbarBind_, PUB/app.js:2048-2096) */
  function hbSync() {
    const wr = wrapRef.current; if (!wr) return
    const sw = wr.scrollWidth, cwd = wr.clientWidth
    if (sw <= cwd + 1) { setHbW(0); return }      // vừa khít -> không cần thanh
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
  function hbBarDown(e) {                    // bấm vào rãnh -> nhảy tới
    const wr = wrapRef.current, bar = barRef.current; if (!wr || !bar || !hbW) return
    if (e.target !== bar) return
    const z = zOf(bar), r = bar.getBoundingClientRect(), tw = hbW
    const pos = Math.min(Math.max(0, (e.clientX - r.left) / z - tw / 2), bar.clientWidth - tw)
    const maxScroll = wr.scrollWidth - wr.clientWidth, maxLeft = bar.clientWidth - tw
    wr.scrollLeft = maxLeft ? pos * maxScroll / maxLeft : 0
  }

  /* Ảnh sản phẩm to theo bề rộng cột Ảnh (trừ đệm 2 x 8px), 40-96px, luôn nằm gọn trong ô (ảnh object-fit: contain) */
  const ts = Math.max(40, Math.min(cw('thumb') - 16, 96))
  let daCot = SEL; cols.forEach(c => { daCot += cw(c.k) })
  // cột thao tác nhận phần bề ngang còn dư để bảng vừa khít khung (tối thiểu đủ 7 nút)
  const ACT = Math.max(240, (wrapW || 0) - daCot - 2)
  const total = daCot + ACT
  // left của cột đóng băng: cột chọn + SP_FRZ cột đầu
  const nFrz = Math.min(SP_FRZ, cols.length)
  const offs = [0]; let left = SEL
  for (let k = 0; k < nFrz; k++) { offs.push(left); left += cw(cols[k].k) }
  const frz = k => (k < nFrz ? { left: offs[k + 1] } : null)
  const frzCls = k => (k < nFrz ? (' qspl-frz' + (k === nFrz - 1 ? ' last' : '')) : '')

  const allOn = rows.length > 0 && rows.every(r => sel[spKey_(r.p)])
  const ncol = cols.length + 2

  function startResize(e, k) {
    e.preventDefault(); e.stopPropagation()
    const sx = e.clientX, sw = spColW_(w, k)
    const th = e.currentTarget.closest('th')
    const z = (th && th.offsetWidth ? (th.getBoundingClientRect().width / th.offsetWidth) || 1 : 1) * cwK(k)
    const mv = ev => on.resize(k, Math.max(56, Math.round(sw + (ev.clientX - sx) / z)), false)
    const up = ev => {
      document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up)
      on.resize(k, Math.max(56, Math.round(sw + (ev.clientX - sx) / z)), true)
    }
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up)
  }

  return (
    <>
    <div ref={wrapRef} className={`qspl-tblwrap${xs ? ' xscroll' : ''}${ys ? ' yscroll' : ''}`} data-sp-wrap="1"
      onScroll={e => { const t = e.currentTarget; setXs(t.scrollLeft > 0); setYs(t.scrollTop > 0); hbSync() }}>
      <table ref={tblRef} className="qspl-table" style={{ width: total, tableLayout: 'fixed' }}>
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
              const sOn = sort.k === c.k
              const dcls = drop && drop.k === c.k ? (drop.left ? ' dropL' : ' dropR') : ''
              return (
                <th key={c.k} className={`${thCls(c)} qspl-th${sOn ? ' sortOn' : ''}${dragCol === c.k ? ' dragging' : ''}${dcls}${frzCls(k)}`} style={frz(k)}
                  draggable title="Bấm để sắp xếp · kéo để đổi chỗ cột · kéo mép phải để giãn"
                  onDragStart={e => {
                    if (e.target.closest && e.target.closest('.qspl-thrsz, .qspl-thmenu')) { e.preventDefault(); return }
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
                  <span className="thl" onClick={() => on.sort(c.k)}>{c.label}{sOn ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : ''}</span>
                  {on.colMenu && <span className="qspl-thmenu" title="Sắp xếp / ẩn cột" draggable={false}
                    onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); on.colMenu(c, e.currentTarget) }}>{FUNNEL}</span>}
                  <span className="qspl-thrsz" onMouseDown={e => startResize(e, c.k)} />
                </th>
              )
            })}
            <th className="qspl-actcol" />
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((r, i) => {
            const p = r.p, m = r.m
            if (m.k === 'note') return <tr key={'n' + i} className="qspl-cbrow"><td colSpan={ncol}><div className="qspl-cbnote">{m.t}</div></td></tr>
            if (m.k === 'sum') return (
              <tr key={'s' + i} className="qspl-cbsum"><td colSpan={ncol}>
                <span className="qspl-cbsl">Tổng combo · {m.n} sản phẩm đi kèm</span><b>{money(m.tong)} đ</b>
              </td></tr>
            )
            const key = spKey_(p), isSel = !!sel[key]
            return (
              <tr key={(m.k === 'cb' ? 'c' + i + '_' : 'r') + key}
                className={`qspl-row${isSel ? ' selrow' : ''}${edit ? ' editrow' : ''}${m.k === 'cb' ? ' cbkid' : (r.kid ? ' btkid' : '')}`}
                draggable={!edit}
                onDragStart={!edit ? e => on.dragStart(e, p) : undefined}
                onDragEnd={!edit ? () => on.dragEnd() : undefined}
                onClick={edit ? undefined : () => on.open(p)}>
                <td className="qspl-selcol qspl-frz" style={{ left: 0 }} onClick={e => e.stopPropagation()}>
                  <input type="checkbox" className="qspl-ck" checked={isSel} onChange={e => on.selToggle(key, e.target.checked)} />
                </td>
                {cols.map((c, k) => (
                  <td key={c.k} className={`${c.cls}${edit && editable(c, p) ? ' edt' : ''}${frzCls(k)}`} style={frz(k)}>
                    {edit ? <EditCell c={c} p={p} r={r} on={on} skuCount={skuCount} ts={ts} /> : <Cell c={c} p={p} r={r} on={on} skuCount={skuCount} ts={ts} />}
                  </td>
                ))}
                <td className="qspl-actcol" onClick={e => e.stopPropagation()}>
                  <RowActions p={p} canEdit={canEdit} canDuyet={canDuyet} isAdmin={isAdmin} on={on} />
                </td>
              </tr>
            )
          }) : (
            <tr><td colSpan={ncol}><div className="qspl-empty">Không có sản phẩm khớp bộ lọc.</div></td></tr>
          )}
        </tbody>
      </table>
    </div>
    {/* thanh kéo ngang nằm NGAY DƯỚI bảng, trên phân trang (spHBar, sanpham.js:34) */}
    {hbW > 0 && (
      <div ref={barRef} className="qspl-hbar" onMouseDown={hbBarDown}>
        <div className={`qspl-hthumb${hbDrag ? ' dragging' : ''}`} style={{ width: hbW, left: hbL }} onMouseDown={hbThumbDown} />
      </div>
    )}
    </>
  )
}

function thCls(c) { const cl = c.cls || ''; if (cl.indexOf('num') >= 0) return 'num'; if (cl.indexOf('ct') >= 0) return 'ct'; if (cl.indexOf('thumbcol') >= 0) return 'thumbcol'; return '' }
function editable(c, p) { return !!c.e && !p.spChung }

/* Ô hiển thị (cột ở chế độ xem) */
function Cell({ c, p, r, on, skuCount, ts }) {
  const m = r.m
  switch (c.kind) {
    case 'stt': return <span className={`qspl-stt${m.k ? ' sub' : ''}`}>{m.no}</span>
    case 'thumb': return <ProductThumb product={p} size={ts || 40} src={img1(p.hinhAnh)} className="qspl-th" />
    case 'ten': return <NameCell p={p} r={r} on={on} />
    case 'duyet': return (
      <span className={`qspl-duyet${p.daDuyet ? ' on' : ''}`}
        title={p.daDuyet ? ('Duyệt bởi ' + (p.nguoiDuyet || '?') + (p.ngayDuyet ? ' · ' + fmtDateTime_(p.ngayDuyet) : '')) : 'Chưa được duyệt'}>
        {p.daDuyet ? 'Đã duyệt' : 'Chưa duyệt'}
      </span>
    )
    case 'sku': {
      const n = skuCount(p)
      return <span className={`qspl-sku${n > 1 ? ' multi' : ''}`} title={n > 1 ? n + ' biến thể cùng mã ' + (p.ma || '') : 'Chỉ 1 biến thể'}>{n}</span>
    }
    case 'giaDaiLy': return <>{money(p.donGiaBan)}<span className="unit">đ</span></>
    case 'nguoiTao': return p.nguoiTao ? <span className="qspl-who">{p.nguoiTao}</span> : <Dash />
    case 'ngayTao': return p.ngayTao ? fmtDate(p.ngayTao) : <Dash />
    case 'nguoiSua': return p.nguoiSua ? <span className="qspl-who" title={'Lúc ' + fmtDateTime_(p.ngayCapNhat)}>{p.nguoiSua}</span> : <Dash />
    default: {
      const col = c.e.col
      if (SP_ALWAYS[col]) return <SpInp p={p} e={c.e} val={spEditRaw_(p, col)} />   // chiết khấu: luôn sửa được
      const v = spColVal_(p, col)
      if (c.e.money) return v === '' ? <Dash /> : <>{money(v)}<span className="unit">đ</span></>
      if (col === 'link_datasheet') return v ? <a href={safeUrl_(v)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>Datasheet</a> : <Dash />
      return v ? v : <Dash />
    }
  }
}

/* Ô ở chế độ Edit (spEditCell_): kho chung chỉ xem; Sản phẩm = 2 ô tên + mã; cột nhập được = ô nhập */
function EditCell({ c, p, r, on, skuCount, ts }) {
  if (p.spChung) return <Cell c={c} p={p} r={r} on={on} skuCount={skuCount} ts={ts} />
  if (c.k === 'ten') {
    return (
      <span className="qspl-spin-name" onClick={e => e.stopPropagation()}>
        <SpInp p={p} e={{ lark: 'TÊN SẢN PHẨM', col: 'ten_sp' }} val={p.ten || ''} bare placeholder="Tên sản phẩm" />
        <SpInp p={p} e={{ lark: 'MÃ SẢN PHẨM', col: 'ma_sp' }} val={p.ma || ''} bare code placeholder="Mã sản phẩm" />
      </span>
    )
  }
  if (!c.e) return <Cell c={c} p={p} r={r} on={on} skuCount={skuCount} ts={ts} />
  return <SpInp p={p} e={c.e} val={spEditRaw_(p, c.e.col)} />
}

/* Cột "Sản phẩm": tên đậm, mã 1 dòng riêng (+ chip Kho Dezon), hàng chip Combo / Biến thể / màu / ×SL đi kèm */
function NameCell({ p, r, on }) {
  const bt = r.bt
  const cbOn = !!on.cbIsOpen(p)
  return (
    <>
      <b>{p.ten || ''}</b>
      <span className="qspl-code">{p.ma || ''}{p.spChung && <span className="qspl-chung" title="Sản phẩm thuộc kho chung của Dezon — chỉ xem">Kho Dezon</span>}</span>
      {(p.comboN || bt || r.m.k === 'cb') ? (
        <span className="qspl-tags">
          {p.comboN ? (
            <button type="button" className={`qspl-cbn${cbOn ? ' on' : ''}`} title={'Xem ' + p.comboN + ' sản phẩm đi kèm'}
              onClick={e => { e.stopPropagation(); on.cbToggle(p) }}>
              <QsIcon name="layers" size={11} />Combo <b>{p.comboN}</b><span className="cbc">▸</span>
            </button>
          ) : null}
          {bt && (
            <>
              <button type="button" className={`qspl-cbn bt${bt.mo ? ' on' : ''}`} title={(bt.mo ? 'Thu gọn' : 'Xem') + ' ' + bt.n + ' biến thể của sản phẩm này'}
                onClick={e => { e.stopPropagation(); on.btToggle(bt.key) }}>
                <QsIcon name="copy" size={11} />Biến thể <b>{bt.n}</b><span className="cbc">▸</span>
              </button>
              <MauDots mau={bt.mau} />
            </>
          )}
          {r.m.k === 'cb' && <span className="qspl-cbq2" title="Số lượng đi kèm cho mỗi sản phẩm chính">×{ptQty(r.m.sl)}</span>}
        </span>
      ) : null}
      {r.m.k === 'cb' && String(p.comboGhiChu || '').trim() && (
        <span className="qspl-cbgc" title="Ghi chú của sản phẩm đi kèm">Ghi chú: {String(p.comboGhiChu).trim()}</span>
      )}
    </>
  )
}

/* Chấm màu của nhóm biến thể (spMauDots_, sanpham.js:2194-2199) */
function MauDots({ mau }) {
  if (!mau || mau.length < 2) return null
  return (
    <span className="qspl-mau" title={mau.length + ' màu: ' + mau.join(' · ')}>
      {mau.slice(0, 6).map((m, i) => { const c = spMauCss_(m); return <i key={i} style={c ? { background: c } : null} className={c ? '' : 'x'} /> })}
      {mau.length > 6 && <b>+{mau.length - 6}</b>}
    </span>
  )
}

/* 1 ô nhập trên bảng (spInp_ + spInlineSave): rời ô / Enter là lưu; tiền hiện 930.000, lưu số thuần.
   Lưu xong viền xanh 1,3 s; lỗi viền đỏ + thông báo; máy chủ báo "không đổi" thì trả lại giá trị cũ. */
function SpInp({ p, e, val, bare, code, placeholder }) {
  const shownOf = v => { v = v == null ? '' : String(v); return e.money ? (v === '' ? '' : money(v)) : v }
  const init = shownOf(val)
  const [v, setV] = useState(init)
  const [st, setSt] = useState('')
  const old = useRef(init)
  const focus = useRef(false)
  const pRef = useRef(p); pRef.current = p
  useEffect(() => {
    if (focus.current) return
    const s = shownOf(val)
    old.current = s; setV(s)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [val])
  useEffect(() => {
    if (st !== 'ok') return undefined
    const t = setTimeout(() => setSt(''), 1300)
    return () => clearTimeout(t)
  }, [st])

  if (p.spChung) {
    return (
      <span className={`qspl-spin-wrap${e.num ? '' : ' tx'} ro`} title="Sản phẩm kho chung — không sửa được">
        <span className="qspl-spin-ro">{init}</span>{e.sfx && <i>{e.sfx}</i>}
      </span>
    )
  }
  async function save(el) {
    const raw = el.value
    if (raw === old.current) return
    setSt('saving')
    const r = await spInlineSave(pRef.current, e, raw, old.current)
    if (r.st === 'same') { setSt(''); if (e.money) setV(r.shown); return }
    if (r.st === 'ok') { old.current = r.shown; setV(r.shown); setSt('ok'); return }
    setSt('err')
    if (r.revert) setV(old.current)
  }
  /* nội dung dài hơn ô: khi đang gõ thì ô nới rộng đè lên cột bên cạnh (spInpFocus_ / spInpBlur_) */
  function wide(el, onOff) {
    const td = el.closest('td'); if (!td) return
    if (onOff) {
      if (el.scrollWidth <= el.clientWidth + 2) return
      td.classList.add('qspl-ovf'); el.classList.add('wide')
      el.style.width = Math.min(el.scrollWidth + 28, 460) + 'px'
    } else { td.classList.remove('qspl-ovf'); el.classList.remove('wide'); el.style.width = '' }
  }
  const input = (
    <input className={`qspl-spin${e.num ? '' : ' tx'}${code ? ' code' : ''}${st ? ' ' + st : ''}`} value={v} title={v} placeholder={placeholder}
      onChange={ev => setV(ev.target.value)}
      onFocus={ev => { focus.current = true; wide(ev.target, true) }}
      onBlur={ev => { focus.current = false; wide(ev.target, false); save(ev.target) }}
      onKeyDown={ev => { if (ev.key === 'Enter') ev.currentTarget.blur() }}
      onClick={ev => ev.stopPropagation()} />
  )
  if (bare) return input
  return <span className={`qspl-spin-wrap${e.num ? '' : ' tx'}`} onClick={ev => ev.stopPropagation()}>{input}{e.sfx && <i>{e.sfx}</i>}</span>
}

/* Hàng nút thao tác: ♡ · ⊕ · ✓ duyệt · sửa · sao chép · xem · xoá (spRowActions_, sanpham.js:1497-1505);
   dòng kho chung Dezon thay sửa / sao chép bằng "Tạo bản sao riêng" (M10.1, chỉ bản Go) */
function RowActions({ p, canEdit, canDuyet, isAdmin, on }) {
  return (
    <>
      <button type="button" className={`qspl-act fav${p.yeuThich ? ' on' : ''}`} title={p.yeuThich ? 'Bỏ khỏi sản phẩm yêu thích' : 'Thêm vào sản phẩm yêu thích'} onClick={() => on.fav(p)}><QsIcon name="star" size={16} /></button>
      <button type="button" className="qspl-act add" title="Ghi danh vào dự án" onClick={() => on.add(p)}><QsIcon name="pluscircle" size={18} /></button>
      {canDuyet && !p.spChung && <button type="button" className={`qspl-act ${p.daDuyet ? 'undo' : 'ok'}`} title={p.daDuyet ? 'Bỏ duyệt' : 'Duyệt sản phẩm này'} onClick={() => on.duyet(p)}><QsIcon name="check" size={16} /></button>}
      {!p.spChung && <button type="button" className="qspl-act edit" title="Cập nhật sản phẩm" onClick={() => on.editP(p)}><QsIcon name="edit" size={16} /></button>}
      {(p.ma && canEdit && !p.spChung) ? <button type="button" className="qspl-act copy" title="Sao chép: tạo sản phẩm mới / biến thể / nhiều màu" onClick={e => on.copy(e, p)}><QsIcon name="copy" size={16} /></button> : null}
      {(canEdit && p.spChung) ? <button type="button" className="qspl-act pcopy" title="Tạo bản sao riêng: chép sản phẩm kho chung Dezon sang công ty bạn để sửa"
        onClick={async () => { const np = await spPrivateCopy(p); if (np) on.editP(np) }}><QsIcon name="copy" size={16} /></button> : null}
      <button type="button" className="qspl-act" title="Xem chi tiết" onClick={() => on.open(p)}><QsIcon name="eye" size={16} /></button>
      {isAdmin && !p.spChung && <button type="button" className="qspl-act del" title="Xoá" onClick={() => on.del(p)}><QsIcon name="trash" size={16} /></button>}
    </>
  )
}
