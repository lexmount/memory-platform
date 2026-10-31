// Package testutil creates test accounts in a dedicated Memory database.
package testutil

import (
	"database/sql"
	"os"
	"testing"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/lexmount/memory-platform/internal/store"
)

func DB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("MEMORY_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("MEMORY_TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err = db.PingContext(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = store.Migrate(t.Context(), db); err != nil {
		t.Fatal(err)
	}
	return db
}
func Account(t *testing.T, db *sql.DB) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(`INSERT INTO accounts(id,issuer,subject,name) VALUES($1,'test',$2,'Test account')`, id, id.String()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := db.Exec(`DELETE FROM accounts WHERE id=$1`, id); err != nil {
			t.Error(err)
		}
	})
	return id
}
