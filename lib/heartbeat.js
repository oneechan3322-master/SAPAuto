'use strict'

const { getDatabase } = require('../db/connect')
const { now } = require('../db/queries/shared')

// Every service writes its own row in service_status; /health reads them and
// reports age. A service that is running but silent (stuck loop, dead worker
// thread) must be visible as stale here, not assumed healthy.
function writeHeartbeat(service, { status = 'online', meta = {}, db = getDatabase(), pid = process.pid } = {}) {
  db.prepare(`INSERT INTO service_status(service, pid, status, last_heartbeat, meta_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(service) DO UPDATE SET
      pid = excluded.pid, status = excluded.status,
      last_heartbeat = excluded.last_heartbeat, meta_json = excluded.meta_json`)
    .run(service, pid, status, now(), JSON.stringify(meta))
}

function startHeartbeat(service, { intervalMs = 30000, meta = () => ({}), db = getDatabase() } = {}) {
  try { writeHeartbeat(service, { meta: meta(), db }) } catch { /* first beat may race migrations */ }
  const timer = setInterval(() => {
    try { writeHeartbeat(service, { meta: meta(), db }) } catch { /* a missed beat shows as staleness */ }
  }, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}

module.exports = { writeHeartbeat, startHeartbeat }
