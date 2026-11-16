import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as api from '../../api/qsApi'
import * as hrApi from '../../../ChamCong/api'
import { qsToast } from '../common/dialogs'
import { MrootPortal } from '../common/Mroot'
import './admin.css'

/* Bổ nhiệm 1 tài khoản vào cơ cấu tổ chức (Cài đặt > Admin, MarkUp 2026-11-12 16:53): chọn phòng ban / đơn vị trong cơ cấu HR,
   chức danh, quản lý trực tiếp, có làm trưởng đơn vị không. Lưu thẳng vào HR (dùng chung dữ liệu với trang Nhân sự > Cơ cấu tổ chức):
   - tài khoản đã gắn hồ sơ nhân sự -> sửa hồ sơ đó (POST /hr/org: employees + units.headId trong 1 transaction);
   - chưa gắn -> gắn 1 hồ sơ có sẵn (chưa gắn tài khoản) hoặc tạo hồ sơ mới (mã NVxxx tiếp theo), rồi gắn (POST /hr/security/user).
   Tên phòng ban của tài khoản (users.phongBan) đổi theo đơn vị đã chọn.
   Props: user, onClose(), onSaved(msg). */
const TYPE_LB = { governance: 'Quản trị', board: 'Ban', exec: 'Điều hành', dept: 'Phòng ban', subsidiary: 'Công ty con' }
const nextCode = emps => 'NV' + String(Math.max(0, ...emps.map(e => (/^NV(\d+)$/.exec(e.code || '') || [])[1] || 0).map(Number)) + 1).padStart(3, '0')

/* Đơn vị theo thứ tự cây (cha trước con), kèm độ sâu để thụt lề trong ô chọn */
function unitTree(units) {
  const kids = {}
  const keys = new Set(units.map(u => u.key))
  units.forEach(u => { const p = keys.has(u.parent) ? u.parent : ''; (kids[p] = kids[p] || []).push(u) })
  const out = []
  const walk = (p, d) => (kids[p] || []).forEach(u => { out.push({ ...u, depth: d }); walk(u.key, d + 1) })
  walk('', 0)
  return out
}

export default function AppointModal({ user, onClose, onSaved }) {
  const nav = useNavigate()
  const [hr, setHr] = useState(null)        // {units, heads, employees} | null
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('new')   // new | link (khi tài khoản chưa gắn hồ sơ)
  const [linkId, setLinkId] = useState('')
  const [dept, setDept] = useState('')
  const [position, setPosition] = useState('')
  const [managerId, setManagerId] = useState('')
  const [isHead, setIsHead] = useState(false)

  useEffect(() => {
    let off = false
    hrApi.load().then(st => {
      if (off) return
      setHr(st)
      const me = (st.employees || []).find(e => e.userId === user.id)
      if (me) {
        setDept(me.dept || ''); setPosition(me.position || ''); setManagerId(me.managerId != null ? String(me.managerId) : '')
        setIsHead(!!me.dept && st.heads && String(st.heads[me.dept]) === String(me.id))
      }
    }, e => { if (!off) setErr(e.message || 'Không tải được cơ cấu tổ chức') })
    return () => { off = true }
  }, [user.id])

  const emps = (hr && hr.employees) || []
  const mine = emps.find(e => e.userId === user.id) || null
  const linked = mine || (mode === 'link' && linkId ? emps.find(e => String(e.id) === linkId) : null)
  const tree = useMemo(() => unitTree((hr && hr.units) || []), [hr])
  const unit = tree.find(u => u.key === dept) || null
  const headOf = k => (hr && hr.heads && hr.heads[k] != null ? emps.find(e => String(e.id) === String(hr.heads[k])) : null)
  const curHead = dept ? headOf(dept) : null
  const freeEmps = emps.filter(e => !e.userId && e.status !== 'left')
  const selfId = linked ? linked.id : null
  const mgrOpts = emps.filter(e => e.status !== 'left' && e.id !== selfId)
  const posSugg = [...new Set(emps.filter(e => e.dept === dept && e.position).map(e => e.position))]

  /* Đổi đơn vị: quản lý trực tiếp mặc định = trưởng đơn vị đó (nếu không phải chính mình) */
  function pickDept(k) {
    setDept(k)
    const h = headOf(k)
    setManagerId(h && h.id !== selfId ? String(h.id) : '')
    setIsHead(!!(h && selfId != null && h.id === selfId))
  }
  /* Chọn hồ sơ có sẵn để gắn: lấy luôn đơn vị / chức danh / quản lý của hồ sơ đó */
  function pickLink(id) {
    setLinkId(id)
    const e = emps.find(x => String(x.id) === id)
    if (e) { setDept(e.dept || ''); setPosition(e.position || ''); setManagerId(e.managerId != null ? String(e.managerId) : '') }
  }

  async function save() {
    if (!dept) { setErr('Chọn phòng ban / đơn vị'); return }
    if (!mine && mode === 'link' && !linkId) { setErr('Chọn hồ sơ nhân sự để gắn'); return }
    setBusy(true); setErr('')
    try {
      const mgr = managerId ? Number(managerId) : null
      let empId = linked ? linked.id : null
      if (!empId) {
        const r = await hrApi.createEmployee({ code: nextCode(emps), name: (user.hoTen || user.username || '').trim(), dept, position: position.trim(),
          managerId: mgr, status: 'active', email: user.email || '' })
        empId = r.id
      }
      const ops = { employees: [{ id: empId, dept, position: position.trim(), managerId: mgr }] }
      if (isHead) ops.units = [{ key: dept, headId: empId }]
      else if (curHead && curHead.id === empId) ops.units = [{ key: dept, headId: null }]   // bỏ tích = thôi làm trưởng đơn vị
      await hrApi.saveOrg(ops)
      if (!mine) await hrApi.setUserRole({ empId, userId: user.id })
      if (unit && (user.phongBan || '') !== (unit.name || unit.label)) await api.adminUpdateUser(user.id, { phongBan: unit.name || unit.label })
      onSaved('Đã bổ nhiệm ' + (user.hoTen || user.username) + ' vào ' + (unit ? unit.name || unit.label : dept) + (position.trim() ? ' · ' + position.trim() : ''))
    } catch (e) {
      setErr(e.message || 'Không lưu được'); setBusy(false)
    }
  }

  return (
    <MrootPortal>
      <div className="qsa-aov" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="qsa-um qsa-apt" role="dialog" aria-modal="true">
          <div className="qsa-um-hd">
            <div>
              <h3>Bổ nhiệm vào cơ cấu tổ chức</h3>
              <p>{user.hoTen || user.username} · {user.username} — lưu vào hồ sơ nhân sự (HR), hiện ngay ở Nhân sự &gt; Cơ cấu tổ chức</p>
            </div>
            <span className="qsa-um-x" onClick={onClose}>✕</span>
          </div>
          <div className="qsa-um-bd">
            {!hr && !err && <div className="qsa-empty">Đang tải cơ cấu tổ chức…</div>}
            {err && <div className="qsa-warn"><span className="qsa-warn-ic">!</span><span>{err}</span></div>}
            {hr && (
              <>
                <div className="qsa-sec">
                  <div className="qsa-sec-h">Hồ sơ nhân sự</div>
                  {mine ? (
                    <div className="qsa-apt-emp"><b>{mine.code}</b> · {mine.name}<span className="qsa-muted"> — đang gắn với tài khoản này</span></div>
                  ) : (
                    <>
                      <div className="qsa-apt-mode">
                        <label className={`qsa-ck${mode === 'new' ? ' on' : ''}`}><input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />Tạo hồ sơ mới ({nextCode(emps)} · {user.hoTen || user.username})</label>
                        <label className={`qsa-ck${mode === 'link' ? ' on' : ''}`}><input type="radio" checked={mode === 'link'} onChange={() => setMode('link')} disabled={!freeEmps.length} />Gắn hồ sơ có sẵn{freeEmps.length ? '' : ' (không còn hồ sơ chưa gắn)'}</label>
                      </div>
                      {mode === 'link' && (
                        <div className="qsa-f"><label>Hồ sơ chưa gắn tài khoản</label>
                          <select value={linkId} onChange={e => pickLink(e.target.value)}>
                            <option value="">— Chọn hồ sơ —</option>
                            {freeEmps.map(e => <option key={e.id} value={e.id}>{e.code} · {e.name}{e.position ? ' · ' + e.position : ''}</option>)}
                          </select></div>
                      )}
                    </>
                  )}
                </div>
                <div className="qsa-sec">
                  <div className="qsa-sec-h">Vị trí</div>
                  <div className="qsa-grid2">
                    <div className="qsa-f"><label>Phòng ban / đơn vị <em>*</em></label>
                      <select value={dept} onChange={e => pickDept(e.target.value)}>
                        <option value="">— Chọn đơn vị —</option>
                        {tree.map(u => <option key={u.key} value={u.key}>{'  '.repeat(u.depth) + (u.depth ? '└ ' : '') + (u.name || u.label)} ({TYPE_LB[u.type] || u.type})</option>)}
                      </select>
                      <i className="qsa-f-hint">{tree.length ? 'Danh sách đơn vị lấy từ Nhân sự > Cơ cấu tổ chức' : 'Chưa có đơn vị nào - tạo ở Nhân sự > Cơ cấu tổ chức'}</i></div>
                    <div className="qsa-f"><label>Chức danh</label>
                      <input value={position} onChange={e => setPosition(e.target.value)} list="qsa-apt-pos" placeholder="vd: Trưởng phòng, Nhân viên mua hàng" />
                      <datalist id="qsa-apt-pos">{posSugg.map(p => <option key={p} value={p} />)}</datalist></div>
                  </div>
                  <div className="qsa-grid2">
                    <div className="qsa-f"><label>Quản lý trực tiếp</label>
                      <select value={managerId} onChange={e => setManagerId(e.target.value)}>
                        <option value="">— Không có —</option>
                        {mgrOpts.map(e => <option key={e.id} value={e.id}>{e.name}{e.position ? ' · ' + e.position : ''}{curHead && curHead.id === e.id ? ' (trưởng đơn vị)' : ''}</option>)}
                      </select></div>
                    <div className="qsa-f"><label>Trưởng đơn vị</label>
                      <label className={`qsa-ck${isHead ? ' on' : ''}`}><input type="checkbox" checked={isHead} disabled={!dept} onChange={e => setIsHead(e.target.checked)} />Bổ nhiệm làm trưởng {unit ? unit.name || unit.label : 'đơn vị'}</label>
                      <i className="qsa-f-hint">{curHead && (!linked || curHead.id !== linked.id) ? 'Hiện tại: ' + curHead.name + (isHead ? ' — sẽ được thay' : '') : 'Đơn vị chưa có trưởng'}</i></div>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="qsa-um-ft">
            <button type="button" className="qsa-btn ghost sm" onClick={() => { onClose(); nav('/cham-cong#org') }}>Mở Cơ cấu tổ chức (HR) ›</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="qsa-btn ghost sm" onClick={onClose}>Huỷ</button>
            <button type="button" className="qsa-btn blue sm" disabled={busy || !hr} onClick={save}>{busy ? 'Đang lưu…' : 'Bổ nhiệm'}</button>
          </div>
        </div>
      </div>
    </MrootPortal>
  )
}
