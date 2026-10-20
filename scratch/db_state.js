'use strict'
const { getDatabase } = require('../db/connect')
const db = getDatabase()

console.log('=== USERS ===')
console.log(db.prepare('SELECT id, role, disabled FROM users').all())

console.log('\n=== HARNESS STATUS ===')
console.log(db.prepare('SELECT * FROM harness_status').get())

console.log('\n=== ACCOUNTS ===')
console.log(db.prepare('SELECT account_key, label, enabled FROM accounts ORDER BY account_key').all())

console.log('\n=== CONFIRMATIONS ===')
console.log(db.prepare("SELECT * FROM confirmations WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 5").all())
