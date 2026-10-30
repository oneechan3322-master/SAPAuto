'use strict'

const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const { getDatabase, closeDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const outbox = require('./outbox')
const { log } = require('../lib/logger')
const { applyAll: applyPatchSet } = require('../lib/wwebjs-patch.cjs')
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
// Zombie-page watchdog probing and the pacing of the DB self-heal.
const WATCHDOG_INTERVAL_MS = 20000
const WATCHDOG_STRIKES_TO_REBUILD = 2
const DB_HEAL_GAP_MS = 60000
// Sends issued too early after `ready` neither confirm nor fail cleanly
// (getter errors, null resolves). The drain holds off for this window.
const BOOT_STABILITY_MS = 90000
let transportStrikes = 0
let lastDbHealMs = 0
let drainPausedByQuietHours = false
let waProbeSentThisBoot = false

/** Pure cursor over whatsapp.bootReadyMs(): true while page boot is young. */
function shouldHoldForBoot(readyMs, thresholdMs = BOOT_STABILITY_MS) {
  if (readyMs === null || readyMs === undefined) return true
  return readyMs < thresholdMs
}

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
    try {
      return await whatsapp.sendDocument(recipient, payload.pdfPath, payload.caption || '', payload.displayFilename || '')
    } catch (error) {
      // sendDocument already verified internally when the raw scan could run
      // (its message carries '[verify: …]') — only double-check when it could
      // not (e.g. no page) or the verdict was inconclusive.
      if (error?.unconfirmed !== true || String(error?.message || '').includes('[verify:')) throw error
      // A page-level failure can fire after the document already left the
      // page (WWebJS getter errors). Verify against the client's own
      // outgoing store; a verified send closes the row as sent with the
      // real message id — blind retry would duplicate the document.
      const candidates = [payload.displayFilename, payload.pdfPath ? path.basename(payload.pdfPath) : null]
      const verdict = await whatsapp.verifyDocumentDelivery(recipient, {
        fileNames: candidates,
        sinceMs: Date.now() - 20 * 60 * 1000
      })
      if (verdict.ok) {
        log.info({ fileName: payload.displayFilename || null, msgId: verdict.msgId, ack: verdict.ack }, 'delivery verified after post-send error: marking sent')
        return { messageId: verdict.msgId || `verified:${Date.now()}` }
      }
      error.message = `${error.message} [verify: ${verdict.reason}]`
      throw error
    }
  }
  return whatsapp.sendMessage(recipient, payload.text || '')
}

/** True when the failure means "client not ready yet" — the row is deferred
 * without burning an attempt, because transport outages are not delivery
 * failures. Senders carry the flag on page-level errors too (zombie page). */
function transportNotReady(error) {
  if (!error) return false
  if (error.transportNotReady === true) return true
  return /WhatsApp client is not connected/i.test(String(error?.message || ''))
}

/** Database-handle-level failures. A malformed image or I/O storm lasted the
 * whole process once (repair window Oct 25); healing means dropping the
 * cached singleton so the next getDatabase() reopens instead of erroring
 * every 3s tick until a PM2 restart. */
function isCorruptionMessage(message) {
  return /malformed|SQLITE_CORRUPT|disk I\/?O error/i.test(String(message || ''))
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
  // isSendReady() holds off the `authenticated`-but-not-yet-`ready` window,
  // where whatsapp-web resolves messages with null silently.
  const { isSendReady, bootReadyMs } = require('./whatsapp')
  const connected = db.prepare("SELECT value FROM settings WHERE key='whatsapp_connected'").get()?.value === 'true'
  if (!connected || !isSendReady()) return
  // Rule 4 (plan §1): outbound broadcasts respect Cairo quiet hours. Pending
  // rows simply keep waiting as 'pending' — attempts stay untouched, so the
  // queue naturally releases at the window's end. Owner-chat replies and the
  // delivery-alert lane bypass this drain and remain instant.
  const quiet = require('../lib/quiet-hours.cjs').activeWindow(db)
  if (quiet) {
    if (!drainPausedByQuietHours) {
      console.log(`WA quiet hours: drain paused ${quiet.start}–${quiet.end} (Cairo)`)
      drainPausedByQuietHours = true
    }
    return
  }
  if (drainPausedByQuietHours) {
    console.log('WA quiet hours: window closed — drain resumed')
    drainPausedByQuietHours = false
  }
  // Post-boot media sends misbehave for the first minute or so; hold claims
  // (attempts stay untouched) until the page has been ready for a while.
  const hasQueued = db.prepare("SELECT id FROM notification_outbox WHERE shadow=0 AND status IN ('pending','failed') LIMIT 1").get()
  if (hasQueued && shouldHoldForBoot(bootReadyMs())) return
  const stats = outbox.outboxStats(db)
  if (stats.backlog === 0) return
  await outbox.drain('whatsapp', sendRow, { batch: 3, gapMs: 2500, db })
}

async function runDrainTick() {
  try {
    await drainOutbox()
  } catch (error) {
    console.error(`WhatsApp outbox drain failed: ${error.message}`)
    if (isCorruptionMessage(error?.message) && Date.now() - lastDbHealMs >= DB_HEAL_GAP_MS) {
      lastDbHealMs = Date.now()
      console.error('WhatsApp outbox drain: reopening the database handle once.')
      try { closeDatabase() } catch { /* reopened by the next getDatabase() */ }
    }
  }
}

/** Zombie-page detector: whatsapp-web's page can die with no 'disconnected'
 * event (observed Oct 25: 85 minutes 'connected' with null sends and zero
 * message events while heartbeats kept ticking). Transport strikes require
 * the session to be authenticated; two consecutive failures tear the client
 * down so syncProviders() boots a replacement — session files on disk are
 * never touched, so only the sky fall is a QR rescan. */
async function runTransportWatchdog() {
  const whatsapp = require('./whatsapp')
  if (!whatsapp.isSendReady()) { transportStrikes = 0; return }
  if (state.clientStarting) return
  const probe = await whatsapp.probeTransport()
  if (probe.ok) { transportStrikes = 0; return }
  // Neutral states: nothing to hold the client against yet.
  if (probe.reason === 'no-client' || probe.reason === 'pairing-or-boot') { transportStrikes = 0; return }
  if (probe.reason === 'page-closed') transportStrikes = WATCHDOG_STRIKES_TO_REBUILD
  transportStrikes += 1
  const why = probe.reason || probe.state || 'unknown'
  console.error(`WhatsApp transport watchdog: probe failed (strike ${transportStrikes}): ${why}`)
  if (transportStrikes < WATCHDOG_STRIKES_TO_REBUILD) return
  transportStrikes = 0
  console.error('WhatsApp transport watchdog: rebuilding the client after a dead page.')
  const db = getDatabase()
  try { await state.client.destroy() } catch { /* the browser may already be gone */ }
  state.client = null
  db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_connected','false',?)
    ON CONFLICT(key) DO UPDATE SET value='false',updated_at=excluded.updated_at`)
    .run(new Date().toISOString())
  await upsertChannelRegistry(REGISTRY_ID, 'whatsapp_web', 'unhealthy', 1, null, 'transport watchdog: zombie page')
}

/** Delivery-problem alerting: when dead/uncertain outbox rows exist and the
 * signature changes, notify the control chat once (retired alerts get one
 * clear message). Direct-lane sends of this alert are recorded in the
 * delivery ledger as well. */
async function maybeDeliveryAlert() {
  const db = getDatabase()
  const stats = outbox.outboxStats(db)
  const problematic = stats.dead > 0 || stats.uncertain > 0
  const signature = problematic ? `d${stats.dead}u${stats.uncertain}` : ''
  const stored = db.prepare("SELECT value FROM settings WHERE key='wa_delivery_alert_sig'").get()?.value || ''
  if (signature === stored) return
  const setSig = (value) => db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('wa_delivery_alert_sig',?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(value, new Date().toISOString())
  // Persist BEFORE sending: zombie pages deliver texts but resolve null, so a
  // confirmation-gated write re-alerts on every tick (observed Oct 25: the
  // same alert 3× at 18:09-18:11). Roll the signature back only on a hard
  // send failure so the next tick retries; unconfirmed keeps it persisted.
  const whatsapp = require('./whatsapp')
  if (!problematic) {
    // The queue healed itself; one clear message, then remember the silence.
    if (stored && whatsapp.isSendReady()) {
      const control = db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_number'").get()?.value || ''
      if (!control) return
      setSig('')
      try {
        await whatsapp.sendMessage(`${control.replace(/^\+/, '')}@c.us`, '✅ تنظف قائمة إرسال واتساب: لم يبقَ أي إرسال معلق للمراجعة.')
        console.log('WA delivery clear alert sent (healed)')
      } catch (error) {
        if (error?.unconfirmed === true) console.log('WA delivery clear alert likely delivered without confirmation')
        else {
          setSig(stored)
          console.error(`WA delivery clear alert failed (signature restored): ${error.message}`)
        }
      }
    }
    return
  }
  // Senders cannot alert while in a zombie/pairing state — the stored sig
  // stays empty so the next healthy tick re-fires the alert.
  if (!whatsapp.isSendReady()) return
  const control = db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_number'").get()?.value || ''
  if (!control) return
  const samples = db.prepare(`SELECT id, status, recipient FROM notification_outbox
    WHERE shadow = 0 AND status IN ('uncertain', 'dead') ORDER BY id ASC LIMIT 3`).all()
  const rowsText = samples.map((r) => `• \`${r.id}\` (${r.status}) → ${r.recipient}`).join('\n')
  const text = [
    `⚠️ *مراجعة إرسال واتساب:* ${stats.uncertain} غير مؤكد و${stats.dead} فاشل نهائياً.`,
    rowsText ? `أهم الصفوف:\n${rowsText}` : '',
    'أرسل «مراجعة الإرسال» للمساعد لعرض التفاصيل، أو أوافق على الإعادة من اللوحة.'
  ].filter(Boolean).join('\n\n')
  setSig(signature)
  try {
    await whatsapp.sendMessage(`${control.replace(/^\+/, '')}@c.us`, text)
    console.log(`WA delivery alert sent (${signature})`)
  } catch (error) {
    if (error?.unconfirmed === true) console.log(`WA delivery alert likely delivered without confirmation (${signature})`)
    else {
      setSig(stored)
      console.error(`WA delivery alert failed (signature restored): ${error.message}`)
    }
  }
}

async function main() {
  // Keep the wwebjs #201922 media hotfix in place — npm reinstalls wipe it.
  // The pin-diagnostics patch logs the served web build at every boot.
  const patchStatus = applyPatchSet(path.join(__dirname, '..'))
  const changed = patchStatus.filter((p) => p.status !== 'present')
  if (changed.length) {
    for (const p of changed) log.warn({ status: p.status, err: p.error }, 'WWebJS patch state changed')
  }

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
    console.error('Another wa-sender instance owns the delivery lease; exiting with code 1 for PM2 restart retry.')
    process.exit(1)
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
  const drainTimer = setInterval(() => { runDrainTick().catch((error) => console.error(`WhatsApp outbox drain tick failed: ${error.message}`)) }, 3000)
  const watchdogTimer = setInterval(() => {
    const ticks = [runTransportWatchdog(), maybeDeliveryAlert()]
    Promise.allSettled(ticks)
      .then(([watchdogResult, alertResult]) => {
        if (watchdogResult.status === 'rejected') console.error(`WhatsApp transport watchdog failed: ${watchdogResult.reason?.message}`)
        if (alertResult.status === 'rejected') console.error(`WA delivery alert tick failed: ${alertResult.reason?.message}`)
      })
  }, WATCHDOG_INTERVAL_MS)
  syncTimer.unref()
  drainTimer.unref()
  watchdogTimer.unref()

  // Post-boot evidence pass: after the stability window, log the newest
  // outgoing document the control chat acknowledges (fromMe + ack ≥ 0).
  // Answers "did the attempted delivery actually leave?" for incident
  // review without any extra tooling.
  const diagnosticDelayMs = 110000
  let diagnosticDone = false
  const runPostBootVerification = async (allowRearm = false) => {
    if (diagnosticDone) return
    diagnosticDone = true
    const whatsapp = require('./whatsapp')
    if (!whatsapp.isSendReady()) {
      diagnosticDone = false
      return // retried on the follow-up timer
    }
    const control = db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_number'").get()?.value || ''
    if (!control) return
    // Store hydration census — always printed so an empty scan can be
    // interpreted correctly (dead store vsLazy history never loaded).
    const snap = await whatsapp.storeSnapshot()
    if (snap.ok) {
      console.log(`WA store snapshot: ver=${snap.pageVersion || 'unknown'} require=${snap.requireExposed ? 1 : 0} WWebJS=${snap.wwebjsReady ? 1 : 0} storeKeys=${snap.storeKeyCount} my=${snap.me} chats=${snap.chats} globalMsgs=${snap.msgs} match=${(snap.storeKeys || []).join(',').slice(0, 160)}`)
      for (const r of (snap.newest || []).slice(-5).reverse()) {
        console.log(`  · global ${r.type || '?'} fromMe=${r.fromMe ? 1 : 0} ack=${r.ack} at ${new Date((r.t || 0) * 1000).toISOString()}`)
      }
    } else {
      console.log(`WA store snapshot: ${snap.reason}${snap.error ? ` — ${snap.error.slice(0, 120)}` : ''}`)
    }
    const verdict = await whatsapp.verifyDocumentDelivery(`${control.replace(/^\+/, '')}@c.us`, { limit: 60 })
    if (!verdict.ok) {
      const seen = (verdict.rows || []).slice(-8)
      console.log(`WA post-boot outgoing-doc check: ${verdict.reason} - ${verdict.inspected || 0} outgoing inspected${verdict.error ? ` — ${verdict.error.slice(0, 160)}` : ''}`)
      for (const r of seen.slice().reverse()) {
        console.log(`  · ${r.type || '?'} "${r.filename || ''}" ack=${r.ack} at ${new Date((r.at || 0) * 1000).toISOString()} → ${r.chat || '?'}`)
      }
      // Probe sends are opt-in now: a raw-store-less build turns every
      // diagnostic cycle into a visible message to the owner (observed Oct
      // 25 evening: two texts within a minute, no reply possible). Settings
      // key 'wa_store_probe' = 'on' re-enables; at most ONE probe text per
      // process boot either way.
      const probeEnabled = db.prepare("SELECT value FROM settings WHERE key='wa_store_probe'").get()?.value === 'on'
      if (probeEnabled && allowRearm && !verdict.inspected && !waProbeSentThisBoot) {
        waProbeSentThisBoot = true
        const controlJid = `${control.replace(/^\+/, '')}@c.us`
        try {
          await whatsapp.sendMessage(controlJid, 'رسالة فحص تلقائية للتأكد من مزامنة التخزين — لا حاجة للرد.')
          console.log('WA probe sent (store-sync test); rescanning in 25s')
        } catch (probeError) {
          console.log(`WA probe send failed: ${String(probeError?.message || probeError).slice(0, 140)}`)
        }
        setTimeout(async () => {
          try {
            const after = await whatsapp.verifyDocumentDelivery(controlJid, { limit: 30 })
            if (after.ok) {
              console.log(`WA store after probe: doc evidence found! msgId=${after.msgId} filename="${after.filename}" ack=${after.ack}`)
            } else {
              console.log(`WA store after probe: ${after.reason} - ${after.inspected || 0} outgoing inspected (rows below)`)
              for (const r of (after.rows || []).slice(-5).reverse()) {
                console.log(`  · ${r.type || '?'} "${r.filename || ''}" ack=${r.ack} at ${new Date((r.at || 0) * 1000).toISOString()} → ${r.chat || '?'}`)
              }
            }
          } catch (scanError) {
            console.log(`WA rescan after probe failed: ${scanError.message}`)
          }
        }, 25000)
      }
      // A cold boot hydrates message stores lazily — give it one more window.
      if (allowRearm) {
        diagnosticDone = false
        setTimeout(() => { runPostBootVerification(false).catch((error) => console.error(`post-boot doc check failed: ${error.message}`)) }, diagnosticDelayMs).unref()
      }
      return
    }
    const recent = (verdict.rows || []).filter((r) => r.type === 'document').slice(-5)
    if (!recent.length) return console.log(`WA post-boot outgoing-doc check: no outgoing documents in the scanned chats (${verdict.rows.length} messages inspected)`)
    console.log(`WA post-boot outgoing-doc check — newest outgoing documents (of ${verdict.rows.length} messages):`)
    for (const r of recent.slice().reverse()) {
      console.log(`  • "${r.filename || 'unnamed'}" ack=${r.ack} at ${new Date((r.at || 0) * 1000).toISOString()} → ${r.chat || '?'}`)
    }
  }
  setTimeout(() => { runPostBootVerification(true).catch((error) => console.error(`post-boot doc check failed: ${error.message}`)) }, diagnosticDelayMs)
  setTimeout(() => { runPostBootVerification(false).catch((error) => console.error(`post-boot doc check failed: ${error.message}`)) }, diagnosticDelayMs * 3).unref()

  // Make boot stalls visible: the auth event alone does NOT flip the send
  // lane — only `ready` does (clientReady). Log every 60s until ready,
  // and run the diagnostics the instant ready lands (fixed offsets have
  // already elapsed by the time a slow boot completes).
  let bootProgressTicks = 0
  const bootProgressTimer = setInterval(() => {
    const whatsappNow = require('./whatsapp')
    if (whatsappNow.isSendReady()) {
      clearInterval(bootProgressTimer)
      bootProgressTimer.unref()
      if (!diagnosticDone) {
        setTimeout(() => { runPostBootVerification(true).catch((error) => console.error(`post-boot doc check failed: ${error.message}`)) }, 15000)
      }
      return
    }
    bootProgressTicks += 1
    if (bootProgressTicks > 12) { clearInterval(bootProgressTimer); bootProgressTimer.unref(); return }
    console.log(`WA boot progress: not ready yet (auth seen, ${bootProgressTicks} ticks)`)
  }, 60000)
  bootProgressTimer.unref()

  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    clearInterval(heartbeatTimer)
    clearInterval(syncTimer)
    clearInterval(drainTimer)
    clearInterval(watchdogTimer)
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

  runDrainTick().catch((error) => console.error(`Initial drain tick failed: ${error.message}`))
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`WhatsApp sender startup failed: ${error.stack || error}`)
    process.exitCode = 1
  })
}

module.exports = { sendRow, transportNotReady, shouldStartClient, state, isCorruptionMessage, shouldHoldForBoot }
