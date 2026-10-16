CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Viewer' CHECK(role IN ('Owner', 'Operator', 'Viewer')),
  disabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  expiresAt TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX sessions_expiry_idx ON sessions(expiresAt);
CREATE INDEX sessions_user_idx ON sessions(userId);
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt TEXT,
  refreshTokenExpiresAt TEXT,
  scope TEXT,
  password TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX accounts_user_idx ON accounts(userId);
CREATE TABLE verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT,
  updatedAt TEXT
);
CREATE INDEX verification_identifier_idx ON verification(identifier);

CREATE TABLE user_channels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  external_id TEXT NOT NULL,
  verified_at TEXT,
  UNIQUE(channel, external_id)
);
CREATE TABLE link_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO settings(key, value, updated_at) VALUES
  ('cycle_interval_min', '120', CURRENT_TIMESTAMP),
  ('quiet_hours', '01:00-06:00', CURRENT_TIMESTAMP),
  ('automation_enabled', 'false', CURRENT_TIMESTAMP),
  ('ai_monthly_cap_usd', '1', CURRENT_TIMESTAMP);
