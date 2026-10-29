package errors

import (
	"encoding/json"
	"os"
	"qspro-backend/internal/shared/specs"
	"testing"
)

// Giá trị mong đợi do node thật sinh ra từ server/store_supa.js: xem testdata/gen.js.
type golden struct {
	HDMig  string   `json:"hdMig"`
	DAMat  string   `json:"daMat"`
	Cols   []string `json:"cols"`
	ColErr []struct {
		In   string `json:"in"`
		Out  string `json:"out"`
		Same bool   `json:"same"`
	} `json:"colErr"`
	KhongCoCha []struct {
		In  string `json:"in"`
		Out bool   `json:"out"`
	} `json:"khongCoCha"`
}

func loadGolden(t *testing.T) golden {
	t.Helper()
	b, err := os.ReadFile("testdata/colerr.json")
	if err != nil {
		t.Fatal(err)
	}
	var g golden
	if err := json.Unmarshal(b, &g); err != nil {
		t.Fatal(err)
	}
	if len(g.Cols) < 19 || len(g.ColErr) < len(g.Cols) || len(g.KhongCoCha) == 0 {
		t.Fatalf("golden thiếu dữ liệu: %d cột, %d ca", len(g.Cols), len(g.ColErr))
	}
	return g
}

func TestHangSo(t *testing.T) {
	g := loadGolden(t)
	if HDMig != g.HDMig {
		t.Errorf("HDMig = %q, node = %q", HDMig, g.HDMig)
	}
	if DAMat != g.DAMat {
		t.Errorf("DAMat = %q, node = %q", DAMat, g.DAMat)
	}
}

func TestColSQL(t *testing.T) {
	g := loadGolden(t)
	got := ColSQL()
	if len(got) < len(g.Cols) {
		t.Fatalf("số cột: go %d, node %d", len(got), len(g.Cols))
	}
	// phần thêm sau cột của Node: chỉ cột của ngành Điện lạnh (chỉ bản Go)
	dl := map[string]bool{}
	for _, lb := range specs.DL.All {
		dl[specs.DL.MetricCol(lb)] = true
	}
	for _, c := range got[len(g.Cols):] {
		if !dl[c] {
			t.Errorf("cột thêm %q không thuộc dl-spec.js", c)
		}
	}
	for i := range g.Cols {
		if got[i] != g.Cols[i] {
			t.Fatalf("cột %d: go %q, node %q", i, got[i], g.Cols[i])
		}
	}
	got[0] = "x"
	if ColSQL()[0] == "x" {
		t.Error("ColSQL phải trả bản sao")
	}
}

func TestColErr(t *testing.T) {
	g := loadGolden(t)
	for _, c := range g.ColErr {
		in := New(c.In)
		out := ColErr(in)
		if out.Error() != c.Out {
			t.Errorf("ColErr(%q) = %q, node = %q", c.In, out.Error(), c.Out)
		}
		if (out == in) != c.Same {
			t.Errorf("ColErr(%q): giữ nguyên lỗi = %v, node = %v", c.In, out == in, c.Same)
		}
	}
	if ColErr(nil) != nil {
		t.Error("ColErr(nil) phải là nil")
	}
	// lỗi được thay là lỗi thường (500), không mang mã HTTP
	if st, _ := Status(ColErr(New("column nganh"))); st != 500 {
		t.Errorf("status = %d", st)
	}
}

func TestKhongCoCha(t *testing.T) {
	g := loadGolden(t)
	for _, c := range g.KhongCoCha {
		if got := KhongCoCha(New(c.In)); got != c.Out {
			t.Errorf("KhongCoCha(%q) = %v, node = %v", c.In, got, c.Out)
		}
	}
	if KhongCoCha(nil) {
		t.Error("KhongCoCha(nil) phải là false")
	}
}
