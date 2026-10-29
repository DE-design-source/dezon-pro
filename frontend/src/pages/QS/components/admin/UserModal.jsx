import { useState } from 'react'
import * as api from '../../api/qsApi'
import { GRANT_TABS as PERM_TABS } from '../../state/store'
import { qsToast } from '../common/dialogs'
import QsIcon from '../common/QsIcon'
import { MrootPortal } from '../common/Mroot'
import './admin.css'

const EMAIL_RE = /^[^\s@]+@[^\s@]+$/   // như máy chủ (users.reEmail, M14.1)
const EMAIL_NOLOGIN_RE = /[*%\\]/     // đăng nhập chặn email có * % \ (auth reWildcard): lưu được nhưng không đăng nhập bằng nó
const normEmail = v => String(v || '').trim().toLowerCase()

/* Hộp Thêm / Sửa tài khoản (port admUserModal / admModalRole / admSubSync_ / admPermAll / admModalSave, PUB/admin.js:162-272).
   Props: user (null = tạo mới), isSuper, companies (S._admCt), defaultCt (công ty đang làm việc), onClose(), onSaved(msg).
   Như #admModal gốc: chỉ đóng bằng ✕ / Huỷ / bấm nền, không đóng bằng Esc để khỏi mất phần đã gõ. */
export default function UserModal({ user, isSuper, companies, defaultCt, onClose, onSaved }) {
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
  const [role, setRole] = useState(u.role !== 'admin' ? 'staff' : 'admin')
  const [perms, setPerms] = useState(() => PERM_TABS.filter(t => perms0.indexOf(t[0]) >= 0).map(t => t[0]))
  // Quyền trong tab Danh sách SP: CHỌN MỘT — chỉ sửa, hoặc sửa và duyệt
  const [lv, setLv] = useState(perms0.indexOf('sp_duyet') >= 0 ? 'sp_duyet' : (perms0.indexOf('sp_edit') >= 0 ? 'sp_edit' : ''))
  const [busy, setBusy] = useState(false)

  const has = k => perms.indexOf(k) >= 0
  // Sửa: email không đổi (bỏ qua hoa thường / khoảng trắng) thì không kiểm, không gửi - email cũ sai dạng vẫn sửa được trường khác
  const emailChanged = !isEdit || normEmail(email) !== normEmail(u.email)
  const emailBad = emailChanged && normEmail(email) !== '' && !EMAIL_RE.test(normEmail(email))
  const emailOldBad = !emailChanged && normEmail(email) !== '' && !EMAIL_RE.test(normEmail(email))
  const emailNoLogin = !emailBad && !emailOldBad && EMAIL_NOLOGIN_RE.test(normEmail(email))
  const togglePerm = (k, on) => setPerms(p => (on ? PERM_TABS.map(t => t[0]).filter(x => x === k || p.indexOf(x) >= 0) : p.filter(x => x !== k)))

  function save() {
    // quyền = các tab được tích + mức quyền trong tab Danh sách SP (radio, có thể bỏ trống)
    let ps = []
    if (role !== 'admin') {
      ps = perms.slice()
      if (lv && ps.indexOf('sanpham') >= 0) ps.push(lv)
    }
    // Email đăng nhập (M14.1): trim + chữ thường, rỗng = không có / xoá; máy chủ kiểm trùng trong công ty khi sửa
    const em = normEmail(email)
    if (emailBad) { qsToast('Email không hợp lệ'); return }
    setBusy(true)
    const done = msg => onSaved(msg)
    const fail = e => { qsToast('Lỗi: ' + e.message); setBusy(false) }
    if (isEdit) {
      const patch = { hoTen, role, perms: ps, phongBan }
      if (isSuper) patch.congTyId = ct
      // chuyển công ty mà giữ email: vẫn gửi để máy chủ kiểm trùng ở công ty mới (không kiểm lại dạng)
      if (emailChanged || (isSuper && em && String(ct || '') !== String(u.congTyId || ''))) patch.email = em
      api.adminUpdateUser(u.id, patch).then(() => done('Đã cập nhật'), fail)
    } else {
      api.adminCreateUser({ username, hoTen, email: em, role, password: pw, perms: ps, phongBan, congTyId: (isSuper && ct) || undefined })
        .then(() => done('Đã tạo tài khoản'), fail)
    }
  }

  return (
    <MrootPortal>
      <div className="qsa-aov" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="qsa-um" role="dialog" aria-modal="true">
          <div className="qsa-um-hd">
            <div>
              <h3>{isEdit ? 'Sửa tài khoản' : 'Thêm tài khoản'}</h3>
              <p>{isEdit ? 'Đổi họ tên, email, vai trò và quyền truy cập' : 'Tạo tài khoản mới cho công ty của bạn'}</p>
            </div>
            <span className="qsa-um-x" onClick={onClose}>✕</span>
          </div>
          <div className="qsa-um-bd">
            <div className="qsa-sec">
              <div className="qsa-sec-h">Thông tin đăng nhập</div>
              <div className="qsa-grid2">
                <div className="qsa-f"><label>Tên đăng nhập{isEdit ? '' : <> <em>*</em></>}</label>
                  <input disabled={isEdit} value={username} onChange={e => setUsername(e.target.value)} placeholder="vd: nguyenvana" autoComplete="off" /></div>
                <div className="qsa-f"><label>Họ tên</label>
                  <input value={hoTen} onChange={e => setHoTen(e.target.value)} placeholder="Nguyễn Văn A" /></div>
              </div>
              <div className="qsa-grid2">
                <div className="qsa-f"><label>Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="vd: nguyenvana@congty.vn" autoComplete="off" />
                  <i className={emailBad || emailOldBad || emailNoLogin ? 'qsa-f-warn' : 'qsa-f-hint'}>{emailBad ? 'Email không hợp lệ'
                    : emailOldBad ? 'Email cũ chưa đúng dạng — để nguyên thì vẫn lưu được các mục khác; sửa lại để đăng nhập bằng email.'
                    : emailNoLogin ? 'Email có ký tự * % hoặc \\ nên không dùng để đăng nhập được — đăng nhập bằng tên đăng nhập.'
                      : 'Đăng nhập được bằng email này. Để trống nếu không dùng.'}</i></div>
                <div className="qsa-f"><label>Phòng ban</label>
                  <input value={phongBan} onChange={e => setPhongBan(e.target.value)} placeholder="vd: Kinh doanh, Thiết kế, Mua hàng" /></div>
              </div>
              {isEdit ? null : (
                <div className="qsa-grid2">
                  <div className="qsa-f"><label>Mật khẩu <em>*</em></label>
                    <input type="text" value={pw} onChange={e => setPw(e.target.value)} placeholder="Tối thiểu 4 ký tự" autoComplete="new-password" /></div>
                  <div className="qsa-f" />
                </div>
              )}
              {isSuper ? (
                <div className="qsa-grid2">
                  <div className="qsa-f"><label>Công ty</label>
                    <select value={ct} onChange={e => setCt(e.target.value)}>
                      {(companies || []).map(c => <option key={c.id} value={c.id}>{c.ten || c.ma}</option>)}
                      {mac ? null : <option value="">— Chọn công ty —</option>}
                    </select>
                    {isEdit && !u.congTyId
                      ? <i className="qsa-f-warn">Tài khoản này chưa thuộc công ty nào nên không đăng nhập được — chọn công ty rồi Lưu.</i>
                      : <i className="qsa-f-hint">Mặc định là công ty bạn đang làm việc. Đổi nếu muốn tạo cho công ty khác.</i>}
                  </div>
                  <div className="qsa-f" />
                </div>
              ) : null}
            </div>
            <div className="qsa-sec">
              <div className="qsa-sec-h">Vai trò</div>
              <div className="qsa-seg">
                <label className={`qsa-seg-i${role === 'staff' ? ' on' : ''}`}>
                  <input type="radio" name="qsa_role" value="staff" checked={role === 'staff'} onChange={() => setRole('staff')} />
                  <span><b>Nhân viên</b><i>Chỉ vào được các mục được cấp</i></span>
                </label>
                <label className={`qsa-seg-i${role === 'admin' ? ' on' : ''}`}>
                  <input type="radio" name="qsa_role" value="admin" checked={role === 'admin'} onChange={() => setRole('admin')} />
                  <span><b>Quản trị công ty</b><i>Toàn quyền trong công ty</i></span>
                </label>
              </div>
            </div>
            {/* Ẩn khối quyền khi chọn Quản trị công ty (đã toàn quyền) */}
            {role === 'admin' ? null : (
              <div className="qsa-sec">
                <div className="qsa-sec-h">Quyền truy cập
                  <span className="qsa-sec-n">{perms.length}/{PERM_TABS.length}</span>
                  <span className="qsa-sec-quick">
                    <a onClick={() => setPerms(PERM_TABS.map(t => t[0]))}>Chọn tất cả</a>
                    <a onClick={() => setPerms([])}>Bỏ hết</a>
                  </span>
                </div>
                <div className="qsa-perms">
                  {PERM_TABS.map(t => (
                    <label key={t[0]} className={`qsa-ck${has(t[0]) ? ' on' : ''}`}>
                      <input type="checkbox" value={t[0]} checked={has(t[0])} onChange={e => togglePerm(t[0], e.target.checked)} />{t[1]}
                    </label>
                  ))}
                </div>
                {/* Khối quyền con chỉ hiện khi đã cấp tab Danh sách sản phẩm */}
                {has('sanpham') ? (
                  <div className="qsa-sub">
                    <div className="qsa-sub-h">Trong tab Danh sách sản phẩm</div>
                    {[['', 'Không giới hạn', 'Sửa thẳng, không cần duyệt (mặc định như trước)'],
                      ['sp_edit', 'Chỉ được sửa', 'Sửa xong sản phẩm chuyển về “Chưa duyệt”'],
                      ['sp_duyet', 'Được sửa và duyệt', 'Sửa thẳng và đánh dấu “Đã duyệt”']].map(r => (
                      <label key={r[0]} className={`qsa-rd${lv === r[0] ? ' on' : ''}`}>
                        <input type="radio" name="qsa_splv" value={r[0]} checked={lv === r[0]} onChange={() => setLv(r[0])} />
                        <span><b>{r[1]}</b><i>{r[2]}</i></span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>
          <div className="qsa-um-ft">
            <button type="button" className="qsa-btn ghost" onClick={onClose}>Huỷ</button>
            <button type="button" className="qsa-btn blue" disabled={busy} onClick={save}>
              {isEdit ? <><QsIcon name="check" size={15} /> Lưu thay đổi</> : <><QsIcon name="plus" size={15} /> Tạo tài khoản</>}
            </button>
          </div>
        </div>
      </div>
    </MrootPortal>
  )
}
