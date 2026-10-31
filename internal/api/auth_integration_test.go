//go:build integration

package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/lexmount/memory-platform/internal/auth"
	"github.com/lexmount/memory-platform/internal/projects"
	"github.com/lexmount/memory-platform/internal/testutil"
)

func TestManagementCookieOriginAndCredentialSeparation(t *testing.T) {
	db := testutil.DB(t)
	repo := &auth.Repository{DB: db}
	account := testutil.Account(t, db)
	other := testutil.Account(t, db)
	var issuer string
	idp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"issuer":%q,"authorization_endpoint":%q,"token_endpoint":%q,"jwks_uri":%q}`, issuer, issuer+"/authorize", issuer+"/token", issuer+"/keys")
	}))
	defer idp.Close()
	issuer = idp.URL
	identity, err := auth.New(t.Context(), auth.Config{Issuer: issuer, ClientID: "test", ClientSecret: "test", PublicURL: "http://127.0.0.1:19442"}, repo)
	if err != nil {
		t.Fatal(err)
	}
	cookie := strings.Repeat("a", 43)
	defer db.Exec(`DELETE FROM browser_sessions WHERE key_hash=$1`, auth.Hash(cookie))
	err = repo.Transaction(t.Context(), cookie, func(s *auth.BrowserState, _ auth.AccountWriter) error {
		s.Session = &auth.Session{Account: auth.Account{ID: account, Name: "Account"}, Expires: time.Now().Add(time.Hour).UnixMilli()}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	a := &Authentication{Identity: identity, Accounts: repo}
	mux := http.NewServeMux()
	a.Register(mux)
	service, err := projects.New(nil, nil, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	NewMemoryProjectsHandler(service, a).RegisterUserRoutes(mux)
	// The real startup fallback coexists with every public/auth route.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(404) })
	request := func(method, path, origin, authorization string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(`{"name":"integration"}`))
		r.AddCookie(&http.Cookie{Name: auth.CookieName, Value: cookie})
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if authorization != "" {
			r.Header.Set("Authorization", authorization)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	for _, origin := range []string{"", "https://foreign.example"} {
		if w := request("POST", "/v1/account/keys", origin, ""); w.Code != 403 {
			t.Fatalf("CSRF accepted: %d", w.Code)
		}
	}
	r := httptest.NewRequest("POST", "/v1/account/keys", strings.NewReader(`{"name":"wrong account"}`))
	r.AddCookie(&http.Cookie{Name: auth.CookieName, Value: cookie})
	r.Header.Set("Origin", identity.Origin())
	r.Header.Set("X-Memory-Account", other.String())
	mismatch := httptest.NewRecorder()
	mux.ServeHTTP(mismatch, r)
	if mismatch.Code != 409 {
		t.Fatal("stale account expectation dispatched", mismatch.Code)
	}
	w := request("POST", "/v1/account/keys", identity.Origin(), "")
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	var created struct {
		Key    auth.APIKey `json:"key"`
		Secret string      `json:"secret"`
	}
	if err = json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	w = request("GET", "/v1/account/keys", "", "")
	if w.Code != 200 || strings.Contains(w.Body.String(), created.Secret) || strings.Contains(w.Body.String(), "key_hash") {
		t.Fatal("key metadata leaked secret")
	}
	for _, credential := range []string{"Bearer invalid", "Bearer ms_project-secret", "Bearer mp_project-key"} {
		if w := request("GET", "/v1/account", "", credential); w.Code != 401 {
			t.Fatal("bad credential fell back to cookie", w.Code)
		}
	}
	_, otherSecret, err := repo.CreateKey(t.Context(), other, "other")
	if err != nil {
		t.Fatal(err)
	}
	w = request("DELETE", "/v1/account/keys/"+created.Key.ID.String(), "", "Bearer "+otherSecret)
	if w.Code != 404 {
		t.Fatal("foreign key revocation", w.Code)
	}
	w = request("DELETE", "/v1/account/keys/"+created.Key.ID.String(), "", "Bearer "+created.Secret)
	if w.Code != 204 {
		t.Fatal("revoke failed", w.Code)
	}
	if w = request("GET", "/v1/account", "", "Bearer "+created.Secret); w.Code != 401 {
		t.Fatal("revoked key fell back to cookie")
	}
	if w = request("GET", "/v1/account", "", ""); w.Code != 200 || !strings.Contains(w.Body.String(), account.String()) || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("cookie account not preserved")
	}
}
