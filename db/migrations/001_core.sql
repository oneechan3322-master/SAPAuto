CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account_key TEXT NOT NULL UNIQUE,
  external_ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unknown',
  last_scanned_at TEXT,
  source_updated_at TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX companies_name_idx ON companies(name);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_key TEXT NOT NULL,
  doc_number TEXT NOT NULL,
  title TEXT NOT NULL,
  deadline TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  urgency TEXT NOT NULL DEFAULT 'normal',
  required_action TEXT NOT NULL DEFAULT '',
  assigned_to TEXT NOT NULL DEFAULT '',
  pdf_path TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'portal',
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_key, doc_number)
);
CREATE INDEX tasks_deadline_idx ON tasks(deadline);
CREATE INDEX tasks_company_idx ON tasks(company_id);
CREATE INDEX tasks_status_idx ON tasks(status);

CREATE TABLE obligations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_key TEXT NOT NULL,
  obligation_code TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  deadline TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unknown',
  penalty_band TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_key, obligation_code, period)
);
CREATE INDEX obligations_deadline_idx ON obligations(deadline);
CREATE INDEX obligations_status_idx ON obligations(status);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_key TEXT NOT NULL,
  claim_number TEXT NOT NULL,
  amount REAL,
  currency TEXT NOT NULL DEFAULT 'EGP',
  due_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unknown',
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_key, claim_number)
);
CREATE INDEX payments_due_idx ON payments(due_date);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_key TEXT NOT NULL,
  portal_message_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'info',
  received_at TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(account_key, portal_message_id)
);
CREATE INDEX messages_received_idx ON messages(received_at);

CREATE TABLE automation_cycles (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  state TEXT NOT NULL,
  accounts_total INTEGER NOT NULL DEFAULT 0,
  accounts_processed INTEGER NOT NULL DEFAULT 0,
  accounts_failed INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor_id TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_at_idx ON audit_log(at);
