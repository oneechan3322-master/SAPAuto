'use strict'

const { getDatabase } = require('../connect')
const { id, now } = require('./shared')

const COMMANDS = new Set([
  'scan_now', 'pause', 'resume', 'set_interval', 'send_report_now',
  'retry_account', 'unpark_account', 'backup_now'
])

function createCommand(type, payload = {}, requestedBy = 'system', db = getDatabase()) {
  if (!COMMANDS.has(type)) throw new Error(`Unsupported command: ${type}`)
  const commandId = id('command')
  db.prepare(`INSERT INTO commands(id, type, payload, requested_by, status, created_at)
    VALUES (?, ?, ?, ?, 'queued', ?)`).run(commandId, type, JSON.stringify(payload), requestedBy, now())
  return commandId
}

module.exports = { COMMANDS, createCommand }
