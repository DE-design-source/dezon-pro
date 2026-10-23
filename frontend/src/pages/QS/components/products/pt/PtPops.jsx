import QsIcon from '../../common/QsIcon'
import FloatPop from '../list/FloatPop'
import { PT_LOAI } from '../../../lib/phantho.js'

/* Bộ lọc công tác (ptFltPop_, PUB/sanpham.js:1256-1292): loại báo giá, đơn vị tính (14 ĐVT hay dùng nhất), hạng mục, khoảng đơn giá,
   trạng thái (đã có trong bảng / chưa thêm / đã sửa giá). Cùng khung với bảng Bộ lọc sản phẩm (lớp qspl-flt của list/SpPops).
   Props: anchor, all (mọi công tác của thư viện), f (bộ lọc chung), onSet(key, val), onReset(), onClose() */
export function PtFilterPop({ anchor, all, f, onSet, onReset, onClose }) {
  const chips = (title, key, vals) => (
    <div className="qspl-fgrp"><div className="qspl-fgt">{title}</div><div className="qspl-fchips">
      <span className={`qspl-chip sm${!f[key] ? ' on' : ''}`} onClick={() => onSet(key, '')}>Tất cả</span>
      {vals.map(v => <span key={v[0]} className={`qspl-chip sm${f[key] === v[0] ? ' on' : ''}`} onClick={() => onSet(key, v[0])}>{v[1]}</span>)}
    </div></div>
  )
  const dvt = {}; all.forEach(r => { if (r.dvt) dvt[r.dvt] = (dvt[r.dvt] || 0) + 1 })
  const dvtVals = Object.keys(dvt).sort((a, b) => dvt[b] - dvt[a]).slice(0, 14).map(v => [v, v + ' (' + dvt[v] + ')'])
  const nhom = {}; all.forEach(r => { nhom[r.nhom] = (nhom[r.nhom] || 0) + 1 })
  const nhomVals = Object.keys(nhom)
  const st = (key, val, lbl) => <span className={`qspl-chip sm${f[key] === val ? ' on' : ''}`} onClick={() => onSet(key, val)}>{lbl}</span>
  return (
    <FloatPop anchor={anchor} place="below-right" onClose={onClose} className="qspl-flt" deps={[all.length]}>
      <div className="qspl-fhdr">Bộ lọc công tác</div>
      {chips('Loại báo giá', 'ptLoai', PT_LOAI.map(x => [x[0], x[1]]))}
      {chips('Đơn vị tính', 'ptDvt', dvtVals)}
      <div className="qspl-fgrp"><div className="qspl-fgt">Hạng mục</div>
        <select className="qspl-fsel qsppt-fsel" value={f.ptNhom || ''} onChange={e => onSet('ptNhom', e.target.value)}>
          <option value="">Tất cả hạng mục</option>
          {nhomVals.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div className="qspl-fgrp"><div className="qspl-fgt">Khoảng đơn giá (đ)</div><div className="qspl-fprice">
        <input type="number" placeholder="Từ" value={f.min || ''} onChange={e => onSet('min', Number(e.target.value) || 0)} />
        <span>–</span>
        <input type="number" placeholder="Đến" value={f.max || ''} onChange={e => onSet('max', Number(e.target.value) || 0)} />
      </div></div>
      <div className="qspl-fgrp"><div className="qspl-fgt">Trạng thái</div><div className="qspl-fchips">
        <span className={`qspl-chip sm${!f.ptDa ? ' on' : ''}`} onClick={() => onSet('ptDa', '')}>Tất cả</span>
        {st('ptDa', '1', 'Đã có trong bảng')}
        {st('ptDa', '0', 'Chưa thêm')}
        <span className={`qspl-chip sm${f.ptSua === '1' ? ' on' : ''}`} onClick={() => onSet('ptSua', f.ptSua === '1' ? '' : '1')}>Đã sửa giá</span>
      </div></div>
      <div className="qspl-fftr">
        <button type="button" className="qsc-btn" onClick={onReset}>Xóa lọc</button>
        <button type="button" className="qsc-btn blue" onClick={onClose}>Xong</button>
      </div>
    </FloatPop>
  )
}

/* "⋯" của thanh chọn nhiều ở Phần thô (spBulkMorePop_ nhánh PT): Tải Excel n dòng · Bỏ duyệt · Bỏ yêu thích · Xoá công tác */
export function PtMorePop({ anchor, n, canDuyet, onXlsx, onUnduyet, onUnfav, onDelete, onClose }) {
  const run = fn => () => { onClose(); fn() }
  return (
    <FloatPop anchor={anchor} place="above-center" onClose={onClose} className="qspl-bbpop qspl-mn">
      <button type="button" onClick={run(onXlsx)}><QsIcon name="download" size={15} /> Tải Excel {n} dòng</button>
      {canDuyet && <button type="button" onClick={run(onUnduyet)}><QsIcon name="close" size={15} /> Bỏ duyệt</button>}
      <button type="button" onClick={run(onUnfav)}><QsIcon name="star" size={15} /> Bỏ yêu thích</button>
      <div className="qspl-mn-sep" />
      <button type="button" className="danger" onClick={run(onDelete)}><QsIcon name="trash" size={15} /> Xoá công tác</button>
    </FloatPop>
  )
}
