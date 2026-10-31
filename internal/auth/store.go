// Package auth owns Memory accounts and application-local sessions. Its OIDC
// flow follows the Lexmount Identity SDK 0.1.0 server-mode contract.
package auth

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

type Identity struct {
	Issuer  string `json:"issuer"`
	Subject string `json:"subject"`
	Name    string `json:"name,omitempty"`
	Email   string `json:"email,omitempty"`
}
type Account struct {
	ID    uuid.UUID `json:"id"`
	Name  string    `json:"name"`
	Email string    `json:"email"`
}
type Session struct {
	Account Account `json:"account"`
	Expires int64   `json:"expires"`
}
type Flow struct {
	Verifier string `json:"verifier"`
	Nonce    string `json:"nonce"`
	ReturnTo string `json:"returnTo"`
	Epoch    int64  `json:"epoch"`
	Silent   bool   `json:"silent"`
	Expires  int64  `json:"expires"`
}
type BrowserState struct {
	Epoch      int64           `json:"epoch"`
	OptedOut   bool            `json:"optedOut"`
	RetryUntil int64           `json:"retryUntil"`
	Flows      map[string]Flow `json:"flows"`
	Session    *Session        `json:"session,omitempty"`
	Expires    int64           `json:"expires"`
}
type AccountWriter func(Identity) (Account, error)
type SessionStore interface {
	Read(context.Context, string) (*BrowserState, error)
	Transaction(context.Context, string, func(*BrowserState, AccountWriter) error) error
}
type Repository struct{ DB *sql.DB }

func Hash(value string) string { h := sha256.Sum256([]byte(value)); return hex.EncodeToString(h[:]) }
func (s *Repository) Read(ctx context.Context, key string) (*BrowserState, error) {
	if key == "" {
		return nil, nil
	}
	var data []byte
	err := s.DB.QueryRowContext(ctx, `SELECT state FROM browser_sessions WHERE key_hash=$1 AND expires_at>now()`, Hash(key)).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var state BrowserState
	if err = json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	return &state, nil
}
func (s *Repository) Transaction(ctx context.Context, key string, fn func(*BrowserState, AccountWriter) error) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	hash := Hash(key)
	// Lock even when a browser has no row yet, across all service replicas.
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, hash); err != nil {
		return err
	}
	var data []byte
	err = tx.QueryRowContext(ctx, `SELECT state FROM browser_sessions WHERE key_hash=$1 AND expires_at>now()`, hash).Scan(&data)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	state := BrowserState{Flows: map[string]Flow{}, Expires: time.Now().Add(400 * 24 * time.Hour).UnixMilli()}
	if len(data) > 0 {
		if err = json.Unmarshal(data, &state); err != nil {
			return err
		}
	}
	if state.Flows == nil {
		state.Flows = map[string]Flow{}
	}
	if state.Session != nil && state.Session.Expires <= time.Now().UnixMilli() {
		state.Session = nil
	}
	account := func(identity Identity) (Account, error) {
		var a Account
		err := tx.QueryRowContext(ctx, `INSERT INTO accounts(id,issuer,subject,name,email) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(issuer,subject) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email RETURNING id,name,email`,
			uuid.New(), identity.Issuer, identity.Subject, identity.Name, identity.Email).Scan(&a.ID, &a.Name, &a.Email)
		return a, err
	}
	if err = fn(&state, account); err != nil {
		return err
	}
	data, err = json.Marshal(state)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO browser_sessions(key_hash,state,expires_at) VALUES($1,$2,$3)
  ON CONFLICT(key_hash) DO UPDATE SET state=EXCLUDED.state,expires_at=EXCLUDED.expires_at`, hash, data, time.UnixMilli(state.Expires)); err != nil {
		return err
	}
	return tx.Commit()
}

type APIKey struct {
	ID        uuid.UUID  `json:"id"`
	Name      string     `json:"name"`
	Prefix    string     `json:"prefix"`
	CreatedAt time.Time  `json:"created_at"`
	RevokedAt *time.Time `json:"revoked_at"`
}

func (s *Repository) Keys(ctx context.Context, account uuid.UUID) ([]APIKey, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id,name,prefix,created_at,revoked_at FROM account_api_keys WHERE account_id=$1 ORDER BY created_at DESC`, account)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []APIKey{}
	for rows.Next() {
		var k APIKey
		if err = rows.Scan(&k.ID, &k.Name, &k.Prefix, &k.CreatedAt, &k.RevokedAt); err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}
func (s *Repository) CreateKey(ctx context.Context, account uuid.UUID, name string) (APIKey, string, error) {
	raw := "ma_" + randomToken()
	k := APIKey{ID: uuid.New(), Name: name, Prefix: raw[:11]}
	err := s.DB.QueryRowContext(ctx, `INSERT INTO account_api_keys(id,account_id,name,key_hash,prefix) VALUES($1,$2,$3,$4,$5) RETURNING created_at`, k.ID, account, name, Hash(raw), k.Prefix).Scan(&k.CreatedAt)
	return k, raw, err
}
func (s *Repository) RevokeKey(ctx context.Context, account, id uuid.UUID) error {
	result, err := s.DB.ExecContext(ctx, `UPDATE account_api_keys SET revoked_at=COALESCE(revoked_at,now()) WHERE account_id=$1 AND id=$2`, account, id)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n != 1 {
		return sql.ErrNoRows
	}
	return err
}
func (s *Repository) AuthenticateKey(ctx context.Context, key string) (Account, error) {
	var a Account
	if len(key) != 46 || key[:3] != "ma_" {
		return a, sql.ErrNoRows
	}
	err := s.DB.QueryRowContext(ctx, `SELECT a.id,a.name,a.email FROM accounts a JOIN account_api_keys k ON k.account_id=a.id WHERE k.key_hash=$1 AND k.revoked_at IS NULL`, Hash(key)).Scan(&a.ID, &a.Name, &a.Email)
	return a, err
}
