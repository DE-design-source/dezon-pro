/* Dữ liệu trang Newsfeed (Dashboard) — lấy nguyên từ dashboard.html */

export const NEWS_POSTS = [
  {
    id: 'p1', cat: 'duan', pinned: true,
    author: 'Giám đốc', initials: 'GĐ', color: 'primary',
    time: 'Hôm nay · 08:30', badge: 'DỰ ÁN MỚI',
    title: 'Khởi công dự án mới: Biệt thự Song lập Thảo Điền',
    text: 'SiteFlow chính thức khởi công dự án Biệt thự Song lập Thảo Điền — quy mô 18 căn, tổng mức đầu tư dự kiến 42 tỷ đồng. Lễ động thổ diễn ra sáng nay với sự tham dự của toàn thể ban lãnh đạo và đối tác chiến lược.',
    readMore: true,
    media: { icon: 'building', gradient: 'linear-gradient(120deg, var(--primary), #6C9BEA)', ratio: '4 / 3' },
    likes: 142, comments: 38, shares: 12, liked: true,
    comment: { author: 'Giám đốc', initials: 'GĐ', color: 'primary', isAuthor: true, text: 'Cảm ơn cả nhà đã đồng hành, dự án chính thức khởi công từ hôm nay!', time: '17 tuần' },
  },
  { id: 'p2', cat: 'thongbao', author: 'Hành chính', initials: 'HC', color: 'success', time: 'Hôm nay · 07:00', badge: 'THÔNG BÁO', title: 'Nghỉ lễ Quốc khánh 2/9: Văn phòng đóng cửa 2 ngày', text: 'Toàn công ty nghỉ lễ từ 01/09 đến hết 02/09/2026. Công trường vẫn duy trì lịch thi công bình thường theo phân công của chỉ huy trưởng.', likes: 26, comments: 4, shares: 0 },
  { id: 'p3', cat: 'sukien', author: 'Giám đốc', initials: 'GĐ', color: 'attendance', time: 'Hôm qua · 16:10', badge: 'SỰ KIỆN', title: 'Họp toàn công ty quý 3 — 09:00 thứ Hai tuần sau', text: 'Tổng kết kết quả kinh doanh quý 3 và phương hướng quý 4. Địa điểm: Hội trường tầng 5, văn phòng chính. Yêu cầu toàn thể trưởng bộ phận tham dự.', likes: 51, comments: 9, shares: 0 },
  { id: 'p4', cat: 'giaithuong', author: 'Truyền thông', initials: 'TT', color: 'finance', time: '2 ngày trước', badge: 'GIẢI THƯỞNG', title: 'SiteFlow đạt giải "Nhà thầu uy tín 2026"', text: 'Giải thưởng do Hiệp hội Xây dựng trao tặng, ghi nhận chất lượng thi công và tiến độ bàn giao đúng cam kết trong 3 năm liên tiếp.', media: { icon: 'award', gradient: 'linear-gradient(120deg, var(--finance), #E0AC4F)', ratio: '1 / 1' }, likes: 210, comments: 47, shares: 33 },
  { id: 'p5', cat: 'duan', author: 'Anh Tuấn (PM)', initials: 'AT', color: 'primary', time: '3 ngày trước', badge: 'DỰ ÁN', title: 'Nghiệm thu hoàn thành phần thô — Riverside Tòa A', text: 'Toàn bộ phần thô Tòa A đã được tư vấn giám sát nghiệm thu đạt yêu cầu, chuyển sang giai đoạn hoàn thiện từ tuần sau.', likes: 33, comments: 6, shares: 0 },
  { id: 'p6', cat: 'nhansu', author: 'HR', initials: 'HR', color: 'attendance', time: '4 ngày trước', badge: 'NHÂN SỰ', title: 'Chào mừng 5 thành viên mới gia nhập Đội thi công B', text: 'Đội thi công B chính thức bổ sung 5 nhân sự mới nhằm đáp ứng tiến độ Riverside GĐ2 và chuẩn bị cho dự án Thảo Điền.', likes: 64, comments: 15, shares: 0 },
  { id: 'p7', cat: 'sukien', author: 'Công đoàn', initials: 'CĐ', color: 'attendance', time: '5 ngày trước', badge: 'SỰ KIỆN', title: 'Team building cuối năm dự kiến tổ chức tại Đà Lạt', text: 'Dự kiến diễn ra cuối tháng 12, công đoàn sẽ khảo sát nhu cầu đăng ký của toàn thể nhân viên trong tuần tới.', likes: 88, comments: 21, shares: 0 },
  { id: 'p8', cat: 'thongbao', author: 'HR', initials: 'HR', color: 'success', time: '1 tuần trước', badge: 'THÔNG BÁO', title: 'Cập nhật quy trình chấm công qua app từ 01/10', text: 'Toàn bộ nhân sự công trường chuyển sang chấm công bằng định vị GPS trên app SiteFlow, không dùng chấm công giấy từ tháng 10.', likes: 19, comments: 3, shares: 0 },
  { id: 'p9', cat: 'duan', author: 'Kinh doanh', initials: 'KD', color: 'primary', time: '1 tuần trước', badge: 'DỰ ÁN', title: 'Ký hợp đồng mới: Văn phòng cho thuê Q3 giai đoạn mở rộng', text: 'Hợp đồng mở rộng giai đoạn 2 chính thức được ký kết, dự kiến khởi công đầu quý 4/2026.', likes: 57, comments: 11, shares: 0 },
]

export const NEWS_FILTERS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'duan', label: 'Dự án' },
  { key: 'sukien', label: 'Sự kiện' },
  { key: 'giaithuong', label: 'Giải thưởng' },
  { key: 'thongbao', label: 'Thông báo' },
  { key: 'nhansu', label: 'Nhân sự' },
]

export const NF_TABS = [
  { key: 'tintuc', label: 'Tin tức' },
  { key: 'nhiemvu', label: 'Nhiệm vụ' },
]

/* "12 bình luận · 3 chia sẻ" (giống statsSummary) */
export function statsSummary(p) {
  const parts = []
  if (p.comments) parts.push(p.comments + ' bình luận')
  if (p.shares) parts.push(p.shares + ' chia sẻ')
  return parts.join(' · ')
}

/* ---------- Bảng xếp hạng nhiệm vụ (điểm thưởng) ---------- */
export const TASK_POINTS = [
  { name: 'Trần Anh', dept: 'Quản lý dự án', initials: 'TA', color: 'primary', week: 180, month: 640, quarter: 1850, year: 6200 },
  { name: 'Nguyễn Đức Anh', dept: 'Thi công', initials: 'ĐA', color: 'danger', week: 210, month: 590, quarter: 1720, year: 5800 },
  { name: 'Đặng Quốc Cường', dept: 'Kinh doanh', initials: 'QC', color: 'success', week: 165, month: 520, quarter: 1520, year: 5100 },
  { name: 'Đỗ Thảo Vy', dept: 'Marketing', initials: 'TV', color: 'attendance', week: 150, month: 470, quarter: 1380, year: 4600 },
  { name: 'Đỗ Thành Long', dept: 'Thi công', initials: 'TL', color: 'danger', week: 120, month: 410, quarter: 1230, year: 4100 },
  { name: 'Hoàng Yến Nhi', dept: 'Kinh doanh', initials: 'YN', color: 'success', week: 110, month: 365, quarter: 1080, year: 3600 },
  { name: 'Cao Nhật Tân', dept: 'Vận hành', initials: 'NT', color: 'finance', week: 95, month: 320, quarter: 940, year: 3200 },
  { name: 'Ngọc Hà', dept: 'Marketing', initials: 'NH', color: 'attendance', week: 80, month: 270, quarter: 800, year: 2700 },
  { name: 'Minh Quân', dept: 'Marketing', initials: 'MQ', color: 'attendance', week: 70, month: 230, quarter: 690, year: 2300 },
  { name: 'Vũ Thị Diệu', dept: 'Thi công', initials: 'VD', color: 'danger', week: 55, month: 185, quarter: 560, year: 1900 },
  { name: 'Thuỳ Dương', dept: 'Marketing', initials: 'TD', color: 'attendance', week: 40, month: 145, quarter: 430, year: 1450 },
]

export const RANK_PERIODS = [
  { key: 'week', label: 'Tuần này' },
  { key: 'month', label: 'Tháng này' },
  { key: 'quarter', label: 'Quý này' },
  { key: 'year', label: 'Năm nay' },
]

export const NF_CURRENT_USER = 'Trần Anh'
export const NF_MEDAL_BG = ['#E0AC4F', '#B7C1CE', '#C9945B']
export const NF_MEDAL_FG = ['#5A3E0B', '#3D4450', '#4A2E15']
export const fmtPoints = n => n.toLocaleString('vi-VN')

/* ---------- Dezbot (khung nhúng cột phải) ---------- */
export const AI_KB = {
  tiendo: 'Dự án "Chung cư Riverside GĐ2" đang hoàn thành 62% khối lượng — đúng tiến độ tổng thể. Hạng mục "Hoàn thiện" có 2 đầu việc đang trễ hạn, cần ưu tiên xử lý trong tuần này.',
  chamcong: 'Hôm nay có 18/21 nhân sự đã chấm công đúng giờ, 2 người chấm công trễ và 1 người xin nghỉ phép. Tỷ lệ chuyên cần tuần này đạt 94%.',
  dongtien: 'Dòng tiền tháng này: Thu về 1.85 tỷ, Chi ra 1.42 tỷ — dương 430 triệu. Có 3 hoá đơn nhà cung cấp sắp đến hạn thanh toán trong 7 ngày tới.',
  khachhang: 'Hiện có 12 khách hàng đang trong giai đoạn đàm phán, 4 khách vừa ký hợp đồng trong tuần này. Cơ hội "Nhà phố Lô B12" có giá trị lớn nhất, đang chờ chốt hợp đồng.',
  tinnhan: 'Bạn có 6 tin nhắn chưa đọc trong Chat, tập trung ở nhóm "Dự án Riverside" và "Ban giám đốc". Muốn mình tóm tắt nội dung chính không?',
  boctach: 'Bóc tách khối lượng mới nhất từ QS ghi nhận tổng giá trị vật tư khoảng 11.93 triệu trên 5 đơn mua hàng, trong đó 2 đơn chưa đặt hàng.',
  quytrinh: 'Quy trình thi công hiện tại gồm 5 bước: Khảo sát → Thiết kế → Xin phép → Thi công → Nghiệm thu. Bước "Thi công" đang được nhiều dự án thực hiện nhất.',
  default: 'Mình đã tra trong dữ liệu workspace nhưng chưa tìm thấy câu trả lời chính xác cho câu hỏi này — bạn thử hỏi cụ thể hơn về tiến độ, chấm công, dòng tiền, khách hàng, bóc tách hoặc quy trình nhé.',
}

/* Thứ tự kiểm tra từ khoá giữ nguyên như bản HTML */
export function matchTopic(text) {
  const t = text.toLowerCase()
  const has = (...kws) => kws.some(k => t.includes(k))
  if (has('tiến độ', 'tien do', 'dự án')) return 'tiendo'
  if (has('chấm công', 'nhân công', 'nhân sự', 'nghỉ phép')) return 'chamcong'
  if (has('dòng tiền', 'hoá đơn', 'hóa đơn', 'thu', 'chi')) return 'dongtien'
  if (has('khách hàng', 'hợp đồng')) return 'khachhang'
  if (has('tin nhắn', 'chat')) return 'tinnhan'
  if (has('bóc tách', 'mua hàng', 'vật tư')) return 'boctach'
  if (has('quy trình')) return 'quytrinh'
  return 'default'
}

export const AI_CHIPS = [
  { topic: 'tiendo', label: 'Tiến độ', question: 'Tiến độ dự án đang thế nào?' },
  { topic: 'chamcong', label: 'Chấm công', question: 'Tình hình chấm công hôm nay?' },
  { topic: 'dongtien', label: 'Dòng tiền', question: 'Dòng tiền tháng này ra sao?' },
  { topic: 'khachhang', label: 'Khách hàng', question: 'Khách hàng nào đang tiềm năng?' },
  { topic: 'tinnhan', label: 'Tin nhắn', question: 'Tôi có tin nhắn nào chưa đọc?' },
]
