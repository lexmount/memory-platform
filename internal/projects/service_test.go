package projects

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lexmount/memory-platform/internal/crypto"
	"github.com/lexmount/memory-platform/internal/security"
	"github.com/lexmount/memory-platform/internal/store"

	native "github.com/lexmount/memory-platform/internal/native"
)

type testSession struct {
	project uuid.UUID
	user    string
	version int64
	native  string
}

func (s *testStore) User(_ context.Context, id uuid.UUID, user string) (*store.MemoryProjectUser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[id.String()+":"+user]
	if !ok {
		return nil, sql.ErrNoRows
	}
	return &u, nil
}

type testStore struct {
	mu         sync.Mutex
	projects   map[uuid.UUID]store.MemoryProject
	users      map[string]store.MemoryProjectUser
	sessions   map[uuid.UUID]testSession
	failCommit bool
}

func newTestStore() *testStore {
	return &testStore{projects: map[uuid.UUID]store.MemoryProject{}, users: map[string]store.MemoryProjectUser{}, sessions: map[uuid.UUID]testSession{}}
}
func (s *testStore) Create(_ context.Context, p *store.MemoryProject) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.projects[p.ID]; exists {
		return store.ErrProjectExists
	}
	s.projects[p.ID] = *p
	return nil
}
func (s *testStore) Get(_ context.Context, id uuid.UUID) (*store.MemoryProject, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.projects[id]
	if !ok {
		return nil, sql.ErrNoRows
	}
	return &p, nil
}
func (s *testStore) ByKey(_ context.Context, key string) (*store.MemoryProject, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range s.projects {
		if p.AppKey == key {
			return &p, nil
		}
	}
	return nil, sql.ErrNoRows
}
func (s *testStore) List(_ context.Context, account uuid.UUID) ([]store.MemoryProject, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []store.MemoryProject{}
	for _, p := range s.projects {
		if p.AccountID == account {
			out = append(out, p)
		}
	}
	return out, nil
}
func (s *testStore) Update(_ context.Context, account uuid.UUID, id uuid.UUID, name string, enabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.projects[id]
	if p.AccountID != account {
		return sql.ErrNoRows
	}
	p.Name = name
	p.Enabled = enabled
	s.projects[id] = p
	return nil
}
func (s *testStore) Credential(_ context.Context, account uuid.UUID, id uuid.UUID, hash string, revoked bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.projects[id]
	if p.AccountID != account {
		return sql.ErrNoRows
	}
	if hash != "" {
		p.SecretHash = hash
	}
	p.CredentialVersion++
	p.Revoked = revoked
	s.projects[id] = p
	return nil
}
func (s *testStore) Users(_ context.Context, id uuid.UUID, after string) ([]store.MemoryProjectUser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []store.MemoryProjectUser{}
	for _, u := range s.users {
		if u.ProjectID == id && u.UserID > after {
			out = append(out, u)
		}
	}
	return out, nil
}
func (s *testStore) Provision(_ context.Context, id uuid.UUID, user string, fn func(*store.MemoryProject, *store.MemoryProjectUser) error) (*store.MemoryProjectUser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := id.String() + ":" + user
	u, ok := s.users[key]
	if ok && u.Provisioned {
		return &u, nil
	}
	p := s.projects[id]
	u = store.MemoryProjectUser{ProjectID: id, UserID: user, NativeID: uuid.NewSHA1(id, []byte("memory-user:"+user))}
	if err := fn(&p, &u); err != nil {
		return nil, err
	}
	if s.failCommit {
		s.failCommit = false
		return nil, errors.New("lost local commit")
	}
	u.Provisioned = true
	p.Provisioned = true
	s.projects[id] = p
	s.users[key] = u
	return &u, nil
}
func (s *testStore) SaveMCPSession(_ context.Context, id, p uuid.UUID, user string, v int64, n string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[id] = testSession{p, user, v, n}
	return nil
}
func (s *testStore) MCPSession(_ context.Context, id, p uuid.UUID, user string, v int64) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	value, ok := s.sessions[id]
	if !ok || value.project != p || value.user != user || value.version != v {
		return "", sql.ErrNoRows
	}
	return value.native, nil
}
func (s *testStore) DeleteMCPSession(_ context.Context, id, p uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sessions[id].project == p {
		delete(s.sessions, id)
	}
	return nil
}

func testService(t *testing.T, provider string, handler http.HandlerFunc) (*Service, *testStore, *store.MemoryProject, string) {
	t.Helper()
	security.SetAllowLoopbackForTest(true)
	t.Cleanup(func() { security.SetAllowLoopbackForTest(false) })
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	repo := newTestStore()
	service, err := New(repo, []Config{{Provider: provider, Endpoint: server.URL, APIKey: "native-root", NamespacePrefix: "test"}}, strings.Repeat("1", 64), server.Client())
	if err != nil {
		t.Fatal(err)
	}
	p, secret, err := service.Create(t.Context(), uuid.New(), "Project", provider)
	if err != nil {
		t.Fatal(err)
	}
	return service, repo, p, secret
}
func readResponse(t *testing.T, r *native.Response, err error) string {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
	b, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Body.Close(); err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestNativeDiscoveryVersionsAndAliases(t *testing.T) {
	for _, test := range []struct{ provider, schemaVersion, release, path, alias string }{
		{"hindsight", "1.1.0", "1.1.0", "/v1/default/banks/{bank_id}/memories/list", "list_memories"},
		{"openviking", "0.1.0", "0.5.0", "/api/v1/content/read", "read"},
	} {
		t.Run(test.provider, func(t *testing.T) {
			s, _, p, _ := testService(t, test.provider, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/openapi.json" {
					t.Fatalf("unexpected discovery path %s", r.URL.Path)
				}
				fmt.Fprintf(w, `{"info":{"version":%q},"paths":{%q:{"get":{"operationId":"nativeID","summary":"Native operation"}}},"components":{}}`, test.schemaVersion, test.path)
			})
			d, err := s.Describe(t.Context(), &Identity{Project: p, connection: s.connections[test.provider]})
			if err != nil || d.Version != test.release || len(d.Operations) != 1 || d.Operations[0].ID != test.alias {
				t.Fatalf("native discovery: %+v %v", d, err)
			}
			if s.Providers()[0].Version != test.release {
				t.Fatal("provider list lost the discovered release version")
			}
		})
	}
}

func TestDiscoveryDoesNotBlockProviderListingOrCancellation(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	s, _, p, _ := testService(t, "hindsight", func(w http.ResponseWriter, r *http.Request) {
		once.Do(func() { close(started) })
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		io.WriteString(w, `{"paths":{"/v1/default/banks/{bank_id}/memories/recall":{"post":{}}},"components":{}}`)
	})
	defer close(release)
	i := &Identity{Project: p, connection: s.connections["hindsight"]}
	go func() { _, _ = s.Describe(t.Context(), i) }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("discovery did not start")
	}
	listed := make(chan []Description, 1)
	go func() { listed <- s.Providers() }()
	select {
	case providers := <-listed:
		if len(providers) != 1 {
			t.Fatalf("providers: %+v", providers)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("provider listing blocked behind discovery")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	finished := make(chan error, 1)
	go func() { _, err := s.Describe(ctx, i); finished <- err }()
	select {
	case err := <-finished:
		if err == nil {
			t.Fatal("cancelled discovery succeeded")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cancelled caller blocked behind discovery")
	}
}

func TestHindsightProjectIsolationNativeWireAndMCPSessions(t *testing.T) {
	for _, version := range []string{"0.10.3", "1.1.0"} {
		t.Run(version, func(t *testing.T) { testHindsightProjectIsolationNativeWireAndMCPSessions(t, version) })
	}
}

func testHindsightProjectIsolationNativeWireAndMCPSessions(t *testing.T, version string) {
	var mu sync.Mutex
	banks := map[string]bool{}
	puts := 0
	business := 0
	alias := ""
	var lastBody, lastSession string
	s, repo, p, secret := testService(t, "hindsight", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("Authorization") != "Bearer native-root" || r.Header.Get("X-App-Secret") != "" || r.Header.Get("X-Bank-Id") != "" {
			t.Error("credential/identity boundary")
		}
		path := strings.TrimPrefix(r.URL.Path, "/v1/default/banks/")
		bank := strings.Split(path, "/")[0]
		switch {
		case r.URL.Path == "/version":
			fmt.Fprintf(w, `{"api_version":%q}`, version)
		case strings.HasSuffix(r.URL.Path, "/config"):
			if !banks[bank] {
				w.WriteHeader(404)
				fmt.Fprint(w, `{}`)
				return
			}
			if alias != "" {
				bank = alias
			}
			fmt.Fprintf(w, `{"bank_id":%q}`, bank)
		case r.Method == "PUT":
			banks[bank] = true
			puts++
			fmt.Fprint(w, `{}`)
		default:
			business++
			b, _ := io.ReadAll(r.Body)
			lastBody = string(b)
			lastSession = r.Header.Get("Mcp-Session-Id")
			if strings.HasPrefix(r.URL.Path, "/mcp/") {
				w.Header().Set("Mcp-Session-Id", "native-session")
				fmt.Fprint(w, `{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"image","data":"abc","mimeType":"image/png"}],"structuredContent":{"n":9223372036854775807}}}`)
			} else {
				w.WriteHeader(422)
				fmt.Fprint(w, `{"detail":{"n":9223372036854775807}}`)
			}
		}
	})
	i, err := s.Resolve(t.Context(), p, "external-user")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			if _, err := s.Resolve(t.Context(), p, "external-user"); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if puts != 1 {
		t.Fatal("duplicate bank provisioning", puts)
	}
	p2, _, err := s.Create(t.Context(), p.AccountID, "Other", "hindsight")
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.Resolve(t.Context(), p2, "external-user")
	if err != nil {
		t.Fatal(err)
	}
	if other.Mapping["bank_id"] == i.Mapping["bank_id"] {
		t.Fatal("cross-project namespace collision")
	}
	for _, path := range []string{"/v1/default/banks/" + other.Mapping["bank_id"] + "/memories", "/v1/default/banks/" + i.Mapping["bank_id"] + "/%252e%252e/other", "/v1/default/files/download/banks/foreign/file", "/v1/default/banks/" + i.Mapping["bank_id"] + "/aliases"} {
		if _, err := s.Forward(t.Context(), i, "POST", path, native.Request{}, nil, false); !errors.Is(err, ErrDenied) {
			t.Fatalf("accepted foreign path %s: %v", path, err)
		}
	}
	raw := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"recall","arguments":{"query":"hello","n":9223372036854775807}}}`
	r, err := s.Forward(t.Context(), i, "POST", "", native.Request{JSON: json.RawMessage(raw)}, http.Header{"X-Bank-Id": []string{"foreign"}, "X-App-Secret": []string{secret}}, true)
	if err != nil {
		t.Fatal(err)
	}
	publicSession := r.Header.Get("Mcp-Session-Id")
	body := readResponse(t, r, nil)
	if publicSession == "native-session" || publicSession == "" || lastBody != raw || !strings.Contains(body, `"type":"image"`) {
		t.Fatal("native MCP changed", publicSession, body)
	}
	headers := http.Header{"Mcp-Session-Id": []string{publicSession}}
	if _, err := s.Forward(t.Context(), other, "GET", "", native.Request{}, headers, true); !errors.Is(err, ErrSession) {
		t.Fatal("cross-project MCP session", err)
	}
	user2, err := s.Resolve(t.Context(), p, "another-user")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Forward(t.Context(), user2, "GET", "", native.Request{}, headers, true); !errors.Is(err, ErrSession) {
		t.Fatal("cross-user MCP session", err)
	}
	r, err = s.Forward(t.Context(), i, "GET", "", native.Request{}, headers, true)
	readResponse(t, r, err)
	if lastSession != "native-session" {
		t.Fatal("session not restored")
	}
	r, err = s.Forward(t.Context(), i, "POST", "/v1/default/banks/"+i.Mapping["bank_id"]+"/memories", native.Request{JSON: json.RawMessage(`{"n":9223372036854775807}`)}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if r.StatusCode != 422 || readResponse(t, r, nil) != `{"detail":{"n":9223372036854775807}}` {
		t.Fatal("native HTTP error changed")
	}
	newSecret, hash, err := NewSecret()
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.Credential(t.Context(), p.AccountID, p.ID, hash, false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Authenticate(t.Context(), p.AppKey, secret); !errors.Is(err, ErrDenied) {
		t.Fatal("old credential survived")
	}
	current, err := s.Authenticate(t.Context(), p.AppKey, newSecret)
	if err != nil {
		t.Fatal(err)
	}
	rotated, err := s.Resolve(t.Context(), current, "external-user")
	if err != nil {
		t.Fatal(err)
	}
	if rotated.Mapping["bank_id"] != i.Mapping["bank_id"] {
		t.Fatal("rotation changed mapping")
	}
	if _, err := s.Forward(t.Context(), rotated, "GET", "", native.Request{}, headers, true); !errors.Is(err, ErrSession) {
		t.Fatal("old session survived rotation")
	}
	mu.Lock()
	alias = other.Mapping["bank_id"]
	mu.Unlock()
	if _, err := s.Forward(t.Context(), i, "POST", "", native.Request{JSON: json.RawMessage(raw)}, nil, true); !errors.Is(err, ErrDenied) {
		t.Fatal("bank alias escaped", err)
	}
	_ = business
}

func TestOpenVikingUserKeysRecoverAndPreserveSharedNativeRequests(t *testing.T) {
	var mu sync.Mutex
	accounts := map[string]bool{}
	keys := map[string][2]string{}
	users := map[string]bool{}
	regenerated := 0
	business := 0
	mode := "api_key"
	s, repo, p, _ := testService(t, "openviking", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		key := r.Header.Get("X-API-Key")
		if r.Header.Get("X-OpenViking-Account") != "" || r.Header.Get("X-OpenViking-Role") != "" {
			t.Error("identity headers leaked")
		}
		if r.URL.Path == "/health" {
			who := keys[key]
			role := "user"
			if key == "native-root" {
				role = "root"
			}
			fmt.Fprintf(w, `{"healthy":true,"version":"0.5.0","auth_mode":%q,"account_id":%q,"user_id":%q,"role":%q}`, mode, who[0], who[1], role)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/v1/admin/") {
			if key != "native-root" {
				t.Error("provision without control credential")
			}
			var input map[string]string
			_ = json.NewDecoder(r.Body).Decode(&input)
			parts := strings.Split(r.URL.Path, "/")
			if r.URL.Path == "/api/v1/admin/accounts" {
				account := input["account_id"]
				if accounts[account] {
					w.WriteHeader(409)
				}
				accounts[account] = true
				fmt.Fprint(w, `{"result":{}}`)
				return
			}
			if r.Method == "GET" {
				fmt.Fprint(w, `{"result":{}}`)
				return
			}
			account := parts[5]
			user := input["user_id"]
			if strings.HasSuffix(r.URL.Path, "/key") {
				user = parts[7]
				regenerated++
			} else if users[account+user] {
				w.WriteHeader(409)
				fmt.Fprint(w, `{}`)
				return
			}
			users[account+user] = true
			k := account + "_" + user + fmt.Sprint(regenerated)
			keys[k] = [2]string{account, user}
			fmt.Fprintf(w, `{"result":{"user_key":%q}}`, k)
			return
		}
		if key == "native-root" || keys[key][0] == "" {
			t.Error("business request used root/unknown key")
		}
		business++
		if r.URL.Path == "/mcp" {
			data, _ := io.ReadAll(r.Body)
			if string(data) != `{"jsonrpc":"2.0","id":9223372036854775807,"method":"tools/call","params":{"name":"native_tool","arguments":{"extra":null}}}` {
				t.Errorf("rewritten MCP input: %s", data)
			}
			fmt.Fprint(w, `{"jsonrpc":"2.0","id":9223372036854775807,"result":{"content":[{"type":"text","text":"native"}],"structuredContent":{"shared":true}}}`)
			return
		}
		data, _ := io.ReadAll(r.Body)
		if string(data) != `{"query":"shared","target_uri":"viking://resources","acl":{"native":true}}` {
			t.Errorf("native request rewritten: %s", data)
		}
		fmt.Fprint(w, `{"status":"ok","result":{"uri":"viking://resources/shared"}}`)
	})
	repo.failCommit = true
	if _, err := s.Resolve(t.Context(), p, "张三"); err == nil {
		t.Fatal("expected interrupted commit")
	}
	i, err := s.Resolve(t.Context(), p, "张三")
	if err != nil {
		t.Fatal(err)
	}
	if regenerated != 1 || !crypto.IsEncrypted(i.User.ProviderKey) || i.User.ProviderKey == i.key {
		t.Fatal("lost key not recovered/encrypted")
	}
	j, err := s.Resolve(t.Context(), p, "李四")
	if err != nil {
		t.Fatal(err)
	}
	if i.Mapping["account_id"] != j.Mapping["account_id"] || i.Mapping["user_id"] == j.Mapping["user_id"] || i.key == j.key {
		t.Fatal("incorrect project/user mapping")
	}
	input := native.Request{JSON: json.RawMessage(`{"query":"shared","target_uri":"viking://resources","acl":{"native":true}}`)}
	r, err := s.Forward(t.Context(), i, "POST", "/api/v1/search/find", input, http.Header{"X-API-Key": []string{"evil"}, "X-Openviking-Role": []string{"root"}}, false)
	if !strings.Contains(readResponse(t, r, err), "viking://resources/shared") {
		t.Fatal("shared result changed")
	}
	if _, err := s.Forward(t.Context(), i, "GET", "/api/v1/admin/accounts", native.Request{}, nil, false); !errors.Is(err, ErrDenied) {
		t.Fatal("admin route exposed")
	}
	mcpBody := json.RawMessage(`{"jsonrpc":"2.0","id":9223372036854775807,"method":"tools/call","params":{"name":"native_tool","arguments":{"extra":null}}}`)
	r, err = s.Forward(t.Context(), i, "POST", "", native.Request{JSON: mcpBody}, nil, true)
	if got := readResponse(t, r, err); got != `{"jsonrpc":"2.0","id":9223372036854775807,"result":{"content":[{"type":"text","text":"native"}],"structuredContent":{"shared":true}}}` {
		t.Fatalf("native MCP result changed: %s", got)
	}
	mu.Lock()
	mode = "trusted"
	mu.Unlock()
	if _, err := s.Forward(t.Context(), i, "POST", "/api/v1/search/find", input, nil, false); err == nil {
		t.Fatal("accepted auth mode change")
	}
	if business != 2 {
		t.Fatal("unexpected dispatch", business)
	}
}

func TestConsoleInputIsNotScopeAndPreservesNumbers(t *testing.T) {
	input, err := ConsoleRequest([]byte(`{"path":{"id":9223372036854775807},"query":{"n":[9223372036854775807,false]},"body":{"n":9223372036854775807,"extra":null}}`))
	if err != nil || input.Path["id"] != "9223372036854775807" || input.Query.Get("n") != "9223372036854775807" || string(input.JSON) != `{"n":9223372036854775807,"extra":null}` {
		t.Fatalf("native values changed: %+v %v", input, err)
	}
	for _, path := range []string{"/api/v1/fs/../admin", "/api/v1/fs/%252e%252e/admin", "//api/v1/fs", "/api/v1/fs?other"} {
		if CleanPath(path) {
			t.Fatal("accepted path", path)
		}
	}
	if !ValidUser("张三") || !ValidUser("user%with-percent") || ValidUser(" user") || ValidUser("bad\r\n") {
		t.Fatal("external user validation")
	}
}

func TestProjectBoundaryRejectsOldEnvelopeAndEncodedBankOverrides(t *testing.T) {
	for _, data := range []string{`{"scope":{"type":"user","id":"foreign"},"native":{}}`, `null`, `{} {}`, `{"body":{},"endpoint":"https://foreign"}`} {
		if _, err := ConsoleRequest([]byte(data)); !errors.Is(err, ErrInvalid) {
			t.Fatalf("accepted obsolete/ambiguous input %s: %v", data, err)
		}
	}
	i := &Identity{Mapping: map[string]string{"bank_id": "owned"}}
	for _, path := range []string{"/v1/default/banks/owned/aliases", "/v1/default/banks/owned/%61liases"} {
		if routeAllowed("hindsight", "POST", path) {
			t.Fatalf("alias route exposed: %s", path)
		}
	}
	for _, path := range []string{"/v1/default/banks/owned/transfer/import", "/v1/default/banks/owned/transfer/%69mport"} {
		for _, query := range []url.Values{nil, {"mode": {"restore"}}, {"mode": {"merge", "restore"}}} {
			if err := hindsightRoute(i, path, native.Request{Query: query}); !errors.Is(err, ErrDenied) {
				t.Fatalf("restore escaped: %s %v %v", path, query, err)
			}
		}
		if err := hindsightRoute(i, path, native.Request{Query: url.Values{"mode": {"merge"}}}); err != nil {
			t.Fatal(err)
		}
	}
	for _, path := range []string{"/v1/default/chunks/chunk", "/v1/default/files/download/banks/owned/file"} {
		if routeAllowed("hindsight", "DELETE", path) {
			t.Fatalf("global mutation permitted: %s", path)
		}
	}
}

func TestProjectConnectionsAreIndependentAndRequireNativeKeys(t *testing.T) {
	legacy := map[string]string{"GOCLAW_MEMORY_PROVIDER": "openviking", "GOCLAW_MEMORY_PROVIDER_URL": "https://legacy.example", "GOCLAW_MEMORY_PROVIDER_API_KEY": "legacy"}
	configs, err := LoadConnections(func(key string) string { return legacy[key] })
	if err != nil || len(configs) != 0 {
		t.Fatalf("legacy config enabled project data plane: %v %v", configs, err)
	}
	for _, provider := range []string{"HINDSIGHT", "OPENVIKING"} {
		prefix := "MEMORY_" + provider + "_"
		for _, fields := range []map[string]string{{"URL": "https://native.example"}, {"API_KEY": "key"}, {"URL": "https://name:secret@native.example", "API_KEY": "key"}, {"URL": "https://native.example", "API_KEY": "bad\nkey"}, {"URL": "https://native.example", "API_KEY": "key", "NAMESPACE_PREFIX": "../bad"}} {
			if _, err := LoadConnections(func(key string) string { return fields[strings.TrimPrefix(key, prefix)] }); err == nil {
				t.Fatalf("accepted invalid connection: %s", provider)
			}
		}
	}
	if _, err := New(newTestStore(), []Config{{Provider: "openviking", Endpoint: "https://native.example", APIKey: "root", NamespacePrefix: "test"}}, "", nil); err == nil {
		t.Fatal("OpenViking accepted missing encryption key")
	}
}
