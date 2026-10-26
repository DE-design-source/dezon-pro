import { useState } from 'react'
import QsIcon from '../../common/QsIcon'
import ProductThumb from '../../common/ProductThumb'
import { mediaUrl } from '../../../api/files'
import { money } from '../../../lib/format.js'
import { inNode_, nodeName } from '../../../lib/tree.js'
import { dezonUrl_, dezonLinkIn_ } from '../../../lib/dashModel.js'
import { spRemoveFromProject } from './spActions'
import { lsJson, lsSet } from './spModel'

/* Panel trái "Sản phẩm trong dự án" (renderSpProjPanel_, spSwitchProject, dezonChip_/dezonSet_ - PUB/sanpham.js:46-79, dash.js:11-38).
   Props: qs (useQs()), dragOn (đang kéo SP từ bảng), onDropList() -> thả vào panel, onHide() thu gọn panel,
          part ('head' = chỉ hàng tiêu đề, đặt trên băng xanh · 'body' = phần còn lại · không có = cả hai). */
const img1 = v => mediaUrl(String(v || '').split('\n')[0].trim())
/* Chế độ xem danh sách trong panel (chỉ biểu tượng, nhớ trong máy qs_pplayout): Thẻ (như cột Hạng mục Bóc tách) · Danh sách gọn · Lưới ảnh */
const PP_LAYOUTS = [
  ['card', 'Thẻ', <svg key="c" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="7" rx="1.5" /><rect x="3" y="13" width="18" height="7" rx="1.5" /></svg>],
  ['list', 'Danh sách gọn', <QsIcon key="l" name="list" size={15} />],
  ['grid', 'Lưới ảnh', <svg key="g" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>],
]

export default function ProjPanel({ qs, dragOn, onDrop, onHide, part, node }) {
  const { cur, projects, lines, selectProject, mutate, toast, ask, confirm } = qs
  const [over, setOver] = useState(false)
  const [lay, setLaySt] = useState(() => { const v = lsJson('qs_pplayout', 'card'); return PP_LAYOUTS.some(x => x[0] === v) ? v : 'card' })
  const setLay = v => { setLaySt(v); lsSet('qs_pplayout', JSON.stringify(v)) }
  /* Chỉ hiện sản phẩm thuộc hạng mục đang chọn ở đầu băng (node, vd. 3.2.6.1 Thiết bị đèn -> chỉ dòng thiết bị đèn); chưa chọn = tất cả */
  const allN = cur ? (lines || []).length : 0
  const shown = cur ? (lines || []).filter(l => inNode_(l, node)) : []
  const n = shown.length

  async function switchProject(v) {
    if (v === '__new__') { await createProject(); return }
    if (!v) return
    await selectProject(v)
  }
  /* Form "Tạo dự án mới" của bản gốc (#mCreate, index.html:6798-6808 · doCreate app.js:450-461) */
  async function createProject() {
    const r = await ask({
      title: 'Tạo dự án mới', ok: 'Lưu dự án',
      fields: [
        { key: 'ten', label: 'Tên dự án *', placeholder: 'VD: Nhà phố anh Thành' },
        { key: 'khachHang', label: 'Khách hàng' },
        { key: 'sdt', label: 'Số điện thoại' },
        { key: 'diaChi', label: 'Địa chỉ' },
        { key: 'linkDezon', label: 'Link dự án trên Dezon (tuỳ chọn)', placeholder: 'https://dezon.vn/…' },
        { key: 'vat', label: 'VAT (%)', type: 'number', value: '0' },
      ],
    })
    if (!r) return
    const ten = String(r.ten || '').trim()
    if (!ten) { toast('Nhập tên dự án'); return }
    try {
      const link = String(r.linkDezon || '').trim()
      await mutate.createProject({ ten, khachHang: r.khachHang || '', sdt: r.sdt || '', diaChi: r.diaChi || '',
        linkDezon: link ? dezonUrl_(link) : '', vat: Number(r.vat) || 0 })
      toast('Đã tạo bản nháp')
    } catch (e) { toast('Lỗi: ' + ((e && e.message) || e)) }
  }
  async function setLink() {
    const p = cur
    const v0 = await ask({ title: 'Link bài dự án trên dezon.vn', label: 'Dán link (để trống = bỏ link)', required: false,
      value: p.linkDezon || 'https://dezon.vn/', placeholder: 'https://dezon.vn/du-an/…', ok: 'Lưu link' })
    if (v0 == null) return
    const L = dezonLinkIn_(v0 && v0.v != null ? v0.v : v0)
    if (L.la && !await confirm('Link này không thuộc dezon.vn:\n' + L.v + '\n\nVẫn lưu?')) return
    try {
      await mutate.updateProject(p.maDA, { linkDezon: L.v })
      toast(L.v ? 'Đã gắn link Dezon cho dự án' : 'Đã bỏ link Dezon')
    } catch (e) { toast('Lỗi lưu link: ' + ((e && e.message) || e)) }
  }

  const link = cur ? String(cur.linkDezon || '').trim() : ''
  const chip = !cur ? null : link
    ? <a className="qspl-dz on" href={dezonUrl_(link)} target="_blank" rel="noopener" title={'Mở bài dự án trên dezon.vn — ' + dezonUrl_(link)}><QsIcon name="link" size={12} /><span>Dezon</span></a>
    : <button type="button" className="qspl-dz" title="Chưa gắn link bài dự án trên dezon.vn — bấm để dán link" onClick={setLink}><QsIcon name="link" size={12} /><span>Gắn link</span></button>

  const head = (
    <div className="qspl-pp-head">
      <span className="qspl-pp-ic"><QsIcon name="layers" size={16} /></span>
      <h3>Sản phẩm trong dự án</h3>
      <span className="qspl-pp-count" title={node ? (n + ' / ' + allN + ' sản phẩm của dự án thuộc ' + node + '.' + (nodeName(node) || '')) : (allN + ' sản phẩm trong dự án')}>{n}</span>
      {chip}
      <button type="button" className="qspl-pp-hide" title="Thu gọn panel (mở rộng bảng)" onClick={onHide}><QsIcon name="left" size={14} /></button>
    </div>
  )
  if (part === 'head') return head
  return (
    <div
      className={`qspl-pp${part === 'body' ? ' body' : ''}${dragOn ? ' drop-ready' : ''}${over ? ' drop-over' : ''}`}
      onDragOver={e => { if (!dragOn) return; e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy' } catch (x) { /* bỏ qua */ } setOver(true) }}
      onDragLeave={e => { if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget)) setOver(false) }}
      onDrop={e => { e.preventDefault(); setOver(false); onDrop() }}
    >
      {part !== 'body' && head}
      <select className="qspl-pp-sel" value={cur ? cur.maDA : ''} onChange={e => switchProject(e.target.value)}>
        <option value="">— Chọn hoặc tạo dự án —</option>
        {(projects || []).map(p => <option key={p.maDA} value={p.maDA}>{p.ten}</option>)}
        <option value="__new__">＋ Tạo dự án mới…</option>
      </select>
      {!cur
        ? <div className="qspl-pp-empty">Chưa chọn dự án.<br />Chọn dự án ở trên để bắt đầu ghi danh sản phẩm.</div>
        : (
          <>
            <div className="qspl-pp-sub2">
              <span>Danh sách sản phẩm tham gia</span>
              <span className="qspl-pp-lay" role="group" aria-label="Chế độ xem danh sách">
                {PP_LAYOUTS.map(x => (
                  <button type="button" key={x[0]} className={lay === x[0] ? 'on' : ''} title={'Xem dạng ' + x[1]} aria-label={'Xem dạng ' + x[1]} onClick={() => setLay(x[0])}>{x[2]}</button>
                ))}
              </span>
            </div>
            <div className={`qspl-pp-list ${lay}`}>
              {shown.length ? shown.map((l, i) => {
                // mỗi dòng cùng giao diện thẻ sản phẩm của cột Hạng mục bên Bóc tách (.qs-bd-product, QS.css): số thứ tự · ảnh · tên + giá ·
                // số lượng + bỏ khỏi dự án, hàng chip thương hiệu bên dưới; kích thước / tầng ở chú thích
                const sub = [l.kichThuoc, l.tang].map(x => String(x || '').trim()).filter(Boolean).join(' · ')
                const tip = sub ? (l.ten || '') + '\n' + sub : (l.ten || '')
                const qty = Number(l.soLuong) || 0
                const del = <button type="button" className="qspl-pp-del" title="Bỏ khỏi dự án" onClick={() => spRemoveFromProject(l)}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
                if (lay === 'list') return (
                  <div className="qspl-pp-row" key={l.lineId} title={tip}>
                    <ProductThumb product={l} size={32} src={img1(l.hinhAnh)} className="qspl-pp-img" />
                    <span className="qspl-pp-rn">{l.ten || ''}</span>
                    <b className="qspl-pp-rp">{money(l.donGiaBan)} đ</b>
                    <span className="qspl-pp-qty">×{qty}</span>
                    {del}
                  </div>
                )
                if (lay === 'grid') return (
                  <div className="qspl-pp-tile" key={l.lineId} title={tip}>
                    <div className="qspl-pp-timg"><ProductThumb product={l} size={88} src={img1(l.hinhAnh)} /><span className="qspl-pp-tq">×{qty}</span>{del}</div>
                    <div className="qspl-pp-tn">{l.ten || ''}</div>
                    <b className="qspl-pp-tp">{money(l.donGiaBan)} đ</b>
                  </div>
                )
                return (
                  <div className="qs-bd-product qspl-pp-prod" key={l.lineId} title={tip}>
                    <span className="qs-bd-product-no">{i + 1}</span>
                    <div className="qs-bd-product-thumb"><ProductThumb product={l} size={76} src={img1(l.hinhAnh)} /></div>
                    <div className="qs-bd-product-main">
                      <div className="qs-bd-product-name">{l.ten || ''}</div>
                      <div className="qs-bd-product-price">{money(l.donGiaBan)} đ</div>
                    </div>
                    <div className="qs-bd-product-actions">
                      <span className="qspl-pp-qty" title="Số lượng trong dự án">×{qty}</span>
                      {del}
                    </div>
                    {l.thuongHieu ? <div className="qs-bd-product-tags"><div className="qs-bd-chips"><span className="qs-bd-chip brand">{l.thuongHieu}</span></div></div> : null}
                  </div>
                )
              }) : (
                <div className="qspl-pp-empty">{node && allN ? <>Dự án chưa có sản phẩm thuộc <b>{node + '.' + (nodeName(node) || '')}</b>.<br /></> : <>Chưa có sản phẩm.<br /></>}<b>Kéo sản phẩm</b> từ bảng bên phải thả vào đây,<br />hoặc bấm ＋ trên từng dòng.</div>
              )}
            </div>
          </>
        )}
    </div>
  )
}
