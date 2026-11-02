/* Dữ liệu trang Chat — lấy nguyên từ chat.html.
   Tin nhắn thật đi qua máy chủ chat (pages/Chat/state/chatStore.js); ở đây chỉ còn hội thoại cục bộ SiteFlow Bot,
   danh bạ công ty (điều phối phiếu yêu cầu ở RequestCard) và câu trả lời mẫu của Dezbot. */

export const COLORS = { blue:'#2F5DA8', teal:'#0E8A82', amber:'#B7791F', purple:'#7658C2', green:'#1E8E5A', pink:'#C2618F', gray:'#5B6472' };

/* Hội thoại cục bộ "SiteFlow Bot": thông báo hệ thống + phiếu yêu cầu từ trang Kinh doanh (kdRequestService) */
export const BOT_CONVERSATION = {
  id:'bot', type:'bot', name:'SiteFlow Bot', sub:'Thông báo hệ thống', icon:'bot', color:COLORS.gray, unread:2,
  members:[], files:[],
  messages:[
    {bot:true, level:'danger', time:'09:40', title:'Cảnh báo tiến độ', text:'Đổ bê tông sàn tầng 5 đang trễ 3 ngày so với kế hoạch (đường găng).', meta:'Dự án: Riverside — Giai đoạn 2'},
    {bot:true, level:'amber', time:'11:05', title:'Chấm công ngoài vùng', text:'1 nhân sự chấm công ngoài bán kính công trường tại Kho vật tư Bình Chánh, cần giám sát duyệt.', meta:'Module Chấm công'},
    {bot:true, level:'danger', time:'13:20', title:'Hoá đơn quá hạn', text:'Hoá đơn INV-0142 (620 triệu đ) của Khách hàng ABC đã quá hạn thanh toán 5 ngày.', meta:'Module Tài chính'},
    {bot:true, level:'info', time:'14:00', title:'Mốc nghiệm thu sắp tới', text:'Còn 7 ngày đến mốc "Nghiệm thu bàn giao tầng 1" (09/11).', meta:'Module Tiến độ'},
  ]
};

export const COMPANY_DIRECTORY = [
  {dept:'Ban giám đốc (BOD)', people:[
    {name:'Phạm Quốc Việt', role:'Tổng giám đốc', color:COLORS.blue},
    {name:'Đặng Thu Trang', role:'Phó tổng giám đốc', color:COLORS.purple},
  ]},
  {dept:'Kế toán - Tài chính', people:[
    {name:'Phan Bảo Ngọc', role:'Kế toán trưởng', color:COLORS.green},
    {name:'Vũ Thị Hạnh', role:'Kế toán viên', color:COLORS.green},
  ]},
  {dept:'Hành chính - Nhân sự', people:[
    {name:'Trịnh Minh Tâm', role:'Trưởng phòng HC-NS', color:COLORS.pink},
    {name:'Lý Ngọc Diệp', role:'Chuyên viên tuyển dụng', color:COLORS.pink},
  ]},
  {dept:'Kinh doanh', people:[
    {name:'Trần Anh', role:'Quản lý dự án', color:COLORS.purple},
    {name:'Bùi Xuân Mai', role:'Trưởng phòng Kinh doanh', color:COLORS.amber},
  ]},
  {dept:'Thiết kế', people:[
    {name:'Chị Hoa', role:'Tư vấn thiết kế', color:COLORS.pink},
    {name:'Ngô Anh Dũng', role:'Chủ trì thiết kế', color:COLORS.blue},
  ]},
  {dept:'QS - Dự toán', people:[
    {name:'Hoàng Gia Bảo', role:'Trưởng phòng QS', color:COLORS.teal},
  ]},
  {dept:'Thi công', people:[
    {name:'Nguyễn Đức Anh', role:'Chỉ huy trưởng', color:COLORS.blue},
    {name:'Đỗ Thành Long', role:'Tư vấn giám sát', color:COLORS.teal},
    {name:'Ngọc Hà', role:'Đội trưởng thi công B', color:COLORS.amber},
    {name:'Lê Văn', role:'Đội thi công A', color:COLORS.teal},
  ]},
  {dept:'Sản xuất', people:[
    {name:'Đinh Công Sơn', role:'Quản đốc xưởng mộc', color:COLORS.amber},
  ]},
  {dept:'Mua hàng', people:[
    {name:'Tô Kim Ngân', role:'Trưởng phòng Mua hàng', color:COLORS.green},
  ]},
  {dept:'IT', people:[
    {name:'Vương Đình Khoa', role:'Chuyên viên IT', color:COLORS.gray},
  ]},
  {dept:'R&D', people:[
    {name:'Lâm Thảo My', role:'Trưởng phòng R&D', color:COLORS.purple},
  ]},
  {dept:'Marketing', people:[
    {name:'Đoàn Bảo Trâm', role:'Trưởng phòng Marketing', color:COLORS.pink},
  ]},
];

/* ===================== Dezbot — câu trả lời mẫu (AI_KB trong chat.html) ===================== */
export const AI_KB = {
  tiendo: 'Dự án "Chung cư Riverside GĐ2" đang hoàn thành 62% khối lượng — đúng tiến độ tổng thể. Hạng mục "Hoàn thiện" có 2 đầu việc đang trễ hạn, cần ưu tiên xử lý trong tuần này.',
  chamcong: 'Hôm nay có 18/21 nhân sự đã chấm công đúng giờ, 2 người chấm công trễ và 1 người xin nghỉ phép. Tỷ lệ chuyên cần tuần này đạt 94%.',
  dongtien: 'Dòng tiền tháng này: Thu về 1.85 tỷ, Chi ra 1.42 tỷ — dương 430 triệu. Có 3 hoá đơn nhà cung cấp sắp đến hạn thanh toán trong 7 ngày tới.',
  khachhang: 'Hiện có 12 khách hàng đang trong giai đoạn đàm phán, 4 khách vừa ký hợp đồng trong tuần này. Cơ hội "Nhà phố Lô B12" có giá trị lớn nhất, đang chờ chốt hợp đồng.',
  tinnhan: 'Bạn có 2 tin nhắn chưa đọc từ SiteFlow Bot và Phan Bảo Ngọc. Cảnh báo gần nhất: hoá đơn INV-0142 đã quá hạn thanh toán 5 ngày.',
  boctach: 'Bóc tách khối lượng mới nhất từ QS ghi nhận tổng giá trị vật tư khoảng 11.93 triệu trên 5 đơn mua hàng, trong đó 2 đơn chưa đặt hàng.',
  quytrinh: 'Quy trình thi công hiện tại gồm 5 bước: Khảo sát → Thiết kế → Xin phép → Thi công → Nghiệm thu. Bước "Thi công" đang được nhiều dự án thực hiện nhất.',
  default: 'Mình đã tra trong dữ liệu workspace nhưng chưa tìm thấy câu trả lời chính xác cho câu hỏi này — bạn thử hỏi cụ thể hơn về tiến độ, chấm công, dòng tiền, khách hàng, bóc tách hoặc quy trình nhé.'
};

/* Câu hỏi gửi đi khi bấm chip chủ đề ở màn hình chào (labels trong chat.html) */
export const AI_TOPIC_LABELS = { tiendo:'Tiến độ dự án đang thế nào?', chamcong:'Tình hình chấm công hôm nay?', dongtien:'Dòng tiền tháng này ra sao?', khachhang:'Khách hàng nào đang tiềm năng?', tinnhan:'Tôi có tin nhắn nào chưa đọc?' };

/* Gợi ý nhanh phía trên ô nhập (data-ai-prompt trong chat.html) */
export const AI_SUGGESTS = ['Tôi có tin nhắn nào chưa đọc?', 'Tóm tắt hội thoại nhóm Riverside', 'Có cảnh báo nào từ SiteFlow Bot?'];
