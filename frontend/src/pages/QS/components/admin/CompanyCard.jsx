import { useEffect, useRef, useState } from 'react'
import * as api from '../../api/qsApi'
import { mediaUrl } from '../../api/files'
import { qsToast } from '../common/dialogs'
import QsIcon from '../common/QsIcon'
import { downscaleImage_, uploadImg_ } from '../congty/logoUpload'
import { fmtDate } from '../../lib/format'
import { ngayConLai } from './adminUtil'
import './admin.css'
import '../congty/congty.css'

/* Màu chính công ty (M17.2): rỗng = màu mặc định của giao diện; máy chủ nhận #RGB hoặc #RRGGBB (giữ nguyên chữ). */
export const MAU_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
export const MAU_ERR = 'Màu chính phải dạng #RRGGBB'
export const EMAIL_RE = /^[^\s@]+@[^\s@]+$/   // như users.reEmail (M14.1)

/* <input type="color"> chỉ nhận #rrggbb chữ thường: "#1af" -> "#11aaff"; rỗng / sai dạng -> màu hiển thị tạm của ô chọn. */
function pickerValue(v) {
  v = String(v || '').trim()
  if (!MAU_RE.test(v)) return '#2563eb'
  if (v.length === 4) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]
  return v.toLowerCase()
}

/* Ô Màu chính: ô chọn màu + ô mã hex + nút Mặc định. Dùng ở thẻ Thông tin công ty và hộp Tạo / Sửa công ty (CongTyForm). */
export function MauChinhField({ value, onChange }) {
  const v = String(value || '')
  const bad = v.trim() !== '' && !MAU_RE.test(v.trim())
  return (
    <div className="qsa-mau">
      <div className="qsa-mau-row">
        <input type="color" className="qsa-mau-pick" value={pickerValue(v)} title="Chọn màu"
          onChange={e => onChange(e.target.value.toUpperCase())} aria-label="Chọn màu chính" />
        <input className={`qsa-mau-hex${bad ? ' bad' : ''}`} value={v} placeholder="Mặc định" maxLength={7}
          onChange={e => onChange(e.target.value)} aria-label="Mã màu chính (#RRGGBB)" />
        <button type="button" className="qsa-btn ghost xs" disabled={!v} onClick={() => onChange('')}>Mặc định</button>
      </div>
      {bad ? <i className="qsa-f-warn">{MAU_ERR}</i>
        : <i className="qsa-f-hint">{v ? 'Thanh trên, nút và điểm nhấn dùng màu này.' : 'Đang dùng màu mặc định của giao diện.'}</i>}
    </div>
  )
}

const pick = c => ({
  ten: (c && c.ten) || '', email: (c && c.email) || '', sdt: (c && c.sdt) || '',
  logo: (c && c.logoUrl) || '', mau: (c && c.mauChinh) || '',
})

/* Hạn dùng gói, chỉ đọc (chỉ quản trị hệ thống gia hạn ở tab Công ty): cùng chữ / màu với thẻ công ty của tab Công ty
   (public/congty.js:43-47 bản Node) - trống = "Không giới hạn". */
function HanDung({ han }) {
  if (!han) return <span className="qsco-han muted">Không giới hạn</span>
  const d = ngayConLai(han)
  if (d < 0) return <span className="qsco-han expired">Hết hạn {fmtDate(han)}</span>
  if (d <= 30) return <span className="qsco-han warn">Còn {d} ngày · {fmtDate(han)}</span>
  return <span className="qsco-han">Đến {fmtDate(han)}</span>
}

/* Thẻ "Thông tin công ty" ở tab Admin (M17.1): tên, logo, email, điện thoại, màu chính; hạn dùng chỉ xem.
   Props: c = công ty đang sửa (admin: công ty của phiên; super đang xem một công ty: bản lấy từ listCongTy);
   note = dòng ghi chú; onSaved(r) nhận công ty máy chủ trả về (AdminTab quyết định có áp vào phiên hay nạp lại danh sách). */
export default function CompanyCard({ c, note, onSaved }) {
  const [f, setF] = useState(() => pick(c))
  const [busy, setBusy] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoUrlIn, setLogoUrlIn] = useState('')
  const [drag, setDrag] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  // công ty đổi (lưu xong / nạp lại / đổi công ty đang xem) -> đọc lại form
  const sig = JSON.stringify(pick(c)) + '|' + (c && c.id)
  useEffect(() => { setF(pick(c)); setLogoUrlIn('') }, [sig])   // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const base = pick(c)
  const dirty = ['ten', 'email', 'sdt', 'logo', 'mau'].some(k => String(f[k]).trim() !== String(base[k]).trim())

  function logoPick() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'
    inp.onchange = () => { const fl = (inp.files || [])[0]; if (fl) logoUpload(fl) }
    inp.click()
  }
  async function logoUpload(file) {
    setLogoBusy(true)
    try {
      const dataUrl = await downscaleImage_(file, 512, 0.9)
      if (!dataUrl || dataUrl === '__DECODE_FAIL__') { qsToast('Không đọc được ảnh — thử PNG/JPG khác'); return }
      const tok = await uploadImg_(dataUrl, 'logo-' + Date.now() + '.png')
      if (!alive.current) return
      set('logo', tok); qsToast('Đã tải logo lên — bấm Lưu thay đổi để áp dụng')
    } catch (e) { qsToast('Lỗi tải logo: ' + e.message) } finally { if (alive.current) setLogoBusy(false) }
  }
  function logoAddUrl() {
    const t = String(logoUrlIn).trim(); if (!t) return
    set('logo', t); setLogoUrlIn('')
  }
  function logoDrop(e) {
    e.preventDefault(); setDrag(false)
    const fl = [].slice.call((e.dataTransfer && e.dataTransfer.files) || []).filter(x => !x.type || /^image\//.test(x.type))[0]
    if (fl) logoUpload(fl)
  }

  async function save() {
    const d = { ten: f.ten.trim(), logoUrl: String(f.logo || '').trim(), email: f.email.trim(), sdt: f.sdt.trim() }
    const mau = f.mau.trim()
    if (!d.ten) { qsToast('Chưa nhập tên công ty'); return }
    // Chỉ kiểm dạng khi đổi: email / màu cũ lưu nguyên văn (Node không kiểm) không chặn việc sửa trường khác
    if (d.email && d.email !== base.email.trim() && !EMAIL_RE.test(d.email)) { qsToast('Email không hợp lệ'); return }
    if (mau !== base.mau.trim()) {
      if (mau && !MAU_RE.test(mau)) { qsToast(MAU_ERR); return }
      d.mauChinh = mau
    }
    setBusy(true)
    try {
      const r = await api.updateCongTy(c.id, d)
      if (!alive.current) return
      qsToast('Đã lưu thông tin công ty')
      onSaved(r)
    } catch (e) { qsToast('Lỗi: ' + e.message) } finally { if (alive.current) setBusy(false) }
  }

  if (!c) return null
  return (
    <div className="qsa-card" data-card="congty">
      <div className="qsa-card-h">
        <span className="qsa-card-ic"><QsIcon name="building" size={18} /></span>
        <h3>Thông tin công ty</h3>
        <div className="qsa-co-ft">
          <button type="button" className="qsa-btn ghost sm" disabled={!dirty || busy} onClick={() => setF(pick(c))}>Hoàn tác</button>
          <button type="button" className="qsa-btn blue sm" disabled={!dirty || busy || logoBusy} onClick={save}>
            {busy ? 'Đang lưu…' : <><QsIcon name="check" size={14} /> Lưu thay đổi</>}
          </button>
        </div>
      </div>
      <div className="qsa-card-b">
        {note ? <p className="qsa-note">{note}</p> : null}
        <div className="qsa-co2">
        <div className="qsco-grp">
          <div className="qsco-brand">
            <div className="qsco-logo-col">
              <div className="qsco-grp-t qsco-logo-h">Nhận diện</div>
              <div className="qsco-logo-wrap" onClick={logoPick} title="Bấm hoặc kéo/thả ảnh vào đây"
                onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={e => { e.preventDefault(); setDrag(false) }} onDrop={logoDrop}>
                {logoBusy ? <div className="qsco-logo-box loading"><div className="qsco-logo-t">Đang tải…</div></div>
                  : f.logo ? (
                    <div className={`qsco-logo-box has${drag ? ' drag' : ''}`}>
                      <LogoImg src={mediaUrl(f.logo)} />
                      <button type="button" className="qsco-logo-x" title="Xoá logo" onClick={e => { e.stopPropagation(); set('logo', '') }}>✕</button>
                      <span className="qsco-logo-swap"><QsIcon name="edit" size={12} /> Đổi</span>
                    </div>
                  ) : (
                    <div className={`qsco-logo-box${drag ? ' drag' : ''}`}>
                      <div className="qsco-logo-ic"><QsIcon name="camera" size={20} /></div>
                      <div className="qsco-logo-t">Tải logo</div>
                      <div className="qsco-logo-s">Kéo/thả ảnh PNG</div>
                    </div>
                  )}
              </div>
            </div>
            <div className="qsco-form qsco-brand-r">
              <div className="qsco-f wide"><label><span>Tên công ty<em className="qsco-req">*</em></span></label>
                <input value={f.ten} onChange={e => set('ten', e.target.value)} placeholder="VD: Nội thất An Phát" /></div>
              <div className="qsco-f"><label><span>Màu chính</span></label>
                <MauChinhField value={f.mau} onChange={v => set('mau', v)} /></div>
              <div className="qsco-f" data-f="han"><label><span>Hạn dùng</span></label>
                <div className="qsa-co-han" title="Chỉ quản trị hệ thống gia hạn được (tab Công ty)">
                  <HanDung han={c.hanDung} /><QsIcon name="lock" size={12} /></div></div>
              <div className="qsco-f wide"><label><span>Link ảnh logo</span><i className="qsco-fhint">hoặc tải file ở ô bên trái</i></label>
                <div className="qsco-upurl">
                  <span className="qsco-upurl-ic"><QsIcon name="link" size={13} /></span>
                  <input value={logoUrlIn} onChange={e => setLogoUrlIn(e.target.value)} placeholder="https://…/logo.png"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); logoAddUrl() } }} />
                  <button type="button" className="qsco-upurl-btn" onClick={logoAddUrl}>Dùng link</button>
                </div></div>
            </div>
          </div>
        </div>
        <div className="qsco-grp">
          <div className="qsco-grp-t">Liên hệ</div>
          <div className="qsco-form qsa-co-lh">
            <div className="qsco-f"><label><span>Email liên hệ</span></label>
              <input type="email" value={f.email} onChange={e => set('email', e.target.value)} placeholder="ketoan@congty.vn" /></div>
            <div className="qsco-f"><label><span>Điện thoại</span></label>
              <input value={f.sdt} onChange={e => set('sdt', e.target.value)} placeholder="09xx xxx xxx" /></div>
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}

function LogoImg({ src }) {
  const [bad, setBad] = useState(false)
  useEffect(() => { setBad(false) }, [src])
  return <img src={src} alt="" style={bad ? { visibility: 'hidden' } : undefined} onError={() => setBad(true)} />
}
