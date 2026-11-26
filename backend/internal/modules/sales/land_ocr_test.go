package sales

import (
	"strings"
	"testing"
)

func TestLandParse(t *testing.T) {
	m, err := landParse("```json\n{\"docType\":\"Trang thay đổi sau cấp GCN\",\"area\":\"85,9m²\",\"width\":18.46,\"length\":4.7,\"shapeNote\":\"Thửa hình thang\",\"plotNo\":null,\"mapSheet\":\"null\",\"purpose\":\"Đất ở tại đô thị\",\"address\":\"\",\"note\":\"Ảnh rõ\"}\n```")
	if err != nil {
		t.Fatal(err)
	}
	if m.Val("area") != 85.9 || m.Val("width") != 4.7 || m.Val("length") != 18.46 {
		t.Errorf("số: area %v width %v length %v", m.Val("area"), m.Val("width"), m.Val("length"))
	}
	if m.Val("plotNo") != nil || m.Val("mapSheet") != nil || m.Val("address") != nil || m.Val("purpose") != "Đất ở tại đô thị" {
		t.Errorf("chuỗi: %s", js(m))
	}
	if strings.Join(m.Keys(), ",") != "docType,area,width,length,shapeNote,plotNo,mapSheet,purpose,address,note" {
		t.Errorf("khoá: %v", m.Keys())
	}
	m, _ = landParse(`{"area":-5,"width":"abc","length":0}`)
	if m.Val("area") != nil || m.Val("width") != nil || m.Val("length") != nil {
		t.Errorf("số không hợp lệ -> null: %s", js(m))
	}
	if _, err := landParse("không phải json"); err == nil {
		t.Error("JSON hỏng phải lỗi")
	}
}
