//go:build integration

package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lexmount/memory-platform/internal/auth"
	"github.com/lexmount/memory-platform/internal/projects"
	"github.com/lexmount/memory-platform/internal/security"
	"github.com/lexmount/memory-platform/internal/store"
	"github.com/lexmount/memory-platform/internal/testutil"
)

func TestMemoryProjectsHTTPNativeAndConsole(t *testing.T) {
	db := testutil.DB(t)
	account, other := testutil.Account(t, db), testutil.Account(t, db)
	accounts := &auth.Repository{DB: db}
	_, ownerToken, err := accounts.CreateKey(t.Context(), account, "owner")
	if err != nil {
		t.Fatal(err)
	}
	_, otherToken, err := accounts.CreateKey(t.Context(), other, "other")
	if err != nil {
		t.Fatal(err)
	}
	security.SetAllowLoopbackForTest(true)
	t.Cleanup(func() { security.SetAllowLoopbackForTest(false) })
	var mu sync.Mutex
	banks := map[string]bool{}
	nativeCalls := 0
	native := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer native-secret" {
			t.Error("wrong upstream credential")
		}
		for _, key := range []string{"X-App-Key", "X-App-Secret", "X-User-Id", "X-OpenViking-Account", "X-API-Key", "Cookie"} {
			if r.Header.Get(key) != "" {
				t.Errorf("leaked header: %s", key)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		path := r.URL.Path
		switch {
		case path == "/version":
			io.WriteString(w, `{"api_version":"0.10.3"}`)
		case path == "/openapi.json":
			io.WriteString(w, `{"paths":{"/v1/default/banks/{bank_id}/memories/recall":{"post":{"operationId":"nativeRecall","requestBody":{"content":{"application/json":{}}}}}},"components":{}}`)
		case strings.HasSuffix(path, "/config"):
			bank := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/default/banks/"), "/config")
			if !banks[bank] {
				w.WriteHeader(404)
				io.WriteString(w, `{"detail":"missing"}`)
				return
			}
			fmt.Fprintf(w, `{"bank_id":%q}`, bank)
		case r.Method == "PUT":
			banks[strings.TrimPrefix(path, "/v1/default/banks/")] = true
			io.WriteString(w, `{}`)
		case strings.HasPrefix(path, "/mcp/"):
			nativeCalls++
			w.Header().Set("Content-Type", "text/event-stream")
			w.Header().Set("Mcp-Session-Id", "provider-session")
			io.WriteString(w, "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"native\":9223372036854775807}}\n\n")
		default:
			nativeCalls++
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Disposition", `attachment; filename="native.bin"`)
			w.Header().Set("Set-Cookie", "native-secret")
			w.WriteHeader(422)
			body, _ := io.ReadAll(r.Body)
			w.Write(body)
		}
	}))
	defer native.Close()
	s := store.NewProjectRepository(db)
	service, err := projects.New(s, []projects.Config{{Provider: "hindsight", Endpoint: native.URL, APIKey: "native-secret", NamespacePrefix: "test"}}, "", native.Client())
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	NewMemoryProjectsHandler(service, &Authentication{Accounts: accounts}).RegisterUserRoutes(mux)
	request := func(method, path, token, body string, headers map[string]string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		for key, value := range headers {
			r.Header.Set(key, value)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}

	if w := request("GET", "/v1/workspaces", "", "", nil); w.Code != 401 {
		t.Fatalf("workspace anonymous: %d", w.Code)
	}
	wspace := request("GET", "/v1/workspaces", ownerToken, "", nil)
	var spaces struct {
		Workspaces []store.Workspace `json:"workspaces"`
	}
	if wspace.Code != 200 || json.Unmarshal(wspace.Body.Bytes(), &spaces) != nil || len(spaces.Workspaces) != 1 || spaces.Workspaces[0].Name != "默认项目空间" {
		t.Fatalf("default workspace: %d %s", wspace.Code, wspace.Body.String())
	}
	if w := request("POST", "/v1/workspaces", ownerToken, `{"name":"   "}`, nil); w.Code != 400 {
		t.Fatalf("empty workspace: %d", w.Code)
	}
	second := request("POST", "/v1/workspaces", ownerToken, `{"name":"Second space"}`, nil)
	var newSpace store.Workspace
	if second.Code != 201 || json.Unmarshal(second.Body.Bytes(), &newSpace) != nil {
		t.Fatalf("new workspace: %d %s", second.Code, second.Body.String())
	}
	foreign := request("POST", "/v1/projects", otherToken, fmt.Sprintf(`{"name":"Foreign","provider":"hindsight","workspace_id":%q}`, newSpace.ID), nil)
	if foreign.Code != 403 {
		t.Fatalf("foreign workspace app creation: %d %s", foreign.Code, foreign.Body.String())
	}
	const base = "/v1/projects"
	w := request("POST", base, ownerToken, `{"name":"Project A","provider":"hindsight"}`, nil)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		Project store.MemoryProject `json:"project"`
		Secret  string              `json:"app_secret"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	p := created.Project
	detail := base + "/" + p.ID.String()
	if strings.Contains(w.Body.String(), "tenant_id") || strings.Contains(w.Body.String(), "secret_hash") {
		t.Fatal("internal identity leaked")
	}
	for _, token := range []string{otherToken, "invalid-token"} {
		w := request("GET", detail, token, "", nil)
		if w.Code != 403 && w.Code != 401 {
			t.Fatalf("foreign console %q: %d", token, w.Code)
		}
	}
	w = request("POST", detail+"/identity", ownerToken, `{"user_id":"never-connected"}`, nil)
	if w.Code != 403 {
		t.Fatalf("console created user: %d", w.Code)
	}
	if users, err := s.Users(t.Context(), p.ID, ""); err != nil || len(users) != 0 {
		t.Fatalf("console changed users: %v %v", users, err)
	}
	headers := map[string]string{"X-App-Key": p.AppKey, "X-App-Secret": created.Secret, "X-User-Id": url.PathEscape("张三"), "X-API-Key": "attacker", "X-OpenViking-Account": "other", "Cookie": "secret"}
	w = request("POST", "/v1/memory/identity", "", `{}`, headers)
	if w.Code != 200 {
		t.Fatalf("external user: %d %s", w.Code, w.Body.String())
	}
	var identity projects.Identity
	if err := json.Unmarshal(w.Body.Bytes(), &identity); err != nil {
		t.Fatal(err)
	}
	bank := identity.Mapping["bank_id"]
	if bank == "" || identity.UserID != "张三" {
		t.Fatalf("identity: %+v", identity)
	}
	w = request("GET", detail+"/users", ownerToken, "", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "张三") || strings.Contains(w.Body.String(), "provider_key") {
		t.Fatalf("connected users: %d %s", w.Code, w.Body.String())
	}
	w = request("POST", detail+"/identity", ownerToken, `{"user_id":"张三"}`, nil)
	if w.Code != 200 {
		t.Fatalf("console identity: %d %s", w.Code, w.Body.String())
	}
	body := `{"query":"native","n":9223372036854775807}`
	w = request("POST", "/v1/memory/native/v1/default/banks/"+bank+"/memories/recall", "", body, headers)
	if w.Code != 422 || w.Body.String() != body || w.Header().Get("Content-Disposition") == "" || w.Header().Get("Set-Cookie") != "" {
		t.Fatalf("native passthrough: %d %s %v", w.Code, w.Body.String(), w.Header())
	}
	w = request("POST", "/mcp/memory", "", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`, headers)
	if w.Code != 200 || w.Header().Get("Mcp-Session-Id") == "provider-session" || !strings.Contains(w.Body.String(), "9223372036854775807") {
		t.Fatalf("native MCP: %d %s", w.Code, w.Body.String())
	}
	headers["Mcp-Session-Id"] = w.Header().Get("Mcp-Session-Id")
	headers["X-User-Id"] = "other-end-user"
	w = request("GET", "/mcp/memory", "", "", headers)
	if w.Code != 404 {
		t.Fatalf("cross-user MCP: %d", w.Code)
	}
	headers["X-User-Id"] = url.PathEscape("张三")
	w = request("POST", detail+"/credentials/rotate", ownerToken, `{}`, nil)
	if w.Code != 200 {
		t.Fatalf("rotate: %d", w.Code)
	}
	var rotated map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &rotated); err != nil {
		t.Fatal(err)
	}
	w = request("GET", "/mcp/memory", "", "", headers)
	if w.Code != 403 {
		t.Fatalf("old secret active: %d", w.Code)
	}
	headers["X-App-Secret"] = rotated["app_secret"]
	w = request("GET", "/mcp/memory", "", "", headers)
	if w.Code != 404 {
		t.Fatalf("old session active: %d", w.Code)
	}
	delete(headers, "Mcp-Session-Id")
	w = request("DELETE", detail+"/credentials", ownerToken, "", nil)
	if w.Code != 204 {
		t.Fatalf("revoke: %d", w.Code)
	}
	w = request("POST", "/v1/memory/identity", "", `{}`, headers)
	if w.Code != 403 {
		t.Fatalf("revoked credential active: %d", w.Code)
	}
	for _, token := range []string{otherToken, "invalid-token"} {
		w := request("DELETE", detail, token, "", nil)
		if w.Code != 403 && w.Code != 401 {
			t.Fatalf("foreign delete: %d", w.Code)
		}
	}
	if w := request("DELETE", detail, ownerToken, "", nil); w.Code != 204 {
		t.Fatalf("delete: %d", w.Code)
	}
	if w := request("GET", detail, ownerToken, "", nil); w.Code != 403 {
		t.Fatalf("deleted get: %d", w.Code)
	}
	if w := request("PATCH", detail, ownerToken, `{"name":"Restored"}`, nil); w.Code != 403 {
		t.Fatalf("deleted rename: %d", w.Code)
	}
	mu.Lock()
	defer mu.Unlock()
	if nativeCalls != 2 {
		t.Fatalf("unexpected native business dispatches: %d", nativeCalls)
	}
}

// Request headers can arrive long before a JSON body finishes. Revocation,
// rotation and disablement must be checked again at the dispatch boundary.
func TestCredentialChangeWhileReadingNativeBody(t *testing.T) {
	db := testutil.DB(t)
	account := testutil.Account(t, db)
	repository := store.NewProjectRepository(db)
	security.SetAllowLoopbackForTest(true)
	t.Cleanup(func() { security.SetAllowLoopbackForTest(false) })
	var mu sync.Mutex
	dispatched := 0
	native := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/version" {
			io.WriteString(w, `{"api_version":"1.1.0"}`)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/config") {
			bank := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/default/banks/"), "/config")
			fmt.Fprintf(w, `{"bank_id":%q}`, bank)
			return
		}
		mu.Lock()
		dispatched++
		mu.Unlock()
		io.WriteString(w, `{}`)
	}))
	defer native.Close()
	service, err := projects.New(repository, []projects.Config{{Provider: "hindsight", Endpoint: native.URL, APIKey: "native-secret", NamespacePrefix: "test"}}, "", native.Client())
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	NewMemoryProjectsHandler(service, &Authentication{}).RegisterUserRoutes(mux)
	for _, transport := range []string{"http", "mcp"} {
		for _, change := range []string{"rotate", "revoke", "disable"} {
			t.Run(transport+"/"+change, func(t *testing.T) {
				p, secret, err := service.Create(t.Context(), account, "Buffered request", "hindsight")
				if err != nil {
					t.Fatal(err)
				}
				i, err := service.Resolve(t.Context(), p, "reader")
				if err != nil {
					t.Fatal(err)
				}
				path := "/v1/memory/native/v1/default/banks/" + i.Mapping["bank_id"] + "/memories/recall"
				body := `{"query":"native"}`
				if transport == "mcp" {
					path = "/mcp/memory"
					body = `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`
				}
				reader, writer := io.Pipe()
				defer reader.Close()
				defer writer.Close()
				request := httptest.NewRequest("POST", path, reader)
				request.Header.Set("Content-Type", "application/json")
				request.Header.Set("X-App-Key", p.AppKey)
				request.Header.Set("X-App-Secret", secret)
				request.Header.Set("X-User-Id", "reader")
				response := httptest.NewRecorder()
				done := make(chan struct{})
				go func() { mux.ServeHTTP(response, request); close(done) }()
				// A pipe write completes only once the handler is reading the body.
				if _, err = writer.Write([]byte(body[:1])); err != nil {
					t.Fatal(err)
				}
				mu.Lock()
				before := dispatched
				mu.Unlock()
				switch change {
				case "rotate":
					_, hash, keyErr := projects.NewSecret()
					if keyErr != nil {
						t.Fatal(keyErr)
					}
					err = repository.Credential(t.Context(), account, p.ID, hash, false)
				case "revoke":
					err = repository.Credential(t.Context(), account, p.ID, "", true)
				case "disable":
					err = repository.Update(t.Context(), account, p.ID, p.Name, false)
				}
				if err != nil {
					t.Fatal(err)
				}
				if _, err = writer.Write([]byte(body[1:])); err != nil {
					t.Fatal(err)
				}
				if err = writer.Close(); err != nil {
					t.Fatal(err)
				}
				select {
				case <-done:
				case <-time.After(5 * time.Second):
					t.Fatal("native handler did not finish")
				}
				if response.Code != http.StatusForbidden {
					t.Fatalf("credential change accepted: %d %s", response.Code, response.Body.String())
				}
				mu.Lock()
				after := dispatched
				mu.Unlock()
				if after != before {
					t.Fatal("revoked request reached Provider")
				}
			})
		}
	}
}
