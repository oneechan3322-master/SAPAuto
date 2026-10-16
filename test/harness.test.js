'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { createCommand } = require('../db/queries/commands')
const { runLoop, scanOne } = require('../harness/loop')
const { baseDirectory } = require('../harness/source')
const { minutesUntilQuietEnd, nextCycleTime } = require('../harness/quiet-hours')
const { ingestAccount } = require('../harness/ingest')
const { processOneControlCommand } = require('../harness/commands')

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-harness-'))
  const db = openDatabase(path.join(directory, 'test.db'))
  runMigrations(db)
  t.after(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return db
}

test('account ingestion is idempotent and creates a single new-document event', (t) => {
  const db = fixture(t)
  const result = {
    account: { key: 'acct-1', label: 'Company One' },
    login: { success: true }, tasks: [{ docNumber: 'd-1', docTitle: 'Filing', deadline: '2026-10-20' }],
    obligations: [], payments: [], messages: [], diffs: []
  }
  ingestAccount(result, db)
  ingestAccount(result, db)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 1)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='new_doc'").get().n, 1)
})

test('ingestion preserves absent amounts, currency, status, urgency, and message severity as missing', (t) => {
  const db = fixture(t)
  ingestAccount({
    account: { key: 'acct-1', label: 'Company One' },
    login: { success: true },
    tasks: [{ docNumber: 'task-1', docTitle: 'Review' }],
    obligations: [{ obligationCode: 'obligation-1', formLabel: 'Return' }],
    payments: [{ claimNumber: 'claim-1', amount: null, payBefore: '2026-10-20' }],
    messages: [{ portalMessageId: 'message-1', title: 'Notice' }]
  }, db)

  assert.equal(db.prepare("SELECT urgency FROM tasks WHERE doc_number='task-1'").get().urgency, '')
  assert.equal(db.prepare("SELECT status FROM obligations WHERE obligation_code='obligation-1'").get().status, '')
  assert.deepEqual(
    db.prepare("SELECT amount,currency,status FROM payments WHERE claim_number='claim-1'").get(),
    { amount: null, currency: '', status: '' }
  )
  assert.equal(db.prepare("SELECT severity FROM messages WHERE portal_message_id='message-1'").get().severity, '')
})

test('ingestion preserves manually verified company identity', (t) => {
  const db = fixture(t)
  const result = {
    account: { key: 'acct-1', label: 'Portal Account' },
    login: { success: true }, tasks: [], obligations: [], payments: [], messages: [], diffs: []
  }
  ingestAccount(result, db)
  db.prepare(`UPDATE companies SET name='شركة النور',name_source='manual',
    english_name='Al Noor',tax_registration_number='00123' WHERE account_key='acct-1'`).run()
  ingestAccount({ ...result, account: { ...result.account, label: 'Changed Portal Label' } }, db)
  assert.deepEqual(
    db.prepare(`SELECT name,name_source,english_name,tax_registration_number
      FROM companies WHERE account_key='acct-1'`).get(),
    {
      name: 'شركة النور',
      name_source: 'manual',
      english_name: 'Al Noor',
      tax_registration_number: '00123'
    }
  )
})

test('removed portal documents emit one event and reappearing documents are new again', (t) => {
  const db = fixture(t)
  const result = {
    account: { key: 'acct-1', label: 'Company One' },
    login: { success: true }, tasks: [{ docNumber: 'd-1', docTitle: 'Filing' }],
    obligations: [], payments: [], messages: [], diffs: []
  }
  ingestAccount(result, db)
  ingestAccount({ ...result, tasks: [] }, db)
  ingestAccount({ ...result, tasks: [] }, db)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='removed_doc'").get().n, 1)
  assert.equal(db.prepare("SELECT status FROM tasks WHERE doc_number='d-1'").get().status, 'removed')
  ingestAccount(result, db)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='new_doc'").get().n, 2)
})

test('three consecutive account failures park the account and record the failure', async (t) => {
  const db = fixture(t)
  const account = { username: 'acct-1' }
  const scanner = async () => { throw new Error('portal unavailable') }
  await scanOne(account, 1, 1, db, scanner)
  await scanOne(account, 1, 1, db, scanner)
  await scanOne(account, 1, 1, db, scanner)
  const state = db.prepare('SELECT state,consecutive_failures,parked_until FROM account_status WHERE account_key=?').get('acct-1')
  assert.equal(state.state, 'parked')
  assert.equal(state.consecutive_failures, 3)
  assert.ok(Date.parse(state.parked_until) > Date.now())
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM failures').get().n, 3)
})

test('pause command is completed and updates the harness state', async (t) => {
  const db = fixture(t)
  createCommand('pause', {}, 'owner', db)
  assert.equal(await processOneControlCommand({ db }), true)
  assert.equal(db.prepare('SELECT paused FROM harness_status WHERE id=1').get().paused, 1)
  assert.equal(db.prepare('SELECT status FROM commands').get().status, 'done')
})

test('quiet hours delay automatic cycles using Cairo time', () => {
  const duringQuiet = new Date('2026-01-01T00:30:00.000Z')
  assert.equal(minutesUntilQuietEnd('01:00-06:00', duringQuiet), 210)
  assert.equal(minutesUntilQuietEnd('01:00-06:00', new Date('2026-01-01T04:00:00.000Z')), 0)
  assert.equal(minutesUntilQuietEnd('22:00-06:00', new Date('2026-01-01T20:00:00.000Z')), 480)
  assert.throws(() => minutesUntilQuietEnd('25:00-06:00'), /invalid time/)
  assert.equal(
    nextCycleTime(new Date('2026-01-01T00:00:00.000Z'), 180, '01:00-06:00').toISOString(),
    '2026-01-01T04:00:00.000Z'
  )
})

test('SAPAuto3 source path resolves from V8_ROOT when bundled by the launcher', () => {
  const previousRoot = process.env.V8_ROOT
  const previousBase = process.env.V8_BASE_DIR
  process.env.V8_ROOT = 'C:\\sapauto\\v8'
  delete process.env.V8_BASE_DIR
  try {
    assert.equal(baseDirectory(), path.resolve('C:\\sapauto\\v8', '..\\SAPAuto3'))
  } finally {
    if (previousRoot === undefined) delete process.env.V8_ROOT
    else process.env.V8_ROOT = previousRoot
    if (previousBase === undefined) delete process.env.V8_BASE_DIR
    else process.env.V8_BASE_DIR = previousBase
  }
})

test('database automation setting takes precedence over environment enablement', async (t) => {
  const db = fixture(t)
  db.prepare("UPDATE settings SET value='false' WHERE key='automation_enabled'").run()
  const previous = process.env.AUTOMATION_ENABLED
  process.env.AUTOMATION_ENABLED = 'true'
  t.after(() => {
    if (previous === undefined) delete process.env.AUTOMATION_ENABLED
    else process.env.AUTOMATION_ENABLED = previous
  })
  const controller = new AbortController()
  let scans = 0
  const running = runLoop({
    db,
    scanner: async () => { scans += 1; return { login: { success: true }, tasks: [], obligations: [], payments: [], messages: [] } },
    sleepMs: 5,
    signal: controller.signal
  })
  await new Promise((resolve) => setTimeout(resolve, 25))
  controller.abort()
  await running
  assert.equal(scans, 0)
  assert.equal(db.prepare('SELECT state FROM harness_status WHERE id=1').get().state, 'idle')
})
