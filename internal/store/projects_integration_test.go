//go:build integration

package store_test

import (
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/lexmount/memory-platform/internal/store"
	"github.com/lexmount/memory-platform/internal/testutil"
)

func TestMemoryProjectsIsolationProvisionAndSessions(t *testing.T) {
	db := testutil.DB(t)
	account := testutil.Account(t, db)
	t.Cleanup(func() {
		if _, err := db.Exec(`DELETE FROM accounts WHERE id=$1`, account); err != nil {
			t.Error(err)
		}
	})
	s := store.NewProjectRepository(db)
	ctx := t.Context()
	p := &store.MemoryProject{ID: uuid.New(), AccountID: account, Name: "Project", Provider: "openviking", ConnectionID: "connection", AppKey: uuid.NewString(), SecretHash: "hash"}
	if err := s.Create(ctx, p); err != nil {
		t.Fatal(err)
	}
	other := uuid.New()
	if got, err := s.List(ctx, other); err != nil || len(got) != 0 {
		t.Fatalf("foreign inventory: %v %v", got, err)
	}
	if err := s.Update(ctx, other, p.ID, "foreign", false); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("foreign update: %v", err)
	}
	if err := s.Credential(ctx, other, p.ID, "foreign", true); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("foreign credential: %v", err)
	}

	var calls atomic.Int32
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for range 8 {
		wg.Go(func() {
			u, err := s.Provision(ctx, p.ID, "张三", func(project *store.MemoryProject, u *store.MemoryProjectUser) error {
				if project.Provisioned {
					return errors.New("first native initialization repeated")
				}
				calls.Add(1)
				u.ProviderKey = "encrypted-key"
				return nil
			})
			if err == nil && (!u.Provisioned || u.ProviderKey != "encrypted-key") {
				err = errors.New("incomplete mapping")
			}
			errs <- err
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("provision calls=%d", calls.Load())
	}
	var attempted uuid.UUID
	_, err := s.Provision(ctx, p.ID, "recover", func(_ *store.MemoryProject, u *store.MemoryProjectUser) error {
		attempted = u.NativeID
		return errors.New("lost native response")
	})
	if err == nil {
		t.Fatal("expected rollback")
	}
	if _, err := s.User(ctx, p.ID, "recover"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("failed creation visible: %v", err)
	}
	recovered, err := s.Provision(ctx, p.ID, "recover", func(project *store.MemoryProject, u *store.MemoryProjectUser) error {
		if !project.Provisioned || u.NativeID != attempted {
			return errors.New("retry remapped native identity")
		}
		u.ProviderKey = "recovered-encrypted-key"
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for n := 0; n < 102; n++ {
		_, err := s.Provision(ctx, p.ID, fmt.Sprintf("page-%03d", n), func(_ *store.MemoryProject, u *store.MemoryProjectUser) error {
			u.ProviderKey = "encrypted"
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	page, err := s.Users(ctx, p.ID, "")
	if err != nil || len(page) != 101 {
		t.Fatalf("first page: %d %v", len(page), err)
	}
	next, err := s.Users(ctx, p.ID, page[99].UserID)
	if err != nil || len(next) != 4 || next[0].UserID != page[100].UserID {
		t.Fatalf("next page: %v %v", next, err)
	}
	session := uuid.New()
	if err := s.SaveMCPSession(ctx, session, p.ID, "recover", p.CredentialVersion, "native-session"); err != nil {
		t.Fatal(err)
	}
	for _, call := range []struct {
		project uuid.UUID
		user    string
		version int64
	}{{uuid.New(), "recover", 1}, {p.ID, "张三", 1}, {p.ID, "recover", 2}} {
		if _, err := s.MCPSession(ctx, session, call.project, call.user, call.version); !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("foreign session: %v", err)
		}
	}
	if err := s.Credential(ctx, account, p.ID, "rotated", false); err != nil {
		t.Fatal(err)
	}
	current, err := s.ByKey(ctx, p.AppKey)
	if err != nil || current.CredentialVersion != 2 || current.SecretHash != "rotated" {
		t.Fatalf("rotation: %v %v", current, err)
	}
	user, err := s.User(ctx, p.ID, "recover")
	if err != nil || user.NativeID != recovered.NativeID || user.ProviderKey != recovered.ProviderKey {
		t.Fatalf("rotation changed mapping: %v %v", user, err)
	}
	if _, err := s.MCPSession(ctx, session, p.ID, "recover", current.CredentialVersion); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("old session survived rotation")
	}
	if _, err := db.ExecContext(ctx, `UPDATE mcp_sessions SET expires_at=now()-interval '1 second' WHERE id=$1`, session); err != nil {
		t.Fatal(err)
	}
	if _, err := s.MCPSession(ctx, session, p.ID, "recover", 1); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("expired session accepted")
	}
	if err := s.SaveMCPSession(ctx, uuid.New(), p.ID, "recover", 2, "new"); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM mcp_sessions WHERE id=$1`, session).Scan(&count); err != nil || count != 0 {
		t.Fatalf("expired session not collected: %d %v", count, err)
	}
}
