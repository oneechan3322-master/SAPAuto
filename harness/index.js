'use strict'

const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const { getDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { startHeartbeat } = require('./heartbeat')
const { startHeartbeat: startServiceHeartbeat } = require('../lib/heartbeat')
const { installProcessGuard } = require('../lib/process-guard')
const { startLease } = require('../lib/lease')
const { startCommandWorker } = require('./commands')
const { startSchedules } = require('./schedules')
const { runLoop } = require('./loop')
const { scanAndIngestAllPdfs } = require('../domain/pdf-scanner.cjs')

async function main() {
  const db = getDatabase()
  runMigrations(db)
  installProcessGuard({ serviceName: 'harness', db })

  // Two harness copies must never scan at once (PM2 #6142 restart overlap and
  // manual starts). The lease is taken before any work begins; a copy that
  // cannot own it exits without touching accounts.
  const lease = startLease('harness', {
    db,
    onLost: (error) => { console.error(`Harness lease lost: ${error.message}`) }
  })
  if (!lease.acquired) {
    console.error('Another harness instance owns the scan lease; this copy will not start.')
    return { shutdown: async () => {}, loopPromise: Promise.resolve() }
  }
  const stopServiceHeartbeat = startServiceHeartbeat('harness', { db })

  // Scan and ingest older and current PDFs with OCR into the database automatically
  try {
    const scanResult = await scanAndIngestAllPdfs({ db, importOlderVersions: true })
    console.log(`[Harness Startup] PDF Scanner: Indexed ${scanResult.newlyIndexed} new, updated ${scanResult.updatedCount}, total ${scanResult.totalFound} PDFs.`)
  } catch (err) {
    console.error(`[Harness Startup] PDF Scanner warning: ${err.message}`)
  }

  const controller = new AbortController()
  const stopHeartbeat = startHeartbeat(db)
  const stopCommands = startCommandWorker({ db })
  const stopSchedules = startSchedules(db)
  const loopPromise = runLoop({ db, signal: controller.signal })
  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    controller.abort()
    stopHeartbeat()
    stopServiceHeartbeat()
    stopCommands()
    stopSchedules()
    lease.stop()
    await loopPromise
    db.close()
  }
  const handleSignal = () => shutdown().catch((error) => {
    console.error(`Harness shutdown failed: ${error.message}`)
    process.exitCode = 1
  })
  process.once('SIGINT', handleSignal)
  process.once('SIGTERM', handleSignal)
  // Windows PM2 has no real signals; a graceful stop arrives as a message.
  process.on('message', (message) => { if (message === 'shutdown') handleSignal() })
  return { shutdown, loopPromise }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Harness startup failed: ${error.stack || error}`)
    process.exitCode = 1
  })
}

module.exports = { main }
