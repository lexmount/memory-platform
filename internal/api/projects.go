package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"maps"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/lexmount/memory-platform/internal/i18n"

	native "github.com/lexmount/memory-platform/internal/native"
	"github.com/lexmount/memory-platform/internal/projects"
	"github.com/lexmount/memory-platform/internal/store"
)

type MemoryProjectsHandler struct {
	service *projects.Service
	auth    *Authentication
}

func memoryProjectUserHeader(r *http.Request) string {
	user, err := url.PathUnescape(r.Header.Get("X-User-Id"))
	if err != nil {
		return ""
	}
	return user
}

func NewMemoryProjectsHandler(service *projects.Service, auth *Authentication) *MemoryProjectsHandler {
	return &MemoryProjectsHandler{service: service, auth: auth}
}
func (h *MemoryProjectsHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/mcp/memory", h.publicMCP)
	mux.HandleFunc("/v1/memory/native/v1/{path...}", h.publicHTTP)
	mux.HandleFunc("/v1/memory/native/api/{path...}", h.publicHTTP)
	mux.HandleFunc("POST /v1/memory/identity", h.publicIdentity)
}
func (h *MemoryProjectsHandler) RegisterUserRoutes(mux *http.ServeMux) {
	h.RegisterRoutes(mux)
	developer := h.auth.Require

	mux.HandleFunc("GET /v1/providers", developer(h.providers))
	mux.HandleFunc("GET /v1/workspaces", developer(h.workspaces))
	mux.HandleFunc("POST /v1/workspaces", developer(h.createWorkspace))
	mux.HandleFunc("GET /v1/projects", developer(h.list))
	mux.HandleFunc("POST /v1/projects", developer(h.create))
	mux.HandleFunc("GET /v1/projects/{project}", developer(h.get))
	mux.HandleFunc("PATCH /v1/projects/{project}", developer(h.update))
	mux.HandleFunc("DELETE /v1/projects/{project}", developer(h.delete))
	mux.HandleFunc("POST /v1/projects/{project}/credentials/rotate", developer(h.rotate))
	mux.HandleFunc("DELETE /v1/projects/{project}/credentials", developer(h.revoke))
	mux.HandleFunc("GET /v1/projects/{project}/users", developer(h.users))
	mux.HandleFunc("POST /v1/projects/{project}/identity", developer(h.identity))
	mux.HandleFunc("GET /v1/projects/{project}/schemas/{operation}", developer(h.schema))
	mux.HandleFunc("POST /v1/projects/{project}/requests/{operation}", developer(h.execute))
}
func (h *MemoryProjectsHandler) fail(w http.ResponseWriter, r *http.Request, err error) {
	status, key, code := 503, i18n.MsgMemoryProjectUnavailable, "memory_unavailable"
	var failure *native.Failure
	dispatched := errors.As(err, &failure) && failure.Dispatched
	switch {
	case errors.Is(err, projects.ErrInvalid):
		status, key, code = 400, i18n.MsgMemoryProjectInvalid, "memory_invalid"
	case errors.Is(err, projects.ErrDenied):
		status, key, code = 403, i18n.MsgMemoryProjectDenied, "memory_denied"
	case errors.Is(err, projects.ErrSession):
		status, key, code = 404, i18n.MsgMemoryProjectDenied, "memory_session"
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]any{"error": map[string]any{"code": code, "message": i18n.T(i18n.Normalize(r.Header.Get("Accept-Language")), key), "dispatched": dispatched}})
}
func memoryProjectJSON(w http.ResponseWriter, r *http.Request, value any) error {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20))
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		return projects.ErrInvalid
	}
	if err := d.Decode(new(any)); !errors.Is(err, io.EOF) {
		return projects.ErrInvalid
	}
	return nil
}
func (h *MemoryProjectsHandler) providers(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"providers": h.service.Providers()})
}
func (h *MemoryProjectsHandler) list(w http.ResponseWriter, r *http.Request) {
	items, err := h.service.List(r.Context(), accountFromContext(r.Context()).ID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"projects": items})
}
func (h *MemoryProjectsHandler) create(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name        string `json:"name"`
		Provider    string `json:"provider"`
		WorkspaceID string `json:"workspace_id"`
	}
	if err := memoryProjectJSON(w, r, &input); err != nil {
		h.fail(w, r, err)
		return
	}
	workspace := uuid.Nil
	if input.WorkspaceID != "" {
		var err error
		workspace, err = uuid.Parse(input.WorkspaceID)
		if err != nil || workspace == uuid.Nil {
			h.fail(w, r, projects.ErrInvalid)
			return
		}
	}
	p, secret, err := h.service.Create(r.Context(), accountFromContext(r.Context()).ID, input.Name, input.Provider, workspace)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	// Project creation remains successful if the provider is temporarily unavailable.
	// Opening the user list retries the same deterministic default identity.
	ready := h.service.EnsureDefaultUser(r.Context(), p) == nil
	writeJSON(w, 201, map[string]any{"project": p, "app_secret": secret, "default_user_ready": ready})
}
func (h *MemoryProjectsHandler) owned(w http.ResponseWriter, r *http.Request) *store.MemoryProject {
	id, err := uuid.Parse(r.PathValue("project"))
	if err != nil {
		h.fail(w, r, projects.ErrInvalid)
		return nil
	}
	p, err := h.service.Owned(r.Context(), accountFromContext(r.Context()).ID, id)
	if err != nil {
		h.fail(w, r, err)
		return nil
	}
	return p
}
func (h *MemoryProjectsHandler) get(w http.ResponseWriter, r *http.Request) {
	if p := h.owned(w, r); p != nil {
		writeJSON(w, 200, p)
	}
}
func (h *MemoryProjectsHandler) update(w http.ResponseWriter, r *http.Request) {
	p := h.owned(w, r)
	if p == nil {
		return
	}
	var input struct {
		Name    *string `json:"name"`
		Enabled *bool   `json:"enabled"`
	}
	if err := memoryProjectJSON(w, r, &input); err != nil {
		h.fail(w, r, err)
		return
	}
	if input.Name != nil {
		p.Name = strings.TrimSpace(*input.Name)
	}
	if input.Enabled != nil {
		p.Enabled = *input.Enabled
	}
	if p.Name == "" || !utf8.ValidString(p.Name) || utf8.RuneCountInString(p.Name) > 100 {
		h.fail(w, r, projects.ErrInvalid)
		return
	}
	if err := h.service.Store.Update(r.Context(), p.AccountID, p.ID, p.Name, p.Enabled); err != nil {
		h.fail(w, r, err)
		return
	}
	h.get(w, r)
}
func (h *MemoryProjectsHandler) rotate(w http.ResponseWriter, r *http.Request) {
	p := h.owned(w, r)
	if p == nil {
		return
	}
	secret, hash, err := projects.NewSecret()
	if err == nil {
		err = h.service.Store.Credential(r.Context(), p.AccountID, p.ID, hash, false)
	}
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]string{"app_key": p.AppKey, "app_secret": secret})
}
func (h *MemoryProjectsHandler) revoke(w http.ResponseWriter, r *http.Request) {
	p := h.owned(w, r)
	if p == nil {
		return
	}
	if err := h.service.Store.Credential(r.Context(), p.AccountID, p.ID, "", true); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(204)
}
func (h *MemoryProjectsHandler) users(w http.ResponseWriter, r *http.Request) {
	p := h.owned(w, r)
	if p == nil {
		return
	}
	if err := h.service.EnsureDefaultUser(r.Context(), p); err != nil {
		h.fail(w, r, err)
		return
	}
	items, err := h.service.Store.Users(r.Context(), p.ID, r.URL.Query().Get("after"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	after := ""
	if len(items) > 100 {
		after = items[99].UserID
		items = items[:100]
	}
	writeJSON(w, 200, map[string]any{"items": items, "next_cursor": after})
}
func (h *MemoryProjectsHandler) consoleIdentity(w http.ResponseWriter, r *http.Request, user string) *projects.Identity {
	p := h.owned(w, r)
	if p == nil {
		return nil
	}
	if user == projects.DefaultUserID {
		if err := h.service.EnsureDefaultUser(r.Context(), p); err != nil {
			h.fail(w, r, err)
			return nil
		}
	}
	i, err := h.service.ResolveExisting(r.Context(), p, user)
	if err != nil {
		h.fail(w, r, err)
		return nil
	}
	return i
}
func (h *MemoryProjectsHandler) identity(w http.ResponseWriter, r *http.Request) {
	var input struct {
		UserID string `json:"user_id"`
	}
	if err := memoryProjectJSON(w, r, &input); err != nil {
		h.fail(w, r, err)
		return
	}
	i := h.consoleIdentity(w, r, input.UserID)
	if i == nil {
		return
	}
	d, err := h.service.Describe(r.Context(), i)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	i.Description = d
	writeJSON(w, 200, i)
}
func (h *MemoryProjectsHandler) schema(w http.ResponseWriter, r *http.Request) {
	i := h.consoleIdentity(w, r, memoryProjectUserHeader(r))
	if i == nil {
		return
	}
	data, err := h.service.Schema(r.Context(), i, r.PathValue("operation"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, 200, data)
}
func (h *MemoryProjectsHandler) execute(w http.ResponseWriter, r *http.Request) {
	i := h.consoleIdentity(w, r, memoryProjectUserHeader(r))
	if i == nil {
		return
	}
	op, err := h.service.Operation(r.Context(), i, r.PathValue("operation"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	upload := strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") || strings.HasPrefix(r.Header.Get("Content-Type"), "application/octet-stream")
	var data []byte
	if upload {
		data = []byte(r.URL.Query().Get("request"))
		if len(data) > 32<<10 {
			h.fail(w, r, projects.ErrInvalid)
			return
		}
	} else {
		data, err = io.ReadAll(http.MaxBytesReader(w, r.Body, 4<<20))
	}
	if err != nil {
		h.fail(w, r, projects.ErrInvalid)
		return
	}
	input, err := projects.ConsoleRequest(data)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	path, err := projects.ConsolePath(i, op, input)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if upload {
		input.Upload = http.MaxBytesReader(w, r.Body, 32<<20)
		input.ContentType = r.Header.Get("Content-Type")
	}
	response, err := h.service.Forward(r.Context(), i, op.Method, path, input, nil, false)
	h.respond(w, r, response, err)
}
func (h *MemoryProjectsHandler) authenticated(w http.ResponseWriter, r *http.Request) *projects.Identity {
	// A repeated identity header is ambiguous and cannot select another user.
	for _, key := range []string{"X-App-Key", "X-App-Secret", "X-User-Id"} {
		if len(r.Header.Values(key)) != 1 {
			h.fail(w, r, projects.ErrDenied)
			return nil
		}
	}
	p, err := h.service.Authenticate(r.Context(), r.Header.Get("X-App-Key"), r.Header.Get("X-App-Secret"))
	if err != nil {
		h.fail(w, r, err)
		return nil
	}
	i, err := h.service.Resolve(r.Context(), p, memoryProjectUserHeader(r))
	if err != nil {
		h.fail(w, r, err)
		return nil
	}
	// Initialization may wait for native work. Recheck revocation/version before
	// dispatching, without borrowing a platform user's or Agent's authority.
	current, err := h.service.Authenticate(r.Context(), r.Header.Get("X-App-Key"), r.Header.Get("X-App-Secret"))
	if err != nil || current.CredentialVersion != p.CredentialVersion {
		h.fail(w, r, projects.ErrDenied)
		return nil
	}
	return i
}
func (h *MemoryProjectsHandler) publicIdentity(w http.ResponseWriter, r *http.Request) {
	i := h.authenticated(w, r)
	if i == nil {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, i)
}
func (h *MemoryProjectsHandler) publicMCP(w http.ResponseWriter, r *http.Request) {
	h.publicProxy(w, r, true)
}
func (h *MemoryProjectsHandler) publicHTTP(w http.ResponseWriter, r *http.Request) {
	h.publicProxy(w, r, false)
}
func (h *MemoryProjectsHandler) publicProxy(w http.ResponseWriter, r *http.Request, mcp bool) {
	i := h.authenticated(w, r)
	if i == nil {
		return
	}
	input := native.Request{Query: r.URL.Query()}
	var err error
	if strings.Contains(r.Header.Get("Content-Type"), "application/json") {
		input.JSON, err = io.ReadAll(http.MaxBytesReader(w, r.Body, 32<<20))
	} else if r.Body != nil && r.Body != http.NoBody {
		input.Upload = http.MaxBytesReader(w, r.Body, 32<<20)
		input.ContentType = r.Header.Get("Content-Type")
	}
	if err != nil {
		h.fail(w, r, projects.ErrInvalid)
		return
	}
	path := strings.TrimPrefix(r.URL.EscapedPath(), "/v1/memory/native")
	// Buffering JSON can outlive a credential change. Revalidate immediately
	// before dispatch; streamed uploads are already in flight once forwarded.
	current, err := h.service.Authenticate(r.Context(), r.Header.Get("X-App-Key"), r.Header.Get("X-App-Secret"))
	if err != nil || current.CredentialVersion != i.Project.CredentialVersion {
		h.fail(w, r, projects.ErrDenied)
		return
	}
	response, err := h.service.Forward(r.Context(), i, r.Method, path, input, r.Header, mcp)
	h.respond(w, r, response, err)
}
func (h *MemoryProjectsHandler) respond(w http.ResponseWriter, r *http.Request, response *native.Response, err error) {
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if response == nil || response.Body == nil {
		h.fail(w, r, projects.ErrUnavailable)
		return
	}
	defer response.Body.Close()
	maps.Copy(w.Header(), response.Header)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Memory-Native-Status", strconv.Itoa(response.StatusCode))
	w.WriteHeader(response.StatusCode)
	writer := io.Writer(w)
	if flusher, ok := w.(http.Flusher); ok {
		writer = memoryProjectFlushWriter{w, flusher}
	}
	if _, err := io.Copy(writer, response.Body); err != nil {
		panic(http.ErrAbortHandler)
	}
}

type memoryProjectFlushWriter struct {
	io.Writer
	flusher http.Flusher
}

func (w memoryProjectFlushWriter) Write(p []byte) (int, error) {
	n, err := w.Writer.Write(p)
	w.flusher.Flush()
	return n, err
}

func (h *MemoryProjectsHandler) delete(w http.ResponseWriter, r *http.Request) {
	p := h.owned(w, r)
	if p == nil {
		return
	}
	repository, ok := h.service.Store.(interface {
		Delete(context.Context, uuid.UUID, uuid.UUID) error
	})
	if !ok {
		h.fail(w, r, projects.ErrUnavailable)
		return
	}
	if err := repository.Delete(r.Context(), p.AccountID, p.ID); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
