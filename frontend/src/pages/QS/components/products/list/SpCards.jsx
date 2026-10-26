import QsIcon from '../../common/QsIcon'
import ProductThumb from '../../common/ProductThumb'
import { mediaUrl } from '../../../api/files'
import { money } from '../../../lib/format.js'
import { spColVal_, spKey_ } from './spModel'

/* Chế độ xem Lưới (thẻ như trang thương mại điện tử) và Danh sách (mỗi SP 1 hàng ngang, ảnh lớn + thông số chính) của tab Danh sách SP.
   Cùng dữ liệu / phân trang / chọn nhiều với bảng (SpTable); bỏ các dòng phụ của combo (dòng SP đi kèm, ghi chú, tổng combo).
   Props: layout ('grid' | 'list'), cols (cột đang hiện: Danh sách lấy các cột thông số làm dòng "nhãn: giá trị"), rows, sel,
          skuCount(p), canDuyet, on (cùng bộ hàm với SpTable: open, fav, add, duyet, editP, selToggle, btToggle) */
const img1 = v => (v ? mediaUrl(String(v).split('\n')[0].trim()) : '')
const SPEC_MAX = 6

export default function SpCards({ layout, cols, rows, sel, skuCount, canDuyet, on }) {
  const items = rows.filter(r => !r.m.k)
  if (!items.length) return <div className={`qspl-cards ${layout}`} data-sp-wrap="1"><div className="qspl-empty">Không có sản phẩm khớp bộ lọc.</div></div>
  const specCols = cols.filter(c => c.e && !c.e.money && c.e.col !== 'link_datasheet').slice(0, SPEC_MAX)
  return (
    <div className={`qspl-cards ${layout}`} data-sp-wrap="1">
      {items.map(r => {
        const p = r.p, key = spKey_(p), isSel = !!sel[key], n = skuCount(p)
        const specs = layout === 'list' ? specCols.map(c => [c.label, spColVal_(p, c.e.col)]).filter(x => x[1] !== '' && x[1] != null) : []
        return (
          <div key={key} className={`qspl-pc${isSel ? ' sel' : ''}${r.kid ? ' kid' : ''}`} onClick={() => on.open(p)}>
            <div className="qspl-pc-img">
              <ProductThumb product={p} size={layout === 'grid' ? 160 : 96} src={img1(p.hinhAnh)} />
              <input type="checkbox" className="qspl-ck qspl-pc-ck" checked={isSel} title="Chọn"
                onClick={e => e.stopPropagation()} onChange={e => on.selToggle(key, e.target.checked)} />
              <button type="button" className={`qspl-pc-fav${p.yeuThich ? ' on' : ''}`} title={p.yeuThich ? 'Bỏ khỏi sản phẩm yêu thích' : 'Thêm vào sản phẩm yêu thích'}
                onClick={e => { e.stopPropagation(); on.fav(p) }}><QsIcon name="star" size={15} /></button>
            </div>
            <div className="qspl-pc-body">
              <div className="qspl-pc-top">
                <span className={`qspl-duyet${p.daDuyet ? ' on' : ''}`}>{p.daDuyet ? 'Đã duyệt' : 'Chưa duyệt'}</span>
                {n > 1 && <span className="qspl-sku multi" title={n + ' biến thể cùng mã ' + (p.ma || '')}>{n} SKU</span>}
              </div>
              <b className="qspl-pc-name" title={p.ten || ''}>{p.ten || ''}</b>
              <span className="qspl-code">{p.ma || ''}{p.thuongHieu ? ' · ' + p.thuongHieu : ''}</span>
              {(p.comboN || r.bt) ? (
                <span className="qspl-tags">
                  {p.comboN ? <span className="qspl-cbn" title={'Combo ' + p.comboN + ' sản phẩm đi kèm — bấm thẻ để xem chi tiết'}><QsIcon name="layers" size={11} />Combo <b>{p.comboN}</b></span> : null}
                  {r.bt ? <button type="button" className="qspl-cbn bt" title="Xem các biến thể" onClick={e => { e.stopPropagation(); on.btToggle(r.bt.key) }}><QsIcon name="copy" size={11} />Biến thể <b>{r.bt.n}</b></button> : null}
                </span>
              ) : null}
              {specs.length > 0 && (
                <dl className="qspl-pc-specs">
                  {specs.map(s => <div key={s[0]}><dt>{s[0]}</dt><dd>{s[1]}</dd></div>)}
                </dl>
              )}
            </div>
            <div className="qspl-pc-foot">
              <div className="qspl-pc-price">
                <b>{money(p.donGiaBan)}<span className="unit">đ</span></b>
                {Number(p.giaBanLe) > Number(p.donGiaBan) && <s>{money(p.giaBanLe)}đ</s>}
              </div>
              <div className="qspl-pc-acts" onClick={e => e.stopPropagation()}>
                {canDuyet && !p.spChung && <button type="button" className={`qspl-act ${p.daDuyet ? 'undo' : 'ok'}`} title={p.daDuyet ? 'Bỏ duyệt' : 'Duyệt sản phẩm này'} onClick={() => on.duyet(p)}><QsIcon name="check" size={15} /></button>}
                {!p.spChung && <button type="button" className="qspl-act edit" title="Cập nhật sản phẩm" onClick={() => on.editP(p)}><QsIcon name="edit" size={15} /></button>}
                <button type="button" className="qspl-pc-add" title="Ghi danh vào dự án" onClick={() => on.add(p)}><QsIcon name="plus" size={14} />Thêm</button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
