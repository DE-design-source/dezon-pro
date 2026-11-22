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
import AppointModal from './AppointModal'
import UserDetail, { SUB_LBL } from './UserDetail'
import UserColPicker from './UserColPicker'
import { CoPicker, CoScope } from './CoScope'

/* Cột bảng Tài khoản: [key, nhãn, luôn hiện]. Cột chọn được nhớ theo trình duyệt (localStorage) */
const UCOLS = [['user', 'Tên đăng nhập', true], ['hoTen', 'Họ tên'], ['role', 'Vai trò'], ['perms', 'Quyền truy cập'], ['apt', 'Bổ nhiệm'],
  ['ct', 'Công ty'], ['st', 'Trạng thái'], ['last', 'Đăng nhập gần nhất'], ['act', 'Thao tác', true]]
const UCOL_KEY = 'qsa.users.cols'
const UCOL_PRESETS = [['Đầy đủ', UCOLS.map(c => c[0])], ['Cơ bản', ['user', 'hoTen', 'role', 'ct', 'st', 'act']], ['Gọn', ['user', 'hoTen', 'st', 'act']]]
const LOG_CAP = 1000   // máy chủ trả tối đa 1000 mục nhật ký 1 lần (users.auditLimit)
function readUCols() {
  try { const a = JSON.parse(localStorage.getItem(UCOL_KEY) || 'null'); if (Array.isArray(a)) return new Set(a) } catch (e) { /* bỏ qua */ }
  return new Set(UCOLS.map(c => c[0]))
}
import * as hrApi from '../../../ChamCong/api'
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
/* view: 'admin' = mọi thẻ trừ yêu cầu và nhật ký; 'nhatky' = mục Nhật ký hoạt động;'yeucau' = mục Yêu cầu của Cài đặt (Yêu cầu xóa sản phẩm + Yêu cầu mua hàng + Đề xuất mua hàng) */
export default function AdminTab({ view = 'admin' }) {
  const { visibleSeq, panelVisible, consumeIntent, reloadProducts, congTy } = useQsData()
  const { me, isAdmin, isSuper, viewAs } = useQsSession()
  const seq = visibleSeq('admin')
  const vis = panelVisible('admin')
  const [st, setSt] = useState({ phase: 'idle', err: '', d: null })
  const [reloadN, setReloadN] = useState(0)
  /* Mục Yêu cầu / Nhật ký theo công ty: super (không "xem như" công ty nào) chọn công ty -> tải riêng dữ liệu công ty đó
     (x-view-company cho từng request, không đổi chế độ xem chung); selUser = lọc theo 1 nhân viên */
  const coView = view === 'yeucau' || view === 'nhatky'
  const [selCo, setSelCo] = useState('')
  const [selUser, setSelUser] = useState('')
  const [sc, setSc] = useState({ phase: 'idle', co: '', d: null, err: '' })
  useEffect(() => { setSelUser('') }, [selCo, viewAs, view])
  useEffect(() => {
    if (!vis || !isSuper || viewAs || !coView || !selCo) return undefined
    const ac = new AbortController(), sig = ac.signal
    setSc(s => ({ phase: 'loading', co: selCo, view, d: s.co === selCo && s.view === view ? s.d : null, err: '' }))
    Promise.all(view === 'nhatky'
      ? [api.getAuditLog(300, sig, selCo)]
      : [api.listDeleteRequests(sig, selCo), api.listPurchaseRequests(sig, selCo), api.listDeXuat(undefined, sig, selCo).catch(e => { if (isAbort(e)) throw e; return [] })])
      .then(r => {
        if (sig.aborted) return
        setSc({ phase: 'ready', co: selCo, view, err: '', d: view === 'nhatky' ? { logs: r[0] || [] } : { reqs: r[0] || [], purs: r[1] || [], dxs: r[2] || [] } })
      }, e => { if (!isAbort(e) && !sig.aborted) setSc({ phase: 'error', co: selCo, view, d: null, err: e.message }) })
    return () => ac.abort()
  }, [vis, isSuper, viewAs, coView, selCo, view, reloadN, seq])
  const scopeCt = isSuper && !viewAs && coView && selCo ? selCo : undefined
  /* Số liệu trên thẻ chọn công ty: mỗi công ty 1 lượt tải theo x-view-company.
     Yêu cầu: {pend, total} (xoá SP + đơn mua + đề xuất); Nhật ký: {logs} (tối đa LOG_CAP mục, đủ thì hiện "LOG_CAP+") */
  const [coCnt, setCoCnt] = useState({ view: '', m: {} })
  const ctsKey = st.d && st.d.cts ? st.d.cts.map(c => c.id).join(',') : ''
  useEffect(() => {
    if (!vis || !isSuper || viewAs || !coView || selCo || !ctsKey) return undefined
    const ac = new AbortController(), sig = ac.signal
    const ids = ctsKey.split(',')
    setCoCnt(s => (s.view === view ? s : { view, m: {} }))
    ids.forEach(id => {
      const p = view === 'nhatky'
        ? api.getAuditLog(LOG_CAP, sig, id).then(l => ({ logs: (l || []).length }))
        : Promise.all([api.listDeleteRequests(sig, id), api.listPurchaseRequests(sig, id), api.listDeXuat(undefined, sig, id).catch(e => { if (isAbort(e)) throw e; return [] })])
          .then(r => {
            const a = r[0] || [], b = r[1] || [], c = r[2] || []
            return { pend: a.filter(x => x.status === 'pending').length + b.filter(x => x.status === 'Chờ duyệt').length + c.filter(x => x.status === 'Chờ duyệt').length,
              total: a.length + b.length + c.length }
          })
      p.then(v => { if (!sig.aborted) setCoCnt(s => ({ view, m: { ...(s.view === view ? s.m : {}), [id]: v } })) },
        e => { if (!isAbort(e) && !sig.aborted) setCoCnt(s => ({ view, m: { ...(s.view === view ? s.m : {}), [id]: { err: 1 } } })) })
    })
    return () => ac.abort()
  }, [vis, isSuper, viewAs, coView, selCo, view, ctsKey, reloadN, seq])
  const [userDlg, setUserDlg] = useState(null)   // {user, superMode, back} | null; back() = mở lại hộp Chi tiết tài khoản khi Huỷ
  const [aptUser, setAptUser] = useState(null)   // tài khoản đang bổ nhiệm vào cơ cấu tổ chức (AppointModal) | null
  /* Vị trí trong cơ cấu HR của từng tài khoản (cột Bổ nhiệm): {userId: {unit, position, head}}; công ty không có HR / không đọc được -> null (ẩn cột) */
  const [hrPos, setHrPos] = useState(null)
  useEffect(() => {
    // hồ sơ HR theo công ty đang làm việc: super chưa "xem như" công ty nào -> không có cột / nút Bổ nhiệm
    const ctNow = (congTy && congTy.id) || (me && me.congTyId) || ''
    if (!vis || !isAdmin || !ctNow) { setHrPos(null); return undefined }
    let off = false
    hrApi.load().then(st => {
      if (off) return
      const un = {}; (st.units || []).forEach(u => { un[u.key] = u.name || u.label })
      const m = {}
      ;(st.employees || []).forEach(e => { if (e.userId) m[e.userId] = { unit: un[e.dept] || e.dept || '', position: e.position || '', head: !!(st.heads && String(st.heads[e.dept]) === String(e.id)) } })
      setHrPos(m)
    }, () => { if (!off) setHrPos(null) })
    return () => { off = true }
  }, [vis, isAdmin, reloadN, viewAs, congTy && congTy.id])   // eslint-disable-line react-hooks/exhaustive-deps
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
      // Duyệt sản phẩm theo phân cấp (M14.6): admin được giao duyệt {userId: bool} + quyền của tài khoản đang đăng nhập.
      // Lỗi 2 mục này không chặn cả trang (máy chủ cũ chưa có route): coi như chưa giao
      const soft = e => { if (isAbort(e)) throw e; return null }
      const [apv, rights] = await Promise.all([api.listProductApprovers(sig).catch(soft), api.getSpApprovalRights(sig).catch(soft)])
      const approvers = {}
      ;(apv || []).forEach(a => { if (a && a.id != null) approvers[String(a.id)] = !!a.duocDuyetSp })
      let cts = []
      if (isSuper) { try { cts = (await api.listCongTy(sig)) || [] } catch (e) { if (isAbort(e)) throw e; cts = []; if (!sig.aborted) qsToast('Lỗi tải danh sách công ty: ' + e.message) } }
      return { users: users || [], reqs: reqs || [], purs: purs || [], logs: logs || [], dxs, cts, approvers,
        rights: rights ? { duyet: !!rights.duyet, giaoDuyet: !!rights.giaoDuyet } : { duyet: isSuper, giaoDuyet: isSuper } }
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
    window.dispatchEvent(new CustomEvent(QSA_EXPAND, { detail: 'drq' }))   // thẻ đang thu gọn thì mở ra trước
    let t = 0
    const t0 = setTimeout(() => {
      el.scrollIntoView({ block: 'center' })
      el.classList.add('qsa-flash')
      t = setTimeout(() => el.classList.remove('qsa-flash'), 1800)
    }, 30)
    return () => { clearTimeout(t0); clearTimeout(t); el.classList.remove('qsa-flash') }
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
    api.resolvePurchaseRequest(maDon, approve, undefined, scopeCt).then(() => {
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
    api.resolveDeleteRequest(id, approve, lyDo, undefined, scopeCt).then(r => {
      qsToast(approve ? ('Đã duyệt & xóa ' + ((r && r.deleted) || 0) + ' sản phẩm' + (r && r.loi ? (' — có sản phẩm không xoá được: ' + r.loi) : '')) : 'Đã từ chối yêu cầu')
      reload(); refreshNotifCount()
      if (approve) reloadProducts().catch(e => qsToast('Lỗi tải lại danh sách sản phẩm: ' + e.message))
    }, e => qsToast('Lỗi: ' + e.message))
  }
  async function dxResolve(ma, approve) {
    if (!approve && !await qsConfirm('Từ chối phiếu ' + ma + '?')) return
    api.resolveDeXuat(ma, approve, undefined, scopeCt).then(() => {
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
  // Tài khoản công ty (không gồm super). Super đang xem 1 công ty (viewAs) chỉ thấy tài khoản của công ty đó;
  // admin công ty đã được máy chủ lọc sẵn theo công ty mình.
  const coUsers = d ? d.users.filter(u => u.role !== 'super' && (!isSuper || !viewAs || String(u.congTyId) === String(viewAs))) : []
  let body
  if (st.phase === 'error') {
    body = <div className="qsa-empty">Lỗi tải: {st.err}</div>
  } else if (st.phase !== 'ready' || !d) {
    body = <div className="qsa-empty">Đang tải…</div>
  } else if (view === 'super') {
    body = (
      <UsersCard meId={me && me.id} users={d.users.filter(u => u.role === 'super')} isSuper={isSuper} cts={d.cts} hrPos={null} hrCt="" onAppoint={setAptUser}
        addLabel="Thêm tài khoản siêu quản trị viên"
        onCreate={() => setUserDlg({ user: null, superMode: true })} onEdit={(u, back) => setUserDlg({ user: u, superMode: true, back })}
        onResetPw={admResetPw} onToggle={admToggleActive} onDelete={admDelete} />
    )
  } else if (coView && isSuper && !viewAs && !selCo) {
    body = <CoPicker cts={d.cts} users={d.users} kind={view} cnt={coCnt.view === view ? coCnt.m : {}} logCap={LOG_CAP} onPick={setSelCo} />
  } else if (coView) {
    // công ty đang xem: super chọn ở danh sách (selCo) hoặc đang "xem như" (viewAs); admin = công ty của mình
    const coId = isSuper ? (viewAs || selCo) : ((me && me.congTyId) || '')
    const co = isSuper ? (d.cts.filter(c => String(c.id) === String(coId))[0] || null) : congTy
    const us = d.users.filter(u => u.role !== 'super' && (!isSuper || String(u.congTyId) === String(coId)))
    const own = isSuper && !viewAs
    const src = own ? (sc.co === selCo && sc.view === view ? sc.d : null) : d
    const su = selUser ? us.filter(u => String(u.id) === selUser)[0] : null
    const nm = x => String(x || '').trim().toLowerCase()
    // Người gửi lưu theo tên (yêu cầu xoá: họ tên lúc gửi; đơn mua / đề xuất: ô "Người gửi" nhập tay) -> so khớp họ tên hoặc tên đăng nhập
    const byU = r => !su || (!!nm(r.requester) && (nm(r.requester) === nm(su.hoTen) || nm(r.requester) === nm(su.username)))
    const nLog = own ? 300 : 120
    const logNote = su ? <p className="qsa-cs-note">Lọc trong {nLog} mục nhật ký gần nhất của công ty.</p> : null
    const head = <CoScope co={co} users={us} sel={selUser} onSel={setSelUser} onBack={own ? () => setSelCo('') : null} />
    if (own && sc.phase === 'error' && sc.co === selCo && sc.view === view) body = <>{head}<div className="qsa-empty">Lỗi tải: {sc.err}</div></>
    else if (!src) body = <>{head}<div className="qsa-empty">Đang tải…</div></>
    else if (view === 'nhatky') body = <>{head}{logNote}<LogCard logs={src.logs.filter(l => !su || nm(l.username) === nm(su.username))} /></>
    else {
      body = (
        <>
          {head}
          <ReqCard reqs={src.reqs.filter(byU)} onResolve={drqResolve} />
          <PurCard purs={src.purs.filter(byU)} onOpen={setPurCode} onResolve={purResolve} />
          <DxCard dxs={src.dxs.filter(byU)} onOpen={setDxMa} onResolve={dxResolve} />
        </>
      )
    }
  } else {
    body = (
      <>
        <Stats d={d} nUsers={coUsers.length} />
        {coEdit ? (
          <CompanyCard c={coEdit} onSaved={coSaved} />
        ) : null}
        <UsersCard meId={me && me.id} users={coUsers} isSuper={isSuper} cts={d.cts} approvers={d.approvers} hrPos={hrPos} hrCt={(congTy && congTy.id) || (me && me.congTyId) || ''} onAppoint={setAptUser}
          onCreate={() => setUserDlg({ user: null })} onEdit={(u, back) => setUserDlg({ user: u, back })}
          onResetPw={admResetPw} onToggle={admToggleActive} onDelete={admDelete} />
      </>
    )
  }

  const defaultCt = (congTy && congTy.id) || (me && me.congTyId) || ''
  return (
    <div className="qsa-root" ref={bodyRef}>
      <div className="qsa-hd"><h2>{view === 'super' ? 'Tài khoản siêu quản trị viên' : view === 'nhatky' ? 'Nhật ký hoạt động' : view === 'yeucau' ? 'Yêu cầu — Xóa sản phẩm, mua hàng & đề xuất' :<>Quản trị — Tài khoản &amp; phân quyền</>}</h2>
        {view === 'admin' ? <span className="qsa-hd-note">Admin toàn quyền · Nhân viên không mở được trang này.</span> : null}</div>
      {view === 'super' ? (
        /* Vai trò Siêu quản trị viên (MarkUp 2026-11-12 17:47, N17) */
        <p className="qsa-super-note">
          Tài khoản siêu quản trị viên là tài khoản của <b>nhà phát triển</b>: cấp tài khoản cho các công ty và can thiệp sâu vào hệ thống
          (giao diện mặc định, tính năng mặc định...). Cài đặt do tài khoản siêu quản trị viên lưu bằng nút <b>Lưu làm mặc định toàn hệ thống</b>
          (ở đầu các mục Giao diện, Hiển thị, Chung, Quyền riêng tư, Hiệu suất, Thông báo, Phím tắt, Lịch, Nhiệm vụ) được áp cho toàn hệ thống;
          người dùng tự chỉnh thì giá trị riêng của họ được giữ.
        </p>
      ) : null}
      {body}
      {userDlg ? (
        <UserModal user={userDlg.user} superMode={!!userDlg.superMode} isSuper={isSuper} companies={d ? d.cts : []} defaultCt={defaultCt}
          rights={d ? d.rights : null} approved={!!(d && userDlg.user && d.approvers[String(userDlg.user.id)])}
          onClose={() => { const b = userDlg.back; setUserDlg(null); if (b) b() }} onSaved={msg => { qsToast(msg); setUserDlg(null); reload() }} />
      ) : null}
      {aptUser ? (
        <AppointModal user={aptUser} onClose={() => setAptUser(null)} onSaved={msg => { qsToast(msg); setAptUser(null); reload() }} />
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

function Stats({ d, nUsers }) {
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
      {tile('lock', nUsers, 'Tài khoản', false)}
      {tile('trash', pendDel, 'Yêu cầu xóa chờ duyệt', true)}
      {tile('cart', pendPur, 'Đơn mua hàng chờ duyệt', true)}
      {tile('gauge', pendDx, 'Đề xuất chờ duyệt', true)}
    </div>
  )
}

/* Thẻ .dbcard (dbCard_, PUB/nhap.js:456-459) */
/* Nút thu gọn ở đầu mỗi thẻ (MarkUp 2026-11-12 17:07): nhớ theo thẻ trong localStorage; thân thẻ vẫn mount (ẩn bằng CSS)
   để thông báo "làm nổi yêu cầu xoá" tìm được dòng, sự kiện QSA_EXPAND mở lại thẻ trước khi cuộn tới */
const QSA_FOLD_LS = 'qsa-folded'
const QSA_EXPAND = 'qsa-expand'
function readFolded() { try { return JSON.parse(localStorage.getItem(QSA_FOLD_LS) || '{}') || {} } catch { return {} } }
function Card({ title, icon, note, badge, hint, card, bodyCls = '', bare = false, children }) {
  if (bare) {
    return (
      <div className="qsa-card bare" data-card={card}>
        <div className={`qsa-card-b${bodyCls ? ' ' + bodyCls : ''}`}>{note ? <p className="qsa-note">{note}</p> : null}{children}</div>
      </div>
    )
  }
  return <FoldCard {...{ title, icon, note, badge, hint, card, bodyCls, children }} />
}
function FoldCard({ title, icon, note, badge, hint, card, bodyCls, children }) {
  const [folded, setFolded] = useState(() => !!(card && readFolded()[card]))
  const setF = v => {
    setFolded(v)
    if (!card) return
    try { const m = readFolded(); if (v) m[card] = 1; else delete m[card]; localStorage.setItem(QSA_FOLD_LS, JSON.stringify(m)) } catch { /* bỏ qua */ }
  }
  useEffect(() => {
    if (!card) return undefined
    const on = e => { if (e.detail === card) setFolded(false) }
    window.addEventListener(QSA_EXPAND, on)
    return () => window.removeEventListener(QSA_EXPAND, on)
  }, [card])
  return (
    <div className={`qsa-card${folded ? ' folded' : ''}`} data-card={card}>
      <div className="qsa-card-h">
        <span className="qsa-card-ic"><QsIcon name={icon} size={18} /></span>
        <h3>{title}</h3>
        {hint ? <span className="qsa-hint">{hint}</span> : null}
        {badge ? <span className="qsa-pend">{badge} chờ duyệt</span> : null}
        <button type="button" className="qsa-fold" title={folded ? 'Mở rộng' : 'Thu gọn'} aria-expanded={!folded} onClick={() => setF(!folded)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </button>
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

function UsersCard({ meId, users, isSuper, cts, approvers, hrPos, hrCt, onAppoint, addLabel = 'Thêm tài khoản', onCreate, onEdit, onResetPw, onToggle, onDelete }) {
  const lbl = {}
  PERM_TABS.forEach(t => { lbl[t[0]] = t[1] })
  const ctTen = id => { const c = (cts || []).filter(x => x.id === id)[0]; return c ? (c.ten || c.ma || id) : '(công ty đã xoá)' }
  const [detail, setDetail] = useState(null)   // id tài khoản đang mở hộp chi tiết
  const [vis, setVisRaw] = useState(readUCols)
  const setVis = s => { setVisRaw(s); try { localStorage.setItem(UCOL_KEY, JSON.stringify([...s])) } catch (e) { /* bỏ qua */ } }
  const cols = UCOLS.filter(c => (c[0] !== 'apt' || hrPos) && (c[0] !== 'ct' || isSuper))
  const sh = k => cols.some(c => c[0] === k && (c[2] || vis.has(k)))
  // Ô quyền gọn 1 dòng: 2 quyền đầu + "+N"; đủ danh sách ở hộp chi tiết (bấm vào dòng)
  const permCell = u => {
    if (u.role === 'admin' || u.role === 'super') return <span className="qsa-muted">Toàn quyền</span>
    const p = u.perms || []
    if (!p.length) return <span className="qsa-st-lk">Chưa cấp</span>
    const name = k => lbl[k] || SUB_LBL[k] || k
    return (
      <span className="qsa-permsum" title={p.map(name).join(', ')}>
        {p.slice(0, 2).map(k => <span key={k} className="qsa-permchip">{name(k)}</span>)}
        {p.length > 2 ? <span className="qsa-permmore">+{p.length - 2}</span> : null}
      </span>
    )
  }
  const canApt = u => !!hrPos && u.role !== 'super' && String(u.congTyId || '') === String(hrCt || '')
  // Không phải super: tài khoản quản trị công ty KHÁC mình chỉ xem, không sửa / đặt MK / khoá / xoá (máy chủ cũng chặn)
  const ro = u => !isSuper && u.role === 'admin' && String(u.id) !== String(meId)
  const apr = u => u.role === 'admin' && !!(approvers && approvers[String(u.id)])
  const du = detail != null ? users.filter(x => x.id === detail)[0] : null
  const noCt = users.filter(u => !u.congTyId).length
  return (
    /* không có đầu thẻ: số tài khoản ở thanh thống kê, ghi chú quyền ở cạnh tiêu đề trang (MarkUp 2026-11-12 17:13) */
    <Card title="Tài khoản" icon="lock" card="users" bare>
      <div className="qsa-ubar">
        <button type="button" className="qsa-btn blue sm" onClick={onCreate}><QsIcon name="plus" size={14} /> {addLabel}</button>
        <UserColPicker cols={cols} vis={vis} onChange={setVis} presets={UCOL_PRESETS.map(p => [p[0], p[1].filter(k => cols.some(c => c[0] === k))])} />
      </div>
      {isSuper && noCt ? (
        <div className="qsa-warn"><span className="qsa-warn-ic">!</span>
          <span>Có <b>{noCt}</b> tài khoản chưa gán công ty. Tài khoản kiểu này không đăng nhập được và không hiện trong danh sách của công ty nào — bấm <b>Sửa</b> để gán công ty hoặc xoá đi.</span>
        </div>
      ) : null}
      <div className="qsa-tblwrap">
        <table className="qsa-tbl">
          <thead><tr>
            <th>Tên đăng nhập</th>{sh('hoTen') ? <th>Họ tên</th> : null}{sh('role') ? <th>Vai trò</th> : null}{sh('perms') ? <th>Quyền truy cập</th> : null}
            {sh('apt') ? <th>Bổ nhiệm</th> : null}{sh('ct') ? <th>Công ty</th> : null}{sh('st') ? <th>Trạng thái</th> : null}{sh('last') ? <th>Đăng nhập gần nhất</th> : null}<th />
          </tr></thead>
          <tbody>
            {users.map(u => {
              const av = (u.hoTen || u.username || '?').trim().charAt(0).toUpperCase()
              return (
                <tr key={u.id} className={`qsa-urow${u.active ? '' : ' locked'}`} onClick={() => setDetail(u.id)} title="Bấm để xem chi tiết tài khoản"
                  tabIndex={0} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setDetail(u.id) } }}>
                  <td><span className={`qsa-uav${u.role !== 'staff' ? ' adm' : ''}`}>{av}</span><b>{u.username}</b>
                    {u.email ? <span className="qsa-mail">{u.email}</span> : null}</td>
                  {sh('hoTen') ? <td>{u.hoTen || ''}</td> : null}
                  {sh('role') ? <td><span className={`qsa-role ${u.role === 'super' ? 'sup' : (u.role === 'admin' ? 'adm' : 'stf')}`}>{ROLE_LBL[u.role] || u.role}</span>
                    {apr(u) ? <span className="qsa-apr" title="Được quản trị hệ thống giao quyền duyệt sản phẩm">Duyệt SP</span> : null}</td> : null}
                  {sh('perms') ? <td className="qsa-permcol">{permCell(u)}</td> : null}
                  {sh('apt') ? (
                    <td className="qsa-aptcol">{String(u.congTyId || '') !== String(hrCt || '') ? <span className="qsa-muted" title="Chỉ bổ nhiệm được tài khoản của công ty đang làm việc">—</span> : hrPos[u.id]
                      ? <button type="button" className="qsa-apt-cell" title="Đổi vị trí trong cơ cấu tổ chức" onClick={e => { e.stopPropagation(); onAppoint(u) }}>
                          <b>{hrPos[u.id].unit || '—'}</b>{hrPos[u.id].head ? <span className="qsa-apt-head">Trưởng</span> : null}
                          {hrPos[u.id].position ? <small>{hrPos[u.id].position}</small> : null}</button>
                      : <span className="qsa-muted">Chưa bổ nhiệm</span>}</td>
                  ) : null}
                  {sh('ct') ? (
                    <td>{u.congTyId ? ctTen(u.congTyId)
                      : <span className="qsa-st-lk" title="Tài khoản không thuộc công ty nào — không đăng nhập được. Bấm Sửa để gán công ty.">⚠ Chưa gán công ty</span>}</td>
                  ) : null}
                  {sh('st') ? <td>{u.active ? <span className="qsa-st-ok">● Hoạt động</span> : <span className="qsa-st-lk">● Đã khóa</span>}</td> : null}
                  {sh('last') ? <td className="qsa-muted">{u.lastLogin ? fmtDateTime_(u.lastLogin) : '—'}</td> : null}
                  <td title="" onClick={e => e.stopPropagation()}>{ro(u) ? <span className="qsa-muted qsa-ro">Chỉ quản trị hệ thống</span> : <div className="qsa-act">
                    <button type="button" className="qsa-btn ghost xs" onClick={() => onEdit(u)}>Sửa</button>
                    {hrPos && u.role !== 'super' && String(u.congTyId || '') === String(hrCt || '') ? <button type="button" className="qsa-btn ghost xs" title="Bổ nhiệm vào phòng ban / cơ cấu tổ chức (HR)" onClick={() => onAppoint(u)}>Bổ nhiệm</button> : null}
                    <button type="button" className="qsa-btn ghost xs" onClick={() => onResetPw(u.id)}>Đặt MK</button>
                    <button type="button" className="qsa-btn ghost xs" onClick={() => onToggle(u.id, !u.active)}>{u.active ? 'Khóa' : 'Mở'}</button>
                    <button type="button" className="qsa-btn ghost xs danger" onClick={() => onDelete(u)}>Xóa</button>
                  </div>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {du ? (
        <UserDetail u={du} approved={apr(du)} ctName={du.congTyId ? ctTen(du.congTyId) : ''} apt={hrPos ? hrPos[du.id] || null : null} aptKnown={canApt(du)} canAppoint={canApt(du)} readOnly={ro(du)}
          onClose={() => setDetail(null)} onEdit={x => onEdit(x, () => setDetail(x.id))} onAppoint={onAppoint} onResetPw={onResetPw} onToggle={onToggle} onDelete={onDelete} />
      ) : null}
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
