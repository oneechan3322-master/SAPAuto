'use strict'
const { getDatabase } = require('../db/connect')
const db = getDatabase()

// Delete duplicate entries that don't match any account_key in accounts table
const deleted = db.prepare('DELETE FROM account_status WHERE account_key NOT IN (SELECT account_key FROM accounts)').run()
console.log('Deleted orphaned status rows:', deleted.changes)

// Reset parked/failed state so all accounts are clean and ready to scan
const updated = db.prepare("UPDATE account_status SET consecutive_failures = 0, parked_until = null, state = 'ready'").run()
console.log('Reset account status rows:', updated.changes)

const rows = db.prepare('SELECT account_key, state, consecutive_failures, parked_until FROM account_status').all()
console.log('Total accounts in status table:', rows.length)
console.log(rows)
