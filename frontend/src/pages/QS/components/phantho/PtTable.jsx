import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import QsIcon from '../common/QsIcon'
import { money, ptN, ptR2, ptQty } from '../../lib/format.js'
import { PT_ROMAN, ptAutoKL_, ptDims_, ptMkPct_, ptMoTaHien_ } from '../../lib/phantho.js'
import { qsToast as toast } from '../common/dialogs'
import { ptVisCols_, ptW_, ptSortItems_, ptRowPass_, ptCfClass_, ptPct, ptInfoImgsRaw_, PT_COLS } from './ptModel'
import { usePtUi, setPtUi, ptUi } from './ptState'
import { usePtLoai } from '../breakdown/sheet/ptLoai'
import * as A from './ptActions'
import { PtFilterPop, PtCtxMenu, PtBulkBar } from './PtMenus'

/* Bảng ước tính chi phí Phần thô - chế độ "Bảng thường" (port renderPhanTho nhánh bảng cũ, PUB/phantho.js:2154-2328, cùng
   ptInp / ptTxt 1987-1999, chip cột / cố định cột 2095-2100, rộng cột / đổi chỗ cột / sắp xếp 2102-2149, chọn dòng 1377-1402,
   cố định hàng 1355-1376, dòng vừa thêm 1718-1731, kéo dòng + thả công tác từ thư viện 2369-2467, tìm & thay openFindReplace boc.js:71-125).
   Props: data = usePhanTho(), tpl = bộ mẫu (Excel), showCols = hàng chip cột đang mở (fold 'cols'), visible = tab Bóc tách đang hiện. */

const NEW_MS = 1350
const cellCls = c => (c[2] === 'n' ? 'n' : (c[2] === 'c' ? 'c' : ''))

/* Ô nhập không điều khiển: hiện giá trị của dữ liệu, ghi khi rời ô / Enter nếu đã đổi (onchange của bản gốc).
   key theo giá trị hiển thị nên dữ liệu đổi từ nơi khác thì ô tự làm mới. */
function MoneyIn({ v, onCommit, className = '' }) {
  const shown = (v === '' || v == null || !Number(v)) ? '' : money(v)
  return (
    <input key={shown} className={'qspt-in qspt-money ' + className} type="text" inputMode="numeric" defaultValue={shown}
      onBlur={e => { if (e.target.value !== shown) onCommit(e.target.value) }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
  )
}
function NumIn({ v, onCommit, goiY, className = '' }) {
  const shown = v === '' || v == null ? '' : String(v)
  return (
    <input key={shown} className={'qspt-in ' + className} type="number" step="any" defaultValue={shown}
      placeholder={goiY || undefined} title={goiY ? 'Bỏ trống = ' + goiY : undefined}
      // ô number trả chuỗi dấu CHẤM thập phân - gửi thẳng SỐ (qua tkNum_ "12.345" sẽ thành 12345)
      onBlur={e => { if (e.target.value !== shown) onCommit(e.target.value === '' ? '' : e.target.valueAsNumber) }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
  )
}
function grow(el) { if (!el) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }
function TxtIn({ v, onCommit, className = 'qspt-area', placeholder, title, spell }) {
  const shown = String(v || '')
  return (
    <textarea key={shown} className={'qspt-in ' + className} rows={1} defaultValue={shown} placeholder={placeholder} title={title}
      spellCheck={spell === false ? false : undefined} ref={grow} onInput={e => grow(e.currentTarget)}
      onBlur={e => { if (e.target.value !== shown) { if (onCommit(e.target.value) === false) { e.target.value = shown; grow(e.target) } } }} />
  )
}

export default function PtTable({ data, tpl, showCols, visible }) {
  const { phanTho, comp } = data
  const ui = usePtUi()
  const [pop, setPop] = useState(null)
  const [drop, setDrop] = useState(null)
  const [find, setFind] = useState(null)
  const scrollRef = useRef(null)
  const tableRef = useRef(null)
  const rowDrag = useRef(null)
  const colDrag = useRef(null)

  const vis = useMemo(() => ptVisCols_(ui.order, ui.cols), [ui.order, ui.cols])
  const frz = Math.min(ui.freeze || 0, 2, vis.length)
  const isDT = usePtLoai().indexOf('dt_') === 0

  /* Dòng đang hiện theo thứ tự trên màn hình (cho chọn bằng Shift, chọn tất cả, dọn vùng chọn) */
  const shown = useMemo(() => {
    const out = []
    phanTho.forEach((sec, si) => ptSortItems_(sec.items, ui.sort, ui.sortDir).filter(r => ptRowPass_(ui.filter, sec, r.it)).forEach((r, pos) => out.push({ si, ii: r.oi, it: r.it, pos })))
    return out
  }, [phanTho, ui.sort, ui.sortDir, ui.filter])
  const keysOnScreen = shown.map(r => r.si + '|' + r.ii)
  const selKeys = Object.keys(ui.sel || {}).filter(k => ui.sel[k])

  // bỏ khoá của dòng không còn trên bảng (thêm / xoá dòng làm đổi chỉ số)
  useEffect(() => {
    const con = {}; keysOnScreen.forEach(k => { con[k] = 1 })
    const bad = Object.keys(ui.sel || {}).filter(k => !con[k])
    if (bad.length) setPtUi(s => { const o = { ...(s.sel || {}) }; bad.forEach(k => { delete o[k] }); return { sel: o } })
  })

  /* Bề rộng khung cuộn -> --qspt-vw: lời nhắc "Bảng đang trống" đứng giữa phần đang nhìn thấy dù bảng rộng hơn khung */
  useEffect(() => {
    const w = scrollRef.current
    if (!w || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => { w.style.setProperty('--qspt-vw', w.clientWidth + 'px') })
    ro.observe(w)
    return () => ro.disconnect()
  }, [])
  /* Cố định N hàng đầu (ptFreezeRows_) */
  useLayoutEffect(() => {
    const t = tableRef.current; if (!t) return
    t.querySelectorAll('tr.frzrow').forEach(tr => { tr.classList.remove('frzrow'); tr.querySelectorAll('td').forEach(td => { td.style.position = ''; td.style.top = ''; td.style.zIndex = '' }) })
    const n = Math.min(Number(ui.frzRows) || 0, 12); if (!n) return
    const head = t.tHead; let off = (head ? head.offsetHeight : 0) || 40
    const rows = t.querySelectorAll('tr.qspt-row')
    for (let i = 0; i < n && i < rows.length; i++) {
      const tr = rows[i]; tr.classList.add('frzrow')
      tr.querySelectorAll('td').forEach(td => { td.style.position = 'sticky'; td.style.top = off + 'px'; td.style.zIndex = '3' })
      off += tr.offsetHeight
    }
  })
  /* Dòng vừa thêm: cuộn tới + nháy (ptGotoNewRow_) */
  useLayoutEffect(() => {
    const nr = ui.newRow; if (!nr) return
    if (Date.now() - (nr.t || 0) > NEW_MS) { setPtUi({ newRow: null }); return }
    const tr = tableRef.current && tableRef.current.querySelector('tr.qspt-row[data-si="' + nr.si + '"][data-ii="' + nr.ii + '"]'); if (!tr) return
    tr.style.setProperty('--fdl', '-' + (Date.now() - nr.t) + 'ms'); tr.classList.add('rownew')
    const w = scrollRef.current; if (!w) return
    const wr = w.getBoundingClientRect(), rr = tr.getBoundingClientRect()
    const duoi = rr.bottom - (wr.bottom - 10), tren = (wr.top + 46) - rr.top
    const d = (duoi > 0) ? duoi : ((tren > 0) ? -tren : 0)
    if (Math.abs(d) >= 2) w.scrollTo({ top: Math.max(0, Math.min(w.scrollHeight - w.clientHeight, w.scrollTop + d)), behavior: 'smooth' })
  })
  useEffect(() => {
    if (!ui.newRow) return undefined
    const t = setTimeout(() => setPtUi({ newRow: null }), NEW_MS)
    return () => clearTimeout(t)
  }, [ui.newRow])

  /* Tìm & thay (openFindReplace / frFind / frReplaceAll) */
  useEffect(() => {
    const t = tableRef.current; if (!t) return
    t.querySelectorAll('.fr-hit').forEach(e => e.classList.remove('fr-hit', 'fr-hit-cur'))
    const q = find && find.q ? find.q.toLowerCase() : ''; if (!q) return
    const hits = []
    t.querySelectorAll('tr.qspt-row td').forEach(td => {
      const inp = td.querySelector('input,textarea'); const txt = inp ? String(inp.value || '') : String(td.textContent || '')
      if (txt.toLowerCase().indexOf(q) >= 0) { td.classList.add('fr-hit'); hits.push(td) }
    })
    if (hits.length) hits[0].classList.add('fr-hit-cur')
    if (find.n !== hits.length) setFind(f => (f ? { ...f, n: hits.length } : f))
  })
  useEffect(() => {
    if (!visible) return undefined
    const key = e => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = (e.key || '').toLowerCase(); if (k !== 'f' && k !== 'h') return
      e.preventDefault(); setFind(f => f || { q: '', rep: '', n: 0 })
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [visible])
  function replaceAll() {
    const q = find.q || '', rep = find.rep || ''
    if (!q) { toast('Nhập từ cần tìm'); return }
    const cells = []; const doi = {}
    phanTho.forEach((sec, si) => (sec.items || []).forEach((it, ii) => {
      ;['n', 'dvt', 'gc'].forEach(f => { const v = String(it[f] == null ? '' : it[f]); if (v.indexOf(q) >= 0) { cells.push({ si, ii, f, val: v.split(q).join(rep) }); doi[si + '|' + ii] = 1 } })
    }))
    const m = Object.keys(doi).length
    if (m) A.ptSheetWrite(cells, 'Thay thế')
    toast(m ? ('Đã thay ở ' + m + ' dòng') : 'Không tìm thấy “' + q + '”')
  }

  /* Chọn dòng (ptSelClick_) */
  function selClick(e, si, ii) {
    e.stopPropagation()
    const k = si + '|' + ii, i = keysOnScreen.indexOf(k)
    setPtUi(s => {
      const o = { ...(s.sel || {}) }
      if (e.shiftKey && s.anchor != null) {
        let a = keysOnScreen.indexOf(s.anchor); if (a < 0) a = i
        for (let x = Math.min(a, i); x <= Math.max(a, i); x++) o[keysOnScreen[x]] = 1
        return { sel: o }
      }
      if (o[k]) delete o[k]; else o[k] = 1
      return { sel: o, anchor: k }
    })
  }
  const selAll = () => setPtUi(s => { const o = { ...(s.sel || {}) }; keysOnScreen.forEach(k => { o[k] = 1 }); return { sel: o } })

  /* Cột: cố định / rộng / đổi chỗ / sắp xếp */
  const freezeTo = k => { const i = vis.map(c => c[0]).indexOf(k); setPtUi({ freeze: i >= 0 ? i + 1 : 0 }) }
  const freezeRowTo = (si, ii) => {
    const rows = tableRef.current ? tableRef.current.querySelectorAll('tr.qspt-row') : []
    let n = 0
    for (let i = 0; i < rows.length; i++) { n = i + 1; if (+rows[i].getAttribute('data-si') === si && +rows[i].getAttribute('data-ii') === ii) break }
    const v = Math.min(n, 12); setPtUi({ frzRows: v }); toast('Đã cố định ' + v + ' hàng đầu — cuộn xuống vẫn thấy')
  }
  const toggleSort = k => setPtUi(s => (s.sort !== k ? { sort: k, sortDir: 'asc' } : s.sortDir === 'asc' ? { sortDir: 'desc' } : { sort: '', sortDir: 'asc' }))
  function startResize(e, c) {
    e.preventDefault(); e.stopPropagation()
    const sx = e.clientX, sw = ptW_(ui.colW, c)
    const th = e.currentTarget.closest('th')
    const z = th ? ((th.getBoundingClientRect().width / (th.offsetWidth || 1)) || 1) : 1
    const mv = ev => { const w = Math.max(44, sw + (ev.clientX - sx) / z); setPtUi(s => ({ colW: { ...s.colW, [c[0]]: w } })) }
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up) }
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up)
  }
  function colDrop(e, k) {
    e.preventDefault()
    const from = colDrag.current; colDrag.current = null; if (!from || from === k) return
    const ord = (ui.order || PT_COLS.map(c => c[0])).filter(x => x !== from)
    let i = ord.indexOf(k); if (i < 0) i = ord.length
    ord.splice(i, 0, from); setPtUi({ order: ord })
  }

  /* Kéo dòng / thả công tác từ thư viện (ptDragBind_) */
  const rowKey = (si, ii) => 'r' + si + '|' + ii
  function onDragOver(e) {
    const lib = ptUi().libDrag
    const tr = e.target.closest('tr'); if (!tr || !(lib || rowDrag.current)) return
    e.preventDefault()
    try { e.dataTransfer.dropEffect = lib ? 'copy' : 'move' } catch (x) { /* bỏ qua */ }
    if (tr.classList.contains('qspt-row')) {
      const r = tr.getBoundingClientRect()
      setDrop({ key: rowKey(+tr.getAttribute('data-si'), +tr.getAttribute('data-ii')), pos: e.clientY < r.top + r.height / 2 ? 'dropTop' : 'dropBot' })
    } else if (tr.classList.contains('qspt-sec') || tr.classList.contains('qspt-add') || (lib && tr.classList.contains('qspt-empty'))) {
      setDrop({ key: 'g' + (tr.getAttribute('data-si') || 'e'), pos: 'dropInto' })
    } else setDrop(null)
  }
  function onDrop(e) {
    const lib = ptUi().libDrag
    const tr = e.target.closest('tr')
    setDrop(null)
    if (lib) {
      e.preventDefault(); setPtUi({ libDrag: null })
      let dich = null
      if (tr && tr.classList.contains('qspt-row')) {
        const rr = tr.getBoundingClientRect(), ii = +tr.getAttribute('data-ii')
        dich = { si: +tr.getAttribute('data-si'), at: (e.clientY < rr.top + rr.height / 2 ? ii : ii + 1) }
      } else if (tr && (tr.classList.contains('qspt-sec') || tr.classList.contains('qspt-add'))) {
        const s2 = +tr.getAttribute('data-si'); const sec2 = phanTho[s2]
        if (sec2) dich = { si: s2, at: (sec2.items || []).length }
      }
      A.ptAddFromLib(lib.tsec, lib.a, dich)
      return
    }
    const d = rowDrag.current; rowDrag.current = null
    if (!d || !tr) return
    e.preventDefault()
    if (tr.classList.contains('qspt-row')) {
      const ts = +tr.getAttribute('data-si'), ti = +tr.getAttribute('data-ii')
      if (ts === d.si && ui.sort) { toast('Đang sắp xếp theo cột — bỏ sắp xếp rồi mới đổi chỗ dòng'); return }
      const r = tr.getBoundingClientRect()
      A.ptMoveItem(d.si, d.ii, ts, ti, e.clientY < r.top + r.height / 2)
    } else if (tr.classList.contains('qspt-sec') || tr.classList.contains('qspt-add')) {
      const s2 = +tr.getAttribute('data-si'); if (isNaN(s2)) return
      A.ptMoveItem(d.si, d.ii, s2, null, true)
    }
  }

  /* Chuột phải (ptCtx) */
  function onCtx(e) {
    const th = e.target.closest('th.thk'), tr = e.target.closest('tr.qspt-row')
    const trs = tr ? null : e.target.closest('tr.qspt-sec,tr.qspt-add')
    let cell = null
    if (tr) {
      const td = e.target.closest('td'); const idx = Array.prototype.indexOf.call(tr.children, td); const col = vis[idx]
      if (col) {
        const inp = td.querySelector('input,textarea')
        cell = { si: +tr.getAttribute('data-si'), ii: +tr.getAttribute('data-ii'), key: col[0], lbl: col[1], text: inp ? String(inp.value || '') : String(td.textContent || '').trim() }
      }
    }
    e.preventDefault()
    setPop({ kind: 'ctx', at: { x: e.clientX, y: e.clientY }, cell,
      row: tr ? { si: +tr.getAttribute('data-si'), ii: +tr.getAttribute('data-ii') } : null,
      secSi: trs ? +trs.getAttribute('data-si') : -1, colKey: th ? th.getAttribute('data-k') : (cell ? cell.key : '') })
  }
  function rename(si) {
    const ta = tableRef.current && tableRef.current.querySelector('tr.qspt-sec[data-si="' + si + '"] .qspt-secttl-in')
    if (ta) { ta.focus(); ta.select(); ta.scrollIntoView({ block: 'center' }) }
  }

  /* ---- các dòng ---- */
  const body = []
  const ncol = vis.length + 1
  const blank = c => <td key={c[0]} className={cellCls(c)} />
  const cells = map => vis.map(c => (map[c[0]] !== undefined ? <td key={c[0]} className={map[c[0]].cls}>{map[c[0]].el}</td> : blank(c)))
  if (!phanTho.length) {
    body.push(
      <tr key="empty" className={`qspt-empty${drop && drop.key === 'ge' ? ' dropInto' : ''}`}><td colSpan={ncol}>
        <div className="qspt-empty-b">
          <QsIcon name="layers" size={30} />
          <h4>Bảng đang trống</h4>
          {isDT
            ? <p>Dự toán chạy theo <b>bộ</b>: nhập số liệu đầu vào ở panel bên trái, rồi bấm <b className="pe-t">Dùng bộ dự toán này</b> — hệ thống đưa cả nhân công · máy · vật tư vào bảng.<br />Sửa số liệu đầu vào lúc nào, bảng <b>tự tính lại</b> lúc đó.</p>
            : <p>Chọn hạng mục từ danh sách bên trái — bấm <b className="pe-b">＋</b> để thêm từng công tác, hoặc <b className="pe-r">＋</b> ở tên nhóm để thêm cả nhóm.<br />Mọi lựa chọn được <b>lưu tự động</b>.</p>}
        </div>
      </td></tr>,
    )
  }
  phanTho.forEach((sec, si) => {
    const st = comp.sections[si]
    const isSecArea = sec.mode === 'area'
    const sumDG = sec.items.reduce((s, it) => s + ptN(it.dg), 0)
    const dvtSet = {}; sec.items.forEach(it => { dvtSet[String(it.dvt || '').trim()] = 1 })
    const oneDvt = Object.keys(dvtSet).length <= 1
    const klCell = (st.sumKL && oneDvt) ? ptQty(st.sumKL) : ''
    const secLn = st.tt - st.ttnt
    const secMargin = st.tt ? (secLn / st.tt * 100) : 0
    const secMarkup = st.ttnt ? (secLn / st.ttnt * 100) : 0
    const dgntSet = {}; sec.items.forEach(it => { dgntSet[ptN(it.dgnt)] = 1 })
    const dk = Object.keys(dgntSet)
    const secDgnt = (dk.length === 1 && ptN(dk[0])) ? ptN(dk[0]) : 0
    const gk = 'g' + si
    body.push(
      <tr key={'s' + si} className={`qspt-sec${drop && drop.key === gk ? ' dropInto' : ''}`} data-si={si}>
        {cells({
          stt: { cls: 'c', el: PT_ROMAN[si] },
          noidung: { cls: 'qspt-secname', el: (
            <>
              <TxtIn className="qspt-secttl-in" v={sec.t} spell={false} title="Bấm để sửa tên hạng mục" placeholder="Tên hạng mục" onCommit={v => A.ptEditSec(si, 't', v)} />
              {sec.note ? <span className="qspt-note">{sec.note}</span> : null}
              <span className="qspt-secdel" title="Xoá hạng mục" onClick={() => A.ptDelSection(si)}><QsIcon name="trash" size={13} /></span>
            </>) },
          khoiluong: { cls: 'n', el: klCell },
          ttCost: { cls: 'n b', el: st.ttCost ? money(st.ttCost) : '' },
          dgnt: { cls: 'n b', el: secDgnt ? money(secDgnt) : '' },
          ttnt: { cls: 'n b', el: st.ttnt ? money(st.ttnt) : '' },
          lnvnd: { cls: 'n b', el: secLn ? money(secLn) : '' },
          margin: { cls: 'n b qspt-pctc', el: secMargin ? ptPct(secMargin) : '' },
          markup: { cls: 'n b qspt-pctc', el: secMarkup ? ptPct(secMarkup) : '' },
          dg: { cls: 'n qspt-upcell b', el: isSecArea ? <MoneyIn v={sec.up} onCommit={v => A.ptEdit(si, -1, 'up', v)} /> : ((sumDG && oneDvt) ? money(sumDG) : '') },
          tt: { cls: 'n b', el: st.tt ? money(st.tt) : '-' },
        })}
        <td />
      </tr>,
      <tr key={'sp' + si} className="qspt-spacer"><td colSpan={ncol} /></tr>,
    )
    ptSortItems_(sec.items, ui.sort, ui.sortDir).filter(r => ptRowPass_(ui.filter, sec, r.it)).forEach((r, pos) => {
      const it = r.it, ii = r.oi
      const tt = it._tt, ttnt = it._ttnt
      const isArea = (sec.mode === 'area' || sec.mode === 'area0'), isItem = sec.mode === 'item'
      const lnVnd = isItem ? (tt - ttnt) : 0
      const margin = (isItem && tt) ? (lnVnd / tt * 100) : 0
      const markup = (isItem && ttnt) ? (lnVnd / ttnt * 100) : 0
      const anh = ptInfoImgsRaw_({ anh: it.anh }), anh0 = anh[0] || ''
      const k = si + '|' + ii, on = !!(ui.sel && ui.sel[k])
      const E = (f, val) => A.ptEdit(si, ii, f, val)
      const dk2 = rowKey(si, ii)
      body.push(
        <tr key={'r' + si + '_' + ii} className={`qspt-row${ptCfClass_(ui.cf, sec, it)}${on ? ' rowsel' : ''}${drop && drop.key === dk2 ? ' ' + drop.pos : ''}`} draggable data-si={si} data-ii={ii}
          onMouseDown={e => { e.currentTarget.draggable = !e.target.closest('input,textarea,button,select') }}
          onDragStart={e => {
            if (e.target.closest && e.target.closest('input,textarea,button,select')) { e.preventDefault(); return }
            rowDrag.current = { si, ii }; e.currentTarget.classList.add('dragging')
            try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'pt-row') } catch (x) { /* bỏ qua */ }
          }}
          onDragEnd={e => { rowDrag.current = null; e.currentTarget.classList.remove('dragging'); setDrop(null) }}>
          {cells({
            stt: { cls: 'c qspt-grip', el: (
              <span title="Kéo để đổi chỗ dòng hoặc chuyển sang hạng mục khác">
                <input type="checkbox" className="qspt-ck" checked={on} onChange={() => {}} onClick={e => selClick(e, si, ii)} title="Chọn dòng (giữ Shift để chọn cả vùng)" />
                <span className="qspt-sttn">{pos + 1}</span>
              </span>) },
            maBanVe: { cls: '', el: <TxtIn v={it.maBanVe} onCommit={v => E('maBanVe', v)} /> },
            dongSP: { cls: '', el: <span className="qspt-ro">{String(sec.t || '').split('\n')[0]}</span> },
            maSP: { cls: '', el: <TxtIn v={it.maSP} onCommit={v => E('maSP', v)} /> },
            noidung: { cls: '', el: <TxtIn v={it.n} onCommit={v => E('n', v)} /> },
            moTa: { cls: 'qspt-mota', el: <TxtIn v={ptMoTaHien_(it.moTa)} placeholder="Mỗi việc 1 dòng" onCommit={v => E('moTa', v)} /> },
            ncc: { cls: '', el: <TxtIn v={it.ncc} onCommit={v => E('ncc', v)} /> },
            hinhAnh: { cls: 'c', el: anh0 ? <a href={anh0} target="_blank" rel="noreferrer" title={anh.length + ' ảnh - bấm để mở'}><img className="qspt-cellimg" src={anh0} alt="" /></a> : <span className="qspt-dash">-</span> },
            dvt: { cls: 'c qspt-dvtcell', el: <TxtIn v={it.dvt} onCommit={v => E('dvt', v)} /> },
            dimL: { cls: 'n', el: (isArea || isItem) ? <NumIn v={it.cd} onCommit={v => E('cd', v)} /> : null },
            dimB: { cls: 'n', el: (isArea || isItem) ? <NumIn v={it.cr} onCommit={v => E('cr', v)} /> : null },
            dimH: { cls: 'n', el: (isArea || isItem) ? <NumIn v={it.cc} onCommit={v => E('cc', v)} /> : null },
            heso: { cls: 'n', el: (isArea || isItem) ? <NumIn v={it.hs} goiY={ptAutoKL_(it) ? '1' : ''} onCommit={v => E('hs', v)} /> : null },
            khoiluong: { cls: 'n', el: isArea ? <span className="qspt-ro">{ptQty(it._kl)}</span>
              : (isItem ? (ptAutoKL_(it) ? <span className="qspt-ro" title={'Khối lượng = ' + (ptDims_(it).length ? 'L × B × H' : 'Diện tích') + ' × Hệ số'}>{ptQty(it._kl)}</span> : <NumIn v={it.kl} onCommit={v => E('kl', v)} />) : null) },
            giaNCC: { cls: 'n', el: isItem ? <MoneyIn v={it.giaNCC} onCommit={v => E('giaNCC', v)} /> : null },
            ttCost: { cls: 'n', el: isItem && it._ttCost ? <span className="qspt-ro">{money(it._ttCost)}</span> : null },
            ckNT: { cls: 'n', el: isItem ? <NumIn className="qspt-pct-in" v={it.ckNT} onCommit={v => E('ckNT', v)} /> : null },
            dgnt: { cls: 'n', el: isItem ? <MoneyIn v={it.dgnt} onCommit={v => E('dgnt', v)} /> : null },
            ttnt: { cls: 'n', el: isItem ? <span className="qspt-ro">{money(ttnt)}</span> : null },
            mkPct: { cls: 'n', el: isItem ? <NumIn className="qspt-pct-in" v={ptR2(ptMkPct_(it))} onCommit={v => E('mkPct', v)} /> : null },
            dg: { cls: 'n', el: isItem ? <MoneyIn v={it.dg} onCommit={v => E('dg', v)} /> : null },
            ckKH: { cls: 'n', el: isItem ? <NumIn className="qspt-pct-in" v={it.ckKH} onCommit={v => E('ckKH', v)} /> : null },
            dgCK: { cls: 'n', el: isItem ? <span className="qspt-ro">{money(it._dgCK)}</span> : null },
            tt: { cls: 'n', el: isItem ? <span className="qspt-ro b">{money(tt)}</span> : <span className="qspt-dash">-</span> },
            markup: { cls: 'n', el: isItem ? <span className="qspt-ro qspt-pctc">{ptPct(markup)}</span> : null },
            margin: { cls: 'n', el: isItem ? <span className="qspt-ro qspt-pctc">{ptPct(margin)}</span> : null },
            lnvnd: { cls: 'n', el: isItem ? <span className="qspt-ro">{money(lnVnd)}</span> : null },
            trangThai: { cls: '', el: <TxtIn v={it.trangThai} onCommit={v => E('trangThai', v)} /> },
            ghichu: { cls: 'qspt-gc', el: <TxtIn v={it.gc} onCommit={v => E('gc', v)} /> },
          })}
          <td className="qspt-del">
            <button title="Nhân bản dòng" onClick={() => A.ptDupItem(si, ii)}><QsIcon name="copy" size={13} /></button>
            <button title="Chèn dòng trống bên dưới" onClick={() => A.ptInsertItem(si, ii)}><QsIcon name="plus" size={13} /></button>
            <button className="x" title="Xoá dòng" onClick={() => A.ptDelItem(si, ii)}><QsIcon name="trash" size={13} /></button>
          </td>
        </tr>,
      )
    })
    body.push(
      <tr key={'a' + si} className="qspt-add" data-si={si}><td /><td colSpan={Math.max(1, vis.length - 1)}><span onClick={() => A.ptAddItem(si)}>＋ Thêm dòng</span></td><td /></tr>,
      <tr key={'sp2' + si} className="qspt-spacer"><td colSpan={ncol} /></tr>,
    )
  })
  body.push(
    <tr key="sptot" className="qspt-spacer qspt-spacer-tot"><td colSpan={ncol} /></tr>,
    <tr key="tot" className="qspt-total">
      {cells({
        stt: { cls: 'c', el: null },
        noidung: { cls: 'qspt-tlbl', el: 'TỔNG CỘNG' },
        ttnt: { cls: 'n b', el: money(comp.contractor) },
        lnvnd: { cls: 'n b', el: <>{money(comp.profit)} <span className="qspt-pct">({comp.profitPct.toFixed(1)}%)</span></> },
        tt: { cls: 'n b', el: money(comp.grand) },
      })}
      <td />
    </tr>,
  )

  const soLoc = Object.keys(ui.filter || {}).length
  const frzLbl = frz ? ('Bỏ cố định (' + frz + ' cột)') : 'Cố định cột'
  return (
    <div className="qspt-wrap">
      <div className="qspt-toolbar">
        <div className="qspt-tt">Bảng ước tính chi phí — <b>Xây dựng thô</b></div>
        <div className="qspt-sp" />
        <button className="qspt-btn ghost sm" onClick={A.ptReset}><QsIcon name="trash" size={14} /> Xoá hết</button>
        <button className="qspt-btn blue sm" onClick={A.ptAddSection}><QsIcon name="plus" size={14} /> Thêm hạng mục</button>
      </div>
      {showCols && (
        <div className="qspt-colchips">
          <span className="qspt-collbl">Cột hiển thị</span>
          <button className={`qspt-btn ghost sm${frz ? ' on' : ''}`} title="Cố định cột trái khi cuộn ngang"
            onClick={() => (frz ? setPtUi({ freeze: 0 }) : freezeTo(vis[1] ? vis[1][0] : vis[0][0]))}><QsIcon name="lock" size={14} /> {frzLbl}</button>
          {soLoc > 0 && <button className="qspt-btn ghost sm on" title="Bỏ mọi bộ lọc cột" onClick={() => setPtUi({ filter: {} })}>Đang lọc {soLoc} cột ✕</button>}
          {PT_COLS.map(c => <span key={c[0]} className={`qspt-chip${ui.cols[c[0]] ? ' on' : ''}`} onClick={() => setPtUi(s => ({ cols: { ...s.cols, [c[0]]: !s.cols[c[0]] } }))}>{c[1]}</span>)}
        </div>
      )}
      {find && (
        <div className="qspt-fr">
          <span className="qspt-fr-ic"><QsIcon name="search" size={14} /></span>
          <input autoFocus placeholder="Tìm trong bảng…" value={find.q} onChange={e => setFind({ ...find, q: e.target.value })} onKeyDown={e => { if (e.key === 'Escape') setFind(null) }} />
          <span className="qspt-fr-cnt">{find.q ? (find.n ? '★ ' + find.n : '0') : ''}</span>
          <span className="qspt-fr-ar">→</span>
          <input placeholder="Thay bằng…" value={find.rep} onChange={e => setFind({ ...find, rep: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') replaceAll(); else if (e.key === 'Escape') setFind(null) }} />
          <button className="qspt-btn blue xs" onClick={replaceAll}>Thay tất cả</button>
          <button className="qspt-fr-x" title="Đóng (Esc)" onClick={() => setFind(null)}>✕</button>
        </div>
      )}
      <div className="qspt-scroll" ref={scrollRef}>
        <table ref={tableRef} className={`qspt-t${frz ? ' frz' + frz : ''}`} style={frz ? { '--frz1w': ptW_(ui.colW, vis[0]) + 'px' } : undefined}
          onContextMenu={onCtx} onDragOver={onDragOver} onDrop={onDrop} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDrop(null) }}>
          <colgroup>{vis.map(c => <col key={c[0]} style={{ width: ptW_(ui.colW, c) }} />)}<col style={{ width: 74 }} /></colgroup>
          <thead>
            <tr>
              {vis.map(c => {
                const on = ui.sort === c[0], ar = on ? (ui.sortDir === 'desc' ? ' ▼' : ' ▲') : ''
                const loc = !!(ui.filter && ui.filter[c[0]])
                return (
                  <th key={c[0]} className={`thk ${cellCls(c)}${on ? ' sortOn' : ''}${loc ? ' fltOn' : ''}`} data-k={c[0]} draggable
                    title="Bấm nhãn để sắp xếp · kéo để đổi vị trí · kéo mép phải để chỉnh rộng"
                    onDragStart={e => { if (e.target.closest && e.target.closest('.qspt-rsz')) { e.preventDefault(); return } colDrag.current = c[0]; try { e.dataTransfer.setData('text/plain', c[0]) } catch (x) { /* bỏ qua */ } }}
                    onDragOver={e => { if (colDrag.current) e.preventDefault() }} onDrop={e => colDrop(e, c[0])}>
                    <span className="thl" onClick={() => toggleSort(c[0])}>{c[1]}{ar}</span>
                    <span className="thflt" title="Lọc cột" onClick={e => { e.stopPropagation(); e.preventDefault(); const at = e.currentTarget; setPop({ kind: 'flt', anchor: at, key: c[0] }) }}>▾</span>
                    <span className="qspt-rsz" onMouseDown={e => startResize(e, c)} />
                  </th>
                )
              })}
              <th />
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>
      {pop && pop.kind === 'flt' && <PtFilterPop anchor={pop.anchor} colKey={pop.key} phanTho={phanTho} onClose={() => setPop(null)} />}
      {pop && pop.kind === 'ctx' && (
        <PtCtxMenu at={pop.at} cell={pop.cell} row={pop.row} secSi={pop.secSi} colKey={pop.colKey} phanTho={phanTho}
          act={{ freezeTo, freezeRowTo, rename, find: () => setFind(f => f || { q: '', rep: '', n: 0 }), exportXlsx: () => A.ptExportXlsx(tpl) }}
          onClose={() => setPop(null)} />
      )}
      {visible && selKeys.length > 0 && <PtBulkBar sel={selKeys} phanTho={phanTho} onAll={selAll} />}
    </div>
  )
}
