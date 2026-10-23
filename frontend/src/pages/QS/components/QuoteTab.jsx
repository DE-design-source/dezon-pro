import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { useQs } from '../state/QsData'
import { useQsStore } from '../state/store'
import { giaLechList_ } from '../lib/bocSync.js'
import { coverCosts } from '../lib/quote.js'
import { useTkCols } from './breakdown/sheet/tkCols'
import { PriceSyncModal } from './breakdown/sheet/SyncPops'
import { useQuoteUi, coverEnsure } from './quote/quoteState'
import { quoteModel } from './quote/quoteModel'
import { doExport, printDoc } from './quote/quoteActions'
import QuoteSide from './quote/QuoteSide'
import QuotePreview, { ModeSeg } from './quote/QuotePreview'
import CoverEditor from './quote/CoverEditor'
import DetailEditor, { AreaTable } from './quote/DetailEditor'
import { HistoryModal, VersionView } from './quote/HistoryModal'
import { bgChu_ } from './quote/docCss'
import './quote/quote.css'

/* Tab "Xuất báo giá" (PUB/baogia.js): chế độ "Xem trước & Xuất" = 2 cột (5 thẻ thiết lập + trang giấy A4 ngang, renderExport /
   drawBaogia 794-827) và chế độ "Chỉnh sửa" = tờ bìa sửa trực tiếp + bảng diện tích + bảng chi tiết (828-865).
   Dữ liệu: dòng của dự án (store), tờ bìa (API cover), projData bgCfg / bgHist / bgOrg / area; giao diện trong quote/quoteState. */
export default function QuoteTab() {
  const { cur, lines, projData, projects, products, node, panelVisible, visibleSeq } = useQs()
  const congTy = useQsStore(s => s.congTy)
  const me = useQsStore(s => s.me)
  const q = useQuoteUi()
  const tk = useTkCols()
  const [pop, setPop] = useState(null)
  const xRef = useRef(null)
  const visible = panelVisible('export')
  const seq = visibleSeq('export')
  const maDA = cur ? cur.maDA : ''

  /* renderExport: tờ bìa chưa nạp cho dự án đang mở -> getCoverOrInit (chỉ khi tab đang hiện) */
  useEffect(() => { if (visible && maDA) coverEnsure(maDA) }, [visible, maDA, seq])

  const m = useMemo(() => quoteModel({ cur, lines, projData, congTy, me, node }, q, tk, null), [cur, lines, projData, congTy, me, node, q, tk])
  const pages = useMemo(() => (cur && !m.ptErr ? m.pages() : []), [m, cur])

  /* Khung 2 cột cao vừa tới đáy vùng cuộn (bgVpApply_ 582-589): cột trái tự cuộn, nút xuất dính đáy */
  useLayoutEffect(() => {
    const x = xRef.current
    if (!x) return undefined
    const sc = x.closest('.qs-scroll')
    const apply = () => {
      if (!x.offsetParent || !sc) return
      const zf = x.getBoundingClientRect().width / (x.offsetWidth || 1) || 1
      const top = (x.getBoundingClientRect().top - sc.getBoundingClientRect().top) / zf + sc.scrollTop
      x.style.height = Math.max(420, Math.floor(sc.clientHeight - top - 10)) + 'px'
    }
    apply()
    window.addEventListener('resize', apply)
    let ro = null
    if (typeof ResizeObserver !== 'undefined' && sc) {
      ro = new ResizeObserver(apply)
      ro.observe(sc)
      if (sc.firstElementChild && sc.firstElementChild !== x.parentElement) ro.observe(sc.firstElementChild)
    }
    return () => { window.removeEventListener('resize', apply); if (ro) ro.disconnect() }
  })

  async function onExport(fmt) {
    if (fmt === 'pdf') { printDoc(); return }
    const lech = giaLechList_(lines, products)
    const r = await doExport('xlsx', lech)
    if (r === 'gia') setPop({ kind: 'gia', ds: lech })
  }

  if (!cur) return <div className="qs-card qsq-empty">Chưa chọn dự án.</div>
  if (q.cover.maDA === maDA && q.cover.status === 'error') {
    return (
      <div className="qs-card qsq-empty">Lỗi tải tờ bìa: {q.cover.error}<br />
        <button type="button" className="qs-qt-btn" onClick={() => coverEnsure(maDA, true)}><Icon name="refresh" size={13} />Thử lại</button></div>
    )
  }
  if (q.cover.maDA !== maDA || q.cover.status !== 'ok') return <div className="qs-card qsq-empty">Đang tải tờ bìa…</div>
  /* Bảng Phần thô hỏng: bản gốc vỡ cả trang (kẹt "Đang tải tờ bìa…"); ở đây báo rõ như tab Phần thô.
     Cả 2 chế độ đều dựng trang / đếm dòng Phần thô (bgPTSecs_) nên chặn chung ở đây. */
  if (m.ptErr) return <div className="qs-card qsq-empty" role="alert">Bảng Phần thô lưu trên máy chủ bị hỏng: {m.ptErr}</div>

  const modals = (
    <>
      {pop && pop.kind === 'hist' && <HistoryModal onClose={() => setPop(null)} onView={v => setPop({ kind: 'ver', v })} />}
      {pop && pop.kind === 'ver' && <VersionView v={pop.v} onClose={() => setPop({ kind: 'hist' })} />}
      {pop && pop.kind === 'gia' && <PriceSyncModal ds={pop.ds} onClose={() => setPop(null)} />}
    </>
  )

  if (q.bgView !== 'edit') {
    return (
      <>
        <div className={`qsq-x${q.bgFull ? ' full' : ''}`} key="doc" ref={xRef}>
          <QuoteSide m={m} pages={pages.length} tk={tk} projects={projects} onExport={onExport} onHist={() => setPop({ kind: 'hist' })} />
          <QuotePreview pages={pages} mau={m.mau} chu={bgChu_(m.ctx.bgCfg)} vat={cur.vat} onExport={onExport} />
        </div>
        {modals}
      </>
    )
  }
  return (
    <>
      <div className="qsq-segrow" key="edit"><ModeSeg /></div>
      <CoverEditor ctx={m.ctx} comp={coverCosts(m.ctx)} coverMau={q.coverMau} />
      <AreaTable projData={projData} />
      <DetailEditor ctx={m.ctx} tk={tk} nganh={m.ui.nganh} onExport={onExport} exporting={q.exporting} />
      {modals}
    </>
  )
}
