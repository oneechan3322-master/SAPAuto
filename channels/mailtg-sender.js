'use strict'

const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const { getDatabase, closeDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const outbox = require('./outbox')
const { createTelegram } = require('./telegram')
const secureStore = require('./secure-store')
const { log } = require('../lib/logger')

// Sender service for the telegram and email outbox channels (Opus5.5 §6.2
// transport split). The channels worker stays the INGESTION process (pollers,
// registry); all harm-facing delivery belongs here so a stuck send can never
// block polling, and vice versa. One lease guarantees a single sender.
//
// Claims are skipped per channel while that channel's credentials are missing
// (rows wait as pending). A failed send uses the outbox backoff ladder; the
// uncertainty lane (restore of 'sending' with an expired lease) is parked as
// 'uncertain' for an operator resend, never auto-retried.

const CREDENTIAL_RESYNC_MS = 30000
const DRAIN_INTERVAL_MS = 2000

const state = {
  lease: null,
  telegramToken: '',
  telegramClient: null,
  gmailUser: '',
  gmailPassword: '',
  hasEmailConfigured: false
}

function credentials() {
  return secureStore.readAll()
}

async function sendTelegram(recipient, payload) {
  if (!state.telegramClient) throw new Error('Telegram credentials are not configured')
  const result = await state.telegramClient.api('sendMessage', { chat_id: recipient, text: payload.text || '' })
  return { messageId: result?.message_id ? String(result.message_id) : null }
}

async function sendEmail(recipient, payload) {
  // Lazy require: gmail builds its SMTP transport per call anyway.
  const gmail = require('./gmail')
  if (payload.kind === 'document_email') {
    return gmail.sendGmailDocument(recipient, payload.filePath, {
      subject: payload.subject || 'SAPAuto V8',
      body: payload.body || '',
      filename: payload.displayFilename || ''
    })
  }
  return gmail.sendGmail(recipient, payload.text || '', payload.subject || 'SAPAuto V8')
}

async function drainTelegram() {
  if (!state.telegramClient) return
  const db = getDatabase()
  // claim() recovers expired leases and leases rows inside one transaction.
  await outbox.drain('telegram', sendTelegram, { batch: 10, gapMs: 300, db })
}

async function drainEmail() {
  if (!state.hasEmailConfigured) return
  const db = getDatabase()
  await outbox.drain('email', sendEmail, { batch: 10, gapMs: 300, db })
}

function syncCredentials() {
  let telegramToken = process.env.TELEGRAM_BOT_TOKEN || ''
  let gmail = { email: process.env.GMAIL_USER || '', password: process.env.GMAIL_APP_PASSWORD || '' }
  try {
    const stored = credentials()
    if (stored?.telegram?.token) telegramToken = stored.telegram.token
    if (stored?.gmail?.email) gmail = { email: stored.gmail.email, password: stored.gmail.password || gmail.password }
  } catch (error) {
    log.warn({ err: error.message }, 'secure-store credentials unavailable; using env only')
  }
  state.gmailUser = gmail.email
  state.gmailPassword = gmail.password
  state.hasEmailConfigured = Boolean(state.gmailUser && state.gmailPassword)
  if (telegramToken !== state.telegramToken) {
    state.telegramToken = telegramToken
    state.telegramClient = telegramToken ? createTelegram(telegramToken) : null
  }
}

async function main() {
  const db = getDatabase()
  runMigrations(db)

  const { startLease } = require('../lib/lease')
  const lease = startLease('mailtg-sender', {
    db,
    onLost: (error) => {
      console.error(`mailtg-sender delivery lease lost: ${error.message}`)
      process.exit(0)
    }
  })
  if (!lease.acquired) {
    console.error('Another mailtg-sender instance owns the delivery lease; this copy will not start.')
    return
  }
  state.lease = lease
  syncCredentials()

  const { writeHeartbeat } = require('../lib/heartbeat')
  const heartbeatMeta = () => ({
    telegram: Boolean(state.telegramClient),
    email: state.hasEmailConfigured,
    queue: outbox.outboxStats(db)
  })
  writeHeartbeat('mailtg-sender', { db, meta: heartbeatMeta() })
  const heartbeatTimer = setInterval(() => { writeHeartbeat('mailtg-sender', { db, meta: heartbeatMeta() }) }, 30000)
  heartbeatTimer.unref()

  const credTimer = setInterval(() => {
    try { syncCredentials() } catch (error) { console.error(`Credential resync failed: ${error.message}`) }
  }, CREDENTIAL_RESYNC_MS)
  credTimer.unref()

  const drainTimer = setInterval(() => {
    drainTelegram().catch((error) => console.error(`Telegram outbox drain failed: ${error.message}`))
    drainEmail().catch((error) => console.error(`Email outbox drain failed: ${error.message}`))
  }, DRAIN_INTERVAL_MS)
  drainTimer.unref()

  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    clearInterval(heartbeatTimer)
    clearInterval(credTimer)
    clearInterval(drainTimer)
    try { lease.stop() } catch { /* lease already released */ }
    state.telegramClient = null
    try { closeDatabase() } catch (error) {
      log.error({ err: error.message }, 'database close failed')
    }
    process.exit(0)
  }
  process.once('SIGINT', () => { shutdown() })
  process.once('SIGTERM', () => { shutdown() })
  // Windows PM2 has no real signals; a graceful stop arrives as a message.
  process.on('message', (message) => { if (message === 'shutdown') shutdown() })

  drainTelegram().catch(() => { /* rows wait for the next tick */ })
  drainEmail().catch(() => { /* rows wait for the next tick */ })
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`MailTG sender startup failed: ${error.stack || error}`)
    process.exitCode = 1
  })
}

module.exports = { sendTelegram, sendEmail }
