import { useState } from 'react'
import { GROUP_ORDER, fmt } from '../../../data/marketingData'
import { Ic } from './CampaignsTab'

const COLS = '56px minmax(0,2.4fr) minmax(0,1fr) minmax(0,1.2fr)'

/* Tab "Danh mục" (kiểu QS): module thanh công cụ (ô tìm + chip nhóm + số hạng mục) · mỗi nhóm 1 module bảng, hàng tiêu đề màu đậm */
export default function CatalogTab({ visible, catalog, onAddItem }) {
  const [q, setQ] = useState('')
  const [nhom, setNhom] = useState('')
  const tim = q.trim().toLowerCase()
  const khop = it => !tim || (it.name + ' ' + it.unit + ' ' + it.id).toLowerCase().indexOf(tim) >= 0
  const nhomDs = GROUP_ORDER.filter(g => catalog.some(c => c.group === g))
  return (
    <div style={{ display: visible ? 'flex' : 'none', flexDirection: 'column', gap: 16 }}>
      <div className="mk-mod">
        <div className="mk-mod-h">
          <span className="mk-mod-ic"><Ic n="layers" /></span>
          <b>Danh mục hạng mục chi phí</b><span className="mk-cnt">{catalog.length}</span>
          <div className="mk-seg2" role="radiogroup" aria-label="Lọc nhóm">
            <button type="button" role="radio" aria-checked={!nhom} className={!nhom ? 'on' : ''} onClick={() => setNhom('')}>Tất cả</button>
            {nhomDs.map(g => {
              const it = catalog.find(c => c.group === g)
              return <button type="button" key={g} role="radio" aria-checked={nhom === g} className={nhom === g ? 'on' : ''} title={it ? it.groupLabel : g} onClick={() => setNhom(g)}>{g}. {it ? it.groupLabel : ''}</button>
            })}
          </div>
          <span style={{ flex: 1 }} />
          <label className="mk-search"><Ic n="search" s={14} /><input value={q} placeholder="Tìm hạng mục, đơn vị…" onChange={e => setQ(e.target.value)} /></label>
        </div>
        <p className="mk-mod-note">Dùng để chọn vào gói khi tạo chiến dịch. Đơn giá nhân sự (nhóm A) đã gồm BH &amp; KPCĐ doanh nghiệp đóng (BHXH 17.5% + BHYT 3% + BHTN 1% trên lương Gross).</p>
      </div>

      {nhomDs.filter(g => !nhom || g === nhom).map(g => {
        const all = catalog.filter(c => c.group === g)
        const items = all.filter(khop)
        if (tim && !items.length) return null
        return (
          <div className="mk-mod" key={g}>
            <div className="mk-mod-h">
              <span className="mk-grp-badge">{g}</span>
              <b>{all[0].groupLabel}</b><span className="mk-cnt">{items.length}{tim ? '/' + all.length : ''}</span>
            </div>
            <div className="mk-tbl2">
              <div className="mk-tbl2-h" style={{ gridTemplateColumns: COLS }}><span>STT</span><span>Hạng mục</span><span>Đơn vị</span><span className="r">Đơn giá</span></div>
              {items.map((it, i) => (
                <div className="mk-tbl2-r" style={{ gridTemplateColumns: COLS }} key={it.id}>
                  <span className="stt">{i + 1}</span>
                  <span className="nm">{it.name}</span>
                  <span className="mu">{it.unit}</span>
                  <span className="r gia">{fmt(it.price)}</span>
                </div>
              ))}
            </div>
            {/* thêm hạng mục vào nhóm (hỏi qua hộp prompt như bản HTML) */}
            <button type="button" className="mk-add-row" onClick={() => onAddItem(g)}>+ Thêm hạng mục vào nhóm {g}</button>
          </div>
        )
      })}
    </div>
  )
}
