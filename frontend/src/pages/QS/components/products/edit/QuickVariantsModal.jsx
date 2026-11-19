import { useState } from 'react'
import * as api from '../../../api/qsApi'
import { getState, setState } from '../../../state/store'
import { tkNum_, spNorm_ } from '../../../lib/format'
import { dbLabelMaps_, nganhCuaSP_, specNganh_, coSpec_ } from '../../../lib/productFields'
import QsIcon from '../../common/QsIcon'
import { MrootPortal } from '../../common/Mroot'
import { qsToast } from '../../common/dialogs'
import { imgSrc1_, btItem_ } from './editModel'
import VariantTable from '../../common/VariantTable'
import { varCols_, varRow_, varRowCo_ } from '../../../lib/variants'
import './productEdit.css'

/* "Tạo nhanh biến thể" #nbtOv (P7, port spNhieuBT_ / spNhieuBTVe_ / spNhieuBTSua_ / spNhieuBTThem_ / spNhieuBTBo_ / spNhieuBTDan_ /
   spNhieuBTLuu_, PUB/sanpham.js:2200-2301). Mỗi dòng 1 biến thể: giữ hãng, thông số, ảnh của SP gốc; đổi mã / màu / bề mặt /
   dung tích, giá riêng. Máy chủ chặn trùng theo MÃ + MÀU + DUNG TÍCH. Biến thể khác mã (hoặc SP gốc đã có nhóm gom tay) được gom
   1 nhóm biến thể bằng setBienThe.
   Props: product (SP gốc, object danh sách, phải có ma), specs, onClose(), onDone({ok, nhomBT, btNhom}) sau khi tạo xong
          (btNhom = danh sách nhóm mới của SP gốc, để modal Sửa đang mở cập nhật ngay; null nếu không gom nhóm). */
export default function QuickVariantsModal({ product, specs, onClose, onDone }) {
  const p = product || {}
  const raw = p.raw || {}
  const [rows, setRows] = useState(() => [varRow_({ ma: p.ma })])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  // trục biến thể theo ngành của SP gốc (cùng bảng với khối Biến thể ở Nhập dữ liệu)
  const ng = nganhCuaSP_(p, specs)
  const cols = varCols_(ng, coSpec_(ng) ? specNganh_(ng, specs) : null, raw.hang_muc || p.hangMuc || '')

  async function luu() {
    if (busy) return
    if (rows.some(r => String(r.anh || '').indexOf('data:') === 0)) return setErr('Đợi ảnh biến thể tải lên xong rồi bấm lại.')
    const ds = rows.filter(r => varRowCo_({ ...r, ma: String(r.ma || '').trim() === p.ma ? '' : r.ma }))   // dòng chỉ có mã gốc = chưa nhập gì
    if (!ds.length) return setErr('Nhập ít nhất 1 biến thể.')
    const { SP_COL2LABEL_ } = dbLabelMaps_(specs)
    const goc = {}
    Object.keys(raw).forEach(col => { const lb = SP_COL2LABEL_[col]; if (lb && col !== 'gia_dai_ly') goc[lb] = raw[col] })
    goc['TÊN SẢN PHẨM'] = p.ten; goc['ẢNH SẢN PHẨM'] = p.anhTatCa || p.hinhAnh || ''
    // dữ liệu từng biến thể: SP gốc + ô đã nhập (ô trống = giữ giá trị của SP gốc)
    const dOf = r => {
      const d = Object.assign({}, goc)
      cols.forEach(c => { const x = String((r.v || {})[c.lb] || '').trim(); if (x) d[c.lb] = x })
      d['MÃ SẢN PHẨM'] = String(r.ma || '').trim() || p.ma
      d['GIÁ BÁN LẺ'] = tkNum_(r.gia) > 0 ? tkNum_(r.gia) : (tkNum_(goc['GIÁ BÁN LẺ']) || 0)
      if (r.anh) d['ẢNH SẢN PHẨM'] = [r.anh].concat(String(goc['ẢNH SẢN PHẨM'] || '').split('\n').map(x => x.trim()).filter(x => x && x !== r.anh)).join('\n')
      return d
    }
    if (ds.some(r => !(dOf(r)['GIÁ BÁN LẺ'] > 0))) return setErr('Sản phẩm gốc chưa có giá — nhập Giá bán lẻ cho từng biến thể.')
    // Khoá trùng GIỐNG máy chủ: mã + màu + kích thước / dung tích. Đã có -> bỏ qua (không ghi đè SP cũ)
    const khoa = (ma, m, kt) => spNorm_(ma) + '|' + spNorm_(m) + '|' + spNorm_(kt)
    const co = {}; (getState().products || []).forEach(x => { co[khoa(x.ma, x.mauSac, x.raw && x.raw.kich_thuoc)] = 1 })
    const trongDs = {}, tao = [], trung = []
    ds.forEach(r => {
      const d = dOf(r), kk = khoa(d['MÃ SẢN PHẨM'], d['MÀU SẮC'], d['KÍCH THƯỚC'])
      const nh = [d['MÃ SẢN PHẨM']].concat(cols.map(c => (r.v || {})[c.lb])).filter(x => String(x || '').trim()).join(' · ')
      if (co[kk] || trongDs[kk]) trung.push(nh); else { trongDs[kk] = 1; tao.push(d) }
    })
    if (!tao.length) return setErr('Đã có sản phẩm trùng mã + màu + kích thước: ' + trung.join('; ') + '. Biến thể khác bề mặt cần mã riêng (VD GJ8B).')
    setErr('')
    let ok = 0, khacMa = false
    const loi = [], moiIds = []
    for (let j = 0; j < tao.length; j++) {
      const d = tao[j]; setBusy('Đang tạo ' + (j + 1) + '/' + tao.length + '…')
      if (d['MÃ SẢN PHẨM'] !== p.ma) khacMa = true
      try { const rs = await api.saveDbProduct(d); ok++; if (rs && rs.id != null) moiIds.push(String(rs.id)) }
      catch (e) { loi.push(d['MÃ SẢN PHẨM'] + ': ' + String(e.message || e).slice(0, 60)) }
    }
    // Gom 1 NHÓM biến thể: SP gốc đã có nhóm gom tay, hoặc có biến thể KHÁC MÃ (không tự gom theo mã được)
    let nh2 = null, btNhom = null
    try {
      setState({ products: (await api.getProducts()) || getState().products })
      if (String(p.nhomBT || '').trim() || khacMa) {
        const ids = (getState().products || []).filter(x => {
          const id = String(x.recordId)
          return id !== String(p.recordId) && (x.ma === p.ma || (p.nhomBT && x.nhomBT === p.nhomBT) || moiIds.indexOf(id) >= 0)
        }).map(x => ({ id: x.recordId }))
        await api.setBienThe(String(p.recordId), ids)
        setState({ products: (await api.getProducts()) || getState().products })
        const goc2 = (getState().products || []).filter(x => String(x.recordId) === String(p.recordId))[0]
        nh2 = goc2 && goc2.nhomBT
        if (nh2) btNhom = (getState().products || []).filter(x => x.nhomBT === nh2 && String(x.recordId) !== String(p.recordId)).map(btItem_)
      }
    } catch (e) { loi.push('Gom nhóm biến thể: ' + String(e.message || e).slice(0, 60)) }
    setBusy('')
    qsToast('Đã tạo ' + ok + ' biến thể cho ' + p.ma + (trung.length ? (' · bỏ qua ' + trung.length + ' dòng đã có') : '') + (loi.length ? (' · lỗi: ' + loi.join('; ')) : ''))
    if (onDone) onDone({ ok, nhomBT: nh2, btNhom })
    if (onClose) onClose()
  }

  return (
    <MrootPortal>
      <div className="qsc-ov qspe-ov" onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
        <div className="qspe-dlg qspe-nbt" role="dialog" aria-modal="true">
          <div className="qspe-head"><h3><QsIcon name="layers" size={16} /> Tạo nhanh biến thể</h3>
            <button type="button" className="qspe-x" onClick={() => { if (!busy) onClose() }}>✕</button></div>
          <div className="qspe-nbt-src">
            {p.hinhAnh ? <img src={imgSrc1_(p.hinhAnh)} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden' }} /> : null}
            <div><b>{p.ten || ''}</b><span>{'Mã ' + (p.ma || '') + (p.thuongHieu ? ' · ' + p.thuongHieu : '') + (p.mauSac ? ' · ' + p.mauSac : '')
              + (raw.be_mat ? ' · ' + raw.be_mat : '') + (raw.kich_thuoc ? ' · ' + raw.kich_thuoc : '')}</span></div>
          </div>
          <p className="qspe-ask-note">Mỗi dòng là 1 biến thể — giữ nguyên hãng, thông số, ảnh của sản phẩm gốc; ô để trống dùng giá trị của sản phẩm gốc.{' '}
            Bề mặt khác nhau (Bóng / Mờ…) thường có <b>mã riêng</b> (VD Mờ GJ8 · Bóng GJ8B). Dán được bảng từ Excel theo thứ tự cột.</p>
          <VariantTable cols={cols} rows={rows} onChange={fn => setRows(fn)} maGoc={p.ma || ''} giaGoc={p.giaBanLe || raw.gia_ban_le || ''} />
          {err ? <div className="qspe-ask-err" role="alert">{err}</div> : null}
          <div className="qspe-ask-f-btn">
            <button type="button" className="qspe-btn ghost sm" onClick={() => { if (!busy) onClose() }}>Huỷ</button>
            <button type="button" className="qspe-btn blue" disabled={!!busy} onClick={luu}>{busy || <><QsIcon name="check" size={15} /> Tạo biến thể</>}</button>
          </div>
        </div>
      </div>
    </MrootPortal>
  )
}
