-- Migration 030: scan telemetry, feeds metrics and the risk scheduler (Opus5.5 §5.5).
CREATE TABLE IF NOT EXISTS scan_runs (
  id INTEGER PRIMARY KEY,
  account_key TEXT NOT NULL,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  section TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER NOT NULL DEFAULT 1,
  http_errors INTEGER NOT NULL DEFAULT 0,
  items INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS ix_scan_runs_account_time ON scan_runs(account_key, started_at);
CREATE INDEX IF NOT EXISTS ix_scan_runs_section_time ON scan_runs(section, started_at);
