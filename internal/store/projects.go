package store

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// MemoryProject belongs to one Memory account. It has no InsightFlow tenant or Agent identity.
type MemoryProject struct {
	WorkspaceID       uuid.UUID `json:"workspace_id"`
	ID                uuid.UUID `json:"id"`
	AccountID         uuid.UUID `json:"-"`
	Name              string    `json:"name"`
	Provider          string    `json:"provider"`
	ConnectionID      string    `json:"-"`
	AppKey            string    `json:"app_key"`
	SecretHash        string    `json:"-"`
	CredentialVersion int64     `json:"-"`
	Revoked           bool      `json:"revoked"`
	Enabled           bool      `json:"enabled"`
	Provisioned       bool      `json:"-"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

type MemoryProjectUser struct {
	ProjectID   uuid.UUID `json:"project_id"`
	UserID      string    `json:"user_id"`
	NativeID    uuid.UUID `json:"-"`
	ProviderKey string    `json:"-"` // AES-GCM ciphertext, never an external App Secret.
	Provisioned bool      `json:"provisioned"`
	CreatedAt   time.Time `json:"created_at"`
}

type MemoryProjectStore interface {
	Create(context.Context, *MemoryProject) error
	List(context.Context, uuid.UUID) ([]MemoryProject, error)
	Get(context.Context, uuid.UUID) (*MemoryProject, error)
	ByKey(context.Context, string) (*MemoryProject, error)
	Update(context.Context, uuid.UUID, uuid.UUID, string, bool) error
	Credential(context.Context, uuid.UUID, uuid.UUID, string, bool) error
	Users(context.Context, uuid.UUID, string) ([]MemoryProjectUser, error)
	User(context.Context, uuid.UUID, string) (*MemoryProjectUser, error)
	// Provision serializes initial provisioning across Memory service processes. The
	// callback must recover existing native identities after an uncertain commit.
	Provision(context.Context, uuid.UUID, string, func(*MemoryProject, *MemoryProjectUser) error) (*MemoryProjectUser, error)
	SaveMCPSession(context.Context, uuid.UUID, uuid.UUID, string, int64, string) error
	MCPSession(context.Context, uuid.UUID, uuid.UUID, string, int64) (string, error)
	DeleteMCPSession(context.Context, uuid.UUID, uuid.UUID) error
}
