import { useEffect, useState } from 'react'
import * as api from '../../api/qsApi'
import { isAbort } from '../../api/http'
import { mediaUrl } from '../../api/files'
import { fmtDate } from '../../lib/format'
import { useQs } from '../../state/QsData'
import { useQsSession } from '../../session/QsSession'
import { viewAsCtFromList_ } from '../../state/store'
import { qsToast, qsAsk } from '../common/dialogs'
import QsIcon from '../common/QsIcon'
import CongTyForm from './CongTyForm'
import ReportCard from './ReportCard'
import ExpiryCard from './ExpiryCard'
import { CT_FEATURES, ngayConLai } from '../admin/adminUtil'
import '../admin/admin.css'
import './congty.css'

/* Tab Công ty (chỉ super admin) — cấp / khoá / gia hạn công ty, tính năng, logo, tài khoản của công ty.
   Port PUB/congty.js: renderCongTy 8-80, ctViewAs 82-87, ctCreate/ctEdit 88-89, ctDelete 259-267.
   Tải lại danh sách mỗi lần tab được mở (visibleSeq); "Xem dữ liệu" đổi công ty xem (x-view-company) qua setViewAs của phiên,
   phiên nạp lại dữ liệu rồi tăng visibleSeq nên danh sách tự tải lại.
   Thẻ báo cáo sản phẩm nhập mới (ReportCard, M18.1) là con thứ 4, nằm ngoài phần tải lại nên giữ kết quả chạy thử.
   Thẻ nhắc gia hạn (ExpiryCard, M17.3 - giả định) là con thứ 5, cũng nằm ngoài phần tải lại. */
export default function CongTyTab() {
  const { visibleSeq, panelVisible } = useQs()
  const { isSuper, viewAs, setViewAs } = useQsSession()
  const seq = visibleSeq('congty')
  const vis = panelVisible('congty')
  const [st, setSt] = useState({ phase: 'idle', list: [], err: '' })
  const [reloadN, setReloadN] = useState(0)
  const [form, setForm] = useState(null)   // {c, tab} | null

  useEffect(() => {
    if (!vis || !isSuper) return undefined
    const ac = new AbortController()
    setSt(s => ({ ...s, phase: 'loading', err: '' }))
    api.listCongTy(ac.signal).then(list => { setSt({ phase: 'ready', list: list || [], err: '' }); viewAsCtFromList_(list) },
      e => { if (!isAbort(e)) setSt({ phase: 'error', list: [], err: e.message }) })
    return () => ac.abort()
  }, [seq, reloadN, isSuper])   // eslint-disable-line react-hooks/exhaustive-deps

  const reload = () => setReloadN(n => n + 1)

  function ctViewAs(id) {
    // gửi kèm công ty (có tinhNang) để thanh bên / trang ẩn ngay những tính năng công ty này đã tắt
    setViewAs(id || null, (st.list || []).filter(x => String(x.id) === String(id))[0] || null)
  }

  async function ctDelete(c) {
    const ok = await qsAsk({
      title: 'Xoá công ty', note: 'Xoá VĨNH VIỄN công ty "' + c.ten + '" và TOÀN BỘ dữ liệu (dự án, sản phẩm, đơn hàng, tài khoản). Không thể hoàn tác.',
      label: 'Gõ đúng mã công ty để xác nhận: ' + c.ma, placeholder: c.ma, confirmText: 'Xoá vĩnh viễn',
    })
    if (ok == null) return
    if (String(ok).trim() !== c.ma) { qsToast('Mã xác nhận không đúng — đã huỷ'); return }
    try { const r = await api.deleteCongTy(c.id); qsToast('Đã xoá công ty "' + ((r && r.ten) || c.ten) + '"'); reload() }
    catch (e) { qsToast('Lỗi: ' + e.message) }
  }

  // hộp sửa nằm ngoài phần vẽ lại danh sách (bản gốc gắn #ctOv vào body) nên không mất khi danh sách tải lại;
  // luôn là con thứ 3 của .qsa-root để React không gắn lại nó khi đổi giữa "Đang tải…" và danh sách
  const formEl = form ? <CongTyForm c={form.c} startTab={form.tab} onClose={() => setForm(null)} onSaved={reload} /> : null
  return (
    <div className="qsa-root">
      {st.phase === 'ready' ? <ListView list={st.list} viewAs={viewAs} onCreate={() => setForm({ c: null })}
        onView={ctViewAs} onEdit={(c, tab) => setForm({ c, tab })} onDelete={ctDelete} /> : (
        <div className="qsa-hd"><h2>Quản lý công ty</h2></div>
      )}
      {st.phase === 'ready' ? null : <div className="qsa-empty" style={{ padding: 26 }}>{st.phase === 'error' ? st.err : 'Đang tải…'}</div>}
      {formEl}
      {isSuper ? <ReportCard /> : null}
      {isSuper ? <ExpiryCard /> : null}
    </div>
  )
}

function ListView({ list, viewAs, onCreate, onView, onEdit, onDelete }) {
  // ---- thống kê nhanh ----
  let dangHD = 0, sapHet = 0, tongUser = 0
  list.forEach(c => {
    const d = ngayConLai(c.hanDung)
    if (c.active && !(d !== null && d < 0)) dangHD++
    if (d !== null && d >= 0 && d <= 30) sapHet++
    tongUser += c.soUser || 0
  })
  return (
    <>
      <div className="qsa-hd">
        <h2>Quản lý công ty</h2><span className="qsa-count">{list.length}</span>
        <span className="qsa-sp" />
        <button type="button" className="qsa-btn blue sm" onClick={onCreate}><QsIcon name="plus" size={14} /> Tạo công ty</button>
      </div>
      {/* dải "Đang xem dữ liệu của ..." ở khung chung (components/layout/ViewAsBanner) */}
      <div className="qsco-stats">
        <Stat ic="building" v={list.length} l="Công ty" />
        <Stat cls="ok" ic="check" v={dangHD} l="Đang hoạt động" />
        <Stat cls="warn" ic="clock" v={sapHet} l="Sắp hết hạn (30 ngày)" />
        <Stat ic="list" v={tongUser} l="Tổng người dùng" />
      </div>
      <div className="qsco-grid">
        {list.length ? list.map(c => (
          <CtCard key={c.id} c={c} onView={() => onView(c.id)} onEdit={tab => onEdit(c, tab)} onDelete={() => onDelete(c)} />
        )) : <div className="qsa-empty" style={{ padding: 40, textAlign: 'center' }}>Chưa có công ty nào. Bấm <b>Tạo công ty</b> để bắt đầu.</div>}
      </div>
    </>
  )
}

function Stat({ cls = '', ic, v, l }) {
  return (
    <div className={`qsco-stat${cls ? ' ' + cls : ''}`}>
      <span className="qsco-stat-ic"><QsIcon name={ic} size={17} /></span>
      <div><b>{v}</b><i>{l}</i></div>
    </div>
  )
}

function CtCard({ c, onView, onEdit, onDelete }) {
  const [logoBad, setLogoBad] = useState(false)
  const tn = c.tinhNang || []
  const d = ngayConLai(c.hanDung), het = (d !== null && d < 0)
  const stt = !c.active ? ['locked', 'Tạm khoá'] : (het ? ['expired', 'Hết hạn'] : ['ok', 'Đang hoạt động'])
  const pct = c.gioiHanUser > 0 ? Math.min(100, Math.round((c.soUser || 0) / c.gioiHanUser * 100)) : 0
  const fullUser = c.gioiHanUser > 0 && (c.soUser || 0) >= c.gioiHanUser
  const fpct = Math.round((tn.length / CT_FEATURES.length) * 100)
  const ini = (c.ten || '?').trim().charAt(0).toUpperCase()
  const hanTxt = c.hanDung
    ? (het ? <span className="qsco-han expired">Hết hạn {fmtDate(c.hanDung)}</span>
      : (d <= 30 ? <span className="qsco-han warn">Còn {d} ngày · {fmtDate(c.hanDung)}</span>
        : <span className="qsco-han">Đến {fmtDate(c.hanDung)}</span>))
    : <span className="qsco-han muted">Không giới hạn</span>
  return (
    <div className={`qsco-card${c.active ? '' : ' off'}`}>
      <div className="qsco-card-h">
        {c.logoUrl && !logoBad
          ? <img className="qsco-lg" src={mediaUrl(c.logoUrl)} alt="" onError={() => setLogoBad(true)} />
          : <span className="qsco-ini">{ini}</span>}
        <div className="qsco-card-t">
          <div className="qsco-nm">{c.ten}</div>
          <div className="qsco-sub">{c.ma}{c.email ? (' · ' + c.email) : ''}{c.sdt ? (' · ' + c.sdt) : ''}</div>
        </div>
        <span className={`qsco-badge ${stt[0]}`}>{stt[1]}</span>
        <button type="button" className="qsco-del" title="Xoá công ty và toàn bộ dữ liệu" aria-label="Xoá công ty" onClick={onDelete}><QsIcon name="trash" size={14} /></button>
      </div>
      {c.dungSpDezon ? (
        <div className="qsco-sharerow"><span className="qsco-sharetag" title="Được dùng kho sản phẩm của Dezon"><QsIcon name="layers" size={11} /> Kho SP Dezon</span></div>
      ) : null}
      <div className="qsco-card-b">
        <div className="qsco-metric">
          <div className="qsco-mh"><span>Người dùng</span><b className={fullUser ? 'full' : undefined}>{c.soUser || 0} / {c.gioiHanUser || '∞'}</b></div>
          <div className="qsco-bar"><i className={fullUser ? 'full' : undefined} style={{ width: pct + '%' }} /></div>
        </div>
        <div className="qsco-metric">
          <div className="qsco-mh"><span>Tính năng</span><b>{tn.length} / {CT_FEATURES.length}</b></div>
          <div className="qsco-bar"><i style={{ width: fpct + '%' }} /></div>
        </div>
        <div className="qsco-metric"><div className="qsco-mh"><span>Hạn dùng</span>{hanTxt}</div></div>
      </div>
      <div className="qsco-chips">
        {CT_FEATURES.map(f => {
          const on = tn.indexOf(f[0]) >= 0
          return <span key={f[0]} className={`qsco-fc${on ? ' on' : ''}`} title={f[1] + (on ? ' — đã bật' : ' — chưa bật')}>{f[1]}</span>
        })}
      </div>
      <div className="qsco-card-f">
        <button type="button" className="qsco-b" title="Xem dữ liệu của công ty này" onClick={onView}><QsIcon name="eye" size={13} /> Xem dữ liệu</button>
        <button type="button" className="qsco-b" title="Sửa tên, logo, liên hệ, gói sử dụng" onClick={() => onEdit('info')}><QsIcon name="edit" size={13} /> Sửa</button>
        <button type="button" className="qsco-b" title="Bật / tắt tính năng của công ty" onClick={() => onEdit('tn')}><QsIcon name="lock" size={13} /> Phân quyền</button>
      </div>
    </div>
  )
}
