-- SMTPFlow v3 migration: Multi-workspace support
-- Run ONCE on a live database.
-- Safe: all additive operations, no data loss.
-- Deploy sequence: run this BEFORE deploying new backend code.

BEGIN;

-- ── 1. Create workspaces table ────────────────────────────────

CREATE TABLE IF NOT EXISTS workspaces (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL DEFAULT 'Default',
  smtp_username    VARCHAR(255) UNIQUE NOT NULL,
  smtp_password    VARCHAR(100) NOT NULL,
  package_id       UUID REFERENCES packages(id) ON DELETE SET NULL,
  status           VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active','suspended','pending')),
  whmcs_service_id VARCHAR(100) UNIQUE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_workspaces_updated_at
  BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 2. Migrate existing users → workspaces ────────────────────
-- Each 'user' role account gets a 'Default' workspace with their current SMTP credentials.

INSERT INTO workspaces (user_id, name, smtp_username, smtp_password, package_id, status, created_at, updated_at)
SELECT id, 'Default', smtp_username, smtp_password, package_id, status, created_at, updated_at
FROM users
WHERE role = 'user'
ON CONFLICT (smtp_username) DO NOTHING;

-- ── 3. Add workspace_id columns (nullable initially) ──────────

ALTER TABLE domains       ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE emails        ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE monthly_usage ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

-- ── 4. Populate workspace_id from user_id ─────────────────────

UPDATE domains d
  SET workspace_id = w.id
  FROM workspaces w
  WHERE w.user_id = d.user_id AND d.workspace_id IS NULL;

UPDATE emails e
  SET workspace_id = w.id
  FROM workspaces w
  WHERE w.user_id = e.user_id AND e.workspace_id IS NULL;

UPDATE monthly_usage mu
  SET workspace_id = w.id
  FROM workspaces w
  WHERE w.user_id = mu.user_id AND mu.workspace_id IS NULL;

-- ── 5. Update UNIQUE constraints ──────────────────────────────

ALTER TABLE domains       DROP CONSTRAINT IF EXISTS domains_user_id_domain_key;
ALTER TABLE domains       ADD CONSTRAINT domains_workspace_id_domain_key UNIQUE (workspace_id, domain);

ALTER TABLE monthly_usage DROP CONSTRAINT IF EXISTS monthly_usage_user_id_year_month_key;
ALTER TABLE monthly_usage ADD CONSTRAINT monthly_usage_workspace_id_year_month_key UNIQUE (workspace_id, year_month);

-- ── 6. Indexes ────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_workspaces_user_id    ON workspaces(user_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_service_id ON workspaces(whmcs_service_id);
CREATE INDEX IF NOT EXISTS idx_emails_workspace_id   ON emails(workspace_id);
CREATE INDEX IF NOT EXISTS idx_domains_workspace_id  ON domains(workspace_id);

COMMIT;

-- ── POST-VERIFICATION STEPS ────────────────────────────────────
-- Run these MANUALLY after verifying data integrity:
--
-- ALTER TABLE domains        ALTER COLUMN workspace_id SET NOT NULL;
-- ALTER TABLE emails         ALTER COLUMN workspace_id SET NOT NULL;
-- ALTER TABLE monthly_usage  ALTER COLUMN workspace_id SET NOT NULL;
-- ALTER TABLE users DROP COLUMN IF EXISTS smtp_username;
-- ALTER TABLE users DROP COLUMN IF EXISTS smtp_password;
-- ALTER TABLE users DROP COLUMN IF EXISTS package_id;
