import { useEffect, useState } from 'react'
import { useKdMap } from '../ShortlistSelect'
import { fmtTy, sourceColor, boqOf } from '../../utils'
import { mediaUrl } from '../../../QS/api/files'
import DatePicker from '../../../../components/ui/DatePicker'
import { HANDOFF_CONFIG } from '../../../../data/kinhDoanhData'

/* Khối "Hồ sơ khách hàng": ô số liệu dự án, hạng mục, liên hệ (SĐT / email che bớt, bấm Hiện / Ẩn),
   các trường của khách Phòng KD Dự Án, Ngày tạo sửa tại chỗ, mục thu gọn "Tài liệu & ghi chú"
   (BOQ, Concept, Ghi chú nội bộ, hình / tệp đính kèm, mã dự án QS, báo giá, ngày chốt, đối tác, bàn giao). */
const fmtD = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : '' }
const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
const fmtVnd = n => Math.round(Number(n) || 0).toLocaleString('vi-VN') + ' đ'
const fmtAt = v => { const d = new Date(v); return isNaN(d) ? String(v || '') : d.toLocaleString('vi-VN') }
const parts = s => String(s || '').split(/(\s*[,;]\s*)/)
/* 098 *** ** 45: giữ 3 số đầu + 2 số cuối của từng số */
function maskPhone(s) {
  return parts(s).map((p, k) => {
    if (k % 2) return p
    const n = (p.match(/\d/g) || []).length
    let i = 0
    return p.replace(/\d/g, d => { const j = i++; return j < 3 || j >= n - 2 ? d : '*' })
  }).join('')
}
function maskEmail(s) {
  return parts(s).map((p, k) => {
    if (k % 2) return p
    const m = /^([^@\s]{0,2})[^@\s]*(@\S+)$/.exec(p.trim())
    return m ? m[1] + '•••••' + m[2] : p
  }).join('')
}
/* Nguồn "Facebook - KienPhong" -> nhãn Facebook + chi tiết KienPhong; không có dấu tách -> chỉ chi tiết */
function splitSource(s) {
  const m = /^(.+?)\s*(?:-|–|:|\/)\s*(.+)$/.exec(String(s || '').trim())
  return m ? { tag: m[1], detail: m[2] } : { tag: '', detail: String(s || '').trim() }
}
/* Mã trạng thái bàn giao (HANDOFF_CONFIG: pendingStatus / selfStatus) -> chữ; mã lạ thì ẩn dòng Bàn giao */
function handoffText(h) {
  if (!h || !h.status) return ''
  const cfg = HANDOFF_CONFIG[h.stage || h.stageKey]
  if (h.status === 'pending-qs' || h.status === 'pending-handoff') {
    return 'Đang chờ Phòng ' + (h.dept || (cfg && cfg.dept) || '') + ' xác nhận' + (h.requestedAt ? ' - hẹn ' + fmtAt(h.requestedAt) : '') + (h.assignee ? ' - ' + h.assignee : '')
  }
  if (h.status === 'self-quoted') return (cfg && cfg.selfLabel) || 'Phòng KD tự đề xuất báo giá'
  return ''
}
const FOLD_LS = 'kd-cd-docs'
const readFold = () => { try { return localStorage.getItem(FOLD_LS) === '1' } catch { return false } }
const Ic = ({ d, size = 14 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
const FILE_IC = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6'
const PEN = 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'

function Row({ k, children }) {
  return <div className="cd-row"><span>{k}</span><span className="cd-row-v">{children}</span></div>
}

export default function CdProfile({ lead: l, onEdit, onSetCreated }) {
  const [reveal, setReveal] = useState({})
  const [suaNgay, setSuaNgay] = useState(false)
  const [docsOpen, setDocsOpenRaw] = useState(readFold)
  const setDocsOpen = v => { setDocsOpenRaw(v); try { localStorage.setItem(FOLD_LS, v ? '1' : '0') } catch { /* bỏ qua */ } }
  // Esc đóng cột "Tài liệu & ghi chú" (cột có data-cd-busy nên CustomerDashboard không coi Esc là quay lại danh sách)
  useEffect(() => {
    if (!docsOpen) return undefined
    const k = e => { if (e.key === 'Escape' && !document.querySelector('[role=dialog]')) { e.preventDefault(); setDocsOpenRaw(false); try { localStorage.setItem(FOLD_LS, '0') } catch { /* bỏ qua */ } } }
    document.addEventListener('keydown', k, true)
    return () => document.removeEventListener('keydown', k, true)
  }, [docsOpen])
  const geoMap = useKdMap('geo')
  const investorMap = useKdMap('investor')
  const cdtMap = useKdMap('cdtContact')
  const attachMap = useKdMap('attach')
  const timelineMap = useKdMap('timeline')
  if (!l) return null
  const id = String(l.id)
  const geo = geoMap[id] || {}
  const tl = timelineMap[id] || {}
  const att = attachMap[id] || {}
  const imgs = att.img || [], files = att.file || []
  const src = splitSource(l.source)
  const sc = src.tag ? sourceColor(src.tag) : null
  const region = geo.tinh || geo.kv || ''
  const tiles = [
    { k: 'Loại hình dự án', v: l.projectType || l.type || '—' },
    { k: 'Doanh số dự kiến', v: l.value > 0 ? fmtTy(l.value) : '—', acc: true },
    { k: 'Khởi công dự kiến', v: tl.start ? fmtD(tl.start) : '—' },
    { k: 'Diện tích / Quy mô', v: l.scale || '—' },
    { k: 'Khu vực', v: region || '—', sub: geo.tinh && geo.kv ? geo.kv : '' },
    { k: 'Nguồn', tag: src.tag, v: src.detail || '—' },
  ]
  const secret = (key, label, full, masked) => {
    if (!full) return <Row k={label}>—</Row>
    const shown = !!reveal[key]
    return (
      <Row k={label}>
        <b>{shown ? full : masked}</b>
        <button type="button" className="cd-reveal" onClick={() => setReveal(r => ({ ...r, [key]: !shown }))}>{shown ? 'Ẩn' : 'Hiện'}</button>
      </Row>
    )
  }
  const cdt = cdtMap[id] || {}
  const q = l.quote
  const hText = handoffText(l.handoff)
  const docCount = (l.boqFile ? 1 : 0) + (l.concept ? 1 : 0) + (l.notes ? 1 : 0) + imgs.length + files.length
  return (
    <section className={'cd-card cd-profile' + (docsOpen ? ' docs-on' : '')}>
      <div className="cd-card-h">
        <span className="cd-card-t">Hồ sơ khách hàng</span>
        <span className="cd-fold-sp" />
        <button type="button" className="cd-link-btn" onClick={onEdit} title="Sửa thông tin khách hàng">Sửa</button>
        {/* nút tròn viền cam như nút mở cột Chi tiết của trang cũ: mở cột "Tài liệu & ghi chú" nằm ngang bên phải thẻ */}
        <button type="button" className={'cd-docs-tg' + (docsOpen ? ' on' : '')} aria-expanded={docsOpen}
          title={(docsOpen ? 'Đóng' : 'Mở') + ' Tài liệu & ghi chú' + (docCount ? ' (' + docCount + ')' : '')}
          aria-label={(docsOpen ? 'Đóng' : 'Mở') + ' Tài liệu & ghi chú'} onClick={() => setDocsOpen(!docsOpen)}>
          <Ic d={docsOpen ? 'm9 18 6-6-6-6' : 'm15 18-6-6 6-6'} size={14} />
          {docCount > 0 && !docsOpen && <b className="cd-docs-n">{docCount}</b>}
        </button>
      </div>
      <div className="cd-tiles">
        {tiles.map(t => (
          <div key={t.k} className="cd-tile">
            <span className="cd-tile-k">{t.k}{t.tag && <span className="cd-src-tag" style={sc ? { color: sc.color, borderColor: sc.color } : null}>{t.tag}</span>}</span>
            <span className={'cd-tile-v' + (t.acc ? ' acc' : '') + (String(t.v).length > 16 ? ' long' : '')}>{t.v}</span>
            {t.sub && <span className="cd-tile-sub">{t.sub}</span>}
          </div>
        ))}
      </div>
      {l.categories?.length > 0 && <div className="cd-chips">{l.categories.map(c => <span key={c}>{c}</span>)}</div>}
      <div className="cd-sep" />
      <div className="cd-rows">
        {/* khách Phòng KD Dự Án: Chủ đầu tư -> Người phụ trách (= tên khách) -> Chức vụ -> Phòng ban phụ trách, đều bên CĐT */}
        {l.dept === 'du-an' ? (
          <>
            <Row k="Chủ đầu tư">{investorMap[id] || '—'}</Row>
            <Row k="Người phụ trách">{l.name || '—'}</Row>
            <Row k="Chức vụ">{cdt.role || '—'}</Row>
            <Row k="Phòng ban">{cdt.dept || '—'}</Row>
          </>
        ) : <Row k="Tên KH">{l.name || '—'}</Row>}
        {secret('phone', 'Điện thoại', l.phone, maskPhone(l.phone))}
        {secret('email', 'Email', l.email, maskEmail(l.email))}
        <Row k="Địa chỉ">{l.address || '—'}</Row>
        <Row k="Tỉnh thành">{[geo.kv, geo.tinh].filter(Boolean).join(' · ') || '—'}</Row>
        <Row k="Hoàn công">{tl.end ? fmtD(tl.end) : '—'}</Row>
        <Row k="Ngày tạo">
          {suaNgay && onSetCreated ? (
            <span className="cd-ngay">
              <DatePicker value={l.createdAt || ''} max={todayIso()} ariaLabel="Ngày tạo" onChange={d => { if (d) onSetCreated(d); setSuaNgay(false) }} />
              <button type="button" className="cd-icon-btn" title="Huỷ" aria-label="Huỷ sửa ngày tạo" onClick={() => setSuaNgay(false)}>×</button>
            </span>
          ) : (
            <>
              {fmtD(l.createdAt) || '—'}
              {onSetCreated && <button type="button" className="cd-icon-btn" title="Sửa ngày tạo" aria-label="Sửa ngày tạo" onClick={() => setSuaNgay(true)}><Ic d={PEN} size={12} /></button>}
            </>
          )}
        </Row>
      </div>
      {docsOpen && (
        <aside className="cd-docs-side" data-cd-busy="1" aria-label="Tài liệu & ghi chú">
          <div className="cd-docs-h">
            <span>Tài liệu & ghi chú{docCount ? ' (' + docCount + ')' : ''}</span>
            <button type="button" className="cd-icon-btn" title="Đóng (Esc)" aria-label="Đóng Tài liệu & ghi chú" onClick={() => setDocsOpen(false)}>×</button>
          </div>
          <div className="cd-fold-b">
            {l.maDA && <Row k="Mã dự án QS"><b className="cd-mono" title="Dự án QS gắn với khách hàng">{l.maDA}</b></Row>}
            {q && (
              <Row k="Báo giá">
                <span className="cd-quote">Bán <b>{fmtVnd(q.ban)}</b> · Vốn <b>{fmtVnd(q.von)}</b> · {Number(q.soDong) || 0} dòng</span>
              </Row>
            )}
            {l.wonAt && <Row k="Ngày chốt">{fmtD(l.wonAt)}</Row>}
            {l.partner && <Row k="Đối tác"><span className="cd-pri">Có chuyển giao đối tác ngoài</span></Row>}
            {hText && <Row k="Bàn giao"><span className="cd-gold">{hText}</span></Row>}
            {l.boqFile && (() => { const b = boqOf(l.boqFile); return b.url
              ? <a className="cd-file" href={mediaUrl(b.url)} target="_blank" rel="noopener noreferrer" title="Mở file BOQ"><Ic d={FILE_IC} /><span>{b.name}</span></a>
              : <div className="cd-file"><Ic d={FILE_IC} /><span>{b.name}</span></div> })()}
            {l.concept && <p className="cd-note"><b>Concept:</b> {l.concept}</p>}
            {l.notes && <p className="cd-note"><b>Ghi chú nội bộ:</b> {l.notes}</p>}
            {!l.boqFile && !l.concept && !l.notes && <em className="cd-none">Chưa có BOQ, concept hay ghi chú</em>}
            <div className="cd-sub-t">Hình đính kèm{imgs.length ? ' (' + imgs.length + ')' : ''}</div>
            {imgs.length ? (
              <div className="cd-imgs">{imgs.map((it, i) => <a key={i} href={mediaUrl(it.url)} target="_blank" rel="noopener noreferrer" title={it.name}><img src={mediaUrl(it.url)} alt={it.name} /></a>)}</div>
            ) : <em className="cd-none">Chưa có hình</em>}
            <div className="cd-sub-t">Tệp đính kèm{files.length ? ' (' + files.length + ')' : ''}</div>
            {files.length ? files.map((it, i) => (
              <a key={i} className="cd-file" href={mediaUrl(it.url)} target="_blank" rel="noopener noreferrer" title={it.name}><Ic d={FILE_IC} /><span>{it.name}</span></a>
            )) : <em className="cd-none">Chưa có tệp</em>}
            <button type="button" className="cd-btn sm cd-fold-edit" onClick={onEdit}><Ic d={PEN} size={12} />Sửa / thêm tài liệu</button>
          </div>
        </aside>
      )}
    </section>
  )
}
