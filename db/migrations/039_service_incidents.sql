-- Migration 039: process incidents (upgradeplan v9.0 Card S1).
-- Every service's unhandled error path writes here: one row per occurrence.
-- service_status gains the two incident columns the ops page (R6 later) trusts.
CREATE TABLE IF NOT EXISTS service_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service TEXT NOT NULL,
  kind TEXT NOT NULL,
  signature TEXT NOT NULL,
  message TEXT,
  stack TEXT,
  memory_rss INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_service_incidents_recent
  ON service_incidents(service, signature, created_at);

ALTER TABLE service_status ADD COLUMN incidents_1h INTEGER;
ALTER TABLE service_status ADD COLUMN last_incident_at TEXT;
