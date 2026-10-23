import { useLayoutEffect, useRef } from 'react'
import Pop from './Pop'
import { TREE, nodeCount, customGroups } from '../../../lib/tree.js'
import { tkSheetCo_ } from '../../../lib/columns.js'
import { PT_LOAI_NHOM, ptLoaiNgan } from './ptLoai'

const pad2 = n => (n < 10 ? '0' : '') + n

/* Cấp phụ chọn 1 trong vài mục (mmPick2_ PUB/app.js:1523-1530). opts: [[giá trị, mã, nhãn]] */
function Pick2({ cap, opts, sel, onPick }) {
  return (
    <div className="qs-tk-mmstep">
      <div className="qs-tk-mmcap">{cap}</div>
      <div className="qs-tk-mmlist">
        {opts.map(o => (
          <button key={o[0]} className={`qs-tk-mmitem${o[0] === sel ? ' on' : ''}`} onClick={() => onPick(o[0])}>
            {o[1] && <span className="qs-tk-mmcode">{o[1]}</span>}
            <span>{o[2]}</span>{o[0] === sel && <span className="qs-tk-mmgo">✓</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

/* Ô chọn hạng mục trên đầu bảng (#treePop, port mmHtml_(true) PUB/app.js:1500-1521):
   danh sách phẳng thụt lề theo cấp, số dòng mỗi hạng mục, hạng mục tự tạo (nhomTuTao) có ✕ xoá, nút "＋ Thêm hạng mục".
   Cấp phụ của đề mục đang chọn: Phần thô (3.1) -> "Loại báo giá" (Khái toán / Dự toán) + loại con (mmLoai_);
   đề mục có Nhân công / Vật tư -> "Phân loại" (mmSheet_).
   Props: anchor, node, cur, lines, sheet, ptLoai, onPick(code), onSheet(v), onLoai(v), onAdd(), onDelete(code), onClose() */
export default function TreePopover({ anchor, node, cur, lines, sheet, ptLoai, onPick, onSheet, onLoai, onAdd, onDelete, onClose }) {
  const ns = TREE.filter(t => t[0] !== 'X').map(t => ({ c: t[0], t: t[1], l: t[2] }))
  customGroups(cur).forEach(n => ns.push({ c: n, t: n, l: 1, custom: true }))
  const lo = ptLoai || 'kt_chitiet'
  const nhom = lo.indexOf('dt_') === 0 ? 'dt' : 'kt'
  const g = PT_LOAI_NHOM.filter(x => x[0] === nhom)[0]
  /* Danh sách dài xuống gần đáy màn hình: chỗ trống từ dưới nút hạng mục tới đáy cửa sổ, trừ phần cuối popup
     (Phân loại / Loại báo giá / Thêm hạng mục) và lề. Popup nằm trong vùng zoom nên đổi px màn hình -> px CSS theo tỉ lệ z.
     Chạy sau khi Pop đặt vị trí (effect của con chạy trước); vẫn vừa dưới nút nên Pop không phải lật lên trên. */
  const listRef = useRef(null)
  useLayoutEffect(() => {
    const list = listRef.current
    const pop = list && list.closest('.qs-tkp')
    if (!pop || !anchor || !anchor.getBoundingClientRect) return
    const z = (list.getBoundingClientRect().width / list.offsetWidth) || 1
    const rest = pop.getBoundingClientRect().height - list.getBoundingClientRect().height
    const avail = window.innerHeight - anchor.getBoundingClientRect().bottom - rest - 14 * z
    list.style.maxHeight = Math.round(Math.max(220 * z, avail) / z) + 'px'
  }, [anchor, node, sheet, ptLoai])
  return (
    <Pop anchor={anchor} width={330} className="qs-tk-tree" onClose={onClose}>
      <div className="qs-tk-tnlist" ref={listRef}>
        {ns.map(n => (
          <div key={n.c} className={`qs-tk-tnode lvl${n.l}${n.c === node ? ' on' : ''}`} onClick={() => onPick(n.c)}>
            <span className="rd" />
            <span className="nm">{n.custom ? n.t : n.c + '. ' + n.t}</span>
            <span className="cn">[{pad2(nodeCount(lines, n.c))}]</span>
            {n.custom && <b className="qs-tk-tnx" title="Xoá hạng mục tự tạo" onClick={e => { e.stopPropagation(); onDelete(n.c) }}>✕</b>}
          </div>
        ))}
      </div>
      {node === '3.1' ? (
        <>
          <Pick2 cap="Loại báo giá" opts={PT_LOAI_NHOM.map(x => [x[0], x[1], x[2]])} sel={nhom} onPick={onLoai} />
          <Pick2 cap={g[2]} opts={g[3].map(x => [x[0], x[1], ptLoaiNgan(x[2])])} sel={lo} onPick={onLoai} />
        </>
      ) : tkSheetCo_(node) && (
        <Pick2 cap="Phân loại" opts={[['', '', 'Tất cả'], ['nc', '1', 'Nhân công'], ['vt', '2', 'Vật tư']]} sel={sheet || ''} onPick={onSheet} />
      )}
      <button className="qs-tk-mmadd" onClick={onAdd}>＋ Thêm hạng mục</button>
    </Pop>
  )
}
