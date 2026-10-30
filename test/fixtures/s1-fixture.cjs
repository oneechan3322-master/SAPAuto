'use strict'

// upgradeplan v9.0 Card S1 fixture: a minimal service that installs the
// process-guard FIRST, then (1) fires an unawaited promise rejection and
// (2) throws inside a timer. Success criteria — the process STAYS ALIVE
// through both, with exactly one incident row per occurrence, its heartbeat
// row carrying the incident census columns, and then it exits cleanly with a
// JSON self-report on stdout. The parent test (plan-v90-s1-process-guard)
// asserts all of it through the exit code and this line.
const { openDatabase } = require('../../db/connect')
const { runMigrations } = require('../../db/migrate')
const { installProcessGuard } = require('../../lib/process-guard')
const { writeHeartbeat } = require('../../lib/heartbeat')

const db = openDatabase(process.env.V8_DB_PATH)
runMigrations(db)

installProcessGuard({ serviceName: 'guard-fixture', db })
writeHeartbeat('guard-fixture', { db })

// Unawaited rejections must reach the guard, not kill the process.
setImmediate(() => {
  void Promise.reject(new Error('fixture: unawaited boom'))
})

setTimeout(() => { throw new Error('fixture: timer boom') }, 150)

setTimeout(() => {
  try {
    const rows = db.prepare('SELECT COUNT(*) AS c FROM service_incidents').get().c
    const storms = db.prepare("SELECT COUNT(*) AS c FROM events WHERE kind='service_incident_storm'").get().c
    const status = db.prepare('SELECT incidents_1h, last_incident_at FROM service_status WHERE service = ?').get('guard-fixture')
    console.log(JSON.stringify({ alive: true, rows, storms, incidents_1h: status ? status.incidents_1h : null }))
    db.close()
    process.exit(0)
  } catch (error) {
    console.log(JSON.stringify({ alive: true, reportError: error.message }))
    process.exit(3)
  }
}, 900)
