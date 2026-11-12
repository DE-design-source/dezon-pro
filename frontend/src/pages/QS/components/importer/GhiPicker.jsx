import { useQs } from '../../state/QsData'
import { askCreateProject } from '../project/projectActions'
import { ghiDs_ } from './importLogic'

/* Chọn NHIỀU dự án để ghi danh SP sau khi lưu (dùng cho form 1 SP và cho cả lô nhập file).
   g = {on, ds (null = dự án đang mở), qty}; put(fn) nhận fn(g) -> g mới. Mỗi lần chọn ở ô dưới thêm 1 dự án (bật luôn ghi danh);
   "Tạo dự án mới" (tên, khách hàng, link Dezon…) tạo xong cũng thêm vào. */
export default function GhiPicker({ g, put, projSelRef, qtyLabel = 'Số lượng (mỗi dự án)', checkLabel }) {
  const { projects, cur } = useQs()
  const ds = ghiDs_(g, cur)
  const tenDA = m => ((projects || []).filter(p => p.maDA === m)[0] || {}).ten || m
  const pick = async v => {
    if (!v) return
    let m = v
    if (v === '__new__') { const p = await askCreateProject(); if (!p) return; m = p.maDA }
    put(x => { const d = ghiDs_(x, cur); return { ...x, on: true, ds: d.indexOf(m) >= 0 ? d : d.concat(m) } })
  }
  const conLai = (projects || []).filter(p => ds.indexOf(p.maDA) < 0)
  return (
    <>
      <div className="qsi-dbgrid">
        <div className="qsi-field qsi-ghi-da"><label>Dự án {ds.length ? '(' + ds.length + ')' : ''}</label>
          <div className="qsi-ghi-chips">{ds.length ? ds.map(m => (
            <span className="qsi-ghi-chip" key={m}>{tenDA(m)}<button type="button" title="Bỏ dự án này" onClick={() => put(x => ({ ...x, ds: ds.filter(y => y !== m) }))}>✕</button></span>
          )) : <span className="qsi-ghi-none">Chưa chọn dự án</span>}</div>
          <select ref={projSelRef} value="" onChange={e => pick(e.target.value)}>
            <option value="">＋ Thêm dự án…</option>
            {conLai.map(p => <option key={p.maDA} value={p.maDA}>{p.ten}</option>)}
            <option value="__new__">＋ Tạo dự án mới…</option>
          </select></div>
        <div className="qsi-field"><label>{qtyLabel}</label><input type="number" min="1" value={g.qty} onChange={e => { const q = e.target.value; put(x => ({ ...x, qty: q })) }} /></div>
      </div>
      <label className="qsi-ghck"><input type="checkbox" checked={!!g.on} onChange={e => { const on = e.target.checked; put(x => ({ ...x, on })) }} /> {checkLabel || ('Thêm sản phẩm này vào ' + (ds.length > 1 ? ds.length + ' dự án' : 'dự án') + ' đã chọn sau khi lưu')}</label>
    </>
  )
}
