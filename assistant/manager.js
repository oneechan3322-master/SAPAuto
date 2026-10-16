'use strict'

const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const { getDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { runAttentionCycle } = require('./monitor')

function startAssistantManager({ db = getDatabase(), intervalMs = Number(process.env.V8_ASSISTANT_MANAGER_INTERVAL_MS || 30000), signal } = {}) {
  if (!Number.isInteger(intervalMs) || intervalMs < 5000 || intervalMs > 300000) {
    throw new Error('V8_ASSISTANT_MANAGER_INTERVAL_MS must be 5000–300000')
  }
  let busy = false
  let stopped = false
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
  const shutdown = () => {
    controller.abort()
    stop()
    db.close()
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
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
