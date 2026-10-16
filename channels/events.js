'use strict'

const { getDatabase } = require('../db/connect')
const { now } = require('../db/queries/shared')
const summarize = require('../assistant/tools/summarize')
const { randomUUID } = require('node:crypto')

function messageMode(db = getDatabase()) {
  const row = db.prepare("SELECT value FROM settings WHERE key='message_mode'").get()
  return row ? row.value : 'dry-run'
}

function eventText(event, payload) {
  if (event.kind === 'account_parked') return `تنبيه: تم إيقاف فحص الحساب ${event.account_key} مؤقتاً بعد تكرار الإخفاقات.`
  if (event.kind === 'harness_offline') return 'تنبيه: محرك SAPAuto لم يرسل نبضاً منذ أكثر من ثلاث دقائق.'
  if (event.kind === 'morning_briefing') return null
  if (event.kind === 'new_doc') return `مستند جديد للحساب ${event.account_key}: ${event.entity_id}`
  if (event.kind === 'changed_doc') return `تم تحديث مستند للحساب ${event.account_key}: ${event.entity_id}`
  if (event.kind === 'deadline_reminder') return `تذكير: التزام ${payload.obligationId} يستحق خلال ${payload.days} يوم.`
  if (event.kind === 'reminder_due') return `حان موعد التذكير${payload.target ? `: ${payload.target}` : '.'}`
  if (event.kind === 'report_requested') return null
  if (event.kind === 'assistant_attention') {
    return `تنبيه مدير المساعد: ${payload.title || 'يتطلب الأمر انتباهك.'}${payload.details ? `\n${payload.details}` : ''}`
  }
  return `تحديث SAPAuto: ${event.kind}`
}

async function contentFor(event, payload, db) {
  if (event.kind === 'morning_briefing') {
    const summary = await summarize({ scope: 'all', period: 'today' })
    return `الإحاطة اليومية — مهام مفتوحة: ${summary.tasks}؛ التزامات متأخرة: ${summary.overdueObligations}؛ إخفاقات: ${summary.openFailures}.`
  }
  if (event.kind === 'report_requested') {
    const report = db.prepare('SELECT body FROM reports WHERE id=?').get(payload.reportId)
    if (!report) throw new Error('Requested report was not found')
    return report.body
  }
  if (event.kind === 'reminder_due') {
    const row = db.prepare('SELECT target_type,target_id,message FROM reminders WHERE id=?').get(event.entity_id)
    if (!row) return null
    if (row.message || (row.target_type === 'general' && row.target_id)) {
      return eventText(event, { ...payload, target: row.message || row.target_id })
    }
    const tables = { task: 'tasks', obligation: 'obligations', payment: 'payments' }
    const titleColumns = { task: 'title', obligation: 'title', payment: 'claim_number' }
    const table = tables[row.target_type]
    const column = titleColumns[row.target_type]
    if (!table || !column || !row.target_id) return eventText(event, payload)
    const target = db.prepare(`SELECT ${column} AS title FROM ${table} WHERE id=?`).get(row.target_id)
    return eventText(event, { ...payload, target: target?.title || row.target_id })
  }
  return eventText(event, payload)
}

async function deliverEvent(event, providers, db = getDatabase()) {
  const payload = JSON.parse(event.payload || '{}')
  if (event.kind === 'reminder_due') {
    const reminder = db.prepare('SELECT user_id,channel,cancelled_at FROM reminders WHERE id=?').get(event.entity_id)
    if (!reminder || reminder.cancelled_at) {
      db.prepare('UPDATE events SET announced=1 WHERE id=?').run(event.id)
      return true
    }
    if (reminder.channel === 'launcher') {
      db.prepare(`UPDATE reminders SET sent_at=?,delivery_status='sent'
        WHERE id=? AND sent_at IS NULL`).run(now(), event.entity_id)
      db.prepare('UPDATE events SET announced=1 WHERE id=?').run(event.id)
      return true
    }
  }
  const text = await contentFor(event, payload, db)
  const links = event.kind === 'report_requested'
    ? db.prepare(`SELECT c.channel,c.external_id FROM user_channels c
      JOIN users u ON u.id=c.user_id WHERE c.user_id=? AND c.channel=? AND u.disabled=0`)
      .all(payload.userId, payload.channel)
    : event.kind === 'reminder_due'
      ? db.prepare(`SELECT c.channel,c.external_id FROM user_channels c
        JOIN users u ON u.id=c.user_id WHERE c.user_id=? AND c.channel=? AND u.disabled=0`)
        .all(payload.userId, payload.channel)
    : db.prepare(`SELECT c.channel,c.external_id FROM user_channels c
      JOIN users u ON u.id=c.user_id WHERE u.disabled=0 AND u.role IN ('Owner','Operator')`).all()
  let eligible = 0
  for (const link of links) {
    if (!providers[link.channel]) continue
    if (event.kind === 'report_requested' &&
        (!Array.isArray(payload.recipients) || !payload.recipients.includes(link.external_id))) continue
    eligible += 1
    const exists = db.prepare('SELECT 1 FROM channel_deliveries WHERE event_id=? AND channel=? AND external_id=?')
      .get(event.id, link.channel, link.external_id)
    if (exists) continue
    if (!text) throw new Error(`No message body for ${event.kind}`)
    const mode = messageMode(db) === 'live' ? 'sent' : 'dry_run'
    if (mode === 'sent') await providers[link.channel](link.external_id, text)
    db.prepare('INSERT INTO channel_deliveries(event_id,channel,external_id,sent_at,status) VALUES(?,?,?,?,?)')
      .run(event.id, link.channel, link.external_id, now(), mode)
  }
  if (eligible > 0) {
    db.prepare('UPDATE events SET announced=1 WHERE id=?').run(event.id)
    const mode = messageMode(db) === 'live' ? 'sent' : 'dry_run'
    if (payload.reportId) {
      if (mode === 'sent') db.prepare("UPDATE reports SET delivery_status='sent',sent_at=? WHERE id=?")
        .run(now(), payload.reportId)
      else db.prepare("UPDATE reports SET delivery_status='dry_run' WHERE id=?").run(payload.reportId)
    }
    if (event.kind === 'reminder_due') {
      if (mode === 'sent') db.prepare(`UPDATE reminders SET delivery_status='sent',sent_at=?
        WHERE id=? AND delivery_status='pending'`).run(now(), event.entity_id)
      else db.prepare(`UPDATE reminders SET delivery_status='dry_run'
        WHERE id=? AND delivery_status='pending'`).run(event.entity_id)
    }
    return true
  }
  return false
}

function enqueueDueReminders(db = getDatabase(), currentTime = new Date()) {
  const dueAt = (currentTime instanceof Date ? currentTime : new Date(currentTime)).toISOString()
  const enqueue = db.transaction(() => {
    const reminders = db.prepare(`SELECT id,user_id,channel,target_type,target_id,due_at
      FROM reminders WHERE delivery_status='pending' AND cancelled_at IS NULL AND due_at<=?
      ORDER BY due_at LIMIT 100`).all(dueAt)
    const insert = db.prepare(`INSERT OR IGNORE INTO events(id,kind,entity_id,payload,created_at)
      VALUES(?,'reminder_due',?,?,?)`)
    let enqueued = 0
    for (const reminder of reminders) {
      enqueued += insert.run(`reminder_due_${reminder.id}`, reminder.id, JSON.stringify({
        userId: reminder.user_id,
        channel: reminder.channel,
        targetType: reminder.target_type,
        targetId: reminder.target_id
      }), now()).changes
    }
    return enqueued
  })
  return enqueue.immediate()
}

function checkHarnessOffline(db = getDatabase(), currentTime = Date.now()) {
  const heartbeat = db.prepare('SELECT last_heartbeat FROM harness_status WHERE id=1').get()
  if (!heartbeat || !heartbeat.last_heartbeat) return false
  const stale = currentTime - Date.parse(heartbeat.last_heartbeat) > 3 * 60 * 1000
  const notified = db.prepare("SELECT value FROM settings WHERE key='offline_notified'").get()?.value === 'true'
  if (stale && !notified) {
    db.prepare('INSERT INTO events(id,kind,payload,created_at) VALUES(?,?,?,?)')
      .run(randomUUID(), 'harness_offline', '{}', now())
    db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('offline_notified','true',?)
      ON CONFLICT(key) DO UPDATE SET value='true',updated_at=excluded.updated_at`).run(now())
    return true
  }
  if (!stale && notified) {
    db.prepare(`UPDATE settings SET value='false',updated_at=? WHERE key='offline_notified'`).run(now())
  }
  return false
}

function startEventDispatcher(providers, { db = getDatabase(), intervalMs = 10000 } = {}) {
  let busy = false
  const timer = setInterval(async () => {
    if (busy) return
    busy = true
    try {
      checkHarnessOffline(db)
      enqueueDueReminders(db)
      const events = db.prepare('SELECT * FROM events WHERE announced=0 ORDER BY created_at LIMIT 20').all()
      for (const event of events) {
        try { await deliverEvent(event, providers, db) }
        catch (error) { console.error(`Event delivery failed (${event.id}): ${error.message}`) }
      }
    } catch (error) {
      console.error(`Event dispatcher failed: ${error.message}`)
    } finally { busy = false }
  }, intervalMs)
  return () => clearInterval(timer)
}

module.exports = { deliverEvent, startEventDispatcher, checkHarnessOffline, enqueueDueReminders, messageMode }
