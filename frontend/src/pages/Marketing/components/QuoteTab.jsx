import { useEffect, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { QUOTE_TEMPLATES, TEMPLATE_ACCENT, STATUS_LABEL, STATUS_COLOR, STATUS_TINT, monthsBetween } from '../../../data/marketingData'
import QuoteDoc from './QuoteDoc'
import { Ic } from './CampaignsTab'

const ACCENT_KEY = 'siteflow-quote-accent'
const TEXT_KEY = 'siteflow-quote-textcolor'
const FONT_KEY = 'siteflow-quote-font'
const SCALE_KEY = 'siteflow-quote-fontscale'
const ZOOM_KEY = 'siteflow-quote-zoom'
/* Cỡ chữ của báo giá (hệ số so với mặc định) — áp dụng cho cả bản in */
const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20]
const FONT_SIZE_BASE = 12 // cỡ hiển thị ứng với bản báo giá gốc (hệ số 1)
const comboSelect = { border: 'none', padding: '7px 8px', fontSize: 12.5, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', outline: 'none' }
/* Mức phóng bản xem trước trên màn hình (%) — không ảnh hưởng bản in.
   Mặc định 'fit': tờ báo giá tự rộng vừa khung xem trước (tối đa ZOOM_FIT_MAX). */
const ZOOM_MIN = 60, ZOOM_MAX = 160, ZOOM_STEP = 10, ZOOM_FIT_MAX = 150
const PAPER_W = 760 // max-width của .mk-quote-paper
const zoomBtn = { width: 26, height: 26, border: 'none', background: 'none', color: 'var(--text)', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1 }

function loadStyle(key) {
  try { return localStorage.getItem(key) || '' } catch { return '' }
}
function saveStyle(key, value) {
  try { localStorage.setItem(key, value) } catch { /* bỏ qua */ }
}

const colorInput = { width: 38, height: 26, border: '1px solid var(--border)', borderRadius: 6, padding: 2, cursor: 'pointer', background: 'none', flex: 'none' }
const fieldLabel = { fontSize: 12, fontWeight: 600 }
const hint = { fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }

/* Một bước trong cột điều khiển: số thứ tự + tiêu đề + mô tả ngắn, để người dùng biết làm gì trước / sau */
function Step({ num, title, desc, children }) {
  return (
    <div className="mk-grp-card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12, flex: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--marketing-tint)', color: 'var(--marketing)', fontSize: 11.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{num}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
          {desc ? <div style={{ ...hint, marginTop: 2 }}>{desc}</div> : null}
        </div>
      </div>
      {children}
    </div>
  )
}

/* Dòng "nhãn — giá trị" thẳng cột trong khối thông tin chiến dịch */
function InfoRow({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 12.5, lineHeight: 1.45 }}>
      <span style={{ width: 78, flex: 'none', color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{children}</span>
    </div>
  )
}

/* Ô chọn màu kèm mã màu đang dùng */
function ColorField({ id, label, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <label htmlFor={id} style={{ ...fieldLabel, flex: 1 }}>{label}</label>
      <span className="mk-qp-mono" style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{value}</span>
      <input type="color" id={id} style={colorInput} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  )
}

const chip = { padding: '3px 10px', borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }

/* Phần thân tab báo giá. Bản HTML dựng lại toàn bộ khối này mỗi lần renderQuoteTab()
   nên VAT / khổ giấy / hướng giấy quay về mặc định — component được gắn `key` để mô phỏng. */
function QuoteBody({ catalog, camp, template, setTemplate, accent, setAccent, textColor, setTextColor, font, setFont, fontScale, setFontScale, onResetStyle, onExport }) {
  const [vatOn, setVatOn] = useState(false)
  const [paperSize, setPaperSize] = useState('A4')
  const [paperOrient, setPaperOrient] = useState('portrait')
  /* zoomMode: 'fit' (vừa khung) hoặc số % do người dùng tự chỉnh */
  const [zoomMode, setZoomMode] = useState(() => {
    const saved = parseInt(loadStyle(ZOOM_KEY), 10)
    return saved >= ZOOM_MIN && saved <= ZOOM_MAX ? saved : 'fit'
  })
  const previewRef = useRef(null)
  const [previewW, setPreviewW] = useState(0)
  useEffect(() => {
    const el = previewRef.current
    if (!el) return undefined
    const ro = new ResizeObserver(([entry]) => setPreviewW(Math.round(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const fitZoom = previewW ? Math.max(ZOOM_MIN, Math.min(ZOOM_FIT_MAX, Math.floor(previewW / PAPER_W * 100))) : 100
  const zoom = zoomMode === 'fit' ? fitZoom : zoomMode
  function setZoom(v) {
    const next = v === 'fit' ? 'fit' : Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(v / ZOOM_STEP) * ZOOM_STEP))
    setZoomMode(next)
    saveStyle(ZOOM_KEY, String(next))
  }
  const months = monthsBetween(camp.start, camp.end)
  const templateLabel = (QUOTE_TEMPLATES.find(t => t.id === template) || { label: '' }).label
  const orientLabel = paperOrient === 'portrait' ? 'Dọc' : 'Ngang'
  /* Hệ số đang lưu → cỡ gần nhất trong danh sách */
  const fontSize = FONT_SIZES.reduce((best, n) => (Math.abs(n - fontScale * FONT_SIZE_BASE) < Math.abs(best - fontScale * FONT_SIZE_BASE) ? n : best), FONT_SIZE_BASE)

  return (
    <div style={{ display: 'flex', gap: 20, minHeight: 0, alignItems: 'flex-start' }}>
      {/* Cột điều khiển: các bước đánh số từ trên xuống, cuộn cùng trang */}
      <div style={{ width: 300, flex: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Step num="1" title="Chiến dịch đang lập báo giá">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <InfoRow label="Tên">{camp.name}</InfoRow>
            <InfoRow label="Loại">{camp.type}</InfoRow>
            <InfoRow label="Dự án / KH">{camp.client}</InfoRow>
            <InfoRow label="Phụ trách">{camp.owner}</InfoRow>
            <InfoRow label="Thời gian">{camp.start || '—'} → {camp.end || '—'} ({months} tháng)</InfoRow>
            <InfoRow label="Trạng thái"><span style={{ padding: '2px 8px', borderRadius: 999, background: STATUS_TINT[camp.status], color: STATUS_COLOR[camp.status], fontSize: 10.5, fontWeight: 700 }}>{STATUS_LABEL[camp.status]}</span></InfoRow>
          </div>
          {camp.notes ? <div style={{ ...hint, paddingTop: 10, borderTop: '1px solid var(--border)' }}>{camp.notes}</div> : null}
        </Step>

        <Step num="2" title="Thuế VAT">
          <button
            type="button" role="switch" aria-checked={vatOn}
            onClick={() => setVatOn(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${vatOn ? 'var(--marketing)' : 'var(--border)'}`, background: vatOn ? 'var(--marketing-tint)' : 'var(--surface)', color: 'var(--text)', padding: '9px 12px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
          >
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{vatOn ? 'Đã cộng VAT 8% vào tổng' : 'Cộng VAT 8% vào tổng'}</span>
            <span style={{ width: 34, height: 20, borderRadius: 999, background: vatOn ? 'var(--marketing)' : 'var(--border)', position: 'relative', flex: 'none', transition: 'background .15s ease' }}>
              <span style={{ position: 'absolute', top: 2, left: vatOn ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s ease' }} />
            </span>
          </button>
        </Step>

        <Step num="3" title="Mẫu báo giá">
          <div className="mk-tpl-picker" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {QUOTE_TEMPLATES.map(t => (
              <button key={t.id} className={`mk-tpl-btn${t.id === template ? ' active' : ''}`} style={{ minWidth: 0, width: '100%' }} onClick={() => setTemplate(t.id)}>
                <span className="mk-tpl-swatch" style={{ background: t.swatch, width: 22, border: '1px solid var(--border)' }} />
                {t.label}
              </button>
            ))}
          </div>
        </Step>

        <Step num="4" title="Tuỳ chỉnh màu &amp; font" desc="Không bắt buộc.">
          <ColorField id="mkQpAccentInput" label="Màu tiêu đề" value={accent || TEMPLATE_ACCENT[template] || '#1F5FBF'} onChange={setAccent} />
          <ColorField id="mkQpTextColorInput" label="Màu chữ" value={textColor || '#1C1F26'} onChange={setTextColor} />
          {/* Font + cỡ chữ ghép liền một hàng như ô chọn font của Word */}
          <div>
            <label htmlFor="mkQpFontSelect" style={{ ...fieldLabel, display: 'block', marginBottom: 6 }}>Font &amp; cỡ chữ</label>
            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)' }}>
              <select id="mkQpFontSelect" title="Font chữ" value={font || ''} onChange={e => setFont(e.target.value)} style={{ ...comboSelect, flex: 1, minWidth: 0 }}>
                <option value="">Montserrat (mặc định)</option>
                <option value="'Roboto', sans-serif">Roboto</option>
                <option value="'Inter', sans-serif">Inter</option>
                <option value="Georgia, 'Times New Roman', serif">Georgia / Times</option>
                <option value="Arial, sans-serif">Arial</option>
              </select>
              <select id="mkQpFontSizeSelect" title="Cỡ chữ" value={fontSize} onChange={e => setFontScale(parseInt(e.target.value, 10) / FONT_SIZE_BASE)} style={{ ...comboSelect, width: 62, flex: 'none', borderLeft: '1px solid var(--border)' }}>
                {FONT_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <button type="button" onClick={onResetStyle} style={{ width: '100%', border: '1px dashed var(--border)', background: 'none', color: 'var(--text-muted)', fontSize: 11.5, fontWeight: 600, padding: 7, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>Khôi phục màu, font &amp; cỡ chữ mặc định</button>
        </Step>

        <Step num="5" title="Xuất báo giá" desc="Mở hộp thoại in của trình duyệt — chọn “Lưu dưới dạng PDF” để lấy file.">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ ...fieldLabel, marginBottom: 6 }}>Khổ giấy</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {['A4', 'A3', 'A2'].map(s => (
                  <button type="button" key={s} className={`mk-qexport-pill${paperSize === s ? ' active' : ''}`} style={{ flex: 1, padding: '6px 0' }} onClick={() => setPaperSize(s)}>{s}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ ...fieldLabel, marginBottom: 6 }}>Hướng giấy</div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button type="button" className={`mk-qexport-pill${paperOrient === 'portrait' ? ' active' : ''}`} style={{ flex: 1, padding: '6px 0' }} onClick={() => setPaperOrient('portrait')}>Dọc</button>
                <button type="button" className={`mk-qexport-pill${paperOrient === 'landscape' ? ' active' : ''}`} style={{ flex: 1, padding: '6px 0' }} onClick={() => setPaperOrient('landscape')}>Ngang</button>
              </div>
            </div>
          </div>
          <button type="button" className="mk-qexport-btn" onClick={() => onExport({ vatOn, paperSize, paperOrient })}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
            Xuất báo giá ({paperSize} · {orientLabel})
          </button>
        </Step>
      </div>

      {/* vùng xem trước = 1 module (kiểu QS): thanh tiêu đề tóm tắt lựa chọn + thu phóng, thân là tờ báo giá */}
      <div className="mk-mod" style={{ flex: 1, minWidth: 0 }}>
        {/* Thanh tóm tắt: cho biết bản xem trước đang phản ánh những lựa chọn nào */}
        <div className="mk-mod-h">
          <span className="mk-mod-ic"><Ic n="draft" /></span>
          <b>Xem trước báo giá</b>
          <span style={chip}>Mẫu {templateLabel}</span>
          <span style={chip}>{vatOn ? 'Có VAT 8%' : 'Chưa có VAT'}</span>
          <span style={chip}>{paperSize} · {orientLabel}</span>
          <span style={{ flex: 1 }} />
          {/* Phóng to / thu nhỏ bản xem trước */}
          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', overflow: 'hidden' }}>
            <button type="button" title="Thu nhỏ" style={{ ...zoomBtn, opacity: zoom <= ZOOM_MIN ? 0.35 : 1 }} disabled={zoom <= ZOOM_MIN} onClick={() => setZoom(zoom - ZOOM_STEP)}>−</button>
            <button type="button" title="Bấm để tờ báo giá tự vừa khung xem trước" style={{ ...zoomBtn, width: 'auto', padding: '0 8px', fontSize: 11.5, color: zoomMode === 'fit' ? 'var(--marketing)' : 'var(--text)' }} onClick={() => setZoom('fit')}>{zoomMode === 'fit' ? `Vừa khung · ${zoom}%` : `${zoom}%`}</button>
            <button type="button" title="Phóng to" style={{ ...zoomBtn, opacity: zoom >= ZOOM_MAX ? 0.35 : 1 }} disabled={zoom >= ZOOM_MAX} onClick={() => setZoom(zoom + ZOOM_STEP)}>+</button>
          </div>
        </div>
        {/* Khung đo bề rộng để tính mức "vừa khung"; tờ giấy có max-width nên không bao giờ tràn ngang */}
        <div ref={previewRef} className="mk-mod-b mk-qprev">
          <div style={{ zoom: zoom / 100 }}>
            <QuoteDoc catalog={catalog} camp={camp} vatOn={vatOn} template={template} accent={accent} textColor={textColor} font={font} fontScale={fontScale} />
          </div>
        </div>
      </div>
    </div>
  )
}

/* Tab "Báo giá" (renderQuoteTab của bản HTML) */
export default function QuoteTab({ visible, catalog, campaigns, quoteCampaignId, renderKey, onSelectCampaign }) {
  /* Mẫu + tuỳ chỉnh giao diện giữ nguyên qua các lần dựng lại (biến toàn cục ở bản HTML) */
  const [template, setTemplate] = useState('modern')
  const [accent, setAccentState] = useState(() => loadStyle(ACCENT_KEY))
  const [textColor, setTextColorState] = useState(() => loadStyle(TEXT_KEY))
  const [font, setFontState] = useState(() => loadStyle(FONT_KEY))
  const [fontScale, setFontScaleState] = useState(() => parseFloat(loadStyle(SCALE_KEY)) || 1)
  /* Nội dung vùng in (#quotePrintRoot) — chỉ được điền khi bấm "Xuất báo giá" */
  const [printSnap, setPrintSnap] = useState(null)

  const camp = campaigns.find(c => c.id === quoteCampaignId) || campaigns[0]

  function setAccent(v) { setAccentState(v); saveStyle(ACCENT_KEY, v) }
  function setTextColor(v) { setTextColorState(v); saveStyle(TEXT_KEY, v) }
  function setFont(v) { setFontState(v); saveStyle(FONT_KEY, v) }
  function setFontScale(v) { setFontScaleState(v); saveStyle(SCALE_KEY, String(v)) }
  function resetStyle() {
    setAccentState(''); setTextColorState(''); setFontState(''); setFontScaleState(1)
    try {
      localStorage.removeItem(ACCENT_KEY)
      localStorage.removeItem(TEXT_KEY)
      localStorage.removeItem(FONT_KEY)
      localStorage.removeItem(SCALE_KEY)
    } catch { /* bỏ qua */ }
  }
  function exportQuote({ vatOn, paperSize, paperOrient }) {
    /* Dựng xong vùng in rồi mới gọi hộp thoại in của trình duyệt */
    flushSync(() => setPrintSnap({ catalog, camp, vatOn, template, accent, textColor, font, fontScale, paperSize, paperOrient }))
    window.print()
  }

  return (
    <div style={{ display: visible ? 'flex' : 'none', flexDirection: 'column', gap: 16 }}>
      {/* chọn chiến dịch = module thanh trên (kiểu QS) */}
      <div className="mk-mod" style={{ display: campaigns.length ? 'block' : 'none' }}>
      <div className="mk-mod-h">
        <span className="mk-mod-ic"><Ic n="mega" /></span>
        <label htmlFor="mkQuoteCampaignSelect" style={{ fontSize: 14, fontWeight: 700 }}>Lập báo giá cho chiến dịch</label>
        <select id="mkQuoteCampaignSelect" value={camp ? camp.id : ''} onChange={e => onSelectCampaign(e.target.value)} style={{ padding: '8px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5, fontFamily: 'inherit', minWidth: 260 }}>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {camp && <span className="mk-cnt" style={{ background: STATUS_TINT[camp.status], color: STATUS_COLOR[camp.status] }}>{STATUS_LABEL[camp.status]}</span>}
        {camp && <span className="mk-mod-sum">{camp.client || 'Chưa có khách hàng'} · {camp.start || '—'} → {camp.end || '—'} ({monthsBetween(camp.start, camp.end)} tháng)</span>}
      </div>
      </div>
      <div style={{ display: campaigns.length ? 'none' : 'block', background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 14, padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Chưa có chiến dịch nào để lập báo giá — bấm "Tạo chiến dịch" ở góc trên bên phải.
      </div>
      {camp
        ? <QuoteBody
            key={renderKey}
            catalog={catalog} camp={camp}
            template={template} setTemplate={setTemplate}
            accent={accent} setAccent={setAccent}
            textColor={textColor} setTextColor={setTextColor}
            font={font} setFont={setFont}
            fontScale={fontScale} setFontScale={setFontScale}
            onResetStyle={resetStyle} onExport={exportQuote}
          />
        : <div style={{ display: 'flex', gap: 16, minHeight: 0 }} />}

      {/* Vùng in: nằm ngoài khung ứng dụng (con trực tiếp của <body>) như #quotePrintRoot của bản HTML */}
      {createPortal(
        <div className="mk-print-root">
          {printSnap && (
            <>
              <style>{`@page{ size: ${printSnap.paperSize} ${printSnap.paperOrient}; margin: 12mm; }`}</style>
              <QuoteDoc catalog={printSnap.catalog} camp={printSnap.camp} vatOn={printSnap.vatOn} template={printSnap.template} accent={printSnap.accent} textColor={printSnap.textColor} font={printSnap.font} fontScale={printSnap.fontScale} />
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
