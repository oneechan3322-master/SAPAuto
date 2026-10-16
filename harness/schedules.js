'use strict'

const { getDatabase } = require('../db/connect')
const { id, now } = require('../db/queries/shared')
const { createBackup } = require('./backup')

function cairoParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit',
    year: 'numeric', month: '2-digit', day: '2-digit', hourCycle: 'h23'
  }).formatToParts(date)
  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

function insertDailyEvent(db, kind, day, payload = {}) {
  const key = `${kind}:${day}`
  const exists = db.prepare("SELECT 1 FROM events WHERE kind=? AND json_extract(payload,'$.dedupeKey')=?").get(kind, key)
  if (!exists) db.prepare(`INSERT INTO events(id,kind,payload,created_at) VALUES(?,?,?,?)`)
    .run(id('event'), kind, JSON.stringify({ ...payload, dedupeKey: key }), now())
}

function createDeadlineReminders(db, day) {
  const owner = db.prepare("SELECT id FROM users WHERE role='Owner' AND disabled=0 LIMIT 1").get()
  if (!owner) return
  const obligations = db.prepare(`SELECT id,deadline FROM obligations
    WHERE status NOT IN ('done','submitted','resolved') AND deadline <> ''`).all()
  const current = new Date(`${day}T12:00:00+02:00`)
  for (const obligation of obligations) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(obligation.deadline)) continue
    const due = new Date(`${obligation.deadline}T12:00:00+02:00`)
    const days = Math.round((due - current) / 86400000)
    if (![0, 1, 3, 7].includes(days)) continue
    const key = `${obligation.id}:${days}`
    const inserted = db.prepare(`INSERT OR IGNORE INTO reminders(id,target_type,target_id,user_id,due_at,channel,dedupe_key,created_at)
      VALUES(?,?,?,?,?,'launcher',?,?)`).run(
      id('reminder'), 'obligation', obligation.id, owner.id, now(), key, now()
    )
    if (inserted.changes) db.prepare(`INSERT INTO events(id,kind,entity_id,payload,created_at)
      VALUES(?,?,?,?,?)`).run(id('event'), 'deadline_reminder', obligation.id,
      JSON.stringify({ obligationId: obligation.id, days }), now())
  }
}

async function scheduleTick(db = getDatabase(), backup = createBackup) {
  const p = cairoParts()
  const day = `${p.year}-${p.month}-${p.day}`
  const time = `${p.hour}:${p.minute}`
  if (time === '08:30') insertDailyEvent(db, 'morning_briefing', day)
  if (time === '02:00') {
    const backupKey = `backup:${day}`
    const found = db.prepare("SELECT 1 FROM settings WHERE key=?").get(backupKey)
    if (!found) {
      await backup({ db })
      db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
        .run(backupKey, 'done', now())
    }
  }
  if (p.minute.endsWith('0')) createDeadlineReminders(db, day)
}

function startSchedules(db = getDatabase(), intervalMs = 60000) {
  let busy = false
  const timer = setInterval(async () => {
    if (busy) return
    busy = true
    try { await scheduleTick(db) }
    catch (error) { console.error(`Schedule tick failed: ${error.message}`) }
    finally { busy = false }
  }, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}

module.exports = { cairoParts, scheduleTick, startSchedules }
