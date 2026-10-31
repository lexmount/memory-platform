package nativehttp

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	native "github.com/lexmount/memory-platform/internal/native"
	"github.com/lexmount/memory-platform/internal/security"
)

func TestMain(m *testing.M) {
	security.SetAllowLoopbackForTest(true)
	code := m.Run()
	security.SetAllowLoopbackForTest(false)
	os.Exit(code)
}

func TestPathKeepsDocumentIDsAndRejectsTraversal(t *testing.T) {
	if path, err := Path("/documents/{id}", map[string]string{"id": "100% done"}); err != nil || path != "/documents/100%25%20done" {
		t.Fatalf("literal percent ID lost: %s %v", path, err)
	}
	path, err := Path("/banks/{bank}/documents/{document}", map[string]string{"bank": "b", "document": "https://example.org/docs/a?revision=1"})
	if err != nil || !strings.Contains(path, "https:%2F%2F") {
		t.Fatalf("URL document ID lost: %s %v", path, err)
	}
	for _, id := range []string{"..", "../b", "x/%2e%2e/y", "%252e%252e/b", "x\\y", "x/%2e%2e/y/%zz"} {
		if _, err := Path("/bank/{id}", map[string]string{"id": id}); err == nil {
			t.Fatalf("accepted traversal %s", id)
		}
	}
}

func TestRedirectNotFollowedAndInjectedClientNotMutated(t *testing.T) {
	var reached atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached.Add(1) }))
	defer destination.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, destination.URL, 307) }))
	defer server.Close()
	provided := &http.Client{}
	client, err := New(provided, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if provided.CheckRedirect != nil {
		t.Fatal("mutated shared client")
	}
	if _, err := client.Call(context.Background(), server.URL, http.MethodPost, "/", native.Request{}, nil); err == nil {
		t.Fatal("accepted redirect")
	}
	if reached.Load() != 0 {
		t.Fatal("credentials could reach redirect target")
	}
}

func TestStreamOwnsContextUntilCloseAndLimitIsExplicit(t *testing.T) {
	closed := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		if _, err := w.Write([]byte("data: native\n\n")); err != nil {
			t.Error(err)
			return
		}
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(closed)
	}))
	defer server.Close()
	client, err := New(nil, time.Second, 4)
	if err != nil {
		t.Fatal(err)
	}
	r, err := client.Call(context.Background(), server.URL, http.MethodGet, "/", native.Request{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	b, err := io.ReadAll(r.Body)
	var failure *native.Failure
	if string(b) != "data" || !errors.As(err, &failure) || failure.Kind != "limit" {
		t.Fatalf("silently truncated stream: %q %v", b, err)
	}
	if err := r.Body.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-closed:
	case <-time.After(2 * time.Second):
		t.Fatal("stream context leaked")
	}
}

func TestTruncatedNativeBodyIsDispatchedFailure(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", "1000")
		if _, err := w.Write([]byte("partial")); err != nil {
			t.Error(err)
		}
	}))
	defer s.Close()
	c, err := New(nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	r, err := c.Call(context.Background(), s.URL, http.MethodPost, "/", native.Request{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	b, err := io.ReadAll(r.Body)
	var failure *native.Failure
	if string(b) != "partial" || !errors.As(err, &failure) || !failure.Dispatched || failure.Kind != "transport" {
		t.Fatalf("lost stream failure context: %q %v", b, err)
	}
	if err := r.Body.Close(); err != nil {
		t.Fatal(err)
	}
}
