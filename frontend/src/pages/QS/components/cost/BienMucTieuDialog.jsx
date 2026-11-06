import { useEffect, useRef, useState } from 'react'
import { MrootPortal } from '../common/Mroot'
import { money, pctIn_ } from '../../lib/format.js'
import { giaDaiLy_ } from '../../lib/calc.js'

/* Hộp "Biên lợi nhuận mục tiêu" (nút Biên mục tiêu… của Chi phí): 2 ô liên thông, gõ 1 ô thì ô kia tự tính
     Lợi nhuận trên giá bán (Margin) = (Giá bán − Giá vốn) / Giá bán × 100%  -> đánh giá hiệu quả kinh doanh
     Lợi nhuận trên giá vốn (Markup) = (Giá bán − Giá vốn) / Giá vốn × 100%  -> định giá từ giá vốn
   Đổi qua lại: markup = m / (100 − m) × 100 · margin = k / (100 + k) × 100. Giá vốn = Giá đại lý (sau CK đại lý).
   Xem trước tổng giá vốn / giá bán / lợi nhuận của các dòng sẽ áp. Giá bán tính lại theo đúng ô người dùng gõ (tkFieldsFor_
   'margin' hoặc 'markup'), sau chiết khấu khách.
   Props: lines (dòng có giá vốn sẽ áp), skipped (số dòng chưa có giá vốn, bỏ qua), scopeLbl, init (margin % đã lưu),
   onApply({mode: 'margin' | 'markup', v, margin}), onClose() */
const r2 = x => String(Math.round(x * 100) / 100).replace('.', ',')
const toMarkup = m => m / (100 - m) * 100
const toMargin = k => k / (100 + k) * 100

export default function BienMucTieuDialog({ lines, skipped, scopeLbl, init, onApply, onClose }) {
  const has0 = init != null && init !== '' && Number(init) < 100
  const [mg, setMg] = useState(has0 ? r2(Number(init)) : '')
  const [mk, setMk] = useState(has0 ? r2(toMarkup(Number(init))) : '')
  const [src, setSrc] = useState('margin')   // ô người dùng gõ sau cùng: dùng số đó để tính (không qua số đã làm tròn)
  const [err, setErr] = useState('')
  const firstRef = useRef(null)
  const ovRef = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => { if (firstRef.current) { firstRef.current.focus(); firstRef.current.select() } }, 40)
    const key = e => {
      if (e.key !== 'Escape') return
      const all = document.querySelectorAll('.qsc-ov, .qs-modal-backdrop')
      if (all[all.length - 1] === ovRef.current) onClose()
    }
    document.addEventListener('keydown', key)
    return () => { clearTimeout(t); document.removeEventListener('keydown', key) }
  }, [onClose])

  function typeMargin(s) {
    setMg(s); setSrc('margin'); setErr('')
    const v = pctIn_(s)
    setMk(v == null || v < 0 || v >= 100 ? '' : r2(toMarkup(v)))
  }
  function typeMarkup(s) {
    setMk(s); setSrc('markup'); setErr('')
    const v = pctIn_(s)
    setMg(v == null || v < 0 ? '' : r2(toMargin(v)))
  }

  // số đang dùng (theo ô gõ sau cùng) -> margin chính xác để xem trước + lưu
  const vSrc = pctIn_(src === 'margin' ? mg : mk)
  const okSrc = vSrc != null && vSrc >= 0 && (src === 'markup' || vSrc < 100)
  const margin = okSrc ? (src === 'margin' ? vSrc : toMargin(vSrc)) : null

  // xem trước: giá vốn giữ nguyên, giá bán (sau CK khách) = vốn / (1 − margin)
  let von = 0, ban = 0
  lines.forEach(l => {
    const sl = Number(l.soLuong) || 0, g = giaDaiLy_(l)
    von += g * sl
    if (margin != null) ban += g / (1 - margin / 100) * sl
  })
  const ln = ban - von

  function submit() {
    if (!okSrc) { setErr(src === 'margin' ? 'Lợi nhuận trên giá bán phải từ 0 đến dưới 100%.' : 'Lợi nhuận trên giá vốn phải từ 0% trở lên.'); return }
    onApply({ mode: src, v: vSrc, margin })
  }

  return (
    <MrootPortal>
      <div ref={ovRef} className="qsc-ov" onClick={e => { if (e.target === e.currentTarget) onClose() }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}>
        <div className="qsc-dlg qsc-ask qs-bmt" role="dialog" aria-modal="true" aria-label="Biên lợi nhuận mục tiêu">
          <div className="qsc-ask-h">
            <h3>Biên lợi nhuận mục tiêu</h3>
            <button type="button" className="qsc-x" onClick={onClose}>✕</button>
          </div>
          <p className="qsc-ask-note">Nhập 1 trong 2 ô, ô còn lại tự tính. Giá bán từng dòng được tính lại, {scopeLbl}.</p>

          <div className="qs-bmt-pair">
            <label className={'qs-bmt-f' + (src === 'margin' ? ' on' : '')}>
              <span className="t">Lợi nhuận trên giá bán <em>Margin</em></span>
              <span className="in"><input ref={firstRef} inputMode="decimal" value={mg} placeholder="VD: 25" onChange={e => typeMargin(e.target.value)} /><i>%</i></span>
              <small>(Giá bán − Giá vốn) / Giá bán<br />Đánh giá hiệu quả: mỗi đồng doanh thu giữ lại bao nhiêu lợi nhuận</small>
            </label>
            <span className="qs-bmt-eq" aria-hidden="true">⇄</span>
            <label className={'qs-bmt-f' + (src === 'markup' ? ' on' : '')}>
              <span className="t">Lợi nhuận trên giá vốn <em>Markup</em></span>
              <span className="in"><input inputMode="decimal" value={mk} placeholder="VD: 33,33" onChange={e => typeMarkup(e.target.value)} /><i>%</i></span>
              <small>(Giá bán − Giá vốn) / Giá vốn<br />Định giá: cộng thêm bao nhiêu % vào giá vốn để ra giá bán</small>
            </label>
          </div>

          <div className="qs-bmt-pv">
            <div><span>Giá vốn</span><b>{money(Math.round(von))} đ</b></div>
            <div><span>Giá bán mới</span><b>{margin == null ? '—' : money(Math.round(ban)) + ' đ'}</b></div>
            <div className="ln"><span>Lợi nhuận</span><b>{margin == null ? '—' : money(Math.round(ln)) + ' đ'}</b></div>
          </div>
          {skipped > 0 && <p className="qsc-ask-note qs-bmt-skip">{skipped} dòng chưa có giá vốn được bỏ qua.</p>}

          {err ? <div className="qsc-ask-err">{err}</div> : null}
          <div className="qsc-ask-btns">
            <button type="button" className="qsc-btn" onClick={onClose}>Huỷ</button>
            <button type="button" className="qsc-btn blue" disabled={!okSrc} onClick={submit}>Tính giá bán cho {lines.length} dòng</button>
          </div>
        </div>
      </div>
    </MrootPortal>
  )
}
