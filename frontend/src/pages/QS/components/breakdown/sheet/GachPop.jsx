import { useMemo, useState } from 'react'
import Pop, { PopHead } from './Pop'
import { qsToast as toast } from '../../common/dialogs'
import { lineProd_ } from '../../../lib/productFields.js'
import { spVarKey_ } from '../../../lib/catalogFilters.js'
import { giaDongTuSP_ } from '../../../lib/calc.js'
import { spNorm_ } from '../../../lib/format.js'
import { GACH_DV, gachDv_, gachHop_, gachTinh_, gachSL_, gachHeSo_ } from '../../../lib/gach.js'

/* Hộp "Quy đổi gạch" của 1 dòng Bóc tách (mở từ nút ở ô Số lượng / menu chuột phải):
   chọn khổ gạch (khổ của biến thể khác thì đổi luôn sang SP biến thể đó), quy cách hộp, diện tích + % hao hụt
   -> số hộp chẵn, m² mua thực, số viên; ghi Số lượng theo đơn vị chọn (m² / Hộp / Viên), đổi đơn vị thì đơn giá quy đổi theo.
   Thông số nhập lưu ở extra.gach để mở lại. onApply(fields) -> updateLine. */
const HH = [3, 5, 7, 10]
const r2 = x => Math.round(x * 100) / 100
const ktOf = p => (p && ((p.raw && p.raw.kich_thuoc) || p.kichThuoc)) || ''
const hopOf = p => gachHop_(p && p.raw && p.raw.quy_cach_hop)

export default function GachPop({ anchor, line, products, onApply, onClose }) {
  const p0 = useMemo(() => lineProd_(line, products), [line, products])
  const sibs = useMemo(() => {
    if (!p0) return []
    const k = spVarKey_(p0), seen = {}
    return (products || []).filter(x => spVarKey_(x) === k && ktOf(x) && !seen[spNorm_(ktOf(x))] && (seen[spNorm_(ktOf(x))] = 1))
  }, [p0, products])
  const g0 = (line.extra && line.extra.gach) || {}
  const dv0 = gachDv_(line.dvt)
  const h0 = hopOf(p0)
  const [f, setF] = useState(() => ({
    kt: g0.kt || ktOf(p0) || line.kichThuoc, vh: g0.vh != null ? g0.vh : (h0.vh || ''), mh: g0.mh != null ? g0.mh : (h0.mh || ''),
    dt: g0.dt != null ? g0.dt : (dv0 === 'm²' && line.soLuong ? line.soLuong : ''), hh: g0.hh != null ? g0.hh : 5, dv: dv0 || 'm²',
  }))
  const set = (k, v) => setF(o => ({ ...o, [k]: v }))
  // khổ trùng khổ của 1 biến thể khác -> dùng SP đó (quy cách hộp theo SP đó)
  const sib = sibs.find(x => spNorm_(ktOf(x)) === spNorm_(f.kt))
  const doiSP = sib && p0 && sib !== p0 ? sib : null
  const chonKt = v => {
    const s = sibs.find(x => spNorm_(ktOf(x)) === spNorm_(v))
    const h = s ? hopOf(s) : null
    setF(o => ({ ...o, kt: v, ...(h && (h.vh || h.mh) ? { vh: h.vh || '', mh: h.mh || '' } : {}) }))
  }
  const r = gachTinh_(f)
  const sl = gachSL_(r, f.dv)

  // đơn giá: theo SP biến thể (nếu đổi) rồi quy đổi từ đơn vị của giá sang đơn vị chọn
  const goc = doiSP ? { ...giaDongTuSP_(doiSP, products), dv: gachDv_(doiSP.dvt) } : { donGiaVon: Number(line.donGiaVon) || 0, donGiaBan: Number(line.donGiaBan) || 0, dv: dv0 }
  const k = goc.dv && goc.dv !== f.dv ? gachHeSo_(goc.dv, f.dv, r) : 1
  const apply = () => {
    if (!(Number(f.dt) > 0)) { toast('Nhập diện tích cần ốp / lát (m²)'); return }
    if (!sl) { toast(f.dv === 'Hộp' ? 'Thiếu quy cách hộp (m²/hộp, hoặc viên/hộp + khổ gạch)' : 'Thiếu khổ gạch để tính số viên'); return }
    if (!k) { toast('Chưa đổi được đơn giá từ ' + goc.dv + ' sang ' + f.dv + ' — thiếu khổ gạch / quy cách hộp'); return }
    const fields = {
      soLuong: sl, dvt: f.dv,
      extra: { ...(line.extra || {}), gach: { kt: f.kt, vh: f.vh, mh: f.mh, dt: Number(f.dt), hh: Number(f.hh) || 0, hop: r.hop, mua: r2(r.mua), vien: r.vien } },
    }
    if (doiSP) Object.assign(fields, { ten: doiSP.ten, maSP: doiSP.ma, kichThuoc: doiSP.kichThuoc, thuongHieu: doiSP.thuongHieu, ncc: doiSP.ncc, moTa: doiSP.moTa, hinhAnh: doiSP.hinhAnh, chietKhau: goc.chietKhau })
    if (doiSP || k !== 1) Object.assign(fields, { donGiaVon: Math.round(goc.donGiaVon * k), donGiaBan: Math.round(goc.donGiaBan * k) })
    onClose(); onApply(fields)
  }
  const inp = (key, ph, o = {}) => <input type={o.text ? 'text' : 'number'} step="any" min="0" value={f[key]} placeholder={ph} list={o.list} onChange={e => (o.on || (v => set(key, v)))(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') apply() }} />

  return (
    <Pop anchor={anchor} width={400} className="qs-tk-gach" onClose={onClose}>
      <PopHead title="Quy đổi gạch" sub={line.ten || ''} onClose={onClose} />
      <div className="qs-tk-gachb">
        <label className="w2">Khổ gạch {sibs.length > 1 && <i>· {sibs.length} khổ có sẵn của mẫu này</i>}
          {inp('kt', 'VD: 600 x 1200 (mm)', { text: 1, list: 'qs-gach-kt', on: chonKt })}
          <datalist id="qs-gach-kt">{sibs.map(x => <option key={x.ma} value={ktOf(x)}>{x.ma}</option>)}</datalist>
        </label>
        {doiSP && <div className="w2 qs-tk-gachw">Đổi sang biến thể <b>{doiSP.ma}</b> ({doiSP.ten})</div>}
        <label>Viên / hộp{inp('vh', 'VD: 2')}</label>
        <label>m² / hộp{inp('mh', r.mv && Number(f.vh) ? r2(r.mv * f.vh) + ' (tự tính)' : 'VD: 1.44')}</label>
        <label className="w2">Diện tích cần ốp / lát (m²){inp('dt', 'VD: 120')}</label>
        <label className="w2">Hao hụt (%)
          <span className="qs-tk-gachh">{HH.map(x => <button key={x} type="button" className={Number(f.hh) === x ? 'on' : ''} onClick={() => set('hh', x)}>{x}</button>)}{inp('hh', '%')}</span>
        </label>
      </div>
      <div className="qs-tk-gachr">
        <span>m² cần (cả hao hụt)<b>{r2(r.can)}</b></span>
        <span>Số hộp<b>{r.hop || '—'}</b></span>
        <span>m² mua (hộp chẵn)<b>{r2(r.mua)}</b></span>
        <span>Số viên<b>{r.vien || '—'}</b></span>
      </div>
      <div className="qs-tk-gachf">
        <span>Ghi vào dòng theo</span>
        <span className="qs-tk-gachdv">{GACH_DV.map(x => <button key={x} type="button" className={f.dv === x ? 'on' : ''} onClick={() => set('dv', x)}>{x}</button>)}</span>
        <button type="button" className="qsc-btn blue" onClick={apply}>Áp dụng: {sl || 0} {f.dv}</button>
      </div>
      {(k !== 1 || doiSP) && k ? <div className="qs-tk-gachw">Đơn giá quy đổi: {Math.round(goc.donGiaBan * k).toLocaleString('vi-VN')} đ / {f.dv}{goc.dv && goc.dv !== f.dv ? ' (từ giá / ' + goc.dv + ')' : ''}</div> : null}
      {!dv0 && <div className="qs-tk-gachw">Đơn vị hiện tại "{line.dvt}" không phải m² / Hộp / Viên — đơn giá giữ nguyên.</div>}
    </Pop>
  )
}
