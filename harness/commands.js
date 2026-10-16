'use strict'

const { getDatabase } = require('../db/connect')
const { updateStatus } = require('../db/queries/harness')
const { createCommand } = require('../db/queries/commands')
const { id, now } = require('../db/queries/shared')
const { createBackup } = require('./backup')

const CONTROL_SQL = `SELECT * FROM commands WHERE status = 'queued' AND type <> 'scan_now'
  ORDER BY created_at LIMIT 1`

async function handleCommand(row, { db, backup }) {
  const payload = JSON.parse(row.payload || '{}')
  const timestamp = now()
  switch (row.type) {
    case 'pause':
      updateStatus({ paused: 1, state: 'paused' }, db)
      break
    case 'resume':
      updateStatus({ paused: 0, state: 'waiting' }, db)
      break
    case 'set_interval': {
      const minutes = Number(payload.minutes)
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
        throw new Error('Interval must be an integer from 5 to 1440 minutes')
      }
      db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('cycle_interval_min',?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
        .run(String(minutes), timestamp)
      break
    }
    case 'send_report_now':
      db.prepare(`INSERT INTO events(id,kind,payload,created_at) VALUES(?,?,?,?)`)
        .run(id('event'), 'report_requested', JSON.stringify(payload), timestamp)
      break
    case 'retry_account':
      if (!payload.account) throw new Error('Account is required')
      db.prepare(`UPDATE account_status SET state='ready',consecutive_failures=0,parked_until=NULL,
        updated_at=? WHERE account_key=?`).run(timestamp, payload.account)
      createCommand('scan_now', { account: payload.account }, row.requested_by, db)
      break
    case 'unpark_account':
      if (!payload.account) throw new Error('Account is required')
      db.prepare(`UPDATE account_status SET state='ready',consecutive_failures=0,parked_until=NULL,
        updated_at=? WHERE account_key=?`).run(timestamp, payload.account)
      break
    case 'backup_now':
      await backup({ db })
      break
    default:
      throw new Error('unknown command')
  }
}

async function processOneControlCommand({ db = getDatabase(), backup = createBackup } = {}) {
  const row = db.prepare(CONTROL_SQL).get()
  if (!row) return false
  const claim = db.prepare(`UPDATE commands SET status='running',started_at=?
    WHERE id=? AND status='queued'`).run(now(), row.id)
  if (!claim.changes) return false
  try {
    await handleCommand(row, { db, backup })
    db.prepare(`UPDATE commands SET status='done',result=?,finished_at=? WHERE id=?`)
      .run('completed', now(), row.id)
  } catch (error) {
    db.prepare(`UPDATE commands SET status='failed',result=?,finished_at=? WHERE id=?`)
      .run(String(error.message || error).slice(0, 1000), now(), row.id)
    console.error(`Command ${row.id} (${row.type}) failed: ${error.message}`)
  }
  return true
}

function startCommandWorker(options = {}, intervalMs = 5000) {
  let busy = false
  const timer = setInterval(async () => {
    if (busy) return
    busy = true
    try {
      await processOneControlCommand(options)
    } catch (error) {
      console.error(`Command worker failed: ${error.message}`)
    } finally {
      busy = false
    }
  }, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}

module.exports = { processOneControlCommand, startCommandWorker }
