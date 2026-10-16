'use strict'

const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const { getDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { startHeartbeat } = require('./heartbeat')
const { startCommandWorker } = require('./commands')
const { startSchedules } = require('./schedules')
const { runLoop } = require('./loop')

async function main() {
  const db = getDatabase()
  runMigrations(db)
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
    stopCommands()
    stopSchedules()
    await loopPromise
    db.close()
  }
  const handleSignal = () => shutdown().catch((error) => {
    console.error(`Harness shutdown failed: ${error.message}`)
    process.exitCode = 1
  })
  process.once('SIGINT', handleSignal)
  process.once('SIGTERM', handleSignal)
  return { shutdown, loopPromise }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Harness startup failed: ${error.stack || error}`)
    process.exitCode = 1
  })
}

module.exports = { main }
