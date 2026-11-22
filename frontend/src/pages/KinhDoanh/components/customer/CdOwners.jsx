import { useEffect, useRef, useState } from 'react'
import { DEPT_LABEL } from '../../../../data/kinhDoanhData'
import { lmInitials, noDau } from '../../utils'

/* Khối "Phụ trách" của trang khách hàng dạng dashboard: người phụ trách gom theo nhóm (assignees[].dept),
   người phụ trách chính (kinh doanh) tô nổi, nhóm trống có "+ Gán" (mở form sửa khách hàng). */
export const OWNER_GROUPS = [
  { key: 'kinhdoanh', label: 'Kinh doanh', color: '#D9661F', empty: 'Chưa có nhân sự kinh doanh' },
  { key: 'ctv', label: 'CTV Kinh doanh', color: '#1877F2', empty: 'Chưa có cộng tác viên' },
  { key: 'concept', label: 'Concept', color: '#E8A317', empty: 'Chưa có người làm concept' },
  { key: 'thietke', label: 'Thiết kế', color: '#5B4BD6', empty: 'Chưa có kiến trúc sư / thiết kế' },
  { key: 'nhathau', label: 'Nhà thầu', color: '#1F8A5B', empty: 'Gán sau khi chốt hợp đồng TK' },
]
const KEYS = OWNER_GROUPS.map(g => g.key)

/* Nhóm của 1 người phụ trách: trường dept (máy chủ); chưa có thì đoán theo chức danh; không rõ -> kinh doanh */
export function deptOf(a) {
  const d = a && a.dept
  if (d && KEYS.indexOf(d) >= 0) return d
  const r = noDau(a && a.role)
  if (/\bctv\b|cong tac vien/.test(r)) return 'ctv'
  if (r.indexOf('concept') >= 0) return 'concept'
  if (/thiet ke|kts|kien truc|noi that/.test(r)) return 'thietke'
  if (/thi cong|nha thau|doi tac/.test(r)) return 'nhathau'
  return 'kinhdoanh'
}

/* 'yyyy-mm-dd' -> 'dd/mm/yy' */
export const fmtSince = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '/' + m[2] + '/' + m[1].slice(2) : '' }

/* "Admin Kinh doanh" lưu chung mảng assignees với vai trò này (LeadModal); không tính là người phụ trách chính */
export const ADMIN_KD = 'Admin Kinh doanh'
const isAdminKd = a => !!a && a.role === ADMIN_KD

/* Người phụ trách chính (chip ở header, tô nổi ở khối Phụ trách): người đầu tiên nhóm kinh doanh (trừ Admin KD), không có thì quản lý */
export function leadOwner(l) {
  const list = (l && l.assignees) || []
  const i = list.findIndex(a => a && a.name && !isAdminKd(a) && deptOf(a) === 'kinhdoanh')
  if (i >= 0) return { idx: i, name: list[i].name, role: list[i].role || 'Phụ trách', since: list[i].since || '' }
  if (l && l.manager) return { idx: -1, name: l.manager, role: 'Quản lý', since: '' }
  return null
}


/* Thu gọn / mở rộng thẻ (nhớ theo trình duyệt, mặc định thu gọn để cột 2 không dài hơn hẳn cột Hồ sơ) */
function useFoldPref(key) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) === '1' } catch (e) { return false } })
  const toggle = () => setOpen(v => { const n = !v; try { localStorage.setItem(key, n ? '1' : '0') } catch (e) { /* bỏ qua */ } return n })
  return [open, toggle]
}
const FOLD_D = { open: 'M18 15l-6-6-6 6', closed: 'M6 9l6 6 6-6' }
function FoldBtn({ open, onClick, light }) {
  return (
    <button type="button" className={'cd-fold-btn' + (light ? ' light' : '')} aria-expanded={open} title={open ? 'Thu gọn' : 'Mở rộng'} onClick={onClick}>
      {open ? 'Thu gọn' : 'Mở rộng'}
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={open ? FOLD_D.open : FOLD_D.closed} /></svg>
    </button>
  )
}

const fmtD = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : '' }

export default function CdOwners({ lead: l, onEdit }) {
  const [open, toggle] = useFoldPref('kd-cd-owners-open')
  // Thẻ được kéo cao bằng cột Hồ sơ (CustomerDashboard đặt minHeight): tự hiện thêm cho kín khung thay vì để trống.
  // Mức 0 = gọn; 1 = 1 dòng tóm tắt Phòng · Quản lý · Khởi tạo (cắt "…", rê chuột xem đủ); 2 = tóm tắt 2 dòng;
  // 3 = bảng Phòng / Quản lý / Admin KD / Khởi tạo (sát đáy thẻ); 3+k = xổ sẵn nhân viên k nhóm có người đầu tiên;
  // M+4 = đủ như Mở rộng (thêm dòng gợi ý của nhóm trống).
  // Mức nào làm thẻ tràn khung thì lùi 1 mức và nhớ trần cho chiều cao đó; phần dư còn lại chia đều giữa các nhóm.
  const memKeys = l ? OWNER_GROUPS.map(g => g.key).filter(k => (l.assignees || []).some(a => a && a.name && !isAdminKd(a) && deptOf(a) === k)) : []
  const M = memKeys.length
  const [autoLv, setAutoLv] = useState(0)
  const [stretched, setStretched] = useState(false)
  const cardRef = useRef(null)
  const capRef = useRef({ want: '', cap: 99 })
  const userOpenRef = useRef(false) // người dùng đã tự xổ nhóm nào đó: không vì thẻ dài ra mà ẩn Phòng / Quản lý / Khởi tạo
  useEffect(() => {
    const card = cardRef.current
    if (!card || typeof ResizeObserver === 'undefined') return undefined
    let raf = 0
    const fit = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const want = card.style.minHeight
        setStretched(!!want && !open)
        if (open) return
        if (!want) { setAutoLv(0); return }
        if (capRef.current.want !== want) capRef.current = { want, cap: M + 4 }
        if (card.offsetHeight > parseFloat(want) + 2) {
          // tràn khung: bớt mức tự hiện; mức có bảng Phòng / Quản lý (2) thì giữ nếu chính người dùng vừa xổ nhóm làm thẻ dài ra
          setAutoLv(v => { if (v <= 3 && userOpenRef.current) return v; const k = Math.max(0, v - 1); capRef.current.cap = k; return k })
        }
        else setAutoLv(v => (v < Math.min(capRef.current.cap, M + 4) ? v + 1 : v))
      })
    }
    const ro = new ResizeObserver(fit)
    ro.observe(card)
    const mo = new MutationObserver(fit)
    mo.observe(card, { attributes: true, attributeFilter: ['style'] })
    fit()
    return () => { cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect() }
  }, [open, autoLv, M])
  const auto = !open && autoLv > M + 3
  const showMeta = open || autoLv >= 3
  const showMini = !showMeta && autoLv >= 1
  const full = open || auto
  // Nhóm có người: bấm tiêu đề nhóm để xổ / ẩn danh sách nhân viên (nhớ theo trình duyệt). Chưa bấm: theo mức tự hiện.
  const [grpOpen, setGrpOpen] = useState(() => { try { return JSON.parse(localStorage.getItem('kd-cd-owners-grp') || '{}') || {} } catch (e) { return {} } })
  userOpenRef.current = Object.keys(grpOpen).some(k => grpOpen[k] && memKeys.indexOf(k) >= 0)
  const autoOpen = k => !open && memKeys.indexOf(k) >= 0 && memKeys.indexOf(k) < autoLv - 3
  const gOpen = k => (k in grpOpen ? !!grpOpen[k] : autoOpen(k))
  const toggleGrp = k => setGrpOpen(s => { const n = { ...s, [k]: !(k in s ? s[k] : autoOpen(k)) }; try { localStorage.setItem('kd-cd-owners-grp', JSON.stringify(n)) } catch (e) { /* bỏ qua */ } return n })
  if (!l) return null
  /* i = vị trí trong l.assignees gốc (khớp leadOwner().idx) */
  const all = (l.assignees || []).map((a, i) => ({ a, i })).filter(x => x.a && x.a.name)
  const members = all.filter(x => !isAdminKd(x.a))
  const admins = all.filter(x => isAdminKd(x.a)).map(x => x.a.name)
  const main = leadOwner(l)
  const mainIdx = main ? main.idx : -1
  const groups = OWNER_GROUPS.map(g => ({ ...g, members: members.filter(x => deptOf(x.a) === g.key) }))
  return (
    <section className="cd-card cd-owners" ref={cardRef}>
      <div className="cd-card-h">
        <span className="cd-card-t">Phụ trách</span>
        <span className="cd-fold-sp" />
        {!(auto && !open) && <FoldBtn open={open} onClick={toggle} />}
        <button type="button" className="cd-link-btn acc" onClick={onEdit} title="Sửa người phụ trách">Sửa</button>
      </div>
      <div className={'cd-owners-list' + (stretched ? ' fill' : '')}>
        {groups.map(g => !full && !g.members.length ? (
          /* thu gọn: nhóm chưa có người gọn 1 dòng (tên nhóm · Chưa phân công · + Gán) */
          <div key={g.key} className="cd-grp cd-grp-mini">
            <span className="cd-grp-dot" style={{ background: g.color }} />
            <span className="cd-grp-mini-l">{g.label}</span>
            <span className="cd-grp-mini-v">Chưa phân công</span>
            <button type="button" className="cd-btn sm" onClick={onEdit} title={'Gán người nhóm ' + g.label}>+ Gán</button>
          </div>
        ) : (
          <div key={g.key} className="cd-grp">
            {g.members.length ? (
              <button type="button" className={'cd-grp-h cd-grp-tg' + (gOpen(g.key) ? ' on' : '')} aria-expanded={!!gOpen(g.key)} onClick={() => toggleGrp(g.key)}
                title={gOpen(g.key) ? 'Ẩn danh sách nhân viên' : 'Xem nhân viên phụ trách'}>
                <span className="cd-grp-dot" style={{ background: g.color }} /><span>{g.label}</span>
                <span className="cd-grp-n">{g.members.length}</span>
                {!gOpen(g.key) && <span className="cd-grp-names">{g.members.map(x => x.a.name).join(', ')}</span>}
                <svg className="cd-grp-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            ) : <div className="cd-grp-h"><span className="cd-grp-dot" style={{ background: g.color }} /><span>{g.label}</span></div>}
            {g.members.length ? (gOpen(g.key) ? g.members : []).map(({ a, i }) => {
              const isLead = i === mainIdx
              return (
                <div key={i} className={'cd-mem' + (isLead ? ' lead' : '')}>
                  <span className="cd-av">{lmInitials(a.name)}</span>
                  <span className="cd-mem-txt">
                    <b>{a.name}</b>
                    <em>{[a.role || 'Phụ trách', a.since ? 'Nhận từ ' + fmtSince(a.since) : ''].filter(Boolean).join(' · ')}</em>
                  </span>
                </div>
              )
            }) : (
              <div className="cd-mem empty">
                <span className="cd-av">—</span>
                <span className="cd-mem-txt"><b>Chưa phân công</b><em>{g.empty}</em></span>
                <button type="button" className="cd-btn sm" onClick={onEdit} title={'Gán người nhóm ' + g.label}>+ Gán</button>
              </div>
            )}
          </div>
        ))}
        {/* Phòng, Quản lý, Khởi tạo: khi Mở rộng, hoặc khi thẻ được kéo cao (đẩy xuống đáy thẻ, lấp chỗ trống) */}
        {showMeta && <>
        <div className="cd-owners-meta">
          {l.dept && <div className="cd-row"><span>Phòng</span><span>{DEPT_LABEL[l.dept] || l.dept}</span></div>}
          <div className="cd-row"><span>Quản lý</span><span>{l.manager || '—'}</span></div>
          {admins.length > 0 && <div className="cd-row cd-owners-admin"><span>Admin KD</span><span>{admins.join(', ')}</span></div>}
        </div>
        <div className="cd-owners-foot">Khởi tạo bởi {l.creator || '—'}{l.createdAt ? ' · ' + fmtD(l.createdAt) : ''}</div>
        </>}
        {showMini && (() => {
          const a = [l.dept ? (DEPT_LABEL[l.dept] || l.dept) : '', 'Quản lý: ' + (l.manager || '—'), admins.length ? 'Admin KD: ' + admins.join(', ') : ''].filter(Boolean).join('  ·  ')
          const b = 'Khởi tạo: ' + (l.creator || '—') + (l.createdAt ? ' · ' + fmtD(l.createdAt) : '')
          return (
            <div className="cd-owners-mini" title={a + '\n' + b}>
              {autoLv >= 2 ? <><span>{a}</span><span>{b}</span></> : <span>{a + '  ·  ' + b}</span>}
            </div>
          )
        })()}
      </div>
    </section>
  )
}
