'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const events = require('../channels/events')

function insertEvent(db, { kind, ageDays, announced = 0 }) {
  const id = `ev_${kind}_${Math.random().toString(36).slice(2, 10)}`
  db.prepare(`INSERT INTO events(id,kind,entity_id,payload,created_at,announced)
    VALUES(?,?,?,?,?,?)`).run(id, kind, 'x', '{}',
    new Date(Date.now() - ageDays * 86400000).toISOString(), announced)
  return id
}

test('A10: migration 036 adds archived_at and stale pending events leave the live backlog', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-a10-'))
  const db = openDatabase(path.join(directory, 'a10.db'))
  try {
    runMigrations(db)
    const old = insertEvent(db, { kind: 'pdf_studied', ageDays: 10 })
    const fresh = insertEvent(db, { kind: 'pdf_studied', ageDays: 1 })
    const delivered = insertEvent(db, { kind: 'pdf_studied', ageDays: 10, announced: 1 })
    const oldWake = insertEvent(db, { kind: 'new_doc', ageDays: 30 })
    const staleReminder = insertEvent(db, { kind: 'reminder_due', ageDays: 40 })

    const archived = events.archiveStaleEvents(db)
    // 3 stale hits (pdf_studied ×1 old, new_doc old, the delivered row is
    // announced=1 → not touched, fresh stays, reminderdue is exempt):
    assert.equal(archived, 2)

    const state = (id) => db.prepare('SELECT announced, archived_at FROM events WHERE id=?').get(id)
    assert.ok(state(old).archived_at, 'stale non-deliverable event must be archived')
    assert.equal(state(old).announced, 0, 'archiving must never fake a delivery')
    assert.equal(state(fresh).archived_at, '', 'recent event stays current in the backlog')
    assert.equal(state(delivered).archived_at, '', 'delivered rows are history, not backlog')
    assert.ok(state(oldWake).archived_at, 'a stale 30-day doc-news event is archived — no month-old doc pops into a freshly linked WhatsApp')
    assert.equal(state(staleReminder).archived_at, '', 'reminder_due is exempt — it is the delivery vessel for its pending reminder')
    assert.equal(state(oldWake).announced, 0)

    // The dispatcher feed itself must no longer see the archived row.
    const feed = db.prepare(`SELECT COUNT(*) c FROM events
      WHERE announced=0 AND archived_at='' AND kind NOT IN ('reminder_due','report_requested')`).get()
    assert.equal(feed.c, 1)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('A10: the live dispatcher honors reminder delivery after archival runs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-a10-'))
  const db = openDatabase(path.join(directory, 'a10b.db'))
  try {
    runMigrations(db)
    // A pending, uncancelled reminder older than the TTL keeps its event —
    // it is the row the sender actually delivers when channels appear.
    db.prepare(`INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt,role,disabled)
      VALUES('u1','Owner Test','owner-test@example.com',0,?,?,'Owner',0)`)
      .run(new Date().toISOString(), new Date().toISOString())
    db.prepare(`INSERT INTO reminders(id,user_id,channel,target_type,target_id,dedupe_key,due_at,delivery_status,created_at)
      VALUES('r1','u1','whatsapp','general','','a10-dedupe-r1','2026-10-01T00:00:00.000Z','pending','2026-10-01T00:00:00.000Z')`).run()
    db.prepare(`INSERT INTO events(id,kind,entity_id,payload,created_at,announced)
      VALUES('reminder_due_r1','reminder_due','r1','{"userId":"u1","channel":"whatsapp"}','2026-10-01T00:00:00.000Z',0)`).run()

    const archived = events.archiveStaleEvents(db, { currentDate: new Date('2026-10-23T00:00:00.000Z') })
    assert.equal(archived, 0, 'reminder_due is exempt — archiving it would kill the pending reminder silently')
    const kept = db.prepare(`SELECT COUNT(*) c FROM events
      WHERE announced=0 AND archived_at=''`).get()
    assert.equal(kept.c, 1)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
