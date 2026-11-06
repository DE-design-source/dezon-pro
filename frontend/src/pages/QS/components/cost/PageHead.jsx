import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../../../../components/ui/Icon'
import HmPicker from '../purchase/HmPicker'
import ChangeInput from '../purchase/ChangeInput'
import '../purchase/purchase.css'
import { useFold, foldToggle_ } from '../project/projectShell'
import { setQbSlotEl, useQbSlotEl } from '../project/qbSlot'
import { nodeName } from '../../lib/tree.js'
import { money, pad2 } from '../../lib/format.js'
import { hmLac_, hmSaiNganh_, hmSaiFields_ } from '../../lib/totals.js'
import * as api from '../../api/qsApi'
import { setState, getState } from '../../state/store'
import { qsToast, qsConfirm } from '../common/dialogs'

/* Một ô số liệu của dải tổng (pgStat_ PUB/chiphi.js:33) */
export function Stat({ label, value, cls }) {
  return <span className={`qs-po-stat${cls ? ' ' + cls : ''}`}><i>{label}</i><b>{value}</b></span>
}
/* Ô VAT dự án trong dải tổng (pgVat_ chiphi.js:34-36): ghi khi rời ô / Enter như onchange.
   amountNode (tuỳ chọn) thay số tiền khi dữ liệu dự án chưa tải xong / tải lỗi */
export function VatStat({ vatPct, amount, onVat, amountNode }) {
  return (
    <span className="qs-po-stat">
      <i>VAT <ChangeInput className="qs-po-vat" type="number" step="any" min="0" value={vatPct} title="Thuế VAT (%)" onCommit={onVat} />%</i>
      <b>{amountNode || (money(amount) + ' đ')}</b>
    </span>
  )
}

/* Phần thô tính lỗi (cpTong_ trả ptErr): bản gốc nuốt lỗi và cộng 0, ở đây báo rõ như Bảng điều khiển */
export function PtErrNote({ msg }) {
  if (!msg) return null
  return (
    <div className="qs-po-note qs-cp-errnote" role="alert">
      <Icon name="layers" size={15} />
      <span>Phần thô lỗi, chưa tính vào tổng: {msg}</span>
    </div>
  )
}

/* Hàng đầu trang Chi phí / Dự án (pgHeadRow_ PUB/chiphi.js:9-17): "Hạng mục đã bóc [n]" + ô chọn hạng mục dùng chung (hmNode)
   + công tắc Bảng tính | Bảng thường (qs_bt_mode, chung mọi bảng) + dải số liệu (gập ở qs_fold.totals).
   Props: n, hm, lines (mọi dòng dự án, để đếm trong ô chọn), onHm(code), view ('sheet' | 'plain'), onView(v), stats (node),
   slotKey (tab 'chiphi' | 'duan'): mở chỗ cho ô tìm kiếm (giữa hàng) + nút Xuất báo giá (cuối hàng) của thanh công cụ nhanh (qbSlot.js).
   Băng dự án đang mở rộng (PCard có chỗ 'pc:<slotKey>'): "Hạng mục đã bóc" + nút chọn hạng mục và kiểu bảng + colTools (cột hiển thị,
   tab đưa vào) lên băng như Bóc tách (2 khung .qs-pc-mod); hàng này chỉ còn ô tìm, dải số liệu, Xuất báo giá.
   barStats [{label, value, tone ('pos' | 'neg' | 'low' | 'total'), cls, inline}]: các số đưa lên khung tiền của băng khi có chỗ
   'pcm:<slotKey>' (Chi phí: Vốn · Giá bán · Lợi nhuận · Biên · VAT · Tổng); không có chỗ thì hiện ở dải số liệu như cũ
   (inline = phần tử thay ô Stat, cls = lớp của ô Stat). Đã lên băng thì hàng này bỏ luôn nút gập dải số liệu. */
export default function PageHead({ n, hm, lines, onHm, view, onView, stats, barStats, slotKey, colTools }) {
  const pcEl = useQbSlotEl(slotKey ? 'pc:' + slotKey : '')
  const moneyEl = useQbSlotEl(slotKey ? 'pcm:' + slotKey : '')
  const bs = barStats || []
  const onMoney = moneyEl && bs.length ? (
    <div className="qs-bd-totals">
      {bs.map(s => (
        <span key={s.label} className={'qs-bd-tg' + (s.tone ? ' ' + s.tone : '')}>
          <span className="qs-bd-tl"><span className="qs-bd-muted">{s.label}</span></span><b>{s.value}</b>
        </span>
      ))}
    </div>
  ) : null
  const [pop, setPop] = useState(null)
  const slotRef = useCallback(node => { if (slotKey) setQbSlotEl(slotKey, node) }, [slotKey])
  const folded = useFold('totals')
  const lbl = hm ? hm + '.' + (nodeName(hm) || hm) : 'Tất cả hạng mục'
  const catBtn = (
    <button type="button" className={`qs-bd-category${hm ? ' on' : ''}`} title="Chọn hạng mục"
      onClick={e => { const b = e.currentTarget; setPop(p => (p ? null : b)) }}>
      <b>{lbl}</b>
      <span className="qs-bd-count">[{pad2(n)}]</span>
      <span style={{ flex: 1 }} />
      <span className="qs-bd-acc-plus"><Icon name="plus" size={10} stroke={3} /></span>
    </button>
  )
  const seg = (
    <div className="qs-bd-seg" title="Chọn kiểu bảng — máy sẽ nhớ">
      <button className={view === 'sheet' ? 'on' : ''} onClick={() => onView('sheet')}><Icon name="table" size={15} /><span className="qs-bd-seg-t">Bảng tính</span></button>
      <button className={view === 'plain' ? 'on' : ''} onClick={() => onView('plain')}><Icon name="listLines" size={15} /><span className="qs-bd-seg-t">Bảng thường</span></button>
    </div>
  )
  const onBar = (
    <span className="qs-bd-node">
      <span className="qs-pc-mod m-node">
        <span className="qs-bd-node-lbl"><span className="qs-bd-h">Hạng mục đã bóc</span><span className="qs-bd-count">[{pad2(n)}]</span></span>
        {catBtn}
      </span>
      <span className="qs-pc-mod m-view">{seg}{colTools && <span className="qs-bd-head-cols">{colTools}</span>}</span>
    </span>
  )
  const picker = pop && <HmPicker anchor={pop} cur={hm} lines={lines} onClose={() => setPop(null)} onPick={code => { setPop(null); onHm(code) }} />
  /* Mọi thứ đã lên băng (hạng mục, kiểu bảng, số tiền) và không còn dải số liệu: bỏ hẳn hàng này (ô tìm đã xuống hàng công cụ) */
  if (pcEl && onMoney && !stats) return <>{createPortal(onBar, pcEl)}{createPortal(onMoney, moneyEl)}{picker}</>
  return (
    <div className="qs-card qs-ct-bar qs-po-head qs-cp-head">
      {pcEl ? createPortal(onBar, pcEl) : <>
        <span className="qs-ct-title">Hạng mục đã bóc</span>
        <span className="qs-bd-count">[{pad2(n)}]</span>
        {catBtn}
        {seg}
      </>}
      <div className="qs-qb-slot" ref={slotRef} />
      {!folded && !(onMoney && !stats) && <div className="qs-po-stats">{!onMoney && bs.map(s => s.inline || <Stat key={s.label} label={s.label} value={s.value} cls={s.cls || (s.tone ? 'qs-cp-ln ' + s.tone : undefined)} />)}{stats}</div>}
      {onMoney && createPortal(onMoney, moneyEl)}
      {!(onMoney && !stats) && (
        <button type="button" className={`qs-bd-round-btn accent${folded ? ' on' : ''}`} title={(folded ? 'Mở lại ' : 'Thu gọn ') + 'dải tổng tiền'}
          onClick={() => foldToggle_('totals')}><Icon name="chevronDown" size={14} /></button>
      )}
      {picker}
    </div>
  )
}

/* Lời nhắc hạng mục Phần thô (hmPTNote_ chiphi.js:231-237) */
export function PtNote({ hm, onBoc }) {
  if (hm !== '3.1') return null
  return (
    <div className="qs-po-note">
      <Icon name="layers" size={15} />
      <span><b>Hạng mục Phần thô</b> có bảng ước tính riêng — số tổng phía trên đã gồm Phần thô, còn bảng chi tiết từng công tác nằm ở Bóc tách. Xem và sửa ở tab <b>Bóc tách</b>, hoặc chọn hạng mục khác ở ô bên trên.</span>
      <button type="button" className="qs-qt-btn" onClick={onBoc}>Mở Bóc tách</button>
    </div>
  )
}

/* Đang lọc 1 hạng mục mà bảng trống trong khi dự án vẫn có dòng ở hạng mục khác (hmLacNote_ chiphi.js:219-230) */
export function LacNote({ lines, hm, soHien, onHm }) {
  const r = hmLac_(lines, hm, soHien)
  if (!r) return null
  const ten = c => nodeName(c) || c
  return (
    <div className="qs-po-note">
      <Icon name="layers" size={15} />
      <span>Dự án đang có <b>{r.n} sản phẩm</b> nhưng không dòng nào thuộc <b>{hm + '.' + ten(hm)}</b>. Sản phẩm đang nằm ở: {r.ds.slice(0, 4).map((c, i) => <span key={c}>{i ? ' · ' : ''}<b>{ten(c)}</b> ({r.dem[c]})</span>)}.</span>
      {r.ds.slice(0, 2).map(c => <button type="button" key={c} className="qs-qt-btn" onClick={() => onHm(c)}>Xem {ten(c)}</button>)}
      <button type="button" className="qs-qt-btn" onClick={() => onHm('')}>Tất cả hạng mục</button>
    </div>
  )
}

/* Dòng nằm sai ngành hàng (hmSaiNote_ / hmSaiFix_ chiphi.js:191-215): chuyển lần lượt từng dòng về hạng mục theo ngành của SP */
export function SaiNote({ lines, products }) {
  const [busy, setBusy] = useState(false)
  const ds = hmSaiNganh_(lines, products)
  if (!ds.length) return null
  async function fix() {
    const list = hmSaiNganh_(getState().lines, getState().products)
    if (!list.length) return
    if (!await qsConfirm('Chuyển ' + list.length + ' dòng về đúng hạng mục theo ngành hàng của sản phẩm?')) return
    setBusy(true)
    let ok = 0, loi = ''
    for (const l of list) {
      const f = hmSaiFields_(l, getState().products)
      if (!f) continue
      try {
        const r = await api.updateLine(l.lineId, f)
        setState(s => ({ lines: s.lines.map(x => (x.lineId === l.lineId ? (r || { ...x, ...f }) : x)) }))
        ok++
      } catch (e) { loi = loi || e.message }
    }
    setBusy(false)
    qsToast(ok ? ('Đã chuyển ' + ok + ' dòng về đúng hạng mục') : ('Không chuyển được dòng nào' + (loi ? (': ' + loi) : '')))
  }
  return (
    <div className="qs-po-note">
      <Icon name="layers" size={15} />
      <span><b>{ds.length} dòng</b> đang nằm ở hạng mục không đúng ngành hàng của sản phẩm (ghi danh bằng bản cũ) nên lọc theo hạng mục sẽ không thấy.</span>
      <button type="button" className="qs-qt-btn" disabled={busy} onClick={fix}>{busy ? 'Đang chuyển…' : 'Chuyển ' + ds.length + ' dòng về đúng hạng mục'}</button>
    </div>
  )
}
