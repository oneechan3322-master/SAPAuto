'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { runAttentionCycle } = require('../assistant/monitor')
const { startAssistantManager } = require('../assistant/manager')

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-manager-'))
  const db = openDatabase(path.join(directory, 'test.db'))
  runMigrations(db)
  t.after(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return db
}

test('manager deduplicates open attention, clears recovered conditions, and notifies on recurrence', (t) => {
  const db = fixture(t)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date())
  db.prepare(`INSERT INTO companies(id,name,account_key,created_at,updated_at)
    VALUES('company-1','Example','acct-1',?,?)`).run(today, today)
  db.prepare(`INSERT INTO tasks(id,company_id,account_key,doc_number,title,deadline,status,created_at,updated_at)
    VALUES('task-1','company-1','acct-1','doc-1','Payroll filing',?,'open',?,?)`)
    .run(today, today, today)
  db.prepare('UPDATE harness_status SET last_heartbeat=? WHERE id=1')
    .run(new Date(Date.now() - 4 * 60 * 1000).toISOString())

  assert.equal(runAttentionCycle(db), 2)
  assert.equal(runAttentionCycle(db), 2)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='assistant_attention'").get().n, 2)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM assistant_attention WHERE state='open'").get().n, 2)

  db.prepare("UPDATE tasks SET status='done' WHERE id='task-1'").run()
  db.prepare('UPDATE harness_status SET last_heartbeat=? WHERE id=1').run(new Date().toISOString())
  assert.equal(runAttentionCycle(db), 0)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM assistant_attention WHERE state='cleared'").get().n, 2)

  db.prepare("UPDATE tasks SET status='open' WHERE id='task-1'").run()
  assert.equal(runAttentionCycle(db), 1)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='assistant_attention'").get().n, 3)
})

test('manager requests status verification instead of calling an unknown payment overdue', (t) => {
  const db = fixture(t)
  const timestamp = new Date().toISOString()
  db.prepare(`INSERT INTO companies(id,name,account_key,created_at,updated_at)
    VALUES('company-1','Example','acct-1',?,?)`).run(timestamp, timestamp)
  db.prepare(`INSERT INTO payments(id,company_id,account_key,claim_number,due_date,created_at,updated_at)
    VALUES('payment-1','company-1','acct-1','claim-1','2000-01-01',?,?)`).run(timestamp, timestamp)

  runAttentionCycle(db)
  const item = db.prepare(`SELECT category,title,details FROM assistant_attention
    WHERE dedupe_key='manager:payment:payment-1'`).get()
  assert.equal(item.category, 'payment_status_unknown')
  assert.match(item.title, /تحقق من حالة الدفع/)
  assert.match(item.details, /الحالة غير معروفة في المصدر/)
})

test('manager can be disabled from the local settings table', (t) => {
  const db = fixture(t)
  db.prepare("UPDATE settings SET value='false',updated_at=? WHERE key='assistant_manager_enabled'")
    .run(new Date().toISOString())
  const stop = startAssistantManager({ db, intervalMs: 5000 })
  t.after(stop)
  assert.equal(db.prepare('SELECT state FROM assistant_manager_status WHERE id=1').get().state, 'disabled')
  assert.equal(db.prepare('SELECT last_run_at FROM assistant_manager_status WHERE id=1').get().last_run_at, null)
})
