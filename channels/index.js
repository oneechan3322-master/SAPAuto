'use strict'

const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const { getDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { pollTelegram, createTelegram } = require('./telegram')
const { startGmailPoller, sendGmail } = require('./gmail')
const { startEventDispatcher } = require('./events')
const secureStore = require('./secure-store')

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
    const whatsappEnabled = process.env.WHATSAPP_ENABLED === 'true' || pairingRequested
    if (whatsappEnabled && !whatsappClient && !whatsappStarting) {
      whatsappStarting = true
      try {
        const { startWhatsApp } = require('./whatsapp')
        whatsappClient = await startWhatsApp()
        providers.whatsapp = (to, text) => whatsappClient.sendMessage(to, text)
      } catch (error) {
        console.error(`WhatsApp connection could not start: ${error.message}`)
        if (pairingRequested) {
          db.prepare("DELETE FROM settings WHERE key='whatsapp_pair_requested'").run()
        }
      } finally {
        whatsappStarting = false
      }
    }
  }

  await syncProviders()
  const stopEvents = startEventDispatcher(providers, { db })
  const syncTimer = setInterval(() => {
    syncProviders().catch((error) => console.error(`Channel settings refresh failed: ${error.message}`))
  }, 15000)
  syncTimer.unref()
  const shutdown = async () => {
    controller.abort()
    clearInterval(syncTimer)
    telegramController?.abort()
    stopGmail?.()
    stopEvents()
    if (whatsappClient) await whatsappClient.destroy()
    await Promise.allSettled(tasks)
    db.close()
  }
  const handleSignal = () => shutdown().catch((error) => {
    console.error(`Channels shutdown failed: ${error.message}`)
    process.exitCode = 1
  })
  process.once('SIGINT', handleSignal)
  process.once('SIGTERM', handleSignal)
  return { shutdown }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Channels startup failed: ${error.stack || error}`)
    process.exitCode = 1
  })
}

module.exports = { main }
