'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { createAuthenticatedCookie } = require('./helpers/auth-session.cjs')

test('company-link route assigns failures, reminders, and reports to a verified company', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-company-link-'))
  const databasePath = path.join(directory, 'company-link-test.db')
  const previousRoot = process.env.V8_ROOT
  const previousDatabasePath = process.env.V8_DB_PATH
  process.env.V8_ROOT = path.resolve(__dirname, '..')
  process.env.V8_DB_PATH = databasePath
  const fixture = openDatabase(databasePath)
  runMigrations(fixture)
  fixture.prepare(`INSERT INTO companies
    (id,name,account_key,name_source,created_at,updated_at)
    VALUES('company-1','شركة النور','account-1','manual','2026-10-01','2026-10-01')`).run()
  fixture.prepare(`INSERT INTO companies
    (id,name,account_key,name_source,created_at,updated_at)
    VALUES('company-2','شركة القمر','account-2','manual','2026-10-01','2026-10-01')`).run()
  fixture.prepare(`INSERT INTO users(id,name,email,createdAt,updatedAt)
    VALUES('user-1','Tester','tester@example.test','2026-10-01','2026-10-01')`).run()
  fixture.prepare(`INSERT INTO tasks
    (id,company_id,account_key,doc_number,title,created_at,updated_at)
    VALUES('task-1','company-1','account-1','document-1','Task','2026-10-15','2026-10-15')`).run()
  fixture.prepare(`INSERT INTO failures(id,account_key,occurred_at,reason)
    VALUES('failure-1','unknown-account','2026-10-15','Connection failed')`).run()
  fixture.prepare(`INSERT INTO reminders(id,target_type,target_id,user_id,due_at,dedupe_key,created_at)
    VALUES('reminder-1','manual','','user-1','2026-10-20','reminder-1','2026-10-15')`).run()
  fixture.prepare(`INSERT INTO reminders(id,target_type,target_id,user_id,due_at,dedupe_key,created_at)
    VALUES('reminder-source','task','task-1','user-1','2026-10-20','reminder-source','2026-10-15')`).run()
  fixture.prepare(`INSERT INTO reports(id,user_id,channel,body,created_at)
    VALUES('report-1','user-1','launcher','Report body','2026-10-15')`).run()
  fixture.close()

  t.after(() => {
    const { getDatabase } = require('../db/connect')
    const database = getDatabase()
    if (database.open) database.close()
    if (previousDatabasePath === undefined) delete process.env.V8_DB_PATH
    else process.env.V8_DB_PATH = previousDatabasePath
    if (previousRoot === undefined) delete process.env.V8_ROOT
    else process.env.V8_ROOT = previousRoot
    fs.rmSync(directory, { recursive: true, force: true })
  })

  const [{ PUT }, { listRecords }] = await Promise.all([
    import('../launcher/app/api/records/company-link/route.js'),
    import('../launcher/lib/data.js')
  ])
  const cookie = await createAuthenticatedCookie('Operator')

  for (const [section, recordId] of [
    ['failures', 'failure-1'],
    ['reminders', 'reminder-1'],
    ['reports', 'report-1']
  ]) {
    const response = await PUT(new Request('http://localhost/api/records/company-link', {
      method: 'PUT',
      headers: {
        host: 'localhost',
        origin: 'http://localhost',
        cookie,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ section, recordId, companyId: 'company-1' })
    }))
    assert.equal(response.status, 200, `${section} should be linked`)
    assert.equal((await response.json()).companyName, 'شركة النور')
    const linkedRecord = listRecords(section).find((row) => row.id === recordId)
    assert.equal(linkedRecord.company_id, 'company-1')
    assert.equal(linkedRecord.company_name, 'شركة النور')
  }

  const invalidSection = await PUT(new Request('http://localhost/api/records/company-link', {
    method: 'PUT',
    headers: { host: 'localhost', origin: 'http://localhost', cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ section: 'toString', recordId: 'payment-1', companyId: 'company-1' })
  }))
  assert.equal(invalidSection.status, 400)

  const linkedReminder = await PUT(new Request('http://localhost/api/records/company-link', {
    method: 'PUT',
    headers: { host: 'localhost', origin: 'http://localhost', cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ section: 'reminders', recordId: 'reminder-source', companyId: 'company-2' })
  }))
  assert.equal(linkedReminder.status, 409)
})
