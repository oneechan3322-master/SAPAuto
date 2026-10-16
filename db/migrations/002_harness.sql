CREATE TABLE harness_status (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  state TEXT NOT NULL DEFAULT 'starting',
  current_account TEXT NOT NULL DEFAULT '',
  account_index INTEGER NOT NULL DEFAULT 0,
  account_total INTEGER NOT NULL DEFAULT 0,
  last_heartbeat TEXT,
  next_cycle_at TEXT,
  paused INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
INSERT INTO harness_status(id, updated_at) VALUES (1, CURRENT_TIMESTAMP);

CREATE TABLE commands (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  requested_by TEXT NOT NULL DEFAULT 'system',
  status TEXT NOT NULL DEFAULT 'queued',
  result TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX commands_queue_idx ON commands(status, created_at);

CREATE TABLE account_status (
  account_key TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'ready',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  parked_until TEXT,
  last_success_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE TABLE failures (
  id TEXT PRIMARY KEY,
  account_key TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  hint TEXT NOT NULL DEFAULT '',
  resolved_at TEXT,
  resolved_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX failures_open_idx ON failures(resolved_at, occurred_at);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  account_key TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  announced INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX events_unannounced_idx ON events(announced, created_at);
