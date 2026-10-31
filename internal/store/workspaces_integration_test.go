//go:build integration

package store_test

import (
	"database/sql"
	"errors"
	"github.com/google/uuid"
	"github.com/lexmount/memory-platform/internal/store"
	"github.com/lexmount/memory-platform/internal/testutil"
	"sync"
	"testing"
)

func TestWorkspaceDefaultConcurrencyAndOwnership(t *testing.T) {
	db := testutil.DB(t)
	account, other := testutil.Account(t, db), testutil.Account(t, db)
	s := store.NewProjectRepository(db)
	ctx := t.Context()
	var wg sync.WaitGroup
	ids := make(chan uuid.UUID, 8)
	errs := make(chan error, 8)
	for range 8 {
		wg.Go(func() {
			w, err := s.EnsureDefaultWorkspace(ctx, account)
			if err != nil {
				errs <- err
				return
			}
			ids <- w.ID
		})
	}
	wg.Wait()
	close(ids)
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	var id uuid.UUID
	for got := range ids {
		if id != uuid.Nil && id != got {
			t.Fatal("duplicate default")
		}
		id = got
	}
	spaces, err := s.ListWorkspaces(ctx, account)
	if err != nil || len(spaces) != 1 || spaces[0].Name != "默认项目空间" {
		t.Fatalf("default: %+v %v", spaces, err)
	}
	if _, err := s.OwnedWorkspace(ctx, other, id); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("foreign space: %v", err)
	}
	second := &store.Workspace{ID: uuid.New(), AccountID: account, Name: "Second"}
	if err := s.CreateWorkspace(ctx, second); err != nil {
		t.Fatal(err)
	}
	p := &store.MemoryProject{ID: uuid.New(), WorkspaceID: second.ID, AccountID: account, Name: "App", Provider: "hindsight", ConnectionID: "test", AppKey: uuid.NewString(), SecretHash: "hash"}
	if err := s.Create(ctx, p); err != nil {
		t.Fatal(err)
	}
	got, err := s.Get(ctx, p.ID)
	if err != nil || got.WorkspaceID != second.ID {
		t.Fatalf("persisted binding: %+v %v", got, err)
	}
	p.ID = uuid.New()
	p.AppKey = uuid.NewString()
	p.AccountID = other
	if err := s.Create(ctx, p); err == nil {
		t.Fatal("foreign workspace accepted")
	}
	p.AccountID = account
	p.WorkspaceID = uuid.Nil
	if err := s.Create(ctx, p); err != nil || p.WorkspaceID != id {
		t.Fatalf("legacy create default: %v", err)
	}
}

func TestFirstProjectConcurrentAndPreservesExisting(t *testing.T) {
	db := testutil.DB(t)
	s := store.NewProjectRepository(db)
	account := testutil.Account(t, db)
	candidate := func() *store.MemoryProject {
		return &store.MemoryProject{ID: uuid.New(), AccountID: account, Name: "默认项目空间", Provider: "hindsight", ConnectionID: "test", AppKey: uuid.NewString(), SecretHash: "hash"}
	}
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for range 8 {
		wg.Go(func() { errs <- s.EnsureFirstProject(t.Context(), candidate()) })
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	items, err := s.List(t.Context(), account)
	if err != nil || len(items) != 1 || items[0].Provider != "hindsight" || items[0].Name != "默认项目空间" {
		t.Fatalf("unexpected default: %+v %v", items, err)
	}
	other := testutil.Account(t, db)
	p := candidate()
	p.AccountID = other
	p.Name = "Existing"
	p.Provider = "openviking"
	if err := s.Create(t.Context(), p); err != nil {
		t.Fatal(err)
	}
	next := candidate()
	next.AccountID = other
	if err := s.EnsureFirstProject(t.Context(), next); err != nil {
		t.Fatal(err)
	}
	items, err = s.List(t.Context(), other)
	if err != nil || len(items) != 1 || items[0].ID != p.ID || items[0].Provider != "openviking" {
		t.Fatalf("existing changed: %+v %v", items, err)
	}
}

func TestProjectDeleteRevokesAndDoesNotRecreateDefault(t *testing.T) {
	db := testutil.DB(t)
	s := store.NewProjectRepository(db)
	account := testutil.Account(t, db)
	other := testutil.Account(t, db)
	p := &store.MemoryProject{ID: uuid.New(), AccountID: account, Name: "Delete test", Provider: "hindsight", ConnectionID: "test", AppKey: uuid.NewString(), SecretHash: "hash"}
	if err := s.Create(t.Context(), p); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(t.Context(), other, p.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("foreign deletion: %v", err)
	}
	if err := s.Delete(t.Context(), account, p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ByKey(t.Context(), p.AppKey); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("deleted key accepted: %v", err)
	}
	if _, err := s.Get(t.Context(), p.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("deleted project accessible: %v", err)
	}
	p.ID = uuid.New()
	p.AppKey = uuid.NewString()
	if err := s.EnsureFirstProject(t.Context(), p); err != nil {
		t.Fatal(err)
	}
	items, err := s.List(t.Context(), account)
	if err != nil || len(items) != 0 {
		t.Fatalf("deleted project recreated: %+v %v", items, err)
	}
}
