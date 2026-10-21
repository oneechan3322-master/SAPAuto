-- Migration 027: transactional notification outbox (Opus5.5 §6.2, adapted to TEXT event ids).
CREATE TABLE IF NOT EXISTS notification_outbox (
  id INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','email','telegram')),
  recipient TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','sent','failed','dead','uncertain')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  lease_owner TEXT,
  lease_until TEXT,
  last_error TEXT,
  provider_msg_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS ix_outbox_due
  ON notification_outbox(channel, next_attempt_at)
  WHERE status IN ('pending','failed');

CREATE INDEX IF NOT EXISTS ix_outbox_event
  ON notification_outbox(event_id);

CREATE INDEX IF NOT EXISTS ix_outbox_status
  ON notification_outbox(status);
