package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/google/uuid"
)

type testSessions struct {
	mu     sync.Mutex
	states map[string]BrowserState
}

func (s *testSessions) Read(_ context.Context, key string) (*BrowserState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	value, ok := s.states[key]
	if !ok {
		return nil, nil
	}
	data, _ := json.Marshal(value)
	var copy BrowserState
	_ = json.Unmarshal(data, &copy)
	return &copy, nil
}
func (s *testSessions) Transaction(_ context.Context, key string, fn func(*BrowserState, AccountWriter) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.states[key]
	data, _ := json.Marshal(state)
	_ = json.Unmarshal(data, &state)
	if state.Flows == nil {
		state.Flows = map[string]Flow{}
	}
	if state.Session != nil && state.Session.Expires <= time.Now().UnixMilli() {
		state.Session = nil
	}
	if err := fn(&state, func(i Identity) (Account, error) {
		return Account{ID: uuid.NewSHA1(uuid.Nil, []byte(i.Issuer+"\x00"+i.Subject)), Name: i.Name, Email: i.Email}, nil
	}); err != nil {
		return err
	}
	s.states[key] = state
	return nil
}

type authHarness struct {
	auth    *Auth
	cookie  *http.Cookie
	nonce   string
	subject string
	block   chan struct{}
	entered chan struct{}
}

func newHarness(t *testing.T) *authHarness {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "test"))
	if err != nil {
		t.Fatal(err)
	}
	h := &authHarness{subject: "alice"}
	var issuer string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]any{"issuer": issuer, "authorization_endpoint": issuer + "/authorize", "token_endpoint": issuer + "/token", "jwks_uri": issuer + "/keys", "response_types_supported": []string{"code"}, "subject_types_supported": []string{"public"}, "id_token_signing_alg_values_supported": []string{"RS256"}})
		case "/keys":
			_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "test", Algorithm: "RS256", Use: "sig"}}})
		case "/token":
			if h.entered != nil {
				close(h.entered)
				<-h.block
			}
			claims, _ := json.Marshal(map[string]any{"iss": issuer, "sub": h.subject, "aud": "memory-test", "exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix(), "nonce": h.nonce, "name": "Alice", "email": "same@example.com"})
			signed, err := signer.Sign(claims)
			if err != nil {
				t.Error(err)
				http.Error(w, "sign", 500)
				return
			}
			token, err := signed.CompactSerialize()
			if err != nil {
				t.Error(err)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "unused", "token_type": "Bearer", "id_token": token})
		default:
			http.NotFound(w, r)
		}
	}))
	issuer = server.URL
	t.Cleanup(server.Close)
	h.auth, err = New(t.Context(), Config{Issuer: issuer, ClientID: "memory-test", ClientSecret: "server-only", PublicURL: "http://127.0.0.1:19442"}, &testSessions{states: map[string]BrowserState{}})
	if err != nil {
		t.Fatal(err)
	}
	return h
}
func (h *authHarness) request(method, path, body, origin string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	if h.cookie != nil {
		r.AddCookie(h.cookie)
	}
	w := httptest.NewRecorder()
	h.auth.handle(w, r)
	return w
}
func (h *authHarness) login(t *testing.T, mode string) string {
	t.Helper()
	w := h.request("POST", "/auth/login", fmt.Sprintf(`{"mode":%q,"returnTo":"/#/memory"}`, mode), h.auth.origin)
	if w.Code != 200 {
		t.Fatalf("login: %d %s", w.Code, w.Body.String())
	}
	if cookies := w.Result().Cookies(); len(cookies) > 0 {
		h.cookie = cookies[0]
	}
	var body struct {
		Redirect *string `json:"redirect"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Redirect == nil {
		return ""
	}
	u, err := url.Parse(*body.Redirect)
	if err != nil {
		t.Fatal(err)
	}
	if u.Query().Get("code_challenge_method") != "S256" || u.Query().Get("code_challenge") == "" {
		t.Fatal("PKCE missing")
	}
	h.nonce = u.Query().Get("nonce")
	return u.Query().Get("state")
}
func TestIdentitySDKLoginLogoutAndSwitch(t *testing.T) {
	h := newHarness(t)
	state := h.login(t, "auto")
	if h.login(t, "auto") != "" {
		t.Fatal("auto login loop")
	}
	callback := "/auth/callback?state=" + state + "&code=authorized"
	w := h.request("GET", callback, "", "")
	if w.Code != 303 || w.Header().Get("Location") != "/#/memory" {
		t.Fatalf("callback: %d %s", w.Code, w.Body.String())
	}
	w = h.request("GET", "/auth/session", "", "")
	if !strings.Contains(w.Body.String(), "Alice") {
		t.Fatal("no local session", w.Body.String())
	}
	if h.request("GET", callback, "", "").Code != 400 {
		t.Fatal("replayed callback accepted")
	}
	if h.request("POST", "/auth/logout", "{}", "https://foreign.example").Code != 403 {
		t.Fatal("cross-origin logout")
	}
	if h.request("POST", "/auth/logout", "{}", h.auth.origin).Code != 200 {
		t.Fatal("logout")
	}
	if h.login(t, "auto") != "" {
		t.Fatal("logout silently undone")
	}
	state = h.login(t, "switch")
	h.subject = "bob"
	w = h.request("GET", "/auth/callback?state="+state+"&code=bob", "", "")
	if w.Code != 303 {
		t.Fatal("switch failed", w.Body.String())
	}
	s, err := h.auth.store.Read(t.Context(), h.cookie.Value)
	if err != nil || s.Session == nil {
		t.Fatal("missing new session")
	}
	want := uuid.NewSHA1(uuid.Nil, []byte(h.auth.config.Endpoint.TokenURL[:strings.LastIndex(h.auth.config.Endpoint.TokenURL, "/")]+"\x00bob"))
	if s.Session.Account.ID != want {
		t.Fatal("email conflated accounts")
	}
}
func TestCallbackCannotRestoreSessionAfterLogout(t *testing.T) {
	h := newHarness(t)
	state := h.login(t, "login")
	h.block = make(chan struct{})
	h.entered = make(chan struct{})
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- h.request("GET", "/auth/callback?state="+state+"&code=slow", "", "") }()
	<-h.entered
	if h.request("POST", "/auth/logout", "{}", h.auth.origin).Code != 200 {
		t.Fatal("logout failed")
	}
	close(h.block)
	if w := <-done; w.Code != 401 {
		t.Fatal("late callback restored identity", w.Code)
	}
	if w := h.request("GET", "/auth/session", "", ""); !strings.Contains(w.Body.String(), `"session":null`) {
		t.Fatal("session survived", w.Body.String())
	}
}
func TestNonceAndBrowserBinding(t *testing.T) {
	h := newHarness(t)
	for _, body := range []string{"null", "[]", `{"mode":"unknown"}`, `{} {}`} {
		if w := h.request("POST", "/auth/login", body, h.auth.origin); w.Code != 400 {
			t.Fatalf("invalid login body accepted: %s", body)
		}
	}
	state := h.login(t, "login")
	cookie := h.cookie
	h.cookie = nil
	if h.request("GET", "/auth/callback?state="+state+"&code=wrong-browser", "", "").Code != 400 {
		t.Fatal("callback not bound to browser")
	}
	h.cookie = cookie
	h.nonce = "wrong"
	if h.request("GET", "/auth/callback?state="+state+"&code=wrong-nonce", "", "").Code != 401 {
		t.Fatal("nonce not checked")
	}
	for _, target := range []string{"https://evil.example/", "//evil.example/", "/\\evil.example/", "/%2f/evil.example/", "/auth/callback"} {
		if _, err := h.auth.returnTo(target); err == nil {
			t.Errorf("unsafe return URL %q", target)
		}
	}
}
