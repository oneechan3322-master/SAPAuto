-- Migration 033: decouple notification_outbox (Opus5.5 §6.2 transport senders).
-- The senders are also filled by direct operational flows that never produce a
-- row in events (channel test, wake_send_document, daily digest relay). The
-- FK on event_id would make every such enqueue a foreign-key failure under
-- foreign_keys=ON, so the column stays a plain reference value: dispatcher
-- rows keep their event ids, command rows get their own stable ids, while
-- idempotency remains UNIQUE on idempotency_key.
ALTER TABLE notification_outbox RENAME TO notification_outbox_old;

CREATE TABLE notification_outbox (
  id INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL,
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
  sent_at TEXT,
  shadow INTEGER NOT NULL DEFAULT 0
);

INSERT INTO notification_outbox (
  id, event_id, channel, recipient, payload_json, idempotency_key, status,
  attempts, next_attempt_at, lease_owner, lease_until, last_error,
  provider_msg_id, created_at, sent_at, shadow
)
SELECT id, event_id, channel, recipient, payload_json, idempotency_key, status,
       attempts, next_attempt_at, lease_owner, lease_until, last_error,
       provider_msg_id, created_at, sent_at, shadow
FROM notification_outbox_old;

DROP TABLE notification_outbox_old;

CREATE INDEX IF NOT EXISTS ix_outbox_due
  ON notification_outbox(channel, next_attempt_at)
  WHERE status IN ('pending','failed');

CREATE INDEX IF NOT EXISTS ix_outbox_event
  ON notification_outbox(event_id);

CREATE INDEX IF NOT EXISTS ix_outbox_status
  ON notification_outbox(status);

CREATE INDEX IF NOT EXISTS ix_outbox_shadow
  ON notification_outbox(shadow, channel, status);
