-- Migration 031: cross-service heartbeat/status tables and single-instance leases
-- (Opus5.5 §6.12 /health and §6.7 PM2 #6142 protection).
CREATE TABLE IF NOT EXISTS service_status (
  service TEXT PRIMARY KEY,
  pid INTEGER,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('online','offline','degraded','unknown')),
  last_heartbeat TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  meta_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS service_locks (
  service TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
