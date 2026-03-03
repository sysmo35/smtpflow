-- SMTPFlow v2 migration

-- Suppression list
CREATE TABLE IF NOT EXISTS suppression_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  reason VARCHAR(50) DEFAULT 'hard_bounce',
  bounce_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_suppression_email ON suppression_list(email);

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- DMARC column on domains
ALTER TABLE domains ADD COLUMN IF NOT EXISTS dmarc_verified BOOLEAN DEFAULT false;
