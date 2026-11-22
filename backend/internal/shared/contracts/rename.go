package contracts

import "context"

// UserRenameListener - chủ: sales (chỉ bản Go). users gọi sau khi đổi họ tên tài khoản thành công (admin sửa hoặc tự sửa
// hồ sơ) để tên cũ đã lưu dạng chữ ở nơi khác (người phụ trách khách hàng...) đổi theo.
//
// companyID = công ty CỦA TÀI KHOẢN bị đổi (không phải của người sửa); falsy (super) -> không làm gì. Hàm tự đặt ngữ cảnh
// công ty đó, chỉ ghi dữ liệu của công ty đó. oldName / newName đã trim; chỉ gọi khi newName khác rỗng và khác oldName.
// Lỗi trả về chỉ để nơi gọi ghi log: không được làm hỏng kết quả đổi tên.
type UserRenameListener interface {
	UserRenamed(ctx context.Context, companyID any, username, oldName, newName string) error
}
