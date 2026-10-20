'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto')
const { getDatabase } = require('../db/connect')
const { now } = require('../db/queries/shared')

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const KEY_ENV = 'V8_ACCOUNTS_KEY'

function v8Root() {
  return process.env.V8_ROOT || path.resolve(__dirname, '..')
}

function keyFilePath() {
  return path.join(v8Root(), 'data', 'accounts.key')
}

/* The key never enters the database it protects. V8_ACCOUNTS_KEY (64 hex chars)
   lets an operator manage it externally; otherwise data/accounts.key is created
   once with owner-only permissions and reused. */
function resolveAccountsKey({ allowGenerate = true } = {}) {
  const raw = process.env[KEY_ENV]
  if (raw) {
    if (!/^[0-9a-f]{64}$/i.test(raw)) {
      throw new Error(`${KEY_ENV} must be 64 hexadecimal characters (32 bytes)`)
    }
    return Buffer.from(raw, 'hex')
  }
  const filePath = keyFilePath()
  if (fs.existsSync(filePath)) {
    const saved = fs.readFileSync(filePath, 'utf8').trim()
    if (!/^[0-9a-f]{64}$/i.test(saved)) {
      throw new Error(`Account key file ${filePath} is corrupt; expected 64 hexadecimal characters`)
    }
    return Buffer.from(saved, 'hex')
  }
  if (!allowGenerate) throw new Error(`Account key file ${filePath} does not exist`)
  const generated = randomBytes(KEY_BYTES)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, generated.toString('hex'), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  return generated
}

function encryptSecret(plaintext, key) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('Account secret must be a non-empty string')
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    cipher: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  }
}

function decryptSecret(stored, key) {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(stored.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(stored.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(stored.cipher, 'base64')), decipher.final()]).toString('utf8')
}

function normalizeUsername(username) {
  if (typeof username !== 'string' || !username.trim()) {
    throw new Error('Account username is required')
  }
  return username.trim()
}

/* Registry rows carry no secret material: listAccounts feeds the settings UI and
   the harness loop, neither of which may ever see a password. */
function listAccounts(db = getDatabase()) {
  return db.prepare(`SELECT account_key AS id, label, username
    FROM accounts WHERE enabled = 1 ORDER BY account_key`).all()
}

function upsertAccount({ username, label, password }, db = getDatabase(), key = resolveAccountsKey()) {
  const normalized = normalizeUsername(username)
  const secret = encryptSecret(password, key)
  const timestamp = now()
  db.prepare(`INSERT INTO accounts(account_key,username,label,secret_cipher,secret_iv,secret_tag,enabled,created_at,updated_at)
    VALUES(?,?,?,?,?,?,1,?,?)
    ON CONFLICT(account_key) DO UPDATE SET username=excluded.username, label=excluded.label,
      secret_cipher=excluded.secret_cipher, secret_iv=excluded.secret_iv, secret_tag=excluded.secret_tag,
      enabled=1, updated_at=excluded.updated_at`)
    .run(normalized, normalized, String(label || normalized), secret.cipher, secret.iv, secret.tag, timestamp, timestamp)
  return normalized
}

function disableAccount(accountKey, db = getDatabase()) {
  return db.prepare('UPDATE accounts SET enabled = 0, updated_at = ? WHERE account_key = ?')
    .run(now(), normalizeUsername(accountKey)).changes
}

/* Only the scanner entry point decrypts, and only for the one account it is about
   to open a browser for. */
function getCredentials(accountKey, db = getDatabase(), key = resolveAccountsKey({ allowGenerate: false })) {
  const normalized = normalizeUsername(accountKey)
  const alt = normalized.includes('_') ? normalized.replace(/_/g, '-') : normalized.replace(/-/g, '_')
  const row = db.prepare(`SELECT account_key,username,label,secret_cipher,secret_iv,secret_tag
    FROM accounts
    WHERE (account_key = ? COLLATE NOCASE OR username = ? COLLATE NOCASE OR account_key = ? COLLATE NOCASE OR username = ? COLLATE NOCASE)
      AND enabled = 1`).get(normalized, normalized, alt, alt)
  if (!row) throw new Error(`Account ${accountKey} is not configured in V8`)
  return {
    username: row.username,
    label: row.label,
    password: decryptSecret({ cipher: row.secret_cipher, iv: row.secret_iv, tag: row.secret_tag }, key)
  }
}

module.exports = {
  KEY_ENV,
  decryptSecret,
  disableAccount,
  encryptSecret,
  getCredentials,
  listAccounts,
  resolveAccountsKey,
  upsertAccount
}
