CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX notes_target_idx ON notes(target_type, target_id, created_at);

CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL REFERENCES users(id),
  due_at TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'launcher',
  dedupe_key TEXT NOT NULL UNIQUE,
  sent_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX reminders_due_idx ON reminders(sent_at, cancelled_at, due_at);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL,
  recipients TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  sent_at TEXT,
  created_at TEXT NOT NULL
);
