-- Migration 032: outbox shadow-mode flag (Opus5.5 §6.2 migration path).
-- Shadow rows record what the outbox would have delivered while the legacy
-- direct-send path stays authoritative. Claim only ever drains shadow = 0, so
-- a later cut-over can never replay old shadow records as real messages.
ALTER TABLE notification_outbox ADD COLUMN shadow INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS ix_outbox_shadow ON notification_outbox(shadow, channel, status);
