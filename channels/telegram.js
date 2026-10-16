'use strict'

const { getDatabase } = require('../db/connect')
const { boundedText } = require('../domain/bounded-text.cjs')
const { runAssistant } = require('../assistant/run')
const { consumeLinkCode, linkedUser, allowUnlinkedReply } = require('./link-codes')
const { createConfirmation } = require('../assistant/confirmations')

const ROLE_LEVEL = { Viewer: 0, Operator: 1, Owner: 2 }

function createTelegram(token = process.env.TELEGRAM_BOT_TOKEN) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required')
  const base = `https://api.telegram.org/bot${token}`
  async function api(method, payload) {
    const response = await fetch(`${base}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(35000)
    })
    const result = await response.json()
    if (!response.ok || result.ok !== true) throw new Error(`Telegram ${method} failed (HTTP ${response.status})`)
    return result.result
  }
  return { api }
}

async function handleTelegramUpdate(update, client, db = getDatabase()) {
  if (update.callback_query) {
    const callback = update.callback_query
    const externalId = String(callback.message?.chat?.id || '')
    const linked = linkedUser('telegram', externalId, db)
    if (!linked || linked.disabled) {
      await client.api('answerCallbackQuery', { callback_query_id: callback.id, text: 'الحساب غير مرتبط' })
      return
    }
    const [action, targetId] = String(callback.data || '').split(':')
    try {
      if (action === 'scan_now' && ROLE_LEVEL[linked.role] >= ROLE_LEVEL.Operator) {
        createConfirmation({ userId: linked.userId, toolName: 'scan_now', args: {}, db })
      } else if (action === 'mark_done' && targetId && ROLE_LEVEL[linked.role] >= ROLE_LEVEL.Operator) {
        createConfirmation({
          userId: linked.userId, toolName: 'mark_obligation_done',
          args: { obligation_id: targetId, evidence: 'تم الطلب من Telegram' }, db
        })
      } else {
        throw new Error('غير مصرح بهذا الإجراء')
      }
      await client.api('answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'تم إنشاء طلب معلق. راجعه ووافق عليه من لوحة SAPAuto.'
      })
    } catch (error) {
      await client.api('answerCallbackQuery', { callback_query_id: callback.id, text: error.message })
    }
    return
  }

  const message = update.message
  if (!message || message.chat?.type !== 'private' || typeof message.text !== 'string') return
  const externalId = String(message.chat.id)
  const text = message.text.trim()
  const startCode = text.match(/^\/start(?:\s+(\d{6}))?$/)
  if (startCode) {
    if (startCode[1]) {
      const linked = consumeLinkCode('telegram', externalId, startCode[1], db)
      await client.api('sendMessage', { chat_id: externalId, text: linked ? 'تم ربط الحساب بنجاح.' : 'رمز الربط غير صحيح أو انتهت صلاحيته.' })
    } else {
      await client.api('sendMessage', { chat_id: externalId, text: 'أدخل /start متبوعاً برمز الربط الذي أنشأه المالك في الإعدادات.' })
    }
    return
  }

  const user = linkedUser('telegram', externalId, db)
  if (!user || user.disabled) {
    if (allowUnlinkedReply('telegram', externalId, db)) {
      await client.api('sendMessage', { chat_id: externalId, text: 'اطلب من مالك النظام رمز ربط في الإعدادات.' })
    }
    return
  }
  const result = await runAssistant({ userId: user.userId, role: user.role, text })
  await client.api('sendMessage', {
    chat_id: externalId,
    text: boundedText(result.reply, 4000),
    reply_markup: { inline_keyboard: [[{ text: 'افحص الآن', callback_data: 'scan_now' }]] }
  })
}

async function pollTelegram({ token = process.env.TELEGRAM_BOT_TOKEN, signal } = {}) {
  const client = createTelegram(token)
  const db = getDatabase()
  let offset = Number(db.prepare("SELECT value FROM settings WHERE key='telegram_update_offset'").get()?.value || 0)
  let delay = 1000
  while (!signal?.aborted) {
    try {
      const updates = await client.api('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] })
      for (const update of updates) {
        await handleTelegramUpdate(update, client, db)
        offset = Math.max(offset, Number(update.update_id) + 1)
        db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('telegram_update_offset',?,?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
          .run(String(offset), new Date().toISOString())
      }
      delay = 1000
    } catch (error) {
      if (signal?.aborted) break
      console.error(`Telegram poll failed: ${error.message}`)
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay = Math.min(delay * 2, 60000)
    }
  }
}

module.exports = { createTelegram, handleTelegramUpdate, pollTelegram }
