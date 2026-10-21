'use strict'

process.env.V8_LOG_FILE = '0'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { spawnSync } = require('node:child_process')
const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const outbox = require('../channels/outbox')
const { deliverEvent } = require('../channels/events')
const { acquireLease, renewLease, releaseLease, startLease } = require('../lib/lease')
const { writeHeartbeat } = require('../lib/heartbeat')

function freshDb(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-phase1-'))
  const db = openDatabase(path.join(directory, 'test.db'))
  runMigrations(db)
  t.after(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return db
}

function seedEvent(db, id = 'event-1', kind = 'harness_offline') {
  db.prepare('INSERT INTO events(id, kind, payload, created_at) VALUES (?, ?, ?, ?)')
    .run(id, kind, '{}', new Date().toISOString())
}

test('outbox enqueue is idempotent per event, channel, recipient', (t) => {
  const db = freshDb(t)
  seedEvent(db)
  const first = outbox.enqueue({ eventId: 'event-1', channel: 'telegram', recipient: 'chat-1', payload: { text: 'a' } }, db)
  const second = outbox.enqueue({ eventId: 'event-1', channel: 'telegram', recipient: 'chat-1', payload: { text: 'a' } }, db)
  const differentRecipient = outbox.enqueue({ eventId: 'event-1', channel: 'telegram', recipient: 'chat-2', payload: { text: 'a' } }, db)
  assert.equal(first.inserted, true)
  assert.equal(second.inserted, false)
  assert.equal(differentRecipient.inserted, true)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n, 2)
})

test('claim leases due rows and increments attempts; shadow rows are never claimed', (t) => {
  const db = freshDb(t)
  seedEvent(db)
  outbox.enqueue({ eventId: 'event-1', channel: 'telegram', recipient: 'chat-1', payload: { text: 'a' } }, db)
  outbox.enqueue({ eventId: 'event-1', channel: 'telegram', recipient: 'chat-2', payload: { text: 'a' }, shadow: true }, db)

  const rows = outbox.claim('telegram', 10, db)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'sending')
  assert.equal(rows[0].attempts, 1)
  assert.ok(rows[0].lease_owner)
  assert.ok(rows[0].lease_until)
  assert.equal(outbox.claim('telegram', 10, db).length, 0, 'a leased row is not re-claimed')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notification_outbox WHERE shadow = 1').get().n, 1)
})

test('drain marks sent with the provider id, then fails with backoff and dies after max attempts', async (t) => {
  const db = freshDb(t)
  seedEvent(db, 'event-ok')
  seedEvent(db, 'event-bad')
  outbox.enqueue({ eventId: 'event-ok', channel: 'email', recipient: 'a@example.test', payload: { text: 'ok' } }, db)
  outbox.enqueue({ eventId: 'event-bad', channel: 'email', recipient: 'b@example.test', payload: { text: 'bad' } }, db)

  const okResult = await outbox.drain('email', async (recipient) => {
    assert.equal(recipient, 'a@example.test')
    return { messageId: 'provider-42' }
  }, { batch: 1, gapMs: 0, db })
  assert.deepEqual(okResult, { claimed: 1, sent: 1, failed: 0 })
  const sentRow = db.prepare("SELECT * FROM notification_outbox WHERE event_id = 'event-ok'").get()
  assert.equal(sentRow.status, 'sent')
  assert.equal(sentRow.provider_msg_id, 'provider-42')
  assert.ok(sentRow.sent_at)

  const alwaysFail = async () => { throw new Error('provider down') }
  let lastStatus = ''
  for (let attempt = 1; attempt <= outbox.MAX_ATTEMPTS; attempt += 1) {
    // Fast-forward the backoff so the next attempt is due immediately.
    db.prepare("UPDATE notification_outbox SET next_attempt_at = ? WHERE event_id = 'event-bad'")
      .run(new Date(Date.now() - 1000).toISOString())
    const result = await outbox.drain('email', alwaysFail, { batch: 1, gapMs: 0, db })
    assert.equal(result.failed, 1)
    lastStatus = db.prepare("SELECT status FROM notification_outbox WHERE event_id = 'event-bad'").get().status
  }
  assert.equal(lastStatus, 'dead')
  const failedRow = db.prepare("SELECT * FROM notification_outbox WHERE event_id = 'event-bad'").get()
  assert.equal(failedRow.attempts, outbox.MAX_ATTEMPTS)
  assert.match(failedRow.last_error, /provider down/)
})

test('an expired sending lease is parked as uncertain, never auto-retried', (t) => {
  const db = freshDb(t)
  seedEvent(db)
  outbox.enqueue({ eventId: 'event-1', channel: 'whatsapp', recipient: '20100000000@c.us', payload: { text: 'x' } }, db)
  outbox.claim('whatsapp', 1, db)
  db.prepare("UPDATE notification_outbox SET lease_until = ?").run(new Date(Date.now() - 1000).toISOString())

  const recovered = outbox.recoverExpiredLeases(db)
  assert.equal(recovered, 1)
  const row = db.prepare('SELECT * FROM notification_outbox').get()
  assert.equal(row.status, 'uncertain')
  assert.equal(row.lease_owner, null)
  assert.equal(outbox.claim('whatsapp', 1, db).length, 0, 'uncertain rows are not claimed')

  assert.equal(outbox.resetForResend(row.id, db), true)
  assert.equal(db.prepare('SELECT status FROM notification_outbox').get().status, 'pending')
})

test('outbox stats separate real backlog from shadow records', (t) => {
  const db = freshDb(t)
  seedEvent(db)
  outbox.enqueue({ eventId: 'event-1', channel: 'telegram', recipient: 'chat-1', payload: { text: 'a' } }, db)
  outbox.enqueue({ eventId: 'event-1', channel: 'telegram', recipient: 'chat-1', payload: { text: 'a' }, shadow: true }, db)
  const stats = outbox.outboxStats(db)
  assert.equal(stats.backlog, 1)
  assert.equal(stats.shadow, 1)
  assert.equal(stats.dead, 0)
  assert.ok(stats.oldest)
})

test('deliverEvent records a shadow row without changing delivery behaviour', async (t) => {
  const db = freshDb(t)
  const timestamp = new Date().toISOString()
  db.prepare(`INSERT INTO users(id,name,email,createdAt,updatedAt,role)
    VALUES('owner-1','Owner','owner@example.test',?,?,'Owner')`).run(timestamp, timestamp)
  db.prepare(`INSERT INTO user_channels(id,user_id,channel,external_id,verified_at)
    VALUES('telegram-1','owner-1','telegram','chat-1',?)`).run(timestamp)
  seedEvent(db, 'event-shadow', 'harness_offline')

  const event = db.prepare("SELECT * FROM events WHERE id = 'event-shadow'").get()
  const sent = []
  const providers = { telegram: async (recipient, text) => sent.push({ recipient, text }) }

  assert.equal(await deliverEvent(event, providers, db), true)
  const shadowRows = db.prepare('SELECT * FROM notification_outbox WHERE shadow = 1').all()
  assert.equal(shadowRows.length, 1)
  assert.equal(shadowRows[0].channel, 'telegram')
  assert.equal(shadowRows[0].recipient, 'chat-1')
  assert.match(JSON.parse(shadowRows[0].payload_json).text, /محرك SAPAuto/)
  assert.equal(outbox.claim('telegram', 10, db).length, 0, 'shadow rows are invisible to senders')
  // Dry-run default: the provider was not actually called.
  assert.equal(sent.length, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM channel_deliveries').get().n, 1)

  // Turning shadow mode off stops the recording.
  db.prepare(`INSERT INTO settings(key, value, updated_at)
    VALUES('outbox_mode','off',?)
    ON CONFLICT(key) DO UPDATE SET value='off', updated_at=excluded.updated_at`).run(timestamp)
  seedEvent(db, 'event-no-shadow', 'harness_offline')
  const second = db.prepare("SELECT * FROM events WHERE id = 'event-no-shadow'").get()
  await deliverEvent(second, providers, db)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notification_outbox WHERE shadow = 1').get().n, 1)
})

test('a service lease is exclusive, renewable, and reclaimable after expiry', (t) => {
  const db = freshDb(t)
  const first = acquireLease('harness', { ttlMs: 200, db })
  assert.equal(first.acquired, true)
  assert.equal(acquireLease('harness', { ttlMs: 200, db }).acquired, false, 'second copy is refused while the lease is held')
  assert.equal(renewLease(first, { ttlMs: 200, db }), true)

  db.prepare('UPDATE service_locks SET expires_at = ? WHERE service = ?')
    .run(new Date(Date.now() - 1000).toISOString(), 'harness')
  const second = acquireLease('harness', { ttlMs: 200, db })
  assert.equal(second.acquired, true, 'an expired lease can be taken over')
  assert.equal(renewLease(first, { ttlMs: 200, db }), false, 'the previous owner can no longer renew')

  releaseLease(second, db)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM service_locks').get().n, 0)
})

test('startLease keeps ownership renewed and releases on stop', async (t) => {
  const db = freshDb(t)
  const lease = startLease('harness', { ttlMs: 1200, db })
  assert.equal(lease.acquired, true)
  await new Promise((resolve) => setTimeout(resolve, 600))
  const row = db.prepare("SELECT * FROM service_locks WHERE service = 'harness'").get()
  assert.ok(Date.parse(row.expires_at) > Date.now(), 'lease stayed valid through renewal')
  lease.stop()
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM service_locks').get().n, 0)
})

test('heartbeats upsert one row per service', (t) => {
  const db = freshDb(t)
  writeHeartbeat('harness', { meta: { cycle: 1 }, db, pid: 111 })
  writeHeartbeat('harness', { meta: { cycle: 2 }, db, pid: 111 })
  writeHeartbeat('channels', { status: 'degraded', db, pid: 222 })
  const rows = db.prepare('SELECT * FROM service_status ORDER BY service').all()
  assert.equal(rows.length, 2)
  assert.equal(rows[0].service, 'channels')
  assert.equal(rows[0].status, 'degraded')
  assert.deepEqual(JSON.parse(rows[1].meta_json), { cycle: 2 })
})

test('shutdown runs cleanup once and exits cleanly on the PM2 message', () => {
  const script = `
    const { installShutdown } = require('./lib/shutdown')
    installShutdown(async () => { console.log('cleanup-ran') })
    process.emit('message', 'shutdown')
    setTimeout(() => { console.log('still-running'); process.exit(3) }, 3000)
  `
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, V8_LOG_FILE: '0' }
  })
  assert.equal(result.status, 0, `expected clean exit, got ${result.status}: ${result.stderr}`)
  assert.match(result.stdout, /cleanup-ran/)
  assert.doesNotMatch(result.stdout, /still-running/)
})

test('outbox rows accept command ids without an events row (migration 033)', (t) => {
  const db = freshDb(t)
  const foreignKeys = db.pragma("foreign_keys_list(notification_outbox)")
  assert.deepEqual(foreignKeys, [], 'no outbox FK may block command rows anymore')
  const queued = outbox.enqueue({
    eventId: 'channel-test-cmd-1',
    channel: 'whatsapp',
    recipient: '20100000000@c.us',
    payload: { text: 'test', kind: 'channel_test' }
  }, db)
  assert.equal(queued.inserted, true)
  const claimed = outbox.claim('whatsapp', 5, db)
  assert.equal(claimed.length, 1)
})

test('outbox.defer releases a transport outage without an attempt penalty', (t) => {
  const db = freshDb(t)
  seedEvent(db)
  outbox.enqueue({ eventId: 'event-1', channel: 'whatsapp', recipient: '20100000000@c.us', payload: { text: 'x' } }, db)
  const [row] = outbox.claim('whatsapp', 1, db)
  assert.equal(row.attempts, 1)
  outbox.defer(row.id, { seconds: 30, db })
  const released = db.prepare('SELECT * FROM notification_outbox WHERE id=?').get(row.id)
  assert.equal(released.status, 'pending')
  assert.equal(released.attempts, 0)
  assert.ok(Date.parse(released.next_attempt_at) > Date.now())
  assert.equal(released.lease_owner, null)
})

test('deliverEvent queues real rows for senders when outbox_mode is live', async (t) => {
  const db = freshDb(t)
  const timestamp = new Date().toISOString()
  db.prepare(`INSERT INTO users(id,name,email,createdAt,updatedAt,role)
    VALUES('owner-1','Owner','owner@example.test',?,?,'Owner')`).run(timestamp, timestamp)
  db.prepare(`INSERT INTO user_channels(id,user_id,channel,external_id,verified_at)
    VALUES('whatsapp-1','owner-1','whatsapp','20100000000@c.us',?)`).run(timestamp)
  seedEvent(db, 'event-live', 'harness_offline')
  db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('outbox_mode','live',?)
    ON CONFLICT(key) DO UPDATE SET value='live',updated_at=excluded.updated_at`).run(timestamp)

  const event = db.prepare("SELECT * FROM events WHERE id = 'event-live'").get()
  const noProvider = {}
  assert.equal(await deliverEvent(event, noProvider, db), true)

  const rows = db.prepare('SELECT * FROM notification_outbox').all()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].event_id, 'event-live')
  assert.equal(rows[0].channel, 'whatsapp')
  assert.equal(rows[0].recipient, '20100000000@c.us')
  assert.equal(rows[0].shadow, 0)
  assert.equal(rows[0].status, 'pending')
  // The dispatcher never called a provider; the queued row is the record.
  assert.deepEqual(noProvider, {})
  assert.equal(db.prepare("SELECT status FROM channel_deliveries WHERE event_id='event-live'").get().status, 'sent')
  // Idempotent: a dispatcher replay must not queue a second real message.
  assert.equal(await deliverEvent(event, noProvider, db), true)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n, 1)
})

test('shadow mirroring survives the sender split without provider objects', async (t) => {
  const db = freshDb(t)
  const timestamp = new Date().toISOString()
  db.prepare(`INSERT INTO users(id,name,email,createdAt,updatedAt,role)
    VALUES('owner-1','Owner','owner@example.test',?,?,'Owner')`).run(timestamp, timestamp)
  db.prepare(`INSERT INTO user_channels(id,user_id,channel,external_id,verified_at)
    VALUES('telegram-1','owner-1','telegram','chat-9',?)`).run(timestamp)
  seedEvent(db, 'event-no-prov', 'harness_offline')

  const event = db.prepare("SELECT * FROM events WHERE id = 'event-no-prov'").get()
  assert.equal(await deliverEvent(event, {}, db), true)
  const rows = db.prepare('SELECT * FROM notification_outbox').all()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].channel, 'telegram')
  assert.equal(rows[0].shadow, 1)
  assert.equal(outbox.claim('telegram', 10, db).length, 0, 'shadow rows stay invisible')
})

test('a dry_run reminder in live outbox mode is queued, not skipped', async (t) => {
  const db = freshDb(t)
  const timestamp = new Date().toISOString()
  db.prepare(`INSERT INTO users(id,name,email,createdAt,updatedAt,role)
    VALUES('owner-1','Owner','owner@example.test',?,?,'Owner')`).run(timestamp, timestamp)
  db.prepare(`INSERT INTO user_channels(id,user_id,channel,external_id,verified_at)
    VALUES('telegram-1','owner-1','telegram','chat-1',?)`).run(timestamp)
  db.prepare(`INSERT INTO reminders(id,target_type,target_id,user_id,due_at,channel,dedupe_key,created_at,message)
    VALUES('reminder-q','general','','owner-1',?,'telegram','owner-1:general:q',?,'Queue me')`)
    .run(new Date(Date.now() - 1000).toISOString(), timestamp)
  db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('outbox_mode','live',?)
    ON CONFLICT(key) DO UPDATE SET value='live',updated_at=excluded.updated_at`).run(timestamp)

  // The due-reminders event row is produced by the dispatcher helper itself.
  const { enqueueDueReminders } = require('../channels/events')
  assert.equal(enqueueDueReminders(db), 1)
  const event = db.prepare("SELECT * FROM events WHERE kind='reminder_due'").get()
  assert.equal(await deliverEvent(event, {}, db), true)
  const row = db.prepare("SELECT * FROM notification_outbox WHERE event_id=?").get(event.id)
  assert.ok(row, 'the reminder delivery was queued for the senders')
  assert.equal(row.channel, 'telegram')
  assert.equal(db.prepare("SELECT delivery_status FROM reminders WHERE id='reminder-q'").get().delivery_status, 'sent')
})
