import { useEffect, useMemo } from 'react'
import Icon from '../../../../components/ui/Icon'
import QsIcon from '../common/QsIcon'
import { MrootPortal } from '../common/Mroot'
import { getDialogs } from '../common/dialogs'
import { money } from '../../lib/format.js'
import { bgHist_, bgMa_, bgTong_, bgVatParts_, computeQuoteLocal, BG_LYDO } from '../../lib/quote.js'
import { useQsStore } from '../../state/store'
import { fmtDateTime_, cpSigned_, freshModel } from './quoteModel'
import { bgDocCss_, docScreenCss } from './docCss'
import { bgHistDiff, printDoc } from './quoteActions'

/* Esc chỉ đóng khi không có hộp thoại nào đè lên (vd "So sánh"): nghe ở pha capture để đọc trạng thái TRƯỚC khi
   ConfirmDialog tự đóng vì cùng phím Esc */
function useEsc(onClose) {
  useEffect(() => {
    const k = e => {
      if (e.key !== 'Escape') return
      const d = getDialogs()
      if (d.confirm || (d.asks && d.asks.length)) return
      onClose()
    }
    document.addEventListener('keydown', k, true)
    return () => document.removeEventListener('keydown', k, true)
  }, [onClose])
}

/* Lịch sử báo giá (bgHistOpen_ PUB/baogia.js:1218-1236): mới nhất trước; 10 bản mới nhất còn bản chụp -> Xem / So sánh */
export function HistoryModal({ onClose, onView }) {
  const projData = useQsStore(s => s.projData)
  const cur = useQsStore(s => s.cur)
  useEsc(onClose)
  const h = bgHist_(projData).slice().reverse()
  const tongNay = useMemo(() => {
    const m = freshModel()
    return bgTong_(computeQuoteLocal(false, m.ctx).subtotal, m.ctx.bgCfg, m.ctx.cur && m.ctx.cur.vat, bgVatParts_(m.ctx)).total
  }, [projData, cur])
  return (
    <MrootPortal>
      <div className="qsc-ov" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="qsc-dlg qsq-hist" role="dialog">
          <div className="qsq-dh"><h3><QsIcon name="doc" size={16} /> Lịch sử báo giá — {bgMa_(cur)}</h3>
            <button type="button" className="qsc-x" onClick={onClose}>✕</button></div>
          <div className="qsq-hist-b">
            {h.length ? (
              <table className="qsq-ht">
                <thead><tr><th>Phiên bản</th><th>Thời điểm</th><th>Người lập</th><th>Lý do</th><th className="num">Số dòng</th><th className="num">Tổng</th><th className="num">So với hiện tại</th><th /></tr></thead>
                <tbody>
                  {h.map((v0, i) => {
                    const d = cpSigned_(tongNay - v0.tong)
                    const v = { ...v0, ver: Number(v0.ver) || 0, n: Number(v0.n) || 0 }     // dữ liệu lưu: ép số trước khi hiện
                    return (
                      <tr key={v.ver + '-' + i}>
                        <td><b>v{v.ver}</b></td><td>{fmtDateTime_(v.at)}</td><td>{v.by || ''}</td><td>{BG_LYDO[v.lyDo] || v.lyDo || ''}</td>
                        <td className="num">{v.n || 0}</td><td className="num"><b>{money(v.tong)}</b></td>
                        <td className="num">{d.v ? <span className={d.cls}>{money(d.v)}</span> : <span className="muted">bằng nhau</span>}</td>
                        <td>{v.snap
                          ? <span className="qsq-acts"><button type="button" className="qs-qt-btn" onClick={() => onView(v0)}>Xem</button>
                            <button type="button" className="qs-qt-btn" onClick={() => bgHistDiff(v0.ver)}>So sánh</button></span>
                          : <span className="muted" title="Chỉ 10 phiên bản gần nhất giữ nội dung đầy đủ">chỉ còn tóm tắt</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : <div className="qsq-empty">Chưa có phiên bản nào. Bấm <b>Chốt phiên bản</b>, hoặc xuất PDF / Excel — mỗi lần xuất nội dung mới được lưu tự động.</div>}
          </div>
        </div>
      </div>
    </MrootPortal>
  )
}

/* Xem lại 1 phiên bản đã chốt (bgHistView_ 1250-1264): trang + màu + cột của chính bản chụp; in lại đúng bản đó */
export function VersionView({ v, onClose }) {
  useEsc(onClose)
  const kq = useMemo(() => {
    const m = freshModel({ v })
    return { pages: m.ptErr ? [] : m.pages(), mau: m.mau, err: m.ptErr }
  }, [v])
  return (
    <MrootPortal>
      <div className="qsc-ov" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="qsc-dlg qsq-ver" role="dialog">
          <div className="qsq-dh"><h3><Icon name="eye" size={16} /> {v.ma} · v{v.ver} — {fmtDateTime_(v.at)}</h3>
            {!kq.err && <button type="button" className="qs-qt-btn red" onClick={() => printDoc(kq.pages, bgDocCss_(kq.mau))}><Icon name="download" size={14} />In / PDF bản này</button>}
            <button type="button" className="qsc-x" onClick={onClose}>✕</button></div>
          <div className="qsq-ver-b qsq-vv">
            <style>{docScreenCss(kq.mau, '.qsq-vv')}</style>
            {kq.err
              ? <div className="qsq-empty" role="alert">Bảng Phần thô trong bản đã chốt bị hỏng: {kq.err}</div>
              : <div className="qsd-doc" dangerouslySetInnerHTML={{ __html: kq.pages.map(p => p.html).join('') }} />}
          </div>
        </div>
      </div>
    </MrootPortal>
  )
}
