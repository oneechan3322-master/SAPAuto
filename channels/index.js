'use strict'

const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const { getDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { pollTelegram, createTelegram } = require('./telegram')
const { startGmailPoller } = require('./gmail')
const { startEventDispatcher } = require('./events')
const outbox = require('./outbox')
const secureStore = require('./secure-store')
const { getChannelStatus } = require('../domain/channel-broker.cjs')
const { audit } = require('../db/queries/shared')
const { startHeartbeat: startServiceHeartbeat } = require('../lib/heartbeat')

// A sender process that stopped heartbeating must not silently accept queued
// command deliveries; the queue holds them until it returns.
function senderFresh(db, service, seconds = 180) {
  const row = db.prepare('SELECT last_heartbeat FROM service_status WHERE service=?').get(service)
  const at = row?.last_heartbeat
  return Boolean(at) && (Date.now() - Date.parse(at)) <= seconds * 1000
}

function queueReal(db, { eventId, channel, recipient, payload }) {
  return outbox.enqueue({ eventId, channel, recipient, payload, shadow: false }, db)
}

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

  async function syncProviders() {
    const credentials = secureStore.readAll()
    const telegramToken = credentials.telegram?.token || process.env.TELEGRAM_BOT_TOKEN || ''
    if (telegramToken !== activeTelegramToken) {
      telegramController?.abort()
      delete providers.telegram
      telegramController = null
      activeTelegramToken = telegramToken
      if (telegramToken) {
        const telegram = createTelegram(telegramToken)
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
        stopGmail = startGmailPoller({ db })
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
      if (!senderFresh(db, 'wa-sender')) throw new Error('WhatsApp sender service is not running')

      // Outbox cut-over (Opus5.5 §6.2): the wa-sender process is the only
      // deliverer, so the test message is queued durably and its later
      // delivery state lives in notification_outbox, not in this command.
      queueReal(db, {
        eventId: `channel-test-${command.id}`,
        channel,
        recipient,
        payload: { text, kind: 'channel_test', commandId: command.id }
      })
      db.prepare(`UPDATE commands SET status='done',result=?,finished_at=? WHERE id=?`).run(
        JSON.stringify({ channel, queued: true, outboxEventId: `channel-test-${command.id}` }), new Date().toISOString(), command.id
      )
      audit(db, {
        actorId: command.requested_by || 'system', action: 'channel.test.queued',
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
      if (!senderFresh(db, 'wa-sender')) throw new Error('WhatsApp sender service is not running')
      queueReal(db, {
        eventId: `wake-doc-${command.id}`,
        channel: 'whatsapp',
        recipient: `${digits}@c.us`,
        payload: {
          kind: 'document',
          taskId: task.id,
          pdfPath: task.pdf_path,
          caption: details.caption,
          displayFilename: details.displayFilename
        }
      })
      db.prepare(`UPDATE commands SET status='done',result=?,finished_at=? WHERE id=?`).run(
        JSON.stringify({ queued: true, taskId: task.id, outboxEventId: `wake-doc-${command.id}` }), new Date().toISOString(), command.id
      )
      audit(db, {
        actorId: command.requested_by || 'system', action: 'wake.document.queued',
        entityType: 'task', entityId: task.id, details: { commandId: command.id }
      })
    } catch (error) {
      fail(error.message)
    }
  }

  await syncProviders()
  const stopEvents = startEventDispatcher({}, { db })
  const stopServiceHeartbeat = startServiceHeartbeat('channels', {
    db,
    meta: () => ({
      outbox: outbox.outboxStats(db)
    })
  })
  const dailyDigest = require('./daily-digest')
  let digestBusy = false
  const digestTimer = setInterval(() => {
    if (digestBusy || !senderFresh(db, 'wa-sender')) return
    digestBusy = true
    // Delivery goes through the outbox: the sender process drains these rows.
    // The per-day event id makes digest reruns on the same day idempotent.
    const digestRunId = `daily-digest-${new Date().toISOString().slice(0, 10)}`
    dailyDigest.runDailyDigest(db, {
      sendMessage: (chatId, text) => queueReal(db, {
        eventId: digestRunId,
        channel: 'whatsapp',
        recipient: chatId,
        payload: { text, kind: 'daily_digest' }
      }),
      sendDocument: (chatId, filePath, caption, customFilename) => queueReal(db, {
        eventId: `${digestRunId}-${path.basename(String(filePath || 'document.pdf'))}`,
        channel: 'whatsapp',
        recipient: chatId,
        payload: { kind: 'document', pdfPath: filePath, caption, displayFilename: customFilename }
      })
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
      if (!senderFresh(db, 'mailtg-sender')) throw new Error('Email sender service is not running')
      queueReal(db, {
        eventId: `wake-doc-email-${command.id}`,
        channel: 'email',
        recipient,
        payload: {
          kind: 'document_email',
          taskId: task.id,
          filePath: task.pdf_path,
          subject,
          body,
          displayFilename: details.displayFilename
        }
      })
      db.prepare(`UPDATE commands SET status='done',result=?,finished_at=? WHERE id=?`).run(
        JSON.stringify({ queued: true, taskId: task.id, recipient, outboxEventId: `wake-doc-email-${command.id}` }), new Date().toISOString(), command.id
      )
      audit(db, {
        actorId: command.requested_by || 'system', action: 'wake.document.email.queued',
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
    // The WhatsApp client lives in the wa-sender process now; this worker has
    // nothing browser-related to close.
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
