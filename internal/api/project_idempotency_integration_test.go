//go:build integration

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/lexmount/memory-platform/internal/auth"
	"github.com/lexmount/memory-platform/internal/projects"
	"github.com/lexmount/memory-platform/internal/store"
	"github.com/lexmount/memory-platform/internal/testutil"
)

func TestProjectCreationIdempotencyAndLostCredentialRecovery(t *testing.T) {
	db := testutil.DB(t)
	accounts := &auth.Repository{DB: db}
	account, other := testutil.Account(t, db), testutil.Account(t, db)
	_, token, err := accounts.CreateKey(t.Context(), account, "integration")
	if err != nil {
		t.Fatal(err)
	}
	_, otherToken, err := accounts.CreateKey(t.Context(), other, "other")
	if err != nil {
		t.Fatal(err)
	}
	repository := store.NewProjectRepository(db)
	service, err := projects.New(repository, []projects.Config{{Provider: "hindsight", Endpoint: "https://memory-provider.example", APIKey: "provider-secret", NamespacePrefix: "test"}}, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	NewMemoryProjectsHandler(service, &Authentication{Accounts: accounts}).RegisterUserRoutes(mux)
	request := func(path, credential, key, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+credential)
		if key != "" {
			r.Header.Set("Idempotency-Key", key)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	type created struct {
		Project store.MemoryProject `json:"project"`
		Secret  string              `json:"app_secret"`
	}
	key := uuid.NewString()
	const body = `{"name":"External project","provider":"hindsight"}`
	// Separate API processes can race the same management request. Only one
	// response releases credentials; retries identify the existing project.
	results := make(chan *httptest.ResponseRecorder, 8)
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() { results <- request("/v1/projects", token, key, body) })
	}
	wg.Wait()
	close(results)
	var first created
	newCount := 0
	for w := range results {
		var result created
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		switch w.Code {
		case http.StatusCreated:
			newCount++
			if result.Secret == "" {
				t.Fatal("new project omitted its one-time secret")
			}
			first = result
		case http.StatusOK:
			if result.Secret != "" {
				t.Fatal("retry disclosed a project secret")
			}
		default:
			t.Fatalf("creation status=%d body=%s", w.Code, w.Body.String())
		}
	}
	if newCount != 1 {
		t.Fatalf("created %d projects for the same request", newCount)
	}
	items, err := repository.List(t.Context(), account)
	if err != nil || len(items) != 1 {
		t.Fatalf("inventory=%d err=%v", len(items), err)
	}
	w := request("/v1/projects", token, key, body)
	var replay created
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &replay) != nil || replay.Project.ID != first.Project.ID || replay.Secret != "" {
		t.Fatal("retry did not recover the existing project")
	}
	if w := request("/v1/projects", token, key, `{"name":"Changed request","provider":"hindsight"}`); w.Code != 400 {
		t.Fatalf("idempotency payload mismatch=%d", w.Code)
	}
	if w := request("/v1/projects", token, "invalid", body); w.Code != 400 {
		t.Fatalf("invalid idempotency key=%d", w.Code)
	}
	w = request("/v1/projects", otherToken, key, body)
	var foreign created
	if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &foreign) != nil || foreign.Project.ID == first.Project.ID {
		t.Fatal("idempotency key crossed account ownership")
	}
	// A caller that lost the first response can recover by rotating the key
	// only after persisting the returned project ID. No second project appears.
	w = request("/v1/projects/"+first.Project.ID.String()+"/credentials/rotate", token, "", `{}`)
	var credentials map[string]string
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &credentials) != nil {
		t.Fatal("credential recovery failed")
	}
	if _, err := service.Authenticate(t.Context(), first.Project.AppKey, first.Secret); err == nil {
		t.Fatal("recovery left the old credential usable")
	}
	if _, err := service.Authenticate(t.Context(), credentials["app_key"], credentials["app_secret"]); err != nil {
		t.Fatal(err)
	}
}
