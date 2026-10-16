CREATE TABLE assistant_manager_status (
  id INTEGER PRIMARY KEY CHECK(id=1),
  state TEXT NOT NULL DEFAULT 'starting',
  last_run_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
INSERT INTO assistant_manager_status(id,updated_at) VALUES(1,CURRENT_TIMESTAMP);

CREATE TABLE assistant_attention (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  account_key TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','cleared')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX assistant_attention_state_idx ON assistant_attention(state,category,updated_at);

CREATE TABLE assistant_confirmations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  tool_name TEXT NOT NULL,
  args_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending','running','confirmed','declined','failed','expired')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  result TEXT NOT NULL DEFAULT ''
);
CREATE INDEX assistant_confirmations_user_idx
  ON assistant_confirmations(user_id,state,created_at);
