import Icon from '../../../../../components/ui/Icon'
import ProductThumb from '../../common/ProductThumb'
import { mediaUrl } from '../../../api/files'
import { money } from '../../../lib/format.js'
import { spTenDay_ } from '../../../lib/catalogFilters.js'

/* Khối sản phẩm con ngay dưới thẻ danh mục (port ccBox_ / ccRow_, PUB/boc.js:1673-1697): combo = xanh · biến thể = cam (cls 'bt').
   Props: title, n, cls, rows [{stt, x, ten (tên hiển thị; bỏ trống = spTenDay_), phu, gc (ghi chú combo, M10.2; tuỳ chọn), onOpen, onAdd,
          drag (tuỳ chọn: {onStart, onEnd})}],
          foot (phần chân, tuỳ chọn) */
export default function ChildBox({ title, n, cls, rows, foot }) {
  return (
    <div className={`qs-bdc-cc${cls ? ' ' + cls : ''}`}>
      <div className="qs-bdc-cc-h">{title}<i>{n}</i></div>
      <div className="qs-bdc-cc-b">
        {rows.map(r => {
          const x = r.x
          const ten = r.ten != null ? r.ten : spTenDay_(x)
          return (
            <div key={r.stt} className="qs-bdc-ccr" title={String(x.ten || '') + (r.phu ? ' — ' + r.phu : '') + (r.gc ? ' — Ghi chú: ' + r.gc : '')} onClick={r.onOpen}
              draggable={!!r.drag} onDragStart={r.drag ? r.drag.onStart : undefined} onDragEnd={r.drag ? r.drag.onEnd : undefined}>
              <span className="qs-bdc-ccr-no">{r.stt}</span>
              <ProductThumb product={x} size={56} src={x.hinhAnh ? mediaUrl(String(x.hinhAnh).split('\n')[0].trim()) : ''} className="qs-bdc-ccr-th" />
              <span className="qs-bdc-ccr-m">
                <b>{ten}</b>
                {r.phu ? <span className="qs-bdc-ccr-r"><i>{r.phu}</i></span> : null}
                {r.gc ? <span className="qs-bdc-ccr-gc">Ghi chú: {r.gc}</span> : null}
              </span>
              <span className="qs-bdc-ccr-p">{money(x.donGiaBan)} đ</span>
              <button className="qs-bdc-ccr-add" title="Thêm vào bóc tách" onClick={e => { e.stopPropagation(); r.onAdd() }}><Icon name="plus" size={13} stroke={2.8} /></button>
            </div>
          )
        })}
        {foot}
      </div>
    </div>
  )
}
