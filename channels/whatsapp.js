'use strict'

const path = require('node:path')
const { createRequire } = require('node:module')
const { getDatabase } = require('../db/connect')
const { runAssistant } = require('../assistant/run')
const { boundedText } = require('../domain/bounded-text.cjs')
const { consumeLinkCode, linkedUser, allowUnlinkedReply } = require('./link-codes')
const { createConfirmation } = require('../assistant/confirmations')
const { audit } = require('../db/queries/shared')

const require = createRequire(__filename)

async function startWhatsApp() {
  let whatsapp
  try { whatsapp = require('whatsapp-web.js') }
  catch { throw new Error('WhatsApp is optional; install whatsapp-web.js locally before enabling it.') }
  const { Client, LocalAuth } = whatsapp
  const db = getDatabase()
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
    puppeteer: { headless: true }
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
    console.log('WhatsApp requires QR pairing; view it in Owner Settings.')
  })
  client.on('ready', () => {
    db.prepare("DELETE FROM settings WHERE key='whatsapp_qr'").run()
    db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_connected','true',?)
      ON CONFLICT(key) DO UPDATE SET value='true',updated_at=excluded.updated_at`)
      .run(new Date().toISOString())
    db.prepare("DELETE FROM settings WHERE key='whatsapp_pair_requested'").run()
    audit(db, {
      actorId: 'system',
      action: 'channel.connected',
      entityType: 'channel',
      entityId: 'whatsapp'
    })
    console.log('WhatsApp channel connected.')
  })
  client.on('message', async (message) => {
    if (message.fromMe || message.isStatus || message.from.endsWith('@g.us')) return
    const externalId = message.from
    const text = String(message.body || '').trim().slice(0, 4000)
    const code = text.match(/^link\s+(\d{6})\s*$/i)
    try {
      if (code) {
        const result = consumeLinkCode('whatsapp', externalId, code[1], db)
        await message.reply(result ? 'تم ربط الحساب.' : 'رمز الربط غير صالح أو انتهت صلاحيته.')
        return
      }
      const user = linkedUser('whatsapp', externalId, db)
      if (!user || user.disabled) {
        if (allowUnlinkedReply('whatsapp', externalId, db)) await message.reply('اطلب من المالك رمز ربط من إعدادات SAPAuto.')
        return
      }
      if (/^scan\s*now$/i.test(text) && user.role !== 'Viewer') {
        createConfirmation({ userId: user.userId, toolName: 'scan_now', args: {}, db })
        await message.reply('تم إنشاء طلب فحص معلق. راجعه ووافق عليه من لوحة SAPAuto.')
        return
      }
      const result = await runAssistant({ userId: user.userId, role: user.role, text })
      await message.reply(boundedText(result.reply, 4000))
    } catch (error) {
      console.error(`WhatsApp message failed: ${error.message}`)
      await message.reply('تعذر تنفيذ الطلب. حاول لاحقاً أو راجع لوحة التحكم.')
    }
  })
  await client.initialize()
  return client
}

module.exports = { startWhatsApp }
