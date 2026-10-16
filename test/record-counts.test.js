'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { getRecordCounts } = require('../domain/record-counts.cjs')

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-record-counts-'))
  const db = openDatabase(path.join(directory, 'test.db'))
  runMigrations(db)
  t.after(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return db
}

test('summary counts match visible records and use Cairo dates with honest unknown states', (t) => {
  const db = fixture(t)
  const timestamp = '2026-04-21T12:00:00.000Z'
  db.prepare(`INSERT INTO companies(id,name,account_key,last_scanned_at,created_at,updated_at)
    VALUES('company-1','Company One','acct-1','2026-04-19T12:00:00.000Z',?,?)`).run(timestamp, timestamp)
  const task = db.prepare(`INSERT INTO tasks
    (id,company_id,account_key,doc_number,title,deadline,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)`)
  task.run('task-open', 'company-1', 'acct-1', 'doc-open', 'Open', '2026-04-20', 'open', timestamp, timestamp)
  task.run('task-done', 'company-1', 'acct-1', 'doc-done', 'Done', '2026-04-20', 'done', timestamp, timestamp)
  task.run('task-removed', 'company-1', 'acct-1', 'doc-removed', 'Removed', '2026-04-20', 'removed', timestamp, timestamp)
  db.prepare(`INSERT INTO obligations
    (id,company_id,account_key,obligation_code,title,deadline,status,created_at,updated_at)
    VALUES('obligation-unknown','company-1','acct-1','obl-unknown','Unknown','2026-04-20','unknown',?,?),
      ('obligation-open','company-1','acct-1','obl-open','Open','2026-04-21','open',?,?)`)
    .run(timestamp, timestamp, timestamp, timestamp)
  db.prepare(`INSERT INTO payments
    (id,company_id,account_key,claim_number,amount,currency,due_date,status,created_at,updated_at)
    VALUES('payment-open','company-1','acct-1','claim-open',10,'EGP','2026-04-20','في انتظار السداد',?,?),
      ('payment-unknown','company-1','acct-1','claim-unknown',20,'EGP','2026-04-20','unknown',?,?),
      ('payment-paid','company-1','acct-1','claim-paid',30,'EGP','2026-04-20','paid',?,?)`)
    .run(timestamp, timestamp, timestamp, timestamp, timestamp, timestamp)
  db.prepare(`INSERT INTO messages
    (id,company_id,account_key,portal_message_id,created_at,is_read)
    VALUES('message-unread','company-1','acct-1','msg-unread',?,0),
      ('message-read','company-1','acct-1','msg-read',?,1)`).run(timestamp, timestamp)
  db.prepare(`INSERT INTO failures(id,account_key,occurred_at,reason)
    VALUES('failure-open','acct-1',?,'Unavailable')`).run(timestamp)
  db.prepare(`INSERT INTO assistant_attention
    (id,dedupe_key,category,title,state,created_at,updated_at)
    VALUES('attention-open','attention:open','test','Review','open',?,?),
      ('attention-cleared','attention:cleared','test','Done','cleared',?,?)`)
    .run(timestamp, timestamp, timestamp, timestamp)
  db.prepare(`INSERT INTO events(id,kind,created_at)
    VALUES('event-today','new_doc','2026-04-20T22:00:00.000Z')`).run()

  const counts = getRecordCounts(db, new Date(timestamp))
  const visibleTasks = db.prepare('SELECT status FROM tasks').all()
    .filter((row) => require('../domain/record-status.cjs').isOpenRecord('tasks', row.status)).length
  assert.equal(counts.tasks, visibleTasks)
  assert.equal(counts.tasks, 1)
  assert.equal(counts.obligations, 1)
  assert.equal(counts.unknownObligations, 1)
  assert.equal(counts.payments, 3)
  assert.equal(counts.openPayments, 1)
  assert.equal(counts.overduePayments, 1)
  assert.equal(counts.overdueTasks, 1)
  assert.equal(counts.overdueObligations, 0)
  assert.equal(counts.dueSoonObligations, 1)
  assert.equal(counts.unreadMessages, 1)
  assert.equal(counts.openFailures, 1)
  assert.equal(counts.openAttention, 1)
  assert.equal(counts.newToday, 1)
  assert.equal(counts.staleCompanies, 1)
  assert.equal(counts.neverScannedCompanies, 0)
})
