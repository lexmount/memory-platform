CREATE TABLE accounts (
    id uuid PRIMARY KEY,
    issuer text NOT NULL,
    subject text NOT NULL,
    name text NOT NULL DEFAULT '',
    email text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (issuer, subject)
);
CREATE TABLE browser_sessions (
    key_hash text PRIMARY KEY,
    state jsonb NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE INDEX browser_sessions_expiry_idx ON browser_sessions(expires_at);
CREATE TABLE account_api_keys (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    key_hash text NOT NULL UNIQUE,
    prefix text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
);
CREATE INDEX account_api_keys_account_idx ON account_api_keys(account_id);
CREATE TABLE projects (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    provider text NOT NULL CHECK (provider IN ('hindsight', 'openviking')),
    connection_id text NOT NULL,
    app_key text NOT NULL UNIQUE,
    secret_hash text NOT NULL,
    credential_version bigint NOT NULL DEFAULT 1,
    revoked boolean NOT NULL DEFAULT false,
    enabled boolean NOT NULL DEFAULT true,
    provisioned boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_account_idx ON projects(account_id);
CREATE TABLE project_users (
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    native_id uuid NOT NULL,
    provider_key text NOT NULL DEFAULT '',
    provisioned boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id),
    UNIQUE (project_id, native_id)
);
CREATE TABLE mcp_sessions (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    credential_version bigint NOT NULL,
    native_session text NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE INDEX mcp_sessions_expiry_idx ON mcp_sessions(expires_at);
