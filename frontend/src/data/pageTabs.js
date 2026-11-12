/* Các module (tab đầu trang) của từng trang chính - dùng cho Cài đặt > Hiển thị (bật / tắt từng tab, hooks/usePageTabs.js).
   tabs = [[khoá, nhãn]] đúng thứ tự trên thanh tab của trang. Trang nào giữ danh sách tab ở file dữ liệu riêng thì lấy từ đó;
   các trang còn lại (Quản lý thiết kế, Quản lý dự án, Mua hàng, IT, R&D, BIM) lấy danh sách tab ở đây. */
import { MAIN_TABS as MK_TABS } from './marketingData'
import { SALES_TABS } from './kinhDoanhData'
import { SX_TABS } from './sanXuatData'
import { FIN_CATEGORIES } from './taiChinhData'

export const TK_TABS = [
  { key: 'list', label: 'Danh sách dự án' },
  { key: 'create', label: 'Thiết lập thiết kế' },
  { key: 'tiendo', label: 'Tiến độ' },
  { key: 'nhiemvu', label: 'Nhiệm vụ' },
  { key: 'nhansu', label: 'Cơ cấu phòng ban' },
]
export const DA_TABS = [
  { key: 'list', label: 'Danh sách dự án' },
  { key: 'create', label: 'Thiết lập thi công' },
  { key: 'tiendo', label: 'Tiến độ' },
  { key: 'nhiemvu', label: 'Nhiệm vụ' },
  { key: 'nhansu', label: 'Cơ cấu phòng ban' },
]
export const MH_TABS = [{ key: 'main', label: 'Bảng điều khiển' }, { key: 'nhansu', label: 'Cơ cấu phòng ban' }]
export const IT_TABS = [{ key: 'main', label: 'Bảng điều khiển' }, { key: 'thietbi', label: 'Thiết bị & tài sản' }, { key: 'nhansu', label: 'Cơ cấu phòng ban' }]
export const RD_TABS = [{ key: 'main', label: 'Tổng quan' }, { key: 'nhansu', label: 'Cơ cấu phòng ban' }]
export const BIM_TABS = [{ key: 'main', label: 'Tổng quan' }, { key: 'nhansu', label: 'Cơ cấu phòng ban' }]
/* Tài chính: danh mục chi phí + tab Cơ cấu phòng ban (khoá 'cocau' vì danh mục "Nhân sự" đã dùng khoá 'nhansu') */
export const TC_COCAU = 'cocau'
/* QS: 6 tab chính (QS.jsx TABS) */
export const QS_TABS = [['dash', 'Bảng điều khiển'], ['boc', 'Bóc tách'], ['chiphi', 'Chi phí'], ['export', 'Xuất báo giá'], ['muahang', 'Mua hàng'], ['duan', 'Dự án']]

const kl = list => list.map(t => [t.key, t.label])
export const PAGE_TABS = [
  { path: '/marketing', label: 'Marketing', tabs: MK_TABS.map(t => [t.id, t.label]) },
  { path: '/kinh-doanh', label: 'Kinh doanh', tabs: SALES_TABS.map(t => [t[0], t[1]]) },
  { path: '/quan-ly-thiet-ke', label: 'Quản lý thiết kế', tabs: kl(TK_TABS) },
  { path: '/du-an', label: 'Quản lý dự án', tabs: kl(DA_TABS) },
  { path: '/tai-chinh', label: 'Tài chính', tabs: kl(FIN_CATEGORIES).concat([[TC_COCAU, 'Cơ cấu phòng ban']]) },
  { path: '/qs', label: 'QS', tabs: QS_TABS },
  { path: '/bim', label: 'BIM', tabs: kl(BIM_TABS) },
  { path: '/mua-hang', label: 'Mua hàng', tabs: kl(MH_TABS) },
  { path: '/san-xuat', label: 'Sản xuất', tabs: kl(SX_TABS) },
  { path: '/it', label: 'IT', tabs: kl(IT_TABS) },
  { path: '/rd', label: 'R&D', tabs: kl(RD_TABS) },
]
export const pageTabKeys = path => ((PAGE_TABS.find(p => p.path === path) || { tabs: [] }).tabs).map(t => t[0])
