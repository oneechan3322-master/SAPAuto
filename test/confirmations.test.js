'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { getDatabase, openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { createConfirmation, decideConfirmation, listPendingConfirmations } = require('../assistant/confirmations')
const addReminder = require('../assistant/tools/add-reminder')

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-confirm-'))
  const databasePath = path.join(directory, 'test.db')
  const previousPath = process.env.V8_DB_PATH
  process.env.V8_DB_PATH = databasePath
  const db = openDatabase(databasePath)
  runMigrations(db)
  const timestamp = new Date().toISOString()
  db.prepare(`INSERT INTO users(id,name,email,createdAt,updatedAt,role)
    VALUES('owner-1','Owner','owner@example.test',?,?,'Owner')`).run(timestamp, timestamp)
  t.after(() => {
    getDatabase().close()
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
    if (previousPath === undefined) delete process.env.V8_DB_PATH
    else process.env.V8_DB_PATH = previousPath
  })
  return db
}

test('confirmation is user-owned, deduplicated, single-use, and executes only after approval', async (t) => {
  const db = fixture(t)
  const args = { target_type: 'company', target_id: 'company-1', text: 'Review payroll' }
  const confirmationId = createConfirmation({ userId: 'owner-1', toolName: 'save_note', args, db })
  assert.equal(createConfirmation({ userId: 'owner-1', toolName: 'save_note', args, db }), confirmationId)
  assert.equal(listPendingConfirmations('owner-1', db).length, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 0)

  await assert.rejects(
    decideConfirmation({ confirmationId, userId: 'another-user', role: 'Owner', confirm: true, db }),
    /not found/
  )
  const result = await decideConfirmation({ confirmationId, userId: 'owner-1', role: 'Owner', confirm: true, db })
  assert.equal(result.confirmed, true)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 1)
  await assert.rejects(
    decideConfirmation({ confirmationId, userId: 'owner-1', role: 'Owner', confirm: true, db }),
    /not found/
  )
})

test('declined and expired confirmations do not execute', async (t) => {
  const db = fixture(t)
  const args = { target_type: 'company', target_id: 'company-1', text: 'Do not save' }
  const declinedId = createConfirmation({ userId: 'owner-1', toolName: 'save_note', args, db })
  assert.deepEqual(await decideConfirmation({
    confirmationId: declinedId, userId: 'owner-1', role: 'Owner', confirm: false, db
  }), { declined: true })

  const expiredId = createConfirmation({
    userId: 'owner-1', toolName: 'save_note', args: { ...args, text: 'Expired' }, db
  })
  db.prepare("UPDATE assistant_confirmations SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?")
    .run(expiredId)
  await assert.rejects(
    decideConfirmation({ confirmationId: expiredId, userId: 'owner-1', role: 'Owner', confirm: true, db }),
    /expired/
  )
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 0)
})

test('assistant reminders retain their description and require an already linked outbound channel', async (t) => {
  const db = fixture(t)
  const context = { userId: 'owner-1', role: 'Owner' }
  const reminder = await addReminder({
    description: 'Call the payroll office',
    when: new Date(Date.now() + 60000).toISOString()
  }, context)
  assert.equal(reminder.added, true)
  assert.equal(db.prepare('SELECT message FROM reminders WHERE id=?').get(reminder.id).message, 'Call the payroll office')
  await assert.rejects(addReminder({
    description: 'Send me a message',
    when: new Date(Date.now() + 60000).toISOString(),
    channel: 'telegram'
  }, context), /Link this notification channel/)
})
