import { useEffect, useRef, useState } from 'react'
import QsIcon from '../common/QsIcon'
import { useQs } from '../../state/QsData'
import { pad2 } from '../../lib/format'
import { mediaUrl } from '../../api/files'
import ProductEditModal from '../products/edit/ProductEditModal'
import { useImp } from './importStore'
import { pendingDel_, pendingEdit_, pendingCommit_, impFindSessionProduct_, impSyncSession_ } from './importLogic'

/* Panel phải "Sản phẩm vừa nhập (phiên này)" (port impRecentList / impDateTime_ / impEditSession_, PUB/nhap.js:471-522, 664-692):
   thẻ Chờ lưu (Sửa / Xoá), bảng SP đã lưu trong phiên, nút "Thêm sản phẩm" ghi danh sách chờ vào Database.
   Props: specs, onEditOpen() (cuộn form lên đầu khi mở 1 dòng chờ để sửa). */
function impDateTime_(iso) {
  try {
    const d = new Date(iso); if (isNaN(d)) return null
    const p = n => (n < 10 ? '0' : '') + n
    const h = d.getHours(), ap = h < 12 ? 'AM' : 'PM', h12 = h % 12 || 12
    return <>{p(h12) + ':' + p(d.getMinutes()) + ' ' + ap}<br />{p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear()}</>
  } catch (e) { return null }
}
const img1 = v => mediaUrl(String(v || '').split('\n')[0].trim())
const hideImg = e => { e.currentTarget.style.visibility = 'hidden' }

export default function RecentPanel({ specs, onEditOpen, open, onOpen }) {
  const { navigate, products } = useQs()
  const pd = useImp(s => s.pending)
  const ps = useImp(s => s.sessionAdded)
  const pendEdit = useImp(s => s.pendEdit)
  const committing = useImp(s => s.committing)
  const commitText = useImp(s => s.commitText)
  const [editP, setEditP] = useState(null)
  const syncKey = useRef('')

  // modal Sửa lưu xong -> danh mục tải lại -> đồng bộ dòng trong panel cho khớp dữ liệu mới
  useEffect(() => { if (syncKey.current) impSyncSession_(syncKey.current) }, [products])

  const editSession = async s => {
    const p = await impFindSessionProduct_(s)
    if (p) setEditP(p)
  }
  const cards = pd.map(p => {
    const dangSua = pendEdit === p.uid
    const phu = [p.ma, p.thuongHieu].filter(Boolean).join(' · ')
    return (
      <div key={p.uid} className={'qsi-pc' + (p.loi ? ' qsi-err' : '') + (dangSua ? ' qsi-editing' : '')}>
        {p.hinhAnh ? <img className="qsi-pc-th" src={img1(p.hinhAnh)} alt="" onError={hideImg} /> : <span className="qsi-pc-th qsi-pc-noimg"><QsIcon name="image" size={14} /></span>}
        <div className="qsi-pc-mid">
          <div className="qsi-pc-name" title={p.ten || ''}>{p.ten || ''}</div>
          {p.bienThe ? <div className="qsi-pc-bt" title="Biến thể">{p.bienThe}</div> : null}
          {phu ? <div className="qsi-pc-sub" title={phu}>{phu}</div> : null}
          {p.loi ? <div className="qsi-pc-loi">{p.loi}</div> : null}
          <span className="qsi-pc-tag">{dangSua ? 'Đang sửa' : (p.loi ? 'Lỗi — sửa lại' : 'Chờ lưu')}</span>
          {p.combo && p.combo.length ? <span className="qsi-pc-tag">+ combo {p.combo.length}</span> : null}
          {p.ghi ? <span className="qsi-pc-tag" title="Ghi danh vào dự án sau khi lưu">→ dự án ×{p.ghi.qty || 1}</span> : null}
        </div>
        <div className="qsi-pc-act">
          <button className="qsi-pc-btn" title="Sửa — mở lại trong form" onClick={async () => { if (await pendingEdit_(p, specs) && onEditOpen) onEditOpen() }}><QsIcon name="edit" size={14} /></button>
          <button className="qsi-pc-btn qsi-del" title="Xoá khỏi danh sách chờ" onClick={() => pendingDel_(p)}><QsIcon name="trash" size={14} /></button>
        </div>
      </div>
    )
  })
  /* Thu gọn: chỉ còn nút biểu tượng (kèm số) + nút Thêm sản phẩm; bấm nút -> danh sách mở rộng sang bên phải (nổi trên form) */
  const n = pd.length + ps.length
  return (
    <div className={'qsi-recent' + (open ? ' open' : '')}>
      <button type="button" className="qsi-recent-tg" aria-expanded={open} title={open ? 'Thu gọn danh sách' : 'Mở danh sách Sản phẩm vừa nhập (phiên này)'} onClick={() => onOpen(!open)}>
        <span className="ic"><QsIcon name="list" size={17} /></span>
        <span className="tx">Sản phẩm vừa nhập <i>(phiên này)</i></span>
        <span className="qsi-rcount">{pad2(n)}</span>
        <span className="chev" aria-hidden="true">›</span>
      </button>
      {open && (
      <div className="qsi-recent-fly">
      <div className="qsi-recent-h">Sản phẩm vừa nhập (phiên này) <span className="qsi-rcount">{pad2(n)}</span>
        <button type="button" className="qsi-recent-x" title="Đóng" onClick={() => onOpen(false)}>✕</button></div>
      <div className="qsi-recent-note">Danh sách này chỉ ghi lại thao tác của <b>phiên đang mở</b> — tải lại trang sẽ trống. Sản phẩm đã lưu <b>vẫn nằm trong Database</b>: <a onClick={() => navigate('sanpham')}>xem Danh sách sản phẩm →</a></div>
      <div className="qsi-recent-b">
        {pd.length ? <><div className="qsi-pc-hd">Chờ lưu <span>{pd.length}</span><i>Chưa vào Database</i></div><div className="qsi-pc-list">{cards}</div></> : null}
        {pd.length && ps.length ? <div className="qsi-pc-hd qsi-done">Đã lưu vào Database <span>{ps.length}</span></div> : null}
        {(ps.length || !pd.length) ? (
          <table className="qsi-rtbl">
            <thead><tr><th className="qsi-c">Sửa</th><th className="qsi-c">STT</th><th>Tên sản phẩm</th><th className="qsi-c">Hình ảnh</th><th>Thương hiệu</th><th>Ngày cập nhật</th></tr></thead>
            <tbody>{ps.length ? ps.map((p, i) => (
              <tr key={i}>
                <td className="qsi-c qsi-ract">{p.ma
                  ? <button className="qsi-redit" title={p.nhieuBienThe ? 'Sửa biến thể đầu tiên của mã ' + p.ma : 'Sửa lại sản phẩm này'} onClick={() => editSession(p)}><QsIcon name="edit" size={13} /></button>
                  : <span className="qsi-redit qsi-dis" title="Không rõ mã sản phẩm — mở Danh sách sản phẩm để sửa"><QsIcon name="edit" size={13} /></span>}</td>
                <td className="qsi-c">{i + 1}</td>
                <td className="qsi-rname">{p.ten || ''}{p.ma ? <i className="qsi-rma">{p.ma}</i> : null}</td>
                <td className="qsi-c">{String(p.hinhAnh || '').split('\n')[0] ? <img className="qsi-rth" src={img1(p.hinhAnh)} alt="" onError={hideImg} /> : <span className="qsi-rth" />}</td>
                <td>{p.thuongHieu || '—'}</td>
                <td className="qsi-rdate">{impDateTime_(p.capNhat) || '—'}</td>
              </tr>
            )) : (
              <tr><td colSpan={6} className="qsi-empty">Chưa nhập sản phẩm nào trong phiên này.<br />Sản phẩm bạn <b>thêm / nhập file</b> sẽ hiện ở đây — bấm <b>Thêm sản phẩm</b> để lưu vào Database.</td></tr>
            )}</tbody>
          </table>
        ) : null}
      </div>
      </div>
      )}
      <div className="qsi-rfoot">
        {pd.length ? <div className="qsi-rfoot-note"><b>{pd.length}</b> sản phẩm đang chờ — <b>chưa</b> lưu vào Database</div> : null}
        <button className="qsi-btn qsi-blue qsi-block" disabled={!pd.length || committing} onClick={() => pendingCommit_()}>
          {committing ? (commitText || '⏳ Đang lưu vào Database…') : <><QsIcon name="plus" size={15} /> Thêm sản phẩm{pd.length ? ' (' + pd.length + ')' : ''}</>}</button>
      </div>
      {editP && (
        <ProductEditModal productKey={String(editP.recordId)} mode="edit" onClose={() => setEditP(null)}
          onSaved={() => { syncKey.current = String(editP.recordId); impSyncSession_(syncKey.current) }} />
      )}
    </div>
  )
}
