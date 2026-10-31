CREATE TABLE workspaces (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
 is_default boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,account_id)
);
CREATE UNIQUE INDEX workspaces_default_account_idx ON workspaces(account_id) WHERE is_default;
INSERT INTO workspaces(id,account_id,name,is_default)
 SELECT md5('memory-workspace:' || id::text)::uuid,id,'默认项目空间',true FROM accounts;
ALTER TABLE projects ADD COLUMN workspace_id uuid;
UPDATE projects p SET workspace_id=w.id FROM workspaces w WHERE w.account_id=p.account_id AND w.is_default;
ALTER TABLE projects ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE projects ADD CONSTRAINT projects_workspace_owner_fk FOREIGN KEY(workspace_id,account_id) REFERENCES workspaces(id,account_id);
CREATE INDEX projects_workspace_idx ON projects(workspace_id);
