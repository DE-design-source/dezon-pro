/* Hàm thuần dùng cho tab Admin / Công ty / thông báo — port nguyên văn từ bản gốc. Không React, không fetch.
   Nguồn: admActionLabel_ PUB/admin.js:4 · fmtDateTime_ sanpham.js:1988-1992 · DX_TEN_/DX_ICO_/dxStatusCls_ muahang.js:355-358
   · nhãn trạng thái đơn admin.js:79,116 · imgSrc1_ nhap.js:350 · CT_FEATURES congty.js:5-7 · ngayConLai congty.js:15-16 */
import { mediaUrl } from '../../api/files'

export function admActionLabel_(a) { var m = { loi_giao_dien: 'Lỗi giao diện', login: 'Đăng nhập', logout: 'Đăng xuất', login_fail: 'ĐN lỗi', create_user: 'Tạo TK', update_user: 'Sửa TK', delete_user: 'Xóa TK', reset_password: 'Đặt lại MK', change_password: 'Đổi MK', lock_user: 'Khóa TK', unlock_user: 'Mở khóa' }; return m[a] || a }

export function fmtDateTime_(v) {
  if (v == null || v === '') return '—'
  var d = new Date(v); if (isNaN(d.getTime())) return String(v)
  var z = function (n) { return (n < 10 ? '0' : '') + n }
  return z(d.getDate()) + '/' + z(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + z(d.getHours()) + ':' + z(d.getMinutes())
}

/* Trạng thái đơn mua hàng -> lớp màu badge */
export const PUR_CLS = { 'Đã duyệt': 'approved', 'Từ chối': 'rejected', 'Chờ duyệt': 'pending', 'Đã gửi': 'pending' }
export const DRQ_LBL = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' }
export const ROLE_LBL = { super: 'Quản trị hệ thống', admin: 'Admin công ty', staff: 'Nhân viên' }
export const DX_TEN_ = { ck: 'Đề xuất chiết khấu', tt: 'Đề xuất thanh toán' }
export const DX_ICO_ = { ck: 'gauge', tt: 'money' }
/* Lý do xoá / lý do từ chối yêu cầu xoá: tối đa 500 ký tự (máy chủ cũng kiểm, M15.2) */
export const LY_DO_MAX = 500

/* Kết quả gửi thẻ Lark của đơn mua hàng (ket_qua_gui, M9.1). 'ok' của đơn tạo trước bản này là giá trị mặc định lúc lưu,
   không phải xác nhận đã tới Lark (giả định ghi ở roadmap). */
export function larkLbl_(v) { return v === 'ok' ? 'Đã gửi' : (v === 'loi' ? 'Lỗi gửi Lark' : 'Chưa rõ') }
export function larkCls_(v) { return v === 'ok' ? 'ok' : (v === 'loi' ? 'loi' : 'unk') }

export function dxStatusCls_(st) { return { 'Đã duyệt': 'approved', 'Từ chối': 'rejected', 'Chờ duyệt': 'pending' }[st] || 'pending' }

/* Ảnh đầu tiên của ô nhiều dòng, URL tuyệt đối tới máy chủ Go (imgSrc1_ + mediaUrl) */
export function imgSrc1_(v) { return mediaUrl(String(v || '').split('\n')[0].trim()) }

export const CT_FEATURES = [['dash', 'Bảng điều khiển'], ['boc', 'Bóc tách'], ['chiphi', 'Chi phí'],
  ['export', 'Xuất báo giá'], ['muahang', 'Mua hàng'], ['duan', 'Dự án'],
  ['sanpham', 'Danh sách sản phẩm'], ['import', 'Nhập dữ liệu'], ['kinhdoanh', 'Kinh doanh'], ['thietke', 'Quản lý thiết kế'], ['thicong', 'Quản lý dự án (thi công)']]

/* Số ngày còn lại tới hạn dùng (âm = đã hết hạn), null = không giới hạn */
export function ngayConLai(h) {
  if (!h) return null
  var today = new Date(new Date().toDateString())
  return Math.round((new Date(h) - today) / 86400000)
}
