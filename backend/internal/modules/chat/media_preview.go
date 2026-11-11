package chat

import (
	"fmt"
	"strings"
)

// previewBody: chữ xem trước của một tin (nội dung push, last_message trong danh sách), tối đa 100 ký tự.
// fileName: chat_messages.file_name của chính tin (tin file); md: tệp đính kèm (nil = không đọc được / máy chủ tắt tệp).
func previewBody(msgType, content, fileName string, md *MediaDTO) string {
	content = strings.TrimSpace(content)
	var s string
	switch msgType {
	case MediaImage, MediaVideo, MediaFile, MediaVoice:
		if md == nil {
			s = "[Tệp đính kèm]"
			break
		}
		switch msgType {
		case MediaImage:
			s = withCaption("[Hình ảnh]", content)
		case MediaVideo:
			s = withCaption("[Video]", content)
		case MediaFile:
			if fileName == "" {
				fileName = md.FileName
			}
			s = strings.TrimSpace("[Tệp] " + fileName)
		case MediaVoice:
			s = "[Tin nhắn thoại]"
			if md.DurationMs != nil {
				s += " " + fmtDuration(*md.DurationMs)
			}
		}
	default:
		s = content
	}
	return truncRunes(s, 100)
}

func withCaption(label, caption string) string {
	if caption == "" {
		return label
	}
	return label + " " + caption
}

// fmtDuration: m:ss, làm tròn LÊN tới giây (999 ms -> 0:01).
func fmtDuration(ms int) string {
	if ms < 0 {
		ms = 0
	}
	sec := (ms + 999) / 1000
	return fmt.Sprintf("%d:%02d", sec/60, sec%60)
}
