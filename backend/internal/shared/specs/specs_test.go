package specs

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

func anys(ss []string) []any {
	out := make([]any, len(ss))
	for i, s := range ss {
		out[i] = s
	}
	return out
}

func strsOrNull(ss []string) any {
	if ss == nil {
		return nil
	}
	return anys(ss)
}

func byName(t *testing.T, name string) *Spec {
	switch name {
	case "vs":
		return VS
	case "son":
		return SON
	case "ct":
		return CT
	case "dl":
		return DL
	}
	t.Fatalf("spec lạ: %q", name)
	return nil
}

// Ghi lại Data phải ra đúng từng byte của JSON.stringify bên Node: thứ tự khoá không đổi qua nhúng + giải mã.
func TestDataRoundTrip(t *testing.T) {
	for name, raw := range map[string][]byte{"vs": vsJSON, "son": sonJSON, "ct": ctJSON, "dl": dlJSON} {
		got, err := omap.Marshal(byName(t, name).Data)
		if err != nil {
			t.Fatal(err)
		}
		if want := bytes.TrimRight(raw, "\n"); !bytes.Equal(got, want) {
			t.Errorf("%s: Marshal(Data) khác data/%s.json (%d / %d byte)", name, name, len(got), len(want))
		}
	}
}

func TestDerivedLists(t *testing.T) {
	for _, s := range []*Spec{VS, SON, CT, DL} {
		if !reflect.DeepEqual(s.HangMuc, s.HM.Keys()) {
			t.Errorf("%s: HANG_MUC khác Object.keys(HM)", s.Name)
		}
		if !reflect.DeepEqual(s.All, s.Metric.Keys()) {
			t.Errorf("%s: ALL khác Object.keys(METRIC)", s.Name)
		}
		if !reflect.DeepEqual(s.ChinhAll, s.Gom("chinh")) {
			t.Errorf("%s: CHINH_ALL khác gom('chinh')", s.Name)
		}
		if len(s.HangMuc) == 0 || len(s.Chung) == 0 || len(s.TkAll) == 0 || s.VD == "" {
			t.Errorf("%s: thiếu dữ liệu", s.Name)
		}
	}
	if VS.Muc != "" || SON.Muc == "" || CT.Muc == "" || SON.TenTk == "" || CT.Opt == nil || VS.Opt != nil || DL.Muc != "Điện lạnh" || DL.Opt == nil {
		t.Error("MUC / TEN_TK / OPT không đúng spec")
	}
}

// Phát lại testdata/golden.json (sinh bởi scripts/gen-specs.js từ mã Node thật).
func TestGolden(t *testing.T) {
	raw, err := os.ReadFile("testdata/golden.json")
	if err != nil {
		t.Fatal(err)
	}
	v, err := omap.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	rows := jsval.AsArray(v)
	if len(rows) < 1000 {
		t.Fatalf("golden quá ít ca: %d", len(rows))
	}
	count := map[string]int{}
	fails := 0
	for i, r := range rows {
		row := jsval.AsArray(r)
		spec, fn, args, want := jsval.AsString(row[0]), jsval.AsString(row[1]), jsval.AsArray(row[2]), row[3]
		arg := func(i int) any {
			if i < len(args) {
				return args[i]
			}
			return jsval.Undefined
		}
		var got any
		switch fn {
		case "boDau":
			got = BoDau(arg(0))
		case "chuanHM":
			got = byName(t, spec).ChuanHM(arg(0))
		case "hmOf":
			s := byName(t, spec)
			h := s.HmOf(arg(0))
			if h != nil {
				name := ""
				for _, hm := range s.HangMuc {
					if s.HMGet(hm) == h {
						name = hm
					}
				}
				got = omap.Of("$hm", name)
			}
		case "labelsOf":
			s := byName(t, spec)
			lbs := s.LabelsOf(arg(0))
			if reflect.DeepEqual(lbs, s.All) {
				got = "$ALL"
			} else {
				got = anys(lbs)
			}
		case "gom":
			got = anys(byName(t, spec).Gom(jsval.AsString(arg(0))))
		case "optsOf":
			got = anys(byName(t, spec).OptsOf(arg(0), arg(1)))
		case "isReq":
			got = byName(t, spec).IsReq(arg(0), arg(1))
		case "metric":
			s, lb := byName(t, spec), jsval.AsString(arg(0))
			if s.Metric.Has(lb) {
				got = []any{s.MetricCol(lb), s.MetricLabel(lb), s.MetricKind(lb), s.MetricHint(lb)}
			} else if s.MetricCol(lb) != "" {
				got = "MetricCol phải rỗng"
			}
		case "hmList":
			got = anys(byName(t, spec).HMList(jsval.AsString(arg(0)), jsval.AsString(arg(1))))
		case "nganhOf":
			got = NganhOf(arg(0), arg(1))
		case "dong":
			rec := jsval.AsMap(arg(1))
			got = strsOrNull(byName(t, spec).Dong(jsval.AsString(arg(0)), func(col string) any { return rec.Val(col) }))
		case "laChung":
			got = DLLaChung(arg(0))
		case "doanHM":
			got = DLDoanHM(arg(0), arg(1))
		default:
			t.Fatalf("ca %d: hàm lạ %q", i, fn)
		}
		count[spec+"."+fn]++
		g, _ := omap.MarshalString(got)
		w, _ := omap.MarshalString(want)
		if g != w {
			fails++
			if fails <= 20 {
				a, _ := omap.MarshalString(row[2])
				t.Errorf("ca %d %s.%s(%s)\n  Go:   %s\n  Node: %s", i, spec, fn, a, g, w)
			}
		}
	}
	if fails > 20 {
		t.Errorf("... và %d ca khác nữa", fails-20)
	}
	t.Logf("%d ca: %v", len(rows), count)
}

// File JS nhúng phải đúng bản đã dùng để sinh data/*.json + golden.json: sửa js/*-spec.js mà quên
// chạy lại scripts/gen-specs.js thì test này báo.
func TestSourceMatchesGenerated(t *testing.T) {
	raw, err := os.ReadFile("testdata/sources.json")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{}
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	if len(want) != len(SourceFiles) {
		t.Fatalf("sources.json có %d file, muốn %d", len(want), len(SourceFiles))
	}
	for _, f := range SourceFiles {
		b := Source(f)
		if len(b) == 0 {
			t.Fatalf("thiếu %s trong binary", f)
		}
		sum := sha256.Sum256(b)
		if got := hex.EncodeToString(sum[:]); got != want[f] {
			t.Errorf("%s đã đổi (sha256 %s, lúc sinh %s): chạy lại node backend/scripts/gen-specs.js", f, got, want[f])
		}
	}
	if Source("khong-co.js") != nil {
		t.Error("file lạ phải trả nil")
	}
}
