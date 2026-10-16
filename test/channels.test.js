'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { checkHarnessOffline, deliverEvent, enqueueDueReminders } = require('../channels/events')

test('offline alert is emitted once and can recur after the harness recovers', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-events-'))
  const db = openDatabase(path.join(directory, 'test.db'))
  runMigrations(db)
  t.after(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  test('due reminders enqueue once and send only to the selected linked channel', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-reminders-'))
    const db = openDatabase(path.join(directory, 'test.db'))
    runMigrations(db)
    const timestamp = new Date().toISOString()
    db.prepare("UPDATE settings SET value='live',updated_at=? WHERE key='message_mode'").run(timestamp)
    db.prepare(`INSERT INTO users(id,name,email,createdAt,updatedAt,role)
      VALUES('owner-1','Owner','owner@example.test',?,?,'Owner')`).run(timestamp, timestamp)
    db.prepare(`INSERT INTO user_channels(id,user_id,channel,external_id,verified_at)
      VALUES('telegram-1','owner-1','telegram','chat-1',?)`).run(timestamp)
    db.prepare(`INSERT INTO user_channels(id,user_id,channel,external_id,verified_at)
      VALUES('email-1','owner-1','email','owner@example.test',?)`).run(timestamp)
    db.prepare(`INSERT INTO reminders(id,target_type,target_id,user_id,due_at,channel,dedupe_key,created_at,message)
      VALUES('reminder-1','general','','owner-1',?,'telegram','owner-1:general:one',?,'Review payroll filing')`)
      .run(new Date(Date.now() - 1000).toISOString(), timestamp)
    t.after(() => {
      db.close()
      fs.rmSync(directory, { recursive: true, force: true })
    })
    const previousMode = process.env.V8_MESSAGE_MODE
    process.env.V8_MESSAGE_MODE = 'live'
    t.after(() => {
      if (previousMode === undefined) delete process.env.V8_MESSAGE_MODE
      else process.env.V8_MESSAGE_MODE = previousMode
    })

    assert.equal(enqueueDueReminders(db), 1)
    assert.equal(enqueueDueReminders(db), 0)
    const event = db.prepare("SELECT * FROM events WHERE kind='reminder_due'").get()
    const sent = []
    assert.equal(await deliverEvent(event, {
      telegram: async (recipient, text) => sent.push({ channel: 'telegram', recipient, text }),
      email: async (recipient, text) => sent.push({ channel: 'email', recipient, text })
    }, db), true)
    assert.deepEqual(sent.map((message) => message.channel), ['telegram'])
    assert.equal(sent[0].recipient, 'chat-1')
    assert.match(sent[0].text, /Review payroll filing/)
    assert.equal(db.prepare("SELECT announced FROM events WHERE id=?").get(event.id).announced, 1)
    assert.ok(db.prepare("SELECT sent_at FROM reminders WHERE id='reminder-1'").get().sent_at)
  })

  test('outbound messages are recorded locally and never sent in default dry-run mode', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-dry-run-'))
    const db = openDatabase(path.join(directory, 'test.db'))
    runMigrations(db)
    const timestamp = new Date().toISOString()
    db.prepare(`INSERT INTO users(id,name,email,createdAt,updatedAt,role)
      VALUES('owner-1','Owner','owner@example.test',?,?,'Owner')`).run(timestamp, timestamp)
    db.prepare(`INSERT INTO user_channels(id,user_id,channel,external_id,verified_at)
      VALUES('telegram-1','owner-1','telegram','chat-1',?)`).run(timestamp)
    db.prepare(`INSERT INTO reminders(id,target_type,target_id,user_id,due_at,channel,dedupe_key,created_at,message)
      VALUES('reminder-dry','general','','owner-1',?,'telegram','owner-1:general:dry',?,'Dry-run preview')`)
      .run(new Date(Date.now() - 1000).toISOString(), timestamp)
    t.after(() => {
      db.close()
      fs.rmSync(directory, { recursive: true, force: true })
    })
    const previousMode = process.env.V8_MESSAGE_MODE
    process.env.V8_MESSAGE_MODE = 'live'
    t.after(() => {
      if (previousMode === undefined) delete process.env.V8_MESSAGE_MODE
      else process.env.V8_MESSAGE_MODE = previousMode
    })

    enqueueDueReminders(db)
    const event = db.prepare("SELECT * FROM events WHERE kind='reminder_due'").get()
    let sends = 0
    assert.equal(await deliverEvent(event, {
      telegram: async () => { sends += 1 }
    }, db), true)
    assert.equal(sends, 0)
    assert.equal(db.prepare('SELECT status FROM channel_deliveries WHERE event_id=?').get(event.id).status, 'dry_run')
    assert.equal(db.prepare("SELECT delivery_status FROM reminders WHERE id='reminder-dry'").get().delivery_status, 'dry_run')
    assert.equal(db.prepare('SELECT announced FROM events WHERE id=?').get(event.id).announced, 1)
  })

  const stale = new Date(Date.now() - 4 * 60 * 1000).toISOString()
  db.prepare('UPDATE harness_status SET last_heartbeat=? WHERE id=1').run(stale)
  assert.equal(checkHarnessOffline(db), true)
  assert.equal(checkHarnessOffline(db), false)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='harness_offline'").get().n, 1)
  db.prepare('UPDATE harness_status SET last_heartbeat=? WHERE id=1').run(new Date().toISOString())
  assert.equal(checkHarnessOffline(db), false)
  db.prepare('UPDATE harness_status SET last_heartbeat=? WHERE id=1').run(stale)
  assert.equal(checkHarnessOffline(db), true)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='harness_offline'").get().n, 2)
})
