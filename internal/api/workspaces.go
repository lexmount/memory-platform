package api

import (
	"github.com/google/uuid"
	"github.com/lexmount/memory-platform/internal/projects"
	"github.com/lexmount/memory-platform/internal/store"
	"net/http"
	"strings"
	"unicode/utf8"
)

func (h *MemoryProjectsHandler) workspaces(w http.ResponseWriter, r *http.Request) {
	s, ok := h.service.Store.(store.WorkspaceStore)
	if !ok {
		h.fail(w, r, projects.ErrUnavailable)
		return
	}
	rows, err := s.ListWorkspaces(r.Context(), accountFromContext(r.Context()).ID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"workspaces": rows})
}
func (h *MemoryProjectsHandler) createWorkspace(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name string `json:"name"`
	}
	if err := memoryProjectJSON(w, r, &input); err != nil {
		h.fail(w, r, err)
		return
	}
	name := strings.TrimSpace(input.Name)
	if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 100 {
		h.fail(w, r, projects.ErrInvalid)
		return
	}
	s, ok := h.service.Store.(store.WorkspaceStore)
	if !ok {
		h.fail(w, r, projects.ErrUnavailable)
		return
	}
	account := accountFromContext(r.Context()).ID
	if _, err := s.EnsureDefaultWorkspace(r.Context(), account); err != nil {
		h.fail(w, r, err)
		return
	}
	space := &store.Workspace{ID: uuid.New(), AccountID: account, Name: name}
	if err := s.CreateWorkspace(r.Context(), space); err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, 201, space)
}
