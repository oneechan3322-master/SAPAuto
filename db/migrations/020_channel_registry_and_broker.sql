-- Migration 020: Channel registry, contacts, and approval-gated communication drafts.
-- Complements existing channel_deliveries, user_channels, and audit_log tables.

CREATE TABLE IF NOT EXISTS channel_registry (
  id TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL CHECK(provider_type IN ('whatsapp_web', 'whatsapp_baileys', 'telegram_bot', 'gmail_oauth')),
  status TEXT NOT NULL DEFAULT 'unconfigured' CHECK(status IN ('unconfigured', 'connecting', 'qr_ready', 'connected', 'unhealthy', 'paused', 'disabled')),
  draft_only INTEGER NOT NULL DEFAULT 1 CHECK(draft_only IN (0, 1)),
  connection_payload_ref TEXT,
  last_heartbeat_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS channel_registry_status_idx ON channel_registry(status);
CREATE INDEX IF NOT EXISTS channel_registry_provider_idx ON channel_registry(provider_type);

CREATE TABLE IF NOT EXISTS channel_contacts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL CHECK(channel_type IN ('whatsapp', 'telegram', 'email')),
  recipient_address TEXT NOT NULL,
  contact_role TEXT NOT NULL DEFAULT 'accountant' CHECK(contact_role IN ('owner', 'tax_manager', 'accountant', 'test_recipient')),
  consent_status TEXT NOT NULL DEFAULT 'unverified' CHECK(consent_status IN ('explicit_opt_in', 'implied_business', 'opted_out', 'suppressed')),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK(verification_status IN ('unverified', 'test_verified', 'active')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS channel_contacts_company_idx ON channel_contacts(company_id);
CREATE INDEX IF NOT EXISTS channel_contacts_channel_idx ON channel_contacts(channel_type, recipient_address);

CREATE TABLE IF NOT EXISTS communication_drafts (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channel_registry(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES channel_contacts(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  case_id TEXT,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  message_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'approval_pending', 'approved', 'rejected', 'dispatched', 'failed')),
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS communication_drafts_channel_idx ON communication_drafts(channel_id);
CREATE INDEX IF NOT EXISTS communication_drafts_contact_idx ON communication_drafts(contact_id);
CREATE INDEX IF NOT EXISTS communication_drafts_status_idx ON communication_drafts(status);
CREATE INDEX IF NOT EXISTS communication_drafts_company_idx ON communication_drafts(company_id);

-- Seed default WhatsApp channel in unconfigured draft_only mode.
INSERT INTO channel_registry(id, provider_type, status, draft_only, connection_payload_ref, last_heartbeat_at, last_error, created_at, updated_at)
VALUES ('whatsapp-office-primary', 'whatsapp_web', 'unconfigured', 1, NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO NOTHING;
