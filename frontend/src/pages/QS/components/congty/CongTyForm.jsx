import { useEffect, useRef, useState } from 'react'
import * as api from '../../api/qsApi'
import { isAbort } from '../../api/http'
import { mediaUrl } from '../../api/files'
import { qsToast, qsAsk } from '../common/dialogs'
import QsIcon from '../common/QsIcon'
import AdmDlg from '../admin/AdmDlg'
import { CT_FEATURES, ngayConLai } from '../admin/adminUtil'
import { fmtDate } from '../../lib/format'
import { MauChinhField, MAU_RE, MAU_ERR, EMAIL_RE } from '../admin/CompanyCard'
import { downscaleImage_, uploadImg_ } from './logoUpload'
import { GRANT_TABS } from '../../state/store'
import { SUB_LBL } from '../admin/UserDetail'
import { ROLE_LBL } from '../admin/adminUtil'
import AccessMatrix from '../admin/AccessMatrix'
import { expandGrants, legacyCompanySet, sameSet, toGrants } from '../admin/accessUtil'
import { loadAccessCatalog } from '../../../../services/accessService'

/* Hộp Tạo / Phân quyền công ty #ctOv (port ctForm_, ctLogo*, ctTab_, ctToggleAll_, ctLoadUsers_, ctAddUser_, ctSave,
   PUB/congty.js:90-257). Props: c (null = tạo mới), startTab (bước mở đầu khi sửa: info / tn), onClose(), onSaved() (tải lại danh sách công ty). */
export default function CongTyForm({ c, startTab, onClose, onSaved }) {
  const isNew = !c
  const c0 = c || { tinhNang: CT_FEATURES.map(f => f[0]), gioiHanUser: 10, active: true }
  const [tab, setTabRaw] = useState(() => (c && startTab) || 'info')
  const [seen, setSeen] = useState(() => ({ info: true, goi: !isNew }))
  const [tried, setTried] = useState({})
  const setTab = t => { setTabRaw(t); setSeen(s => (s[t] ? s : { ...s, [t]: true })) }
  const [f, setF] = useState(() => ({
    ten: c0.ten || '', ma: c0.ma || '', email: c0.email || '', sdt: c0.sdt || '',
    limit: String(c0.gioiHanUser || 10), han: c0.hanDung || '', active: c0.active !== false ? '1' : '0', ghiChu: c0.ghiChu || '',
    share: !!c0.dungSpDezon, adU: '', adE: '', adN: '', adP: '', mau: c0.mauChinh || '',
  }))
  const [feats, setFeats] = useState(() => CT_FEATURES.map(x => x[0]).filter(k => (c0.tinhNang || []).indexOf(k) >= 0))
  const [logo, setLogo] = useState(c0.logoUrl || '')
  const [logoUrlIn, setLogoUrlIn] = useState('')
  const [logoBusy, setLogoBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [saving, setSaving] = useState(false)
  const [usersSeq, setUsersSeq] = useState(0)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  // Trần phân quyền của công ty (N21): acc = tập quyền | null (chưa đặt = suy từ Tính năng); acc0 = bản đã lưu để biết có đổi không
  const [pq, setPq] = useState({ phase: 'loading', cat: null, acc0: null, err: '' })
  const [acc, setAcc] = useState(null)
  const [pqSeq, setPqSeq] = useState(0)
  useEffect(() => {
    const ac = new AbortController()
    setPq(s => ({ ...s, phase: 'loading', err: '' }))
    Promise.all([loadAccessCatalog(), isNew ? null : api.getCompanyAccess(c.id, ac.signal)]).then(([cat, r]) => {
      const a0 = r && r.grants ? expandGrants(r.grants, cat) : null
      setPq({ phase: 'ready', cat, acc0: a0, err: '' }); setAcc(a0)
    }, e => { if (!isAbort(e)) setPq(s => ({ ...s, phase: 'error', err: e.message })) })
    return () => ac.abort()
  }, [pqSeq])   // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const v = k => String(f[k] == null ? '' : f[k]).trim()
  const old = k => String(c0[k] == null ? '' : c0[k]).trim()

  /* ---- Logo: kéo/thả · bấm chọn · hoặc link ---- */
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
      setLogo(tok); qsToast('Đã tải logo lên')
    } catch (e) { qsToast('Lỗi tải logo: ' + e.message) } finally { if (alive.current) setLogoBusy(false) }
  }
  function logoAddUrl() {
    const t = String(logoUrlIn).trim(); if (!t) return
    setLogo(t); setLogoUrlIn(''); qsToast('Đã dùng link ảnh làm logo')
  }
  function logoDrop(e) {
    e.preventDefault(); setDrag(false)
    const fl = [].slice.call((e.dataTransfer && e.dataTransfer.files) || []).filter(x => !x.type || /^image\//.test(x.type))[0]
    if (fl) logoUpload(fl)
  }

  async function save() {
    if (isNew) {
      for (const t of ['info', 'goi', 'tn', 'ad']) {
        const e = stepErr(t)
        if (e) { qsToast(e); setTried(s => ({ ...s, [t]: true })); setTab(t); return }
      }
    }
    const d = {
      ten: v('ten'), logoUrl: String(logo || '').trim(), email: v('email'), sdt: v('sdt'), tinhNang: feats.slice(),
      gioiHanUser: Number(v('limit')) || 0, hanDung: v('han') || null,
      active: v('active') === '1', ghiChu: v('ghiChu'), dungSpDezon: !!f.share,
    }
    if (!d.ten) { qsToast('Chưa nhập tên công ty'); setTab('info'); return }
    if (!feats.length) { qsToast('Chọn ít nhất 1 tính năng cho công ty'); setTab('tn'); return }
    const mau = v('mau')
    // Chỉ kiểm dạng khi đổi (sửa công ty): email / màu cũ lưu nguyên văn không chặn việc sửa trường khác
    const mauDoi = isNew || mau !== old('mauChinh')
    if (mauDoi && mau && !MAU_RE.test(mau)) { qsToast(MAU_ERR); setTab('info'); return }
    if (d.email && (isNew || d.email !== old('email')) && !EMAIL_RE.test(d.email)) { qsToast('Email không hợp lệ'); setTab('info'); return }
    if (isNew) {
      // Email đăng nhập của quản trị (M14.1): trim + chữ thường, kiểm dạng; trống thì máy chủ dùng email công ty (đã kiểm ở trên)
      d.ma = v('ma'); d.adminUser = v('adU'); d.adminHoTen = v('adN'); d.adminPass = v('adP')
      d.adminEmail = (v('adE') || d.email).toLowerCase()
      if (d.adminUser && d.adminEmail && !EMAIL_RE.test(d.adminEmail)) { qsToast('Email đăng nhập không hợp lệ'); setTab('ad'); return }
      if (d.adminUser && String(d.adminPass).length < 4) { qsToast('Mật khẩu quản trị tối thiểu 4 ký tự'); setTab('ad'); return }
    }
    setSaving(true)
    // Lưu trần phân quyền sau khi lưu công ty (chỉ khi đã đổi); lỗi bước này không huỷ phần đã lưu
    const pqDoi = pq.phase === 'ready' && !sameSet(acc, pq.acc0, pq.cat)
    const savePq = async id => {
      if (!pqDoi || !id) return ''
      try { await api.setCompanyAccess(id, acc == null ? null : toGrants(acc, pq.cat, true)); return '' } catch (e) { return ' — chưa lưu được phân quyền: ' + e.message }
    }
    try {
      if (!isNew) {
        if (mauDoi) d.mauChinh = mau
        await api.updateCongTy(c.id, d)
        qsToast('Đã cập nhật công ty' + await savePq(c.id))
      } else {
        const r = await api.createCongTy(d)
        // createCongTy (như Node) không lưu màu chính -> lưu riêng bằng updateCongTy ngay sau khi tạo
        let mauLoi = ''
        if (mau && r && r.id) { try { await api.updateCongTy(r.id, { mauChinh: mau }) } catch (e) { mauLoi = e.message } }
        const pqLoi = await savePq(r && r.id)
        qsToast('Đã tạo "' + (r && r.ten) + '"' + (d.adminUser ? (' — đăng nhập: ' + d.adminUser) : '')
          + (mauLoi ? (' — chưa lưu được màu chính: ' + mauLoi) : '') + pqLoi)
      }
      onClose(); onSaved()
    } catch (e) { qsToast('Lỗi: ' + e.message); if (alive.current) setSaving(false) }
  }

  const steps = [
    ['info', 'Thông tin', 'Tên, logo, liên hệ', 'building'],
    ['goi', 'Gói sử dụng', 'Người dùng, hạn dùng', 'clock'],
    ['tn', 'Tính năng', 'Phân hệ, kho SP Dezon', 'layers'],
    ['pq', 'Phân quyền', 'Trần quyền theo phân hệ', 'lock'],
    isNew ? ['ad', 'Tài khoản quản trị', 'Đăng nhập để bàn giao', 'lock'] : ['users', 'Người dùng', 'Tài khoản của công ty', 'list'],
  ]
  const idx = Math.max(0, steps.findIndex(s => s[0] === tab))
  const last = idx === steps.length - 1
  // Lỗi từng ô của 1 bước. Tạo mới: bắt buộc nhập đủ (trừ màu chính - có "Mặc định", hạn dùng - có "Không hạn",
  // ghi chú); tài khoản quản trị bắt buộc đủ 4 ô. Sửa công ty: giữ điều kiện cũ của save().
  function fieldErrs(t) {
    const e = {}
    if (t === 'info') {
      if (!v('ten')) e.ten = 'Chưa nhập tên công ty'
      if (v('mau') && !MAU_RE.test(v('mau'))) e.mau = MAU_ERR
      if (isNew) {
        if (!slugMa(v('ma'))) e.ma = v('ma') ? 'Mã công ty phải có chữ hoặc số' : 'Chưa nhập mã công ty'
        if (logoBusy) e.logo = 'Logo đang tải lên, đợi một chút'
        else if (!String(logo || '').trim()) e.logo = 'Chưa có logo'
        if (!v('email')) e.email = 'Chưa nhập email'
        else if (!EMAIL_RE.test(v('email'))) e.email = 'Email không hợp lệ'
        if (!v('sdt')) e.sdt = 'Chưa nhập số điện thoại'
        else if (!/^[0-9+().\s-]+$/.test(v('sdt')) || v('sdt').replace(/\D/g, '').length < 9) e.sdt = 'Số điện thoại không hợp lệ'
      } else if (v('email') && !EMAIL_RE.test(v('email'))) e.email = 'Email không hợp lệ'
    }
    if (t === 'goi' && isNew) { const n = Number(v('limit')); if (!(Number.isInteger(n) && n >= 1)) e.limit = 'Số người dùng tối đa phải là số nguyên từ 1' }
    if (t === 'tn' && !feats.length) e.feats = 'Chọn ít nhất 1 tính năng'
    if (t === 'ad' && isNew) {
      if (!v('adU')) e.adU = 'Chưa nhập tên đăng nhập'
      if (!v('adE')) e.adE = 'Chưa nhập email đăng nhập'
      else if (!EMAIL_RE.test(v('adE').toLowerCase())) e.adE = 'Email đăng nhập không hợp lệ'
      if (!v('adN')) e.adN = 'Chưa nhập họ tên'
      if (v('adP').length < 4) e.adP = 'Mật khẩu tối thiểu 4 ký tự'
    }
    return e
  }
  function stepErr(t) {
    const e = fieldErrs(t), ks = Object.keys(e)
    if (!ks.length) return ''
    return ks.length > 1 ? 'Vui lòng nhập đủ các trường bắt buộc (' + ks.length + ' trường còn thiếu / sai)' : e[ks[0]]
  }
  const E = tried[tab] ? fieldErrs(tab) : {}
  const done = isNew ? {
    info: idx > 0 && !stepErr('info'),
    goi: idx > 1,
    tn: idx > 2 && !stepErr('tn'),
    pq: idx > 3,
    ad: !!seen.ad && tab !== 'ad' && !stepErr('ad'),
  } : {}
  const stepAt = useRef(0)
  function goTo(i) {
    if (isNew) {
      for (let k = idx; k < i; k++) {
        const e = stepErr(steps[k][0])
        if (e) { qsToast(e); setTried(s => ({ ...s, [steps[k][0]]: true })); if (k !== idx) setTab(steps[k][0]); return }
      }
    }
    stepAt.current = Date.now()
    if (steps[i][0] === 'ad' && !v('adE') && v('email')) set('adE', v('email').toLowerCase())
    setTab(steps[i][0])
  }
  // Bỏ cú bấm lặp (bấm đúp "Tiếp tục" không được rơi vào nút "Tạo công ty" vừa hiện cùng chỗ)
  const once = fn => e => { if ((e && e.detail > 1) || Date.now() - stepAt.current < 400) return; fn() }
  const allOn = feats.length === CT_FEATURES.length
  const sec = {
    info: ['Thông tin công ty', 'Tên, logo, màu thương hiệu và thông tin liên hệ của công ty.'],
    goi: ['Gói sử dụng', 'Số tài khoản, thời hạn sử dụng và trạng thái của công ty.'],
    tn: ['Tính năng', 'Các phân hệ công ty được dùng và quyền xem kho sản phẩm của Dezon.'],
    pq: ['Phân quyền', 'Trần quyền Phân hệ > Tab > Thao tác của công ty. Quản trị và nhân viên công ty chỉ được cấp trong phạm vi này.'],
    ad: ['Tài khoản quản trị', 'Tài khoản quản trị đầu tiên của công ty, dùng để bàn giao.'],
    users: ['Người dùng', 'Danh sách tài khoản thuộc công ty này.'],
  }[tab]

  return (
    <AdmDlg icon="building" title={isNew ? 'Tạo công ty mới' : c.ten} wide className="qsco-dlg" onClose={onClose}>
      <div className="qsco-wz">
        <aside className="qsco-wz-side">
          <ol className="qsco-steps">
            {steps.map((s, i) => (
              <li key={s[0]}>
                <button type="button" className={`qsco-step${tab === s[0] ? ' on' : ''}${done[s[0]] && tab !== s[0] ? ' done' : ''}`}
                  onClick={() => goTo(i)} aria-current={tab === s[0] ? 'step' : undefined}>
                  <span className="qsco-step-n">{done[s[0]] && tab !== s[0] ? <QsIcon name="check" size={13} /> : (isNew ? i + 1 : <QsIcon name={s[3]} size={13} />)}</span>
                  <span className="qsco-step-t"><b>{s[1]}</b><i>{s[2]}</i></span>
                </button>
              </li>
            ))}
          </ol>
          <Preview c={c} f={f} logo={logo} feats={feats} />
        </aside>

        <section className="qsco-wz-main">
          <div className="qsco-sec-h"><h4>{sec[0]}</h4><p>{sec[1]}</p></div>

          {tab === 'info' ? (
            <>
              <div className="qsco-grp">
                <div className="qsco-brand">
                  <div className="qsco-logo-col">
                    <div className="qsco-grp-t qsco-logo-h">Nhận diện{isNew ? <em className="qsco-req">*</em> : null}</div>
                    <div className={`qsco-logo-wrap${E.logo && !logoBusy ? ' bad' : ''}`} onClick={logoPick} title="Bấm hoặc kéo/thả ảnh vào đây"
                      onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={e => { e.preventDefault(); setDrag(false) }} onDrop={logoDrop}>
                      {logoBusy ? <div className="qsco-logo-box loading"><div className="qsco-logo-t">Đang tải…</div></div>
                        : logo ? (
                          <div className={`qsco-logo-box has${drag ? ' drag' : ''}`}>
                            <LogoImg src={mediaUrl(logo)} />
                            <button type="button" className="qsco-logo-x" title="Xoá logo" onClick={e => { e.stopPropagation(); setLogo('') }}>✕</button>
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
                    <Fld label="Tên công ty" req wide err={E.ten}><input value={f.ten} onChange={e => set('ten', e.target.value)} placeholder="VD: Nội thất An Phát" autoFocus={isNew} /></Fld>
                    <Fld label="Mã công ty" req={isNew} hint={isNew ? '' : 'Không đổi được'} err={E.ma}>
                      <input value={f.ma} onChange={e => set('ma', e.target.value)} placeholder="vd: an-phat" readOnly={!isNew} /></Fld>
                    <Fld label="Màu chính" err={E.mau}><MauChinhField value={f.mau} onChange={x => set('mau', x)} /></Fld>
                    <Fld label="Link ảnh logo" wide>
                      <div className="qsco-upurl">
                        <span className="qsco-upurl-ic"><QsIcon name="link" size={13} /></span>
                        <input value={logoUrlIn} onChange={e => setLogoUrlIn(e.target.value)} placeholder="https://…/logo.png"
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); logoAddUrl() } }} />
                        <button type="button" className="qsco-upurl-btn" onClick={logoAddUrl}>Dùng link</button>
                      </div>
                    </Fld>
                  </div>
                </div>
              </div>
              <div className="qsco-grp">
                <div className="qsco-grp-t">Liên hệ</div>
                <div className="qsco-form">
                  <Fld label="Email liên hệ" req={isNew} err={E.email}><input type="email" value={f.email} onChange={e => set('email', e.target.value)} placeholder="ketoan@congty.vn" /></Fld>
                  <Fld label="Điện thoại" req={isNew} err={E.sdt}><input value={f.sdt} onChange={e => set('sdt', e.target.value)} placeholder="09xx xxx xxx" /></Fld>
                </div>
              </div>
            </>
          ) : null}

          {tab === 'goi' ? (
            <>
              <div className="qsco-grp">
                <div className="qsco-form">
                  <Fld label="Số người dùng tối đa" req={isNew} err={E.limit}>
                    <input type="number" min="1" step="1" value={f.limit} onChange={e => set('limit', e.target.value)} />
                    <div className="qsco-chipset">
                      {[5, 10, 20, 50].map(n => <button key={n} type="button" className={`qsco-chip${v('limit') === String(n) ? ' on' : ''}`} onClick={() => set('limit', String(n))}>{n}</button>)}
                    </div>
                  </Fld>
                  <Fld label="Hạn dùng" hint="Trống = không giới hạn">
                    <input type="date" value={f.han} onChange={e => set('han', e.target.value)} />
                    <div className="qsco-chipset">
                      {[[1, '+1 tháng'], [6, '+6 tháng'], [12, '+1 năm']].map(x => {
                        const d = plusMonths(x[0])
                        return <button key={x[0]} type="button" title="Tính từ hôm nay" className={`qsco-chip${v('han') === d ? ' on' : ''}`} onClick={() => set('han', d)}>{x[1]}</button>
                      })}
                      <button type="button" className={`qsco-chip${!v('han') ? ' on' : ''}`} onClick={() => set('han', '')} title="Không giới hạn">Không hạn</button>
                    </div>
                  </Fld>
                  <Fld label="Trạng thái">
                    <div className="qsco-seg" role="radiogroup">
                      {[['1', 'Đang hoạt động'], ['0', 'Tạm khoá']].map(x => (
                        <button key={x[0]} type="button" role="radio" aria-checked={f.active === x[0]}
                          className={`qsco-seg-b${f.active === x[0] ? ' on' : ''}${x[0] === '0' ? ' off' : ''}`} onClick={() => set('active', x[0])}>
                          <span className="qsco-dot" />{x[1]}
                        </button>
                      ))}
                    </div>
                  </Fld>
                  <Fld label="Ghi chú" wide><textarea rows={5} value={f.ghiChu} onChange={e => set('ghiChu', e.target.value)} placeholder="Gói dịch vụ, số hợp đồng, điều khoản riêng…" /></Fld>
                </div>
              </div>
            </>
          ) : null}

          {tab === 'tn' ? (
            <>
              <div className="qsco-share">
                <label className={`qsco-sw${f.share ? ' on' : ''}`}>
                  <input type="checkbox" checked={f.share} onChange={e => set('share', e.target.checked)} />
                  <span className="qsco-sw-b" />
                  <span className="qsco-sw-t"><b>Cho dùng danh sách sản phẩm của Dezon</b>
                    <i>Công ty thấy thêm kho SP mẫu của Dezon (chỉ xem, không sửa/xoá được). Vẫn nhập được SP riêng.</i></span>
                </label>
              </div>
              <div className={`qsco-feat${E.feats ? ' bad' : ''}`}>
                <div className="qsco-feat-h">
                  <span>Tính năng được dùng<em className="qsco-req">*</em></span>
                  <span className={`qsco-cnt${feats.length ? '' : ' zero'}`}>{feats.length} / {CT_FEATURES.length}</span>
                  <button type="button" className="qsco-all" onClick={() => setFeats(allOn ? [] : CT_FEATURES.map(x => x[0]))}>{allOn ? 'Bỏ hết' : 'Chọn hết'}</button>
                </div>
                <div className="qsco-feat-b">
                  {CT_FEATURES.map(x => {
                    const on = feats.indexOf(x[0]) >= 0
                    return (
                      <label key={x[0]} className={`qsco-fchk${on ? ' on' : ''}`} title={x[1]}>
                        <input type="checkbox" checked={on} onChange={e => setFeats(p => (e.target.checked
                          ? CT_FEATURES.map(y => y[0]).filter(k => k === x[0] || p.indexOf(k) >= 0) : p.filter(k => k !== x[0])))} />
                        <span className="qsco-fchk-box">{on ? <QsIcon name="check" size={11} /> : null}</span>
                        <span className="qsco-fchk-t">{x[1]}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            </>
          ) : null}

          {tab === 'pq' ? (
            pq.phase === 'ready' ? (
              <AccessMatrix catalog={pq.cat} value={acc} onChange={setAcc} fallback={legacyCompanySet(feats, pq.cat)}
                defaultText={'Chưa đặt riêng: trần quyền suy từ bước Tính năng (' + (feats.length ? feats.length + ' tính năng' : 'không chọn = mọi phân hệ')
                  + '). Chọn "Tuỳ chỉnh" để giới hạn đến từng tab và thao tác. Các trang Kinh doanh, Thiết kế, Thi công, HR, Mua hàng và tab QS vẫn cần bật ở bước Tính năng.'} />
            ) : pq.phase === 'error' ? (
              <div className="qsa-am-err">Không tải được phân quyền: {pq.err}
                <button type="button" className="qsa-btn sm" onClick={() => setPqSeq(x => x + 1)}>Thử lại</button></div>
            ) : <div className="qsa-empty" style={{ padding: 20 }}>Đang tải…</div>
          ) : null}

          {tab === 'ad' && isNew ? (
            <>
              <div className="qsco-callout">
                <span className="qsco-callout-ic"><QsIcon name="lock" size={15} /></span>
                <span>Quản trị đăng nhập được bằng <b>tên đăng nhập hoặc email</b>. Email đăng nhập điền sẵn bằng email liên hệ của công ty, sửa được nếu cần.</span>
              </div>
              <div className="qsco-grp">
                <div className="qsco-form">
                  <Fld label="Tên đăng nhập" req err={E.adU}><input value={f.adU} onChange={e => set('adU', e.target.value)} placeholder="vd: anphat.admin" autoComplete="off" /></Fld>
                  <Fld label="Email đăng nhập" req err={E.adE}><input type="email" value={f.adE} onChange={e => set('adE', e.target.value)} placeholder="admin@congty.vn" autoComplete="off" /></Fld>
                  <Fld label="Họ tên" req err={E.adN}><input value={f.adN} onChange={e => set('adN', e.target.value)} placeholder="Nguyễn Văn A" /></Fld>
                  <Fld label="Mật khẩu" req hint="Tối thiểu 4 ký tự" err={E.adP}><PassInput value={f.adP} onChange={x => set('adP', x)} /></Fld>
                </div>
              </div>
            </>
          ) : null}

          {tab === 'users' && !isNew ? <CtUsers c={c} seq={usersSeq} onAdded={() => { setUsersSeq(s => s + 1); onSaved() }} /> : null}
        </section>
      </div>

      <div className="qsco-f-btn">
        <button type="button" className="qsa-btn ghost sm" onClick={onClose}>Huỷ</button>
        {isNew ? <span className="qsco-f-step">Bước {idx + 1} / {steps.length}</span> : null}
        <span className="qsco-f-sp" />
        {isNew && idx > 0 ? <button key="back" type="button" className="qsa-btn sm" onClick={() => goTo(idx - 1)}>Quay lại</button> : null}
        {isNew && !last
          ? <button key="next" type="button" className="qsa-btn blue" onClick={once(() => goTo(idx + 1))}>Tiếp tục</button>
          : (
            <button key="save" type="button" className="qsa-btn blue" disabled={saving || logoBusy} onClick={once(save)}>
              {saving ? 'Đang lưu…' : <><QsIcon name="check" size={15} /> {isNew ? 'Tạo công ty' : 'Lưu thay đổi'}</>}
            </button>
          )}
      </div>
    </AdmDlg>
  )
}

/* Như slugMa của máy chủ (companies/service.go): bỏ dấu, đ -> d, ký tự khác a-z0-9 -> "-", tối đa 32 ký tự */
function slugMa(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
}

function plusMonths(n) {
  const d = new Date(), day = d.getDate()
  d.setDate(1); d.setMonth(d.getMonth() + n)
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  const z = x => (x < 10 ? '0' : '') + x
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate())
}

function Fld({ label, req, hint, err, wide, children }) {
  return (
    <div className={`qsco-f${wide ? ' wide' : ''}${err ? ' bad' : ''}`}>
      <label><span>{label}{req ? <em className="qsco-req">*</em> : null}</span>
        {hint ? <i className="qsco-fhint">{hint}</i> : null}</label>
      {children}
    </div>
  )
}

function PassInput({ value, onChange }) {
  const [show, setShow] = useState(false)
  return (
    <div className="qsco-pass">
      <input type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} placeholder="••••" autoComplete="new-password" />
      <button type="button" className="qsco-pass-b" title={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} onClick={() => setShow(s => !s)}><QsIcon name="eye" size={14} /></button>
    </div>
  )
}

/* Chữ trắng hay chữ tối trên nền màu chính (màu sáng như #FFE600 không đọc được chữ trắng) */
function onColor(hex) {
  let h = hex.slice(1); if (h.length === 3) h = h.split('').map(x => x + x).join('')
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#161A22' : '#fff'
}

/* Thẻ xem trước: giống thẻ công ty ở lưới tab Công ty, cập nhật theo form */
function Preview({ c, f, logo, feats }) {
  const [bad, setBad] = useState(false)
  useEffect(() => { setBad(false) }, [logo])
  const ten = String(f.ten || '').trim()
  const mau = String(f.mau || '').trim()
  const lim = Number(String(f.limit).trim()) || 0
  const han = String(f.han || '').trim()
  const d = han ? ngayConLai(han) : null
  const hanTxt = !han ? <span className="qsco-han muted">Không giới hạn</span>
    : d < 0 ? <span className="qsco-han expired">Hết hạn {fmtDate(han)}</span>
      : d <= 30 ? <span className="qsco-han warn">Còn {d} ngày · {fmtDate(han)}</span>
        : <span className="qsco-han">Đến {fmtDate(han)}</span>
  const on = f.active === '1'
  const fpct = Math.round(feats.length / CT_FEATURES.length * 100)
  const pv = MAU_RE.test(mau) ? { '--pv-accent': mau, '--pv-on': onColor(mau) } : undefined
  return (
    <div className="qsco-pv">
      <div className="qsco-pv-l"><QsIcon name="eye" size={12} /> Xem trước</div>
      <div className="qsco-pv-card" style={pv}>
        <div className="qsco-pv-strip" />
        <div className="qsco-pv-h">
          {logo && !bad ? <img className="qsco-lg" src={mediaUrl(logo)} alt="" onError={() => setBad(true)} />
            : <span className="qsco-ini">{(ten || '?').charAt(0).toUpperCase()}</span>}
          <div className="qsco-card-t">
            <div className={`qsco-nm${ten ? '' : ' ph'}`}>{ten || 'Tên công ty'}</div>
            <div className="qsco-sub">{String(f.ma || '').trim() || ''}</div>
          </div>
        </div>
        <span className={`qsco-badge ${on ? 'ok' : 'locked'}`}>{on ? 'Đang hoạt động' : 'Tạm khoá'}</span>
        <div className="qsco-pv-row"><span>Người dùng</span><b>{c ? (c.soUser || 0) : 0} / {lim || '∞'}</b></div>
        <div className="qsco-pv-row"><span>Hạn dùng</span>{hanTxt}</div>
        <div className="qsco-pv-row"><span>Tính năng</span><b>{feats.length} / {CT_FEATURES.length}</b></div>
        <div className="qsco-bar"><i style={{ width: fpct + '%' }} /></div>
        {f.share ? <span className="qsco-sharetag"><QsIcon name="layers" size={11} /> Kho SP Dezon</span> : null}
      </div>
    </div>
  )
}

function LogoImg({ src }) {
  const [bad, setBad] = useState(false)
  return <img src={src} alt="" style={bad ? { visibility: 'hidden' } : undefined} onError={() => setBad(true)} />
}

/* Thẻ "Người dùng" khi sửa công ty (ctLoadUsers_ / ctAddUser_, PUB/congty.js:206-233) */
function CtUsers({ c, seq, onAdded }) {
  const [st, setSt] = useState({ phase: 'loading', us: [], err: '' })
  const [openId, setOpenId] = useState(null)   // tài khoản đang mở xem đủ quyền
  useEffect(() => {
    const ac = new AbortController()
    setSt(s => ({ ...s, phase: 'loading' }))
    api.listCongTyUsers(c.id, ac.signal).then(us => setSt({ phase: 'ready', us: us || [], err: '' }),
      e => { if (!isAbort(e)) setSt({ phase: 'error', us: [], err: e.message }) })
    return () => ac.abort()
  }, [c.id, seq])

  async function addUser() {
    const r = await qsAsk({
      title: 'Thêm tài khoản cho ' + c.ten, confirmText: 'Tạo tài khoản', required: false, fields: [
        { key: 'u', label: 'Tên đăng nhập' }, { key: 'e', label: 'Email (đăng nhập được)' },
        { key: 'n', label: 'Họ tên' }, { key: 'p', label: 'Mật khẩu (≥4 ký tự)', type: 'password' }],
    })
    if (!r) return
    if (!r.u || String(r.p).length < 4) { qsToast('Cần tên đăng nhập và mật khẩu ≥4 ký tự'); return }
    const em = String(r.e || '').trim().toLowerCase()   // như hộp Thêm tài khoản (M14.1)
    if (em && !EMAIL_RE.test(em)) { qsToast('Email không hợp lệ'); return }
    try {
      await api.createCongTyUser(c.id, { username: r.u, email: em, hoTen: r.n, password: r.p, role: 'staff', perms: [] })
      qsToast('Đã tạo tài khoản ' + r.u); onAdded()
    } catch (e) { qsToast('Lỗi: ' + e.message) }
  }

  if (st.phase === 'error') return <div className="qsa-empty" style={{ padding: 20 }}>Lỗi: {st.err}</div>
  if (st.phase !== 'ready') return <div className="qsa-empty" style={{ padding: 20 }}>Đang tải…</div>
  const lbl = {}
  GRANT_TABS.forEach(x => { lbl[x[0]] = x[1] })
  const name = k => lbl[k] || SUB_LBL[k] || k
  return (
    <div>
      <div className="qsco-uhead"><span>{st.us.length} / {c.gioiHanUser || '∞'} tài khoản</span>
        <button type="button" className="qsa-btn blue xs" onClick={addUser}><QsIcon name="plus" size={13} /> Thêm tài khoản</button></div>
      {/* Mỗi tài khoản 1 dòng gọn: quyền chỉ hiện 2 mục đầu + "+N"; bấm dòng để xem đủ quyền ngay bên dưới */}
      <div className="qsco-ulist">
        {st.us.length ? st.us.map(u => {
          const p = u.perms || []
          const full = u.role !== 'staff'
          const open = openId === u.id
          const av = (u.hoTen || u.username || '?').trim().charAt(0).toUpperCase()
          return (
            <div key={u.id} className={`qsco-urow${open ? ' open' : ''}${u.active ? '' : ' off'}`}>
              <button type="button" className="qsco-urow-h" aria-expanded={open} onClick={() => setOpenId(open ? null : u.id)}>
                <span className={`qsco-uav${full ? ' adm' : ''}`}>{av}</span>
                <span className="qsco-un"><b>{u.hoTen || u.username}</b><i>@{u.username}{u.email ? ' · ' + u.email : ''}</i></span>
                <span className={`qsa-role ${u.role === 'super' ? 'sup' : (u.role === 'admin' ? 'adm' : 'stf')}`}>{ROLE_LBL[u.role] || u.role}</span>
                <span className="qsco-up">{full ? <span className="qsa-muted">Toàn quyền</span>
                  : p.length ? <>{p.slice(0, 2).map(k => <span key={k} className="qsa-permchip">{name(k)}</span>)}{p.length > 2 ? <span className="qsa-permmore">+{p.length - 2}</span> : null}</>
                    : <span className="qsa-st-lk">Chưa cấp</span>}</span>
                <span className={`qsco-badge ${u.active ? 'ok' : 'locked'}`}>{u.active ? 'Hoạt động' : 'Khoá'}</span>
                <svg className="qsco-ucar" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={open ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'} /></svg>
              </button>
              {open ? (
                <div className="qsco-urow-b">
                  {full ? <span className="qsa-muted">{ROLE_LBL[u.role] || u.role} dùng được mọi trang và tính năng của công ty.</span>
                    : p.length ? p.map(k => <span key={k} className="qsa-permchip">{name(k)}</span>) : <span className="qsa-st-lk">Chưa cấp quyền nào.</span>}
                </div>
              ) : null}
            </div>
          )
        }) : <div className="qsa-empty" style={{ padding: 18 }}>Công ty chưa có tài khoản nào.</div>}
      </div>
    </div>
  )
}
