/* Dữ liệu QS cho mọi tab — HỢP ĐỒNG useQs() (cố định từ Batch 0, chỉ được THÊM khoá):
   {
     projects, products, cur, selectProject(maDA) -> Promise<bool>,
     lines, projData, setProjData(k, v),
     node, setNode(code), hmNode, setHmNode(code, from?), hmFrom,
     congTac,
     reloadProducts(), reloadLines(), reloadProjects(),
     mutate: {
       createProject(d) -> Project (đã mở luôn), updateProject(maDA, fields) -> Project|null, deleteProject(maDA),
       duplicateProject(maDA, opts) -> Project,
       addLine(prod, soLuong, temp?) -> Line|null   (temp = dòng tạm hiện ngay, xem lib/calc addProdBuild_)
       addBlankLine({tang, nhom}) -> Line|null,
       updateLine(id, fields) -> Promise   (optimistic + recalcLine_, như editLine),
       deleteLines(ids, {confirm?}) -> số dòng đã xoá (nhiều dòng: hỏi "Không hoàn tác được"),
       moveLine(dragId, floor, targetId, before) -> [{lineId, old, new}]  (port tkMoveLine_, đánh STT cả dự án),
       reorderLines(arr), syncProj(p), newTmpId()
     },
     toast(msg), confirm(o) -> Promise<bool>, ask(o) -> Promise<value|null>   (components/common/dialogs),
     status: {auth, boot, bootStep, bootError, bootErrorKind, pdOk, pdErr, pdSeq, ctStatus, ctError},
       (pdErr = {maDA, msg} khi lần tải dữ liệu dự án gần nhất bị lỗi, null khi đang tải / đã tải xong)
     navigate(tab, intent?), consumeIntent(tab), panelVisible(tab) -> bool, visibleSeq(tab) -> số lần tab được hiện
   }
   Quy tắc: tab tải dữ liệu riêng (đơn hàng, tờ bìa, danh sách admin...) chạy lại khi visibleSeq(tab) đổi VÀ panelVisible(tab);
   không gọi API ghi từ effect. projData ghi qua setProjData (hàng đợi 1,2 s, khoá hợp lệ: phanTho, area, ptInfo, ptVat,
   cpCfg, bgCfg, bgHist, bgOrg, mhPay, btFmt).
   Trường store ngoài useQs(): selFloor (getState().selFloor, tầng đang chọn ở Bóc tách, null = chưa chọn; Bóc tách ghi bằng setState).
   Bộ tick dùng chung Bóc tách / Chi phí / Dự án: state/tickSel.js (useTicks, tickClick_, tickSet_, tickClear_). */
import { useEffect } from 'react'
import {
  useQsStore, attach, detach, selectProject, setNode, setHmNode, reloadProducts, reloadLines, reloadProjects,
  syncProj, newTmpId, showTab, consumeIntent,
} from './store'
/* Ghi qua qsGuard: kiểm quyền N21 (Module QS > Tab > Thao tác) trước khi gọi store */
import {
  createProject, updateProject, deleteProject, duplicateProject, addLine, addBlankLine, updateLine, deleteLines, moveLine, reorderLines,
} from './qsGuard'
import { projDataSet_ } from './projData'
import { qsToast, qsConfirm, qsAsk } from '../components/common/dialogs'

const mutate = {
  createProject, updateProject, deleteProject, duplicateProject,
  addLine, addBlankLine, updateLine, deleteLines, moveLine, reorderLines, syncProj, newTmpId,
}
const navigate = (tab, intent) => showTab(tab, intent)

/* Gắn store vào vòng đời trang /qs: mount -> bắt đầu phiên + thông báo; unmount -> dừng thông báo, đẩy hàng đợi
   projData, huỷ request đang chạy. Dữ liệu ở lại cho lần mount sau. */
export function QsDataProvider({ children }) {
  useEffect(() => {
    attach()
    return () => detach()
  }, [])
  return children
}

export function useQs() {
  const projects = useQsStore(s => s.projects)
  const products = useQsStore(s => s.products)
  const cur = useQsStore(s => s.cur)
  const lines = useQsStore(s => s.lines)
  const projData = useQsStore(s => s.projData)
  const node = useQsStore(s => s.node)
  const hmNode = useQsStore(s => s.hmNode)
  const hmFrom = useQsStore(s => s.hmFrom)
  const congTac = useQsStore(s => s.congTac)
  const tab = useQsStore(s => s.tab)
  const visSeq = useQsStore(s => s.visSeq)
  const auth = useQsStore(s => s.auth)
  const boot = useQsStore(s => s.boot)
  const bootStep = useQsStore(s => s.bootStep)
  const bootError = useQsStore(s => s.bootError)
  const bootErrorKind = useQsStore(s => s.bootErrorKind)
  const pdOk = useQsStore(s => s.pdOk)
  const pdErr = useQsStore(s => s.pdErr)
  const pdSeq = useQsStore(s => s.pdSeq)
  const ctStatus = useQsStore(s => s.ctStatus)
  const ctError = useQsStore(s => s.ctError)
  return {
    projects, products, cur, selectProject, lines, projData, setProjData: projDataSet_,
    node, setNode, hmNode, setHmNode, hmFrom, congTac,
    reloadProducts, reloadLines, reloadProjects, mutate,
    toast: qsToast, confirm: qsConfirm, ask: qsAsk,
    status: { auth, boot, bootStep, bootError, bootErrorKind, pdOk, pdErr, pdSeq, ctStatus, ctError },
    navigate, consumeIntent,
    panelVisible: t => tab === t,
    visibleSeq: t => visSeq[t] || 0,
  }
}
