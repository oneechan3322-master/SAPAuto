'use strict'

const { randomUUID } = require('node:crypto')
const { getDatabase, writeTx } = require('../db/connect')

// PM2 on Windows can start a second copy of a service across a restart with
// shutdown_with_message (PM2 #6142), and two harness copies must never scan at
// once. The service_locks row is the single arbiter: a copy that cannot prove
// ownership exits instead of doing half the work twice.
function makeOwner(service) {
  return `${service}:${process.pid}:${randomUUID().slice(0, 8)}`
}

function acquireLease(service, { ttlMs = 15000, db = getDatabase(), owner = makeOwner(service) } = {}) {
  const timestamp = new Date().toISOString()
  const expiresAt = new Date(Date.now() + ttlMs).toISOString()
  const acquired = writeTx(() => {
    db.prepare('DELETE FROM service_locks WHERE service = ? AND expires_at < ?').run(service, timestamp)
    try {
      db.prepare('INSERT INTO service_locks(service, owner, expires_at) VALUES (?, ?, ?)')
        .run(service, owner, expiresAt)
      return true
    } catch (error) {
      if (/UNIQUE|PRIMARY/i.test(String(error.code) + String(error.message))) return false
      throw error
    }
  }, db)
  return { acquired, owner, service }
}

function renewLease({ service, owner }, { ttlMs = 15000, db = getDatabase() } = {}) {
  const expiresAt = new Date(Date.now() + ttlMs).toISOString()
  const result = db.prepare('UPDATE service_locks SET expires_at = ? WHERE service = ? AND owner = ?')
    .run(expiresAt, service, owner)
  return result.changes === 1
}

function releaseLease({ service, owner }, db = getDatabase()) {
  db.prepare('DELETE FROM service_locks WHERE service = ? AND owner = ?').run(service, owner)
}

/**
 * Acquire the lease and keep it renewed. `onLost` fires when another process
 * took over; the caller must stop doing work and exit.
 */
function startLease(service, { ttlMs = 15000, db = getDatabase(), onLost } = {}) {
  const lease = acquireLease(service, { ttlMs, db })
  if (!lease.acquired) return { acquired: false, stop() {} }
  const timer = setInterval(() => {
    try {
      if (!renewLease(lease, { ttlMs, db })) {
        clearInterval(timer)
        onLost?.(new Error(`Lease for ${service} is no longer owned by this process`))
      }
    } catch { /* a transient DB error must not drop a still-owned lease */ }
  }, Math.max(1000, Math.floor(ttlMs / 3)))
  timer.unref()
  return {
    acquired: true,
    owner: lease.owner,
    stop() {
      clearInterval(timer)
      try { releaseLease(lease, db) } catch { /* already gone */ }
    }
  }
}

module.exports = { acquireLease, renewLease, releaseLease, startLease, makeOwner }
