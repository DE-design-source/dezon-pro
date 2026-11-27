/* Các module (tab đầu trang) của từng trang chính - dùng cho Cài đặt > Hiển thị (bật / tắt từng tab, hooks/usePageTabs.js).
   tabs = [[khoá, nhãn]] đúng thứ tự trên thanh tab của trang. Trang nào giữ danh sách tab ở file dữ liệu riêng thì lấy từ đó;
   các trang còn lại (Quản lý thiết kế, Quản lý dự án, Mua hàng, IT, R&D, BIM) lấy danh sách tab ở đây.
   module = khoá module của Phân quyền 3 cấp (N21, backend/internal/modules/access/catalog.json); khoá tab trùng khoá tab trong danh mục.
   Tab không có quyền xem thì không hiện (hooks/usePageTabs.js). */
import { MAIN_TABS as MK_TABS } from './marketingData'
import { SALES_TABS, SALES_ADMIN_TABS } from './kinhDoanhData'
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
  { path: '/marketing', module: 'marketing', label: 'Marketing', tabs: MK_TABS.map(t => [t.id, t.label]) },
  // free: tab không có trong danh mục phân quyền (access/catalog.json) - trang tự giới hạn theo vai trò (Cấu hình AI: quản trị)
  { path: '/kinh-doanh', module: 'kinhdoanh', label: 'Kinh doanh', tabs: SALES_TABS.map(t => [t[0], t[1]]), free: SALES_ADMIN_TABS },
  { path: '/quan-ly-thiet-ke', module: 'thietke', label: 'Quản lý thiết kế', tabs: kl(TK_TABS) },
  { path: '/du-an', module: 'thicong', label: 'Quản lý dự án', tabs: kl(DA_TABS) },
  { path: '/tai-chinh', module: 'taichinh', label: 'Tài chính', tabs: kl(FIN_CATEGORIES).concat([[TC_COCAU, 'Cơ cấu phòng ban']]) },
  { path: '/qs', module: 'qs', label: 'QS', tabs: QS_TABS },
  { path: '/bim', module: 'bim', label: 'BIM', tabs: kl(BIM_TABS) },
  { path: '/mua-hang', module: 'muahang', label: 'Mua hàng', tabs: kl(MH_TABS) },
  { path: '/san-xuat', module: 'sanxuat', label: 'Sản xuất', tabs: kl(SX_TABS) },
  { path: '/it', module: 'it', label: 'IT', tabs: kl(IT_TABS) },
  { path: '/rd', module: 'rd', label: 'R&D', tabs: kl(RD_TABS) },
]
export const pageTabKeys = path => ((PAGE_TABS.find(p => p.path === path) || { tabs: [] }).tabs).map(t => t[0])
