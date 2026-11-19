import { useEffect, useRef } from 'react'
import QsIcon from './QsIcon'
import { mediaUrl } from '../../api/files'
import { upFilesSeq_, pickFiles_ } from '../importer/imgUpload'
import { varRow_ } from '../../lib/variants'
import './common.css'

/* Bảng biến thể dùng chung (Nhập dữ liệu + Tạo nhanh biến thể ở Danh sách SP): MỖI DÒNG = 1 biến thể.
   Cột: Ảnh · các trục theo ngành (varCols_, lib/variants.js) · Mã SP · Giá bán lẻ. Ô trục / mã / giá để trống = dùng giá trị chung của sản phẩm.
   Thêm dòng chép trục + mã của dòng cuối; Enter ở ô Giá = thêm dòng; dán bảng từ Excel (nhiều cột, nhiều dòng) vào ô bất kỳ:
   cột Excel đổ lần lượt từ ô đang dán sang phải theo thứ tự cột của bảng.
   Props: cols [{lb, ten, ph, ds}], rows [{id, v:{lb: giá trị}, ma, gia, anh}], onChange(fn(rows) -> rows), maGoc, giaGoc. */

export default function VariantTable({ cols, rows, onChange, maGoc, giaGoc }) {
  const box = useRef(null)
  const focusNew = useRef(false)
  useEffect(() => {
    if (!focusNew.current || !box.current) return
    focusNew.current = false
    const rs = box.current.querySelectorAll('.qsc-vt-r')
    const el = rs.length && rs[rs.length - 1].querySelector('input')
    if (el) el.focus()
  }, [rows.length])

  // thứ tự ô nhập của 1 dòng: trục..., ma, gia
  const keys = cols.map(c => c.lb).concat(['__ma', '__gia'])
  const getK = (r, k) => (k === '__ma' ? r.ma : k === '__gia' ? r.gia : (r.v || {})[k] || '')
  const setK = (r, k, val) => (k === '__ma' ? { ...r, ma: val } : k === '__gia' ? { ...r, gia: val } : { ...r, v: { ...(r.v || {}), [k]: val } })
  const sua = (id, k, val) => onChange(rs => rs.map(r => (r.id === id ? setK(r, k, val) : r)))
  const them = () => { focusNew.current = true; onChange(rs => rs.concat(varRow_(rs[rs.length - 1]))) }
  const nhanBan = id => onChange(rs => { const i = rs.findIndex(r => r.id === id); const b = { ...varRow_(rs[i]), gia: rs[i].gia, anh: rs[i].anh }; return rs.slice(0, i + 1).concat(b, rs.slice(i + 1)) })
  const bo = id => onChange(rs => rs.filter(r => r.id !== id))
  const dan = (e, id, k) => {
    const t = (e.clipboardData && e.clipboardData.getData('text')) || ''
    if (t.indexOf('\t') < 0 && t.indexOf('\n') < 0) return
    e.preventDefault()
    const lines = t.replace(/\r/g, '').split('\n').map(l => l.split('\t').map(x => x.trim())).filter(c => c.some(Boolean))
    const k0 = keys.indexOf(k)
    onChange(rs => {
      const i = rs.findIndex(r => r.id === id), out = rs.slice()
      lines.forEach((cells, j) => {
        let r = out[i + j] || varRow_(out[out.length - 1])
        cells.forEach((x, m) => { const kk = keys[k0 + m]; if (kk) r = setK(r, kk, x) })
        if (i + j < out.length) out[i + j] = r; else out.push(r)
      })
      return out
    })
  }
  const anhAcc = id => ({
    main: (rows.find(r => r.id === id) || {}).anh || '', list: [],
    put: fn => onChange(rs => rs.map(r => (r.id === id ? { ...r, anh: fn({ main: r.anh || '', list: [] }).main } : r))),
  })
  const tha = (e, id) => {
    e.preventDefault()
    const fs = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter(f => !f.type || /^image\//.test(f.type))
    if (fs.length) upFilesSeq_('main', fs.slice(0, 1), anhAcc(id))
  }
  const tpl = '44px ' + cols.map(() => 'minmax(80px, 1fr)').join(' ') + ' minmax(90px, 1fr) minmax(84px, .8fr) 56px'
  // mọi dòng (kể cả tiêu đề) cùng bề rộng tối thiểu = tổng cột tối thiểu, để cột thẳng hàng khi khung hẹp phải cuộn ngang
  const minW = 44 + 80 * cols.length + 90 + 84 + 56 + 6 * (cols.length + 3) + 16

  return (
    <div className="qsc-vt" ref={box}>
      {cols.map(c => (c.ds && c.ds.length ? <datalist key={c.lb} id={'qscvt-' + c.lb}>{c.ds.map(o => <option key={o} value={o} />)}</datalist> : null))}
      {rows.length ? (
        <div className="qsc-vt-t">
          <div className="qsc-vt-r qsc-vt-h" style={{ gridTemplateColumns: tpl, minWidth: minW }}>
            <span>Ảnh</span>{cols.map(c => <span key={c.lb}>{c.ten}</span>)}<span>Mã SP</span><span>Giá bán lẻ (đ)</span><span />
          </div>
          {rows.map(r => (
            <div className="qsc-vt-r" key={r.id} style={{ gridTemplateColumns: tpl, minWidth: minW }}>
              <div className={'qsc-vt-anh' + (r.anh ? ' on' : '')} tabIndex={0} title={r.anh ? 'Bấm để đổi ảnh' : 'Bấm hoặc kéo ảnh riêng của biến thể vào (trống = dùng ảnh chung)'}
                onClick={() => pickFiles_(false, 'image/*', fs => upFilesSeq_('main', fs, anhAcc(r.id)))}
                onDragOver={e => e.preventDefault()} onDrop={e => tha(e, r.id)}>
                {r.anh ? <img src={mediaUrl(r.anh)} alt="" /> : <QsIcon name="camera" size={15} />}
                {r.anh ? <button type="button" title="Bỏ ảnh" onClick={e => { e.stopPropagation(); onChange(rs => rs.map(x => (x.id === r.id ? { ...x, anh: '' } : x))) }}>✕</button> : null}
              </div>
              {cols.map(c => (
                <input key={c.lb} value={getK(r, c.lb)} placeholder={c.ph} list={c.ds && c.ds.length ? 'qscvt-' + c.lb : undefined}
                  onChange={e => sua(r.id, c.lb, e.target.value)} onPaste={e => dan(e, r.id, c.lb)} />
              ))}
              <input value={r.ma} placeholder={maGoc || 'Mã SP'} onChange={e => sua(r.id, '__ma', e.target.value)} onPaste={e => dan(e, r.id, '__ma')} />
              <input className="num" inputMode="numeric" value={r.gia} placeholder={giaGoc ? String(giaGoc) : '0'}
                onChange={e => sua(r.id, '__gia', e.target.value)} onPaste={e => dan(e, r.id, '__gia')}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); them() } }} />
              <span className="qsc-vt-act">
                <button type="button" title="Nhân bản dòng này" onClick={() => nhanBan(r.id)}><QsIcon name="copy" size={13} /></button>
                <button type="button" className="del" title="Bỏ dòng" onClick={() => bo(r.id)}><QsIcon name="x" size={13} /></button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="qsc-vt-f">
        <button type="button" className="qsc-vt-add" onClick={them}><QsIcon name="plus" size={14} /> Thêm biến thể</button>
        <span>{rows.length ? rows.length + ' biến thể · ' : ''}Enter ở ô Giá = thêm dòng · dán được bảng từ Excel</span>
      </div>
    </div>
  )
}
