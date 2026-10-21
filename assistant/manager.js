'use strict'

const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const { getDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { runAttentionCycle } = require('./monitor')
const visor = require('./pdf-visor.cjs')
const { startHeartbeat: startServiceHeartbeat } = require('../lib/heartbeat')

function startAssistantManager({ db = getDatabase(), intervalMs = Number(process.env.V8_ASSISTANT_MANAGER_INTERVAL_MS || 30000), signal } = {}) {
  if (!Number.isInteger(intervalMs) || intervalMs < 5000 || intervalMs > 300000) {
    throw new Error('V8_ASSISTANT_MANAGER_INTERVAL_MS must be 5000–300000')
  }
  let busy = false
  let sweepBusy = false
  let stopped = false
  let lastOpenCodeCheck = 0
  let timer
  const run = () => {
    if (busy || stopped) return
    const enabled = db.prepare("SELECT value FROM settings WHERE key='assistant_manager_enabled'").get()?.value !== 'false'
    if (!enabled) {
      db.prepare(`UPDATE assistant_manager_status SET state='disabled',updated_at=? WHERE id=1`)
        .run(new Date().toISOString())
      return
    }
    busy = true
    try {
      runAttentionCycle(db)
      // Lane B — a small visor sweep each interval repairs documents that were
      // ingested without a PDF study (restarts, pauses, manual inserts).
      if (!sweepBusy) {
        sweepBusy = true
        visor.sweepUnstudiedDocuments(db, { limit: 2 })
          .catch((sweepError) => {
            console.error(`Assistant visor sweep failed: ${sweepError.message}`)
          })
          .finally(() => { sweepBusy = false })
      }
      // Lane C — verify system adviser (OpenCode) health and readiness from time to time
      const nowMs = Date.now()
      if (nowMs - lastOpenCodeCheck > 60000) {
        lastOpenCodeCheck = nowMs
        try {
          const { probe } = require('./capabilities')
          probe('system_adviser', { db, actorId: 'assistant_manager' }).catch(() => {})
        } catch (_) {}
      }
    } catch (error) {
      console.error(`Assistant manager cycle failed: ${error.message}`)
    } finally {
      busy = false
    }
  }
  const schedule = () => {
    if (stopped) return
    const configured = db.prepare("SELECT value FROM settings WHERE key='assistant_manager_interval_ms'").get()?.value
    const nextInterval = configured === undefined ? intervalMs : Number(configured)
    if (!Number.isInteger(nextInterval) || nextInterval < 5000 || nextInterval > 300000) {
      throw new Error('assistant_manager_interval_ms must be 5000–300000')
    }
    timer = setTimeout(() => {
      run()
      schedule()
    }, nextInterval)
    timer.unref()
  }
  run()
  schedule()
  const stop = () => {
    stopped = true
    clearTimeout(timer)
  }
  if (signal) signal.addEventListener('abort', stop, { once: true })
  return stop
}

function main() {
  const db = getDatabase()
  runMigrations(db)
  const controller = new AbortController()
  const stop = startAssistantManager({ db, signal: controller.signal })
  const stopServiceHeartbeat = startServiceHeartbeat('assistant', { db })
  let stopping = false
  const shutdown = () => {
    if (stopping) return
    stopping = true
    controller.abort()
    stop()
    stopServiceHeartbeat()
    db.close()
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  // Windows PM2 has no real signals; a graceful stop arrives as a message.
  process.on('message', (message) => { if (message === 'shutdown') shutdown() })
  return { shutdown }
}

if (require.main === module) {
  try { main() }
  catch (error) {
    console.error(`Assistant manager startup failed: ${error.stack || error}`)
    process.exitCode = 1
  }
}

module.exports = { main, startAssistantManager }
