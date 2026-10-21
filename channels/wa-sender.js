'use strict'

const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const { getDatabase, closeDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const outbox = require('./outbox')
const { log } = require('../lib/logger')
// Sender service for the whatsapp outbox channel (Opus5.5 §6.2 transport
// split). This process is the ONLY owner of the WhatsApp client: the old
// in-worker client could race the PM2 replacement copy during restarts
// (PM2 #6142), and two initialized clients on one LocalAuth session corrupt
// pairing state. Delivery is claim(lease) → send → mark; the service_locks
// row guarantees a single scanner.
//
// Shadow phase: enqueue() only creates shadow rows, so the drain loop has
// nothing real to send yet — the client warms up exactly as before, and the
// 'outbox_mode'='live' cut-over happens without touching this module again.

const CLIENT_RETRY_MS = 15000
const CLIENT_COOLDOWN_MS = 20000
const PAIR_MAX_RETRIES = 5
const REGISTRY_ID = 'whatsapp-office-primary'

const state = {
  client: null,
  clientStarting: false,
  lastStartAttempt: 0,
  pairRetries: 0,
  lease: null
}

function now() {
  return new Date().toISOString()
}

async function upsertChannelRegistry(id, providerType, status, draftOnly, connectionPayloadRef, lastError) {
  const db = getDatabase()
  const existing = db.prepare('SELECT id FROM channel_registry WHERE id = ?').get(id)
  const timestamp = now()
  if (existing) {
    db.prepare(
      `UPDATE channel_registry SET provider_type = ?, status = ?, draft_only = ?,
         connection_payload_ref = ?, last_error = ?, updated_at = ?
       WHERE id = ?`
    ).run(providerType, status, draftOnly, connectionPayloadRef, lastError, timestamp, id)
  } else {
    db.prepare(
      `INSERT INTO channel_registry(id, provider_type, status, draft_only, connection_payload_ref,
         last_heartbeat_at, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`
    ).run(id, providerType, status, draftOnly, connectionPayloadRef, lastError, timestamp, timestamp)
  }
}

/** Delivery shape for an outbox row: text messages and document payloads.
 * Matches the drain() sender contract: sendFn(recipient, parsedPayload). */
async function sendRow(recipient, payload) {
  const whatsapp = require('./whatsapp')
  if (payload.kind === 'document') {
    return whatsapp.sendDocument(recipient, payload.pdfPath, payload.caption || '', payload.displayFilename || '')
  }
  return whatsapp.sendMessage(recipient, payload.text || '')
}

/** True when the failure means "client not ready yet" — the row is deferred
 * without burning an attempt, because transport outages are not delivery
 * failures. */
function transportNotReady(error) {
  return /WhatsApp client is not connected/i.test(String(error?.message || ''))
}

function shouldStartClient(db) {
  const pairingRequested = db.prepare("SELECT value FROM settings WHERE key='whatsapp_pair_requested'").get()?.value === 'true'
  const registryStatus = db.prepare("SELECT status FROM channel_registry WHERE id=?").get(REGISTRY_ID)?.status || 'unconfigured'
  const whatsappConnected = db.prepare("SELECT value FROM settings WHERE key='whatsapp_connected'").get()?.value === 'true'
  const whatsappControlConfigured = Boolean(db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_number'").get()?.value)
  return Boolean(
    process.env.WHATSAPP_ENABLED === 'true' || pairingRequested || whatsappConnected ||
    whatsappControlConfigured || registryStatus === 'connecting'
  )
}

async function syncProviders() {
  const db = getDatabase()
  // Operator-requested disconnect.
  if (db.prepare("SELECT value FROM settings WHERE key='whatsapp_disconnect_requested'").get()?.value === 'true') {
    if (state.client) {
      try { await state.client.destroy() } catch { /* ignore */ }
      state.client = null
    }
    db.prepare("DELETE FROM settings WHERE key IN ('whatsapp_disconnect_requested','whatsapp_connected','whatsapp_qr','whatsapp_pair_requested')").run()
    await upsertChannelRegistry(REGISTRY_ID, 'whatsapp_web', 'unconfigured', 1, null, null)
    return
  }
  // A 'disconnected' event belongs to the previous browser client. Leaving
  // that object alive blocks pairing from ever creating a replacement; do not
  // call logout (it removes LocalAuth files under Chromium's closing lock).
  const registryStatus = db.prepare('SELECT status FROM channel_registry WHERE id=?').get(REGISTRY_ID)?.status || 'unconfigured'
  const whatsappConnected = db.prepare("SELECT value FROM settings WHERE key='whatsapp_connected'").get()?.value === 'true'
  if (state.client && registryStatus === 'unhealthy' && !whatsappConnected) {
    try { await state.client.destroy() } catch { /* the client is already closed */ }
    state.client = null
    return
  }
  if (state.client || state.clientStarting || !shouldStartClient(db)) return
  // Flaky first handshakes must not kill the pairing window: retry with a
  // cooldown, keep the request armed for a bounded number of attempts, and
  // only then drop it to avoid a hot loop on a genuinely broken setup.
  if (Date.now() - state.lastStartAttempt <= CLIENT_COOLDOWN_MS) return
  state.clientStarting = true
  state.lastStartAttempt = Date.now()
  try {
    const whatsappChannel = require('./whatsapp')
    state.client = await whatsappChannel.startWhatsApp()
    state.pairRetries = 0
    // `startWhatsApp()` owns the state transition, including `ready`.
  } catch (error) {
    console.error(`WhatsApp connection could not start: ${error.message}`)
    await upsertChannelRegistry(REGISTRY_ID, 'whatsapp_web', 'unhealthy', 1, null, error.message)
    if (db.prepare("SELECT value FROM settings WHERE key='whatsapp_pair_requested'").get()?.value === 'true') {
      state.pairRetries += 1
      if (state.pairRetries >= PAIR_MAX_RETRIES) {
        db.prepare("DELETE FROM settings WHERE key='whatsapp_pair_requested'").run()
      }
    }
  } finally {
    state.clientStarting = false
  }
}

async function drainOutbox() {
  const db = getDatabase()
  outbox.recoverExpiredLeases(db)
  // The `ready` event is the sole proof a send may happen; while the client is
  // offline rows simply wait as pending instead of burning backoff attempts.
  const connected = db.prepare("SELECT value FROM settings WHERE key='whatsapp_connected'").get()?.value === 'true'
  if (!connected) return
  const stats = outbox.outboxStats(db)
  if (stats.backlog === 0) return
  await outbox.drain('whatsapp', sendRow, { batch: 3, gapMs: 2500, db })
}

async function main() {
  const db = getDatabase()
  runMigrations(db)

  const { startLease } = require('../lib/lease')
  const lease = startLease('wa-sender', {
    db,
    onLost: (error) => {
      console.error(`wa-sender delivery lease lost: ${error.message}`)
      process.exit(0)
    }
  })
  if (!lease.acquired) {
    console.error('Another wa-sender instance owns the delivery lease; this copy will not start.')
    return
  }
  state.lease = lease

  const { writeHeartbeat } = require('../lib/heartbeat')
  writeHeartbeat('wa-sender', { db, meta: { whatsappConnected: db.prepare("SELECT value FROM settings WHERE key='whatsapp_connected'").get()?.value === 'true' } })
  const heartbeatTimer = setInterval(() => {
    writeHeartbeat('wa-sender', {
      db,
      meta: {
        whatsappConnected: db.prepare("SELECT value FROM settings WHERE key='whatsapp_connected'").get()?.value === 'true',
        queue: outbox.outboxStats(db)
      }
    })
  }, 30000)
  heartbeatTimer.unref()

  const syncTimer = setInterval(() => { syncProviders().catch((error) => console.error(`WhatsApp sender sync failed: ${error.message}`)) }, CLIENT_RETRY_MS)
  const drainTimer = setInterval(() => { drainOutbox().catch((error) => console.error(`WhatsApp outbox drain failed: ${error.message}`)) }, 3000)
  syncTimer.unref()
  drainTimer.unref()

  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    clearInterval(heartbeatTimer)
    clearInterval(syncTimer)
    clearInterval(drainTimer)
    try { lease.stop() } catch { /* lease already released */ }
    if (state.client) {
      try { await state.client.destroy() } catch { /* the browser is already gone */ }
      state.client = null
    }
    try { await upsertChannelRegistry(REGISTRY_ID, 'whatsapp_web', 'unhealthy', 1, null, 'disconnected') } catch (error) {
      log.error({ err: error.message }, 'registry shutdown update failed')
    }
    try { closeDatabase() } catch (error) {
      log.error({ err: error.message }, 'database close failed')
    }
    process.exit(0)
  }
  process.once('SIGINT', () => { shutdown() })
  process.once('SIGTERM', () => { shutdown() })
  // Windows PM2 has no real signals; a graceful stop arrives as a message.
  process.on('message', (message) => { if (message === 'shutdown') shutdown() })

  drainOutbox().catch((error) => console.error(`Initial drain failed: ${error.message}`))
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`WhatsApp sender startup failed: ${error.stack || error}`)
    process.exitCode = 1
  })
}

module.exports = { sendRow, transportNotReady, shouldStartClient, state }
