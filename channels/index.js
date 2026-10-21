'use strict'

const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const { getDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { pollTelegram, createTelegram } = require('./telegram')
const { startGmailPoller, sendGmail } = require('./gmail')
const { startEventDispatcher } = require('./events')
const secureStore = require('./secure-store')
const { getChannelStatus } = require('../domain/channel-broker.cjs')
const { audit } = require('../db/queries/shared')
const { startHeartbeat: startServiceHeartbeat } = require('../lib/heartbeat')

async function main() {
  const db = getDatabase()
  runMigrations(db)
  const controller = new AbortController()
  const tasks = []
  const providers = {}
  let activeTelegramToken = ''
  let telegramController = null
  let activeGmailKey = ''
  let stopGmail = null
  let whatsappClient = null
  let whatsappStarting = false
  let whatsappLastAttemptAt = 0
  let whatsappPairRetries = 0

  async function upsertChannelRegistry(id, providerType, status, draftOnly, connectionPayloadRef, lastError) {
    const existing = db.prepare('SELECT id FROM channel_registry WHERE id = ?').get(id)
    const nowIso = new Date().toISOString()
    if (existing) {
      db.prepare(
        `UPDATE channel_registry SET provider_type = ?, status = ?, draft_only = ?,
           connection_payload_ref = ?, last_error = ?, updated_at = ?
         WHERE id = ?`
      ).run(providerType, status, draftOnly, connectionPayloadRef, lastError, nowIso, id)
    } else {
      db.prepare(
        `INSERT INTO channel_registry(id, provider_type, status, draft_only, connection_payload_ref,
           last_heartbeat_at, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`
      ).run(id, providerType, status, draftOnly, connectionPayloadRef, lastError, nowIso, nowIso)
    }
  }

  async function syncProviders() {
    const disconnectRequested = db.prepare("SELECT value FROM settings WHERE key='whatsapp_disconnect_requested'").get()?.value === 'true'
    if (disconnectRequested) {
      if (whatsappClient) {
        try { await whatsappClient.destroy() } catch { /* ignore */ }
        whatsappClient = null
      }
      delete providers.whatsapp
      db.prepare("DELETE FROM settings WHERE key IN ('whatsapp_disconnect_requested','whatsapp_connected','whatsapp_qr','whatsapp_pair_requested')").run()
      await upsertChannelRegistry('whatsapp-office-primary', 'whatsapp_web', 'unconfigured', 1, null, null)
    }
    const credentials = secureStore.readAll()
    const telegramToken = credentials.telegram?.token || process.env.TELEGRAM_BOT_TOKEN || ''
    if (telegramToken !== activeTelegramToken) {
      telegramController?.abort()
      delete providers.telegram
      telegramController = null
      activeTelegramToken = telegramToken
      if (telegramToken) {
        const telegram = createTelegram(telegramToken)
        providers.telegram = async (chatId, text) => telegram.api('sendMessage', { chat_id: chatId, text })
        telegramController = new AbortController()
        tasks.push(pollTelegram({ token: telegramToken, signal: telegramController.signal }))
      }
    }

    const gmail = credentials.gmail || {}
    const gmailUser = gmail.email || process.env.GMAIL_USER || ''
    const gmailPassword = gmail.password || process.env.GMAIL_APP_PASSWORD || ''
    const gmailKey = `${gmailUser}\u0000${gmailPassword}`
    if (gmailKey !== activeGmailKey) {
      stopGmail?.()
      stopGmail = null
      delete providers.email
      activeGmailKey = gmailKey
      if (gmailUser && gmailPassword) {
        process.env.GMAIL_USER = gmailUser
        process.env.GMAIL_APP_PASSWORD = gmailPassword
        providers.email = sendGmail
        stopGmail = startGmailPoller({ db })
      }
    }

    const pairingRequested = db.prepare("SELECT value FROM settings WHERE key='whatsapp_pair_requested'").get()?.value === 'true'
    // A paired WhatsApp session must be restored after a worker restart. The
    // old condition only started the client while pairing was requested, so a
    // database could say "connected" while no sender process existed.
    const registryStatus = db.prepare("SELECT status FROM channel_registry WHERE id='whatsapp-office-primary'").get()?.status || 'unconfigured'
    const whatsappConnected = db.prepare("SELECT value FROM settings WHERE key='whatsapp_connected'").get()?.value === 'true'
    const whatsappControlConfigured = Boolean(db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_number'").get()?.value)
    // A `disconnected` event belongs to the previous browser client. Leaving
    // that object in this worker prevents the pending pairing request from ever
    // creating a replacement client. Release it before evaluating the next
    // start; do not call logout here (logout removes LocalAuth files and can
    // collide with Chromium's still-closing lock file).
    if (whatsappClient && registryStatus === 'unhealthy' && !whatsappConnected) {
      try { await whatsappClient.destroy() } catch { /* the client is already closed */ }
      whatsappClient = null
      delete providers.whatsapp
    }
    // Restore an existing local session after restart, but never rely on its
    // stored connected flag to claim a usable sender before `ready` fires.
    // A configured control number is a standing instruction to restore the
    // local WhatsApp session. Previously an `unhealthy` state was terminal:
    // one transient Chromium failure stopped all future replies until someone
    // pressed Pair again, even though the authenticated local session existed.
    // `ready` remains the sole proof that sending is permitted.
    const whatsappEnabled = process.env.WHATSAPP_ENABLED === 'true' || pairingRequested || whatsappConnected || whatsappControlConfigured || registryStatus === 'connecting'
    // Flaky first handshakes must not kill the pairing window: retry with a
    // cooldown, keep the request armed for a bounded number of attempts, and
    // only then drop it to avoid a hot loop on a genuinely broken setup.
    const cooldownPassed = Date.now() - whatsappLastAttemptAt > 20000
    if (whatsappEnabled && !whatsappClient && !whatsappStarting && cooldownPassed) {
      whatsappStarting = true
      whatsappLastAttemptAt = Date.now()
      try {
        const whatsappChannel = require('./whatsapp')
        whatsappClient = await whatsappChannel.startWhatsApp()
        providers.whatsapp = (to, text) => whatsappChannel.sendMessage(to, text)
        whatsappPairRetries = 0
        // `startWhatsApp()` owns the state transition. In particular, do not
        // overwrite its later `ready` event with an untrue connecting state.
      } catch (error) {
        console.error(`WhatsApp connection could not start: ${error.message}`)
        await upsertChannelRegistry('whatsapp-office-primary', 'whatsapp_web', 'unhealthy', 1, null, error.message)
        if (pairingRequested) {
          whatsappPairRetries += 1
          if (whatsappPairRetries >= 5) {
            db.prepare("DELETE FROM settings WHERE key='whatsapp_pair_requested'").run()
          }
        }
      } finally {
        whatsappStarting = false
      }
    }
  }

  async function processOneChannelTest() {
    const command = db.prepare(`SELECT * FROM commands
      WHERE type='channel_test_message' AND status='queued'
      ORDER BY created_at ASC LIMIT 1`).get()
    if (!command) return
    const claimed = db.prepare(`UPDATE commands SET status='running',started_at=?
      WHERE id=? AND status='queued'`).run(new Date().toISOString(), command.id)
    if (!claimed.changes) return

    try {
      const payload = JSON.parse(command.payload || '{}')
      const channel = String(payload.channel || '')
      const recipient = String(payload.to || '').trim()
      const text = String(payload.text || '').trim()
      if (channel !== 'whatsapp') throw new Error('Only WhatsApp test delivery is supported')
      if (!/^\+?[1-9]\d{7,14}$/.test(recipient)) throw new Error('Test recipient must be an E.164 phone number')
      if (!text || text.length > 500) throw new Error('Test message must contain 1–500 characters')
      if (!providers.whatsapp) throw new Error('WhatsApp is not connected')

      const result = await providers.whatsapp(recipient, text)
      db.prepare(`UPDATE commands SET status='done',result=?,finished_at=? WHERE id=?`).run(
        JSON.stringify({ channel, messageId: result.messageId || null }), new Date().toISOString(), command.id
      )
      audit(db, {
        actorId: command.requested_by || 'system', action: 'channel.test.delivered',
        entityType: 'channel', entityId: channel, details: { commandId: command.id }
      })
    } catch (error) {
      db.prepare(`UPDATE commands SET status='failed',result=?,finished_at=? WHERE id=?`).run(
        String(error.message).slice(0, 500), new Date().toISOString(), command.id
      )
    }
  }

  async function processOneWakeDocument() {
    const command = db.prepare(`SELECT * FROM commands
      WHERE type='wake_send_document' AND status='queued'
      ORDER BY created_at ASC LIMIT 1`).get()
    if (!command) return
    const claimed = db.prepare(`UPDATE commands SET status='running',started_at=?
      WHERE id=? AND status='queued'`).run(new Date().toISOString(), command.id)
    if (!claimed.changes) return
    const fail = (message) => db.prepare(`UPDATE commands SET status='failed',result=?,finished_at=? WHERE id=?`)
      .run(String(message).slice(0, 500), new Date().toISOString(), command.id)
    try {
      const payload = JSON.parse(command.payload || '{}')
      const controlNumber = db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_number'").get()?.value || ''
      const wakeEnabled = db.prepare("SELECT value FROM settings WHERE key='whatsapp_wake_notifications'").get()?.value === 'true'
      if (!controlNumber || !wakeEnabled) throw new Error('WhatsApp control number is not configured')
      const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(String(payload.taskId || ''))
      if (!task) throw new Error('Document was not found')
      if (!task.pdf_path) throw new Error('This document has no PDF file')
      const digits = controlNumber.replace(/^\+/, '')
      const { resolveOfficialPdfDetails } = require('../assistant/document-title-resolver.cjs')
      let details
      try {
        details = await resolveOfficialPdfDetails({ task, db })
      } catch (_) {
        details = {
          caption: `${task.title}${task.deadline ? ` — الموعد ${task.deadline}` : ''}`,
          displayFilename: ''
        }
      }
      await require('./whatsapp').sendDocument(`${digits}@c.us`, task.pdf_path, details.caption, details.displayFilename)
      db.prepare(`UPDATE commands SET status='done',result=?,finished_at=? WHERE id=?`).run(
        JSON.stringify({ sent: true, taskId: task.id }), new Date().toISOString(), command.id
      )
      audit(db, {
        actorId: command.requested_by || 'system', action: 'wake.document.sent',
        entityType: 'task', entityId: task.id, details: { commandId: command.id }
      })
    } catch (error) {
      fail(error.message)
    }
  }

  await syncProviders()
  const stopEvents = startEventDispatcher(providers, { db })
  const stopServiceHeartbeat = startServiceHeartbeat('channels', {
    db,
    meta: () => ({
      whatsapp: Boolean(providers.whatsapp),
      telegram: Boolean(providers.telegram),
      email: Boolean(providers.email)
    })
  })
  const dailyDigest = require('./daily-digest')
  let digestBusy = false
  const digestTimer = setInterval(() => {
    if (digestBusy || !providers.whatsapp) return
    digestBusy = true
    dailyDigest.runDailyDigest(db, {
      sendMessage: (chatId, text) => require('./whatsapp').sendMessage(chatId, text),
      sendDocument: (chatId, filePath, caption, customFilename) => require('./whatsapp').sendDocument(chatId, filePath, caption, customFilename)
    }).catch((error) => console.error(`Daily digest failed: ${error.message}`))
      .finally(() => { digestBusy = false })
  }, 60000)
  digestTimer.unref()
  const syncTimer = setInterval(() => {
    syncProviders().catch((error) => console.error(`Channel settings refresh failed: ${error.message}`))
  }, 15000)
  syncTimer.unref()
  async function processOneWakeDocumentEmail() {
    const command = db.prepare(`SELECT * FROM commands
      WHERE type='wake_send_document_email' AND status='queued'
      ORDER BY created_at ASC LIMIT 1`).get()
    if (!command) return
    const claimed = db.prepare(`UPDATE commands SET status='running',started_at=?
      WHERE id=? AND status='queued'`).run(new Date().toISOString(), command.id)
    if (!claimed.changes) return
    const fail = (message) => db.prepare(`UPDATE commands SET status='failed',result=?,finished_at=? WHERE id=?`)
      .run(String(message).slice(0, 500), new Date().toISOString(), command.id)
    try {
      const payload = JSON.parse(command.payload || '{}')
      const recipient = String(payload.email || '').trim()
      if (!recipient) throw new Error('wake_send_document_email: email recipient is required in payload')
      const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(String(payload.taskId || ''))
      if (!task) throw new Error('Document was not found')
      if (!task.pdf_path) throw new Error('This document has no PDF file')
      const { resolveOfficialPdfDetails } = require('../assistant/document-title-resolver.cjs')
      let details
      try {
        details = await resolveOfficialPdfDetails({ task, db })
      } catch (_) {
        details = {
          officialTitle: task.title,
          company: task.account_key || '',
          caption: `${task.title}${task.deadline ? ` — الموعد ${task.deadline}` : ''}`,
          displayFilename: ''
        }
      }
      const subject = `${details.officialTitle}${details.company ? ` — ${details.company}` : ''}`
      const body = details.caption
      const { sendGmailDocument } = require('./gmail')
      await sendGmailDocument(recipient, task.pdf_path, {
        subject,
        body,
        filename: details.displayFilename
      })
      db.prepare(`UPDATE commands SET status='done',result=?,finished_at=? WHERE id=?`).run(
        JSON.stringify({ sent: true, taskId: task.id, recipient }), new Date().toISOString(), command.id
      )
      audit(db, {
        actorId: command.requested_by || 'system', action: 'wake.document.email.sent',
        entityType: 'task', entityId: task.id, details: { commandId: command.id, recipient }
      })
    } catch (error) {
      fail(error.message)
    }
  }

  const testDeliveryTimer = setInterval(() => {
    processOneChannelTest().catch((error) => console.error(`Channel test dispatch failed: ${error.message}`))
    processOneWakeDocument().catch((error) => console.error(`Wake document dispatch failed: ${error.message}`))
    processOneWakeDocumentEmail().catch((error) => console.error(`Wake document email dispatch failed: ${error.message}`))
  }, 1000)
  testDeliveryTimer.unref()
  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    controller.abort()
    clearInterval(syncTimer)
    clearInterval(testDeliveryTimer)
    clearInterval(digestTimer)
    stopServiceHeartbeat()
    telegramController?.abort()
    stopGmail?.()
    stopEvents()
    if (whatsappClient) {
      try { await whatsappClient.destroy() } catch { /* ignore */ }
      await upsertChannelRegistry('whatsapp-office-primary', 'whatsapp_web', 'unhealthy', 1, null, 'disconnected')
    }
    await Promise.allSettled(tasks)
    db.close()
  }
  const handleSignal = () => shutdown().catch((error) => {
    console.error(`Channels shutdown failed: ${error.message}`)
    process.exitCode = 1
  })
  process.once('SIGINT', handleSignal)
  process.once('SIGTERM', handleSignal)
  // Windows PM2 has no real signals; a graceful stop arrives as a message.
  process.on('message', (message) => { if (message === 'shutdown') handleSignal() })
  return { shutdown }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Channels startup failed: ${error.stack || error}`)
    process.exitCode = 1
  })
}

module.exports = { main, getChannelStatus }
