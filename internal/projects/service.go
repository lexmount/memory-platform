// Package projects owns developer Memory project identity, not Memory business
// objects. Provider HTTP/MCP requests are forwarded using the resolved identity.
package projects

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/lexmount/memory-platform/internal/crypto"
	"github.com/lexmount/memory-platform/internal/store"

	native "github.com/lexmount/memory-platform/internal/native"
	"github.com/lexmount/memory-platform/internal/nativehttp"
	"github.com/lexmount/memory-platform/internal/profiles"
)

var (
	ErrInvalid     = errors.New("invalid memory project request")
	ErrDenied      = errors.New("memory project denied")
	ErrUnavailable = errors.New("memory provider unavailable")
	ErrSession     = errors.New("memory MCP session not found")
)

type Connection struct {
	Config      Config
	ID          string
	catalog     *profiles.Catalog
	mu          sync.Mutex
	description *Description
	schemas     map[string]json.RawMessage
}
type Service struct {
	Store       store.MemoryProjectStore
	connections map[string]*Connection
	client      *nativehttp.Client
	encKey      string
}
type Identity struct {
	Project     *store.MemoryProject     `json:"-"`
	User        *store.MemoryProjectUser `json:"-"`
	ProjectID   uuid.UUID                `json:"project_id"`
	UserID      string                   `json:"user_id"`
	Mapping     map[string]string        `json:"mapping"`
	Description *Description             `json:"provider,omitempty"`
	key         string
	connection  *Connection
}
type Operation struct {
	ID           string   `json:"id"`
	Method       string   `json:"method"`
	Path         string   `json:"path"`
	Description  string   `json:"description"`
	RequestMedia []string `json:"request_media"`
	Permission   string   `json:"permission"` // UI write/delete presentation only; never authorization.
}
type Description struct {
	Provider   string      `json:"provider"`
	Version    string      `json:"version"`
	Operations []Operation `json:"operations"`
}

func LoadConnections(getenv func(string) string) ([]Config, error) {
	var out []Config
	for _, p := range []string{"hindsight", "openviking"} {
		prefix := "MEMORY_" + strings.ToUpper(p) + "_"
		fields := map[string]string{"PROVIDER": p, "URL": getenv(prefix + "URL"), "API_KEY": getenv(prefix + "API_KEY"), "NAMESPACE_PREFIX": getenv(prefix + "NAMESPACE_PREFIX"), "STORAGE_TENANT": getenv(prefix + "STORAGE_TENANT")}
		if fields["URL"] == "" && fields["API_KEY"] == "" && fields["NAMESPACE_PREFIX"] == "" && fields["STORAGE_TENANT"] == "" {
			continue
		}
		cfg, err := LoadConfig(func(k string) string { return fields[k] })
		if err != nil {
			return nil, fmt.Errorf("invalid Memory %s connection", p)
		}
		if cfg.APIKey == "" {
			return nil, fmt.Errorf("%sAPI_KEY is required", prefix)
		}
		out = append(out, cfg)
	}
	return out, nil
}
func New(repository store.MemoryProjectStore, configs []Config, encKey string, httpClient *http.Client) (*Service, error) {
	client, err := nativehttp.New(httpClient, 0, 0)
	if err != nil {
		return nil, err
	}
	s := &Service{Store: repository, connections: map[string]*Connection{}, client: client, encKey: encKey}
	for _, cfg := range configs {
		if cfg.Provider == "openviking" {
			if _, err := crypto.DeriveKey(encKey); err != nil {
				return nil, errors.New("OpenViking requires MEMORY_ENCRYPTION_KEY for native user credentials")
			}
		}
		var cat *profiles.Catalog
		switch cfg.Provider {
		case "hindsight":
			cat, err = profiles.Load("hindsight")
		case "openviking":
			cat, err = profiles.Load("openviking")
		default:
			return nil, ErrInvalid
		}
		if err != nil {
			return nil, err
		}
		hash := sha256.Sum256([]byte(cfg.Provider + "\x00" + cfg.Endpoint + "\x00" + cfg.NamespacePrefix))
		s.connections[cfg.Provider] = &Connection{Config: cfg, ID: hex.EncodeToString(hash[:]), catalog: cat}
	}
	return s, nil
}
func (s *Service) Providers() []Description {
	out := []Description{}
	for _, id := range []string{"hindsight", "openviking"} {
		if c := s.connections[id]; c != nil {
			c.mu.Lock()
			version := c.catalog.Version
			if c.description != nil {
				version = c.description.Version
			}
			c.mu.Unlock()
			out = append(out, Description{Provider: id, Version: version, Operations: []Operation{}})
		}
	}
	return out
}
func NewSecret() (string, string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	raw := "ms_" + hex.EncodeToString(b)
	return raw, crypto.HashAPIKey(raw), nil
}
func (s *Service) Create(ctx context.Context, account uuid.UUID, name, provider string) (*store.MemoryProject, string, error) {
	return s.CreateOnce(ctx, account, name, provider, uuid.Nil)
}

// CreateOnce scopes a caller's idempotency key to its account. A replay returns
// the same project without disclosing or rotating its one-time secret. Clients
// recovering a lost creation reply can explicitly rotate that project's key.
func (s *Service) CreateOnce(ctx context.Context, account uuid.UUID, name, provider string, requestID uuid.UUID) (*store.MemoryProject, string, error) {
	c := s.connections[provider]
	name = strings.TrimSpace(name)
	if c == nil || account == uuid.Nil || name == "" || utf8.RuneCountInString(name) > 100 || !utf8.ValidString(name) {
		return nil, "", ErrInvalid
	}
	secret, hash, err := NewSecret()
	if err != nil {
		return nil, "", err
	}
	p := &store.MemoryProject{ID: uuid.New(), AccountID: account, Name: name, Provider: provider, ConnectionID: c.ID, AppKey: "mp_" + strings.ReplaceAll(uuid.NewString(), "-", ""), SecretHash: hash, Enabled: true, CredentialVersion: 1}
	if requestID != uuid.Nil {
		p.ID = uuid.NewSHA1(account, []byte("project-create:"+requestID.String()))
	}
	if err := s.Store.Create(ctx, p); err != nil {
		if requestID != uuid.Nil && errors.Is(err, store.ErrProjectExists) {
			existing, err := s.Store.Get(ctx, p.ID)
			if err != nil {
				return nil, "", err
			}
			if existing.AccountID != account || existing.Name != name || existing.Provider != provider || existing.ConnectionID != c.ID {
				return nil, "", ErrInvalid
			}
			return existing, "", nil
		}
		return nil, "", err
	}
	return p, secret, nil
}
func (s *Service) Authenticate(ctx context.Context, key, secret string) (*store.MemoryProject, error) {
	if key == "" || secret == "" || len(key) > 100 || len(secret) > 200 || s.Store == nil {
		return nil, ErrDenied
	}
	p, err := s.Store.ByKey(ctx, key)
	if err != nil {
		return nil, ErrDenied
	}
	hash := crypto.HashAPIKey(secret)
	if subtle.ConstantTimeCompare([]byte(hash), []byte(p.SecretHash)) != 1 || p.Revoked || !p.Enabled {
		return nil, ErrDenied
	}
	return p, nil
}
func (s *Service) Owned(ctx context.Context, account uuid.UUID, id uuid.UUID) (*store.MemoryProject, error) {
	if s.Store == nil {
		return nil, ErrUnavailable
	}
	p, err := s.Store.Get(ctx, id)
	if err != nil || account == uuid.Nil || p.AccountID != account {
		return nil, ErrDenied
	}
	return p, nil
}
func ValidUser(user string) bool {
	return user != "" && len(user) <= 255 && utf8.ValidString(user) && !strings.ContainsAny(user, "\r\n\x00") && strings.TrimSpace(user) == user
}
func (s *Service) Resolve(ctx context.Context, p *store.MemoryProject, user string) (*Identity, error) {
	if !ValidUser(user) {
		return nil, ErrInvalid
	}
	if !p.Enabled {
		return nil, ErrDenied
	}
	c := s.connections[p.Provider]
	if c == nil || c.ID != p.ConnectionID {
		return nil, ErrUnavailable
	}
	u, err := s.Store.Provision(ctx, p.ID, user, func(current *store.MemoryProject, u *store.MemoryProjectUser) error {
		return s.provision(ctx, c, current, u)
	})
	if err != nil {
		var failure *native.Failure
		if errors.As(err, &failure) {
			return nil, nativehttp.Preflight(err)
		}
		return nil, err
	}
	i := &Identity{Project: p, User: u, ProjectID: p.ID, UserID: user, Mapping: mapping(c, p, u), connection: c}
	if p.Provider == "openviking" {
		i.key, err = crypto.DecryptStrict(u.ProviderKey, s.encKey)
	} else {
		i.key = c.Config.APIKey
	}
	if err != nil || i.key == "" {
		return nil, ErrUnavailable
	}
	return i, nil
}

// ResolveExisting is the console path: viewing a project never creates users.
func (s *Service) ResolveExisting(ctx context.Context, p *store.MemoryProject, user string) (*Identity, error) {
	if !ValidUser(user) {
		return nil, ErrInvalid
	}
	if !p.Enabled {
		return nil, ErrDenied
	}
	c := s.connections[p.Provider]
	if c == nil || c.ID != p.ConnectionID {
		return nil, ErrUnavailable
	}
	u, err := s.Store.User(ctx, p.ID, user)
	if err != nil || !u.Provisioned {
		return nil, ErrDenied
	}
	i := &Identity{Project: p, User: u, ProjectID: p.ID, UserID: user, Mapping: mapping(c, p, u), connection: c, key: c.Config.APIKey}
	if p.Provider == "openviking" {
		i.key, err = crypto.DecryptStrict(u.ProviderKey, s.encKey)
	}
	if err != nil || i.key == "" {
		return nil, ErrUnavailable
	}
	return i, nil
}

func mapping(c *Connection, p *store.MemoryProject, u *store.MemoryProjectUser) map[string]string {
	project := c.Config.NamespacePrefix + "_p_" + strings.ReplaceAll(p.ID.String(), "-", "")
	user := "u_" + strings.ReplaceAll(u.NativeID.String(), "-", "")
	if p.Provider == "hindsight" {
		return map[string]string{"bank_id": project + "_" + user}
	}
	root := "viking://user/" + user
	return map[string]string{"account_id": project, "user_id": user, "user_uri": root, "memory_uri": root + "/memories", "resources_uri": "viking://resources", "skills_uri": "viking://agent/skills", "private_resources_uri": root + "/resources", "private_skills_uri": root + "/skills"}
}
func (s *Service) headers(i *Identity) http.Header {
	h := make(http.Header)
	if i.Project.Provider == "hindsight" {
		h.Set("Authorization", "Bearer "+i.key)
	} else {
		h.Set("X-API-Key", i.key)
	}
	return h
}
