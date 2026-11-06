import { useEffect, useLayoutEffect, useRef } from 'react'
import Icon from '../../../../components/ui/Icon'
import { money } from '../../lib/format.js'
import { bgDocW_ } from '../../lib/quote.js'
import { docScreenCss, bgFontHref_, fitA4_, balanceCols_ } from './docCss'
import { hDoGhi_, hChoGhi_ } from './docModel'
import { useQuoteUi, bgGoPage, bgSetZoom_, bgSetView, setColW, setQ } from './quoteState'
import { bgColDrop } from './quoteActions'
import { qsToast as toastMsg, qsConfirm } from '../common/dialogs'
import { tuyGop_, tuyLuuToanBo } from './tuyMau'
import { bgCfgRaw } from './quoteActions'

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

/* Thanh sheet (như sheet Excel): mỗi phần của báo giá (tờ bìa, từng hạng mục, phần thô, trang bìa sau) là 1 thẻ kèm khoảng trang;
   các trang liền nhau cùng tên (meta.ten) gom 1 thẻ, bấm thẻ nhảy tới trang đầu của phần đó */
function Sheets({ pages, cur }) {
  const ds = []
  pages.forEach((p, i) => {
    const ten = (p.meta && p.meta.ten) || 'Trang'
    const d = ds[ds.length - 1]
    if (d && d.ten === ten) d.cuoi = i + 1
    else ds.push({ ten, dau: i + 1, cuoi: i + 1 })
  })
  if (ds.length <= 1) return <div className="qsq-sheets" />
  return (
    <div className="qsq-sheets" role="tablist" aria-label="Phần của báo giá">
      {ds.map(d => {
        const on = cur >= d.dau && cur <= d.cuoi
        return (
          <button type="button" role="tab" aria-selected={on} key={d.dau} className={on ? 'on' : ''} onClick={() => bgGoPage(d.dau)}
            title={d.ten + ' - trang ' + d.dau + (d.cuoi > d.dau ? '–' + d.cuoi : '')}>
            {d.ten}<small>{d.dau}{d.cuoi > d.dau ? '–' + d.cuoi : ''}</small>
          </button>
        )
      })}
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
  const kho = (chu && chu.kho) || { w: 1123, h: 794, nhan: 'A4 · Ngang' }   // khổ in (bgKho_)

  /* Mức phóng: 100% (= Vừa khung) là trang rộng đúng bề ngang khung xem; 50–150% tính theo bề ngang đó */
  useLayoutEffect(() => {
    const box = vpRef.current; const doc = docRef.current
    if (!box || !doc) return undefined
    const apply = () => {
      const rong = box.clientWidth - 18
      const vua = rong > 0 ? rong / kho.w : 1
      doc.style.zoom = vua * (z === 'fit' ? 1 : (Number(z) || 100) / 100)
    }
    apply()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(apply)
    ro.observe(box)
    return () => ro.disconnect()
  }, [z, kho.w])
  /* Khung đúng khổ in (mặc định A4 ngang 1123 x 794): trang nhiều chữ thì thu nhỏ nội dung cho vừa (fitA4_), chạy lại khi trang vẽ lại và khi font tải xong */
  /* Đo chiều cao THẬT từng dòng bảng: dựng ẩn đủ mọi trang (khung cao 0, cùng CSS xem trước, cân cột như trang thật), đọc chiều cao
     các dòng có data-hk rồi ghi vào docModel (hDoGhi_) -> trang được chia lại theo số đo, mọi trang giữ cỡ chữ gốc (không phải thu nhỏ) */
  const doRef = useRef(null)
  useLayoutEffect(() => {
    const an = doRef.current
    if (!an) return undefined
    const run = () => {
      an.innerHTML = pages.map(x => x.html).join('')
      ;[].slice.call(an.querySelectorAll('table.qsd-qx-tbl:not(.qsd-qx-cover)')).forEach(tb => { try { balanceCols_(tb, window) } catch (e) { /* bỏ qua */ } })
      // chiều cao phần tử có data-hk (dòng bảng; khối không phải dòng như hộp tổng tiền thì cộng cả lề trên / dưới)
      const ds = [].slice.call(an.querySelectorAll('[data-hk]')).map(x => {
        let hh = x.getBoundingClientRect().height
        if (x.tagName !== 'TR') { const cs = getComputedStyle(x); hh += (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0) }
        return [x.getAttribute('data-hk'), hh]
      })
      /* chỗ trống cho bảng chi tiết = từ mép trên bảng tới mép trên chân trang - 8 (nhỏ nhất trong các trang có bảng chi tiết);
         docModel chia trang theo số này -> mọi trang giữ cỡ chữ gốc */
      let cho = null; let cho1 = null
      ;[].slice.call(an.querySelectorAll('.qsd-pg')).forEach(pg => {
        pg.style.height = kho.h + 'px'
        const r0 = pg.getBoundingClientRect()
        const foot = pg.querySelector('.qsd-qp-foot')
        const day = foot ? foot.getBoundingClientRect().top - r0.top - 8 : pg.clientHeight - (parseFloat(getComputedStyle(pg).paddingBottom) || 0)
        // trang 1 (tờ bìa): chỗ trống từ mép trên bảng hạng mục
        const bia = pg === an.firstElementChild ? pg.querySelector('table.qsd-qx-cover') : null
        if (bia) cho1 = day - (bia.getBoundingClientRect().top - r0.top)
        const tr = pg.querySelector('table.qsd-qx-tbl:not(.qsd-qx-cover):not(.qsd-qx-totbox) tr[data-hk]')
        if (tr) {
          const c = day - (tr.closest('table').getBoundingClientRect().top - r0.top)
          if (cho == null || c < cho) cho = c
        }
      })
      an.innerHTML = ''
      hDoGhi_(ds)
      hChoGhi_(cho, cho1)
    }
    run()
    let alive = true
    try { document.fonts.ready.then(() => { if (alive) run() }) } catch (e) { /* trình duyệt cũ: bỏ qua */ }
    return () => { alive = false }
  }, [pages, mau, chu])
  useLayoutEffect(() => {
    const doc = docRef.current
    if (!doc) return undefined
    // trang đã chia vừa khổ nên không thu nhỏ; fitA4_ chỉ là lưới an toàn khi một trang vẫn tràn
    fitA4_(doc, kho.h)
    let alive = true
    try { document.fonts.ready.then(() => { if (alive) fitA4_(doc, kho.h) }) } catch (e) { /* trình duyệt cũ: bỏ qua */ }
    return () => { alive = false }
  }, [pg.html, mau, chu])
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

  /* Lưu làm mặc định hệ thống: cài đặt đang thấy của bản nháp này (đã gộp mặc định cũ) thành mặc định công ty cho mọi bản nháp
     chưa tự đặt; không gồm phần riêng của bản nháp (mục ẩn trên bìa, chiết khấu, ngày báo giá, số sửa tay, dòng thông tin thêm) */
  async function luuMacDinhHT() {
    if (!await qsConfirm({ title: 'Lưu cài đặt Xuất báo giá hiện tại làm MẶC ĐỊNH của hệ thống?',
      note: 'Gồm tờ bìa, logo, trang chi tiết, cột riêng từng hạng mục, tuỳ biến (màu, font, khung), tổng kết & chữ ký. Bản nháp chưa tự chỉnh mục nào sẽ dùng cài đặt này. Không gồm mục ẩn trên bìa, chiết khấu, ngày báo giá.',
      ok: 'Lưu mặc định' })) return
    if (await tuyLuuToanBo(tuyGop_(bgCfgRaw()))) toastMsg('Đã lưu cài đặt hiện tại làm mặc định hệ thống')
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
        {m.dong ? <span className="qsq-chip">{giua[0]}</span> : null}
        <span className="qsq-chip">{vp ? 'VAT ' + vp + '%' : 'Chưa VAT'}</span>
        <span className="qsq-chip">{kho.nhan}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="qs-qt-btn qsq-dan" onClick={luuMacDinhHT}
          title="Lưu toàn bộ cài đặt Xuất báo giá đang dùng (tờ bìa, logo, trang chi tiết, tuỳ biến, tổng kết, chữ ký) làm mặc định của hệ thống">
          <Icon name="check" size={15} />Lưu làm mặc định
        </button>
        <button type="button" className="qs-qt-btn qsq-dan" onClick={danToiUu}
          title="Dàn trang tối ưu: tự chia bề rộng cột theo nội dung — tiêu đề cột tối đa 3 dòng, chữ dễ đọc (áp dụng cả file xuất)">
          <Icon name="fitWidth" size={15} />Dàn trang tối ưu
        </button>
        {/* Thu phóng: nút Vừa khung + thanh kéo 50–150% (không ảnh hưởng file xuất) */}
        <div className="qsq-zoom" title="Phóng to / thu nhỏ trang xem trước (không ảnh hưởng file xuất)">
          <button type="button" className={z === 'fit' ? 'on' : ''} onClick={() => bgSetZoom_('fit')}>Vừa khung</button>
          <input type="range" min="50" max="150" step="5" value={z === 'fit' ? 100 : Number(z) || 100}
            onChange={e => bgSetZoom_(e.target.value)} aria-label="Mức thu phóng" />
          <b>{z === 'fit' ? 100 : Number(z) || 100}%</b>
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
        {/* khung ẩn đo chiều cao dòng (cao 0, không chiếm chỗ cuộn, không phóng to / thu nhỏ); display:block: .qsd-doc mặc định là flex hàng ngang,
            dựng nhiều trang trong đó các trang bị co hẹp -> dòng đo cao vọt, chia ra mỗi trang 1 dòng */}
        <div aria-hidden="true" style={{ height: 0, overflow: 'hidden', visibility: 'hidden' }}><div className="qsd-doc" ref={doRef} style={{ display: 'block' }} /></div>
      </div>
      <div className="qsq-foot"><Sheets pages={pages} cur={page} /><div className="qsq-pgw"><Pager total={N} cur={page} /><span className="qsq-pn">Trang {page} / {N}</span></div></div>
    </main>
  )
}
