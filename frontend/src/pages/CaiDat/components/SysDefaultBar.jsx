import { useState } from 'react'
import { useQsSession } from '../../QS/session/QsSession'
import { saveSysDefault, sysSection, useSysDefaults } from '../../../services/systemDefaultsService'

/* Thanh của Siêu quản trị viên ở đầu mục Cài đặt (N17): lấy cài đặt ĐANG HIỆU LỰC của chính tài khoản super làm
   mặc định toàn hệ thống cho mọi người dùng chưa tự chỉnh, hoặc bỏ mặc định. Người khác không thấy thanh này.
   Props: section ('appearance' | 'general' | 'display'), getValue() -> object, what (tên nhóm cài đặt hiển thị) */
const SEC_LBL = { appearance: 'Giao diện', general: 'Cài đặt chung (Chung, Quyền riêng tư, Hiệu suất, Thông báo, Phím tắt, Lịch, Nhiệm vụ)', display: 'Hiển thị menu' }
function fmt(s) {
  const d = s ? new Date(s) : null
  return d && !isNaN(d) ? d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : ''
}

export default function SysDefaultBar({ section, getValue, what }) {
  const { isSuper } = useQsSession()
  const sys = useSysDefaults()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)   // {ok, text}
  if (!isSuper) return null
  const has = !!sysSection(section, sys)

  async function run(value) {
    setBusy(true); setMsg(null)
    try {
      await saveSysDefault(section, value)
      setMsg({ ok: true, text: value ? 'Đã lưu làm mặc định toàn hệ thống' : 'Đã bỏ mặc định hệ thống' })
    } catch (e) {
      setMsg({ ok: false, text: 'Lỗi: ' + ((e && e.message) || e) })
    } finally { setBusy(false) }
  }

  const btn = { border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 12px', padding: '10px 14px', border: '1px dashed var(--primary)', borderRadius: 12, background: 'var(--primary-tint)' }}>
      <div style={{ flex: '1 1 260px', minWidth: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        <b style={{ color: 'var(--primary)' }}>Siêu quản trị viên</b> · {what || SEC_LBL[section]}: lưu cài đặt bạn đang dùng làm mặc định cho mọi người dùng chưa tự chỉnh.
        {has
          ? <> Đang có mặc định{sys.updatedBy ? ' (lần lưu gần nhất của hệ thống: ' + sys.updatedBy + (sys.updatedAt ? ', ' + fmt(sys.updatedAt) : '') + ')' : ''}.</>
          : ' Chưa đặt mặc định.'}
        {msg ? <span style={{ marginLeft: 6, fontWeight: 600, color: msg.ok ? 'var(--success)' : 'var(--danger)' }}>{msg.text}</span> : null}
      </div>
      <button type="button" disabled={busy} onClick={() => run(getValue())}
        style={{ ...btn, border: 'none', background: 'var(--primary)', color: '#fff' }}>Lưu làm mặc định toàn hệ thống</button>
      {has ? <button type="button" disabled={busy} onClick={() => run(null)} style={btn}>Bỏ mặc định</button> : null}
    </div>
  )
}
