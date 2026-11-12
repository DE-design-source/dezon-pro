/* Tổng quan Mua hàng: gom thông tin mua hàng của 3 bộ phận về 1 danh sách chung, chỉ đọc.
   - QS: đơn mua hàng (GET /projects/:maDA/purchase-orders) + phiếu đề xuất CK / TT (GET /projects/:maDA/proposals) của mọi bản nháp.
   - Quản lý thiết kế (kind design) / Quản lý dự án (kind construction): purchaseItems trong công việc của từng dự án
     (GET /delivery/projects?kind=, rồi GET /delivery/projects/:id); bước quy trình lấy theo task.purchaseFlow || PO_STAGES.
   Mỗi nguồn tải riêng: lỗi / thiếu quyền ở 1 nguồn không chặn nguồn khác. Tiền luôn quy về đồng (delivery ghi triệu). */
import { request, enc } from '../QS/api/http'
import * as qsApi from '../QS/api/qsApi'
import { canTab } from '../../services/workSession'
import { PO_STAGES } from '../../data/quanLyThietKeData'
import { poCalc } from '../QuanLyThietKe/components/PoDetailFields'

export const SOURCES = [
  { key: 'qs', label: 'QS', page: '/qs', pageLabel: 'QS' },
  { key: 'tk', label: 'Thiết kế', page: '/quan-ly-thiet-ke', pageLabel: 'Quản lý thiết kế', kind: 'design', tab: 'thietke' },
  { key: 'da', label: 'Dự án', page: '/du-an', pageLabel: 'Quản lý dự án', kind: 'construction', tab: 'thicong' },
]
export const SRC = Object.fromEntries(SOURCES.map(s => [s.key, s]))

/* Nhóm trạng thái chung (lọc + thống kê); nhãn gốc của từng nguồn giữ ở r.stLabel */
export const GROUPS = [
  { key: 'cho', label: 'Chờ duyệt' },
  { key: 'xuly', label: 'Đang xử lý' },
  { key: 'dat', label: 'Đã đặt hàng' },
  { key: 'xong', label: 'Hoàn tất' },
  { key: 'huy', label: 'Từ chối / huỷ' },
]
export const GRP = Object.fromEntries(GROUPS.map(g => [g.key, g]))

const QS_PO_GRP = { 'Chờ duyệt': 'cho', 'Đã duyệt': 'xuly', 'Đã đặt hàng': 'dat', 'Đã nhận hàng': 'xong', 'Từ chối': 'huy' }
const QS_DX_GRP = { 'Chờ duyệt': 'cho', 'Đã duyệt': 'xong', 'Từ chối': 'huy' }
const DX_TEN = { ck: 'Đề xuất chiết khấu', tt: 'Đề xuất thanh toán' }

/* Chạy fn trên từng phần tử, tối đa n lệnh cùng lúc; onStep báo tiến độ */
async function pool(list, n, fn, onStep) {
  const out = new Array(list.length)
  let i = 0
  const worker = async () => {
    while (i < list.length) {
      const k = i++
      try { out[k] = { ok: true, v: await fn(list[k]) } } catch (e) { out[k] = { ok: false, e } }
      if (onStep) onStep()
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker))
  return out
}

const errMsg = e => (e && e.message) || 'Lỗi không rõ'

async function loadQs(onStep, addTotal) {
  const projects = (await qsApi.getProjects()) || []
  const list = projects.filter(p => p && p.maDA && String(p.maDA).indexOf('__') !== 0)
  addTotal(list.length)
  const res = await pool(list, 4, p => Promise.all([qsApi.getPurchaseOrders(p.maDA), qsApi.getDeXuatList(p.maDA)]), onStep)
  const rows = []
  let fail = 0
  res.forEach((r, i) => {
    if (!r.ok) { fail++; return }
    const p = list[i]
    const project = [p.ten || p.maDA, p.tenBanNhap].filter(Boolean).join(' · ')
    ;(r.v[0] || []).forEach(o => rows.push({
      id: 'qs-po-' + o.maDon, src: 'qs', kind: 'Đơn mua hàng', code: o.maDon, project, maDA: p.maDA,
      title: o.hangMuc || '', supplier: o.ncc || '', value: Number(o.tongCong) || 0, date: o.ngayGui || '', dateLabel: 'Ngày gửi',
      grp: QS_PO_GRP[o.trangThai] || 'xuly', stLabel: o.trangThai || '—', owner: o.nguoiGui || '', dept: o.phongBan || '', note: o.ghiChu || '',
      count: Number(o.soSP) || (o.items || []).length,
      items: (o.items || []).map(x => ({ name: x.ten, sub: [x.thuongHieu, x.khuVuc].filter(Boolean).join(' · '), qty: x.sl, unit: x.dvt, value: x.thanhTien })),
    }))
    ;(r.v[1] || []).forEach(d => rows.push({
      id: 'qs-dx-' + d.ma, src: 'qs', kind: DX_TEN[d.loai] || 'Đề xuất', code: d.ma, project: d.project || project, maDA: p.maDA,
      title: d.hangMuc || '', supplier: d.supplier || '', value: Number(d.total) || 0, date: d.at || '', dateLabel: 'Ngày gửi',
      grp: QS_DX_GRP[d.status] || 'cho', stLabel: d.status || '—', owner: d.requester || '', dept: d.phongBan || '', note: d.ghiChu || '',
      count: Number(d.soDong) || (d.items || []).length,
      items: (d.items || []).map(x => ({ name: x.ten, sub: [x.thuongHieu, x.phong, x.ngay].filter(Boolean).join(' · '), qty: x.sl, unit: x.dvt, value: x.thanhTien })),
    }))
  })
  return { rows, projects: list.length, fail }
}

async function loadDelivery(s, onStep, addTotal) {
  const r = await request('GET', '/delivery/projects', { query: { kind: s.kind } })
  const list = (r && r.projects) || []
  addTotal(list.length)
  const res = await pool(list, 4, p => request('GET', '/delivery/projects/' + enc(p.id)), onStep)
  const rows = []
  let fail = 0
  res.forEach((x, i) => {
    if (!x.ok) { fail++; return }
    const p = list[i]
    ;((x.v && x.v.phases) || []).forEach(ph => (ph.tasks || []).forEach(t => {
      const flow = Array.isArray(t.purchaseFlow) && t.purchaseFlow.length ? t.purchaseFlow : PO_STAGES
      ;(t.purchaseItems || []).forEach(it => {
        const st = flow.find(f => f.key === it.stage) || null
        const c = poCalc(it, st)
        const grp = st && st.closed ? 'huy' : st && st.received ? 'xong' : st && st === flow[0] ? 'cho' : 'xuly'
        rows.push({
          id: s.key + '-' + p.id + '-' + t.id + '-' + it.id, src: s.key, kind: 'Yêu cầu mua hàng', code: it.code || '', project: p.name || '',
          deliveryId: p.id, title: it.item || '', task: t.name || '', supplier: it.supplier || '', value: (Number(it.value) || 0) * 1e6,
          date: it.due || '', dateLabel: 'Ngày cần hàng', grp, stLabel: (st && st.label) || it.stage || '—',
          level: grp === 'huy' || grp === 'xong' ? null : c.level, levelLabel: grp === 'huy' || grp === 'xong' ? '' : c.status || '',
          fromToday: c.fromToday, owner: [].concat(it.buyer || it.owner || []).join(', '), dept: it.dept || '', note: it.note || '',
          qty: it.qty || '', payment: it.payment || '', group: it.productGroup || '',
        })
      })
    }))
  })
  return { rows, projects: list.length, fail }
}

/* -> {rows, src:{qs|tk|da: {state:'ok'|'err'|'off', msg, projects, fail}}}; onProgress(done, total) */
export async function loadPurchaseHub(onProgress) {
  let done = 0, total = 0
  const step = () => { done++; if (onProgress) onProgress(done, total) }
  const addTotal = n => { total += n; if (onProgress) onProgress(done, total) }
  const jobs = SOURCES.map(async s => {
    if (s.tab && !canTab(s.tab)) return [s.key, { state: 'off', msg: 'Tài khoản chưa có quyền vào ' + s.pageLabel, rows: [] }]
    try {
      const r = s.key === 'qs' ? await loadQs(step, addTotal) : await loadDelivery(s, step, addTotal)
      return [s.key, { state: 'ok', ...r }]
    } catch (e) {
      return [s.key, { state: 'err', msg: errMsg(e), rows: [] }]
    }
  })
  const out = await Promise.all(jobs)
  const src = {}
  let rows = []
  out.forEach(([k, v]) => { src[k] = { state: v.state, msg: v.msg || '', projects: v.projects || 0, fail: v.fail || 0 }; rows = rows.concat(v.rows) })
  // phiếu còn mở lên trước (Chờ duyệt -> Đang xử lý -> Đã đặt -> Hoàn tất -> Từ chối / huỷ), cùng nhóm thì ngày mới trước
  const rank = Object.fromEntries(GROUPS.map((g, i) => [g.key, i]))
  rows.sort((a, b) => rank[a.grp] - rank[b.grp] || String(b.date).localeCompare(String(a.date)))
  return { rows, src }
}
