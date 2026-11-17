package chat

import (
	"strings"
	"testing"
	"time"
)

func TestParseSendAt(t *testing.T) {
	now := time.Date(2026, 11, 16, 8, 0, 0, 0, time.UTC)
	ok := []string{
		now.Add(31 * time.Second).Format(time.RFC3339),
		" 2026-11-16T15:30:00+07:00 ",
		now.Add(time.Hour).Format(time.RFC3339Nano),
		now.AddDate(1, 0, 0).Format(time.RFC3339),
	}
	for _, s := range ok {
		if _, err := parseSendAt(s, now); err != nil {
			t.Errorf("%q: %v", s, err)
		}
	}
	got, _ := parseSendAt("2026-11-16T15:30:00+07:00", now)
	if !got.Equal(time.Date(2026, 11, 16, 8, 30, 0, 0, time.UTC)) {
		t.Errorf("múi giờ: %v", got)
	}
	bad := map[string]string{
		"":                    "Thiếu send_at",
		"2026-11-16 09:00:00": "RFC3339",
		"ngày mai":            "RFC3339",
		now.Add(10 * time.Second).Format(time.RFC3339): "ít nhất 30 giây",
		now.Add(-time.Hour).Format(time.RFC3339):       "ít nhất 30 giây",
		now.AddDate(1, 0, 1).Format(time.RFC3339):      "tối đa 1 năm",
	}
	for s, want := range bad {
		_, err := parseSendAt(s, now)
		if codeOf(err) != CodeBadRequest || !strings.Contains(err.Error(), want) {
			t.Errorf("%q: %v, muốn %q", s, err, want)
		}
	}
}

func TestCleanScheduled(t *testing.T) {
	c, ms, err := cleanScheduled("  @An chào ", []Mention{{UserID: 5, Offset: 2, Length: 3}})
	if err != nil || c != "@An chào" || len(ms) != 1 || ms[0].Offset != 0 {
		t.Fatalf("%q %+v %v", c, ms, err)
	}
	for raw, want := range map[string]string{
		" \n\t ":                              "Tin nhắn trống",
		strings.Repeat("a", 4001):             "tối đa 4000",
		"a\x00b":                              "tối đa 4000",
		strings.Repeat("ạ", 4000):             "",
		" " + strings.Repeat("b", 4000) + " ": "",
	} {
		_, _, err := cleanScheduled(raw, nil)
		if want == "" {
			if err != nil {
				t.Errorf("%d ký tự: %v", len(raw), err)
			}
			continue
		}
		if codeOf(err) != CodeBadRequest || !strings.Contains(err.Error(), want) {
			t.Errorf("%q: %v, muốn %q", raw[:min(len(raw), 10)], err, want)
		}
	}
}

func TestSchedClientID(t *testing.T) {
	a, b := schedClientID(1), schedClientID(2)
	if !reUUID.MatchString(a) || !reUUID.MatchString(b) || a == b || a != schedClientID(1) {
		t.Fatalf("%s %s", a, b)
	}
	if a[14] != '5' {
		t.Errorf("phiên bản UUID: %s", a)
	}
}
