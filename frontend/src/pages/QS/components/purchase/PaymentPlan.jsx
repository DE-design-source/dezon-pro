import Icon from '../../../../components/ui/Icon'
import ChangeInput from './ChangeInput'
import { money } from '../../lib/format'
import { mhPaySum_ } from '../../lib/purchase'

/* Khối "Đề xuất thanh toán mục tiêu" của một nhà cung cấp (port mhPayHtml_, PUB/muahang.js:288-327).
   arr = các đợt đã qua mhPayTinh_ ({pct, tien, ngay, gc, tay?}), tot = tổng đơn (gồm VAT) của NCC.
   Mọi phép tính nằm ở lib/purchase.js; component chỉ vẽ và báo lên:
   onToggle(), onSet(i, field, value), onAdd(), onDel(i), onChia(n), onSend() (null = ẩn nút gửi, N21); busy = đang gửi. */
export default function PaymentPlan({ arr, tot, open, busy, onToggle, onSet, onAdd, onDel, onChia, onSend }) {
  const s = mhPaySum_(arr, tot)
  const head = (
    <button type="button" className="qs-po-plan-head" onClick={onToggle}>
      <Icon name="banknote" size={15} className="qs-dash-accent" /><b>Đề xuất thanh toán mục tiêu</b>
      <span>{arr.length} đợt · {money(s.sumTien)} đ</span>
      <span style={{ flex: 1 }} /><span className={`qs-bd-caret${open ? ' up' : ''}`} />
    </button>
  )
  if (!open) return head
  return (
    <>
      {head}
      <div className="qs-po-pay">
        <div className="qs-po-pay-top">
          <span>Chia nhanh</span>
          {[2, 3, 4].map(n => <button type="button" key={n} className="qs-po-pay-quick" onClick={() => onChia(n)}>{n} đợt</button>)}
          <span style={{ flex: 1 }} />
          <button type="button" className="qs-po-pay-add" onClick={onAdd}><Icon name="plus" size={12} />Thêm đợt</button>
        </div>

        <div className="qs-po-pay-steps">
          {arr.map((d, i) => (
            <div key={i} className="qs-po-pay-step">
              <div className="qs-po-pay-step-head">
                <b>Thanh toán đợt {i + 1}</b>
                <button type="button" title="Xoá đợt" onClick={() => onDel(i)}><Icon name="x" size={13} /></button>
              </div>
              <label><span>%</span><ChangeInput type="number" step="any" min="0" max="100" value={d.pct || ''} placeholder="%" onCommit={v => onSet(i, 'pct', v)} /></label>
              <label><span>Số tiền</span><ChangeInput type="text" inputMode="numeric" value={d.tien ? money(d.tien) : ''} placeholder="0" onCommit={v => onSet(i, 'tien', v)} /></label>
              <label><span>Ngày</span><ChangeInput type="date" value={d.ngay || ''} onCommit={v => onSet(i, 'ngay', v)} /></label>
              <label><span>Ghi chú</span><ChangeInput textarea rows={2} value={d.gc || ''} placeholder="VD: tạm ứng ký hợp đồng" onCommit={v => onSet(i, 'gc', v)} /></label>
            </div>
          ))}
        </div>

        <div className={`qs-po-pay-status${s.du ? ' ok' : ''}`}>
          <span>
            <Icon name={s.du ? 'check' : 'gauge'} size={13} stroke={2.4} />
            {s.du ? 'Đã phân bổ đủ 100% giá trị đơn hàng'
              : (s.sumTien < tot ? 'Còn thiếu ' + money(tot - s.sumTien) + ' đ (' + s.thieuPct + '%)' : 'Vượt ' + money(s.sumTien - tot) + ' đ')}
          </span>
          <span>Tổng đề xuất: <b>{money(s.sumTien)} đ</b> / {money(tot)} đ</span>
        </div>
        {onSend && <button type="button" className="qs-po-send" disabled={busy} onClick={onSend}>
          <Icon name="cart" size={14} />{busy ? 'Đang gửi…' : 'Gửi đề xuất thanh toán'}
        </button>}
      </div>
    </>
  )
}
