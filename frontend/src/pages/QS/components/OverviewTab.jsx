import { useMemo, useRef, useState } from 'react'
import { useQs } from '../state/QsData'
import { dashTotals_, cpTong_ } from '../lib/totals.js'
import { money } from '../lib/format.js'
import { projectGroups } from '../lib/dashModel.js'
import StatusView from './common/StatusView'
import KpiCard from './dashboard/KpiCard'
import ProjectList from './dashboard/ProjectList'
import GroupValueCard from './dashboard/GroupValueCard'
import QuickActions from './dashboard/QuickActions'
import ProjectDialogs from './project/ProjectDialogs'
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
  const { cur, lines, projects, projData, status } = useQs()
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
  const m = v => (ok ? money(v) + ' đ' : (pd.err ? '—' : 'Đang tải…'))

  /* Độ rộng cột phải (px của vùng QS), kéo vạch giữa 2 cột; nhớ ở localStorage qs_dash_side_w */
  const [sideW, setSideW] = useState(readSide_)
  const saveSide = w => { setSideW(w); try { localStorage.setItem(SIDE_LS, String(w)) } catch (e) { /* bỏ qua */ } }
  const mainRef = useRef(null)
  const drag = useRef(null)
  function splitDown(e) {
    const main = mainRef.current
    if (!main) return
    e.preventDefault()
    // vùng QS bị zoom: đổi px màn hình -> px CSS; cột trái giữ tối thiểu SIDE_LEFT_MIN
    const z = (main.getBoundingClientRect().width / main.offsetWidth) || 1
    drag.current = { x: e.clientX, w: sideW, z, max: Math.max(SIDE_MIN, Math.min(SIDE_MAX, main.offsetWidth - SIDE_LEFT_MIN)) }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function splitMove(e) {
    const d = drag.current
    if (d) setSideW(Math.min(d.max, Math.max(SIDE_MIN, Math.round(d.w - (e.clientX - d.x) / d.z))))
  }
  function splitUp() {
    if (!drag.current) return
    drag.current = null
    setSideW(w => { try { localStorage.setItem(SIDE_LS, String(w)) } catch (e) { /* bỏ qua */ } return w })
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
      {/* Lưới 2 cột (cột phải rộng --dash-side-w, kéo vạch giữa để đổi): hàng 1 = 4 KPI | KPI Lợi nhuận,
          hàng 2 = Danh sách dự án | Giá trị theo nhóm + Thao tác nhanh -> KPI thẳng mép với 2 cột bên dưới */}
      <div className="qs-dash-main" ref={mainRef} style={{ '--dash-side-w': sideW + 'px' }}>
        {has && (
          <div className="qs-dash-kpi-grid">
            <KpiCard icon="listLines" tone="blue" value={T.n} label="Dòng sản phẩm" note="toàn dự án" />
            <KpiCard icon="lock" tone="gray" value={m(T.von)} label="Giá vốn" note="toàn dự án" />
            <KpiCard icon="banknote" tone="blue" value={m(T.ban)} label="Giá bán" note="chưa VAT" />
            <KpiCard icon="fileText" tone="gray" value={m(T.total)} label="Tổng thanh toán" note={'gồm VAT ' + T.vatPct + '%'} />
          </div>
        )}
        {has && (
          <div className="qs-dash-kpi-side">
            <KpiCard icon="gauge" tone={ok && T.ln < 0 ? 'red' : 'green'} value={m(T.ln)} label="Lợi nhuận" note={(ok ? T.bien.toFixed(1) : '—') + '% biên'}
              positive={ok && T.ln >= 0} negative={ok && T.ln < 0} />
          </div>
        )}
        <span className="qs-dash-split" role="separator" aria-orientation="vertical" aria-label="Độ rộng cột phải"
          title="Kéo để đổi độ rộng 2 cột · nhấp đúp: mặc định"
          onPointerDown={splitDown} onPointerMove={splitMove} onPointerUp={splitUp} onPointerCancel={splitUp}
          onDoubleClick={() => saveSide(SIDE_DEF)} />
        <ProjectList groups={groups} curMa={has ? cur.maDA : ''} />
        <div className="qs-dash-side">
          {has && <GroupValueCard groups={ok ? T.groups.map(g => ({ key: g.k, name: g.ten, value: g.ban, pct: g.pct })) : null} wait={pd.err ? 'Chưa tải được dữ liệu dự án.' : 'Đang tải…'} />}
          <QuickActions />
        </div>
      </div>
      <ProjectDialogs />
    </>
  )
}
