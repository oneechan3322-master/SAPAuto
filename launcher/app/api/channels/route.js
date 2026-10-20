import { createRequire } from 'node:module'
import { requireRole, requireSameOrigin } from '../../../lib/guard.js'

const require = createRequire(import.meta.url)
const { getDatabase } = require('../../../../db/connect')
const { audit, now } = require('../../../../db/queries/shared')
const secureStore = require('../../../../channels/secure-store')

const requireFromV8 = createRequire(new URL('../../../../package.json', import.meta.url))
const optionalWhatsAppPackage = ['whatsapp-web', '.js'].join('')

function configured(channel) {
  if (channel === 'gmail') {
    return secureStore.hasStoredCredentials('gmail') ||
      Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
  }
  if (channel === 'telegram') {
    return secureStore.hasStoredCredentials('telegram') || Boolean(process.env.TELEGRAM_BOT_TOKEN)
  }
  return getDatabase().prepare("SELECT value FROM settings WHERE key='whatsapp_connected'").get()?.value === 'true'
}

function channelState() {
  const db = getDatabase()
  let whatsappAvailable = false
  try {
    requireFromV8.resolve(optionalWhatsAppPackage)
    whatsappAvailable = true
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error
  }
  const qr = db.prepare("SELECT value FROM settings WHERE key='whatsapp_qr'").get()?.value || ''
  const pairingCode = db.prepare("SELECT value FROM settings WHERE key='whatsapp_pair_code'").get()?.value || ''
  // A package, an environment flag, or an old browser profile is not proof of a
  // connected WhatsApp session. Only the client's `ready` event may set this.
  const paired = db.prepare("SELECT value FROM settings WHERE key='whatsapp_connected'").get()?.value === 'true'
  const pairingRequested = db.prepare("SELECT value FROM settings WHERE key='whatsapp_pair_requested'").get()?.value === 'true'
  const controlNumber = db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_number'").get()?.value || ''
  const linkedRecipients = db.prepare(`SELECT COUNT(*) AS n FROM user_channels c
    JOIN users u ON u.id=c.user_id WHERE u.disabled=0 AND c.verified_at IS NOT NULL`).get().n
  const providersReady = ['gmail', 'telegram'].some(configured) || configured('whatsapp')
  return {
    channels: {
      gmail: configured('gmail'),
      telegram: configured('telegram'),
      whatsapp: paired || configured('whatsapp')
    },
    whatsapp: { paired, pairingRequested, qr, pairingCode, controlNumber, available: whatsappAvailable },
    linkedRecipients,
    liveDeliveryReady: providersReady && linkedRecipients > 0
  }
}

export async function GET(request) {
  const authz = await requireRole(request, 'Viewer')
  if (authz.response) return authz.response
  try {
    return Response.json(channelState())
  } catch (error) {
    return Response.json({ error: `تعذر تحميل القنوات: ${String(error.message || error).slice(0, 200)}` }, { status: 500 })
  }
}

export async function POST(request) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Owner')
  if (authz.response) return authz.response
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'تعذر قراءة بيانات الربط.' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'بيانات الربط غير صالحة.' }, { status: 400 })
  }

  try {
    if (body.channel === 'gmail') {
      const email = typeof body.email === 'string' ? body.email.trim() : ''
      const password = typeof body.password === 'string' ? body.password.replace(/\s/g, '') : ''
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 128) {
        return Response.json({ error: 'تحقق من البريد وكلمة مرور التطبيق.' }, { status: 400 })
      }
      const nodemailer = requireFromV8('nodemailer')
      const transport = nodemailer.createTransport({
        host: process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.GMAIL_SMTP_PORT || 465),
        secure: true,
        auth: { user: email, pass: password },
        disableFileAccess: true,
        disableUrlAccess: true,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
      })
      try {
        await transport.verify()
      } finally {
        transport.close()
      }
      const credentials = secureStore.readAll()
      credentials.gmail = { email, password }
      secureStore.writeAll(credentials)
      audit(getDatabase(), {
        actorId: authz.session.user.id,
        action: 'channel.connected',
        entityType: 'channel',
        entityId: 'gmail'
      })
      return Response.json({ saved: true, state: channelState() })
    }

    if (body.channel === 'telegram') {
      const token = typeof body.token === 'string' ? body.token.trim() : ''
      if (!/^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(token)) {
        return Response.json({ error: 'تحقق من رمز البوت وحاول مجددًا.' }, { status: 400 })
      }
      const { createTelegram } = require('../../../../channels/telegram')
      await createTelegram(token).api('getMe', {})
      const credentials = secureStore.readAll()
      credentials.telegram = { token }
      secureStore.writeAll(credentials)
      audit(getDatabase(), {
        actorId: authz.session.user.id,
        action: 'channel.connected',
        entityType: 'channel',
        entityId: 'telegram'
      })
      return Response.json({ saved: true, state: channelState() })
    }

    if (body.channel === 'whatsapp' && body.action === 'pair') {
      try {
        requireFromV8.resolve(optionalWhatsAppPackage)
      } catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND') throw error
        return Response.json({ error: 'ربط واتساب غير متاح في هذه النسخة بعد.' }, { status: 409 })
      }
      const db = getDatabase()
      db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_pair_requested','true',?)
        ON CONFLICT(key) DO UPDATE SET value='true',updated_at=excluded.updated_at`).run(now())
      audit(db, {
        actorId: authz.session.user.id,
        action: 'channel.pairing_requested',
        entityType: 'channel',
        entityId: 'whatsapp'
      })
      return Response.json({ saved: true, state: channelState() })
    }

    if (body.channel === 'whatsapp' && body.action === 'save_control_number') {
      const controlNumber = typeof body.controlNumber === 'string' ? body.controlNumber.trim() : ''
      if (!/^\+?[1-9]\d{7,14}$/.test(controlNumber)) {
        return Response.json({ error: 'أدخل رقم واتساب بصيغة دولية صحيحة.' }, { status: 400 })
      }
      const normalized = `+${controlNumber.replace(/^\+/, '')}`
      const db = getDatabase()
      db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_control_number',?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(normalized, now())
      audit(db, { actorId: authz.session.user.id, action: 'channel.control_number.updated', entityType: 'channel', entityId: 'whatsapp' })
      return Response.json({ saved: true, state: channelState() })
    }

    if (body.channel === 'whatsapp' && body.action === 'disconnect') {
      const db = getDatabase()
      db.prepare("DELETE FROM settings WHERE key='whatsapp_pair_requested'").run()
      db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_disconnect_requested','true',?)
        ON CONFLICT(key) DO UPDATE SET value='true',updated_at=excluded.updated_at`).run(now())
      db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_pair_cancelled','true',?)
        ON CONFLICT(key) DO UPDATE SET value='true',updated_at=excluded.updated_at`).run(now())
      audit(db, {
        actorId: authz.session.user.id,
        action: 'channel.pairing_cancelled',
        entityType: 'channel',
        entityId: 'whatsapp'
      })
      return Response.json({ saved: true, state: channelState() })
    }
  } catch (error) {
    console.error(`Channel connection failed (${String(body.channel || 'unknown')}): ${String(error.message || error)}`)
    return Response.json({ error: 'تعذّر التحقق من الاتصال. راجع البيانات وحاول مرة أخرى.' }, { status: 502 })
  }

  return Response.json({ error: 'اختر قناة متاحة للربط.' }, { status: 400 })
}
