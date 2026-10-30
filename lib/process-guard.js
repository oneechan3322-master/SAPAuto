'use strict'

// upgradeplan v9.0 Card S1: one process-hardening module for all 8 services.
// No service dies silently from an unhandled error anymore: every uncaught
// exception, unhandled rejection and node warning becomes (1) a structured
// log line, (2) one incident row in service_incidents, (3) a refreshed
// service_status incident census. Identical signatures escalate once to the
// events outbox (kind is service_incident_storm) so the fallback lane (S6)
// can deliver the alert. Fatal classes still exit — but only after the row
// and the log line are committed, so PM2 restarts a clean process.
//
// Guardrails honored: the WhatsApp client lifecycle is untouched (wa-sender
// gets the same handlers as everyone else), intentionally-stopping errors
// (lease exit, migration checksum, DB corruption) stay fatal, and no cleanup
// is duplicated — PM2 shutdown wiring is only installed when a caller passes
// `cleanup`, because every entry point installs its own today.

const { getDatabase } = require('../db/connect')
const { now } = require('../db/queries/shared')
const { log } = require('./logger')

const STORM_LIMIT = Number(process.env.V8_GUARD_STORM_LIMIT || 5) // N identical signatures
const STORM_WINDOW_MS = Number(process.env.V8_GUARD_STORM_WINDOW_MS || 10 * 60 * 1000) // in M minutes

const FATAL_PATTERNS = [
  { reason: 'db-corruption', regex: /SQLITE_CORRUPT|database disk image is malformed/i },
  { reason: 'lease-lost', regex: /lease lost/i },
  { reason: 'lease-single-instance', regex: /owns the (scan )?lease/i },
  { reason: 'migration-integrity', regex: /migration checksum|checksum mismatch/i },
  { reason: 'wa-auth-integrity', regex: /\.wwebjs_auth (is )?(integrity|corrupt)|session integrity/i }
]

function signatureOf(kind, error) {
  const name = (error && error.name) || 'Error'
  const message = String((error && error.message) || error || '')
  return `${kind}|${name}|${message.split(/\r?\n/)[0].slice(0, 240)}`
    // P0.1 masking policy: long digit runs (JIDs, invoice ids) keep their last
    // three digits; email addresses fold to a token. Signatures repeat across
    // occurrences — never let them carry customer data.
    .replace(/\d{7,}/g, (d) => `<${d.slice(-3)}>`)
    .replace(/[^\s<,]+@[\w.-]+/g, '<email>')
}

function isFatal(error) {
  const haystack = `${(error && error.name) || ''} ${String((error && error.message) || error || '')}`
  return FATAL_PATTERNS.find((p) => p.regex.test(haystack)) || null
}

const perSignature = new Map() // signature -> { startMs, count, announced, logged }
let insideHandler = false

function hydrateDb(state) {
  if (state.db) return state.db
  try { state.db = getDatabase() } catch (error) {
    console.error(`process-guard [${state.serviceName}]: database unavailable for incidents (${error.message})`)
    return null
  }
  return state.db
}

function recordIncident(state, kind, error, fatal, signature) {
  const db = hydrateDb(state)
  if (!db) return false
  try {
    const memoryRss = process.memoryUsage().rss
    db.prepare(`INSERT INTO service_incidents(service,kind,signature,message,stack,memory_rss,created_at)
      VALUES(?,?,?,?,?,?,?)`)
      .run(state.serviceName, kind, signature, String((error && error.message) || error || ''),
        String((error && error.stack) || '') || null, memoryRss, now())
    // The ops census: refresh the heartbeat row's incident columns (R6 reads
    // them). A service that has not heartbeated yet simply has no row to
    // update — its heartbeat tick writes these columns on its next incident.
    const { updateIncidentColumns } = require('./heartbeat')
    updateIncidentColumns(db, state.serviceName)
    void fatal
    return true
  } catch (writeError) {
    console.error(`process-guard [${state.serviceName}]: incident row failed: ${writeError.message} | original: ${signature}`)
    return false
  }
}

function escalateStorm(state, win, signature) {
  const db = hydrateDb(state)
  if (!db) return false
  try {
    db.prepare('INSERT INTO events(id,kind,payload,created_at) VALUES(?,?,?,?)')
      .run(require('node:crypto').randomUUID(), 'service_incident_storm',
        JSON.stringify({ service: state.serviceName, signature, count: win.count, windowMs: STORM_WINDOW_MS }), now())
    return true
  } catch (error) {
    console.error(`process-guard [${state.serviceName}]: storm event failed: ${error.message}`)
    return false
  }
}

function handleProcessError(state, kind, error) {
  // Reentrancy: an incident raised INSIDE this handler (db write failing,
  // logger throwing) must never recurse into unhandledRejection again.
  if (insideHandler) {
    console.error(`process-guard [${state.serviceName}]: reentry suppressed for ${kind}`)
    return { suppressed: true }
  }
  insideHandler = true
  try {
    const signature = signatureOf(kind, error)
    const fatal = kind !== 'warning' && Boolean(isFatal(error))
    const recorded = recordIncident(state, kind, error, fatal, signature)

    let win = perSignature.get(signature)
    if (!win || Date.now() - win.startMs > STORM_WINDOW_MS) {
      win = { startMs: Date.now(), count: 0, announced: false, logged: false }
      perSignature.set(signature, win)
    }    win.count += 1

    // Log a structured record; the storm breaker stops re-logging the same
    // signature every second (rows keep flowing — one per occurrence).
    if (!win.logged) {
      win.logged = true
      log.error({
        service: state.serviceName,
        kind,
        fatal,
        signature,
        memory_rss: process.memoryUsage().rss
      }, 'process incident')
    }
    let storm = false
    if (win.count > STORM_LIMIT && !win.announced) {
      win.announced = true
      storm = escalateStorm(state, win, signature)
      if (storm) log.error({ service: state.serviceName, signature, count: win.count }, 'service incident storm')
    }

    if (fatal && state.fatalExit) {
      // Row and log line are already committed — a clean process for PM2.
      state.fatalExit(`fatal process error: ${signature}`)
    }
    return { fatal, signature, recorded, storm, count: win.count }
  } finally {
    insideHandler = false
  }
}

const INSTALLED = new Map()

function installProcessGuard({ serviceName = process.env.SERVICE_NAME || 'sapauto', db = null, cleanup = null, onFatalExit = null } = {}) {
  if (INSTALLED.has(serviceName)) return INSTALLED.get(serviceName)
  const state = { serviceName, db, fatalExit: null }
  // Fatal exits wait one tick so pino's stdout buffer flushes first.
  state.fatalExit = onFatalExit || ((why) => {
    log.fatal({ service: serviceName, why }, 'process exiting for a fatal-class incident')
    setTimeout(() => process.exit(1), 200).unref()
  })
  if (cleanup) {
    // Reuse lib/shutdown.js — never duplicate another PM2 message handler.
    require('./shutdown').installShutdown(cleanup, { closeDb: true })
  }
  process.on('unhandledRejection', (reason) => {
    handleProcessError(state, 'unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)))
  })
  process.on('uncaughtException', (error) => handleProcessError(state, 'uncaughtException', error))
  process.on('warning', (warning) => handleProcessError(state, 'warning', warning))
  const api = { serviceName, handle: (kind, error) => handleProcessError(state, kind, error) }
  INSTALLED.set(serviceName, api)
  return api
}

module.exports = { installProcessGuard, handleProcessError, signatureOf, isFatal, FATAL_PATTERNS, STORM_LIMIT, STORM_WINDOW_MS }
