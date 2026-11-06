import Icon from '../../../../components/ui/Icon'
import ChangeInput from './ChangeInput'
import { money } from '../../lib/format.js'
import { coverDepth, coverSortFn, coverHasChild, bgHidden, bgAn_, coverTag_ } from '../../lib/quote.js'
import { bgToggle, coverEdit, coverDel, coverAddBig, coverAddSmall, coverReload, coverSave, coverAutoFill, coverInfo, coverTaySet } from './quoteActions'

/* Chế độ "Chỉnh sửa" - thẻ "Chọn mục hiện trên tờ bìa" + thẻ tờ bìa sửa trực tiếp (drawBaogia PUB/baogia.js:828-850,
   coverTableM2 718-736, coverTableM1 738-761). Giữ khung thẻ / bảng .qs-qt-* của bản clone.
   Props: ctx (lib/quote.js: cur, lines, cover, bgCfg, phanTho ...), comp = coverCosts(ctx), (chỉ còn 1 bố cục tờ bìa = Mẫu 2 cũ) */
const INFO = [['khachHang', 'Khách hàng'], ['quyMo', 'Quy mô'], ['tongDT', 'Tổng diện tích XD (m²)'], ['nhuCau', 'Nhu cầu'],
  ['dtBaoGia', 'DT báo giá [đã nhân hệ số] (m²)'], ['phanKhuc', 'Phân khúc'], ['hienTrang', 'Hiện trạng']]   // hienTrang: M8.3
const pct = (v, t) => (t > 0 ? (v / t * 100) : 0).toFixed(2) + '%'

/* Nhãn cạnh ô chi phí (coverTag_ 1064-1069) */
function Tag({ c, ctx }) {
  const a = coverTag_(c, ctx)
  if (!a.loai) return null
  return a.loai === 'tay'
    ? <button type="button" className="qsq-tag tay" title={'Đang dùng số sửa tay — bấm để lấy lại ' + money(a.tien) + ' từ bóc tách'} onClick={() => coverTaySet(c.stt, false)}>sửa tay ↺</button>
    : <span className="qsq-tag auto" title={'Tự cộng từ ' + a.n + ' dòng bóc tách'}>tự động</span>
}
function Price({ c, i, val, leaf, ctx }) {
  if (!leaf) return <td className="r">{money(val)}</td>
  return <td className="r"><ChangeInput className="r" value={money(val)} onCommit={v => coverEdit(i, 'chiPhi', v)} /><Tag c={c} ctx={ctx} /></td>
}

function TableM2({ ctx, comp }) {
  const cover = ctx.cover || []
  const rows = cover.filter(c => !bgHidden(c.stt, ctx.bgCfg)).slice().sort(coverSortFn)
  const out = []
  rows.forEach((c, ri) => {
    const i = cover.indexOf(c); const lvl = coverDepth(c.stt); const val = comp.cost[c.stt] || 0; const leaf = !coverHasChild(cover, c.stt)
    if (lvl === 1 && ri > 0) out.push(<tr key={'sp' + ri} className="sp"><td colSpan={5} /></tr>)     // dòng trắng trước mỗi nhóm lớn
    out.push(
      <tr key={'r' + i} className={lvl === 1 ? 'lv1' : (lvl === 2 ? 'lv2' : 'lv3')}>
        <td className="c"><ChangeInput style={{ width: 52 }} value={c.stt} onCommit={v => coverEdit(i, 'stt', v)} /></td>
        <td style={{ paddingLeft: (lvl - 1) * 16 + 9 }}>
          <ChangeInput style={{ fontWeight: lvl <= 1 ? 700 : 600 }} value={c.hangMuc || ''} onCommit={v => coverEdit(i, 'hangMuc', v)} />
          <div><ChangeInput className="desc2" placeholder="mô tả…" value={c.moTa || ''} onCommit={v => coverEdit(i, 'moTa', v)} /></div>
        </td>
        <Price c={c} i={i} val={val} leaf={leaf} ctx={ctx} />
        <td className="r">{pct(val, comp.total)}</td>
        <td className="c"><button type="button" className="qsq-cvdel" title="Xoá dòng" onClick={() => coverDel(i)}>✕</button></td>
      </tr>)
  })
  return (
    <table className="qs-qt-ed-table qsq-cvt">
      <thead><tr><th className="c">NO</th><th>HẠNG MỤC</th><th className="r">CHI PHÍ DỰ KIẾN</th><th className="r">TỶ TRỌNG</th><th /></tr></thead>
      <tbody>{out.length ? out : <tr><td colSpan={5} className="c empty">Chưa có dòng. Bấm ↻ Nạp lại mẫu.</td></tr>}</tbody>
      <tfoot><tr><td colSpan={2} className="r">TỔNG CHI PHÍ DỰ KIẾN (VNĐ)</td><td className="r">{money(comp.total)}</td><td colSpan={2} /></tr></tfoot>
    </table>
  )
}

export default function CoverEditor({ ctx, comp }) {
  const p = ctx.cur || {}
  const cover = ctx.cover || []
  const an = bgAn_(ctx.bgCfg)
  const secs = cover.filter(c => coverDepth(c.stt) === 1).sort(coverSortFn)
  return (
    <>
      <div className="qs-card qs-qt-card">
        <div className="qs-qt-card-head"><span className="qs-qt-card-icon"><Icon name="listLines" size={15} /></span><b>Chọn mục hiện trên tờ bìa</b></div>
        <div className="qs-qt-card-body">
          <p className="qs-qt-note">Bỏ chọn mục nào thì mục đó ẩn khỏi tờ bìa.</p>
          <div className="qsq-bgchips">
            {secs.length ? secs.map(s => <button type="button" key={s.stt} className={an[s.stt] ? 'off' : ''} onClick={() => bgToggle(s.stt)}>{s.hangMuc || s.stt}</button>)
              : <span className="qs-qt-note">Chưa có mục. Bấm ↻ Nạp lại mẫu.</span>}
          </div>
        </div>
      </div>

      <div className="qs-card qs-qt-card">
        <div className="qs-qt-card-head">
          <span className="qs-qt-card-icon"><Icon name="fileText" size={15} /></span>
          <b>Tờ bìa — Ước tính chi phí dự án</b><span className="qs-qt-sub">bấm thẳng vào ô để sửa</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="qs-qt-btn" onClick={e => { const b = e.currentTarget; b.disabled = true; coverReload().finally(() => { b.disabled = false }) }}>↻ Nạp mẫu</button>
          <button type="button" className="qs-qt-btn" title="Mục có dòng bóc tách tự cộng tiền; bấm để bỏ các số đã sửa tay" onClick={coverAutoFill}>
            <Icon name="download" size={13} />Lấy lại số từ bóc tách</button>
          <button type="button" className="qs-qt-btn green" onClick={e => { const b = e.currentTarget; b.disabled = true; coverSave().finally(() => { b.disabled = false }) }}>
            <Icon name="check" size={13} stroke={2.4} />Lưu tờ bìa</button>
        </div>
        <div className="qs-qt-card-body">
          <div className="qs-qt-ed">
            <div className="qs-qt-ed-title">
              <b>BẢNG ƯỚC TÍNH CHI PHÍ DỰ ÁN</b>
              <span>[Tư vấn thiết kế, thi công chuyên nghiệp]</span>
              <label>Mã báo giá số : <ChangeInput value={p.maBaoGia || ''} onCommit={v => coverInfo('maBaoGia', v)} /></label>
            </div>
            <div className="qs-qt-ed-info">
              {INFO.map(([k, label]) => (
                <div key={k} className="qs-qt-ed-field"><span>{label}</span>
                  {k === 'hienTrang'   // textarea: <input> bỏ ký tự xuống dòng của giá trị nhập ở hộp Thông tin dự án
                    ? <ChangeInput as="textarea" className="qsq-ht" rows={Math.min(6, Math.max(1, String(p[k] || '').split('\n').length))}
                        value={p[k] || ''} onCommit={v => coverInfo(k, v)} />
                    : <ChangeInput value={p[k] || ''} onCommit={v => coverInfo(k, v)} />}</div>
              ))}
            </div>
            <div style={{ overflowX: 'auto' }}><TableM2 ctx={ctx} comp={comp} /></div>
          </div>
          <div className="qs-qt-ed-actions">
            <button type="button" className="qs-qt-btn" onClick={coverAddBig}><Icon name="plus" size={12} />Thêm mục lớn</button>
            <button type="button" className="qs-qt-btn" onClick={coverAddSmall}><Icon name="plus" size={12} />Thêm mục nhỏ</button>
            <span className="qs-qt-note">Sửa số ở ô No (vd gõ 1.4) — dòng tự về đúng thứ tự.</span>
          </div>
        </div>
      </div>
    </>
  )
}
