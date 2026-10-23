import Icon from '../../../../../components/ui/Icon'
import { useModFold, toggleModFold } from './fltOrder'

/* Tiêu đề 1 module của bảng Bộ lọc: [tay nắm kéo (tuỳ chọn)] Tên module ......... ⌃/⌄ (bấm cả dòng để thu gọn / mở rộng module).
   Props: id (khoá thu gọn, catalog/fltOrder useModFold), title, grip (phần tử tay nắm ⋮⋮, có thể null) */
export default function ModHead({ id, title, grip }) {
  const closed = !!useModFold()[id]
  return (
    <div className="qs-bd-mod-h">
      {grip}
      <button type="button" className="qs-bd-mod-tg" aria-expanded={!closed} onClick={() => toggleModFold(id)}
        title={closed ? 'Mở rộng' : 'Thu gọn'}>
        <span>{title}</span>
        <span className={`qs-bd-mod-chev${closed ? ' closed' : ''}`} aria-hidden="true"><Icon name="chevronUp" size={14} /></span>
      </button>
    </div>
  )
}
