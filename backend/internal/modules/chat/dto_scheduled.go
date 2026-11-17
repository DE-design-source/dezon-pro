package chat

// Dữ liệu vào / ra của tin hẹn giờ (migration 0049, service_scheduled.go, API.md mục "Tin hẹn giờ").

// ScheduledDTO: một tin hẹn giờ. Mentions luôn là mảng ([] = không nhắc ai); MessageID / Error chỉ có khi đã gửi / lỗi
// (gói scheduled.updated).
type ScheduledDTO struct {
	ID               int64     `json:"id"`
	ConversationID   int64     `json:"conversation_id"`
	Content          string    `json:"content"`
	Mentions         []Mention `json:"mentions"`
	ReplyToMessageID *int64    `json:"reply_to_message_id"`
	SendAt           string    `json:"send_at"`
	Status           string    `json:"status"`
	CreatedAt        string    `json:"created_at"`
	MessageID        *int64    `json:"message_id,omitempty"`
	Error            *string   `json:"error,omitempty"`
}

// ScheduledList: kết quả GET /conversations/:id/scheduled.
type ScheduledList struct {
	Items []ScheduledDTO `json:"items"`
}

// ScheduleInput: thân POST /conversations/:id/scheduled. SendAt: RFC3339 (có múi giờ).
type ScheduleInput struct {
	Content          string    `json:"content"`
	SendAt           string    `json:"send_at"`
	Mentions         []Mention `json:"mentions"`
	ReplyToMessageID int64     `json:"reply_to_message_id"`
}

// SchedulePatch: thân PATCH /scheduled/:sid (khoá vắng = giữ nguyên). Đổi content mà không gửi mentions = bỏ hết nhắc tên
// (offset cũ không còn đúng); chỉ gửi mentions = kiểm trên content hiện tại.
type SchedulePatch struct {
	Content  *string   `json:"content"`
	SendAt   *string   `json:"send_at"`
	Mentions []Mention `json:"mentions"`
}
