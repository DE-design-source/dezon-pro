import { useState } from 'react'
import Pop from './Pop'
import Icon from '../../../../../components/ui/Icon'
import { MrootPortal } from '../../common/Mroot'
import { money } from '../../../lib/format.js'
import { nhomOptions, spBocOk_ } from '../../../lib/catalogFilters.js'
import { pickProduct, createProductFromLine } from './bocActions'

/* Chọn sản phẩm cho 1 dòng (openPick / drawPick PUB/boc.js:713-736): tìm theo tên + mã + thương hiệu, tối đa 60 kết quả,
   "＋ Tạo sản phẩm mới" mở hộp tạo SP (openCreateProduct 738-775). Props: anchor, line, products, onClose */
export default function LinePicker({ anchor, line, products, onClose }) {
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  if (creating) return <CreateProductDialog line={line} products={products} onClose={onClose} />
  const ql = q.toLowerCase()
  // chỉ SP đã duyệt (M14.6)
  const list = (products || []).filter(p => spBocOk_(p) && (!ql || (p.ten + ' ' + p.ma + ' ' + p.thuongHieu).toLowerCase().indexOf(ql) >= 0)).slice(0, 60)
  return (
    <Pop anchor={anchor} width={380} className="qs-tk-pick" onClose={onClose}>
      <input className="qs-tk-pickq" autoFocus placeholder="Tìm sản phẩm…" value={q} onChange={e => setQ(e.target.value)} />
      <div className="qs-tk-picknew" onClick={() => setCreating(true)}>＋ Tạo sản phẩm mới</div>
      <div className="qs-tk-picklist">
        {list.length ? list.map(p => (
          <div key={p.recordId || p.ma + '|' + p.ten} className="qs-tk-fi" onClick={() => { onClose(); pickProduct(line.lineId, p) }}>
            <b>{p.ten}</b>
            <div className="qs-tk-picksub">{(p.thuongHieu || '') + ' · ' + money(p.donGiaBan)}</div>
          </div>
        )) : <div className="qs-tk-fi">Không có SP khớp.</div>}
      </div>
    </Pop>
  )
}

/* ＋ Tạo sản phẩm mới: nhập tay -> lưu vào Danh mục SP (saveLineAsProduct) + điền ngược vào dòng (submitCreateProduct) */
export function CreateProductDialog({ line, products, onClose }) {
  const l = line || {}
  const [f, setF] = useState(() => ({
    ten: l.ten || '', nhom: '', hangMuc: '', thuongHieu: l.thuongHieu || '', ncc: l.ncc || '', ma: l.maSP || '', kichThuoc: l.kichThuoc || '',
    dvt: l.dvt || 'Cái', gia: String(Number(l.donGiaBan) || 0), moTa: l.moTa || '', hinhAnh: String(l.hinhAnh || '').indexOf('http') === 0 ? l.hinhAnh : '',
  }))
  const [busy, setBusy] = useState(false)
  const nhoms = Object.keys(nhomOptions(products)).sort()
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const In = ({ k, ph, ...rest }) => <input className="qsc-ask-in" value={f[k]} placeholder={ph || ''} onChange={set(k)} {...rest} />
  const Row = ({ label, children }) => <label className="qs-tk-cprow"><span>{label}</span>{children}</label>
  async function save() {
    setBusy(true)
    const done = await createProductFromLine(l.lineId, f)
    setBusy(false)
    if (done) onClose()
  }
  return (
    <MrootPortal>
      <div className="qsc-ov" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="qsc-dlg qs-tk-cp" role="dialog">
          <div className="qs-tk-cph">＋ Tạo sản phẩm mới vào danh mục</div>
          <datalist id="qsTkNhomList">{nhoms.map(n => <option key={n} value={n} />)}</datalist>
          {Row({ label: 'Tên sản phẩm *', children: In({ k: 'ten', ph: 'Tên sản phẩm…', autoFocus: true }) })}
          <div className="qs-tk-cp2">
            {Row({ label: 'Nhóm *', children: In({ k: 'nhom', ph: 'VD: Đèn rọi', list: 'qsTkNhomList' }) })}
            {Row({ label: 'Hạng mục', children: In({ k: 'hangMuc', ph: 'VD: Đèn chiếu sáng' }) })}
          </div>
          <div className="qs-tk-cp2">
            {Row({ label: 'Thương hiệu', children: In({ k: 'thuongHieu' }) })}
            {Row({ label: 'Nhà cung cấp', children: In({ k: 'ncc' }) })}
          </div>
          <div className="qs-tk-cp2">
            {Row({ label: 'Mã SP', children: In({ k: 'ma' }) })}
            {Row({ label: 'Kích thước', children: In({ k: 'kichThuoc' }) })}
          </div>
          <div className="qs-tk-cp2 dvt">
            {Row({ label: 'ĐVT', children: In({ k: 'dvt' }) })}
            {Row({ label: 'Đơn giá', children: In({ k: 'gia', type: 'number' }) })}
          </div>
          {Row({ label: 'Mô tả', children: <textarea className="qsc-ask-in qs-tk-cpta" value={f.moTa} onChange={set('moTa')} /> })}
          {Row({ label: 'Link ảnh (URL)', children: In({ k: 'hinhAnh', ph: 'https://…' }) })}
          <div className="qsc-ask-btns">
            <button className="qsc-btn" onClick={onClose}>Huỷ</button>
            <button className="qsc-btn blue" disabled={busy} onClick={save}>{busy ? '⏳ Đang lưu…' : <><Icon name="check" size={15} /> Lưu vào danh mục</>}</button>
          </div>
        </div>
      </div>
    </MrootPortal>
  )
}
