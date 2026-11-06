import { Fragment } from 'react'
import { GROUP_ORDER, QUOTE_TEMPLATES, TEMPLATE_ACCENT, STATUS_LABEL, buildQuoteData, fmt, quoteNumber, todayStr } from '../../../data/marketingData'

const FONT = "var(--app-font, 'Montserrat'), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const NB = ' · '
const megaphone = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg>

/* Bản HTML thay màu nhấn bằng cách thay chuỗi mã màu mặc định của mẫu trong HTML đã dựng.
   Ở đây mỗi mẫu nhận `A` = màu nhấn đang dùng và đặt đúng vào các vị trí mang mã màu mặc định đó. */

function Signatures({ camp, mt }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: mt }}>
      <div style={{ textAlign: 'center', width: '45%' }}><div style={{ fontSize: 12, fontWeight: 700 }}>Người lập báo giá</div><div style={{ height: 56 }} /><div style={{ fontSize: 11, color: '#8A8F9C' }}>{camp.owner}</div></div>
      <div style={{ textAlign: 'center', width: '45%' }}><div style={{ fontSize: 12, fontWeight: 700 }}>Khách hàng xác nhận</div><div style={{ height: 56 }} /><div style={{ fontSize: 11, color: '#8A8F9C' }}>(Ký, ghi rõ họ tên)</div></div>
    </div>
  )
}

/* ---------- Mẫu Hiện đại ---------- */
function TplModern({ camp, qd, A }) {
  const groups = GROUP_ORDER.filter(g => qd.groupTotals[g])
  const lbl = { fontSize: 10.5, color: '#8A8F9C', textTransform: 'uppercase', letterSpacing: '.04em' }
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', paddingBottom: 20, marginBottom: 20, borderBottom: `3px solid ${A}` }}>
        <div>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: A, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>{megaphone}</div>
          <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 17 }}>CÔNG TY TNHH KIẾN TRÚC XÂY DỰNG DECOX</div>
          <div style={{ fontSize: 11.5, color: '#6B7280', marginTop: 3, lineHeight: 1.6 }}>123 Đường Nguyễn Văn Linh, Q.7, TP.HCM<br />Hotline: 0909 123 456 · marketing@decox.vn</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 22, color: A, letterSpacing: '.02em' }}>BÁO GIÁ</div>
          <div className="mk-qp-mono" style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>{quoteNumber(camp)}</div>
          <div className="mk-qp-mono" style={{ fontSize: 12, color: '#6B7280' }}>Ngày: {todayStr()}</div>
        </div>
      </div>
      <div style={{ background: '#E7EEFA', borderRadius: 10, padding: '16px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', marginBottom: 22 }}>
        <div><div style={lbl}>Chiến dịch</div><div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{camp.name}</div></div>
        <div><div style={lbl}>Dự án / khách hàng</div><div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{camp.client}</div></div>
        <div><div style={lbl}>Thời gian triển khai</div><div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{camp.start || '—'} → {camp.end || '—'} ({qd.months} tháng)</div></div>
        <div><div style={lbl}>Người phụ trách</div><div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{camp.owner}</div></div>
      </div>
      <table className="mk-qp-table">
        <thead><tr><th>Hạng mục</th><th style={{ textAlign: 'right' }}>Đơn giá</th><th style={{ textAlign: 'center' }}>SL</th><th style={{ textAlign: 'right' }}>Thành tiền</th></tr></thead>
        <tbody>
          {groups.length ? groups.map(g => {
            const lines = qd.lines.filter(l => l.group === g)
            return (
              <Fragment key={g}>
                <tr><td colSpan={4} style={{ paddingTop: 16, paddingBottom: 4, borderBottom: 'none' }}><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: A }}>{g}. {lines[0].groupLabel}</span></td></tr>
                {lines.map(l => (
                  <tr key={l.id}>
                    <td>{l.name}<div style={{ fontSize: 10.5, color: '#8A8F9C', marginTop: 2 }}>{l.qty} {l.unit}{l.scales ? ' × ' + qd.months + ' tháng' : ''}</div></td>
                    <td className="mk-qp-mono" style={{ textAlign: 'right' }}>{fmt(l.price)}</td>
                    <td className="mk-qp-mono" style={{ textAlign: 'center', color: '#8A8F9C' }}>{l.scales ? qd.months : 1}</td>
                    <td className="mk-qp-mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(l.total)}</td>
                  </tr>
                ))}
              </Fragment>
            )
          }) : <tr><td colSpan={4} style={{ color: '#8A8F9C' }}>Chưa chọn hạng mục chi phí.</td></tr>}
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}><span style={{ color: '#6B7280' }}>Tạm tính</span><span className="mk-qp-mono">{fmt(qd.subtotal)}</span></div>
          {qd.vat ? <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}><span style={{ color: '#6B7280' }}>VAT (8%)</span><span className="mk-qp-mono">{fmt(qd.vat)}</span></div> : null}
          <div style={{ background: A, color: '#fff', borderRadius: 10, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Tổng cộng</span>
            <span className="mk-qp-mono" style={{ fontSize: 17, fontWeight: 800 }}>{fmt(qd.grand)}</span>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 28, paddingTop: 18, borderTop: '1px solid #E8E9EE', fontSize: 11, color: '#8A8F9C', lineHeight: 1.7 }}>Báo giá có hiệu lực 15 ngày kể từ ngày phát hành. Chưa bao gồm chi phí phát sinh ngoài phạm vi hạng mục nêu trên.</div>
      <Signatures camp={camp} mt={30} />
    </>
  )
}

/* ---------- Mẫu Cổ điển ---------- */
function TplClassic({ camp, qd, A }) {
  const bd = `1px solid ${A}`
  return (
    <>
      <div style={{ textAlign: 'center', paddingBottom: 14, borderBottom: `3px double ${A}`, marginBottom: 18 }}>
        <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 15, letterSpacing: '.03em' }}>CÔNG TY TNHH KIẾN TRÚC XÂY DỰNG DECOX</div>
        <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>123 Đường Nguyễn Văn Linh, Quận 7, TP. Hồ Chí Minh — ĐT: 0909 123 456</div>
      </div>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 20, letterSpacing: '.08em' }}>BÁO GIÁ</div>
        <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>CHI PHÍ TRIỂN KHAI CHIẾN DỊCH MARKETING</div>
        <div className="mk-qp-mono" style={{ fontSize: 11.5, marginTop: 6 }}>Số: {quoteNumber(camp)} {NB} Ngày {todayStr()}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 16, gap: 20 }}>
        <div><div>Kính gửi: <strong>{camp.client}</strong></div><div>Về việc: <strong>{camp.name}</strong></div></div>
        <div style={{ textAlign: 'right' }}><div>Người phụ trách: <strong>{camp.owner}</strong></div><div>Thời gian: <strong>{camp.start || '—'} → {camp.end || '—'}</strong></div></div>
      </div>
      <table className="mk-qp-table" style={{ border: bd, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'center', border: bd, color: A }}>STT</th>
            <th style={{ border: bd, color: A }}>Hạng mục</th>
            <th style={{ textAlign: 'center', border: bd, color: A }}>ĐVT</th>
            <th style={{ textAlign: 'center', border: bd, color: A }}>SL</th>
            <th style={{ textAlign: 'right', border: bd, color: A }}>Đơn giá</th>
            <th style={{ textAlign: 'right', border: bd, color: A }}>Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          {qd.lines.length ? qd.lines.map((l, i) => (
            <tr key={l.id}>
              <td className="mk-qp-mono" style={{ textAlign: 'center', border: bd }}>{i + 1}</td>
              <td style={{ border: bd }}>{l.name}</td>
              <td style={{ textAlign: 'center', border: bd }}>{l.unit}</td>
              <td className="mk-qp-mono" style={{ textAlign: 'center', border: bd }}>{l.qty}{l.scales ? ' × ' + qd.months : ''}</td>
              <td className="mk-qp-mono" style={{ textAlign: 'right', border: bd }}>{fmt(l.price)}</td>
              <td className="mk-qp-mono" style={{ textAlign: 'right', border: bd, fontWeight: 700 }}>{fmt(l.total)}</td>
            </tr>
          )) : <tr><td colSpan={6} style={{ textAlign: 'center', border: bd, color: '#8A8F9C' }}>Chưa chọn hạng mục chi phí</td></tr>}
          <tr><td colSpan={5} style={{ textAlign: 'right', border: bd, fontWeight: 700 }}>Tạm tính</td><td className="mk-qp-mono" style={{ textAlign: 'right', border: bd, fontWeight: 700 }}>{fmt(qd.subtotal)}</td></tr>
          {qd.vat ? <tr><td colSpan={5} style={{ textAlign: 'right', border: bd }}>Thuế GTGT (8%)</td><td className="mk-qp-mono" style={{ textAlign: 'right', border: bd }}>{fmt(qd.vat)}</td></tr> : null}
          <tr><td colSpan={5} style={{ textAlign: 'right', border: bd, fontWeight: 800, fontSize: 13.5 }}>TỔNG CỘNG</td><td className="mk-qp-mono" style={{ textAlign: 'right', border: bd, fontWeight: 800, fontSize: 13.5 }}>{fmt(qd.grand)}</td></tr>
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: '#6B7280', marginTop: 14, fontStyle: 'italic' }}>* Báo giá chưa bao gồm các chi phí phát sinh ngoài phạm vi hạng mục nêu trên và có hiệu lực trong 15 ngày kể từ ngày ký.</div>
      <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 38, textAlign: 'center' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 12.5 }}>NGƯỜI LẬP BÁO GIÁ</div>
          <div style={{ fontSize: 10.5, color: '#6B7280', marginTop: 2 }}>(Ký, ghi rõ họ tên)</div>
          <div style={{ height: 60 }} />
          <div style={{ fontWeight: 600, fontSize: 12 }}>{camp.owner}</div>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 12.5 }}>KHÁCH HÀNG XÁC NHẬN</div>
          <div style={{ fontSize: 10.5, color: '#6B7280', marginTop: 2 }}>(Ký, ghi rõ họ tên)</div>
          <div style={{ height: 60 }} />
          <div style={{ fontWeight: 600, fontSize: 12 }}>{' '}</div>
        </div>
      </div>
    </>
  )
}

/* ---------- Mẫu Tối giản ---------- */
function TplMinimal({ camp, qd, A }) {
  const groups = GROUP_ORDER.filter(g => qd.groupTotals[g])
  return (
    <>
      <div style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: '#B8BEC9', fontWeight: 700 }}>Báo giá · {quoteNumber(camp)}</div>
      <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 26, marginTop: 8, lineHeight: 1.25 }}>{camp.name}</div>
      <div style={{ fontSize: 12, color: '#8A8F9C', marginTop: 8 }}>{camp.client} {NB} {todayStr()} {NB} {qd.months} tháng triển khai</div>
      {groups.length ? groups.map(g => {
        const lines = qd.lines.filter(l => l.group === g)
        return (
          <div style={{ marginTop: 22 }} key={g}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#B8BEC9', marginBottom: 8 }}>{lines[0].groupLabel}</div>
            {lines.map(l => (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '9px 0', borderBottom: '1px solid #F0F1F4' }} key={l.id}>
                <div>
                  <div style={{ fontSize: 13.5 }}>{l.name}</div>
                  <div style={{ fontSize: 10.5, color: '#B8BEC9', marginTop: 2 }}>{l.qty} {l.unit}{l.scales ? ' × ' + qd.months + ' tháng' : ''} · {fmt(l.price)}</div>
                </div>
                <div className="mk-qp-mono" style={{ fontSize: 13 }}>{fmt(l.total)}</div>
              </div>
            ))}
          </div>
        )
      }) : <div style={{ marginTop: 22, fontSize: 13, color: '#8A8F9C' }}>Chưa chọn hạng mục chi phí.</div>}
      <div style={{ marginTop: 30, paddingTop: 18, borderTop: '1px solid #1C1F26', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 12.5, color: '#8A8F9C' }}>Tạm tính{qd.vat ? ' + VAT 8%' : ''}</span>
        <span className="mk-qp-mono" style={{ fontSize: 26, fontWeight: 800, color: A }}>{fmt(qd.grand)}</span>
      </div>
      <div style={{ marginTop: 24, fontSize: 11, color: '#B8BEC9' }}>Người lập: {camp.owner} · SiteFlow Marketing · Hiệu lực 15 ngày</div>
    </>
  )
}

/* ---------- Mẫu Chi tiết ---------- */
function TplDetailed({ camp, qd, A }) {
  const groups = GROUP_ORDER.filter(g => qd.groupTotals[g])
  const secHead = { fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#8A8F9C' }
  const k = { color: '#8A8F9C' }
  return (
    <>
      <div style={{ border: '1.5px solid #1C1F26', borderRadius: 8, padding: '16px 20px', marginBottom: 20, display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 14.5 }}>CÔNG TY TNHH KIẾN TRÚC XÂY DỰNG DECOX</div>
          <div style={{ fontSize: 10.5, color: '#6B7280', marginTop: 4, lineHeight: 1.7 }}>123 Nguyễn Văn Linh, Q.7, TP.HCM · MST: 0312xxxxxx<br />STK: 0071xxxxxxx — Vietcombank CN TP.HCM</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: A }}>BÁO GIÁ CHI TIẾT</div>
          <div className="mk-qp-mono" style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>{quoteNumber(camp)}<br />{todayStr()}</div>
        </div>
      </div>
      <div style={{ ...secHead, marginBottom: 8 }}>Thông tin chiến dịch</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 12.5, marginBottom: 20 }}>
        <div><span style={k}>Chiến dịch:</span> <strong>{camp.name}</strong></div>
        <div><span style={k}>Loại:</span> {camp.type}</div>
        <div><span style={k}>Dự án / khách hàng:</span> {camp.client}</div>
        <div><span style={k}>Thời gian:</span> {camp.start || '—'} → {camp.end || '—'} ({qd.months} tháng)</div>
        <div><span style={k}>Người phụ trách:</span> {camp.owner}</div>
        <div><span style={k}>Trạng thái:</span> {STATUS_LABEL[camp.status]}</div>
      </div>
      <div style={{ ...secHead, marginBottom: 10 }}>Chi tiết hạng mục chi phí</div>
      {groups.length ? groups.map(g => {
        const lines = qd.lines.filter(l => l.group === g)
        return (
          <div style={{ marginBottom: 14, border: '1px solid #E8E9EE', borderRadius: 8, overflow: 'hidden' }} key={g}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 14px', background: '#F7F3F5', fontWeight: 700, fontSize: 12 }}><span>{g}. {lines[0].groupLabel}</span><span className="mk-qp-mono">{fmt(qd.groupTotals[g])}</span></div>
            {lines.map(l => (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', fontSize: 12, borderTop: '1px solid #F0F1F4' }} key={l.id}>
                <span>{l.name} <span style={{ color: '#8A8F9C' }}>— {l.qty} {l.unit}{l.scales ? ' × ' + qd.months + ' tháng' : ''}</span></span>
                <span className="mk-qp-mono">{fmt(l.total)}</span>
              </div>
            ))}
          </div>
        )
      }) : <div style={{ fontSize: 12.5, color: '#8A8F9C' }}>Chưa chọn hạng mục chi phí.</div>}
      <div style={{ background: '#F7F3F5', borderRadius: 8, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}><span style={{ color: '#6B7280' }}>Tạm tính</span><span className="mk-qp-mono">{fmt(qd.subtotal)}</span></div>
        {qd.vat ? <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}><span style={{ color: '#6B7280' }}>VAT (8%)</span><span className="mk-qp-mono">{fmt(qd.vat)}</span></div> : null}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 800, borderTop: '1px solid #E0C4D2', paddingTop: 8, marginTop: 2 }}><span>Tổng cộng</span><span className="mk-qp-mono" style={{ color: A }}>{fmt(qd.grand)}</span></div>
      </div>
      <div style={{ ...secHead, margin: '20px 0 8px' }}>Điều khoản &amp; điều kiện</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, color: '#4B5160', lineHeight: 1.9 }}>
        <li>Báo giá có hiệu lực trong vòng 15 ngày kể từ ngày phát hành.</li>
        <li>Thanh toán: tạm ứng 50% khi ký xác nhận, 50% còn lại khi hoàn tất chiến dịch.</li>
        <li>Chi phí trên chưa bao gồm phát sinh ngoài phạm vi hạng mục đã liệt kê.</li>
        <li>Số liệu quảng cáo (KHTN/lead) là ước tính tham khảo, không cam kết tuyệt đối.</li>
      </ul>
      <Signatures camp={camp} mt={32} />
    </>
  )
}

/* ---------- Mẫu Sang trọng ---------- */
function TplElegant({ camp, qd, A }) {
  const groups = GROUP_ORDER.filter(g => qd.groupTotals[g])
  return (
    <>
      <div style={{ background: '#1C1B18', color: '#F3F0E8', margin: '-44px -50px 24px', padding: '40px 50px 28px', textAlign: 'center', borderBottom: `2px solid ${A}` }}>
        <div style={{ fontSize: 10, letterSpacing: '.28em', textTransform: 'uppercase', color: A }}>Decox Marketing</div>
        <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 24, marginTop: 10, letterSpacing: '.05em' }}>BÁO GIÁ</div>
        <div className="mk-qp-mono" style={{ fontSize: 11, color: '#8A8578', marginTop: 8 }}>{quoteNumber(camp)} {NB} {todayStr()}</div>
      </div>
      <div style={{ background: '#1C1B18', color: '#F3F0E8', margin: '0 -50px', padding: '0 50px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 8 }}>
          <div><div style={{ color: '#8A8578' }}>Kính gửi</div><strong>{camp.client}</strong></div>
          <div style={{ textAlign: 'right' }}><div style={{ color: '#8A8578' }}>Người phụ trách</div><strong>{camp.owner}</strong></div>
        </div>
        <div style={{ fontSize: 12, color: '#8A8578' }}>{camp.name} {NB} {camp.start || '—'} → {camp.end || '—'} ({qd.months} tháng)</div>
        {groups.length ? groups.map(g => {
          const lines = qd.lines.filter(l => l.group === g)
          return (
            <div style={{ marginTop: 18 }} key={g}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: A, marginBottom: 8 }}>{lines[0].groupLabel}</div>
              {lines.map(l => (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #2A2A2A' }} key={l.id}>
                  <div><div style={{ fontSize: 13, color: '#F3F0E8' }}>{l.name}</div><div style={{ fontSize: 10.5, color: '#8A8578', marginTop: 2 }}>{l.qty} {l.unit}{l.scales ? ' × ' + qd.months + ' tháng' : ''} · {fmt(l.price)}</div></div>
                  <div className="mk-qp-mono" style={{ fontSize: 13, color: '#F3F0E8' }}>{fmt(l.total)}</div>
                </div>
              ))}
            </div>
          )
        }) : <div style={{ marginTop: 20, fontSize: 12.5, color: '#8A8578' }}>Chưa chọn hạng mục chi phí.</div>}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${A}`, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 12, color: '#8A8578' }}>Tổng cộng{qd.vat ? ' (đã gồm VAT 8%)' : ''}</span>
          <span className="mk-qp-mono" style={{ fontSize: 24, fontWeight: 800, color: '#E0AC4F' }}>{fmt(qd.grand)}</span>
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#8A8F9C', marginTop: 24, fontStyle: 'italic', textAlign: 'center' }}>Báo giá có hiệu lực trong 15 ngày kể từ ngày phát hành · {camp.owner}</div>
    </>
  )
}

/* ---------- Mẫu Gọn nhẹ ---------- */
function TplCompact({ camp, qd, A }) {
  const th = { padding: '5px 8px', borderBottom: `1.5px solid ${A}`, fontSize: 10.5, textTransform: 'uppercase', color: '#8A8F9C' }
  const td = { padding: '5px 8px', borderBottom: '1px solid #EEE' }
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 10, borderBottom: `2px solid ${A}`, marginBottom: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>BÁO GIÁ — {camp.name}</div>
        <div className="mk-qp-mono" style={{ fontSize: 10.5, color: '#8A8F9C' }}>{quoteNumber(camp)} · {todayStr()}</div>
      </div>
      <div style={{ fontSize: 11.5, color: '#6B7280', marginBottom: 10 }}>{camp.client} {NB} {camp.owner} {NB} {camp.start || '—'} → {camp.end || '—'}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>
          <th style={{ textAlign: 'left', ...th }}>Hạng mục</th>
          <th style={{ textAlign: 'center', ...th }}>SL</th>
          <th style={{ textAlign: 'right', ...th }}>Thành tiền</th>
        </tr></thead>
        <tbody>
          {qd.lines.length ? qd.lines.map(l => (
            <tr key={l.id}>
              <td style={td}>{l.name}</td>
              <td className="mk-qp-mono" style={{ ...td, textAlign: 'center', color: '#8A8F9C' }}>{l.scales ? qd.months : 1} {l.unit}</td>
              <td className="mk-qp-mono" style={{ ...td, textAlign: 'right' }}>{fmt(l.total)}</td>
            </tr>
          )) : <tr><td colSpan={3} style={{ padding: '14px 8px', textAlign: 'center', color: '#8A8F9C' }}>Chưa chọn hạng mục chi phí</td></tr>}
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <div style={{ width: 220, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span style={{ color: '#6B7280' }}>Tạm tính</span><span className="mk-qp-mono">{fmt(qd.subtotal)}</span></div>
          {qd.vat ? <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span style={{ color: '#6B7280' }}>VAT 8%</span><span className="mk-qp-mono">{fmt(qd.vat)}</span></div> : null}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, fontWeight: 800, borderTop: `1px solid ${A}`, paddingTop: 4 }}><span>Tổng</span><span className="mk-qp-mono">{fmt(qd.grand)}</span></div>
        </div>
      </div>
      <div style={{ fontSize: 10, color: '#8A8F9C', marginTop: 16 }}>* Hiệu lực 15 ngày kể từ ngày phát hành. Người lập: {camp.owner}.</div>
    </>
  )
}

const RENDERERS = { modern: TplModern, classic: TplClassic, minimal: TplMinimal, detailed: TplDetailed, elegant: TplElegant, compact: TplCompact }

/* Tờ báo giá (renderQuoteDoc của bản HTML) */
export default function QuoteDoc({ catalog, camp, vatOn, template, accent, textColor, font, fontScale }) {
  const qd = buildQuoteData(catalog, camp, vatOn)
  const tpl = QUOTE_TEMPLATES.find(t => t.id === template) || QUOTE_TEMPLATES[0]
  const Tpl = RENDERERS[tpl.id]
  const A = accent || TEMPLATE_ACCENT[tpl.id]
  const override = {}
  if (textColor) override.color = textColor
  if (font) override.fontFamily = font
  return (
    <div className="mk-quote-paper" style={override}>
      {/* Cỡ chữ: phóng nội dung bên trong tờ giấy (khổ giấy giữ nguyên) nên áp dụng cho cả bản in */}
      <div style={fontScale && fontScale !== 1 ? { zoom: fontScale } : undefined}>
        <Tpl camp={camp} qd={qd} A={A} />
      </div>
    </div>
  )
}
