-- Plan 4.1 §4 (phase: native account store). V8 keeps its own portal account
-- registry so account discovery no longer spawns SAPAuto3. Passwords are never
-- stored plaintext: the secret columns hold an AES-256-GCM ciphertext whose key
-- lives outside the database (data/accounts.key or V8_ACCOUNTS_KEY).
CREATE TABLE accounts (
  account_key TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  label TEXT NOT NULL,
  secret_cipher TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  secret_tag TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX accounts_enabled_idx ON accounts(enabled);
