'use strict'

const path = require('node:path')
const { getDatabase } = require('../db/connect')
const { runAssistant } = require('../assistant/run')
const { boundedText } = require('../domain/bounded-text.cjs')
const { consumeLinkCode, linkedUser } = require('./link-codes')
// createConfirmation removed — scan_now is enqueued directly without a confirmation step
const { audit } = require('../db/queries/shared')
const { localDataRoot } = require('../assistant/paths.cjs')
const { handleIntent, parseScanRequest } = require('./whatsapp-intents')

let client = null
let clientReady = false
let pairingCodeRequested = false
const outgoingSent = new Set()
const OUTGOING_LIMIT = 500

// Every outbound message id is remembered so the self-account lane can
// distinguish our own replies from commands the Owner typed themselves.
function rememberOutgoing(result) {
  const serialized = result?.id?._serialized || result?.id?.id
  if (!serialized) return
  if (outgoingSent.size >= OUTGOING_LIMIT) {
    for (const first of outgoingSent) { outgoingSent.delete(first); break }
  }
  outgoingSent.add(serialized)
}

function setChannelRuntimeState(db, status, lastError = null) {
  const timestamp = new Date().toISOString()
  db.prepare(`INSERT INTO channel_registry(id,provider_type,status,draft_only,connection_payload_ref,last_heartbeat_at,last_error,created_at,updated_at)
    VALUES('whatsapp-office-primary','whatsapp_web',?,1,NULL,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status,draft_only=1,last_heartbeat_at=excluded.last_heartbeat_at,last_error=excluded.last_error,updated_at=excluded.updated_at`)
    .run(status, timestamp, lastError, timestamp, timestamp)
}

async function startWhatsApp() {
  let whatsapp
  try { whatsapp = require('whatsapp-web.js') }
  catch { throw new Error('WhatsApp is optional; install whatsapp-web.js locally before enabling it.') }
  const { Client, LocalAuth } = whatsapp
  const db = getDatabase()
  clientReady = false
  // A persisted `true` only proves an earlier process was connected. Every
  // startup must earn the live state again from this client's `ready` event.
  db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_connected','false',?)
    ON CONFLICT(key) DO UPDATE SET value='false',updated_at=excluded.updated_at`)
    .run(new Date().toISOString())
  const fs = require('node:fs')
  const executablePath = process.env.V8_WHATSAPP_BROWSER || (() => {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1246', 'chrome-win64', 'chrome.exe'),
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    ]
    return candidates.find((c) => fs.existsSync(c)) || undefined
  })()

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
    puppeteer: {
      headless: true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    }
  })
  client.on('qr', async (qr) => {
    const qrcode = require('qrcode')
    const dataUrl = await qrcode.toDataURL(qr)
    db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_qr',?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
      .run(dataUrl, new Date().toISOString())
    db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_connected','false',?)
      ON CONFLICT(key) DO UPDATE SET value='false',updated_at=excluded.updated_at`)
      .run(new Date().toISOString())
    setChannelRuntimeState(db, 'qr_ready')
    console.log('WhatsApp requires QR pairing; view it in Owner Settings.')
    // The Owner asked for phone-number pairing: request an 8-character code
    // for the configured control number. It refreshes automatically while
    // unpaired; the lounge listens to the 'code' event for the current value.
    const controlNumber = db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_number'").get()?.value || ''
    const controlDigits = controlNumber.replace(/^\+/, '')
    if (!pairingCodeRequested && controlDigits) {
      pairingCodeRequested = true
      try {
        const code = await client.requestPairingCode(controlDigits, true)
        if (code) {
          db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_pair_code',?,?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
            .run(String(code), new Date().toISOString())
          console.log(`WhatsApp pairing code for ${controlNumber}: ${code}`)
        }
      } catch (error) {
        pairingCodeRequested = false
        console.error(`WhatsApp pairing code request failed: ${error.message}`)
      }
    }
  })
  client.on('code', async (code) => {
    if (!code) return
    db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_pair_code',?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
      .run(String(code), new Date().toISOString())
    console.log(`WhatsApp pairing code refreshed: ${code}`)
  })
  client.on('authenticated', () => {
    clientReady = true
    db.prepare("DELETE FROM settings WHERE key='whatsapp_qr'").run()
    db.prepare("DELETE FROM settings WHERE key='whatsapp_pair_code'").run()
    db.prepare("DELETE FROM settings WHERE key='whatsapp_pair_requested'").run()
    db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_connected','true',?)
      ON CONFLICT(key) DO UPDATE SET value='true',updated_at=excluded.updated_at`)
      .run(new Date().toISOString())
    setChannelRuntimeState(db, 'connected')
    console.log('WhatsApp session authenticated and connected.')
  })
  client.on('auth_failure', (msg) => {
    console.error(`WhatsApp authentication failure: ${msg}`)
    db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_connected','false',?)
      ON CONFLICT(key) DO UPDATE SET value='false',updated_at=excluded.updated_at`)
      .run(new Date().toISOString())
    setChannelRuntimeState(db, 'unhealthy', String(msg || 'authentication failed').slice(0, 200))
  })
  client.on('ready', () => {
    clientReady = true
    db.prepare("DELETE FROM settings WHERE key='whatsapp_qr'").run()
    db.prepare("DELETE FROM settings WHERE key='whatsapp_pair_code'").run()
    db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_connected','true',?)
      ON CONFLICT(key) DO UPDATE SET value='true',updated_at=excluded.updated_at`)
      .run(new Date().toISOString())
    const accountNumber = String(client.info?.wid?.user || '').replace(/^\+/, '')
    const controlNumber = (db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_number'").get()?.value || '').replace(/^\+/, '')
    if (accountNumber) {
      db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_account_number',?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
        .run(`+${accountNumber}`, new Date().toISOString())
    }
    const selfAccount = Boolean(accountNumber) && accountNumber === controlNumber
    db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_self_account',?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
      .run(selfAccount ? 'true' : 'false', new Date().toISOString())
    setChannelRuntimeState(db, 'connected')
    db.prepare("DELETE FROM settings WHERE key='whatsapp_pair_requested'").run()
    audit(db, {
      actorId: 'system',
      action: 'channel.connected',
      entityType: 'channel',
      entityId: 'whatsapp'
    })
    console.log(`WhatsApp channel connected. Account: +${accountNumber}${selfAccount ? ' (self-account control lane active)' : ''}`)
  })
  client.on('disconnected', () => {
    clientReady = false
    db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_connected','false',?)
      ON CONFLICT(key) DO UPDATE SET value='false',updated_at=excluded.updated_at`)
      .run(new Date().toISOString())
    setChannelRuntimeState(db, 'unhealthy', 'disconnected')
    console.log('WhatsApp channel disconnected.')
  })
  client.on('message', async (message) => {
    console.log(`WA in: from=${message.from} to=${message.to || '-'} fromMe=${message.fromMe} type=${message.type || '-'} body=${String(message.body || '').slice(0, 40)}`)
    if (message.isStatus) return
    if (message.type === 'e2e_notification') return
    const controlNumber = db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_number'").get()?.value || ''
    const controlJid = controlNumber ? `${controlNumber.replace(/^\+/, '')}@c.us` : ''
    const selfMode = db.prepare("SELECT value FROM settings WHERE key='whatsapp_self_account'").get()?.value === 'true'
    // Commands the Owner types in the paired phone's own "Message Yourself"
    // chat always arrive as fromMe messages whose from and to are identical.
    // That lane must work no matter which number got paired, so the AI answers
    // even when the linked account differs from the configured control.
    const selfChat = Boolean(message.fromMe) && Boolean(message.from) && message.from === message.to
    // Newer WhatsApp builds may address a chat by an opaque @lid JID. Resolve
    // it through the contact record to the phone-number JID before the gates,
    // otherwise commands from the control number are silently dropped.
    let fromJid = message.from
    if (typeof fromJid === 'string' && fromJid.endsWith('@lid')) {
      // LID→PN resolution order matters: the store-backed mapping is the only
      // reliable source (address-book lookups for unsaved numbers come back
      // empty), then the contact record as a fallback.
      try {
        const [mapped] = await client.getContactLidAndPhone([fromJid])
        const digits = String(mapped?.pn || '').replace(/\D/g, '')
        if (digits) fromJid = `${digits}@c.us`
      } catch { /* fall through to the contact lookup */ }
      if (fromJid.endsWith('@lid')) {
        try {
          const contact = await message.getContact()
          const digits = String(contact?.number || '').replace(/\D/g, '')
          if (digits) fromJid = `${digits}@c.us`
        } catch { /* keep the raw JID when the lookup fails */ }
      }
    }
    if (message.type === 'chat') {
      console.log(`WA gate: raw=${message.from} resolved=${fromJid} control=${controlJid || '-'} selfChat=${selfChat}`)
    }
    let externalId
    if (selfMode || selfChat) {
      if (selfMode && !selfChat && (!controlJid || message.from !== controlJid)) return
      const serialized = message.id?._serialized || message.id?.id
      if (serialized && outgoingSent.has(serialized)) return
      externalId = selfChat ? message.from : controlJid
    } else {
      if (message.fromMe) return
      if (controlNumber && fromJid !== controlJid) return
      externalId = fromJid
    }
    const text = String(message.body || '').trim().slice(0, 4000)
    if (externalId.endsWith('@g.us')) {
      // Daily-digest control words. The Owner runs the pairing from INSIDE the
      // office group so the digest targets exactly that chat.
      const digestCommand = text.match(/^(تفعيل اليومية|إيقاف اليومية)$/i)
      if (!digestCommand) return
      try {
        const author = linkedUser('whatsapp', message.author || '', db)
        if (!author || (author.role !== 'Owner' && author.role !== 'Operator')) {
          rememberOutgoing(await message.reply('التفعيل متاح للمالك فقط بعد ربط واتسابه أولًا.'))
          return
        }
        if (digestCommand[1] === 'تفعيل اليومية') {
          db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('daily_digest_chat',?,?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
            .run(message.from, new Date().toISOString())
          db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('daily_digest_enabled','1',?)
            ON CONFLICT(key) DO UPDATE SET value='1',updated_at=excluded.updated_at`)
            .run(new Date().toISOString())
          audit(db, { actorId: author.userId, action: 'daily_digest.consent_granted', entityType: 'channel', entityId: message.from })
          rememberOutgoing(await message.reply('تم تفعيل التقرير اليومي هنا. سيصل كل جديد خلال الوقت المحدد.'))
          return
        }
        db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('daily_digest_enabled','0',?)
          ON CONFLICT(key) DO UPDATE SET value='0',updated_at=excluded.updated_at`)
          .run(new Date().toISOString())
        audit(db, { actorId: author.userId, action: 'daily_digest.consent_revoked', entityType: 'channel', entityId: message.from })
        rememberOutgoing(await message.reply('تم إيقاف التقرير اليومي.'))
        return
      } catch (digestError) {
        console.error(`Daily digest control failed: ${digestError.message}`)
        rememberOutgoing(await message.reply('تعذر تنفيذ أمر التقارير. حاول لاحقًا.'))
        return
      }
    }
    const code = text.match(/^link\s+(\d{6})\s*$/i)
    try {
      if (code) {
        const result = consumeLinkCode('whatsapp', externalId, code[1], db)
        rememberOutgoing(await message.reply(result ? 'تم ربط الحساب.' : 'رمز الربط غير صالح أو انتهت صلاحيته.'))
        return
      }
      const ownerRow = () => db.prepare("SELECT id AS userId,role,disabled FROM users WHERE role='Owner' AND disabled=0 ORDER BY createdAt LIMIT 1").get() || null
      const user = (selfChat ? ownerRow() : null) || linkedUser('whatsapp', externalId, db) || (() => {
        const configuredControl = db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_number'").get()?.value || ''
        const controlDigits = configuredControl.replace(/\D/g, '')
        const senderDigits = String(externalId || '').replace(/\D/g, '')
        if (controlDigits && senderDigits && senderDigits === controlDigits) {
          return ownerRow()
        }
        return null
      })()
      if (!user || user.disabled) {
        // Unknown chats are deliberately silent. A pairing code is accepted only
        // when the sender supplies it; incoming conversations must never trigger
        // unsolicited messages to contacts or groups.
        return
      }
      const scanRequest = parseScanRequest(text)
      if (scanRequest && user.role !== 'Viewer') {
        const { createCommand } = require('../db/queries/commands')
        const commandId = createCommand('scan_now', scanRequest, user.userId, db)
        const target = scanRequest.account ? ` للحساب ${scanRequest.account}` : ' لكل الحسابات المهيأة'
        rememberOutgoing(await message.reply(`✅ تم إرسال أمر الفحص${target}.\nجارٍ الاتصال ببوابة الضرائب — ستصلك رسالة بالنتيجة عند الانتهاء.\n🆔 ${commandId}`))
        // Poll for scan completion; send summary + PDFs when done (max 10 min)
        const replyTo = externalId
        const MAX_WAIT_MS = 10 * 60 * 1000
        const POLL_MS = 5000
        ;(async () => {
          const started = Date.now()
          while (Date.now() - started < MAX_WAIT_MS) {
            await new Promise((r) => setTimeout(r, POLL_MS))
            const cmd = db.prepare('SELECT status, result FROM commands WHERE id=?').get(commandId)
            if (!cmd || cmd.status === 'running' || cmd.status === 'queued') continue
            if (cmd.status === 'done') {
              let outcome
              try { outcome = JSON.parse(cmd.result || '{}') } catch { outcome = {} }
              const processed = outcome.processed ?? '?'
              const failed = outcome.failed ?? '?'
              const total = outcome.total ?? '?'
              await sendMessage(replyTo,
                `✅ اكتمل الفحص${target}:\n✔ تم: ${processed} / ${total} حساب${Number(failed) > 0 ? `\n❌ إخفاقات: ${failed}` : ''}`
              ).catch((e) => console.error(`WA scan-done reply failed: ${e.message}`))
              // Send PDFs for docs updated in the last 15 minutes
              if (client && clientReady) {
                const fs = require('node:fs')
                const { resolveOfficialPdfDetails } = require('../assistant/document-title-resolver.cjs')
                const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString()
                const fresh = db.prepare(
                  'SELECT * FROM tasks WHERE pdf_path IS NOT NULL AND updated_at >= ? ORDER BY updated_at DESC LIMIT 10'
                ).all(cutoff)
                for (const task of fresh) {
                  if (!task.pdf_path || !fs.existsSync(task.pdf_path)) continue
                  let details
                  try {
                    details = await resolveOfficialPdfDetails({ task, db })
                  } catch (_) {
                    details = {
                      caption: `📄 ${task.title}${task.deadline ? ` — الموعد ${task.deadline}` : ''}`,
                      displayFilename: ''
                    }
                  }
                  await sendDocument(replyTo, task.pdf_path, details.caption, details.displayFilename).catch(
                    (e) => console.error(`WA PDF dispatch failed (${task.id}): ${e.message}`)
                  )
                }
              }
            } else {
              let errMsg = String(cmd.result || 'خطأ غير معروف').slice(0, 300)
              await sendMessage(replyTo, `❌ فشل الفحص${target}:\n${errMsg}`)
                .catch((e) => console.error(`WA scan-fail reply failed: ${e.message}`))
            }
            break
          }
        })().catch((e) => console.error(`WA scan poller failed: ${e.message}`))
        return
      }
      // Simple owner requests are answered from the local SAPAuto record
      // first. This keeps wake summaries, dates, and owner-attached PDFs
      // reliable even while the model is occupied with a separate analysis.
      const directReply = await handleIntent({ text, message, db, user, runAssistant, sendDocument, replyTo: externalId })
      if (directReply) {
        rememberOutgoing(await message.reply(boundedText(String(directReply), 4000)))
        return
      }
      // The whole conversation goes through the assistant (thinking loop with
      // tools). Wake summaries for «hi»/«ما الجديد» are produced by the AI from
      // its own tools, not by canned scripts.
      const result = await runAssistant({ userId: user.userId, role: user.role, text })
      rememberOutgoing(await message.reply(boundedText(result.reply, 4000)))
    } catch (error) {
      console.error(`WhatsApp message failed: ${error.message}`)
      rememberOutgoing(await message.reply('تعذر تشغيل المساعد الآن. حاول بعد قليل أو راجع لوحة التحكم.'))
    }
  })
  try {
    await client.initialize()
  } catch (error) {
    // A failed handshake (e.g., "Execution context was destroyed") leaves a
    // live Chromium behind. Close it before rethrowing so the next pairing or
    // restart attempt starts from a clean profile instead of colliding with
    // the orphaned browser.
    try { await client.destroy() } catch { /* the browser may already be gone */ }
    client = null
    clientReady = false
    throw error
  }
  return client
}

/**
 * Send a WhatsApp message via the connected client.
 * Matches the channel-broker sendFn contract: returns {messageId}.
 * @param {string} to - E.164 phone number (e.g., +201012345678)
 * @param {string} text - Message body
 */
async function sendMessage(to, text) {
  if (!client || !clientReady) {
    throw new Error('WhatsApp client is not connected')
  }
  if (typeof to !== 'string' || !to.trim()) {
    throw new Error('WhatsApp recipient is required')
  }
  let chatId = to.trim()
  if (!chatId.endsWith('@c.us') && !chatId.endsWith('@g.us')) {
    const digits = chatId.replace(/\D/g, '')
    if (!digits) {
      throw new Error(`Invalid WhatsApp recipient: ${to}`)
    }
    chatId = `${digits}@c.us`
  }
  const result = await client.sendMessage(chatId, text)
  rememberOutgoing(result)
  if (!result) throw new Error('WhatsApp did not confirm the test delivery')
  return { messageId: result.id?._serialized || result.id?.id || null }
}

/**
 * Send a local file (PDF) into a chat or group with an optional caption and clean display filename.
 * Privacy orbit: only files under the V8 data directory may leave.
 */
async function sendDocument(chatId, filePath, caption = '', customFilename = '') {
  if (!client || !clientReady) throw new Error('WhatsApp client is not connected')
  if (typeof chatId !== 'string' || !chatId.trim()) throw new Error('WhatsApp document target is required')
  const resolved = path.resolve(filePath)
  const root = path.resolve(localDataRoot())
  const resolvedCmp = process.platform === 'win32' ? resolved.toLowerCase() : resolved
  const rootCmp = process.platform === 'win32' ? root.toLowerCase() : root
  if (!resolvedCmp.startsWith(rootCmp + path.sep) && resolvedCmp !== rootCmp) {
    throw new Error(`Document outside the allowed data root: ${resolved}`)
  }
  const whatsapp = require('whatsapp-web.js')
  const { MessageMedia } = whatsapp
  const media = MessageMedia.fromFilePath(resolved)
  if (customFilename && typeof customFilename === 'string') {
    const cleanName = customFilename.trim().replace(/[/\\?%*:|"<>]/g, '-')
    media.filename = cleanName.toLowerCase().endsWith('.pdf') ? cleanName : `${cleanName}.pdf`
  }
  const options = caption ? { caption: String(caption).slice(0, 1000) } : undefined
  const result = await client.sendMessage(chatId, media, options)
  rememberOutgoing(result)
  return { messageId: result?.id?.id || result?.id?._serialized || 'dispatched' }
}

module.exports = { startWhatsApp, sendMessage, sendDocument }
