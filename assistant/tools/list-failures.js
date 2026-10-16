'use strict'

const { getDatabase } = require('../../db/connect')

module.exports = async function listFailures({ since = 30 } = {}) {
  const days = Number(since)
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('since must be 1–365 days')
  return getDatabase().prepare(`SELECT account_key,occurred_at,reason,hint,resolved_at FROM failures
    WHERE occurred_at>=datetime('now', ?) ORDER BY occurred_at DESC LIMIT 100`).all(`-${days} days`)
}
