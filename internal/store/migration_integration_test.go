//go:build integration

package store

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
	"os"
	"strings"
	"testing"
)

func TestUpgradeWorkspacePreservesExistingApplication(t *testing.T) {
	dsn := os.Getenv("MEMORY_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("integration database required")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	schemaName := "migration_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err = conn.ExecContext(ctx, `CREATE SCHEMA `+schemaName); err != nil {
		t.Fatal(err)
	}
	defer conn.ExecContext(ctx, `DROP SCHEMA `+schemaName+` CASCADE`)
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SET LOCAL search_path TO `+schemaName); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.ExecContext(ctx, schema); err != nil {
		t.Fatal(err)
	}
	account, project := uuid.New(), uuid.New()
	if _, err = tx.ExecContext(ctx, `INSERT INTO accounts(id,issuer,subject,name) VALUES($1,'test','legacy','Legacy')`, account); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO projects(id,account_id,name,provider,connection_id,app_key,secret_hash) VALUES($1,$2,'Legacy app','hindsight','conn','original-key','original-hash')`, project, account); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.ExecContext(ctx, workspaceSchema); err != nil {
		t.Fatal(err)
	}
	var count int
	var key, hash, name string
	if err = tx.QueryRowContext(ctx, `SELECT p.app_key,p.secret_hash,w.name FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE p.id=$1`, project).Scan(&key, &hash, &name); err != nil {
		t.Fatal(err)
	}
	if key != "original-key" || hash != "original-hash" || name != "默认项目空间" {
		t.Fatal("migration changed existing credentials")
	}
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM workspaces WHERE account_id=$1`, account).Scan(&count); err != nil || count != 1 {
		t.Fatalf("space count %d: %v", count, err)
	}
}
