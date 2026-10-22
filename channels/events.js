'use strict'

const { getDatabase } = require('../db/connect')
const { now } = require('../db/queries/shared')
const summarize = require('../assistant/tools/summarize')
const { randomUUID } = require('node:crypto')
const { enqueue } = require('./outbox')

function messageMode(db = getDatabase()) {
  const row = db.prepare("SELECT value FROM settings WHERE key='message_mode'").get()
  return row ? row.value : 'dry-run'
}

// Outbox phases (Opus5.5 §6.2), keyed on settings `outbox_mode`:
//   'shadow' (default) — legacy direct-send stays authoritative; every would-be
//     delivery is mirrored into notification_outbox for replay parity checks.
//   'live' — cut-over: real (shadow=0) rows are queued here and the sender
//     processes (wa-sender / mailtg-sender) are the only deliverers.
//   'off' — no outbox recording; pre-§6.2 behaviour only.
function outboxMode(db = getDatabase()) {
  const row = db.prepare("SELECT value FROM settings WHERE key='outbox_mode'").get()
  return row ? row.value : 'shadow'
}

function outboxShadowEnabled(db) {
  return outboxMode(db) === 'shadow'
}

function recordOutboxShadow(event, link, text, db) {
  try {
    enqueue({
      eventId: event.id,
      channel: link.channel,
      recipient: link.external_id,
      payload: { text, kind: event.kind, accountKey: event.account_key || null },
      shadow: true
    }, db)
  } catch (error) {
    // Shadow recording must never break real delivery.
    console.error(`Outbox shadow record failed for event ${event.id}: ${error.message}`)
  }
}

// Cut-over: queue a real (claimable) row for the senders. A durable outbox row
// is the delivery record; provider_msg_id/last_error then track provider truth.
function enqueueOutboxReal(event, link, text, db) {
  try {
    enqueue({
      eventId: event.id,
      channel: link.channel,
      recipient: link.external_id,
      payload: { text, kind: event.kind, accountKey: event.account_key || null },
      shadow: false
    }, db)
    return true
  } catch (error) {
    console.error(`Outbox queue failed for event ${event.id} via ${link.channel}: ${error.message}`)
    return false
  }
}

// Only these kinds may be coalesced into one grouped wake message. Kinds with
// side effects (reminder_due, report_requested) always go through
// deliverEvent individually.
const WAKE_BATCHABLE = new Set([
  'new_doc', 'changed_doc', 'deadline_reminder', 'assistant_attention', 'account_parked', 'harness_offline'
])

function wakeSettings(db) {
  const enabled = db.prepare("SELECT value FROM settings WHERE key='whatsapp_wake_notifications'").get()?.value === 'true'
  const controlNumber = db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_number'").get()?.value || ''
  return { enabled, controlNumber, externalId: controlNumber ? `${controlNumber.replace(/^\+/, '')}@c.us` : '' }
}

function clipped(value, max = 110) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function wakeGroupText(events) {
  const labels = {
    new_doc: 'مستندات جديدة',
    changed_doc: 'تحديثات مستندات',
    deadline_reminder: 'تنبيهات مواعيد',
    assistant_attention: 'ملاحظات المساعد',
    account_parked: 'إيقاف فحص حسابات',
    harness_offline: 'حالة محرك الفحص'
  }
  const grouped = new Map()
  for (const event of events) {
    if (!grouped.has(event.kind)) grouped.set(event.kind, [])
    grouped.get(event.kind).push(event)
  }
  const payloadOf = (event) => { try { return JSON.parse(event.payload || '{}') } catch { return {} } }
  const sections = []
  for (const [kind, list] of grouped) {
    const cap = 6
    const rows = list.slice(0, cap).map((event) => {
      const payload = payloadOf(event)
      if (kind === 'new_doc' || kind === 'changed_doc') {
        return `• ${event.account_key} — ${clipped(payload.doc_number || event.entity_id)}${payload.deadline ? ` — الموعد ${payload.deadline}` : ''}`
      }
      if (kind === 'deadline_reminder') {
        return `• ${clipped(payload.title || payload.obligationId || '')} — يستحق خلال ${payload.days} يوم`
      }
      if (kind === 'account_parked') return `• ${event.account_key}`
      if (kind === 'harness_offline') return '• المحرك لا يرسل نبضاً'
      return `• ${event.account_key ? `${event.account_key}: ` : ''}${clipped(payload.title || payload.details || 'يتطلب الأمر انتباهك.')}`
    })
    const extra = list.length - rows.length
    if (extra > 0) rows.push(`• و${extra} عناصر أخرى`)
    sections.push(`${labels[kind] || kind}:\n${rows.join('\n')}`)
  }
  return `تحديثات SAPAuto — ${events.length} تنبيه\n\n${sections.join('\n\n')}`
}

async function flushWakeBacklog(events, providers, db = getDatabase()) {
  const wake = wakeSettings(db)
  const queueLive = outboxMode(db) === 'live'
  if (!wake.enabled || !wake.externalId) return new Set()
  if (!providers.whatsapp && !queueLive) return new Set()
  if (!queueLive && messageMode(db) === 'live') return new Set()
  const batchable = events.filter((event) => WAKE_BATCHABLE.has(event.kind))
  if (batchable.length <= 4) return new Set()
  const text = wakeGroupText(batchable).slice(0, 3500)
  if (queueLive) {
    // Hourly grouping key: retries after a crash cannot duplicate more than
    // one hourly digest, and the next hour can always start a new one.
    const groupId = `wake-group-${new Date().toISOString().slice(0, 13)}`
    try {
      enqueue({
        eventId: groupId,
        channel: 'whatsapp',
        recipient: wake.externalId,
        payload: { text, kind: 'wake_group' },
        shadow: false
      }, db)
    } catch (error) {
      console.error(`Wake backlog queue failed: ${error.message}`)
      return new Set()
    }
    const timestamp = now()
    db.transaction(() => {
      for (const event of batchable) {
        db.prepare('INSERT OR IGNORE INTO channel_deliveries(event_id,channel,external_id,sent_at,status) VALUES(?,?,?,?,?)')
          .run(event.id, 'whatsapp', wake.externalId, timestamp, 'sent')
        db.prepare('UPDATE events SET announced=1 WHERE id=?').run(event.id)
      }
    }).immediate()
    return new Set(batchable.map((event) => event.id))
  }
  await providers.whatsapp(wake.externalId, text)
  const timestamp = now()
  const stamp = db.transaction(() => {
    for (const event of batchable) {
      db.prepare('INSERT INTO channel_deliveries(event_id,channel,external_id,sent_at,status) VALUES(?,?,?,?,?)')
        .run(event.id, 'whatsapp', wake.externalId, timestamp, 'sent')
      db.prepare('UPDATE events SET announced=1 WHERE id=?').run(event.id)
    }
  }).immediate()
  return new Set(batchable.map((event) => event.id))
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
  const queueLive = outboxMode(db) === 'live'
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
  let links = event.kind === 'report_requested'
    ? db.prepare(`SELECT c.channel,c.external_id FROM user_channels c
      JOIN users u ON u.id=c.user_id WHERE c.user_id=? AND c.channel=? AND u.disabled=0`)
      .all(payload.userId, payload.channel)
    : event.kind === 'reminder_due'
      ? db.prepare(`SELECT c.channel,c.external_id FROM user_channels c
        JOIN users u ON u.id=c.user_id WHERE c.user_id=? AND c.channel=? AND u.disabled=0`)
        .all(payload.userId, payload.channel)
      : db.prepare(`SELECT c.channel,c.external_id FROM user_channels c
        JOIN users u ON u.id=c.user_id WHERE u.disabled=0 AND u.role IN ('Owner','Operator')`).all()
  // A configured WhatsApp control number is an explicit wake channel. It does
  // not grant access to every contact and is used only for operational events.
  // After the sender split the dispatcher owns no provider objects, shadow
  // recording still uses the target: what would have gone to the control
  // number must appear in the mirror before the cut-over (§6.2).
  const wakeEnabled = db.prepare("SELECT value FROM settings WHERE key='whatsapp_wake_notifications'").get()?.value === 'true'
  const controlNumber = db.prepare("SELECT value FROM settings WHERE key='whatsapp_control_number'").get()?.value || ''
  const wakeKinds = new Set(['new_doc', 'changed_doc', 'deadline_reminder', 'reminder_due', 'assistant_attention', 'account_parked', 'harness_offline'])
  if (wakeEnabled && controlNumber && wakeKinds.has(event.kind) &&
      (providers.whatsapp || queueLive || outboxShadowEnabled(db))) {
    const controlExternalId = `${controlNumber.replace(/^\+/, '')}@c.us`
    if (!links.some((link) => link.channel === 'whatsapp' && link.external_id === controlExternalId)) {
      links = [...links, { channel: 'whatsapp', external_id: controlExternalId }]
    }
  }
  let eligible = 0
  const shadowEnabled = outboxShadowEnabled(db)
  // After the sender split the dispatcher process carries NO provider objects.
  // The transport channels stay deliverable then: 'live' queues real rows, and
  // otherwise shadow recording keeps mirroring what WOULD have been delivered.
  const transportChannel = (channel) => channel === 'whatsapp' || channel === 'telegram' || channel === 'email'
  for (const link of links) {
    // Dispatch paths: direct provider (legacy and test fakes), the sender
    // processes through the outbox queue, or shadow mirroring for a transport
    // channel whose provider no longer lives in this process.
    const hasProvider = Boolean(providers[link.channel])
    if (!hasProvider && !queueLive && !(shadowEnabled && transportChannel(link.channel))) continue
    if (event.kind === 'report_requested' &&
        (!Array.isArray(payload.recipients) || !payload.recipients.includes(link.external_id))) continue
    eligible += 1
    const exists = db.prepare('SELECT 1 FROM channel_deliveries WHERE event_id=? AND channel=? AND external_id=?')
      .get(event.id, link.channel, link.external_id)
    if (exists) continue
    if (!text) throw new Error(`No message body for ${event.kind}`)
    const isWakeTarget = link.channel === 'whatsapp' &&
      link.external_id === `${controlNumber.replace(/^\+/, '')}@c.us` && wakeEnabled
    if (queueLive) {
      enqueueOutboxReal(event, link, text, db)
      db.prepare('INSERT INTO channel_deliveries(event_id,channel,external_id,sent_at,status) VALUES(?,?,?,?,?)')
        .run(event.id, link.channel, link.external_id, now(), 'sent')
      continue
    }
    if (shadowEnabled) recordOutboxShadow(event, link, text, db)
    const mode = isWakeTarget || messageMode(db) === 'live' ? 'sent' : 'dry_run'
    let deliveryStatus = mode
    if (mode === 'sent' && hasProvider) {
      try {
        await providers[link.channel](link.external_id, text)
      } catch (sendErr) {
        console.error(`Delivery failed for event ${event.id} via ${link.channel}: ${sendErr.message}`)
        deliveryStatus = 'failed'
      }
    }
    if (mode === 'sent' && !hasProvider) {
      // Provider left this process (sender split): the operator cut-over path
      // and legacy live only differ by where delivery happens; without an
      // in-process provider nothing was really sent.
      deliveryStatus = 'dry_run'
    }
    db.prepare('INSERT INTO channel_deliveries(event_id,channel,external_id,sent_at,status) VALUES(?,?,?,?,?)')
      .run(event.id, link.channel, link.external_id, now(), deliveryStatus)
  }
  if (eligible > 0) {
    db.prepare('UPDATE events SET announced=1 WHERE id=?').run(event.id)
    const mode = queueLive || messageMode(db) === 'live' ? 'sent' : 'dry_run'
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
      const events = db.prepare(`SELECT * FROM events WHERE announced=0
        ORDER BY CASE WHEN kind IN ('assistant_attention','harness_offline','reminder_due','report_requested') THEN 0 ELSE 1 END,
        created_at LIMIT 60`).all()
      if (events.length) {
        // A day of offline scanning must never become dozens of WhatsApp
        // bubbles: coalesce the operational backlog into one grouped digest
        // before the usual per-event delivery runs.
        let handled
        try { handled = await flushWakeBacklog(events, providers, db) }
        catch (error) { console.error(`Wake backlog delivery failed: ${error.message}`); handled = new Set() }
        for (const event of events) {
          if (handled?.has(event.id)) continue
          try { await deliverEvent(event, providers, db) }
          catch (error) { console.error(`Event delivery failed (${event.id}): ${error.message}`) }
        }
      }
    } catch (error) {
      console.error(`Event dispatcher failed: ${error.message}`)
    } finally { busy = false }
  }, intervalMs)
  return () => clearInterval(timer)
}

module.exports = { deliverEvent, startEventDispatcher, checkHarnessOffline, enqueueDueReminders, messageMode, outboxMode }
