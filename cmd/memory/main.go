// Memory runs independently of the InsightFlow Gateway and platform database.
package main

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/lexmount/memory-platform/internal/api"
	"github.com/lexmount/memory-platform/internal/auth"
	"github.com/lexmount/memory-platform/internal/projects"
	"github.com/lexmount/memory-platform/internal/store"
)

func main() {
	if err := run(); err != nil {
		slog.Error("Memory stopped", "error", err)
		os.Exit(1)
	}
}
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	dsn := os.Getenv("MEMORY_DATABASE_URL")
	if dsn == "" {
		return errors.New("MEMORY_DATABASE_URL is required")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return errors.New("invalid Memory database configuration")
	}
	defer db.Close()
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	startup, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err = db.PingContext(startup); err != nil {
		return errors.New("Memory database unavailable")
	}
	if err = store.Migrate(startup, db); err != nil {
		return err
	}
	if len(os.Args) > 1 {
		if os.Args[1] == "migrate" && len(os.Args) == 2 {
			return nil
		}
		return errors.New("usage: memory [migrate]")
	}
	configs, err := projects.LoadConnections(os.Getenv)
	if err != nil {
		return err
	}
	if len(configs) == 0 {
		return errors.New("configure at least one MEMORY_HINDSIGHT or MEMORY_OPENVIKING provider")
	}
	service, err := projects.New(store.NewProjectRepository(db), configs, os.Getenv("MEMORY_ENCRYPTION_KEY"), nil)
	if err != nil {
		return err
	}
	go backfillDefaultUsers(ctx, db, service)
	accounts := &auth.Repository{DB: db}
	identity, err := auth.New(startup, auth.Config{Issuer: os.Getenv("MEMORY_SSO_ISSUER"), ClientID: os.Getenv("MEMORY_SSO_CLIENT_ID"), ClientSecret: os.Getenv("MEMORY_SSO_CLIENT_SECRET"), PublicURL: os.Getenv("MEMORY_PUBLIC_URL")}, accounts)
	if err != nil {
		return err
	}
	authentication := &api.Authentication{Identity: identity, Accounts: accounts}
	mux := http.NewServeMux()
	api.RegisterOpenAPI(mux)
	authentication.Register(mux)
	api.NewMemoryProjectsHandler(service, authentication).RegisterUserRoutes(mux)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		check, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if db.PingContext(check) != nil {
			http.Error(w, "unavailable", 503)
			return
		}
		w.WriteHeader(200)
		_, _ = w.Write([]byte("ok\n"))
	})
	dir := os.Getenv("MEMORY_UI_DIR")
	if dir == "" {
		dir = "web/dist"
	}
	if _, err = os.Stat(filepath.Join(dir, "index.html")); err != nil {
		return errors.New("Memory UI not built; run pnpm build or set MEMORY_UI_DIR")
	}
	files := http.FileServer(http.Dir(dir))
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if (r.Method != "GET" && r.Method != "HEAD") || strings.HasPrefix(r.URL.Path, "/v1/") || strings.HasPrefix(r.URL.Path, "/mcp/") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	}))
	addr := os.Getenv("MEMORY_LISTEN")
	if addr == "" {
		addr = "127.0.0.1:19442"
	}
	server := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 64 << 10}
	done := make(chan error, 1)
	go func() { done <- server.ListenAndServe() }()
	cleanup := time.NewTicker(time.Hour)
	defer cleanup.Stop()
	slog.Info("Memory listening", "address", addr, "public_url", identity.Origin(), "callback", identity.Origin()+"/auth/callback")
	for {
		select {
		case err := <-done:
			if errors.Is(err, http.ErrServerClosed) {
				return nil
			}
			return err
		case <-cleanup.C:
			_, err = db.ExecContext(ctx, `DELETE FROM browser_sessions WHERE expires_at<=now(); DELETE FROM mcp_sessions WHERE expires_at<=now()`)
			if err != nil {
				slog.Warn("Memory expired-session cleanup failed")
			}
		case <-ctx.Done():
			shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			return server.Shutdown(shutdown)
		}
	}
}

// Upgrade existing projects without blocking server startup or replacing users.
func backfillDefaultUsers(ctx context.Context, db *sql.DB, service *projects.Service) {
	rows, err := db.QueryContext(ctx, `SELECT id FROM projects p WHERE deleted_at IS NULL AND enabled AND NOT revoked AND NOT EXISTS (SELECT 1 FROM project_users u WHERE u.project_id=p.id AND u.user_id='default' AND u.provisioned)`)
	if err != nil {
		slog.Warn("Default user backfill query failed")
		return
	}
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return
	}
	ready, failed := 0, 0
	for _, id := range ids {
		if ctx.Err() != nil {
			return
		}
		p, err := service.Store.Get(ctx, id)
		if err == nil {
			err = service.EnsureDefaultUser(ctx, p)
		}
		if err != nil {
			failed++
		} else {
			ready++
		}
	}
	slog.Info("Default user backfill completed", "ready", ready, "failed", failed)
}
