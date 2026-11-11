import { useEffect, useRef, useState } from 'react'
import * as api from '../../../api/qsApi'
import { getState, setState } from '../../../state/store'
import { tkNum_, spNorm_ } from '../../../lib/format'
import { dbLabelMaps_, nganhCuaSP_ } from '../../../lib/productFields'
import { mediaUrl } from '../../../api/files'
import { upFilesSeq_, pickFiles_ } from '../../importer/imgUpload'
import QsIcon from '../../common/QsIcon'
import { MrootPortal } from '../../common/Mroot'
import { qsToast } from '../../common/dialogs'
import { imgSrc1_, spMauCss_, NBT_BM, spNbtDong_, nbtParsePaste_, btItem_ } from './editModel'
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
  const [rows, setRows] = useState(() => [spNbtDong_(p, {})])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const box = useRef(null)
  const focusLast = useRef('first')

  useEffect(() => {
    if (!focusLast.current || !box.current) return
    const ins = box.current.querySelectorAll('.qspe-nbt-ma')
    if (ins.length) {
      const el = focusLast.current === 'first' ? ins[0] : ins[ins.length - 1]
      el.focus(); if (focusLast.current === 'last') el.select()
    }
    focusLast.current = ''
  }, [rows.length])

  const sua = (k, f, v) => setRows(rs => rs.map((r, i) => i === k ? { ...r, [f]: v } : r))
  // Sơn đo theo dung tích; ngành khác (gạch, vệ sinh, đèn…) là kích thước - cùng cột kich_thuoc
  const ktLb = nganhCuaSP_(p, specs) === 'son' ? 'Dung tích' : 'Kích thước'
  /* Ảnh riêng của biến thể (r.anh): tải như khối ảnh Nhập dữ liệu (ảnh tạm data: trong lúc tải); dòng xác định theo vị trí */
  const anhAcc = k => ({ main: (rows[k] || {}).anh || '', list: [],
    put: fn => setRows(rs => rs.map((r, i) => i === k ? { ...r, anh: fn({ main: r.anh || '', list: [] }).main } : r)) })
  function them() {
    setRows(rs => { const a = rs[rs.length - 1] || {}; return rs.concat([spNbtDong_(p, { ma: a.ma, bm: a.bm, kt: a.kt })]) })
    focusLast.current = 'last'
  }
  function bo(k) { setRows(rs => { const n = rs.filter((_, i) => i !== k); return n.length ? n : [spNbtDong_(p, {})] }) }
  function dan(e, k) {
    const t = (e.clipboardData || window.clipboardData).getData('text') || ''
    const moi = nbtParsePaste_(t, rows[k] || spNbtDong_(p, {}))
    if (!moi) return
    e.preventDefault()
    setRows(rs => rs.slice(0, k).concat(moi, rs.slice(k + 1)))
  }

  async function luu() {
    if (busy) return
    if (rows.some(r => String(r.anh || '').indexOf('data:') === 0)) return setErr('Đợi ảnh biến thể tải lên xong rồi bấm lại.')
    const ds = rows.filter(r => [r.mau, r.gia].some(v => String(v || '').trim()) || (String(r.ma || '').trim() && String(r.ma).trim() !== p.ma))
    if (!ds.length) return setErr('Nhập ít nhất 1 biến thể.')
    const thieu = ds.filter(r => !String(r.ma || '').trim() || !(tkNum_(r.gia) > 0))
    if (thieu.length) return setErr('Mỗi dòng cần Mã SP và Giá bán lẻ > 0 (còn ' + thieu.length + ' dòng thiếu).')
    // Khoá trùng GIỐNG máy chủ: mã + màu + dung tích. Đã có -> bỏ qua (không ghi đè SP cũ)
    const khoa = (ma, m, kt) => spNorm_(ma) + '|' + spNorm_(m) + '|' + spNorm_(kt)
    const co = {}; (getState().products || []).forEach(x => { co[khoa(x.ma, x.mauSac, x.raw && x.raw.kich_thuoc)] = 1 })
    const trongDs = {}, tao = [], trung = []
    ds.forEach(r => {
      const kk = khoa(r.ma, r.mau, r.kt), nh = [r.ma, r.mau, r.bm, r.kt].filter(x => String(x || '').trim()).join(' · ')
      if (co[kk] || trongDs[kk]) trung.push(nh); else { trongDs[kk] = 1; tao.push(r) }
    })
    if (!tao.length) return setErr('Đã có sản phẩm trùng mã + màu + dung tích: ' + trung.join('; ') + '. Biến thể khác bề mặt cần mã riêng (VD GJ8B).')
    setErr('')
    const { SP_COL2LABEL_ } = dbLabelMaps_(specs)
    const goc = {}
    Object.keys(raw).forEach(col => { const lb = SP_COL2LABEL_[col]; if (lb && col !== 'gia_dai_ly') goc[lb] = raw[col] })
    goc['TÊN SẢN PHẨM'] = p.ten; goc['ẢNH SẢN PHẨM'] = p.anhTatCa || p.hinhAnh || ''
    let ok = 0, khacMa = false
    const loi = [], moiIds = []
    for (let j = 0; j < tao.length; j++) {
      const r = tao[j]; setBusy('Đang tạo ' + (j + 1) + '/' + tao.length + '…')
      const d = Object.assign({}, goc, { 'MÃ SẢN PHẨM': String(r.ma).trim(), 'MÀU SẮC': String(r.mau || '').trim(), 'KÍCH THƯỚC': String(r.kt || '').trim(), 'GIÁ BÁN LẺ': tkNum_(r.gia) })
      if (String(r.bm || '').trim()) d['BỀ MẶT HOÀN THIỆN'] = String(r.bm).trim()
      // ảnh riêng của biến thể làm ảnh đại diện, ảnh của SP gốc xếp sau
      if (r.anh) d['ẢNH SẢN PHẨM'] = [r.anh].concat(String(goc['ẢNH SẢN PHẨM'] || '').split('\n').map(x => x.trim()).filter(x => x && x !== r.anh)).join('\n')
      if (d['MÃ SẢN PHẨM'] !== p.ma) khacMa = true
      try { const rs = await api.saveDbProduct(d); ok++; if (rs && rs.id != null) moiIds.push(String(rs.id)) }
      catch (e) { loi.push((r.ma || r.mau) + ': ' + String(e.message || e).slice(0, 60)) }
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
        <div className="qspe-dlg qspe-nbt" role="dialog" aria-modal="true" ref={box}>
          <div className="qspe-head"><h3><QsIcon name="layers" size={16} /> Tạo nhanh biến thể</h3>
            <button type="button" className="qspe-x" onClick={() => { if (!busy) onClose() }}>✕</button></div>
          <div className="qspe-nbt-src">
            {p.hinhAnh ? <img src={imgSrc1_(p.hinhAnh)} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden' }} /> : null}
            <div><b>{p.ten || ''}</b><span>{'Mã ' + (p.ma || '') + (p.thuongHieu ? ' · ' + p.thuongHieu : '') + (p.mauSac ? ' · ' + p.mauSac : '')
              + (raw.be_mat ? ' · ' + raw.be_mat : '') + (raw.kich_thuoc ? ' · ' + raw.kich_thuoc : '')}</span></div>
          </div>
          <p className="qspe-ask-note">Mỗi dòng là 1 biến thể — giữ nguyên hãng, thông số, ảnh của sản phẩm gốc; chỉ đổi phần khác nhau và nhập giá riêng.{' '}
            Bề mặt khác nhau (Bóng / Mờ…) thường có <b>mã riêng</b> (VD Mờ GJ8 · Bóng GJ8B) — sửa ô Mã cho đúng bảng giá.{' '}
            Dán từ Excel vào ô đầu: <i>Mã ⇥ Màu ⇥ Bề mặt ⇥ {ktLb} ⇥ Giá</i> (hoặc chỉ Màu ⇥ Giá).{' '}
            Ô <b>Ảnh</b>: bấm hoặc kéo ảnh riêng của biến thể vào — để trống thì dùng ảnh của sản phẩm gốc.</p>
          <datalist id="qspeNbtBmList">{NBT_BM.map(x => <option key={x} value={x} />)}</datalist>
          <div className="qspe-nbt-tbl">
            <div className="qspe-nbt-h"><span>Ảnh</span><span>Mã SP</span><span>Màu sắc</span><span>Bề mặt</span><span>{ktLb}</span><span>Giá bán lẻ (đ) *</span><span></span></div>
            <div>
              {rows.map((r, k) => {
                const c = spMauCss_(r.mau)
                return (
                  <div className="qspe-nbt-r" key={k}>
                    <div className={'qspe-nbt-anh' + (r.anh ? ' on' : '')} tabIndex={0} title={r.anh ? 'Bấm để đổi ảnh' : 'Bấm hoặc kéo ảnh biến thể vào'}
                      onClick={() => pickFiles_(false, 'image/*', fs => upFilesSeq_('main', fs, anhAcc(k)))}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => { e.preventDefault(); const fs = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []).filter(f => !f.type || /^image\//.test(f.type)); if (fs.length) upFilesSeq_('main', fs.slice(0, 1), anhAcc(k)) }}>
                      {r.anh ? <img src={mediaUrl(r.anh)} alt="" /> : <QsIcon name="camera" size={15} />}
                      {r.anh ? <button type="button" title="Bỏ ảnh" onClick={e => { e.stopPropagation(); sua(k, 'anh', '') }}>✕</button> : null}
                    </div>
                    <input className="qspe-nbt-ma" value={r.ma} placeholder="Mã" onChange={e => sua(k, 'ma', e.target.value)} onPaste={e => dan(e, k)} />
                    <label className="qspe-nbt-mauw"><i style={c ? { background: c } : undefined} className={c ? undefined : 'qspe-mau-x'} />
                      <input value={r.mau} placeholder="VD: Trắng" onChange={e => sua(k, 'mau', e.target.value)} /></label>
                    <input value={r.bm} placeholder="VD: Bóng" list="qspeNbtBmList" onChange={e => sua(k, 'bm', e.target.value)} />
                    <input value={r.kt} placeholder={ktLb === 'Dung tích' ? 'VD: 5L' : 'VD: 600 x 600'} onChange={e => sua(k, 'kt', e.target.value)} />
                    <input className="num" value={r.gia} placeholder="0" inputMode="numeric" onChange={e => sua(k, 'gia', e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); them() } }} />
                    <button type="button" className="qspe-cb-del" title="Bỏ dòng" onClick={() => bo(k)}><QsIcon name="x" size={14} /></button>
                  </div>
                )
              })}
            </div>
          </div>
          <button type="button" className="qspe-btn ghost sm" onClick={them}><QsIcon name="plus" size={14} /> Thêm biến thể</button>
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
