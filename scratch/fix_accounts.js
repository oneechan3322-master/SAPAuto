'use strict'
const { getDatabase } = require('../db/connect')
const db = getDatabase()

db.prepare("UPDATE accounts SET username = 'select_green' WHERE account_key = 'select-green'").run()
db.prepare("UPDATE accounts SET username = 'Bright_123' WHERE account_key = 'Bright-123'").run()
db.prepare("UPDATE accounts SET username = 'Thenile14' WHERE account_key = 'Thenile14'").run()

// Also add automatic fallback in login.js if any account has hyphen vs underscore
console.log('Accounts table updated with exact Keycloak usernames:')
const rows = db.prepare("SELECT account_key, username FROM accounts WHERE account_key IN ('select-green', 'Bright-123', 'Thenile14')").all()
console.log(rows)
