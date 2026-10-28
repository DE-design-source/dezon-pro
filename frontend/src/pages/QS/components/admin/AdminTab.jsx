import { useEffect, useRef, useState } from 'react'
import * as api from '../../api/qsApi'
import { isAbort } from '../../api/http'
import { money } from '../../lib/format'
import { useQs } from '../../state/QsData'
import { useQsSession } from '../../session/QsSession'
import { GRANT_TABS as PERM_TABS, refreshNotifCount, setCongTyLocal } from '../../state/store'
import { qsToast, qsConfirm, qsAsk } from '../common/dialogs'
import QsIcon from '../common/QsIcon'
import UserModal from './UserModal'
import CompanyCard from './CompanyCard'
import PurDetail from './PurDetail'
import DxDetail from './DxDetail'
import {
  admActionLabel_, fmtDateTime_, PUR_CLS, DRQ_LBL, ROLE_LBL, DX_TEN_, DX_ICO_, dxStatusCls_, LY_DO_MAX,
} from './adminUtil'
import './admin.css'

/* Tab Admin — tài khoản trong công ty, phân quyền, duyệt yêu cầu xoá SP / đơn mua hàng / đề xuất, nhật ký.
   Port PUB/admin.js (renderAdmin 5-15, admStats_ 16-26, rqItem_ 27-34, admUsersCard_ 37-64, admPurCard_ 114-133,
   admReqCard_/drqResolve 134-155, admLogCard_ 156-159, admResetPw/admToggleActive/admDelete 273-278)
   + admDxCard_/dxResolve PUB/muahang.js:359-391.
   Tải lại TOÀN BỘ danh sách mỗi lần tab được mở (visibleSeq), như renderAdmin.
   Ý định điều hướng (từ thông báo): {purDetail: maDon} mở chi tiết đơn; {highlightDrq: id} làm nổi yêu cầu xoá;
   {dxDetail: ma} mở chi tiết phiếu đề xuất (M13.1). */
export default function AdminTab() {
  const { visibleSeq, panelVisible, consumeIntent, reloadProducts, congTy } = useQsData()
  const { me, isAdmin, isSuper, viewAs } = useQsSession()
  const seq = visibleSeq('admin')
  const vis = panelVisible('admin')
  const [st, setSt] = useState({ phase: 'idle', err: '', d: null })
  const [reloadN, setReloadN] = useState(0)
  const [userDlg, setUserDlg] = useState(null)   // {user} | null
  const [purCode, setPurCode] = useState('')
  const [dxMa, setDxMa] = useState('')
  const pendingHl = useRef(null)
  const bodyRef = useRef(null)

  useEffect(() => {
    if (!vis || !isAdmin) return undefined
    // StrictMode chạy effect 2 lần: ý định đọc 1 lần vào ref để lần chạy sau vẫn còn
    const it = consumeIntent('admin')
    if (it && it.purDetail) setPurCode(String(it.purDetail))
    if (it && it.dxDetail) setDxMa(String(it.dxDetail))
    if (it && it.highlightDrq != null) pendingHl.current = String(it.highlightDrq)
    const ac = new AbortController()
    const sig = ac.signal
    setSt(s => ({ ...s, phase: 'loading', err: '' }))
    ;(async () => {
      const [users, reqs, purs, logs] = await Promise.all([
        api.adminListUsers(sig), api.listDeleteRequests(sig), api.listPurchaseRequests(sig), api.getAuditLog(120, sig),
      ])
      let dxs = []
      // giữ cách bản gốc (admin.js:11-12): lỗi đề xuất / công ty không chặn cả trang, nhưng phải báo rõ
      try { dxs = (await api.listDeXuat(undefined, sig)) || [] } catch (e) { if (isAbort(e)) throw e; dxs = []; if (!sig.aborted) qsToast('Lỗi tải đề xuất: ' + e.message) }
      let cts = []
      if (isSuper) { try { cts = (await api.listCongTy(sig)) || [] } catch (e) { if (isAbort(e)) throw e; cts = []; if (!sig.aborted) qsToast('Lỗi tải danh sách công ty: ' + e.message) } }
      return { users: users || [], reqs: reqs || [], purs: purs || [], logs: logs || [], dxs, cts }
    })().then(d => {
      if (sig.aborted) return
      setSt({ phase: 'ready', err: '', d })
    }, e => {
      if (isAbort(e) || sig.aborted) return
      setSt({ phase: 'error', err: e.message, d: null })
    })
    return () => ac.abort()
  }, [seq, reloadN, isAdmin])   // eslint-disable-line react-hooks/exhaustive-deps

  /* Thông báo yêu cầu xoá: cuộn tới và nháy sáng đúng thẻ (notifHighlight_, PUB/app.js:56-60) */
  useEffect(() => {
    if (st.phase !== 'ready' || pendingHl.current == null || !bodyRef.current) return undefined
    const id = pendingHl.current
    pendingHl.current = null
    const el = bodyRef.current.querySelector('[data-drq="' + CSS.escape(id) + '"]') || bodyRef.current.querySelector('[data-card="drq"]')
    if (!el) return undefined
    el.scrollIntoView({ block: 'center' })
    el.classList.add('qsa-flash')
    const t = setTimeout(() => el.classList.remove('qsa-flash'), 1800)
    return () => { clearTimeout(t); el.classList.remove('qsa-flash') }
  }, [st])

  const reload = () => setReloadN(n => n + 1)

  /* Thẻ Thông tin công ty (M17.1): admin sửa công ty của phiên; super chỉ khi đang xem một công ty, bản lấy từ listCongTy */
  const coEdit = !isAdmin ? null
    : isSuper ? ((st.d && viewAs && st.d.cts.filter(x => String(x.id) === String(viewAs))[0]) || null)
      : (congTy && me && congTy.id === me.congTyId ? congTy : null)
  function coSaved(r) {
    // chỉ công ty của chính người dùng mới được áp vào phiên (màu / logo / tên trên thanh trên đổi ngay)
    if (r && me && me.congTyId && String(me.congTyId) === String(r.id)) setCongTyLocal(r)
    if (isSuper) reload()   // super: nạp lại listCongTy, không đổi S.congTy
  }

  if (!isAdmin) {
    return (
      <div className="qsa-root">
        <div className="qsa-hd"><h2>Quản trị</h2></div>
        <div className="qsa-empty">Bạn không có quyền truy cập.</div>
      </div>
    )
  }

  /* ---- hành động (port nguyên văn thông điệp của bản gốc) ---- */
  async function purResolve(maDon, approve) {
    if (!approve && !await qsConfirm('Từ chối đơn mua hàng ' + maDon + '?')) return
    api.resolvePurchaseRequest(maDon, approve).then(() => {
      qsToast(approve ? 'Đã duyệt đơn ' + maDon : 'Đã từ chối đơn ' + maDon); reload(); refreshNotifCount()
    }, e => qsToast('Lỗi: ' + e.message))
  }
  async function drqResolve(id, approve) {
    let lyDo = ''
    if (!approve) {
      // M15.2: hỏi lý do từ chối (tuỳ chọn) thay cho hộp xác nhận; Huỷ = không từ chối; quá dài thì mở lại hộp với nội dung đã gõ
      for (;;) {
        lyDo = await qsAsk({
          title: 'Từ chối yêu cầu xóa này?', note: 'Lý do (nếu có, tối đa ' + LY_DO_MAX + ' ký tự) được gửi kèm thông báo cho người yêu cầu.',
          label: 'Lý do từ chối (tuỳ chọn)', value: lyDo, placeholder: 'VD: sản phẩm vẫn đang dùng trong dự án', required: false, confirmText: 'Từ chối',
        })
        if (lyDo == null) return
        if ([...lyDo].length <= LY_DO_MAX) break
        qsToast('Lý do tối đa ' + LY_DO_MAX + ' ký tự (đang có ' + [...lyDo].length + ')')
      }
    }
    api.resolveDeleteRequest(id, approve, lyDo).then(r => {
      qsToast(approve ? ('Đã duyệt & xóa ' + ((r && r.deleted) || 0) + ' sản phẩm' + (r && r.loi ? (' — có sản phẩm không xoá được: ' + r.loi) : '')) : 'Đã từ chối yêu cầu')
      reload(); refreshNotifCount()
      if (approve) reloadProducts().catch(e => qsToast('Lỗi tải lại danh sách sản phẩm: ' + e.message))
    }, e => qsToast('Lỗi: ' + e.message))
  }
  async function dxResolve(ma, approve) {
    if (!approve && !await qsConfirm('Từ chối phiếu ' + ma + '?')) return
    api.resolveDeXuat(ma, approve).then(() => {
      qsToast(approve ? ('Đã duyệt phiếu ' + ma) : ('Đã từ chối phiếu ' + ma)); reload(); refreshNotifCount()
    }, e => qsToast('Lỗi: ' + e.message))
  }
  async function admResetPw(id) {
    const np = await qsAsk({ title: 'Đặt lại mật khẩu', label: 'Mật khẩu mới (≥4 ký tự)', type: 'password', confirmText: 'Đặt lại' })
    if (!np) return
    if (String(np).length < 4) { qsToast('Mật khẩu phải từ 4 ký tự'); return }
    api.adminSetPassword(id, np).then(() => qsToast('Đã đặt lại mật khẩu'), e => qsToast('Lỗi: ' + e.message))
  }
  function admToggleActive(id, active) {
    api.adminSetActive(id, active).then(() => { qsToast(active ? 'Đã mở khóa' : 'Đã khóa'); reload() }, e => qsToast('Lỗi: ' + e.message))
  }
  async function admDelete(u) {
    if (!await qsConfirm('Xóa tài khoản "' + (u ? u.username : '') + '"? Không thể hoàn tác.')) return
    api.adminDeleteUser(u.id).then(() => { qsToast('Đã xóa'); reload() }, e => qsToast('Lỗi: ' + e.message))
  }

  const d = st.d
  let body
  if (st.phase === 'error') {
    body = <div className="qsa-empty">Lỗi tải: {st.err}</div>
  } else if (st.phase !== 'ready' || !d) {
    body = <div className="qsa-empty">Đang tải…</div>
  } else {
    body = (
      <>
        <Stats d={d} />
        {coEdit ? (
          <CompanyCard c={coEdit} onSaved={coSaved}
            note={isSuper ? 'Đang sửa công ty bạn đang xem. Màu và logo áp cho người dùng của công ty này khi họ tải lại trang.' : ''} />
        ) : null}
        <UsersCard users={d.users} isSuper={isSuper} cts={d.cts}
          onCreate={() => setUserDlg({ user: null })} onEdit={u => setUserDlg({ user: u })}
          onResetPw={admResetPw} onToggle={admToggleActive} onDelete={admDelete} />
        <ReqCard reqs={d.reqs} onResolve={drqResolve} />
        <PurCard purs={d.purs} onOpen={setPurCode} onResolve={purResolve} />
        <DxCard dxs={d.dxs} onOpen={setDxMa} onResolve={dxResolve} />
        <LogCard logs={d.logs} />
      </>
    )
  }

  const defaultCt = (congTy && congTy.id) || (me && me.congTyId) || ''
  return (
    <div className="qsa-root" ref={bodyRef}>
      <div className="qsa-hd"><h2>Quản trị — Tài khoản &amp; phân quyền</h2></div>
      {body}
      {userDlg ? (
        <UserModal user={userDlg.user} isSuper={isSuper} companies={d ? d.cts : []} defaultCt={defaultCt}
          onClose={() => setUserDlg(null)} onSaved={msg => { qsToast(msg); setUserDlg(null); reload() }} />
      ) : null}
      {purCode ? <PurDetail code={purCode} onClose={() => setPurCode('')} onResolve={purResolve} /> : null}
      {dxMa ? <DxDetail ma={dxMa} onClose={() => setDxMa('')} onResolve={dxResolve} /> : null}
    </div>
  )
}

/* useQs() + congTy của phiên (không nằm trong hợp đồng useQs) */
function useQsData() {
  const q = useQs()
  const s = useQsSession()
  return { ...q, congTy: s.congTy }
}

function Stats({ d }) {
  const pendDel = d.reqs.filter(r => r.status === 'pending').length
  const pendPur = d.purs.filter(r => r.status === 'Chờ duyệt').length
  const pendDx = d.dxs.filter(r => r.status === 'Chờ duyệt').length
  const tile = (ic, val, label, warn) => (
    <div className={`qsa-stat${warn && val ? ' warn' : ''}`}>
      <span className="qsa-stat-ic"><QsIcon name={ic} size={18} /></span>
      <div><div className="qsa-stat-v">{val}</div><div className="qsa-stat-l">{label}</div></div>
    </div>
  )
  return (
    <div className="qsa-stats">
      {tile('lock', d.users.length, 'Tài khoản', false)}
      {tile('trash', pendDel, 'Yêu cầu xóa chờ duyệt', true)}
      {tile('cart', pendPur, 'Đơn mua hàng chờ duyệt', true)}
      {tile('gauge', pendDx, 'Đề xuất chờ duyệt', true)}
    </div>
  )
}

/* Thẻ .dbcard (dbCard_, PUB/nhap.js:456-459) */
function Card({ title, icon, note, badge, hint, card, bodyCls = '', children }) {
  return (
    <div className="qsa-card" data-card={card}>
      <div className="qsa-card-h">
        <span className="qsa-card-ic"><QsIcon name={icon} size={18} /></span>
        <h3>{title}</h3>
        {hint ? <span className="qsa-hint">{hint}</span> : null}
        {badge ? <span className="qsa-pend">{badge} chờ duyệt</span> : null}
      </div>
      <div className={`qsa-card-b${bodyCls ? ' ' + bodyCls : ''}`}>
        {note ? <p className="qsa-note">{note}</p> : null}
        {children}
      </div>
    </div>
  )
}

/* Một dòng yêu cầu (rqItem_, PUB/admin.js:27-34) */
function RqItem({ cls, clickable, drq, icon, title, meta, badgeCls, badgeText, actions, time, onClick }) {
  return (
    <div className={`qsa-rq ${cls}${clickable ? ' clickable' : ''}`} data-drq={drq} onClick={onClick}>
      <span className={`qsa-rq-ic ${cls}`}><QsIcon name={icon} size={16} /></span>
      <div className="qsa-rq-main">
        <div className="qsa-rq-title">{title}</div>
        {meta ? <div className="qsa-rq-meta">{meta}</div> : null}
      </div>
      <div className="qsa-rq-side">
        <span className={`qsa-badge ${badgeCls}`}>{badgeText}</span>
        {actions ? <div className="qsa-rq-act">{actions}</div> : null}
        <span className="qsa-rq-time">{time}</span>
      </div>
    </div>
  )
}

function UsersCard({ users, isSuper, cts, onCreate, onEdit, onResetPw, onToggle, onDelete }) {
  const lbl = {}
  PERM_TABS.forEach(t => { lbl[t[0]] = t[1] })
  const ctTen = id => { const c = (cts || []).filter(x => x.id === id)[0]; return c ? (c.ten || c.ma || id) : '(công ty đã xoá)' }
  const permCell = u => {
    if (u.role === 'admin' || u.role === 'super') return <span className="qsa-muted">Toàn quyền</span>
    const p = u.perms || []
    if (!p.length) return <span className="qsa-st-lk">Chưa cấp</span>
    return p.map((k, i) => <span key={i}>{i ? ' ' : ''}<span className="qsa-permchip">{lbl[k] || k}</span></span>)
  }
  const noCt = users.filter(u => !u.congTyId).length
  return (
    <Card title={'Tài khoản (' + users.length + ')'} icon="lock" note="Admin toàn quyền · Nhân viên không mở được trang này.">
      <div style={{ marginBottom: 12 }}>
        <button type="button" className="qsa-btn blue sm" onClick={onCreate}><QsIcon name="plus" size={14} /> Thêm tài khoản</button>
      </div>
      {isSuper && noCt ? (
        <div className="qsa-warn"><span className="qsa-warn-ic">!</span>
          <span>Có <b>{noCt}</b> tài khoản chưa gán công ty. Tài khoản kiểu này không đăng nhập được và không hiện trong danh sách của công ty nào — bấm <b>Sửa</b> để gán công ty hoặc xoá đi.</span>
        </div>
      ) : null}
      <div className="qsa-tblwrap">
        <table className="qsa-tbl">
          <thead><tr>
            <th>Tên đăng nhập</th><th>Họ tên</th><th>Vai trò</th><th>Quyền truy cập</th>
            {isSuper ? <th>Công ty</th> : null}<th>Trạng thái</th><th>Đăng nhập gần nhất</th><th />
          </tr></thead>
          <tbody>
            {users.map(u => {
              const av = (u.hoTen || u.username || '?').trim().charAt(0).toUpperCase()
              return (
                <tr key={u.id} className={u.active ? '' : 'locked'}>
                  <td><span className={`qsa-uav${u.role !== 'staff' ? ' adm' : ''}`}>{av}</span><b>{u.username}</b>
                    {u.email ? <span className="qsa-mail">{u.email}</span> : null}</td>
                  <td>{u.hoTen || ''}</td>
                  <td><span className={`qsa-role ${u.role === 'super' ? 'sup' : (u.role === 'admin' ? 'adm' : 'stf')}`}>{ROLE_LBL[u.role] || u.role}</span></td>
                  <td className="qsa-permcol">{permCell(u)}</td>
                  {isSuper ? (
                    <td>{u.congTyId ? ctTen(u.congTyId)
                      : <span className="qsa-st-lk" title="Tài khoản không thuộc công ty nào — không đăng nhập được. Bấm Sửa để gán công ty.">⚠ Chưa gán công ty</span>}</td>
                  ) : null}
                  <td>{u.active ? <span className="qsa-st-ok">● Hoạt động</span> : <span className="qsa-st-lk">● Đã khóa</span>}</td>
                  <td className="qsa-muted">{u.lastLogin ? fmtDateTime_(u.lastLogin) : '—'}</td>
                  <td><div className="qsa-act">
                    <button type="button" className="qsa-btn ghost xs" onClick={() => onEdit(u)}>Sửa</button>
                    <button type="button" className="qsa-btn ghost xs" onClick={() => onResetPw(u.id)}>Đặt MK</button>
                    <button type="button" className="qsa-btn ghost xs" onClick={() => onToggle(u.id, !u.active)}>{u.active ? 'Khóa' : 'Mở'}</button>
                    <button type="button" className="qsa-btn ghost xs danger" onClick={() => onDelete(u)}>Xóa</button>
                  </div></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function ReqCard({ reqs, onResolve }) {
  const pending = reqs.filter(r => r.status === 'pending')
  return (
    <Card title="Yêu cầu xóa sản phẩm" icon="trash" card="drq" badge={pending.length} bodyCls="qsa-rq-body">
      {reqs.length ? reqs.map(r => {
        const items = r.items || []
        return (
          <RqItem key={r.id} cls={r.status} drq={String(r.id)} icon="trash"
            title={<><b>{r.requester || ''}</b> yêu cầu xóa {items.length} sản phẩm</>}
            meta={<>{items.map((it, i) => <span key={i} className="it">{it.ten || it.maSP}</span>)}
              {r.status !== 'pending' && r.resolver ? <span className="qsa-rq-by">Xử lý bởi {r.resolver}</span> : null}
              {r.lyDo ? <span className="qsa-rq-why"><b>Lý do:</b> {r.lyDo}</span> : null}
              {r.status === 'rejected' && r.lyDoTuChoi ? <span className="qsa-rq-why no"><b>Lý do từ chối:</b> {r.lyDoTuChoi}</span> : null}</>}
            badgeCls={r.status} badgeText={DRQ_LBL[r.status] || r.status}
            actions={r.status === 'pending' ? <>
              <button type="button" className="qsa-btn blue xs" onClick={() => onResolve(r.id, true)}>Duyệt &amp; xóa</button>
              <button type="button" className="qsa-btn ghost xs danger" onClick={() => onResolve(r.id, false)}>Từ chối</button>
            </> : null}
            time={fmtDateTime_(r.at)} />
        )
      }) : <div className="qsa-empty">Chưa có yêu cầu xóa nào.</div>}
    </Card>
  )
}

function PurCard({ purs, onOpen, onResolve }) {
  const pending = purs.filter(r => r.status === 'Chờ duyệt')
  return (
    <Card title="Yêu cầu mua hàng" icon="cart" card="pur" badge={pending.length} bodyCls="qsa-rq-body">
      {purs.length ? purs.map(r => {
        const scls = PUR_CLS[r.status] || 'pending'
        return (
          <RqItem key={r.maDon} cls={scls} clickable icon="cart" onClick={() => onOpen(r.maDon)}
            title={<><b>{r.maDon}</b> · {r.supplier || '—'} · <span className="qsa-rq-amt">{money(r.total)}đ</span>
              <span className="qsa-rq-view"><QsIcon name="eye" size={12} /> Xem chi tiết</span></>}
            meta={<>Người gửi <b>{r.requester || '—'}</b>{r.phongBan ? (' · ' + r.phongBan) : ''} · Dự án {r.project || '—'} · {r.soSp || 0} SP
              {r.resolver ? <span className="qsa-rq-by">Xử lý bởi {r.resolver}{r.resolvedAt ? ' · ' + fmtDateTime_(r.resolvedAt) : ''}</span> : null}</>}
            badgeCls={scls} badgeText={r.status || ''}
            actions={scls === 'pending' ? <>
              <button type="button" className="qsa-btn blue xs" onClick={e => { e.stopPropagation(); onResolve(r.maDon, true) }}>Duyệt</button>
              <button type="button" className="qsa-btn ghost xs danger" onClick={e => { e.stopPropagation(); onResolve(r.maDon, false) }}>Từ chối</button>
            </> : null}
            time={fmtDateTime_(r.at)} />
        )
      }) : <div className="qsa-empty">Chưa có đơn mua hàng nào.</div>}
    </Card>
  )
}

function DxCard({ dxs, onOpen, onResolve }) {
  const pending = dxs.filter(r => r.status === 'Chờ duyệt')
  return (
    <Card title="Đề xuất mua hàng" icon="gauge" card="dx" hint="chiết khấu · thanh toán — tách khỏi đơn mua hàng" badge={pending.length} bodyCls="qsa-rq-body">
      {dxs.length ? dxs.map(r => {
        const scls = dxStatusCls_(r.status)
        const tien = r.loai === 'tt'
          ? <>Tổng đề xuất <span className="qsa-rq-amt">{money(r.tongDeXuat)}đ</span></>
          : <>Giảm <span className="qsa-rq-amt">{money(r.tienGiam)}đ</span> · còn {money(r.tongDeXuat)}đ</>
        return (
          <RqItem key={r.ma} cls={scls} clickable icon={DX_ICO_[r.loai] || 'gauge'} onClick={() => onOpen(r.ma)}
            title={<><b>{r.ma}</b> · {DX_TEN_[r.loai] || 'Đề xuất'} · {r.supplier || '—'}
              <span className="qsa-rq-view"><QsIcon name="eye" size={12} /> Xem chi tiết</span></>}
            meta={<>Người gửi <b>{r.requester || '—'}</b>{r.phongBan ? (' · ' + r.phongBan) : ''} · Dự án {r.project || '—'} · {tien}</>}
            badgeCls={scls} badgeText={r.status || ''}
            actions={scls === 'pending' ? <>
              <button type="button" className="qsa-btn blue xs" onClick={e => { e.stopPropagation(); onResolve(r.ma, true) }}>Duyệt</button>
              <button type="button" className="qsa-btn ghost xs danger" onClick={e => { e.stopPropagation(); onResolve(r.ma, false) }}>Từ chối</button>
            </> : null}
            time={fmtDateTime_(r.at)} />
        )
      }) : <div className="qsa-empty">Chưa có đề xuất nào.</div>}
    </Card>
  )
}

function LogCard({ logs }) {
  return (
    <Card title="Nhật ký hoạt động" icon="list">
      <div className="qsa-tblwrap">
        <table className="qsa-tbl">
          <thead><tr><th style={{ width: 170 }}>Thời gian</th><th>Người dùng</th><th>Hành động</th><th>Chi tiết</th></tr></thead>
          <tbody>
            {logs.length ? logs.map((l, i) => (
              <tr key={l.id != null ? l.id : i}>
                <td className="qsa-muted">{fmtDateTime_(l.at)}</td><td><b>{l.username || ''}</b></td>
                <td>{admActionLabel_(l.action)}</td><td className="qsa-muted">{l.detail || ''}</td>
              </tr>
            )) : <tr><td colSpan={4} className="qsa-muted">Chưa có</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
