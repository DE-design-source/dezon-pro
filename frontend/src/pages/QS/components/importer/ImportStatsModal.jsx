import { useMemo, useState } from 'react'
import QsIcon from '../common/QsIcon'
import { MrootPortal } from '../common/Mroot'
import { IMP_LOAI } from '../../lib/productFields'
import '../products/edit/productEdit.css'

/* Bảng thống kê nhập liệu: tổng SP đã nhập theo NGÀY x NHÂN SỰ (người tạo), tách theo ngành, kèm số đã duyệt.
   Lấy từ danh mục đã tải (nguoi_tao / ngay_tao / nganh của từng SP trong Database) - không cần bảng riêng.
   Props: products, onClose(). */
const NG = IMP_LOAI.filter(x => x[0] !== 'pt').map(x => [x[0] === 'sp' ? 'den' : x[0], x[1].split(' · ')[0]])
const ngay_ = iso => String(iso || '').slice(0, 10)
const vn_ = d => (d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '')
const truoc_ = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

export default function ImportStatsModal({ products, onClose }) {
  const [tu, setTu] = useState(truoc_(30))
  const [den, setDen] = useState(truoc_(0))
  const [who, setWho] = useState('*')
  const ds = useMemo(() => (products || []).filter(p => p.ngayTao && !p.spChung), [products])
  const ai = useMemo(() => [...new Set(ds.map(p => p.nguoiTao || '(không rõ)'))].sort(), [ds])
  const { rows, tong } = useMemo(() => {
    const m = {}, T = {}
    ds.forEach(p => {
      const d = ngay_(p.ngayTao), u = p.nguoiTao || '(không rõ)'
      if ((tu && d < tu) || (den && d > den) || (who !== '*' && u !== who)) return
      const k = d + '|' + u
      const r = m[k] || (m[k] = { d, u, n: 0, duyet: 0, ng: {} })
      const t = T[u] || (T[u] = { u, n: 0, duyet: 0, ng: {} })
      const ng = NG.some(x => x[0] === p.nganh) ? p.nganh : 'den'
      ;[r, t].forEach(x => { x.n++; if (p.daDuyet) x.duyet++; x.ng[ng] = (x.ng[ng] || 0) + 1 })
    })
    return { rows: Object.values(m).sort((a, b) => b.d.localeCompare(a.d) || a.u.localeCompare(b.u)), tong: Object.values(T).sort((a, b) => b.n - a.n) }
  }, [ds, tu, den, who])
  const cot = NG.filter(x => tong.some(t => t.ng[x[0]]))   // chỉ hiện ngành có số liệu
  const tongN = tong.reduce((s, t) => s + t.n, 0)
  const line = (r, key, nhan) => (
    <tr key={key}>
      {nhan}
      <td className="num"><b>{r.n}</b></td>
      {cot.map(x => <td key={x[0]} className="num">{r.ng[x[0]] || ''}</td>)}
      <td className="num">{r.duyet}<i> / {r.n}</i></td>
    </tr>
  )
  return (
    <MrootPortal>
      <div className="qsc-ov qspe-ov" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="qspe-dlg qsi-stats" role="dialog" aria-modal="true">
          <div className="qspe-head"><h3><QsIcon name="list" size={16} /> Thống kê nhập liệu</h3>
            <button type="button" className="qspe-x" onClick={onClose}>✕</button></div>
          <div className="qsi-stats-f">
            <label>Từ ngày <input type="date" value={tu} onChange={e => setTu(e.target.value)} /></label>
            <label>Đến ngày <input type="date" value={den} onChange={e => setDen(e.target.value)} /></label>
            <label>Nhân sự <select value={who} onChange={e => setWho(e.target.value)}>
              <option value="*">Tất cả</option>{ai.map(u => <option key={u} value={u}>{u}</option>)}</select></label>
            <span className="qsi-stats-sum"><b>{tongN}</b> sản phẩm · <b>{tong.length}</b> nhân sự</span>
          </div>
          <div className="qsi-stats-b">
            {rows.length ? (
              <table className="qsi-stats-t">
                <thead><tr><th>Ngày nhập</th><th>Nhân sự</th><th className="num">Tổng SP</th>{cot.map(x => <th key={x[0]} className="num">{x[1]}</th>)}<th className="num">Đã duyệt</th></tr></thead>
                <tbody>
                  {rows.map(r => line(r, r.d + r.u, <><td>{vn_(r.d)}</td><td>{r.u}</td></>))}
                </tbody>
                <tfoot>
                  {tong.map(t => line(t, 'T' + t.u, <><td>Cộng</td><td><b>{t.u}</b></td></>))}
                </tfoot>
              </table>
            ) : <div className="qsi-empty">Không có sản phẩm nào được nhập trong khoảng ngày đã chọn.</div>}
          </div>
          <p className="qspe-ask-note">Đếm sản phẩm <b>tạo mới</b> theo Người tạo / Ngày tạo trong Database (sản phẩm ghi đè khi nhập trùng mã không đếm lại). Kho chung Dezon không tính.</p>
        </div>
      </div>
    </MrootPortal>
  )
}
