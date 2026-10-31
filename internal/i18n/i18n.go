// Package i18n localizes Memory service errors.
package i18n

import "strings"

const (
	MsgMemoryProjectInvalid     = "memory.project_invalid"
	MsgMemoryProjectDenied      = "memory.project_denied"
	MsgMemoryProjectUnavailable = "memory.project_unavailable"
)

func Normalize(locale string) string {
	if strings.HasPrefix(strings.ToLower(locale), "zh") {
		return "zh"
	}
	return "en"
}
func T(locale, key string) string {
	messages := map[string][2]string{
		MsgMemoryProjectInvalid:     {"Check the Memory project, provider and userid.", "请检查 Memory 项目、Provider 和 userid。"},
		MsgMemoryProjectDenied:      {"This Memory project or credential is unavailable.", "此 Memory 项目或凭证不可用。"},
		MsgMemoryProjectUnavailable: {"Memory is temporarily unavailable. Check the operation before retrying a write.", "Memory 暂时不可用；重试写入前请先检查操作状态。"},
	}
	message, ok := messages[key]
	if !ok {
		return key
	}
	if Normalize(locale) == "zh" {
		return message[1]
	}
	return message[0]
}
