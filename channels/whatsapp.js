'use strict'

const path = require('node:path')
const { getDatabase } = require('../db/connect')
const { runAssistant } = require('../assistant/run')
const { boundedText } = require('../domain/bounded-text.cjs')
const { consumeLinkCode, linkedUser } = require('./link-codes')
const ledger = require('../lib/delivery-ledger')
// createConfirmation removed — scan_now is enqueued directly without a confirmation step
const { audit } = require('../db/queries/shared')
const { localDataRoot } = require('../assistant/paths.cjs')
const { handleIntent, parseScanRequest } = require('./whatsapp-intents')
const { isSelfChatCommand } = require('../lib/wa-selfchat.cjs')
const {
  isOfficialReference,
  assertNoInternalLeak,
  getTruthBoundDeadline,
  resolveDocRef
} = require('../lib/wa-batch.cjs')

let client = null
let clientReady = false
let readyAtMs = 0
let authenticatedSeen = false
let pairingCodeRequested = false
const outgoingSent = new Set()
const OUTGOING_LIMIT = 500

const SEND_TEXT_TIMEOUT_MS = 45000
const SEND_DOCUMENT_TIMEOUT_MS = 180000
const PROBE_TIMEOUT_MS = 20000

// Page-level failures mean the embedded browser (its page or store) died, not
// that WhatsApp rejected one delivery. They must read as "transport not
// ready" so queued rows are deferred for free instead of burning backoff
// attempts against a browser that no longer exists (observed Oct 25: a page
// stayed 'connected' for 85 minutes while every send returned null).
const PAGE_LEVEL_PATTERNS = [
  /Execution context was destroyed/i,
  /Target closed/i,
  /Session closed/i,
  /Pages? are not found/i,
  /Protocol error/i,
  /getter must include an id property/i
]

function transportError(message) {
  const error = new Error(message)
  error.transportNotReady = true
  return error
}

function isPageLevelError(message) {
  const text = String(message || '')
  return PAGE_LEVEL_PATTERNS.some((pattern) => pattern.test(text))
}

/** Race a page round-trip against a hard deadline: a zombie page neither
 * resolves nor rejects, so every send must carry its own deadline. */
function withTimeout(invoke, ms, label) {
  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(transportError(`${label} after ${ms}ms`)), ms)
    if (timer && typeof timer.unref === 'function') timer.unref()
  })
  return Promise.race([Promise.resolve().then(invoke), timeout]).finally(() => clearTimeout(timer))
}

/** One guarded provider call: hard timeout, page-level classification, and a
 * non-null result guard (whatsapp-web.js resolves with undefined when the
 * page cannot answer). Returns the raw provider result. */
async function guardedSend(label, timeoutMs, invoke) {
  let result
  try {
    result = await withTimeout(invoke, timeoutMs, `${label} timed out`)
  } catch (error) {
    if (error?.transportNotReady !== true && isPageLevelError(error?.message)) {
      const tagged = transportError(String(error?.message || 'transport failure'))
      // The memoize-getter failure fires while building the message model
      // AFTER the upload already left the page — the doc/text may be
      // delivered (observed Oct 25: the outbox deferred into near-duplicate
      // documents every 30s). `unconfirmed` parks the row for review instead
      // of free retries; delivery verification can then close it as sent.
      if (/getter must include an id property/i.test(String(error?.message || ''))) {
        tagged.unconfirmed = true
      }
      throw tagged
    }
    throw error
  }
  if (!result || !result.id) {
    // No confirmation is NOT a transport outage: WhatsApp may have accepted
    // the delivery (observed: a zombie page sent everything, reported
    // nothing). `unconfirmed` parks the outbox row as 'uncertain' so a never
    // duplicates on auto-retry.
    const error = transportError(`${label} returned no confirmation (page zombie or still booting)`)
    error.unconfirmed = true
    throw error
  }
  return result
}

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

const ASSISTANT_TIMEOUT_MS = 30000
const DOWN_WHISPER_WINDOW_MS = 10 * 60 * 1000

// Dual-reply fallback (plan §3 v1.2): message.reply preserves the exact chat
// (including @lid forms). When it throws — the silent lid-media path — fall
// back to a DIRECT send, but only to a resolver-verified phone-number JID
// (lib/wa-jid.cjs). Never invent recipients from lid digits; skip instead.
async function replyWithFallback(message, text) {
  const bounded = boundedText(String(text || ''), 4000)
  try {
    const result = await message.reply(bounded)
    rememberOutgoing(result)
    return result
  } catch (replyError) {
    console.error(`WhatsApp message.reply failed → direct send fallback: ${replyError.message}`)
    try {
      const resolved = await require('../lib/wa-jid.cjs').resolveCanonicalJid(message?.from, message, client)
      if (resolved && !resolved.endsWith('@lid')) {
        return await sendMessage(resolved, bounded)
      }
      console.error(`WhatsApp reply fallback skipped (unresolved lid): ${message?.from || '-'}`)
    } catch (fallbackError) {
      console.error(`WhatsApp reply fallback failed: ${fallbackError.message}`)
    }
    return null
  }
}

function setChannelRuntimeState(db, status, lastError = null) {
  const timestamp = new Date().toISOString()
  db.prepare(`INSERT INTO channel_registry(id,provider_type,status,draft_only,connection_payload_ref,last_heartbeat_at,last_error,created_at,updated_at)
    VALUES('whatsapp-office-primary','whatsapp_web',?,1,NULL,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status,draft_only=1,last_heartbeat_at=excluded.last_heartbeat_at,last_error=excluded.last_error,updated_at=excluded.updated_at`)
    .run(status, timestamp, lastError, timestamp, timestamp)
}

function getAuthorizedControlJids(db) {
  const single = db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_number'").get()?.value || ''
  const multi = db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_numbers'").get()?.value || ''
  const channels = db.prepare("SELECT external_id FROM user_channels WHERE channel='whatsapp'").all().map((r) => r.external_id)
  const set = new Set(channels)
  const combined = `${single},${multi}`
  for (const part of combined.split(/[,\s;|]+/)) {
    const digits = part.replace(/\D/g, '')
    if (digits.length >= 8) {
      set.add(`${digits}@c.us`)
    }
  }
  return set
}

/** Resolves an opaque @lid JID to the canonical phone-number JID using this
 * module's live client; documents the shared lib keeps the same order:
 * store-backed mapping first, contact record second. Never throws. */
async function resolveCanonicalJid(rawJid, message) {
  return require('../lib/wa-jid.cjs').resolveCanonicalJid(rawJid, message, client, getDatabase())
}

async function startWhatsApp() {
  let whatsapp
  try { whatsapp = require('whatsapp-web.js') }
  catch { throw new Error('WhatsApp is optional; install whatsapp-web.js locally before enabling it.') }
  const { Client, LocalAuth } = whatsapp
  const db = getDatabase()
  clientReady = false
  authenticatedSeen = false
  // A persisted `true` only proves an earlier process was connected. Every
  // startup must earn the live state again from this client's `ready` event.
  db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_connected','false',?)
    ON CONFLICT(key) DO UPDATE SET value='false',updated_at=excluded.updated_at`)
    .run(new Date().toISOString())
  const fs = require('node:fs')
  const executablePath = process.env.V8_WHATSAPP_BROWSER || (() => {
    const candidates = []
    const playwrightDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
    if (fs.existsSync(playwrightDir)) {
      try {
        const chromiumDirs = fs.readdirSync(playwrightDir)
          .filter((d) => d.startsWith('chromium-'))
          .sort()
          .reverse()
        for (const dir of chromiumDirs) {
          candidates.push(path.join(playwrightDir, dir, 'chrome-win64', 'chrome.exe'))
        }
      } catch (_) {}
    }
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    )
    return candidates.find((c) => fs.existsSync(c)) || undefined
  })()

  // Pin the WhatsApp web build: the app update to 2.3000.1047775310 broke
  // nearly every WWebJS binding on the live build (empty window.Store, media
  // sends dying with getter errors, ready hangs). The pinned archive build
  // (one build BELOW the breaking bump) restores the bindings.
  const rawWebVer = db.prepare("SELECT value FROM settings WHERE key='wa_web_version'").get()?.value
  const pinnedWebVersion = (!rawWebVer || rawWebVer === 'live') ? '2.3000.1047769893-alpha' : String(rawWebVer)
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
    webVersion: pinnedWebVersion,
    webVersionCache: {
      type: 'local',
      path: path.join(__dirname, '..', 'data', 'wa-web-cache')
    },
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
    // Only request phone-number pairing code if explicitly requested by settings.
    // Calling requestPairingCode during QR scan invalidates the QR immediately,
    // which causes the phone to show "pending" and disappear right away.
    const phonePairRequested = db.prepare("SELECT value FROM settings WHERE key='whatsapp_phone_pair_requested'").get()?.value === 'true'
    const controlNumber = db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_number'").get()?.value || ''
    const controlDigits = controlNumber.replace(/^\+/, '')
    if (phonePairRequested && !pairingCodeRequested && controlDigits) {
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
    // `authenticated` only proves the persisted session was accepted; the page
    // has not finished bootstrapping and sends issued right after it silently
    // no-op (observed: outbox attempt-2 fired seconds after this event and
    // resolved null). `clientReady` flips on `ready` instead.
    authenticatedSeen = true
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
    readyAtMs = Date.now()
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
    authenticatedSeen = false
    db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_connected','false',?)
      ON CONFLICT(key) DO UPDATE SET value='false',updated_at=excluded.updated_at`)
      .run(new Date().toISOString())
    setChannelRuntimeState(db, 'unhealthy', 'disconnected')
    console.log('WhatsApp channel disconnected.')
  })
  // The library emits 'message_create' for EVERY message and skips fromMe
  // messages in 'message' (Client.js: `if (msg.id.fromMe) return;` before
  // MESSAGE_RECEIVED). Commands typed in the paired phone's own "Message
  // Yourself" chat therefore arrive ONLY through 'message_create'. One
  // handler serves both events; the id lens below absorbs the duplicate the
  // two events produce for each received chat message.
  const handledInbound = new Set()
  const HANDLED_INBOUND_LIMIT = 400
  const handleIncomingMessage = async (message) => {
    const serialized = message?.id?._serialized || message?.id?.id
    if (serialized) {
      if (handledInbound.has(serialized)) return
      handledInbound.add(serialized)
      if (handledInbound.size > HANDLED_INBOUND_LIMIT) {
        for (const first of handledInbound) { handledInbound.delete(first); break }
      }
    }
    // Bot-outgoing loopback: every send registers through rememberOutgoing
    // while the result resolves, so outgoing ids can never re-enter as
    // commands (this lens catches the residual event-before-registration
    // race inside the self-account branch as well).
    if (serialized && outgoingSent.has(serialized)) return
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
    // Message-Yourself detection across classic and restructured builds:
    // strict from===to, digit-equal peer forms, or the mixed c.us/@lid shape.
    // The linked account digits come from client.info; booleans only, so a
    // half-booted client.info must never throw here.
    const selfChat = isSelfChatCommand(message, client?.info?.wid?.user)
    // Newer WhatsApp builds may address a chat by an opaque @lid JID. Resolve
    // it through the contact record to the phone-number JID before the gates,
    // otherwise commands from the control number are silently dropped.
    let fromJid = message.from
    if (typeof fromJid === 'string' && fromJid.endsWith('@lid')) {
      fromJid = await resolveCanonicalJid(fromJid, message)
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
      const authorizedJids = getAuthorizedControlJids(db)
      if (authorizedJids.size > 0 && !authorizedJids.has(fromJid) && !authorizedJids.has(message.from)) return
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
      const authorizedJids = getAuthorizedControlJids(db)
      const isAuthorizedSender = authorizedJids.has(fromJid) || authorizedJids.has(message.from) || authorizedJids.has(externalId)
      const user = (selfChat ? ownerRow() : null) ||
        linkedUser('whatsapp', externalId, db) ||
        (isAuthorizedSender ? ownerRow() : null) || (() => {
          const configuredControl = db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_number'").get()?.value || ''
          const multiControl = db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_numbers'").get()?.value || ''
          const allControlDigits = `${configuredControl},${multiControl}`.split(/[,\s;|]+/).map(n => n.replace(/\D/g, '')).filter(Boolean)
          const senderDigits = String(externalId || message.from || '').replace(/\D/g, '')
          if (senderDigits && allControlDigits.some(d => senderDigits === d || senderDigits.endsWith(d) || d.endsWith(senderDigits))) {
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
        const { resolveCompanyName, resolveAccountKeysForFilter } = require('./whatsapp-intents')
        
        let targetAccount = scanRequest.account || ''
        let displayCompany = ''
        if (targetAccount) {
          displayCompany = resolveCompanyName(targetAccount, db)
          const cand = resolveAccountKeysForFilter(targetAccount, db)
          if (cand.length && cand[0] !== targetAccount) {
            targetAccount = cand[0]
          }
        }
        const targetLabel = displayCompany ? ` لشركة: *${displayCompany}*` : (targetAccount ? ` للحساب: \`${targetAccount}\`` : ' لكل الشركات المسجلة')
        const commandId = createCommand('scan_now', { account: targetAccount }, user.userId, db)
        rememberOutgoing(await message.reply(`🔍 تم إصدار أمر الفحص${targetLabel}.\nجارٍ الاتصال ببوابة مصلحة الضرائب — ستصلك رسالة بالنتيجة والمستندات عند الانتهاء.\n🆔 \`${commandId}\``))
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
                `✅ *اكتمل الفحص الضريبي${targetLabel}:*\n✔ تم فحص: *${processed}* من أصل *${total}* شركة${Number(failed) > 0 ? `\n❌ إخفاقات: ${failed}` : ''}`
              ).catch((e) => console.error(`WA scan-done reply failed: ${e.message}`))
              // Send PDFs for docs updated in the last 15 minutes
              if (client && clientReady) {
                const fs = require('node:fs')
                const { resolveOfficialPdfDetails, sanitizeFilename } = require('../assistant/document-title-resolver.cjs')
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
                      officialTitle: task.title,
                      company: '',
                      displayFilename: ''
                    }
                  }
                  const compName = resolveCompanyName(task.account_key, db) || details.company || ''
                  const title = details.officialTitle || task.title
                  const refInfo = resolveDocRef(task, compName)
                  const safeComp = typeof sanitizeFilename === 'function' ? sanitizeFilename(compName, 50) : compName
                  const safeTitle = typeof sanitizeFilename === 'function' ? sanitizeFilename(title, 60) : title
                  const displayFilename = safeComp ? `${safeTitle} — ${safeComp}.pdf` : `${safeTitle}.pdf`
                  const deadlineBadge = getTruthBoundDeadline(task)
                  const richCaption = [
                    `📄 *${title}*`,
                    compName ? `🏢 *المنشأة:* *${compName}*` : '',
                    refInfo.docRefDisplay ? `📋 *رقم المستند:* \`${refInfo.docRefDisplay}\`` : '',
                    deadlineBadge,
                    '────────────────────────────',
                    refInfo.tipText
                  ].filter(Boolean).join('\n')

                  // Card T0.3 Pre-send gate
                  assertNoInternalLeak(richCaption)

                  await sendDocument(replyTo, task.pdf_path, richCaption, displayFilename).catch(
                    (e) => console.error(`WA PDF dispatch failed (${task.id}): ${e.message}`)
                  )
                }
              }
            } else {
              let errMsg = String(cmd.result || 'خطأ غير معروف').slice(0, 300)
              await sendMessage(replyTo, `❌ فشل الفحص${targetLabel}:\n${errMsg}`)
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
      let directReply
      const canonicalTarget = (externalId && externalId.endsWith('@c.us')) ? externalId : ((fromJid && fromJid.endsWith('@c.us')) ? fromJid : (externalId || message.from))
      try {
        delete require.cache[require.resolve('./whatsapp-intents')]
        const dynamicIntents = require('./whatsapp-intents')
        directReply = await dynamicIntents.handleIntent({ text, message, db, user, runAssistant, sendDocument, replyTo: canonicalTarget })
      } catch (intentErr) {
        console.error(`Dynamic handleIntent error: ${intentErr.message}`)
        try {
          directReply = await handleIntent({ text, message, db, user, runAssistant, sendDocument, replyTo: canonicalTarget })
        } catch (staticIntentErr) {
          console.error(`Static handleIntent error: ${staticIntentErr.message}`)
          await replyWithFallback(message, `❌ تعذر تنفيذ أمر التحكم: ${staticIntentErr.message}\nأرسل «مساعدة» لعرض الأوامر المتاحة.`)
          return
        }
      }
      if (directReply) {
        await replyWithFallback(message, String(directReply))
        return
      }

      // The whole conversation goes through the assistant (thinking loop with
      // tools) — but strictly bounded: a stalled local model can never hold
      // the reply lane hostage (plan §3 v1.2: hard 30s race, then a graceful
      // timeout note with direct-command shortcuts).
      try {
        const result = await Promise.race([
          runAssistant({ userId: user.userId, role: user.role, text }),
          new Promise((_, reject) => setTimeout(() => {
            const stall = new Error(`assistant stalled beyond ${ASSISTANT_TIMEOUT_MS}ms`)
            stall.code = 'ETIMEDOUT'
            reject(stall)
          }, ASSISTANT_TIMEOUT_MS))
        ]).catch((raceError) => {
          if (raceError.code === 'ETIMEDOUT') {
            console.error(`WhatsApp assistant timeout: ${raceError.message}`)
            return {
              reply: '⏱️ المساعد الذكي استغرق أطول من 30 ثانية — أرسل السؤال مرة أخرى، أو استخدم أوامر مباشرة مثل `tasks` و`pdf` و`تفاصيل <رقم>`.'
            }
          }
          throw raceError
        })
        await replyWithFallback(message, result.reply)
      } catch (assistantError) {
        console.error(`WhatsApp assistant failed: ${assistantError.message}`)
        const nowMs = Date.now()
        let whisper = {}
        try {
          whisper = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='assistant_down_whisper'").get()?.value || '{}')
        } catch { whisper = {} }
        const lastWhisper = Number(whisper[externalId] || 0)
        if (nowMs - lastWhisper < DOWN_WHISPER_WINDOW_MS) {
          console.log(`WA assistant-down whisper throttled for ${externalId}`)
          return
        }
        whisper[externalId] = nowMs
        const pruned = {}
        for (const [chatKey, atMs] of Object.entries(whisper)) {
          if (nowMs - Number(atMs) < DOWN_WHISPER_WINDOW_MS * 6) pruned[chatKey] = atMs
        }
        db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('assistant_down_whisper',?,?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
          .run(JSON.stringify(pruned), new Date().toISOString())

        // Honest Arabic failure reason + instant direct commands; unicode
        // escapes keep this file byte-safe on hosts whose editors mangle
        // raw Arabic literal writing.
        let rootReason = '\u062E\u062F\u0645\u0629 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A (\u0627\u0644\u0645\u0648\u062F\u064A\u0644 \u0627\u0644\u0645\u062D\u0644\u064A) \u0644\u0627 \u062A\u0633\u062A\u062C\u064A\u0628'
        const lowerErr = String(assistantError.message || '').toLowerCase()
        if (lowerErr.includes('econnrefused') || lowerErr.includes('fetch failed') || lowerErr.includes('network')) {
          rootReason = '\u062E\u062F\u0645\u0629 \u0627\u0644\u0645\u0648\u062F\u064A\u0644 \u0627\u0644\u0645\u062D\u0644\u064A (llama-server) \u063A\u064A\u0631 \u0645\u062A\u0635\u0644\u0629 \u0623\u0648 \u0645\u062A\u0648\u0642\u0641\u0629 \u062D\u0627\u0644\u064A\u0627\u064B'
        } else if (lowerErr.includes('timeout') || lowerErr.includes('etimedout')) {
          rootReason = '\u0627\u0633\u062A\u063A\u0631\u0642 \u0627\u0644\u0645\u0648\u062F\u064A\u0644 \u0648\u0642\u062A\u0627\u064B \u0623\u0637\u0648\u0644 \u0645\u0646 \u0627\u0644\u0645\u0633\u0645\u0648\u062D (\u0645\u0647\u0644\u0629 \u0645\u0639\u0627\u0644\u062C\u0629)'
        } else if (lowerErr.includes('memory') || lowerErr.includes('ram') || lowerErr.includes('out of memory')) {
          rootReason = '\u0646\u0641\u0627\u062F \u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u0633\u064A\u0631\u0641\u0631 \u0623\u062B\u0646\u0627\u0621 \u0645\u062D\u0627\u0648\u0644\u0629 \u0627\u0644\u0645\u0639\u0627\u0644\u062C\u0629'
        } else if (lowerErr.includes('busy') || lowerErr.includes('locked')) {
          rootReason = '\u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0645\u0634\u063A\u0648\u0644\u0629 \u0645\u0624\u0642\u062A\u0627\u064B \u0628\u0639\u0645\u0644\u064A\u0629 \u0623\u062E\u0631\u0649'
        }
        const failSafeReport = [
          '\u26A0\uFE0F \u062A\u0639\u0630\u0631 \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0645\u0633\u0627\u0639\u062F \u0627\u0644\u0622\u0646.',
          `\u{1F50D} *\u0627\u0644\u0633\u0628\u0628:* \${rootReason}`,
          `\u{1F6E1}\uFE0F *\u0646\u0638\u0627\u0645 \u0627\u0644\u0637\u0648\u0627\u0631\u0626 (Fail-Safe) \u0646\u0634\u0637 - \u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u062A\u062D\u0643\u0645 \u0627\u0644\u0645\u0628\u0627\u0634\u0631\u0629 \u0627\u0644\u0645\u062A\u0627\u062D\u0629 \u0627\u0644\u0622\u0646:*`,
          '\u2022 `tasks` \u0623\u0648 `\u0627\u0644\u0645\u0647\u0627\u0645`: \u0639\u0631\u0636 \u0627\u0633\u062A\u0647\u0644\u0627\u0643 \u0627\u0644\u0631\u0627\u0645 \u0648\u0645\u062F\u064A\u0631 \u0627\u0644\u0645\u0647\u0627\u0645',
          '\u2022 `rdp` \u0623\u0648 `\u0631\u064A\u0645\u0648\u062A`: \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0639\u0646 \u0628\u0639\u062F \u0628\u0633\u0637\u062D \u0627\u0644\u0645\u0643\u062A\u0628',
          '\u2022 `stop llm`: \u0625\u064A\u0642\u0627\u0641 \u062E\u062F\u0645\u0629 \u0627\u0644\u0645\u0648\u062F\u064A\u0644 \u0641\u0648\u0631\u0627\u064B \u0644\u062A\u0641\u0631\u064A\u063A \u0627\u0644\u0631\u0627\u0645',
          '\u2022 `stop all`: \u0625\u064A\u0642\u0627\u0641 \u0643\u0627\u0641\u0629 \u0627\u0644\u062E\u062F\u0645\u0627\u062A \u0627\u0644\u062B\u0642\u064A\u0644\u0629 \u0628\u0627\u0644\u0633\u064A\u0631\u0641\u0631',
          '\u2022 `restart all`: \u0625\u0639\u0627\u062F\u0629 \u062A\u0634\u063A\u064A\u0644 \u062E\u062F\u0645\u0627\u062A \u0627\u0644\u0633\u064A\u0631\u0641\u0631 \u0628\u0627\u0644\u0643\u0627\u0645\u0644',
          '\u2022 `\u0641\u062D\u0635` \u0623\u0648 `scan`: \u0633\u062D\u0628 \u0627\u0644\u0636\u0631\u0627\u0626\u0628 \u0644\u062C\u0645\u064A\u0639 \u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A \u0627\u0644\u0645\u0647\u064A\u0623\u0629',
          '\u2022 `pdf`: \u0627\u0633\u062A\u0644\u0627\u0645 \u0623\u062D\u062F\u062B \u0645\u0633\u062A\u0646\u062F\u0627\u062A \u0627\u0644\u0636\u0631\u0627\u0626\u0628',
          '\u2022 `\u0645\u0633\u0627\u0639\u062F\u0629`: \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u0643\u0627\u0645\u0644\u0629'
        ].filter(Boolean).join('\n')

        await replyWithFallback(message, failSafeReport)
      }
    } catch (error) {
      console.error(`WhatsApp message failed: ${error.message}`)
      const safeErr = [
        '\u26A0\uFE0F \u062D\u062F\u062B \u062E\u0637\u0623 \u0623\u062B\u0646\u0627\u0621 \u0645\u0639\u0627\u0644\u062C\u0629 \u0627\u0644\u0631\u0633\u0627\u0644\u0629.',
        `\u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644: \${String(error.message || '').slice(0, 200)}`,
        '\u0623\u0631\u0633\u0644 `tasks` \u0644\u0645\u0639\u0627\u064A\u0646\u0629 \u062D\u0627\u0644\u0629 \u0627\u0644\u0633\u064A\u0631\u0641\u0631 \u0623\u0648 `restart all` \u0644\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u062A\u0634\u063A\u064A\u0644.'
      ].join('\n')
      try {
        await replyWithFallback(message, safeErr)
      } catch (_) {}
    }
  }
  client.on('message', (message) => { handleIncomingMessage(message).catch((error) => console.error(`WA handler error: ${error.message}`)) })
  client.on('message_create', (message) => { handleIncomingMessage(message).catch((error) => console.error(`WA handler error: ${error.message}`)) })
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
  if (client.pupBrowser) {
    client.pupBrowser.on('disconnected', () => {
      console.error('Chromium browser disconnected unexpectedly. Marking client unready.')
      clientReady = false
      readyAtMs = 0
      try { setChannelRuntimeState(getDatabase(), 'unhealthy', 'browser disconnected') } catch { /* db closed */ }
    })
  }
  if (client.pupPage) {
    const markPageGone = (why) => {
      console.error(`WhatsApp Chromium page ${why}. Resetting clientReady.`)
      clientReady = false
      readyAtMs = 0
      try { setChannelRuntimeState(getDatabase(), 'unhealthy', `page ${why}`) } catch { /* db closed */ }
    }
    client.pupPage.on('close', () => markPageGone('closed'))
    client.pupPage.on('error', (err) => {
      console.error(`WhatsApp page crash/error: ${err?.message || err}`)
      clientReady = false
      readyAtMs = 0
      try { setChannelRuntimeState(getDatabase(), 'unhealthy', `page error: ${String(err?.message || err).slice(0, 200)}`) } catch { /* db closed */ }
    })
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
  try {
    const result = await guardedSend(`WhatsApp text send to ${chatId}`, SEND_TEXT_TIMEOUT_MS, () => {
      const active = client
      if (!active) throw new Error('WhatsApp client is not connected')
      return active.sendMessage(chatId, text)
    })
    rememberOutgoing(result)
    ledger.record({ service: 'wa-sender', lane: 'direct', channel: 'whatsapp', recipient: chatId, kind: 'text', status: 'sent', providerMsgId: result.id._serialized || result.id?.id || null })
    return { messageId: result.id._serialized || result.id?.id || null }
  } catch (error) {
  // Unconfirmed null-resolves and hard failures still leave an audit row: the
  // direct lane previously vanished without a trace (October 25 incident).
  if (!(error?.message || '').startsWith('WhatsApp client is not connected')) {
    ledger.record({
      service: 'wa-sender', lane: 'direct', channel: 'whatsapp', recipient: chatId, kind: 'text',
      status: error?.unconfirmed === true ? 'uncertain' : 'failed', error: error?.message
    })
  }
  throw error
}
}

/**
 * Send a local file (PDF) into a chat or group with an optional caption and clean display filename.
 * Privacy orbit: only files under the V8 data directory may leave.
 */
async function sendDocument(chatId, filePath, caption = '', customFilename = '') {
  if (!client || !clientReady) throw new Error('WhatsApp client is not connected')
  if (typeof chatId !== 'string' || !chatId.trim()) throw new Error('WhatsApp document target is required')
  
  // Media dispatch guard (plan §5.1): WhatsApp Web cannot memoize documents
  // for @lid targets. Target MUST be the canonical @c.us phone JID.
  if (chatId.endsWith('@lid')) {
    try {
      const waJid = require('../lib/wa-jid.cjs')
      const canonical = await waJid.resolveCanonicalJid(chatId, null, client, getDatabase())
      if (canonical && !canonical.endsWith('@lid')) {
        console.log(`[sendDocument] Redirected @lid target from ${chatId} -> ${canonical}`)
        chatId = canonical
      }
    } catch (_) {}
  }

  let resolved = path.resolve(filePath)
  const root = path.resolve(localDataRoot())
  // Auto-resolve if file was referenced in legacy v8 directory but lives in v8.1
  const fsSync = require('node:fs')
  if (!fsSync.existsSync(resolved) && resolved.includes('\\v8\\')) {
    const candidate = resolved.replace('\\v8\\', '\\v8.1\\')
    if (fsSync.existsSync(candidate)) resolved = candidate
  }
  const resolvedCmp = process.platform === 'win32' ? resolved.toLowerCase() : resolved
  const rootCmp = process.platform === 'win32' ? root.toLowerCase() : root
  const legacyCmp = rootCmp.replace(/\\v8\.1\\/, '\\v8\\')
  const allowed = (resolvedCmp.startsWith(rootCmp + path.sep) || resolvedCmp === rootCmp) ||
                  (resolvedCmp.startsWith(legacyCmp + path.sep) || resolvedCmp === legacyCmp)
  if (!allowed) {
    throw new Error(`Document outside the allowed data root: ${resolved}`)
  }
  const whatsapp = require('whatsapp-web.js')
  const { MessageMedia } = whatsapp
  const media = MessageMedia.fromFilePath(resolved)
  if (customFilename && typeof customFilename === 'string') {
    const cleanName = customFilename.trim().replace(/[/\\?%*:|"<>]/g, '-')
    media.filename = cleanName.toLowerCase().endsWith('.pdf') ? cleanName : `${cleanName}.pdf`
  }
  const options = {
    sendMediaAsDocument: true,
    ...(caption ? { caption: String(caption).slice(0, 1000) } : {})
  }
  try {
    const result = await guardedSend(`WhatsApp document send to ${chatId}`, SEND_DOCUMENT_TIMEOUT_MS, () => {
      const active = client
      if (!active) throw new Error('WhatsApp client is not connected')
      return active.sendMessage(chatId, media, options)
    })
    rememberOutgoing(result)
    let sizeBytes = null
    try { sizeBytes = require('node:fs').statSync(resolved).size } catch { /* trace only */ }
    ledger.record({
      service: 'wa-sender', lane: 'direct', channel: 'whatsapp', recipient: chatId, kind: 'document',
      status: 'sent', providerMsgId: result.id?.id || result.id?._serialized || null,
      filePath: resolved, fileName: media.filename || null, bytes: sizeBytes
    })
    return { messageId: result.id?.id || result.id?._serialized || 'dispatched' }
  } catch (error) {
    const message = String(error?.message || '')
    let sizeBytes = null
    try { sizeBytes = require('node:fs').statSync(resolved).size } catch { /* trace only */ }
    if (/getter must include an id property/i.test(message)) {
      // The getter fires while building the message model AFTER the upload
      // left the page — verify against the raw store and close as sent when
      // the server accepted it (no blind retry that duplicates the doc).
      error.unconfirmed = true
      error.transportNotReady = false
      const verdict = await verifyDocumentDelivery(chatId, {
        fileNames: [media.filename, path.basename(resolved)],
        sinceMs: Date.now() - 270000
      })
      if (verdict.ok) {
        ledger.record({
          service: 'wa-sender', lane: 'direct', channel: 'whatsapp', recipient: chatId, kind: 'document',
          status: 'sent', providerMsgId: verdict.msgId, filePath: resolved,
          fileName: media.filename || null, bytes: sizeBytes,
          meta: { verifiedAfterError: 'getter-error' }
        })
        return { messageId: verdict.msgId || 'verified', verified: true }
      }
      error.message = `${message} [verify: ${verdict.reason}]`
    }
    if (!message.startsWith('WhatsApp client is not connected') && !message.startsWith('Document outside')) {
      ledger.record({
        service: 'wa-sender', lane: 'direct', channel: 'whatsapp', recipient: chatId, kind: 'document',
        status: error?.unconfirmed === true ? 'uncertain' : 'failed', error: error?.message,
        filePath: resolved, fileName: media.filename || null, bytes: sizeBytes
      })
    }
    throw error
  }
}

/** Live transport probe: a cheap page round-trip. A zombie page times out,
 * answers null, or throws — the wa-sender watchdog rebuilds the client after
 * two consecutive failed probes while the session is authenticated. */
async function probeTransport({ timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  if (!client) return { ok: false, reason: 'no-client' }
  // Fresh pairing and early boot are neutral states — probing there would
  // strike-kill the very client that is about to become usable.
  if (!authenticatedSeen) return { ok: false, reason: 'pairing-or-boot' }
  const page = client.pupPage
  if (!page || (typeof page.isClosed === 'function' && page.isClosed())) {
    return { ok: false, reason: 'page-closed' }
  }
  try {
    const state = await withTimeout(() => client.getState(), timeoutMs, 'WhatsApp state probe timed out')
    return { ok: typeof state === 'string' && state !== 'TIMEOUT', state: state == null ? null : String(state) }
  } catch (error) {
    return { ok: false, reason: 'probe-failed', error: error.message }
  }
}

/** Delivery verification against the client's own outgoing store — a RAW
 * store scan inside the page. Model-construction paths (fetchMessages /
 * getMessageModel) fail on the current WhatsApp web build (getter errors),
 * but raw chat.msgs fields survive, so verification reads them directly.
 * `fileNames` empty = match any outgoing document. */
async function verifyDocumentDelivery(chatId, { fileNames = [], sinceMs = 0, limit = 60 } = {}) {
  const active = client
  if (!active || !clientReady) return { ok: false, reason: 'no-client' }
  const page = active.pupPage
  if (!page) return { ok: false, reason: 'no-page' }
  const wanted = (Array.isArray(fileNames) ? fileNames : [fileNames])
    .map((name) => String(name || '').trim()).filter(Boolean)
  try {
    const scanned = await withTimeout(() => page.evaluate((jid) => {
      const phones = String(jid || '').split('@')[0]
      const chats = window.Store && window.Store.Chat && window.Store.Chat.getModelsArray
        ? window.Store.Chat.getModelsArray()
        : []
      const target = chats.find((c) => c.id && c.id._serialized === jid)
        || chats.find((c) => c.id && String(c.id.user || '') === phones)
      // No direct jid match → the chat is keyed under the opaque LID family
      // (new WhatsApp web build). Scanning ALL chats still proves delivery:
      // we look for OUR outgoing document by filename regardless of which
      // peer-id form each chat is stored under.
      const pool = target ? [target] : chats.filter((c) => !sinceMs || Number(c.t || 0) * 1000 >= sinceMs)
      const out = []
      const pushMsg = (chatLabel, m) => {
        if (!m || !m.id) return
        out.push({
          chat: chatLabel || null,
          serialized: m.id._serialized || (m.id.id ? String(m.id.id) : null),
          fromMe: Boolean(m.id.fromMe),
          type: m.type || null,
          filename: m.filename || null,
          ack: typeof m.ack === 'number' ? m.ack : null,
          t: m.t || 0
        })
      }
      for (const chat of pool) {
        const models = chat.msgs && typeof chat.msgs.getModelsArray === 'function' ? chat.msgs.getModelsArray() : []
        for (const m of models) pushMsg(chat.id && chat.id._serialized ? chat.id._serialized : null, m)
      }
      // Fresh boots hydrate per-chat lists lazily — the global message store
      // keeps recently-sent rows even when their chats look empty.
      const globalMsgs = window.Store && window.Store.Msg !== undefined ? window.Store.Msg : undefined
      const globalModels = globalMsgs && typeof globalMsgs.getModelsArray === 'function' ? globalMsgs.getModelsArray() : []
      for (const m of globalModels) {
        const remote = m.id && m.id.remote ? (m.id.remote._serialized || String(m.id.remote)) : null
        pushMsg(remote, m)
      }
      // Dedupe by message id (global overlaps per-chat lists).
      const seen = new Set()
      const deduped = []
      for (const r of out) {
        if (r.serialized && seen.has(r.serialized)) continue
        if (r.serialized) seen.add(r.serialized)
        deduped.push(r)
      }
      return deduped
    }, chatId), PROBE_TIMEOUT_MS, 'outgoing-store scan timed out')
    const outgoing = (Array.isArray(scanned) ? scanned : []).filter((r) => r.fromMe)
      .sort((a, b) => (a.t || 0) - (b.t || 0))
      .slice(-limit)
    let match = null
    for (const row of outgoing) {
      if (row.type !== 'document') continue
      if ((row.ack ?? -1) < 0) continue // clock/pending — not yet server-accepted
      if (wanted.length && !wanted.includes(String(row.filename || '').trim())) continue
      if (sinceMs && Number(row.t || 0) * 1000 < sinceMs) continue
      match = row // ascending timestamps → the last hit is the newest
    }
    if (!match) {
      return {
        ok: false,
        reason: wanted.length ? 'filename-not-found' : 'not-found',
        inspected: outgoing.length,
        rows: outgoing.slice(-12).map((r) => ({ id: r.serialized, chat: r.chat, type: r.type, filename: r.filename, ack: r.ack, at: r.t }))
      }
    }
    return {
      ok: true,
      msgId: match.serialized,
      ack: match.ack,
      filename: match.filename,
      timestamp: match.t,
      peer: match.chat || null,
      rows: outgoing.map((r) => ({ id: r.serialized, chat: r.chat, type: r.type, filename: r.filename, ack: r.ack, at: r.t }))
    }
  } catch (error) {
    return { ok: false, reason: 'verify-failed', error: error.message }
  }
}

function isSendReady() { return Boolean(client && clientReady) }

/** Milliseconds since the page finished bootstrapping, or null before `ready`
 * — the drain holds off claims for a stability window after boot because
 * early media sends neither confirm nor fail cleanly (getter errors). */
function bootReadyMs() {
  if (!clientReady || !readyAtMs) return null
  return Date.now() - readyAtMs
}

/** One-shot view of the LIVE page store: how well the client actually
 * hydrated after boot. Used by the sender's boot diagnostic — without this
 * an empty scan of outgoing documents cannot tell 'no docs ever delivered'
 * from 'history simply never loaded into this page'. */
async function storeSnapshot() {
  const active = client
  if (!active || !clientReady) return { ok: false, reason: 'no-client' }
  const page = active.pupPage
  if (!page) return { ok: false, reason: 'no-page' }
  try {
    const snap = await withTimeout(() => page.evaluate(() => {
      const chats = window.Store && window.Store.Chat && window.Store.Chat.getModelsArray
        ? window.Store.Chat.getModelsArray()
        : []
      const msgStore = window.Store && window.Store.Msg ? window.Store.Msg : null
      const globalModels = msgStore && typeof msgStore.getModelsArray === 'function' ? msgStore.getModelsArray() : []
      let me = ''
      try {
        const meUser = window.Store.User && window.Store.User.getMaybeMeUser ? window.Store.User.getMaybeMeUser() : null
        me = meUser && (meUser._serialized || meUser.toString ? String(meUser._serialized || meUser) : '')
      } catch (_) { /* optional */ }
      let pageVersion = ''
      try { pageVersion = window.Debug && window.Debug.VERSION ? String(window.Debug.VERSION) : '' } catch (_) { /* optional */ }
      let requireExposed = false
      try { requireExposed = typeof window.require === 'function' } catch (_) { /* optional */ }
      let wwebjsReady = false
      try { wwebjsReady = Boolean(window.WWebJS) } catch (_) { /* optional */ }
      let storeKeyCount = 0
      try { storeKeyCount = Object.keys(window.Store || {}).length } catch (_) { /* optional */ }
      let storeKeys = []
      try { storeKeys = Object.keys(window.Store || {}).filter((k) => /msg|chat/i.test(k)).slice(0, 40) } catch (_) { /* optional */ }
      return {
        pageVersion,
        requireExposed,
        wwebjsReady,
        storeKeyCount,
        chats: chats.length,
        chatIds: chats.slice(-14).map((c) => (c.id && c.id._serialized) || null),
        msgs: globalModels.length,
        newest: globalModels.slice(-8).map((m) => ({
          type: m.type || null,
          fromMe: Boolean(m.id && m.id.fromMe),
          ack: typeof m.ack === 'number' ? m.ack : null,
          t: m.t || 0
        })),
        me,
        storeKeys
      }
    }), PROBE_TIMEOUT_MS, 'store snapshot timed out')
    return { ok: true, ...snap }
  } catch (error) {
    return { ok: false, reason: 'snapshot-failed', error: error.message }
  }
}

module.exports = { startWhatsApp, sendMessage, sendDocument, probeTransport, isSendReady, bootReadyMs, verifyDocumentDelivery, storeSnapshot, resolveCanonicalJid }
