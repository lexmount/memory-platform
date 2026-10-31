package store

import (
	"context"
	"github.com/google/uuid"
	"time"
)

type Workspace struct {
	ID        uuid.UUID `json:"id"`
	AccountID uuid.UUID `json:"-"`
	Name      string    `json:"name"`
	IsDefault bool      `json:"is_default"`
	CreatedAt time.Time `json:"created_at"`
}
type WorkspaceStore interface {
	EnsureDefaultWorkspace(context.Context, uuid.UUID) (*Workspace, error)
	ListWorkspaces(context.Context, uuid.UUID) ([]Workspace, error)
	CreateWorkspace(context.Context, *Workspace) error
	OwnedWorkspace(context.Context, uuid.UUID, uuid.UUID) (*Workspace, error)
}

func (s *ProjectRepository) EnsureDefaultWorkspace(ctx context.Context, account uuid.UUID) (*Workspace, error) {
	_, err := s.db.ExecContext(ctx, `INSERT INTO workspaces(id,account_id,name,is_default) VALUES(md5('memory-workspace:' || ($1::uuid)::text)::uuid,$1::uuid,'默认项目空间',true) ON CONFLICT(account_id) WHERE is_default DO NOTHING`, account)
	if err != nil {
		return nil, err
	}
	w := new(Workspace)
	err = s.db.QueryRowContext(ctx, `SELECT id,account_id,name,is_default,created_at FROM workspaces WHERE account_id=$1 AND is_default`, account).Scan(&w.ID, &w.AccountID, &w.Name, &w.IsDefault, &w.CreatedAt)
	return w, err
}
func (s *ProjectRepository) ListWorkspaces(ctx context.Context, account uuid.UUID) ([]Workspace, error) {
	if _, err := s.EnsureDefaultWorkspace(ctx, account); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,account_id,name,is_default,created_at FROM workspaces WHERE account_id=$1 ORDER BY is_default DESC,created_at,id`, account)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Workspace{}
	for rows.Next() {
		var w Workspace
		if err := rows.Scan(&w.ID, &w.AccountID, &w.Name, &w.IsDefault, &w.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}
func (s *ProjectRepository) CreateWorkspace(ctx context.Context, w *Workspace) error {
	return s.db.QueryRowContext(ctx, `INSERT INTO workspaces(id,account_id,name) VALUES($1,$2,$3) RETURNING created_at`, w.ID, w.AccountID, w.Name).Scan(&w.CreatedAt)
}
func (s *ProjectRepository) OwnedWorkspace(ctx context.Context, account, id uuid.UUID) (*Workspace, error) {
	w := new(Workspace)
	err := s.db.QueryRowContext(ctx, `SELECT id,account_id,name,is_default,created_at FROM workspaces WHERE id=$1 AND account_id=$2`, id, account).Scan(&w.ID, &w.AccountID, &w.Name, &w.IsDefault, &w.CreatedAt)
	return w, err
}
