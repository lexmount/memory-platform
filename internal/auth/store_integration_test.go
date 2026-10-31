//go:build integration

package auth_test

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/lexmount/memory-platform/internal/auth"
	"github.com/lexmount/memory-platform/internal/testutil"
)

func TestDurableSessionsAndAccountKeys(t *testing.T) {
	db := testutil.DB(t)
	repo := &auth.Repository{DB: db}
	account := testutil.Account(t, db)
	other := testutil.Account(t, db)
	key, secret, err := repo.CreateKey(t.Context(), account, "automation")
	if err != nil {
		t.Fatal(err)
	}
	got, err := repo.AuthenticateKey(t.Context(), secret)
	if err != nil || got.ID != account {
		t.Fatal("account key", got, err)
	}
	if repo.RevokeKey(t.Context(), other, key.ID) == nil {
		t.Fatal("foreign account revoked key")
	}
	if err = repo.RevokeKey(t.Context(), account, key.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.AuthenticateKey(t.Context(), secret); err == nil {
		t.Fatal("revoked key accepted")
	}
	browser := "test-" + account.String()
	t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM browser_sessions WHERE key_hash=$1`, auth.Hash(browser)) })
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for range 8 {
		wg.Go(func() {
			errs <- repo.Transaction(t.Context(), browser, func(s *auth.BrowserState, _ auth.AccountWriter) error { s.Epoch++; return nil })
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	// A different repository instance observes committed state, not process memory.
	reopened := &auth.Repository{DB: db}
	state, err := reopened.Read(t.Context(), browser)
	if err != nil || state.Epoch != 8 {
		t.Fatal("concurrent state lost", state, err)
	}
	_ = repo.Transaction(t.Context(), browser, func(s *auth.BrowserState, _ auth.AccountWriter) error {
		s.OptedOut = true
		return errors.New("rollback")
	})
	state, err = reopened.Read(t.Context(), browser)
	if err != nil || state.OptedOut {
		t.Fatal("failed transaction committed")
	}
	if err = repo.Transaction(t.Context(), browser, func(s *auth.BrowserState, _ auth.AccountWriter) error {
		s.OptedOut = true
		s.Session = nil
		s.Epoch++
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	state, err = reopened.Read(t.Context(), browser)
	if err != nil || !state.OptedOut || state.Epoch != 9 {
		t.Fatal("logout not durable")
	}
	if _, err = db.Exec(`UPDATE browser_sessions SET expires_at=$2 WHERE key_hash=$1`, auth.Hash(browser), time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	state, err = reopened.Read(t.Context(), browser)
	if err != nil || state != nil {
		t.Fatal("expired browser accepted")
	}
}
