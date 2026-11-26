import QsIcon from '../../common/QsIcon'
import { qsToast } from '../../common/dialogs'
import { money, ptN, ptQty, ptMoneyN_ } from '../../../lib/format.js'
import { PT_LOAI, ptNccList_ } from '../../../lib/phantho.js'
import { nodeName } from '../../../lib/tree.js'
import { CT_DEMUC_CHON, ctDeMucNhan_ } from '../../products/pt/ptCore'
import { ctGiaSync_ } from './ctImpStore'

/* Form nhập công tác Phần thô của trang Nhập dữ liệu (ctFormHtml2_ pre 'imp' + ctGrpRenderCards_ / ctGrpAddCard_ / ctCardAdd_ /
   ctCardSave_ / ctRowDel_ / ctGrpDel_ / ctModePick_ / ctModeSync_ / ctGiaSync_ / ctPrev_ / ctDeMucSync_ / ctListOpen_, PUB/phantho.js:883-1067).
   Bố cục: Thông tin cơ bản → Thông tin giá bán → các khối "Đề mục lớn" (lưới thẻ "Đề mục nhỏ") → Thông tin khác.
   Props: form {d, grps}, set(fn(form) -> patch), hmList (gợi ý hạng mục, ctHangMucList_), congTac (gợi ý nhà thầu, ptNccList_ - M5.2)
   Ô "Thứ tự" (M5.3): thư viện sắp công tác theo số này trong cùng loại báo giá; để trống = 0 (mặc định của máy chủ). */
const MODES = [['item', 'Khối lượng × đơn giá'], ['area', 'Diện tích × hệ số'], ['area0', 'Chỉ tính khối lượng'], ['none', 'Chỉ liệt kê']]
const DVT_LIST = ['m', 'm2', 'm3', 'md', 'tim', 'cái', 'bộ', 'gói', 'tấn', 'ngày', 'tháng', 'tầng', 'hệ', 'điểm', 'công', 'ca']
const PLUS = <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 6v12M6 12h12" /></svg>
const DL = { hm: 'qsip-dl-hm', ncc: 'qsip-dl-ncc', dvt: 'qsip-dl-dvt' }
const empRow = () => ({ k: '', v: '' })

/* nút ＋ trong ô có danh sách gợi ý: mở danh sách chọn */
function listOpen(e) {
  const inp = e.currentTarget.parentNode.querySelector('input'); if (!inp) return
  inp.focus(); try { if (inp.showPicker) inp.showPicker() } catch (x) { /* trình duyệt không hỗ trợ */ }
}
const Lbl = ({ t, req }) => <label>{t}{req ? <> <span className="qsip-req">*</span></> : null}</label>
const Note = ({ children }) => <p className="qsi-dbnote qsip-note">{children}</p>

/* Dòng xem trước: đúng như dòng sẽ nằm trong bảng khái toán (ctPrev_) */
function Prev({ d }) {
  const m = d.mode || 'item', dvt = String(d.dvt || '').trim() || '—'
  const dg = ptMoneyN_(d.dg), nt = ptMoneyN_(d.dgnt)
  const kl = m === 'item' ? (ptN(String(d.kl).trim()) || 0) : (ptN(String(d.dt).trim()) * (ptN(String(d.hs).trim()) || 0))
  if (m === 'none') return <div className="qsip-prev"><span className="pv-l">Dòng trong bảng</span><b>Chỉ liệt kê, không tính tiền</b></div>
  const tt = Math.round(kl * dg), ln = Math.round(kl * (dg - nt)), pct = dg ? ((dg - nt) / dg * 100) : 0
  return (
    <div className="qsip-prev"><span className="pv-l">Dòng trong bảng</span>
      <b>{ptQty(kl || 0)} {dvt} × {money(dg)} đ = {money(tt)} đ</b>
      {nt ? <i className={ln < 0 ? 'neg' : ''}>Lợi nhuận {money(ln)} đ · {pct.toFixed(1)}%</i> : <i>Chưa nhập giá vốn</i>}
    </div>
  )
}

export default function CtForm({ form, set, hmList, congTac }) {
  const d = form.d, grps = form.grps
  const m = d.mode || 'item'
  const upd = patch => set(F => ({ d: { ...F.d, ...patch } }))
  const gia = (k, v) => set(F => ({ d: ctGiaSync_({ ...F.d, [k]: v }, k) }))
  const mode = v => set(F => ({ d: ctGiaSync_({ ...F.d, mode: v }, '') }))
  const setG = fn => set(F => ({ grps: fn(F.grps.map(g => ({ ...g, rows: g.rows.map(r => ({ ...r })) }))) }))
  const inp = (k, t, ph, req, list) => (
    <div className="qsip-f">
      <Lbl t={t} req={req} />
      <div className="qsip-i">
        <input value={d[k]} placeholder={ph || ''} list={list || undefined} onChange={e => upd({ [k]: e.target.value })} />
        {list ? <button type="button" className="qsip-ib" tabIndex={-1} title="Chọn từ danh sách" onClick={listOpen}>{PLUS}</button> : null}
      </div>
    </div>
  )
  const show = { kl: m === 'item', dt: m === 'area' || m === 'area0', hs: m === 'area' || m === 'area0', dgnt: m === 'item', ck: m === 'item', dg: m === 'item' || m === 'area' }
  const tu = ctDeMucNhan_(d.hangMuc)

  return (
    <div className="qsip-form">
      <section className="qsip-s">
        <h3 className="qsip-h"><span className="qsip-hic"><QsIcon name="tag" size={18} /></span>Thông tin cơ bản</h3>
        <div className="qsip-g">
          {inp('ten', 'Tên hạng mục', 'VD: Giàn tải, máy ép cọc Pmax 90T', 1)}
          {inp('ncc', 'Nhà cung cấp (Nếu có)', 'VD: H77', 0, DL.ncc)}
          {inp('hangMuc', 'Hạng mục', 'VD: Công tác ép cọc', 1, DL.hm)}
          <div className="qsip-f">
            <Lbl t="Phân loại (đề mục bóc tách)" />
            <div className="qsip-i">
              <select value={d.deMuc} onChange={e => upd({ deMuc: e.target.value })}>
                <option value="">{'— Tự nhận theo tên hạng mục' + (tu ? (': ' + tu) : ': chưa nhận ra') + ' —'}</option>
                <option value="0">Chỉ nằm ở 3.1 Phần thô</option>
                {CT_DEMUC_CHON.map(cd => <option key={cd} value={cd}>{cd + ' · ' + nodeName(cd)}</option>)}
              </select>
            </div>
            <p className="qsi-dbnote qsip-fnote">Công tác luôn có ở <b>3.1 Phần thô</b>. Chọn thêm đề mục (VD 3.2.2 Sơn nước) để khi bóc tách đề mục đó cũng chọn được công tác này.</p>
          </div>
        </div>
      </section>

      <section className="qsip-s">
        <h3 className="qsip-h"><span className="qsip-hic"><QsIcon name="money" size={18} /></span>Thông tin giá bán</h3>
        <Note>Giá đại lý tự tính = Giá bán lẻ × (1 − %Chiết khấu). Nhập giá đại lý thì %Chiết khấu tự tính ngược lại.</Note>
        <div className="qsip-g">
          {show.dg && <div className="qsip-f"><Lbl t="Giá bán lẻ" req /><div className="qsip-i"><input className="qsip-money" inputMode="numeric" value={d.dg} placeholder="VD: 450.000" onChange={e => gia('dg', e.target.value)} /><span className="qsip-u">VND</span></div></div>}
          {show.ck && <div className="qsip-f"><Lbl t="%Chiết khấu" req /><div className="qsip-i"><input className="qsip-money" inputMode="decimal" value={d.ck} placeholder="VD: 10" onChange={e => gia('ck', e.target.value)} /><span className="qsip-u">%</span></div></div>}
          {show.dgnt && <div className="qsip-f"><Lbl t="Giá đại lý" req /><div className="qsip-i"><input className="qsip-money" inputMode="numeric" value={d.dgnt} placeholder="Tự tính" onChange={e => gia('dgnt', e.target.value)} /><span className="qsip-u">VND</span></div></div>}
          {inp('dvt', 'Đơn vị tính', 'VD: gói · m · m2 · tim', 1, DL.dvt)}
          <div className="qsip-f qsip-span2"><label>&nbsp;</label><Prev d={d} /></div>
        </div>
      </section>

      {grps.map((g, gi) => (
        <section className="qsip-s" key={gi}>
          <div className="qsip-h qsip-gh">
            <span className="qsip-hic"><QsIcon name="doc" size={18} /></span>
            <input className="qsip-gt" value={g.t || ''} placeholder="Đề mục lớn — VD: Thông số kỹ thuật tham khảo"
              onChange={e => { const v = e.target.value; setG(G => { G[gi].t = v; return G }) }} />
            <button type="button" className="qsip-plus" title="Thêm đề mục lớn" onClick={() => setG(G => { G.splice(gi + 1, 0, { t: '', rows: [empRow(), empRow(), empRow()] }); return G })}>{PLUS}</button>
            {grps.length > 1 && <button type="button" className="qsip-del" title="Xoá đề mục lớn này" onClick={() => setG(G => { G.splice(gi, 1); return G })}>Xoá</button>}
          </div>
          {gi === 0 && <Note>Thông số kỹ thuật của công tác — đặt tên đề mục lớn, mỗi ô đề mục nhỏ 1 thông tin (VD Lực ép tối đa: 90 tấn). Bấm + để thêm.</Note>}
          <div className="qsip-g">
            {g.rows.map((r, ri) => {
              const txt = (r.k && String(r.k).trim()) ? (String(r.k).trim() + ': ' + (r.v || '')) : (r.v || '')
              return (
                <div key={ri} className={'qsip-card' + (r._ok ? ' ok' : '')}>
                  <div className="qsip-ch"><b>Đề mục nhỏ</b>
                    <button type="button" className="qsip-plus sm" title="Thêm đề mục nhỏ" onClick={() => setG(G => { G[gi].rows.splice(ri + 1, 0, empRow()); return G })}>{PLUS}</button>
                    <button type="button" className="qsip-x" title="Xoá đề mục nhỏ" onClick={() => setG(G => { G[gi].rows.splice(ri, 1); if (!G[gi].rows.length) G[gi].rows.push(empRow()); return G })}>✕</button>
                  </div>
                  <div className="qsip-cb">
                    {/* thẻ đề mục nhỏ: cả nội dung trong 1 ô (ctGrpRead_ gán k = '', v = nội dung) */}
                    <textarea value={txt} placeholder="Nhập thông tin đề mục nhỏ — VD: Lực ép tối đa: 90 tấn"
                      onChange={e => { const v = e.target.value; setG(G => { G[gi].rows[ri] = { k: '', v }; return G }) }} />
                    <button type="button" className="qsip-save" onClick={() => {
                      if (!String(txt || '').trim()) { qsToast('Nhập thông tin đề mục nhỏ trước'); return }
                      setG(G => { G[gi].rows[ri] = { k: '', v: txt, _ok: true }; return G })
                      qsToast('Đã lưu đề mục nhỏ — bấm "Đưa vào danh sách chờ" để ghi cả công tác')
                    }}>{r._ok ? 'Đã lưu ✓' : 'Lưu'}</button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}

      <section className="qsip-s">
        <h3 className="qsip-h"><span className="qsip-hic"><QsIcon name="sliders" size={18} /></span>Thông tin khác</h3>
        <Note>Loại báo giá, cách tính khối lượng và tài liệu kỹ thuật đi kèm công tác.</Note>
        <div className="qsip-g">
          <div className="qsip-f"><Lbl t="Loại báo giá" req /><div className="qsip-i">
            <select value={d.loai} onChange={e => upd({ loai: e.target.value })}>
              {d.loai === '' ? <option value="" disabled>— Chọn loại báo giá —</option> : null}
              {PT_LOAI.map(x => <option key={x[0]} value={x[0]}>{x[1]}</option>)}
            </select></div></div>
          <div className="qsip-f"><Lbl t="Cách tính" req={d.mode === ''} /><div className="qsip-i">
            <select value={d.mode === '' ? '' : m} onChange={e => mode(e.target.value)}>
              {d.mode === '' ? <option value="" disabled>— Chọn cách tính —</option> : null}
              {MODES.map(x => <option key={x[0]} value={x[0]}>{x[1]}</option>)}
            </select></div></div>
          {inp('maNhom', 'Số hạng mục', 'VD: II')}
          {inp('maSP', 'Mã sản phẩm', 'VD: KSHT')}
          <div className="qsip-f"><Lbl t="Thứ tự" /><div className="qsip-i"><input type="number" min="0" step="1" value={d.thuTu == null ? '' : d.thuTu} placeholder="VD: 1 — nhỏ đứng trước trong thư viện" onChange={e => upd({ thuTu: e.target.value })} /></div></div>
          {show.kl && <div className="qsip-f"><Lbl t="Khối lượng mẫu" /><div className="qsip-i"><input type="number" step="any" value={d.kl} placeholder="1" onChange={e => upd({ kl: e.target.value })} /></div></div>}
          {show.dt && <div className="qsip-f"><Lbl t="Diện tích mẫu (m²)" /><div className="qsip-i"><input type="number" step="any" value={d.dt} placeholder="0" onChange={e => upd({ dt: e.target.value })} /></div></div>}
          {show.hs && <div className="qsip-f"><Lbl t="Hệ số" /><div className="qsip-i"><input type="number" step="any" value={d.hs} placeholder="1" onChange={e => upd({ hs: e.target.value })} /></div></div>}
          <div className="qsip-f"><Lbl t="Ghi chú · điều kiện áp dụng" /><div className="qsip-i"><textarea rows={2} value={d.gc} placeholder="VD: Đơn giá cho trên 20m/tim cọc" onChange={e => upd({ gc: e.target.value })} /></div></div>
          <div className="qsip-f"><Lbl t="Phạm vi ứng dụng" /><div className="qsip-i"><textarea rows={2} value={d.phamVi} placeholder="Mỗi dòng 1 ý" onChange={e => upd({ phamVi: e.target.value })} /></div></div>
          {inp('linkTaiLieu', 'Link tài liệu kỹ thuật', 'https://…')}
        </div>
      </section>
      <datalist id={DL.hm}>{(hmList || []).map(v => <option key={v} value={v} />)}</datalist>
      <datalist id={DL.ncc}>{ptNccList_(congTac).map(v => <option key={v.ten} value={v.ten} />)}</datalist>
      <datalist id={DL.dvt}>{DVT_LIST.map(v => <option key={v} value={v} />)}</datalist>
    </div>
  )
}
