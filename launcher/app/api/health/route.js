import { db } from '../../../lib/db.js'

export const dynamic = 'force-dynamic'

// Liveness and queue health for external monitors (Opus5.5 §6.12). Public on
// purpose so a dead-man switch on another machine can reach it: it exposes
// service names, heartbeat ages and outbox counts only — never business data.
export async function GET() {
  const age = (iso) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 1000) : null)

  const services = {}
  for (const row of db.prepare('SELECT service, status, last_heartbeat, pid FROM service_status').all()) {
    services[row.service] = {
      status: row.status,
      pid: row.pid,
      heartbeatAgeS: age(row.last_heartbeat)
    }
  }

  // Mirrors channels/outbox.js outboxStats() without pulling the worker
  // modules (and their pino transport) into the launcher bundle.
  const outbox = db.prepare(`SELECT
      COALESCE(SUM(shadow = 0 AND status IN ('pending', 'failed')), 0) AS backlog,
      COALESCE(SUM(shadow = 0 AND status = 'dead'), 0) AS dead,
      COALESCE(SUM(shadow = 0 AND status = 'uncertain'), 0) AS uncertain,
      MIN(CASE WHEN shadow = 0 AND status IN ('pending', 'failed') THEN created_at END) AS oldest
    FROM notification_outbox`).get()

  const staleService = Object.values(services).some((service) => service.heartbeatAgeS === null || service.heartbeatAgeS > 180)
  const oldestAgeS = age(outbox.oldest)
  const unhealthy = staleService || outbox.dead > 0 || (oldestAgeS !== null && oldestAgeS > 900)

  return Response.json({
    ok: !unhealthy,
    services,
    outbox: { ...outbox, oldestAgeS }
  }, { status: unhealthy ? 503 : 200 })
}
