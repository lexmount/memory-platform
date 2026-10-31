package projects

import (
	"context"
	"encoding/json"
	"maps"
	"net/http"
	"net/url"
	"strings"

	"github.com/google/uuid"
	native "github.com/lexmount/memory-platform/internal/native"
	"github.com/lexmount/memory-platform/internal/nativehttp"
)

// CleanPath rejects ambiguous traversal before selecting an upstream route.
// Business identifiers may contain escaped slashes (for example stored files).
func CleanPath(path string) bool {
	if !strings.HasPrefix(path, "/") {
		return false
	}
	for range 10 {
		if strings.ContainsAny(path, "\\\r\n\x00?#") || strings.Contains(path, "//") {
			return false
		}
		for part := range strings.SplitSeq(path, "/") {
			if part == "." || part == ".." {
				return false
			}
		}
		decoded, err := url.PathUnescape(path)
		if err != nil {
			return false
		}
		if decoded == path {
			return true
		}
		path = decoded
	}
	return false
}
func routeAllowed(provider, method, path string) bool {
	if !CleanPath(path) {
		return false
	}
	if method != "GET" && method != "HEAD" && method != "POST" && method != "PUT" && method != "PATCH" && method != "DELETE" {
		return false
	}
	if provider == "hindsight" {
		decoded, _ := url.PathUnescape(path)
		if strings.Contains(decoded, "/aliases") {
			return false
		}
		return strings.HasPrefix(path, "/v1/default/banks/") || method == "GET" && (strings.HasPrefix(path, "/v1/default/chunks/") || strings.HasPrefix(path, "/v1/default/files/download/"))
	}
	// These native API families execute as the user's API-key identity. Root
	// account administration, observers, snapshots and server diagnostics are
	// control-plane APIs, never available through the project data proxy.
	for _, family := range []string{"acl", "agent-evolution", "compile", "console", "content", "fs", "openviking-assets", "pack", "privacy-configs", "resources", "search", "sessions", "skills", "stats", "tasks", "user-settings", "watches"} {
		prefix := "/api/v1/" + family
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return path == "/api/v1/system/consistency" || path == "/api/v1/system/wait"
}

// Only native business/transport headers cross this boundary. Client-supplied
// platform, native authentication, roles, groups and identity headers never do.
func forwardHeaders(in http.Header) http.Header {
	out := make(http.Header)
	for _, key := range []string{"Accept", "Content-Type", "Range", "If-Range", "If-Match", "If-None-Match", "If-Modified-Since", "If-Unmodified-Since", "Mcp-Protocol-Version", "Last-Event-ID", "X-OpenViking-Actor-Peer", "Idempotency-Key"} {
		for _, value := range in.Values(key) {
			out.Add(key, value)
		}
	}
	return out
}

func (s *Service) Forward(ctx context.Context, i *Identity, method, path string, input native.Request, headers http.Header, mcp bool) (*native.Response, error) {
	if input.Headers != nil {
		headers = headers.Clone()
		if headers == nil {
			headers = make(http.Header)
		}
		for key, value := range input.Headers {
			headers.Set(key, value)
		}
		input.Headers = nil
	}
	forward := forwardHeaders(headers)
	maps.Copy(forward, s.headers(i))
	var publicSession uuid.UUID
	if mcp {
		if len(headers.Values("Mcp-Session-Id")) > 1 {
			return nil, ErrSession
		}
		if method != "POST" && method != "GET" && method != "DELETE" {
			return nil, ErrInvalid
		}
		if value := headers.Get("Mcp-Session-Id"); value != "" {
			var err error
			publicSession, err = uuid.Parse(value)
			if err != nil {
				return nil, ErrSession
			}
			nativeSession, err := s.Store.MCPSession(ctx, publicSession, i.ProjectID, i.UserID, i.Project.CredentialVersion)
			if err != nil {
				return nil, ErrSession
			}
			forward.Set("Mcp-Session-Id", nativeSession)
		}
		path = "/mcp"
		if i.Project.Provider == "hindsight" {
			path = "/mcp/" + url.PathEscape(i.Mapping["bank_id"]) + "/"
		}
		// Client query parameters cannot replace the selected bank/session.
		if len(input.Query) > 0 {
			return nil, ErrInvalid
		}
	} else if !routeAllowed(i.Project.Provider, method, path) {
		return nil, ErrDenied
	}
	if i.Project.Provider == "openviking" {
		if err := s.verifyOV(ctx, i); err != nil {
			return nil, err
		}
	} else {
		if !mcp {
			if err := hindsightRoute(i, path, input); err != nil {
				return nil, err
			}
		}
		// Aliases must never turn a stable mapped ID into another user's bank.
		status, obj, err := s.inspect(ctx, i.connection, "GET", "/v1/default/banks/"+url.PathEscape(i.Mapping["bank_id"])+"/config", s.headers(i), nil)
		if err != nil {
			return nil, nativehttp.Preflight(err)
		}
		if status == 200 && nativehttp.String(obj, "bank_id") != i.Mapping["bank_id"] {
			return nil, ErrDenied
		}
		if status != 200 && status != 404 {
			return nil, ErrUnavailable
		}
	}
	response, err := s.client.Call(ctx, i.connection.Config.Endpoint, method, path, input, forward)
	if err != nil {
		return nil, err
	}
	if i.Project.Provider == "hindsight" && !mcp && strings.HasPrefix(path, "/v1/default/chunks/") && response.StatusCode >= 200 && response.StatusCode < 300 {
		data, err := nativehttp.Inspect(response)
		if err != nil {
			return nil, err
		}
		obj, err := nativehttp.Object(data)
		chunk, decodeErr := url.PathUnescape(strings.TrimPrefix(path, "/v1/default/chunks/"))
		if err != nil || decodeErr != nil || nativehttp.String(obj, "bank_id") != i.Mapping["bank_id"] || nativehttp.String(obj, "chunk_id") != chunk {
			return nil, ErrDenied
		}
		response = nativehttp.Buffered(response, data)
	}
	if mcp {
		if nativeSession := response.Header.Get("Mcp-Session-Id"); nativeSession != "" {
			if publicSession == uuid.Nil {
				publicSession = uuid.New()
				if err := s.Store.SaveMCPSession(ctx, publicSession, i.ProjectID, i.UserID, i.Project.CredentialVersion, nativeSession); err != nil {
					_ = response.Body.Close()
					return nil, ErrUnavailable
				}
			} else if nativeSession != forward.Get("Mcp-Session-Id") {
				_ = response.Body.Close()
				return nil, ErrSession
			}
			response.Header.Set("Mcp-Session-Id", publicSession.String())
		}
		if method == "DELETE" && publicSession != uuid.Nil && response.StatusCode < 300 {
			if err := s.Store.DeleteMCPSession(ctx, publicSession, i.ProjectID); err != nil {
				_ = response.Body.Close()
				return nil, ErrUnavailable
			}
		}
	}
	return response, nil
}
func hindsightRoute(i *Identity, path string, input native.Request) error {
	bank := i.Mapping["bank_id"]
	if after, ok := strings.CutPrefix(path, "/v1/default/banks/"); ok {
		parts := strings.Split(after, "/")
		id, err := url.PathUnescape(parts[0])
		if err != nil || id != bank {
			return ErrDenied
		}
	}
	for _, key := range []string{"bank_id", "target_bank_id"} {
		for _, value := range input.Query[key] {
			if value != bank {
				return ErrDenied
			}
		}
	}
	// Restore mode can select a bank stored inside an uploaded transfer. Merge
	// keeps the destination fixed by the authenticated bank path.
	decoded, _ := url.PathUnescape(path)
	if strings.HasSuffix(decoded, "/import") && strings.Contains(decoded, "/transfer") {
		if len(input.Query["mode"]) != 1 || input.Query.Get("mode") != "merge" {
			return ErrDenied
		}
	}
	if after, ok := strings.CutPrefix(path, "/v1/default/files/download/"); ok {
		key, err := url.PathUnescape(after)
		if err != nil {
			return ErrDenied
		}
		valid := strings.HasPrefix(key, "banks/"+bank+"/")
		if tenant := i.connection.Config.HindsightStorageTenant; tenant != "" {
			valid = valid || strings.HasPrefix(key, "tenants/"+url.PathEscape(tenant)+"/banks/"+bank+"/")
		}
		if !valid {
			return ErrDenied
		}
	}
	if len(input.JSON) > 0 {
		var obj map[string]json.RawMessage
		if json.Unmarshal(input.JSON, &obj) == nil {
			for _, key := range []string{"bank_id", "target_bank_id"} {
				if raw, ok := obj[key]; ok {
					var id string
					if json.Unmarshal(raw, &id) != nil || id != bank {
						return ErrDenied
					}
				}
			}
		}
	}
	return nil
}
