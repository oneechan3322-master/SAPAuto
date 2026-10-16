'use strict'

const { getDatabase } = require('../connect')
const { now } = require('./shared')

function getStatus(db = getDatabase()) {
  return db.prepare('SELECT * FROM harness_status WHERE id = 1').get()
}

function updateStatus(fields, db = getDatabase()) {
  const allowed = ['state', 'current_account', 'account_index', 'account_total', 'next_cycle_at', 'paused']
  const keys = Object.keys(fields).filter((key) => allowed.includes(key))
  if (!keys.length) throw new Error('No valid harness status fields provided')
  const assignments = keys.map((key) => `${key} = @${key}`).join(', ')
  db.prepare(`UPDATE harness_status SET ${assignments}, updated_at = @updated_at WHERE id = 1`)
    .run({ ...fields, updated_at: now() })
}

function heartbeat(db = getDatabase()) {
  db.prepare(`UPDATE harness_status SET last_heartbeat = ?, updated_at = ? WHERE id = 1`).run(now(), now())
}

module.exports = { getStatus, updateStatus, heartbeat }
