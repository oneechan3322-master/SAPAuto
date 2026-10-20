'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')

test('migrations apply once and create the planned tables', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-'))
  const db = openDatabase(path.join(directory, 'test.db'))
  t.after(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  assert.equal(runMigrations(db).length, 26)
  assert.deepEqual(runMigrations(db), [])
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all().map((row) => row.name)
  for (const table of ['companies', 'tasks', 'obligations', 'payments', 'messages', 'harness_status', 'users', 'reminders', 'reports', 'code_upgrade_proposals']) {
    assert.ok(tables.includes(table), `expected ${table} table`)
  }
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1)
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal')
})

test('core register upserts are idempotent on the natural key', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-'))
  const db = openDatabase(path.join(directory, 'test.db'))
  t.after(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  runMigrations(db)
  const companyId = 'company-1'
  db.prepare(`INSERT INTO companies(id, name, account_key, created_at, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(companyId, 'Example', 'account-1')
  const insert = db.prepare(`INSERT INTO tasks
    (id, company_id, account_key, doc_number, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(account_key, doc_number) DO UPDATE SET title = excluded.title`)
  insert.run('task-1', companyId, 'account-1', 'doc-1', 'first')
  insert.run('task-2', companyId, 'account-1', 'doc-1', 'updated')
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count, 1)
  assert.equal(db.prepare('SELECT title FROM tasks').get().title, 'updated')
})
