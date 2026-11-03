package chat

import (
	"encoding/json"
	"strings"
	"testing"
)

// Khoá vắng / null / có giá trị của thân PATCH /conversations/:id phải phân biệt được.
func TestGroupInfoPatchOptional(t *testing.T) {
	var p GroupInfoPatch
	if err := json.Unmarshal([]byte(`{"name":"A"}`), &p); err != nil {
		t.Fatal(err)
	}
	if p.Description.Set || p.AvatarMediaID.Set {
		t.Fatalf("khoá vắng phải Set = false: %+v", p)
	}
	p = GroupInfoPatch{}
	if err := json.Unmarshal([]byte(`{"description":null,"avatar_media_id":null}`), &p); err != nil {
		t.Fatal(err)
	}
	if !p.Description.Set || p.Description.Value != nil || !p.AvatarMediaID.Set || p.AvatarMediaID.ID != nil {
		t.Fatalf("null phải Set = true, giá trị nil: %+v", p)
	}
	p = GroupInfoPatch{}
	if err := json.Unmarshal([]byte(`{"description":"mô tả","avatar_media_id":42}`), &p); err != nil {
		t.Fatal(err)
	}
	if p.Description.Value == nil || *p.Description.Value != "mô tả" || p.AvatarMediaID.ID == nil || *p.AvatarMediaID.ID != 42 {
		t.Fatalf("giá trị đọc sai: %+v", p)
	}
	if err := json.Unmarshal([]byte(`{"avatar_media_id":"x"}`), &GroupInfoPatch{}); err == nil {
		t.Fatal("avatar_media_id chuỗi phải lỗi")
	}
}

func TestSendInputMentions(t *testing.T) {
	var in SendInput
	if err := json.Unmarshal([]byte(`{"conversation_id":1,"mentions":[{"user_id":0,"offset":0,"length":7}]}`), &in); err != nil {
		t.Fatal(err)
	}
	if len(in.Mentions) != 1 || in.Mentions[0].UserID != MentionAll || in.Mentions[0].Length != 7 {
		t.Fatalf("mentions đọc sai: %+v", in.Mentions)
	}
	b, _ := json.Marshal(MessageDTO{})
	if strings.Contains(string(b), `"mentions"`) {
		t.Fatalf("tin không nhắc tên không được có khoá mentions: %s", b)
	}
}
