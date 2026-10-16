'use strict'

const { getDatabase } = require('../db/connect')
const { listAccounts } = require('./source')
const { runAccount } = require('./run-account')
const { ingestAccount } = require('./ingest')
const { setHarnessState } = require('./heartbeat')
const { minutesUntilQuietEnd, nextCycleTime } = require('./quiet-hours')
const { now, id } = require('../db/queries/shared')

function setting(db, key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key)
  return row ? row.value : fallback
}

function eligible(account, db) {
  const state = db.prepare('SELECT parked_until FROM account_status WHERE account_key=?').get(account.username)
  return !state || !state.parked_until || Date.parse(state.parked_until) <= Date.now()
}

async function scanOne(account, index, total, db, scanner) {
  setHarnessState('logging_in', { current_account: account.username, account_index: index, account_total: total }, db)
  db.prepare(`INSERT INTO account_status(account_key,state,updated_at) VALUES(?,'scanning',?)
    ON CONFLICT(account_key) DO UPDATE SET state='scanning',updated_at=excluded.updated_at`).run(account.username, now())
  try {
    setHarnessState('scanning', { current_account: account.username }, db)
    const result = await scanner(account.username)
    if (!result.login || result.login.success !== true) {
      throw new Error(result.login && result.login.rejected ? 'Portal rejected account authentication' : 'Account scan did not confirm login')
    }
    ingestAccount(result, db)
    return true
  } catch (error) {
    const timestamp = now()
    const previous = db.prepare('SELECT consecutive_failures FROM account_status WHERE account_key=?').get(account.username)
    const failures = Number(previous && previous.consecutive_failures || 0) + 1
    const parkedUntil = failures >= 3 ? new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString() : null
    db.prepare(`INSERT INTO account_status(account_key,state,consecutive_failures,parked_until,last_error,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(account_key) DO UPDATE SET state=excluded.state,
      consecutive_failures=excluded.consecutive_failures,parked_until=excluded.parked_until,
      last_error=excluded.last_error,updated_at=excluded.updated_at`)
      .run(account.username, parkedUntil ? 'parked' : 'failed', failures, parkedUntil, String(error.message).slice(0, 500), timestamp)
    db.prepare(`INSERT INTO failures(id,account_key,occurred_at,reason,hint)
      VALUES(?,?,?,?,?)`).run(id('failure'), account.username, timestamp, String(error.message).slice(0, 500),
      'راجع بيانات الدخول والاتصال، ثم أعد المحاولة بعد التحقق.')
    if (parkedUntil) db.prepare(`INSERT INTO events(id,kind,account_key,payload,created_at)
      VALUES(?,?,?,?,?)`).run(id('event'), 'account_parked', account.username, JSON.stringify({ parkedUntil }), timestamp)
    console.error(`Account scan failed (${account.username}): ${error.message}`)
    return false
  }
}

async function runCycle({ db = getDatabase(), scanner = runAccount, accountKey = '' } = {}) {
  const accounts = await listAccounts()
  const selected = accountKey
    ? accounts.filter((account) => account.username.toLowerCase() === accountKey.toLowerCase())
    : accounts
  if (accountKey && selected.length === 0) throw new Error('Requested account is not in the configured source')
  const queue = selected.filter((account) => eligible(account, db))
  setHarnessState('scanning', {
    current_account: '', account_index: 0, account_total: queue.length, next_cycle_at: null
  }, db)
  const cycleId = id('cycle')
  const startedAt = now()
  db.prepare(`INSERT INTO automation_cycles(id,started_at,state,accounts_total)
    VALUES(?,?,'running',?)`).run(cycleId, startedAt, queue.length)
  let processed = 0
  let failed = 0
  for (let i = 0; i < queue.length; i += 1) {
    if (db.prepare('SELECT paused FROM harness_status WHERE id=1').get().paused) break
    if (await scanOne(queue[i], i + 1, queue.length, db, scanner)) processed += 1
    else failed += 1
  }
  const finishedAt = now()
  db.prepare(`UPDATE automation_cycles SET finished_at=?,state='done',accounts_processed=?,
    accounts_failed=?,summary=? WHERE id=?`).run(
    finishedAt, processed, failed, JSON.stringify({ accountKey: accountKey || null }), cycleId
  )
  setHarnessState('waiting', { current_account: '', account_index: 0, account_total: queue.length }, db)
  return { cycleId, processed, failed, total: queue.length }
}

function queuedScan(db) {
  const row = db.prepare("SELECT * FROM commands WHERE type='scan_now' AND status='queued' ORDER BY created_at LIMIT 1").get()
  if (!row) return null
  const claimed = db.prepare("UPDATE commands SET status='running',started_at=? WHERE id=? AND status='queued'")
    .run(now(), row.id)
  return claimed.changes ? row : null
}

async function runLoop({ db = getDatabase(), scanner = runAccount, sleepMs = 5000, signal } = {}) {
  const stopping = () => Boolean(signal && signal.aborted)
  while (!stopping()) {
    try {
      const status = db.prepare('SELECT paused FROM harness_status WHERE id=1').get()
      if (status.paused) {
        setHarnessState('paused', {}, db)
        await new Promise((resolve) => setTimeout(resolve, sleepMs))
        continue
      }
      const command = queuedScan(db)
      if (command) {
        try {
          const payload = JSON.parse(command.payload || '{}')
          const outcome = await runCycle({ db, scanner, accountKey: payload.account || '' })
          db.prepare("UPDATE commands SET status='done',result=?,finished_at=? WHERE id=?")
            .run(JSON.stringify(outcome), now(), command.id)
        } catch (error) {
          db.prepare("UPDATE commands SET status='failed',result=?,finished_at=? WHERE id=?")
            .run(String(error.message).slice(0, 1000), now(), command.id)
        }
        continue
      }
      const enabled = setting(
        db,
        'automation_enabled',
        'false'
      ) === 'true'
      if (!enabled) {
        setHarnessState('idle', { current_account: '' }, db)
        await new Promise((resolve) => setTimeout(resolve, sleepMs))
        continue
      }
      const quietHours = setting(db, 'quiet_hours', '01:00-06:00')
      const quietRemaining = minutesUntilQuietEnd(quietHours)
      if (quietRemaining) {
        const next = new Date(Date.now() + quietRemaining * 60000)
        setHarnessState('waiting', { next_cycle_at: next.toISOString() }, db)
        for (let elapsed = 0; elapsed < quietRemaining * 60000 && !stopping(); elapsed += sleepMs) {
          if (db.prepare("SELECT 1 FROM commands WHERE type='scan_now' AND status='queued' LIMIT 1").get()) break
          if (db.prepare('SELECT paused FROM harness_status WHERE id=1').get().paused) break
          await new Promise((resolve) => setTimeout(resolve, sleepMs))
        }
        continue
      }
      await runCycle({ db, scanner })
      const minutes = Number(setting(db, 'cycle_interval_min', '120'))
      const interval = Math.max(5, Math.min(minutes, 1440))
      const next = nextCycleTime(new Date(), interval, quietHours)
      setHarnessState('waiting', { next_cycle_at: next.toISOString() }, db)
      for (let elapsed = 0; elapsed < minutes * 60000 && !stopping(); elapsed += sleepMs) {
        if (db.prepare("SELECT 1 FROM commands WHERE type='scan_now' AND status='queued' LIMIT 1").get()) break
        if (db.prepare('SELECT paused FROM harness_status WHERE id=1').get().paused) break
        await new Promise((resolve) => setTimeout(resolve, sleepMs))
      }
    } catch (error) {
      setHarnessState('error', { current_account: '' }, db)
      console.error(`Harness loop failed: ${error.stack || error}`)
      await new Promise((resolve) => setTimeout(resolve, sleepMs))
    }
  }
}

module.exports = { runCycle, runLoop, scanOne, queuedScan }
