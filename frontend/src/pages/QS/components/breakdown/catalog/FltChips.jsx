import Icon from '../../../../../components/ui/Icon'
import { fltHien_, fltActiveN_ } from '../../../lib/catalogFilters.js'
import { fltToggle } from './filterStore'
import { useFltOrder, sortByMods } from './fltOrder'

/* Module "Khối hiển thị" của bảng Bộ lọc: hàng chip bật / tắt từng khối lọc (cùng thứ tự module, không có Yêu thích -
   module Yêu thích chỉ hiện khi bấm trái tim). Số trên chip = số lọc đang chọn trong khối.
   Props: secs ([[khoá, tên]] = fltSecs_), st (trạng thái lọc) */
const chipKeys = (secs, order) => sortByMods(secs.map(x => x[0]).filter(k => k !== 'yeuthich'), order)

export default function FltChips({ secs, st }) {
  const order = useFltOrder()
  const label = {}
  secs.forEach(([k, lb]) => { label[k] = lb })
  return (
    <div className="qs-bd-pop-chips" role="group" aria-label="Bật / tắt khối lọc">
      {chipKeys(secs, order).map(k => {
        const on = fltHien_(st.fltShow, k)
        const n = fltActiveN_(k, st)
        return (
          <button key={k} type="button" className={`qs-bd-pop-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => fltToggle(k)}
            title={on ? 'Đang hiện — bấm để ẩn khối này' : 'Bấm để hiện khối này'}>
            <span className="qs-fc-tick" aria-hidden="true">{on && <Icon name="check" size={10} stroke={3.2} />}</span>
            <span className="qs-fc-lb">{label[k]}</span>{n ? <em>{n}</em> : null}
          </button>
        )
      })}
    </div>
  )
}

/* Tên module kèm số khối đang hiện, vd "Khối hiển thị 6/6" */
export function FltChipsTitle({ secs, st }) {
  const keys = chipKeys(secs, useFltOrder())
  const onN = keys.filter(k => fltHien_(st.fltShow, k)).length
  return <>Khối hiển thị <b className="qs-bd-mod-n">{onN}/{keys.length}</b></>
}
