package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/lexmount/memory-platform/internal/auth"
)

type accountContext struct{}

func accountFromContext(ctx context.Context) auth.Account {
	value, _ := ctx.Value(accountContext{}).(auth.Account)
	return value
}

type Authentication struct {
	Identity *auth.Auth
	Accounts *auth.Repository
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = writeJSONBody(w, status, value)
}
func writeJSONBody(w http.ResponseWriter, status int, value any) error {
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(value)
}
func authFailure(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]any{"error": map[string]any{"code": code, "message": code, "dispatched": false}})
}

// Authorization explicitly selects account API-key authentication; an invalid
// key never falls back to a browser session. Native project credentials use
// separate routes and cannot authenticate management requests.
func (a *Authentication) Require(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		var account auth.Account
		if values, ok := r.Header["Authorization"]; ok {
			if len(values) != 1 || !strings.HasPrefix(values[0], "Bearer ") {
				authFailure(w, 401, "memory_unauthorized")
				return
			}
			var err error
			account, err = a.Accounts.AuthenticateKey(r.Context(), strings.TrimPrefix(values[0], "Bearer "))
			if err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					authFailure(w, 401, "memory_unauthorized")
				} else {
					authFailure(w, 503, "memory_unavailable")
				}
				return
			}
		} else {
			if a.Identity == nil {
				authFailure(w, 401, "memory_unauthorized")
				return
			}
			session, err := a.Identity.Session(r)
			if err != nil {
				authFailure(w, 503, "memory_unavailable")
				return
			}
			if session == nil {
				authFailure(w, 401, "memory_unauthorized")
				return
			}
			if r.Method != "GET" && r.Method != "HEAD" && r.Header.Get("Origin") != a.Identity.Origin() {
				authFailure(w, 403, "memory_origin_mismatch")
				return
			}
			account = session.Account
		}
		// An optional client expectation fences cookie changes between a UI
		// snapshot and dispatch. It never selects or authenticates an account.
		if expected := r.Header.Values("X-Memory-Account"); len(expected) > 0 && (len(expected) != 1 || expected[0] != account.ID.String()) {
			authFailure(w, 409, "memory_identity_changed")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), accountContext{}, account)))
	}
}
func (a *Authentication) Register(mux *http.ServeMux) {
	a.Identity.Register(mux)
	mux.HandleFunc("GET /v1/account", a.Require(func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, accountFromContext(r.Context())) }))
	mux.HandleFunc("GET /v1/account/keys", a.Require(func(w http.ResponseWriter, r *http.Request) {
		keys, err := a.Accounts.Keys(r.Context(), accountFromContext(r.Context()).ID)
		if err != nil {
			authFailure(w, 503, "memory_unavailable")
			return
		}
		writeJSON(w, 200, map[string]any{"keys": keys})
	}))
	mux.HandleFunc("POST /v1/account/keys", a.Require(func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Name string `json:"name"`
		}
		if memoryProjectJSON(w, r, &input) != nil {
			authFailure(w, 400, "memory_invalid")
			return
		}
		input.Name = strings.TrimSpace(input.Name)
		if input.Name == "" || !utf8.ValidString(input.Name) || utf8.RuneCountInString(input.Name) > 100 {
			authFailure(w, 400, "memory_invalid")
			return
		}
		key, secret, err := a.Accounts.CreateKey(r.Context(), accountFromContext(r.Context()).ID, input.Name)
		if err != nil {
			authFailure(w, 503, "memory_unavailable")
			return
		}
		writeJSON(w, 201, map[string]any{"key": key, "secret": secret})
	}))
	mux.HandleFunc("DELETE /v1/account/keys/{key}", a.Require(func(w http.ResponseWriter, r *http.Request) {
		id, err := uuid.Parse(r.PathValue("key"))
		if err != nil {
			authFailure(w, 400, "memory_invalid")
			return
		}
		err = a.Accounts.RevokeKey(r.Context(), accountFromContext(r.Context()).ID, id)
		if errors.Is(err, sql.ErrNoRows) {
			authFailure(w, 404, "memory_not_found")
			return
		}
		if err != nil {
			authFailure(w, 503, "memory_unavailable")
			return
		}
		w.WriteHeader(204)
	}))
}
