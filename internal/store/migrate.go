package store

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"
)

//go:embed schema.sql
var schema string

// Migrate owns a separate database. Never run the platform migrations here.
func Migrate(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(713635909135)`); err != nil {
		return err
	}
	var platform bool
	if err = tx.QueryRowContext(ctx, `SELECT to_regclass('tenants') IS NOT NULL OR to_regclass('schema_migrations') IS NOT NULL`).Scan(&platform); err != nil {
		return err
	}
	if platform {
		return errors.New("Memory requires its own database; platform database detected")
	}
	if _, err = tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS memory_schema (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), version integer NOT NULL)`); err != nil {
		return err
	}
	var version int
	err = tx.QueryRowContext(ctx, `SELECT version FROM memory_schema WHERE singleton`).Scan(&version)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if version > 1 {
		return errors.New("Memory database schema is newer than this binary")
	}
	if version == 0 {
		if _, err = tx.ExecContext(ctx, schema); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO memory_schema(version) VALUES(1)`); err != nil {
			return err
		}
	}
	return tx.Commit()
}
