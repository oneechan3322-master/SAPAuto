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
  const eventCount = () => db.prepare("SELECT COUNT(*) AS n FROM events WHERE account_key=? AND kind='new_doc'").get(account.username).n
  try {
    setHarnessState('scanning', { current_account: account.username }, db)
    const result = await scanner(account.username)
    if (!result.login || result.login.success !== true) {
      throw new Error(result.login && result.login.rejected ? 'Portal rejected account authentication' : 'Account scan did not confirm login')
    }
    const beforeDocs = eventCount()
    ingestAccount(result, db)
    return { ok: true, newDocs: eventCount() - beforeDocs, error: '' }
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
    const companyRow = db.prepare('SELECT id FROM companies WHERE account_key=?').get(account.username)
    db.prepare(`INSERT INTO failures(id,account_key,occurred_at,reason,hint,company_id)
      VALUES(?,?,?,?,?,?)`).run(id('failure'), account.username, timestamp, String(error.message).slice(0, 500),
      '\u0631\u0627\u062C\u0639 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062F\u062E\u0648\u0644 \u0648\u0627\u0644\u0627\u062A\u0635\u0627\u0644\u060C \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0628\u0639\u062F \u0627\u0644\u062A\u062D\u0642\u0642.', companyRow ? companyRow.id : null)
    if (parkedUntil) db.prepare(`INSERT INTO events(id,kind,account_key,payload,created_at)
      VALUES(?,?,?,?,?)`).run(id('event'), 'account_parked', account.username, JSON.stringify({ parkedUntil }), timestamp)
    console.error(`Account scan failed (${account.username}): ${error.message}`)
    return { ok: false, newDocs: 0, error: String(error.message).slice(0, 300) }
  }
}

/* A cycle row still marked `running` when no cycle is executing can only be the
   remains of a process that died mid-scan. Left alone it would display as a
   forever-running cycle (plan 4.1 §3); honest state is `interrupted`. */
function reconcileInterruptedCycles(db = getDatabase()) {
  const stale = db.prepare(`SELECT COUNT(*) AS n FROM automation_cycles WHERE state='running'`).get().n
  if (stale === 0) return 0
  const finishedAt = now()
  const changed = db.prepare(`UPDATE automation_cycles SET state='interrupted',finished_at=?
    WHERE state='running'`).run(finishedAt).changes
  if (changed > 0) {
    db.prepare(`INSERT INTO events(id,kind,payload,created_at) VALUES(?,?,?,?)`)
      .run(id('event'), 'cycle_interrupted', JSON.stringify({ count: changed }), finishedAt)
  }
  return changed
}

function notifyScanAccount(db, account, index, total, outcome) {
  // Per-account scan notifications ride the SAME transactional outbox - the
  // harness never owns the WhatsApp client; a down transport just parks the
  // note as pending and the sender service keeps the pacing rules in one place.
  const controlNumber = setting(db, 'whatsapp_control_number', '')
  if (!controlNumber) return
  const digits = String(controlNumber).replace(/\D/g, '')
  if (!digits) return
  const companyRow = db.prepare('SELECT name FROM companies WHERE account_key=?').get(account.username)
  const companyName = (companyRow && companyRow.name) || account.username
  const timeStr = new Date().toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' })
  let messageText
  if (outcome.ok) {
    messageText = `\u2705 *\u0627\u0643\u062A\u0645\u0644 \u0641\u062D\u0635 \u0627\u0644\u0645\u0646\u0634\u0623\u0629 (${index}/${total}):*\n\u{1F3E2} *${companyName}*\n\u{1F4C4} \u0645\u0633\u062A\u0646\u062F\u0627\u062A \u062C\u062F\u064A\u062F\u0629: *${outcome.newDocs}*\n\u{1F550} ${timeStr}`
  } else {
    messageText = `\u26A0\uFE0F *\u062A\u0639\u0630\u0631 \u0641\u062D\u0635 \u0627\u0644\u0645\u0646\u0634\u0623\u0629 (${index}/${total}):*\n\u{1F3E2} *${companyName}*\n\u274C \u0627\u0644\u0633\u0628\u0628: ${outcome.error || '\u062E\u0637\u0623 \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641'}\n\u{1F550} ${timeStr}`
  }
  const eventId = id('event')
  db.prepare(`INSERT INTO events(id,kind,account_key,payload,created_at) VALUES(?,?,?,?,?)`)
    .run(eventId, 'scan_account_completed', account.username,
      JSON.stringify({ companyName, scanSuccess: Boolean(outcome.ok), newDocsCount: outcome.newDocs || 0, error: outcome.error || '' }), now())
  require('../channels/outbox').enqueue({
    eventId,
    channel: 'whatsapp',
    recipient: `${digits}@c.us`,
    payload: { text: messageText }
  }, db)
}

async function runCycle({ db = getDatabase(), scanner = runAccount, accountKey = '', gapMs = 10000 } = {}) {
  reconcileInterruptedCycles(db)
  const accounts = await listAccounts(db)
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
  let interrupted = false
  try {
    for (let i = 0; i < queue.length; i += 1) {
      // A pause request stops the cycle between accounts; the cycle did not
      // finish, so it is recorded as interrupted with its honest progress.
      if (db.prepare('SELECT paused FROM harness_status WHERE id=1').get().paused) {
        interrupted = true
        break
      }
      const outcome = await scanOne(queue[i], i + 1, queue.length, db, scanner)
      if (outcome.ok) processed += 1
      else failed += 1
      try { notifyScanAccount(db, queue[i], i + 1, queue.length, outcome) } catch (notifyError) {
        console.error(`Per-account scan notification failed (${queue[i].username}): ${notifyError.message}`)
      }
      // Throttle: 10 s between accounts prevents CPU/RAM spikes on server PC
      if (i < queue.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, gapMs))
      }
    }
  } catch (error) {
    db.prepare(`UPDATE automation_cycles SET finished_at=?,state='failed',accounts_processed=?,
      accounts_failed=?,summary=? WHERE id=?`).run(
      now(), processed, failed, JSON.stringify({ accountKey: accountKey || null, error: String(error.message).slice(0, 300) }), cycleId
    )
    throw error
  }
  const finishedAt = now()
  db.prepare(`UPDATE automation_cycles SET finished_at=?,state=?,accounts_processed=?,
    accounts_failed=?,summary=? WHERE id=?`).run(
    finishedAt, interrupted ? 'interrupted' : 'done', processed, failed, JSON.stringify({ accountKey: accountKey || null }), cycleId
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
      // Active window: 09:00 – 16:00 Cairo. Quiet from 16:00 to 09:00 next day.
      const quietHours = setting(db, 'quiet_hours', '16:00-09:00')
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

module.exports = { reconcileInterruptedCycles, runCycle, runLoop, scanOne, queuedScan, notifyScanAccount }
