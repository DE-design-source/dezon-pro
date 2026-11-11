package chat

import (
	"bytes"
	"encoding/json"
)

// Dữ liệu vào / ra của phần quản trị nhóm (migration 0022, API.md mục "Quản trị nhóm"): @nhắc tên, thông tin + cài đặt
// nhóm, chuyển trưởng nhóm, giải tán, link mời, yêu cầu vào nhóm.

// Giới hạn của phần quản trị nhóm (API.md mục "Quản trị nhóm" - Giới hạn).
const (
	MentionAll           int64 = 0       // Mention.UserID của @Tất cả
	maxMentions                = 50      // số lượt nhắc tên tối đa mỗi tin (ck_chat_messages_mentions)
	maxDescription             = 500     // ký tự của mô tả nhóm (ck_chat_conversations_description)
	inviteMinExpiresIn         = 3600    // expires_in tối thiểu (giây) = 1 giờ
	inviteMaxExpiresIn         = 2592000 // expires_in tối đa (giây) = 30 ngày
	maxJoinRequestList         = 500     // số yêu cầu chờ duyệt trả về tối đa
	InviteJoinPathPrefix       = "/chat/join/"
)

// Mention: một lượt @nhắc tên trong content. Offset / Length tính theo đơn vị UTF-16 (chỉ số chuỗi của JavaScript) trên
// content ĐÃ cắt khoảng trắng; content[Offset] là '@', Length >= 2 (gồm cả '@'). UserID = 0 (MentionAll) là @Tất cả.
type Mention struct {
	UserID int64 `json:"user_id"`
	Offset int   `json:"offset"`
	Length int   `json:"length"`
}

// GroupSettingsDTO: 3 cờ quyền của nhóm (chat_conversations.is_admin_only_*). Conversation.settings = null với chat 1-1
// và dòng đã rời.
type GroupSettingsDTO struct {
	AdminsOnlySend       bool `json:"admins_only_send"`
	AdminsOnlyEditInfo   bool `json:"admins_only_edit_info"`
	AdminsOnlyAddMembers bool `json:"admins_only_add_members"`
}

// GroupInfoDTO: data của gói conversation.updated (giống nhau với mọi người nhận, không có phần riêng của từng người).
type GroupInfoDTO struct {
	ConversationID int64             `json:"conversation_id"`
	Name           *string           `json:"name"`
	Description    *string           `json:"description"`
	Avatar         *MediaDTO         `json:"avatar"`
	Settings       *GroupSettingsDTO `json:"settings"`
	Disbanded      bool              `json:"disbanded"`
	UpdatedAt      string            `json:"updated_at"`
}

// MembersUpdatedDTO: data của gói members.updated (client mở chi tiết nhóm thì tải lại GET /conversations/:id).
type MembersUpdatedDTO struct {
	ConversationID int64 `json:"conversation_id"`
	MemberCount    int64 `json:"member_count"`
}

// JoinRequestsUpdatedDTO: data của gói join_requests.updated (chỉ trưởng / phó nhóm nhận).
type JoinRequestsUpdatedDTO struct {
	ConversationID int64 `json:"conversation_id"`
	PendingCount   int64 `json:"pending_count"`
}

// InviteLinkDTO: link mời đang hiệu lực của nhóm. Token / URLPath CHỈ có trong kết quả tạo link (server chỉ lưu sha256).
type InviteLinkDTO struct {
	ID               int64   `json:"id"`
	ConversationID   int64   `json:"conversation_id"`
	RequiresApproval bool    `json:"requires_approval"`
	ExpiresAt        *string `json:"expires_at"`
	Expired          bool    `json:"expired"`
	UseCount         int64   `json:"use_count"`
	CreatedBy        int64   `json:"created_by"`
	CreatedByName    string  `json:"created_by_name"`
	CreatedAt        string  `json:"created_at"`
	Token            string  `json:"token,omitempty"`
	URLPath          string  `json:"url_path,omitempty"`
}

// InviteLinkResult: kết quả GET / POST /conversations/:id/invite-link (GET: null khi nhóm chưa có link hiệu lực).
type InviteLinkResult struct {
	InviteLink *InviteLinkDTO `json:"invite_link"`
}

// InviteGroupDTO: nhóm nhìn từ người cầm link (chưa chắc là thành viên): không lộ thành viên, không lộ id.
type InviteGroupDTO struct {
	Name        string    `json:"name"`
	Description *string   `json:"description"`
	Avatar      *MediaDTO `json:"avatar"`
	MemberCount int64     `json:"member_count"`
}

// Membership của người xem link mời (InvitePreviewDTO.Membership).
const (
	MembershipNone    = "none"
	MembershipMember  = "member"
	MembershipPending = "pending"
)

// InvitePreviewDTO: kết quả GET /invites/:token. ConversationID chỉ có khi Membership = member.
type InvitePreviewDTO struct {
	Group            InviteGroupDTO `json:"group"`
	RequiresApproval bool           `json:"requires_approval"`
	ExpiresAt        *string        `json:"expires_at"`
	Membership       string         `json:"membership"`
	ConversationID   *int64         `json:"conversation_id"`
}

// Kết quả tham gia qua link (JoinResultDTO.Status).
const (
	JoinJoined        = "joined"
	JoinPending       = "pending"
	JoinAlreadyMember = "already_member"
)

// JoinResultDTO: kết quả POST /invites/:token/join. ConversationID có khi joined / already_member; RequestID khi pending.
type JoinResultDTO struct {
	Status         string `json:"status"`
	ConversationID *int64 `json:"conversation_id"`
	RequestID      *int64 `json:"request_id"`
}

// JoinRequestDTO: một yêu cầu vào nhóm đang chờ duyệt.
type JoinRequestDTO struct {
	ID             int64   `json:"id"`
	ConversationID int64   `json:"conversation_id"`
	User           UserDTO `json:"user"`
	CreatedAt      string  `json:"created_at"`
}

// JoinRequestList: kết quả GET /conversations/:id/join-requests (cũ trước, tối đa maxJoinRequestList).
type JoinRequestList struct {
	Requests []JoinRequestDTO `json:"requests"`
}

// JoinRequestResult: kết quả approve / reject.
type JoinRequestResult struct {
	Status string `json:"status"` // approved / rejected
}

// ---- thân request ----

// OptionalID: khoá JSON có thể vắng (Set = false), null (Set = true, ID = nil) hoặc số (Set = true, ID != nil).
type OptionalID struct {
	Set bool
	ID  *int64
}

func (o *OptionalID) UnmarshalJSON(b []byte) error {
	o.Set = true
	if bytes.Equal(bytes.TrimSpace(b), []byte("null")) {
		o.ID = nil
		return nil
	}
	var id int64
	if err := json.Unmarshal(b, &id); err != nil {
		return err
	}
	o.ID = &id
	return nil
}

// OptionalString: như OptionalID cho chuỗi (vắng / null / chuỗi).
type OptionalString struct {
	Set   bool
	Value *string
}

func (o *OptionalString) UnmarshalJSON(b []byte) error {
	o.Set = true
	if bytes.Equal(bytes.TrimSpace(b), []byte("null")) {
		o.Value = nil
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	o.Value = &s
	return nil
}

// GroupInfoPatch: thân PATCH /conversations/:id (khoá vắng = giữ nguyên). Description "" / null = xoá mô tả;
// AvatarMediaID null = xoá ảnh nhóm.
type GroupInfoPatch struct {
	Name          *string        `json:"name"`
	Description   OptionalString `json:"description"`
	AvatarMediaID OptionalID     `json:"avatar_media_id"`
}

// GroupSettingsPatch: thân PATCH /conversations/:id/settings (khoá vắng = giữ nguyên).
type GroupSettingsPatch struct {
	AdminsOnlySend       *bool `json:"admins_only_send"`
	AdminsOnlyEditInfo   *bool `json:"admins_only_edit_info"`
	AdminsOnlyAddMembers *bool `json:"admins_only_add_members"`
}

// InviteCreateInput: thân POST /conversations/:id/invite-link. ExpiresIn: giây (3600..2592000), null / vắng = không hết hạn.
type InviteCreateInput struct {
	RequiresApproval bool   `json:"requires_approval"`
	ExpiresIn        *int64 `json:"expires_in"`
}

// transferOwnerBody: thân POST /conversations/:id/owner.
type transferOwnerBody struct {
	UserID int64 `json:"user_id"`
}
