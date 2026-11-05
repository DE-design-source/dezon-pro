import { useEffect, useMemo, useRef, useState } from 'react'
import { useQs } from '../state/QsData'
import { dashTotals_, cpTong_ } from '../lib/totals.js'
import { nodeName } from '../lib/tree.js'
import { projectGroups } from '../lib/dashModel.js'
import { statCache, loadStats_ } from './project/projectStats'
import StatusView from './common/StatusView'
import ProjectList from './dashboard/ProjectList'
import DashSummary from './dashboard/DashSummary'
import QuickActions from './dashboard/QuickActions'
import ProjectDialogs from './project/ProjectDialogs'
import ProjectCreate from './project/ProjectCreate'
import { projCtx_, usePdState, pdRetry_ } from './project/projectShell'
import './dashboard/dashboard.css'

const SIDE_LS = 'qs_dash_side_w'
const SIDE_DEF = 380, SIDE_MIN = 280, SIDE_MAX = 760, SIDE_LEFT_MIN = 560
function readSide_() {
  try { const v = Number(localStorage.getItem(SIDE_LS)); return v >= SIDE_MIN && v <= SIDE_MAX ? v : SIDE_DEF } catch (e) { return SIDE_DEF }
}

/* Tab "Bảng điều khiển" (port renderDash, PUB/dash.js:142-195; shots tab-dash.png, tab-dash-emptyproject.png).
   Số liệu TOÀN DỰ ÁN của bản nháp đang mở (không theo hmNode): cpTong_(lines, '') = dòng + Phần thô - CK báo giá -> VAT.
   Props: onGoto (giữ để tương thích QS.jsx, không dùng: điều hướng qua useQs().navigate).
   Panel này luôn được mount nên cũng là nơi vẽ các hộp thoại của phần dự án (<ProjectDialogs/>).
   Danh sách dự án + hộp thoại giữ CÙNG vị trí trong cây ở mọi trạng thái (không mất ô tìm khi cur tạm null).
   Chưa có dữ liệu rời của bản nháp (projData) thì số tiền hiện "Đang tải…", lỗi thì báo + "Thử lại" (usePdState). */
export default function OverviewTab() {
  const { cur, lines, projects, projData, status, selectProject } = useQs()
  const pd = usePdState(cur, status)
  const T = useMemo(() => {
    if (!cur) return null
    const ctx = projCtx_(cur, projData)
    const r = dashTotals_(lines || [], ctx)
    r.ptErr = cpTong_(lines || [], '', ctx).ptErr || ''
    return r
  }, [cur, lines, projData])
  const groups = useMemo(() => projectGroups(projects), [projects])
  const has = !!(cur && T)
  const ok = has && pd.ready

  /* Cột trái cộng số của các dự án ĐANG HIỆN sau bộ lọc của Danh sách dự án (nguồn, thời gian, ô tìm).
     Mỗi dự án lấy 1 bản: bản đang mở (số trực tiếp T) hoặc bản nháp mới nhất (projectStats, đọc 1 lần / phiên) */
  const [flt, setFlt] = useState(null)   // {groups, label} do ProjectList báo lên
  const [, setStatVer] = useState(0)
  const fGroups = flt ? flt.groups : groups
  const curMa = cur ? cur.maDA : ''
  // rời bản đang mở -> bỏ số cũ trong bộ nhớ (có thể vừa sửa), lần sau đọc lại
  useEffect(() => () => { if (curMa) delete statCache[curMa] }, [curMa])
  // không chặn bằng cờ "alive": bản đang đọc dở từ lần lọc trước vẫn phải vẽ lại khi xong (loadStats_ bỏ qua mã đang đọc)
  useEffect(() => {
    loadStats_(fGroups.filter(g => !g.drafts.some(d => d.maDA === curMa)).map(g => g.drafts[g.drafts.length - 1]), () => setStatVer(v => v + 1))
  }, [fGroups, curMa])
  const A = (() => {
    const r = { n: 0, von: 0, ban: 0, total: 0, ln: 0, done: 0, fail: 0, vats: new Set() }
    const gm = {}
    fGroups.forEach(g => {
      const isCur = g.drafts.some(d => d.maDA === curMa)
      const st = isCur ? null : statCache[g.drafts[g.drafts.length - 1].maDA]
      const t = isCur ? (ok ? T : null) : (st && st.t)
      if (!t) { if (isCur ? pd.err : st && st.err) r.fail++; return }
      r.done++; r.n += t.n; r.von += t.von; r.ban += t.ban; r.total += t.total; r.ln += t.ln; r.vats.add(t.vatPct)
      t.groups.forEach(x => { gm[x.k] = (gm[x.k] || 0) + x.ban })
    })
    const byG = Object.keys(gm).map(k => ({ key: k, name: nodeName(k), value: gm[k] })).sort((a, b) => b.value - a.value)
    const max = byG.reduce((mx, x) => Math.max(mx, x.value), 1)
    byG.forEach(x => { x.pct = Math.round(x.value / max * 100) })
    r.groups = byG
    r.bien = r.ban > 0 ? r.ln / r.ban * 100 : 0
    r.ready = r.done + r.fail >= fGroups.length
    return r
  })()
  const nDa = fGroups.length

  /* Độ rộng cột phải (px của vùng QS), kéo vạch giữa 2 cột; nhớ ở localStorage qs_dash_side_w */
  const [sideW, setSideW] = useState(readSide_)
  const saveSide = w => { setSideW(w); try { localStorage.setItem(SIDE_LS, String(w)) } catch (e) { /* bỏ qua */ } }
  const mainRef = useRef(null)
  const drag = useRef(null)
  function splitDown(e) {
    const main = mainRef.current
    if (!main) return
    e.preventDefault()
    // vùng QS bị zoom: đổi px màn hình -> px CSS; cột danh sách dự án giữ tối thiểu SIDE_LEFT_MIN
    const z = (main.getBoundingClientRect().width / main.offsetWidth) || 1
    drag.current = { x: e.clientX, w: sideW, z, max: Math.max(SIDE_MIN, Math.min(SIDE_MAX, main.offsetWidth - SIDE_LEFT_MIN)) }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function splitMove(e) {
    const d = drag.current
    if (d) setSideW(Math.min(d.max, Math.max(SIDE_MIN, Math.round(d.w + (e.clientX - d.x) / d.z))))
  }
  function splitUp() {
    if (!drag.current) return
    drag.current = null
    setSideW(w => { try { localStorage.setItem(SIDE_LS, String(w)) } catch (e) { /* bỏ qua */ } return w })
  }

  /* Nút "Tạo dự án": trang nhập đủ trường như "Nhập dự án" của Danh sách dự án; Lưu = tạo + mở thành dự án đang làm */
  const [creating, setCreating] = useState(false)
  const toCreate = v => { setCreating(v); const sc = document.querySelector('.qs-scroll'); if (sc) sc.scrollTop = 0 }
  if (creating) {
    return (
      <>
        <ProjectCreate openOnSave onBack={() => toCreate(false)} onCreated={() => toCreate(false)}
          onOpen={async ma => { await selectProject(ma); toCreate(false) }} />
        <ProjectDialogs />
      </>
    )
  }

  return (
    <>
      {!has && <StatusView kind="empty" icon="layers" title="Chưa chọn bản nháp" message="Chọn một bản nháp bên dưới để xem tổng quan — hoặc tạo dự án mới." />}
      {has && !pd.ready && (
        <div className={`qsc-note qs-dash-pd${pd.err ? ' err' : ''}`} role={pd.err ? 'alert' : 'status'}>
          <span>{pd.err
            ? pd.err + ' Số tiền chưa hiện vì sẽ thiếu Phần thô và chiết khấu báo giá.'
            : 'Đang tải dữ liệu dự án (Phần thô, chiết khấu báo giá)…' + (pd.slow ? ' Lâu hơn bình thường.' : '')}</span>
          {(pd.err || pd.slow) && <button type="button" className="qsc-btn blue" onClick={() => pdRetry_(cur.maDA)}>Thử lại</button>}
        </div>
      )}
      {ok && T.ptErr && <div className="qsc-note err qs-dash-pd" role="alert">Phần thô lỗi, chưa tính vào tổng: {T.ptErr}</div>}
      {/* Lưới 2 cột (cột trái rộng --dash-side-w, kéo vạch giữa để đổi): cột trái = thẻ Tổng quan (cộng theo bộ lọc
          của Danh sách dự án) + Thao tác nhanh | Danh sách dự án */}
      <div className="qs-dash-main" ref={mainRef} style={{ '--dash-side-w': sideW + 'px' }}>
        <span className="qs-dash-split" role="separator" aria-orientation="vertical" aria-label="Độ rộng cột phải"
          title="Kéo để đổi độ rộng 2 cột · nhấp đúp: mặc định"
          onPointerDown={splitDown} onPointerMove={splitMove} onPointerUp={splitUp} onPointerCancel={splitUp}
          onDoubleClick={() => saveSide(SIDE_DEF)} />
        <div className="qs-dash-side">
          <DashSummary A={A} nDa={nDa} label={flt ? flt.label : ''} />
          <QuickActions />
        </div>
        <ProjectList groups={groups} curMa={has ? cur.maDA : ''} onCreate={() => toCreate(true)} onFilter={setFlt} />
      </div>
      <ProjectDialogs />
    </>
  )
}
