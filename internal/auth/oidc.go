package auth

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

const CookieName = "memory_identity"

type Config struct{ Issuer, ClientID, ClientSecret, PublicURL string }
type Auth struct {
	store    SessionStore
	config   oauth2.Config
	verifier *oidc.IDTokenVerifier
	origin   string
	secure   bool
}

func localHTTP(u *url.URL) bool {
	return u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1")
}
func New(ctx context.Context, c Config, store SessionStore) (*Auth, error) {
	u, err := url.Parse(c.PublicURL)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || (u.Scheme != "https" && !localHTTP(u)) {
		return nil, errors.New("MEMORY_PUBLIC_URL must be an HTTPS origin (localhost HTTP is allowed)")
	}
	issuer, err := url.Parse(c.Issuer)
	if err != nil || issuer.Host == "" || issuer.User != nil || issuer.RawQuery != "" || issuer.Fragment != "" || (issuer.Scheme != "https" && !localHTTP(issuer)) {
		return nil, errors.New("invalid MEMORY_SSO_ISSUER")
	}
	if c.ClientID == "" || c.ClientSecret == "" {
		return nil, errors.New("Memory SSO client credentials are required")
	}
	provider, err := oidc.NewProvider(ctx, c.Issuer)
	if err != nil {
		return nil, errors.New("Memory SSO discovery failed")
	}
	origin := u.Scheme + "://" + u.Host
	return &Auth{store: store, origin: origin, secure: u.Scheme == "https", verifier: provider.Verifier(&oidc.Config{ClientID: c.ClientID}), config: oauth2.Config{ClientID: c.ClientID, ClientSecret: c.ClientSecret, Endpoint: provider.Endpoint(), RedirectURL: origin + "/auth/callback", Scopes: []string{oidc.ScopeOpenID, "profile", "email"}}}, nil
}
func randomToken() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}
func browserKey(r *http.Request) string {
	c, err := r.Cookie(CookieName)
	if err != nil || len(c.Value) != 43 {
		return ""
	}
	data, err := base64.RawURLEncoding.DecodeString(c.Value)
	if err != nil || len(data) != 32 {
		return ""
	}
	return c.Value
}
func (a *Auth) cookie(w http.ResponseWriter, key string) {
	http.SetCookie(w, &http.Cookie{Name: CookieName, Value: key, HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteLaxMode, Path: "/", MaxAge: 400 * 86400})
}
func jsonResponse(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 8192))
	if err != nil || !bytes.HasPrefix(bytes.TrimSpace(data), []byte("{")) {
		return errors.New("invalid body")
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return errors.New("invalid body")
	}
	return nil
}
func (a *Auth) Session(r *http.Request) (*Session, error) {
	state, err := a.store.Read(r.Context(), browserKey(r))
	if err != nil {
		return nil, err
	}
	if state == nil || state.Session == nil || state.Session.Expires <= time.Now().UnixMilli() {
		return nil, nil
	}
	return state.Session, nil
}
func (a *Auth) Origin() string              { return a.origin }
func (a *Auth) Register(mux *http.ServeMux) { mux.HandleFunc("/auth/", a.handle) }
func (a *Auth) handle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.Path == "/auth/callback" && r.Method == "GET" {
		a.callback(w, r)
		return
	}
	if r.URL.Path == "/auth/session" && r.Method == "GET" {
		session, err := a.Session(r)
		if err != nil {
			jsonResponse(w, 503, map[string]string{"error": "session_unavailable"})
			return
		}
		jsonResponse(w, 200, map[string]any{"session": session})
		return
	}
	if r.Method != "POST" {
		jsonResponse(w, 405, map[string]string{"error": "method_not_allowed"})
		return
	}
	if r.Header.Get("Origin") != a.origin {
		jsonResponse(w, 403, map[string]string{"error": "origin_mismatch"})
		return
	}
	key := browserKey(r)
	if key == "" {
		key = randomToken()
	}
	if r.URL.Path == "/auth/logout" {
		err := a.store.Transaction(r.Context(), key, func(s *BrowserState, _ AccountWriter) error {
			s.Session = nil
			s.Epoch++
			s.OptedOut = true
			s.Flows = map[string]Flow{}
			return nil
		})
		if err != nil {
			jsonResponse(w, 503, map[string]string{"error": "logout_failed"})
			return
		}
		a.cookie(w, key)
		jsonResponse(w, 200, map[string]bool{"ok": true})
		return
	}
	if r.URL.Path != "/auth/login" {
		jsonResponse(w, 404, map[string]string{"error": "not_found"})
		return
	}
	var body struct {
		Mode     string `json:"mode"`
		ReturnTo string `json:"returnTo"`
	}
	if decode(w, r, &body) != nil || (body.Mode != "" && body.Mode != "auto" && body.Mode != "login" && body.Mode != "switch") {
		jsonResponse(w, 400, map[string]string{"error": "invalid_request"})
		return
	}
	target, err := a.returnTo(body.ReturnTo)
	if err != nil {
		jsonResponse(w, 400, map[string]string{"error": "invalid_return_to"})
		return
	}
	var redirect *string
	err = a.store.Transaction(r.Context(), key, func(s *BrowserState, _ AccountWriter) error {
		now := time.Now().UnixMilli()
		silent := body.Mode == "auto"
		if silent && (s.OptedOut || s.Session != nil || s.RetryUntil > now) {
			return nil
		}
		if !silent {
			s.Session = nil
			s.Epoch++
			s.Flows = map[string]Flow{}
			s.OptedOut = true
		}
		for id, f := range s.Flows {
			if f.Expires <= now {
				delete(s.Flows, id)
			}
		}
		if len(s.Flows) >= 8 {
			return errors.New("too many login attempts")
		}
		state, nonce, verifier := randomToken(), randomToken(), oauth2.GenerateVerifier()
		s.Flows[state] = Flow{Verifier: verifier, Nonce: nonce, ReturnTo: target, Epoch: s.Epoch, Silent: silent, Expires: now + 300000}
		s.RetryUntil = now + 60000
		prompt := "login"
		if silent {
			prompt = "none"
		}
		location := a.config.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier), oidc.Nonce(nonce), oauth2.SetAuthURLParam("prompt", prompt))
		redirect = &location
		return nil
	})
	if err != nil {
		jsonResponse(w, 503, map[string]string{"error": "login_start_failed"})
		return
	}
	a.cookie(w, key)
	jsonResponse(w, 200, map[string]any{"redirect": redirect})
}
func (a *Auth) returnTo(value string) (string, error) {
	if value == "" {
		return "/", nil
	}
	u, err := url.Parse(value)
	if err != nil || u.User != nil || strings.Contains(value, "\\") || strings.ContainsAny(value, "\r\n") {
		return "", errors.New("invalid return URL")
	}
	if u.IsAbs() {
		if u.Scheme+"://"+u.Host != a.origin {
			return "", errors.New("foreign return URL")
		}
		u.Scheme = ""
		u.Host = ""
	}
	if u.Host != "" || !strings.HasPrefix(u.Path, "/") || strings.HasPrefix(u.Path, "//") || strings.HasPrefix(u.Path, "/auth/") {
		return "", errors.New("invalid return path")
	}
	return u.String(), nil
}
func (a *Auth) callback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	key, state := browserKey(r), q.Get("state")
	if key == "" || state == "" || len(q["state"]) != 1 {
		jsonResponse(w, 400, map[string]string{"error": "invalid_callback"})
		return
	}
	var flow Flow
	err := a.store.Transaction(r.Context(), key, func(s *BrowserState, _ AccountWriter) error {
		flow = s.Flows[state]
		delete(s.Flows, state)
		return nil
	})
	if err != nil {
		jsonResponse(w, 503, map[string]string{"error": "session_unavailable"})
		return
	}
	if flow.Expires <= time.Now().UnixMilli() {
		jsonResponse(w, 400, map[string]string{"error": "expired_or_consumed_callback"})
		return
	}
	if flow.Silent && len(q["error"]) == 1 {
		switch q.Get("error") {
		case "login_required", "interaction_required", "consent_required", "account_selection_required":
			http.Redirect(w, r, flow.ReturnTo, 303)
			return
		}
	}
	fail := func() {
		jsonResponse(w, 401, map[string]string{"error": "authentication_failed", "returnTo": flow.ReturnTo})
	}
	if q.Has("error") || len(q["code"]) != 1 || q.Get("code") == "" {
		fail()
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	token, err := a.config.Exchange(ctx, q.Get("code"), oauth2.VerifierOption(flow.Verifier))
	if err != nil {
		fail()
		return
	}
	raw, ok := token.Extra("id_token").(string)
	if !ok {
		fail()
		return
	}
	verified, err := a.verifier.Verify(ctx, raw)
	if err != nil || verified.Nonce != flow.Nonce || verified.Subject == "" {
		fail()
		return
	}
	var claims struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	if verified.Claims(&claims) != nil {
		fail()
		return
	}
	identity := Identity{Issuer: verified.Issuer, Subject: verified.Subject, Name: claims.Name, Email: claims.Email}
	err = a.store.Transaction(r.Context(), key, func(s *BrowserState, account AccountWriter) error {
		if s.Epoch != flow.Epoch || (flow.Silent && s.OptedOut) {
			return errors.New("superseded authentication")
		}
		if !flow.Silent || s.Session == nil {
			user, err := account(identity)
			if err != nil {
				return err
			}
			s.Session = &Session{Account: user, Expires: time.Now().Add(8 * time.Hour).UnixMilli()}
		}
		if !flow.Silent {
			s.OptedOut = false
			s.Epoch++
			s.Flows = map[string]Flow{}
		}
		s.RetryUntil = 0
		return nil
	})
	if err != nil {
		fail()
		return
	}
	http.Redirect(w, r, flow.ReturnTo, 303)
}
