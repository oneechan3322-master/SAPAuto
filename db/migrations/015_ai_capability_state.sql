-- Plan 2.0 §10.1 — capability readiness, pause state, and append-only policy
-- events. No credentials, keys, paths, or raw payloads are stored here.

CREATE TABLE ai_provider_state (
  capability TEXT PRIMARY KEY
    CHECK(capability IN ('local_assistant','cloud_reviewer','system_adviser')),
  paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
  health TEXT NOT NULL DEFAULT 'unknown'
    CHECK(health IN ('unknown','healthy','unreachable')),
  model_label TEXT NOT NULL DEFAULT '',
  last_success_at TEXT,
  last_error_code TEXT NOT NULL DEFAULT '',
  policy_version TEXT NOT NULL DEFAULT 'r1.0',
  updated_at TEXT NOT NULL
);

INSERT INTO ai_provider_state(capability,model_label,policy_version,updated_at) VALUES
  ('local_assistant','Gemma 4','r1.0',CURRENT_TIMESTAMP),
  ('cloud_reviewer','Mistral','r1.0',CURRENT_TIMESTAMP),
  ('system_adviser','OpenCode','r1.0',CURRENT_TIMESTAMP);

CREATE TABLE ai_policy_event (
  id TEXT PRIMARY KEY,
  capability TEXT NOT NULL
    CHECK(capability IN ('local_assistant','cloud_reviewer','system_adviser')),
  action TEXT NOT NULL CHECK(action IN ('pause','resume','probe','policy_updated')),
  actor_id TEXT NOT NULL DEFAULT 'local-operator',
  detail TEXT NOT NULL DEFAULT '{}',
  at TEXT NOT NULL
);
CREATE INDEX ai_policy_event_capability_idx ON ai_policy_event(capability, at DESC);