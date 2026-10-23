import { createPortal } from 'react-dom'
import { usePcTotalsEl, usePcNodeEl } from '../project/pcSlot'
import Icon from '../../../../components/ui/Icon'
import { money } from '../../lib/format.js'

const Caret = () => <span className="qs-bd-caret" />
const dong = n => `${money(n)} đ`
const pad2 = n => (n < 10 ? '0' : '') + n

/* Phần đầu bảng bóc tách (port hàng "Hạng mục đã bóc" PUB/index.html:6733-6750 + tkTongTien_ boc.js:583-597):
   hạng mục đang bóc (bấm mở cây hạng mục), chip Nhân công / Vật tư, kiểu bảng, tổng tiền + VAT, cấu hình cột.
   Thu gọn: chỉ còn một hàng (ẩn phần tổng tiền, đưa cấu hình cột lên cùng hàng).
   Băng dự án đang mở rộng (có chỗ .qs-pc-totals / .qs-pc-node, pcSlot.js): tổng tiền và cụm "Hạng mục đã bóc" + nút chọn
   hạng mục vẽ lên băng dự án, cấu hình cột lên cùng hàng.
   Props: count (số dòng đang bóc; 3.1 = số dòng Phần thô), treeCount (tuỳ chọn: số trên nút hạng mục, mặc định = count),
          hideCols (tuỳ chọn: ẩn nút Cột hiển thị / bộ cột, như đề mục 3.1 của bản gốc), nodeLabel ("3.2.6.1.Thiết bị đèn"), onOpenTree(ev), treeOpen, treeAddTitle, sheetChips (node),
          subtotal, vat, onVat(v) (ghi khi rời ô / Enter như onchange của bản gốc), view, onView, catalogOpen, onToggleCatalog,
          colsShown, colsTotal, colsOpen, onOpenCols, presetLabel, onOpenPreset(ev), presetOpen */
export default function SheetHeader({
  count, treeCount, hideCols, nodeLabel, onOpenTree, treeOpen, sheetChips, subtotal, vat, onVat, view, onView, catalogOpen, onToggleCatalog,
  colsShown, colsTotal, colsOpen, onOpenCols, presetLabel, onOpenPreset, presetOpen,
}) {
  /* Nút gập dải tổng tiền (^) đã bỏ: tổng tiền nằm trên băng dự án (có nút gập riêng); trạng thái qs_fold.totals cũ bỏ qua */
  const collapsed = false
  const pcSlot = usePcTotalsEl()
  const pcNode = usePcNodeEl()
  const oneRow = collapsed || !!pcSlot
  const vatAmount = Math.round(subtotal * (Number(vat) || 0) / 100)
  const preset = `${colsShown}/${colsTotal}`
  const colTools = (
    <>
      {!hideCols && <button className={`qs-bd-cols-label${colsOpen ? ' on' : ''}`} title="Ẩn / hiện các chip cột" onClick={onOpenCols}>Cột hiển thị <span>{preset}</span><Icon name="chevronDown" size={16} /></button>}
      {/* trên băng dự án chỉ còn biểu tượng (tên bộ đang bật + số cột ở chú thích khi rê chuột) */}
      {!hideCols && (
        <button className={`qs-bd-preset${presetOpen ? ' on' : ''}${pcNode ? ' icon-only' : ''}`} onClick={onOpenPreset}
          title={'Chọn nhanh bộ cột — đang dùng: ' + presetLabel + ' ' + preset} aria-label="Chọn nhanh bộ cột">
          <Icon name="sliders" size={pcNode ? 15 : 13} />{!pcNode && <>{presetLabel} {preset}<Caret /></>}
        </button>
      )}
    </>
  )
  /* Mỗi nhóm .qs-bd-tg = nhãn (.qs-bd-tl) + số. Tại chỗ (đầu bảng) nhóm "trải phẳng" thành một hàng như cũ;
     trên băng dự án (.qs-pc-totals, project.css) mỗi nhóm thành ô số trên / nhãn dưới như các KPI của băng */
  /* Ô VAT riêng đã bỏ: "Tổng (VAT)" = chưa VAT + VAT; % VAT sửa ở Thông tin dự án > Thông tin bản nháp */
  const totals = (
    <div className="qs-bd-totals">
      <span className="qs-bd-tg"><span className="qs-bd-tl"><span className="qs-bd-muted">Chưa VAT</span></span><b>{dong(subtotal)}</b></span>
      <span className="qs-bd-vsep" />
      <span className="qs-bd-tg" title={'Đã gồm VAT ' + (Number(vat) || 0) + '% = ' + dong(vatAmount) + ' — sửa % VAT ở Thông tin dự án'}>
        <span className="qs-bd-tl"><span className="qs-bd-total-label">Tổng (VAT)</span></span><b className="qs-bd-total">{dong(subtotal + vatAmount)}</b>
      </span>
    </div>
  )
  const seg = (
    <div className="qs-bd-seg" title="Chọn kiểu bảng — máy sẽ nhớ">
      <button className={view === 'sheet' ? 'on' : ''} onClick={() => onView('sheet')}><Icon name="table" size={15} />Bảng tính</button>
      <button className={view === 'plain' ? 'on' : ''} onClick={() => onView('plain')}><Icon name="listLines" size={15} />Bảng thường</button>
    </div>
  )
  /* Nút ẩn/hiện cột hạng mục + "Hạng mục đã bóc" + nút chọn hạng mục: băng dự án đang mở rộng thì lên băng (.qs-pc-node),
     kèm luôn nút kiểu bảng (Bảng tính / Bảng thường) ngay sau nút chọn hạng mục */
  /* Trên băng: 3 phần bằng nhau, mỗi phần 1 khung (.qs-pc-mod): 1 hạng mục đã bóc · 2 kiểu bảng + cột hiển thị (phần 3 tiền ở PCard) */
  const mod = (cls, c) => (pcNode ? <span className={'qs-pc-mod ' + cls}>{c}</span> : c)
  const nodeTools = (
    <span className="qs-bd-node">
      {mod('m-node', (
        <>
          <span className="qs-bd-node-lbl">
            <button className="qs-bd-icon-btn" title={catalogOpen ? 'Ẩn cột hạng mục' : 'Hiện cột hạng mục'} onClick={onToggleCatalog}><Icon name="panelLeft" size={17} /></button>
            <span className="qs-bd-h">Hạng mục đã bóc</span>
            <span className="qs-bd-count">[{pad2(count)}]</span>
          </span>
          <button className={`qs-bd-category${treeOpen ? ' on' : ''}`} title={'Chọn hạng mục — ' + nodeLabel} onClick={onOpenTree}>
            <b>{nodeLabel}</b>
            <span className="qs-bd-count">[{pad2(treeCount == null ? count : treeCount)}]</span>
            <span style={{ flex: 1 }} />
            <span className="qs-bd-acc-plus"><Icon name="plus" size={10} stroke={3} /></span>
          </button>
        </>
      ))}
      {pcNode && mod('m-view', <>{seg}{!hideCols && <span className="qs-bd-head-cols">{colTools}</span>}</>)}
    </span>
  )
  /* Trên băng dự án: kiểu bảng + cấu hình cột lên băng luôn; đầu bảng chỉ còn chip Nhân công / Vật tư (nếu có), không có thì bỏ cả thẻ */
  const portals = (
    <>
      {pcNode && createPortal(nodeTools, pcNode)}
      {pcSlot && !collapsed && createPortal(totals, pcSlot)}
    </>
  )
  if (pcNode && !sheetChips) return portals
  return (
    <div className={`qs-card qs-bd-head${oneRow ? ' collapsed' : ''}`}>
      <div className="qs-bd-head-row">
        {!pcNode && nodeTools}
        {sheetChips}
        <span style={{ flex: 1 }} />
        {!pcNode && seg}
        {pcNode ? null : (oneRow ? <div className="qs-bd-head-cols">{colTools}</div> : totals)}
      </div>
      {!oneRow && <div className="qs-bd-head-row second">{colTools}</div>}
      {portals}
    </div>
  )
}
