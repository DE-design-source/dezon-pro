import { useEffect, useRef, useState } from 'react'
import * as api from '../../api/qsApi'
import * as hrApi from '../../../ChamCong/api'
import { isAbort } from '../../api/http'
import { GRANT_TABS } from '../../state/store'
import { loadAccessCatalog } from '../../../../services/accessService'
import { qsToast } from '../common/dialogs'
import QsIcon from '../common/QsIcon'
import AdmDlg from './AdmDlg'
import AccessMatrix from './AccessMatrix'
import { expandGrants, clipSet, sameSet, toGrants, legacyKeys, legacyStaffSet, setHas, countModules } from './accessUtil'
import './admin.css'
import '../congty/congty.css'

const EMAIL_RE = /^[^\s@]+@[^\s@]+$/   // như máy chủ (users.reEmail, M14.1)
const EMAIL_NOLOGIN_RE = /[*%\\]/     // đăng nhập chặn email có * % \ (auth reWildcard): lưu được nhưng không đăng nhập bằng nó
const normEmail = v => String(v || '').trim().toLowerCase()
const GRANT_KEYS = GRANT_TABS.map(t => t[0])
// Khoá quyền con do các khối riêng bên dưới quản lý (không giữ nguyên lúc lưu mà dựng lại từ lv / daDuyet)
const SUB_KEYS = ['sp_edit', 'sp_duyet', 'da_duyet']

/* Hộp Thêm / Sửa tài khoản (port admUserModal / admModalRole / admSubSync_ / admPermAll / admModalSave, PUB/admin.js:162-272).
   Props: user (null = tạo mới), isSuper, companies (S._admCt), defaultCt (công ty đang làm việc), onClose(), onSaved(msg),
   rights ({duyet, giaoDuyet} của tài khoản đang đăng nhập, M14.6), approved (tài khoản admin đang sửa đã được giao duyệt SP).
   Như #admModal gốc: chỉ đóng bằng ✕ / Huỷ / bấm nền, không đóng bằng Esc để khỏi mất phần đã gõ. */
/* superMode (mục Tài khoản siêu quản trị viên, MarkUp 2026-11-12 17:55): tạo / sửa tài khoản vai trò super - tài khoản can thiệp
   hệ thống, không phải nhân viên cũng không phải admin công ty: không có lựa chọn vai trò, không có khối quyền */
export default function UserModal({ user, isSuper, companies, defaultCt, onClose, onSaved, superMode = false, rights = null, approved = false }) {
  const isEdit = !!user
  const u = user || { role: 'staff', perms: [] }
  const perms0 = u.perms || []
  const [username, setUsername] = useState(u.username || '')
  const [hoTen, setHoTen] = useState(u.hoTen || '')
  const [phongBan, setPhongBan] = useState(u.phongBan || '')
  const [email, setEmail] = useState(u.email || '')
  const [pw, setPw] = useState('')
  // mặc định = công ty đang làm việc; super chỉ đổi khi muốn tạo cho công ty khác
  const mac = u.congTyId || defaultCt || ''
  const [ct, setCt] = useState(mac)
  const [role, setRole] = useState(superMode || u.role === 'super' ? 'super' : (u.role !== 'admin' ? 'staff' : 'admin'))
  // Khoá trang / tab kiểu cũ đã lưu: giữ nguyên khi tài khoản còn "Theo mặc định cũ" (chưa đặt ma trận phân quyền)
  const [perms] = useState(() => GRANT_KEYS.filter(k => perms0.indexOf(k) >= 0))
  // Khoá đã lưu mà giao diện này không biết (bản mới hơn / cũ hơn thêm vào): giữ nguyên khi lưu, không âm thầm xoá
  const [extra] = useState(() => perms0.filter((k, i) => k && GRANT_KEYS.indexOf(k) < 0 && SUB_KEYS.indexOf(k) < 0 && perms0.indexOf(k) === i))
  // Quyền trong tab Danh sách SP: CHỌN MỘT — chỉ sửa, hoặc sửa và duyệt
  const [lv, setLv] = useState(perms0.indexOf('sp_duyet') >= 0 ? 'sp_duyet' : (perms0.indexOf('sp_edit') >= 0 ? 'sp_edit' : ''))
  // Duyệt yêu cầu sửa thông tin dự án (migration 0037, trang chi tiết dự án): quyền riêng, không gắn với tab nào
  const [daDuyet, setDaDuyet] = useState(perms0.indexOf('da_duyet') >= 0)
  // Duyệt sản phẩm theo phân cấp (M14.6): chỉ super hoặc admin được giao duyệt mới cấp được 'sp_duyet' cho nhân viên;
  // nhân viên đã có sẵn 'sp_duyet' thì vẫn chọn được để giữ / bỏ. apr = super giao quyền duyệt cho tài khoản admin
  const canGrantDuyet = isSuper || !!(rights && rights.giaoDuyet)
  const hadDuyet = perms0.indexOf('sp_duyet') >= 0
  const [apr, setApr] = useState(!!approved)
  const [busy, setBusy] = useState(false)
  // Bố cục từng bước như hộp Tạo công ty (CongTyForm): tab = bước đang mở, tried = bước đã bấm Tiếp tục (hiện ô đỏ)
  const [tab, setTab] = useState('info')
  const [tried, setTried] = useState({})
  // Hồ sơ nhân sự (HR) gắn với tài khoản: nhân viên phải được gắn mới dùng được tab Nhân sự. Chỉ khi sửa tài khoản của công ty
  // đang làm việc (danh sách hồ sơ lấy theo công ty đó); công ty chưa có HR / không đọc được -> ẩn
  const [hrEmps, setHrEmps] = useState(null)
  const [hrEmp, setHrEmp] = useState('')
  const hrOld = useRef(null)
  /* Phân quyền 3 cấp (N21). Không áp cho tài khoản super; admin công ty không tự phân quyền cho mình.
     pq.raw0 = tập quyền đã lưu (null = chưa đặt); pq.mine = quyền được cấp cho người khác của người đang đăng nhập (không phải super);
     accBy = tập quyền đang sửa theo vai trò (đổi vai trò Nhân viên <-> Quản trị không trộn lẫn); ctCeil = trần quyền công ty (super) */
  const pqOn = !superMode && u.role !== 'super' && (isSuper || u.role !== 'admin')
  const [pq, setPq] = useState({ phase: 'loading', cat: null, raw0: null, mine: null, err: '' })
  const [accBy, setAccBy] = useState({ staff: isEdit ? null : {}, admin: null })
  const [ctCeil, setCtCeil] = useState({ ct: '', set: null, err: '' })
  const [pqSeq, setPqSeq] = useState(0)
  useEffect(() => {
    if (!pqOn) return undefined
    const ac = new AbortController()
    setPq(s => ({ ...s, phase: 'loading', err: '' }))
    Promise.all([loadAccessCatalog(), isEdit ? api.getUserAccess(u.id, ac.signal) : null, isSuper ? null : api.getMyAccess(ac.signal)]).then(([cat, r, me]) => {
      const raw0 = r && r.grants ? expandGrants(r.grants, cat) : null
      setPq({ phase: 'ready', cat, raw0, mine: me ? expandGrants(me.grantable, cat) : null, err: '' })
      if (isEdit) setAccBy({ staff: u.role === 'staff' ? raw0 : null, admin: u.role === 'admin' ? raw0 : null })
    }, e => { if (!isAbort(e)) setPq(s => ({ ...s, phase: 'error', err: e.message })) })
    return () => ac.abort()
  }, [pqSeq])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pqOn || !isSuper || !ct) return undefined
    const ac = new AbortController()
    setCtCeil({ ct, set: null, err: '' })
    Promise.all([loadAccessCatalog(), api.getCompanyAccess(ct, ac.signal)]).then(([cat, r]) => setCtCeil({ ct, set: expandGrants(r && r.effective, cat), err: '' }),
      e => { if (!isAbort(e)) setCtCeil({ ct, set: null, err: e.message }) })
    return () => ac.abort()
  }, [ct, pqSeq])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isEdit || String(u.congTyId || '') !== String(defaultCt || '')) return
    hrApi.load().then(st => {
      const list = (st.employees || []).filter(e => e.status !== 'left' || e.userId === u.id)
      const mine = list.find(e => e.userId === u.id)
      hrOld.current = mine ? mine.id : null
      setHrEmp(mine ? String(mine.id) : '')
      setHrEmps(list)
    }, () => {})
  }, [])

  // Trần ma trận: super -> trần công ty của tài khoản; admin -> quyền của chính mình (máy chủ chặn cấp vượt)
  const ceiling = isSuper ? (ctCeil.ct === ct ? ctCeil.set : null) : pq.mine
  const pqReady = pqOn && pq.phase === 'ready' && !!ceiling
  const accRole = role === 'admin' ? 'admin' : 'staff'
  const acc = accBy[accRole]
  const setAcc = v => setAccBy(s => ({ ...s, [accRole]: v }))
  const accEff = pqReady && acc != null ? clipSet(acc, ceiling, pq.cat) : null
  // Ma trận có đổi so với bản đã lưu (đổi vai trò cũng tính là đổi). Không đổi thì không ghi lại - quyền vượt phạm vi người sửa
  // (do cấp trên đặt) không bị cắt khi chỉ sửa họ tên / email
  const accChanged = pqReady && !(isEdit && role === u.role && (acc == null ? pq.raw0 == null : pq.raw0 != null && sameSet(acc, pq.raw0, pq.cat)))
  const staffFallback = pqReady ? clipSet(legacyStaffSet(perms0, pq.cat), ceiling, pq.cat) : null
  // Tab Danh sách SP được xem: theo ma trận nếu đã tuỳ chỉnh, không thì theo khoá cũ
  const spOn = role === 'staff' && accEff ? setHas(accEff, 'qs', 'sanpham', 'view') : perms.indexOf('sanpham') >= 0
  // Sửa: email không đổi (bỏ qua hoa thường / khoảng trắng) thì không kiểm, không gửi - email cũ sai dạng vẫn sửa được trường khác
  const emailChanged = !isEdit || normEmail(email) !== normEmail(u.email)
  const emailBad = emailChanged && normEmail(email) !== '' && !EMAIL_RE.test(normEmail(email))
  const emailOldBad = !emailChanged && normEmail(email) !== '' && !EMAIL_RE.test(normEmail(email))
  const emailNoLogin = !emailBad && !emailOldBad && EMAIL_NOLOGIN_RE.test(normEmail(email))

  function save() {
    // quyền = các tab được tích + mức quyền trong tab Danh sách SP (radio, có thể bỏ trống)
    let ps = []
    if (role === 'staff') {
      // Đã tuỳ chỉnh ma trận: vẫn ghi khoá cũ (trang / tab được xem) để các cổng cũ (canPage / canTab, máy chủ) chạy đúng
      ps = (accEff && accChanged ? legacyKeys(accEff) : perms).concat(extra)
      if (lv && spOn) ps.push(lv)
      if (daDuyet) ps.push('da_duyet')
    }
    // Email đăng nhập (M14.1): trim + chữ thường, rỗng = không có / xoá; máy chủ kiểm trùng trong công ty khi sửa
    const em = normEmail(email)
    if (emailBad) { qsToast('Email không hợp lệ'); return }
    setBusy(true)
    // super giao / thu quyền duyệt SP cho tài khoản admin sau khi lưu xong; lỗi bước này không huỷ phần đã lưu
    const setApproval = (id, msg) => {
      const want = isSuper && role === 'admin' && apr
      if (!isSuper || role !== 'admin' || id == null || want === !!(isEdit && approved)) return Promise.resolve(msg)
      return api.setProductApproval(id, want).then(() => msg, e => msg + ' — lỗi giao quyền duyệt sản phẩm: ' + e.message)
    }
    // Lưu ma trận phân quyền sau khi lưu tài khoản (chỉ khi đổi); lỗi bước này không huỷ phần đã lưu
    const setAccess = (id, msg) => {
      if (!pqStep || !accChanged || id == null || (acc == null && (!isEdit || pq.raw0 == null))) return Promise.resolve(msg)
      return api.setUserAccess(id, acc == null ? null : toGrants(accEff, pq.cat)).then(() => msg, e => msg + ' — lỗi lưu phân quyền: ' + e.message)
    }
    const done = msg => onSaved(msg)
    const fail = e => { qsToast('Lỗi: ' + e.message); setBusy(false) }
    if (isEdit) {
      const patch = { hoTen, role, perms: ps, phongBan }
      if (isSuper) patch.congTyId = ct
      // chuyển công ty mà giữ email: vẫn gửi để máy chủ kiểm trùng ở công ty mới (không kiểm lại dạng)
      if (emailChanged || (isSuper && em && String(ct || '') !== String(u.congTyId || ''))) patch.email = em
      // đổi hồ sơ HR: bỏ gắn hồ sơ cũ trước (1 tài khoản chỉ gắn 1 hồ sơ), rồi gắn hồ sơ mới
      const to = hrEmp ? Number(hrEmp) : null
      const linkHr = async () => {
        if (!hrEmps || to === hrOld.current) return
        if (hrOld.current) await hrApi.setUserRole({ empId: hrOld.current, userId: '' })
        if (to) await hrApi.setUserRole({ empId: to, userId: u.id })
      }
      api.adminUpdateUser(u.id, patch).then(linkHr).then(() => setApproval(u.id, 'Đã cập nhật').then(m => setAccess(u.id, m)).then(done), fail)
    } else {
      api.adminCreateUser({ username, hoTen, email: em, role, password: pw, perms: ps, phongBan, congTyId: (isSuper && ct) || undefined })
        .then(r => setApproval(r && r.id, 'Đã tạo tài khoản').then(m => setAccess(r && r.id, m)).then(done), fail)
    }
  }

  const isSup = role === 'super'
  // admin công ty (không phải super) sửa chính mình: vai trò cố định (máy chủ chặn tự đổi vai trò)
  const roleLocked = !isSuper && isEdit && u.role === 'admin'
  const steps = [['info', 'Thông tin', 'Đăng nhập, liên hệ', 'lock'], ['role', 'Vai trò', isSup ? 'Siêu quản trị viên' : 'Nhân viên / Quản trị', 'building']]
  // Bước Phân quyền: nhân viên; tài khoản quản trị công ty khi super sửa (giới hạn trong trần công ty)
  const pqStep = pqOn && (role === 'staff' || (isSuper && role === 'admin'))
  if (pqStep) steps.push(['pq', 'Phân quyền', role === 'staff' ? 'Phân hệ, tab, thao tác' : 'Trong trần công ty', 'layers'])
  const idx = Math.max(0, steps.findIndex(s => s[0] === tab))
  const last = idx === steps.length - 1
  // Lỗi từng ô (tạo mới: tên đăng nhập, họ tên, mật khẩu bắt buộc; email đúng dạng nếu có)
  function fieldErrs(t) {
    const e = {}
    if (t === 'info') {
      if (!isEdit && !String(username).trim()) e.username = 1
      if (!isEdit && !String(hoTen).trim()) e.hoTen = 1
      if (!isEdit && String(pw).length < 4) e.pw = 1
      if (emailBad) e.email = 1
      if (!isEdit && isSuper && !ct) e.ct = 1
    }
    return e
  }
  const stepMsg = t => {
    const e = fieldErrs(t), n = Object.keys(e).length
    if (!n) return ''
    if (n > 1) return 'Vui lòng nhập đủ các trường bắt buộc'
    return e.username ? 'Chưa nhập tên đăng nhập' : e.hoTen ? 'Chưa nhập họ tên' : e.pw ? 'Mật khẩu tối thiểu 4 ký tự'
      : e.email ? 'Email không hợp lệ' : 'Chưa chọn công ty'
  }
  const E = tried[tab] ? fieldErrs(tab) : {}
  const stepAt = useRef(0)
  function goTo(i) {
    if (!isEdit) {
      for (let k = idx; k < i; k++) {
        const m = stepMsg(steps[k][0])
        if (m) { qsToast(m); setTried(s => ({ ...s, [steps[k][0]]: true })); if (k !== idx) setTab(steps[k][0]); return }
      }
    }
    stepAt.current = Date.now()
    setTab(steps[i][0])
  }
  const once = fn => e => { if ((e && e.detail > 1) || (!isEdit && Date.now() - stepAt.current < 400)) return; fn() }
  function submit() {
    const m = stepMsg('info')
    if (m) { qsToast(m); setTried(s => ({ ...s, info: true })); setTab('info'); return }
    save()
  }
  const done = isEdit ? {} : { info: idx > 0 && !stepMsg('info'), role: idx > 1 }
  const sec = {
    info: ['Thông tin tài khoản', 'Tên đăng nhập, họ tên, email và mật khẩu để đăng nhập.'],
    role: ['Vai trò', isSup ? 'Tài khoản can thiệp hệ thống của nhà phát triển.' : 'Nhân viên chỉ vào được mục được cấp; quản trị công ty có toàn quyền.'],
    pq: ['Phân quyền', role === 'staff'
      ? 'Cấp quyền theo Phân hệ > Tab > Thao tác, chỉ trong phạm vi quyền của người cấp. Thu quyền ở cấp trên thì cấp dưới tự mất theo.'
      : 'Giới hạn quyền của quản trị công ty trong trần quyền của công ty; nhân viên do tài khoản này cấp cũng bị giới hạn theo.'],
  }[tab] || ['', '']
  const ctName = (companies || []).filter(c => String(c.id) === String(ct))[0]
  const title = isSup ? (isEdit ? 'Sửa tài khoản siêu quản trị viên' : 'Thêm tài khoản siêu quản trị viên') : (isEdit ? 'Sửa tài khoản' : 'Thêm tài khoản')

  return (
    <AdmDlg icon="lock" title={title} wide className="qsco-dlg qsa-um2" onClose={onClose}>
      <div className="qsco-wz">
        <aside className="qsco-wz-side">
          <ol className="qsco-steps">
            {steps.map((s, i) => (
              <li key={s[0]}>
                <button type="button" className={`qsco-step${tab === s[0] ? ' on' : ''}${done[s[0]] && tab !== s[0] ? ' done' : ''}`}
                  onClick={() => goTo(i)} aria-current={tab === s[0] ? 'step' : undefined}>
                  <span className="qsco-step-n">{done[s[0]] && tab !== s[0] ? <QsIcon name="check" size={13} /> : (isEdit ? <QsIcon name={s[3]} size={13} /> : i + 1)}</span>
                  <span className="qsco-step-t"><b>{s[1]}</b><i>{s[2]}</i></span>
                </button>
              </li>
            ))}
          </ol>
          <div className="qsco-pv">
            <div className="qsco-pv-l"><QsIcon name="eye" size={12} /> Xem trước</div>
            <div className="qsco-pv-card">
              <div className="qsco-pv-strip" />
              <div className="qsco-pv-h">
                <span className="qsco-ini">{String(hoTen || username || '?').trim().charAt(0).toUpperCase()}</span>
                <div className="qsco-card-t">
                  <div className={`qsco-nm${hoTen ? '' : ' ph'}`}>{hoTen || 'Họ tên'}</div>
                  <div className="qsco-sub">{username ? '@' + username : 'tên đăng nhập'}</div>
                </div>
              </div>
              <span className={`qsa-role ${isSup ? 'sup' : (role === 'admin' ? 'adm' : 'stf')}`} style={{ alignSelf: 'flex-start' }}>{isSup ? 'Siêu quản trị viên' : role === 'admin' ? 'Quản trị công ty' : 'Nhân viên'}</span>
              {isSuper ? <div className="qsco-pv-row"><span>Công ty</span><b className="qsa-um2-em" title={ctName ? (ctName.ten || ctName.ma) : ''}>{ctName ? (ctName.ten || ctName.ma) : '—'}</b></div> : null}
              <div className="qsco-pv-row"><span>Email</span><b className="qsa-um2-em">{normEmail(email) || '—'}</b></div>
              <div className="qsco-pv-row"><span>Quyền</span><b>{role === 'staff' ? (accEff ? countModules(accEff) + ' phân hệ' : perms.length + ' / ' + GRANT_KEYS.length)
                : role === 'admin' && pqStep && accEff ? countModules(accEff) + ' phân hệ' : 'Toàn quyền'}</b></div>
            </div>
          </div>
        </aside>

        <section className="qsco-wz-main">
          <div className="qsco-sec-h"><h4>{sec[0]}</h4><p>{sec[1]}</p></div>

          {tab === 'info' ? (
            <>
              <div className="qsco-grp">
                <div className="qsco-grp-t">Đăng nhập</div>
                <div className="qsco-form">
                  <Fld label="Tên đăng nhập" req={!isEdit} hint={isEdit ? 'Không đổi được' : ''} bad={E.username}>
                    <input disabled={isEdit} value={username} onChange={e => setUsername(e.target.value)} placeholder="vd: nguyenvana" autoComplete="off" autoFocus={!isEdit} /></Fld>
                  {isEdit ? <Fld label="Mật khẩu" hint="Đổi bằng nút Đặt MK"><input disabled value="••••••" readOnly /></Fld> : (
                    <Fld label="Mật khẩu" req hint="Tối thiểu 4 ký tự" bad={E.pw}><PassInput value={pw} onChange={setPw} /></Fld>
                  )}
                  <Fld label="Email đăng nhập" bad={E.email || emailBad} wide>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="vd: nguyenvana@congty.vn" autoComplete="off" />
                    {emailBad ? <i className="qsa-f-warn">Email không hợp lệ</i>
                      : !emailOldBad && !emailNoLogin ? <i className="qsa-f-hint">Đăng nhập được bằng email này; để trống nếu không dùng.</i> : null}
                    {emailOldBad || emailNoLogin ? <i className="qsa-f-warn">{emailOldBad ? 'Email cũ chưa đúng dạng — để nguyên thì vẫn lưu được các mục khác; sửa lại để đăng nhập bằng email.'
                      : 'Email có ký tự * % hoặc \\ nên không dùng để đăng nhập được — đăng nhập bằng tên đăng nhập.'}</i> : null}
                  </Fld>
                </div>
              </div>
              <div className="qsco-grp">
                <div className="qsco-grp-t">Nhân viên</div>
                <div className="qsco-form">
                  <Fld label="Họ tên" req={!isEdit} bad={E.hoTen}><input value={hoTen} onChange={e => setHoTen(e.target.value)} placeholder="Nguyễn Văn A" /></Fld>
                  <Fld label="Phòng ban"><input value={phongBan} onChange={e => setPhongBan(e.target.value)} placeholder="vd: Kinh doanh, Thiết kế" /></Fld>
                  {isSuper ? (
                    <Fld label="Công ty" req={!isEdit} bad={E.ct} hint={isEdit && !u.congTyId ? '' : 'Mặc định: công ty đang làm việc'}>
                      <select value={ct} onChange={e => setCt(e.target.value)}>
                        {(companies || []).map(c => <option key={c.id} value={c.id}>{c.ten || c.ma}</option>)}
                        {mac ? null : <option value="">— Chọn công ty —</option>}
                      </select>
                      {isEdit && !u.congTyId ? <i className="qsa-f-warn">Tài khoản chưa thuộc công ty nào nên không đăng nhập được — chọn công ty rồi Lưu.</i> : null}
                    </Fld>
                  ) : null}
                  {hrEmps ? (
                    <Fld label="Hồ sơ nhân sự (HR)" hint="Cần gắn để dùng tab Nhân sự">
                      <select value={hrEmp} onChange={e => setHrEmp(e.target.value)}>
                        <option value="">— Chưa gắn —</option>
                        {hrEmps.map(e => <option key={e.id} value={e.id}>{e.code} · {e.name}{e.userId && e.userId !== u.id ? ' (đang gắn tài khoản khác)' : ''}</option>)}
                      </select>
                    </Fld>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          {tab === 'role' ? (
            isSup ? (
              <div className="qsa-seg qsa-um2-roles">
                <label className="qsa-seg-i on">
                  <input type="radio" name="qsa_role" value="super" checked readOnly />
                  <span><b>Siêu quản trị viên</b><i>Tài khoản can thiệp hệ thống: cấp tài khoản công ty, đặt mặc định toàn hệ thống. Không phải nhân viên, cũng không phải admin công ty.</i></span>
                </label>
              </div>
            ) : (
              <>
              <div className="qsa-seg qsa-um2-roles">
                <label className={`qsa-seg-i${role === 'staff' ? ' on' : ''}${roleLocked ? ' dis' : ''}`}>
                  <input type="radio" name="qsa_role" value="staff" checked={role === 'staff'} disabled={roleLocked} onChange={() => setRole('staff')} />
                  <span><b>Nhân viên</b><i>Chỉ vào được các mục được cấp. Chọn quyền ở bước Phân quyền.</i></span>
                </label>
                <label className={`qsa-seg-i${role === 'admin' ? ' on' : ''}${!isSuper && u.role !== 'admin' ? ' dis' : ''}`}
                  title={!isSuper && u.role !== 'admin' ? 'Chỉ quản trị hệ thống tạo được tài khoản quản trị công ty' : undefined}>
                  <input type="radio" name="qsa_role" value="admin" checked={role === 'admin'} disabled={!isSuper && u.role !== 'admin'} onChange={() => setRole('admin')} />
                  <span><b>Quản trị công ty</b><i>Toàn quyền trong công ty, tạo và phân quyền nhân viên. Chỉ quản trị hệ thống tạo được.</i></span>
                </label>
              </div>
              {isSuper && role === 'admin' ? (
                <label className={`qsco-sw qsa-um2-apr${apr ? ' on' : ''}`}>
                  <input type="checkbox" checked={apr} onChange={e => setApr(e.target.checked)} />
                  <span className="qsco-sw-b" />
                  <span className="qsco-sw-t"><b>Được duyệt sản phẩm và giao quyền duyệt cho nhân viên</b>
                    <i>Sản phẩm chưa duyệt không hiện trong Bóc tách. Tắt thì tài khoản này không duyệt được và không cấp được quyền “Được sửa và duyệt” cho nhân viên.</i></span>
                </label>
              ) : null}
              {!isSuper ? <p className="qsa-um2-note"><QsIcon name="lock" size={13} /> {roleLocked
                ? 'Bạn không tự đổi được vai trò của tài khoản đang đăng nhập.'
                : 'Admin công ty chỉ tạo và phân quyền được nhân viên. Tài khoản quản trị công ty do quản trị hệ thống tạo.'}</p> : null}
              </>
            )
          ) : null}

          {tab === 'pq' && pqStep ? (
            <>
              {pq.phase === 'error' || ctCeil.err ? (
                <div className="qsa-am-err">Không tải được phân quyền: {pq.err || ctCeil.err}
                  <button type="button" className="qsa-btn sm" onClick={() => setPqSeq(x => x + 1)}>Thử lại</button></div>
              ) : isSuper && !ct ? <div className="qsa-empty" style={{ padding: 20 }}>Chọn công ty ở bước Thông tin trước.</div>
                : !pqReady ? <div className="qsa-empty" style={{ padding: 20 }}>Đang tải…</div> : (
                  <AccessMatrix catalog={pq.cat} value={acc} onChange={setAcc} ceiling={ceiling}
                    fallback={role === 'staff' ? staffFallback : ceiling}
                    defaultText={role === 'staff'
                      ? 'Chưa đặt riêng: quyền theo các trang / tab đã cấp kiểu cũ (mỗi trang được cấp = mọi thao tác). Chọn "Tuỳ chỉnh" để cấp đến từng thao tác.'
                      : 'Chưa đặt riêng: quản trị có toàn bộ quyền trong trần của công ty. Chọn "Tuỳ chỉnh" để giới hạn.'} />
                )}
              {role === 'staff' ? (
                <div className="qsa-um2-subs">
                  <div className={`qsa-sub${spOn ? '' : ' dis'}`}>
                    <div className="qsa-sub-h">Trong tab Danh sách sản phẩm{spOn ? '' : ' (cần cấp tab này)'}</div>
                    {[['', 'Không giới hạn', 'Sửa thẳng, không cần duyệt'],
                      ['sp_edit', 'Chỉ được sửa', 'Sửa xong chuyển về “Chưa duyệt”'],
                      ['sp_duyet', 'Được sửa và duyệt', 'Sửa thẳng, đánh dấu “Đã duyệt”']].map(r => {
                      const noGrant = r[0] === 'sp_duyet' && !canGrantDuyet && !hadDuyet
                      return (
                        <label key={r[0]} className={`qsa-rd${lv === r[0] ? ' on' : ''}${noGrant ? ' dis' : ''}`}
                          title={noGrant ? 'Cần quản trị hệ thống giao quyền duyệt sản phẩm' : undefined}>
                          <input type="radio" name="qsa_splv" value={r[0]} checked={lv === r[0]} disabled={!spOn || noGrant} onChange={() => setLv(r[0])} />
                          <span><b>{r[1]}</b><i>{r[2]}</i>
                            {noGrant ? <i className="qsa-rd-warn"><QsIcon name="lock" size={11} /> Cần quản trị hệ thống giao quyền duyệt sản phẩm</i> : null}</span>
                        </label>
                      )
                    })}
                  </div>
                  <div className="qsa-sub">
                    <div className="qsa-sub-h">Dự án</div>
                    <label className={`qsa-ck${daDuyet ? ' on' : ''}`}>
                      <input type="checkbox" checked={daDuyet} onChange={e => setDaDuyet(e.target.checked)} />
                      Duyệt yêu cầu sửa thông tin dự án (sửa thẳng, nhận thông báo khi nhân viên gửi yêu cầu)
                    </label>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      </div>

      <div className="qsco-f-btn">
        <button type="button" className="qsa-btn ghost sm" onClick={onClose}>Huỷ</button>
        {!isEdit ? <span className="qsco-f-step">Bước {idx + 1} / {steps.length}</span> : null}
        <span className="qsco-f-sp" />
        {!isEdit && idx > 0 ? <button key="back" type="button" className="qsa-btn sm" onClick={() => goTo(idx - 1)}>Quay lại</button> : null}
        {!isEdit && !last
          ? <button key="next" type="button" className="qsa-btn blue" onClick={once(() => goTo(idx + 1))}>Tiếp tục</button>
          : (
            <button key="save" type="button" className="qsa-btn blue" disabled={busy} onClick={once(submit)}>
              {isEdit ? <><QsIcon name="check" size={15} /> Lưu thay đổi</> : <><QsIcon name="plus" size={15} /> Tạo tài khoản</>}
            </button>
          )}
      </div>
    </AdmDlg>
  )
}

function Fld({ label, req, hint, bad, wide, children }) {
  return (
    <div className={`qsco-f${wide ? ' wide' : ''}${bad ? ' bad' : ''}`}>
      <label><span>{label}{req ? <em className="qsco-req">*</em> : null}</span>{hint ? <i className="qsco-fhint">{hint}</i> : null}</label>
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
