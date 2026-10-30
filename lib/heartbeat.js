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

/** upgradeplan v9.0 Card S1: service_status carries the incident census the
 * ops page (R6) will trust. Called by the process guard after each incident;
 * counts are computed from service_incidents, never from guesses. When the
 * service has not heartbeated yet there is no row — the next beat writes one. */
function updateIncidentColumns(db, service) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const count = db.prepare('SELECT COUNT(*) AS c FROM service_incidents WHERE service = ? AND created_at >= ?')
    .get(service, oneHourAgo)?.c ?? 0
  const last = db.prepare('SELECT MAX(created_at) AS t FROM service_incidents WHERE service = ?').get(service)?.t || null
  db.prepare('UPDATE service_status SET incidents_1h = ?, last_incident_at = ? WHERE service = ?')
    .run(count, last, service)
  return { count, last }
}

module.exports = { writeHeartbeat, startHeartbeat, updateIncidentColumns }
