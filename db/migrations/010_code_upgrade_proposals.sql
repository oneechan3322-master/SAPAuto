CREATE TABLE code_upgrade_proposals (
  id TEXT PRIMARY KEY,
  requested_by TEXT NOT NULL REFERENCES users(id),
  request TEXT NOT NULL,
  proposal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT
);

CREATE INDEX code_upgrade_proposals_status_created_idx
  ON code_upgrade_proposals(status, created_at);
