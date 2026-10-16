ALTER TABLE channel_deliveries ADD COLUMN status TEXT NOT NULL DEFAULT 'sent'
  CHECK (status IN ('sent','dry_run'));

ALTER TABLE reminders ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (delivery_status IN ('pending','sent','dry_run'));
UPDATE reminders SET delivery_status='sent' WHERE sent_at IS NOT NULL;

ALTER TABLE reports ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (delivery_status IN ('pending','sent','dry_run'));
UPDATE reports SET delivery_status='sent' WHERE sent_at IS NOT NULL;
