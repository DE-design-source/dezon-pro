import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import { money } from '../../lib/format.js'
import { bgDocW_ } from '../../lib/quote.js'
import { docScreenCss, bgFontHref_ } from './docCss'
import { useQuoteUi, bgGoPage, bgSetZoom_, bgSetView, setColW, setQ } from './quoteState'
import { bgColDrop } from './quoteActions'
import { qsToast as toastMsg } from '../common/dialogs'

/* Cột phải của "Xem trước & Xuất" (bgDocHTML PUB/baogia.js:503-523): thanh trên (tên trang, chip, mức phóng, Xem trước / Chỉnh sửa),
   vùng xem 1 trang giấy, chân phân trang (bgPager 495-502). CSS tài liệu nằm trong <style> của chính vùng xem (không vào document.head),
   mọi selector có tiền tố .qsq-vp [F1]. Kéo đầu cột đổi chỗ / kéo mép chỉnh rộng: bgColDragStart / bgColDrop / mousedown .qxrsz 341-381.
   Props: pages [{html, meta}], mau (màu chủ đạo), chu ({font, co} - bgChu_: font + cỡ chữ báo giá), vat (VAT dự án) */
const SCOPE = '.qsq-vp'
const ZOOMS = [['fit', 'Vừa khung'], ['75', '75%'], ['100', '100%'], ['125', '125%']]

/* Xem trước & Xuất: đang ở chế độ xem thì bấm lại = bật / tắt XEM TOÀN KHUNG (ẩn cột thiết lập, trang chiếm hết chiều ngang,
   có nút Xuất Excel / PDF ngay trên thanh); Chỉnh sửa = sang chế độ sửa tờ bìa / bảng */
export function ModeSeg() {
  const q = useQuoteUi()
  const xem = () => (q.bgView === 'doc' ? setQ(s => ({ bgFull: !s.bgFull })) : bgSetView('doc'))
  return (
    <div className="qs-qt-mode">
      <button type="button" className={q.bgView === 'doc' ? 'on' : ''} onClick={xem}
        title={q.bgView === 'doc' ? (q.bgFull ? 'Thoát xem toàn khung' : 'Xem toàn khung (ẩn cột thiết lập) để kiểm tra trước khi xuất') : 'Xem trước trang báo giá'}><Icon name="eye" size={14} />Xem trước &amp; Xuất</button>
      <button type="button" className={q.bgView === 'edit' ? 'on' : ''} onClick={() => bgSetView('edit')}><Icon name="sliders" size={14} />Chỉnh sửa</button>
    </div>
  )
}

function Pager({ total, cur }) {
  if (total <= 1) return null
  const set = []
  for (let n = 1; n <= total; n++) if (n === 1 || n === total || Math.abs(n - cur) <= 1) set.push(n)
  const out = []; let prev = 0
  set.forEach(n => {
    if (n - prev > 1) out.push(<span key={'e' + n} className="ell">…</span>)
    out.push(<button type="button" key={n} className={n === cur ? 'on' : ''} onClick={() => bgGoPage(n)}>{n}</button>)
    prev = n
  })
  return (
    <div className="qsq-pgr">
      {cur > 1 && <button type="button" onClick={() => bgGoPage(cur - 1)}>←</button>}
      {out}
      {cur < total && <button type="button" onClick={() => bgGoPage(cur + 1)}>→</button>}
    </div>
  )
}

/* khoá cột của 1 bảng đang hiện (bỏ cột STT đầu tiên); rỗng nếu không phải bảng chi tiết (bgThKeys_) */
function thKeys(t) {
  if (!t) return []
  const ths = [].slice.call(t.querySelectorAll('th')); if (ths.length < 2) return []
  const ks = ths.slice(1).map(th => th.getAttribute('data-k'))
  return ks.every(Boolean) ? ks : []
}

/* nạp font Google riêng của báo giá (font khác font Cài đặt chung) vào trang, 1 link dùng lại theo id
   (qs-bg-font: font báo giá; qs-bg-font-logo: font chữ logo ở chế độ Chỉ tên) */
export function useBgFontLink(font, id = 'qs-bg-font') {
  useEffect(() => {
    const href = font ? bgFontHref_(font) : null
    let link = document.getElementById(id)
    if (!href) { if (link) link.remove(); return }
    if (!link) { link = document.createElement('link'); link.id = id; link.rel = 'stylesheet'; document.head.appendChild(link) }
    if (link.getAttribute('href') !== href) link.setAttribute('href', href)
  }, [font, id])
}

export default function QuotePreview({ pages, mau, chu, vat, onExport }) {
  useBgFontLink(chu && chu.font)
  const q = useQuoteUi()
  const vpRef = useRef(null)
  const docRef = useRef(null)
  const dragK = useRef(null)
  const shownPage = useRef(0)
  const N = pages.length
  const page = q.bgPage >= 1 && q.bgPage <= N ? q.bgPage : 1
  const pg = pages[page - 1] || { html: '', meta: {} }
  const m = pg.meta || {}
  const vp = Number(vat) || 0
  const z = String(q.bgZoom || 'fit')
  const [zFit, setZFit] = useState(100)   // % thật của chế độ Vừa khung (để thanh kéo bắt đầu đúng chỗ)

  /* Mức phóng (bgZoomApply_ 399-406): fit = vừa bề ngang khung xem, không lớn hơn 100% */
  useLayoutEffect(() => {
    const box = vpRef.current; const doc = docRef.current
    if (!box || !doc) return undefined
    const apply = () => {
      let v
      if (z === 'fit') { const rong = box.clientWidth - 18; v = rong > 0 ? Math.min(1, rong / 1123) : 1 } else v = (Number(z) || 100) / 100
      doc.style.zoom = v
      if (z === 'fit') setZFit(Math.round(v * 100))
    }
    apply()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(apply)
    ro.observe(box)
    return () => ro.disconnect()
  }, [z])
  /* Đổi trang thì về đầu trang (bgGoPage 130); vẽ lại cùng trang thì giữ chỗ đang cuộn */
  useLayoutEffect(() => {
    if (shownPage.current !== page && vpRef.current) { vpRef.current.scrollTop = 0; vpRef.current.scrollLeft = 0 }
    shownPage.current = page
  }, [page])

  function onDragStart(e) {
    const th = e.target.closest && e.target.closest('th[draggable]')
    if (!th) return
    if (e.target.closest('.qsd-qxrsz')) { e.preventDefault(); return }
    dragK.current = th.getAttribute('data-k')
    try { e.dataTransfer.setData('text/plain', dragK.current) } catch (x) { /* bỏ qua */ }
  }
  function onDrop(e) {
    const th = e.target.closest && e.target.closest('th[data-k]')
    e.preventDefault()
    const from = dragK.current; dragK.current = null
    if (th && from) bgColDrop(from, th.getAttribute('data-k'))
  }
  /* Kéo mép phải của đầu cột để chỉnh rộng: vẽ lại bề rộng MỌI bảng đang hiện, thả chuột mới lưu (qs_bgdoc) */
  function onMouseDown(e) {
    const rs = e.target.closest && e.target.closest('.qsd-qxrsz'); if (!rs) return
    e.preventDefault(); e.stopPropagation()
    const k = rs.getAttribute('data-k'); const sx = e.clientX
    const w = { ...(q.bgColW || {}) }
    const sw = bgDocW_(k, w)
    const tb = rs.closest('table'); const rong = tb ? tb.getBoundingClientRect().width : 900
    const ksTb = thKeys(tb)
    const heSo = (rong && ksTb.length) ? ((30 + ksTb.reduce((a, x) => a + bgDocW_(x, w), 0)) / rong) : 1
    const ve = () => {
      docRef.current.querySelectorAll('table.qsd-qx-tbl').forEach(t => {
        const ks = thKeys(t); if (!ks.length) return
        const co = t.querySelectorAll('colgroup col'); if (co.length !== ks.length + 1) return
        const tong = 30 + ks.reduce((a, x) => a + bgDocW_(x, w), 0)
        co[0].style.width = (30 / tong * 100).toFixed(3) + '%'
        ks.forEach((x, i) => { co[i + 1].style.width = (bgDocW_(x, w) / tong * 100).toFixed(3) + '%' })
      })
    }
    const mv = ev => { w[k] = Math.max(22, Math.round(sw + (ev.clientX - sx) * heSo)); ve() }
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); setColW(w, true) }
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up)
  }

  /* Dàn trang tối ưu (như Xem tối ưu ở Bóc tách): tính lại bề rộng mọi cột của bảng chi tiết theo chữ thật —
     tiêu đề cột tối đa 3 dòng, cột chữ ~6 chữ / dòng (không rộng hơn nội dung), cột số đủ cho số dài nhất trên 1 dòng;
     dư chỗ thì chia thêm cho cột chữ, thiếu chỗ thì co cột chữ (không dưới mức tiêu đề). Ghi vào bề rộng cột (lưu như kéo tay) */
  function danToiUu() {
    const root = docRef.current; if (!root) return
    const tbs = [].slice.call(root.querySelectorAll('table.qsd-qx-tbl')).filter(t => thKeys(t).length)
    if (!tbs.length) { toastMsg('Trang này không có bảng chi tiết để dàn'); return }
    const ks = thKeys(tbs[0])
    const ctx = document.createElement('canvas').getContext('2d')
    const th0 = tbs[0].querySelectorAll('th')[1]
    const hFont = th0 ? getComputedStyle(th0).font : '600 9px sans-serif'
    const need = {}; const minH = {}; const isNum = {}
    ks.forEach((k, i) => {
      /* tiêu đề: bề rộng nhỏ nhất để chữ IN HOA xếp <= 3 dòng (+ giãn chữ .05em, đệm 16) */
      ctx.font = hFont
      const th = tbs[0].querySelectorAll('th')[i + 1]
      const ww = String((th && th.textContent) || '').toUpperCase().trim().split(/\s+/).filter(Boolean).map(w => ctx.measureText(w).width + w.length * 0.45)
      const sp = ctx.measureText(' ').width
      const lines = W => { let n = 1, cur = 0; ww.forEach(w => { if (cur && cur + sp + w > W) { n++; cur = w } else cur = cur ? cur + sp + w : w }); return n }
      let lo = ww.length ? Math.max(...ww) : 20; let hi = ww.reduce((a, w) => a + w, 0) + sp * ww.length
      if (lines(lo) > 3) { while (hi - lo > 1) { const mid = (lo + hi) / 2; if (lines(mid) <= 3) hi = mid; else lo = mid } lo = hi }
      minH[k] = Math.ceil(lo) + 18
      /* nội dung */
      let mx = 0; let num = false; let fontSet = false
      tbs.forEach(t => t.querySelectorAll('tr').forEach(tr => {
        const tds = tr.querySelectorAll('td'); if (tds.length !== ks.length + 1) return
        const td = tds[i + 1]; if (!fontSet) { ctx.font = getComputedStyle(td).font; fontSet = true }
        if (td.classList.contains('qsd-num') || td.classList.contains('num')) num = true
        String(td.innerText || '').split('\n').forEach(x => { mx = Math.max(mx, ctx.measureText(x.trim()).width) })
      }))
      isNum[k] = num || k === 'hinhAnh' || k === 'dvt'
      const sample = ctx.measureText('Dòng sản phẩm đèn âm trần').width
      const body = k === 'hinhAnh' ? 56 : (isNum[k] ? mx : Math.min(mx, sample)) + 18
      need[k] = Math.max(minH[k], Math.ceil(body))
    })
    const W = tbs[0].offsetWidth - 30
    let tong = ks.reduce((a, k) => a + need[k], 0)
    const w = { ...need }
    const chu = ks.filter(k => !isNum[k])
    if (tong < W && chu.length) {
      const them = (W - tong) / chu.length
      chu.forEach(k => { w[k] = Math.round(w[k] + them) })
    } else if (tong > W) {
      for (let pass = 0; pass < 6 && tong > W + 0.5; pass++) {
        const co = chu.filter(k => w[k] > minH[k] + 0.5); if (!co.length) break
        const cur = co.reduce((a, k) => a + w[k], 0); const kk = Math.max(0, (cur - (tong - W)) / cur)
        co.forEach(k => { w[k] = Math.max(minH[k], Math.round(w[k] * kk)) })
        tong = ks.reduce((a, k) => a + w[k], 0)
      }
    }
    setColW({ ...(q.bgColW || {}), ...w }, true)
    toastMsg('Đã dàn trang tối ưu cho ' + ks.length + ' cột')
  }
  const giua = [m.dong ? m.dong + ' dòng · ' + money(m.tien || 0) + ' đ' : '']
  return (
    <main className="qsq-main">
      <div className="qsq-bar">
        <b className="qsq-ten">{m.ten || 'Trang ' + page}</b>
        {page === 1 && <span className="qsq-chip">{q.coverMau === 'm1' ? 'Mẫu 1' : 'Mẫu 2'}</span>}
        {m.dong ? <span className="qsq-chip">{giua[0]}</span> : null}
        <span className="qsq-chip">{vp ? 'VAT ' + vp + '%' : 'Chưa VAT'}</span>
        <span className="qsq-chip">A4 · Ngang</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="qs-qt-btn qsq-dan" onClick={danToiUu}
          title="Dàn trang tối ưu: tự chia bề rộng cột theo nội dung — tiêu đề cột tối đa 3 dòng, chữ dễ đọc (áp dụng cả file xuất)">
          <Icon name="fitWidth" size={15} />Dàn trang tối ưu
        </button>
        {/* Thu phóng: nút Vừa khung + thanh kéo 50–150% (không ảnh hưởng file xuất) */}
        <div className="qsq-zoom" title="Phóng to / thu nhỏ trang xem trước (không ảnh hưởng file xuất)">
          <button type="button" className={z === 'fit' ? 'on' : ''} onClick={() => bgSetZoom_('fit')}>Vừa khung</button>
          <input type="range" min="50" max="150" step="5" value={z === 'fit' ? zFit : Number(z) || 100}
            onChange={e => bgSetZoom_(e.target.value)} aria-label="Mức thu phóng" />
          <b>{z === 'fit' ? zFit : Number(z) || 100}%</b>
        </div>
        {q.bgFull && onExport && (
          <>
            <button type="button" className="qs-qt-btn green" onClick={() => onExport('xlsx')}><Icon name="download" size={14} />Excel</button>
            <button type="button" className="qs-qt-btn red" onClick={() => onExport('pdf')}><Icon name="download" size={14} />PDF / In</button>
          </>
        )}
        <ModeSeg />
      </div>
      <div className="qsq-vp" ref={vpRef}>
        <style>{docScreenCss(mau, SCOPE, chu)}</style>
        <div className="qsd-doc" ref={docRef} onDragStart={onDragStart} onDragOver={e => e.preventDefault()} onDrop={onDrop} onMouseDown={onMouseDown}
          dangerouslySetInnerHTML={{ __html: pg.html }} />
      </div>
      <div className="qsq-foot"><Pager total={N} cur={page} /><span className="qsq-pn">Trang {page} / {N}</span></div>
    </main>
  )
}
