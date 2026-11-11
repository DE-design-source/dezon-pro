import { useMemo, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import ProductThumb from '../common/ProductThumb'
import { MrootPortal } from '../common/Mroot'
import { imgSrc1_ } from './purchaseUi'
import { money, qbNorm_ } from '../../lib/format'

/* Hộp "Thêm dòng" của nhóm NCC ở tab Mua hàng (chỉ bản Go): chọn sản phẩm có sẵn trong danh mục (tìm theo tên / mã /
   thương hiệu, không dấu), mặc định chỉ SP của NCC này; không thấy thì tự nhập vật tư ngoài danh mục.
   Kèm SL, ngày cần đặt, tiến độ hàng. Props: g (nhóm NCC), products, tienDo (danh sách trạng thái), onAdd(r) -> Promise, onClose(). */
const MAX = 80
export default function AddRowModal({ g, products, tienDo, onAdd, onClose }) {
  const ncc = g.ncc
  const coNcc = useMemo(() => (products || []).some(p => p.ncc === ncc), [products, ncc])
  const [q, setQ] = useState('')
  const [chiNcc, setChiNcc] = useState(coNcc)
  const [pick, setPick] = useState(null)
  const [tuNhap, setTuNhap] = useState(false)
  const [f, setF] = useState({ ten: '', dvt: 'Cái', gia: '', moTa: '', sl: '1', ngay: '', td: '' })
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const ds = useMemo(() => {
    const k = qbNorm_(q).trim().replace(/\s+/g, ' '), w = k.split(' ').filter(Boolean)
    const r = []
    for (const p of products || []) {
      if (chiNcc && p.ncc !== ncc) continue
      const t = qbNorm_(p.ten), s = t + ' ' + qbNorm_([p.ma, p.thuongHieu, p.ncc].join(' '))
      if (!w.every(x => s.includes(x))) continue
      // tên chứa nguyên cụm gõ > tên chứa đủ từ > khớp ở mã / thương hiệu
      r.push([!k || t.includes(k) ? 0 : w.every(x => t.includes(x)) ? 1 : 2, p])
    }
    return r.sort((a, b) => a[0] - b[0]).slice(0, MAX).map(x => x[1])
  }, [products, q, chiNcc, ncc])

  const ok = tuNhap ? f.ten.trim() : pick
  const submit = async () => {
    if (!ok || busy) return
    setBusy(true)
    try { await onAdd({ p: tuNhap ? null : pick, ...f }) } finally { setBusy(false) }
  }
  return (
    <MrootPortal>
      <div className="qsc-ov" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="qsc-dlg qs-po-ar" role="dialog" aria-modal="true">
          <div className="qs-po-dlg-h">
            <h3>Thêm dòng — {ncc}</h3>
            <button type="button" className="qsc-x" onClick={onClose}>✕</button>
          </div>
          <div className="qs-po-ar-tabs">
            <button type="button" className={tuNhap ? '' : 'on'} onClick={() => setTuNhap(false)}>Chọn sản phẩm có sẵn</button>
            <button type="button" className={tuNhap ? 'on' : ''} onClick={() => setTuNhap(true)}>Vật tư ngoài danh mục</button>
          </div>
          {tuNhap ? (
            <div className="qs-po-ar-free">
              <label className="w2">Tên sản phẩm / vật tư *<input autoFocus value={f.ten} placeholder="VD: Ống đồng Ø9.5 bổ sung" onChange={e => set('ten', e.target.value)} /></label>
              <label>Đơn vị tính<input value={f.dvt} onChange={e => set('dvt', e.target.value)} /></label>
              <label>Đơn giá (đ)<input type="number" min="0" value={f.gia} onChange={e => set('gia', e.target.value)} /></label>
              <label className="w2">Ghi chú / quy cách<input value={f.moTa} placeholder="tuỳ chọn" onChange={e => set('moTa', e.target.value)} /></label>
            </div>
          ) : (
            <>
              <div className="qs-po-ar-s">
                <span><Icon name="search" size={14} /><input autoFocus value={q} placeholder="Tìm theo tên, mã, thương hiệu…" onChange={e => setQ(e.target.value)} /></span>
                {coNcc && <label><input type="checkbox" checked={chiNcc} onChange={e => setChiNcc(e.target.checked)} /> Chỉ SP của {ncc}</label>}
              </div>
              <div className="qs-po-ar-list">
                {ds.length ? ds.map(p => {
                  const on = pick === p
                  return (
                    <button type="button" key={p.recordId || p.ma + p.ten} className={on ? 'on' : ''} onClick={() => setPick(p)}>
                      <ProductThumb product={p} size={34} src={String(p.hinhAnh || '').split('\n')[0] ? imgSrc1_(p.hinhAnh) : ''} />
                      <span className="t"><b>{p.ten}</b><small>{[p.ma, p.thuongHieu, chiNcc ? '' : p.ncc].filter(Boolean).join(' · ')}</small></span>
                      <span className="g">{money(Number(p.giaBanLe) || 0)}</span>
                      {on && <Icon name="check" size={14} stroke={3} />}
                    </button>
                  )
                }) : <div className="qs-po-dx-empty">Không có sản phẩm khớp. Thử bỏ tick "Chỉ SP của {ncc}" hoặc chọn "Vật tư ngoài danh mục".</div>}
                {ds.length >= MAX && <div className="qs-po-ar-more">Hiện {MAX} kết quả đầu — gõ thêm để lọc.</div>}
              </div>
            </>
          )}
          <div className="qs-po-ar-f">
            <label>Số lượng<input type="number" min="1" value={f.sl} onChange={e => set('sl', e.target.value)} /></label>
            <label>Ngày cần đặt<input type="date" value={f.ngay} onChange={e => set('ngay', e.target.value)} /></label>
            <label>Tiến độ hàng<select value={f.td} onChange={e => set('td', e.target.value)}>
              <option value="">— Chưa đặt —</option>{tienDo.slice(1).map(x => <option key={x} value={x}>{x}</option>)}</select></label>
          </div>
          <div className="qs-po-ar-b">
            {!tuNhap && pick && <span className="qs-po-ar-pk">Đã chọn: <b>{pick.ten}</b></span>}
            <button type="button" className="qsc-btn" onClick={onClose}>Huỷ</button>
            <button type="button" className="qsc-btn blue" disabled={!ok || busy} onClick={submit}>{busy ? 'Đang thêm…' : 'Thêm dòng'}</button>
          </div>
        </div>
      </div>
    </MrootPortal>
  )
}
