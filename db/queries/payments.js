'use strict'

const { getDatabase } = require('../connect')

function listPayments({ accountKey, limit = 1000 } = {}, db = getDatabase()) {
  const where = accountKey ? 'WHERE account_key = ?' : ''
  const params = accountKey
    ? [accountKey, Math.min(Number(limit) || 1000, 4000)]
    : [Math.min(Number(limit) || 1000, 4000)]
  return db.prepare(`SELECT * FROM payments ${where} ORDER BY due_date LIMIT ?`).all(...params)
}

module.exports = { listPayments }
