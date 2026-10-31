package store

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
)

type ProjectRepository struct{ db *sql.DB }

func (s *ProjectRepository) User(ctx context.Context, id uuid.UUID, user string) (*MemoryProjectUser, error) {
	u := &MemoryProjectUser{ProjectID: id, UserID: user}
	err := s.db.QueryRowContext(ctx, `SELECT native_id,provider_key,provisioned,created_at FROM project_users WHERE project_id=$1 AND user_id=$2`, id, user).Scan(&u.NativeID, &u.ProviderKey, &u.Provisioned, &u.CreatedAt)
	return u, err
}

func (s *ProjectRepository) SaveMCPSession(ctx context.Context, id, project uuid.UUID, user string, version int64, native string) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM mcp_sessions WHERE id IN (SELECT id FROM mcp_sessions WHERE expires_at<=now() ORDER BY expires_at LIMIT 100)`); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO mcp_sessions(id,project_id,user_id,credential_version,native_session,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '12 hours')`, id, project, user, version, native)
	return err
}
func (s *ProjectRepository) MCPSession(ctx context.Context, id, project uuid.UUID, user string, version int64) (string, error) {
	var native string
	err := s.db.QueryRowContext(ctx, `SELECT native_session FROM mcp_sessions WHERE id=$1 AND project_id=$2 AND user_id=$3 AND credential_version=$4 AND expires_at>now()`, id, project, user, version).Scan(&native)
	return native, err
}
func (s *ProjectRepository) DeleteMCPSession(ctx context.Context, id, project uuid.UUID) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM mcp_sessions WHERE project_id=$1 AND id=$2`, project, id)
	return err
}
func NewProjectRepository(db *sql.DB) *ProjectRepository { return &ProjectRepository{db: db} }

var _ MemoryProjectStore = (*ProjectRepository)(nil)

const memoryProjectColumns = `workspace_id,id,account_id,name,provider,connection_id,app_key,secret_hash,credential_version,revoked,enabled,provisioned,created_at,updated_at`

func scanMemoryProject(row interface{ Scan(...any) error }) (*MemoryProject, error) {
	p := new(MemoryProject)
	err := row.Scan(&p.WorkspaceID, &p.ID, &p.AccountID, &p.Name, &p.Provider, &p.ConnectionID, &p.AppKey, &p.SecretHash, &p.CredentialVersion, &p.Revoked, &p.Enabled, &p.Provisioned, &p.CreatedAt, &p.UpdatedAt)
	return p, err
}
func (s *ProjectRepository) Create(ctx context.Context, p *MemoryProject) error {
	if p.WorkspaceID == uuid.Nil {
		w, err := s.EnsureDefaultWorkspace(ctx, p.AccountID)
		if err != nil {
			return err
		}
		p.WorkspaceID = w.ID
	}
	return s.db.QueryRowContext(ctx, `INSERT INTO projects(id,account_id,name,provider,connection_id,app_key,secret_hash,workspace_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING credential_version,enabled,created_at,updated_at`, p.ID, p.AccountID, p.Name, p.Provider, p.ConnectionID, p.AppKey, p.SecretHash, p.WorkspaceID).Scan(&p.CredentialVersion, &p.Enabled, &p.CreatedAt, &p.UpdatedAt)
}
func (s *ProjectRepository) Get(ctx context.Context, id uuid.UUID) (*MemoryProject, error) {
	return scanMemoryProject(s.db.QueryRowContext(ctx, `SELECT `+memoryProjectColumns+` FROM projects WHERE id=$1`, id))
}
func (s *ProjectRepository) ByKey(ctx context.Context, key string) (*MemoryProject, error) {
	return scanMemoryProject(s.db.QueryRowContext(ctx, `SELECT `+memoryProjectColumns+` FROM projects WHERE app_key=$1`, key))
}
func (s *ProjectRepository) List(ctx context.Context, account uuid.UUID) ([]MemoryProject, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+memoryProjectColumns+` FROM projects WHERE account_id=$1 ORDER BY created_at,id`, account)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MemoryProject{}
	for rows.Next() {
		p, err := scanMemoryProject(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}
func memoryProjectChanged(result sql.Result, err error) error {
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return sql.ErrNoRows
	}
	return nil
}
func (s *ProjectRepository) Update(ctx context.Context, account uuid.UUID, id uuid.UUID, name string, enabled bool) error {
	return memoryProjectChanged(s.db.ExecContext(ctx, `UPDATE projects SET name=$3,enabled=$4,updated_at=now() WHERE id=$1 AND account_id=$2`, id, account, name, enabled))
}
func (s *ProjectRepository) Credential(ctx context.Context, account uuid.UUID, id uuid.UUID, hash string, revoked bool) error {
	return memoryProjectChanged(s.db.ExecContext(ctx, `UPDATE projects SET secret_hash=CASE WHEN $3='' THEN secret_hash ELSE $3 END,revoked=$4,credential_version=credential_version+1,updated_at=now() WHERE id=$1 AND account_id=$2`, id, account, hash, revoked))
}
func (s *ProjectRepository) Users(ctx context.Context, id uuid.UUID, after string) ([]MemoryProjectUser, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT project_id,user_id,native_id,provisioned,created_at FROM project_users WHERE project_id=$1 AND user_id>$2 ORDER BY user_id LIMIT 101`, id, after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MemoryProjectUser{}
	for rows.Next() {
		var u MemoryProjectUser
		if err := rows.Scan(&u.ProjectID, &u.UserID, &u.NativeID, &u.Provisioned, &u.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
func (s *ProjectRepository) Provision(ctx context.Context, id uuid.UUID, user string, fn func(*MemoryProject, *MemoryProjectUser) error) (*MemoryProjectUser, error) {
	u := &MemoryProjectUser{ProjectID: id, UserID: user, NativeID: uuid.NewSHA1(id, []byte("memory-user:"+user))}
	// Ready identities do not hold a project lock or call native provisioning.
	err := s.db.QueryRowContext(ctx, `SELECT native_id,provider_key,provisioned,created_at FROM project_users WHERE project_id=$1 AND user_id=$2`, id, user).Scan(&u.NativeID, &u.ProviderKey, &u.Provisioned, &u.CreatedAt)
	if err == nil && u.Provisioned {
		return u, nil
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	p, err := scanMemoryProject(tx.QueryRowContext(ctx, `SELECT `+memoryProjectColumns+` FROM projects WHERE id=$1 FOR UPDATE`, id))
	if err != nil {
		return nil, err
	}
	if !p.Enabled {
		return nil, sql.ErrNoRows
	}
	err = tx.QueryRowContext(ctx, `SELECT native_id,provider_key,provisioned,created_at FROM project_users WHERE project_id=$1 AND user_id=$2`, id, user).Scan(&u.NativeID, &u.ProviderKey, &u.Provisioned, &u.CreatedAt)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if !u.Provisioned {
		if err := fn(p, u); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE projects SET provisioned=true WHERE id=$1`, id); err != nil {
			return nil, err
		}
		if err := tx.QueryRowContext(ctx, `INSERT INTO project_users(project_id,user_id,native_id,provider_key,provisioned) VALUES($1,$2,$3,$4,true) ON CONFLICT(project_id,user_id) DO UPDATE SET provider_key=EXCLUDED.provider_key,provisioned=true RETURNING created_at`, id, user, u.NativeID, u.ProviderKey).Scan(&u.CreatedAt); err != nil {
			return nil, err
		}
		u.Provisioned = true
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return u, nil
}

// EnsureFirstProject atomically creates the onboarding project only for an empty account.
func (s *ProjectRepository) EnsureFirstProject(ctx context.Context, p *MemoryProject) error {
	w, err := s.EnsureDefaultWorkspace(ctx, p.AccountID)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "memory-first-project:"+p.AccountID.String()); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO projects(id,account_id,name,provider,connection_id,app_key,secret_hash,workspace_id) SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE NOT EXISTS (SELECT 1 FROM projects WHERE account_id=$2)`, p.ID, p.AccountID, p.Name, p.Provider, p.ConnectionID, p.AppKey, p.SecretHash, w.ID)
	if err != nil {
		return err
	}
	return tx.Commit()
}
