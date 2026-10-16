'use strict'

const { getDatabase } = require('../connect')

function listMessages({ accountKey, limit = 1000 } = {}, db = getDatabase()) {
  const where = accountKey ? 'WHERE account_key = ?' : ''
  const params = accountKey
    ? [accountKey, Math.min(Number(limit) || 1000, 4000)]
    : [Math.min(Number(limit) || 1000, 4000)]
  return db.prepare(`SELECT * FROM messages ${where} ORDER BY received_at DESC LIMIT ?`).all(...params)
}

module.exports = { listMessages }
