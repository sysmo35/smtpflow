-- SMTPFlow Database Schema
-- PostgreSQL 14+

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Packages table (created first, referenced by users)
CREATE TABLE IF NOT EXISTS packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  monthly_limit INTEGER NOT NULL DEFAULT 1000,
  daily_limit INTEGER,
  hourly_limit INTEGER,
  price DECIMAL(10,2) DEFAULT 0.00,
  is_active BOOLEAN DEFAULT true,
  features JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  smtp_username VARCHAR(255) UNIQUE NOT NULL,
  smtp_password VARCHAR(100) NOT NULL,
  role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  package_id UUID REFERENCES packages(id) ON DELETE SET NULL,
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending')),
  timezone VARCHAR(100) DEFAULT 'UTC',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Domains table
CREATE TABLE IF NOT EXISTS domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  domain VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed')),
  dkim_selector VARCHAR(100) DEFAULT 'smtpflow',
  dkim_public_key TEXT,
  dkim_private_key TEXT,
  spf_verified BOOLEAN DEFAULT false,
  dkim_verified BOOLEAN DEFAULT false,
  mx_verified BOOLEAN DEFAULT false,
  verification_token VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, domain)
);

-- Emails table
CREATE TABLE IF NOT EXISTS emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  domain_id UUID REFERENCES domains(id) ON DELETE SET NULL,
  from_address VARCHAR(255) NOT NULL,
  from_name VARCHAR(255),
  to_addresses TEXT NOT NULL,
  subject VARCHAR(998),
  status VARCHAR(50) DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'bounced', 'rejected', 'spam', 'failed')),
  tracking_id VARCHAR(100) UNIQUE NOT NULL,
  message_id VARCHAR(255),
  size_bytes INTEGER DEFAULT 0,
  -- Tracking flags
  opened BOOLEAN DEFAULT false,
  opened_at TIMESTAMPTZ,
  opened_count INTEGER DEFAULT 0,
  clicked BOOLEAN DEFAULT false,
  clicked_at TIMESTAMPTZ,
  click_count INTEGER DEFAULT 0,
  bounced BOOLEAN DEFAULT false,
  bounced_at TIMESTAMPTZ,
  bounce_type VARCHAR(50),
  bounce_message TEXT,
  spam_reported BOOLEAN DEFAULT false,
  spam_at TIMESTAMPTZ,
  -- Metadata
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email events (detailed log)
CREATE TABLE IF NOT EXISTS email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID REFERENCES emails(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('sent', 'delivered', 'opened', 'clicked', 'bounced', 'spam', 'rejected', 'unsubscribed')),
  ip_address INET,
  user_agent TEXT,
  url TEXT,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Monthly usage tracking
CREATE TABLE IF NOT EXISTS monthly_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  year_month CHAR(7) NOT NULL,
  email_count INTEGER DEFAULT 0,
  UNIQUE(user_id, year_month)
);

-- API Keys (future use)
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  key_hash VARCHAR(255) NOT NULL,
  key_prefix VARCHAR(20) NOT NULL,
  last_used_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_emails_user_id ON emails(user_id);
CREATE INDEX IF NOT EXISTS idx_emails_tracking_id ON emails(tracking_id);
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
CREATE INDEX IF NOT EXISTS idx_emails_created_at ON emails(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_events_email_id ON email_events(email_id);
CREATE INDEX IF NOT EXISTS idx_email_events_type ON email_events(event_type);
CREATE INDEX IF NOT EXISTS idx_monthly_usage_user_month ON monthly_usage(user_id, year_month);
CREATE INDEX IF NOT EXISTS idx_domains_user_id ON domains(user_id);
CREATE INDEX IF NOT EXISTS idx_users_smtp_username ON users(smtp_username);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_packages_updated_at ON packages;
CREATE TRIGGER update_packages_updated_at BEFORE UPDATE ON packages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_domains_updated_at ON domains;
CREATE TRIGGER update_domains_updated_at BEFORE UPDATE ON domains
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Branding settings
CREATE TABLE IF NOT EXISTS branding_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) UNIQUE NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default packages
INSERT INTO packages (name, description, monthly_limit, daily_limit, hourly_limit, price, features) VALUES
  ('Free', 'Piano gratuito per iniziare', 1000, 100, 20, 0.00, '["1,000 email/mese", "Statistiche base", "1 dominio", "Tracking aperture"]'),
  ('Starter', 'Per piccole aziende', 10000, 500, 100, 9.99, '["10,000 email/mese", "Statistiche avanzate", "3 domini", "Tracking completo", "Bounce management"]'),
  ('Professional', 'Per aziende in crescita', 100000, 5000, 500, 49.99, '["100,000 email/mese", "Analytics avanzate", "10 domini", "Tracking completo", "API access", "Supporto prioritario"]'),
  ('Enterprise', 'Per grandi volumi', 1000000, 50000, 2000, 199.99, '["1,000,000 email/mese", "Statistiche in real-time", "Domini illimitati", "Tracking completo", "API access", "IP dedicato", "SLA 99.9%"]')
ON CONFLICT DO NOTHING;
