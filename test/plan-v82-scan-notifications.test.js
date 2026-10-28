'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { runCycle, scanOne, notifyScanAccount } = require('../harness/loop')

// Arabic literals are written as unicode escapes on purpose: the editing
// pipeline mangles raw UTF-8 Arabic in this environment. Escapes decode to
// byte-identical text at runtime, so these match the notification side.
const SCAN_DONE = /\u{0627}\u{0643}\u{062A}\u{0645}\u{0644} \u{0641}\u{062D}\u{0635} \u{0627}\u{0644}\u{0645}\u{0646}\u{0634}\u{0623}\u{0629}/u
const SCAN_FAIL = /\u{062A}\u{0639}\u{0630}\u{0631} \u{0641}\u{062D}\u{0635} \u{0627}\u{0644}\u{0645}\u{0646}\u{0634}\u{0623}\u{0629}/u
const NEW_DOCS = /\u{0645}\u{0633}\u{062A}\u{0646}\u{062F}\u{0627}\u{062A} \u{062C}\u{062F}\u{064A}\u{062F}\u{0629}: \*1\*/u
const REASON_LINE = new RegExp(
  '\\u0627\\u0644\\u0633\\u0628\\u0628: \\u0628\\u0648\\u0627\\u0628\\u0629 \\u0627\\u0644\\u0636\\u0631\\u0627\\u0626\\u0628 ' +
  '\\u0631\\u0641\\u0636\\u062A \\u062A\\u0633\\u062C\\u064A\\u0644 \\u0627\\u0644\\u062F\\u062E\\u0648\\u0644', 'u'
)
const COMPANY_AL_NOOR = new RegExp(
  '\\u0634\\u0631\\u0643\\u0629 \\u0627\\u0644\\u0646\\u0648\\u0631', 'u'
)

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-scan-notify-'))
  const db = openDatabase(path.join(directory, 'test.db'))
  runMigrations(db)
  t.after(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return db
}

function addAccount(db, username) {
  db.prepare(`INSERT INTO accounts(account_key,username,label,secret_cipher,secret_iv,secret_tag,enabled,created_at,updated_at)
    VALUES(?,?,?,?,?,?,1,'2026-10-16','2026-10-16')`).run(username, username, username, 'c', 'i', 't')
}

function addControlNumber(db, number) {
  db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('whatsapp_control_number',?,'2026-10-24')`).run(number)
}

const okScanner = (username) => async () => ({
  account: { key: username, label: username },
  login: { success: true },
  tasks: [{ docNumber: 'd-1', docTitle: 'Filing' }],
  obligations: [],
  payments: [],
  messages: []
})

test('scanOne returns a rich outcome and notifyScanAccount enqueues the success note', async (t) => {
  const db = fixture(t)
  addAccount(db, 'acct-1')
  addControlNumber(db, '+20123456789')
  const outcome = await scanOne({ username: 'acct-1' }, 1, 1, db, okScanner('acct-1'))
  assert.equal(outcome.ok, true)
  assert.equal(outcome.newDocs, 1)
  assert.equal(outcome.error, '')
  notifyScanAccount(db, { username: 'acct-1' }, 1, 1, outcome)

  const note = db.prepare(`SELECT payload_json, recipient, status FROM notification_outbox WHERE channel='whatsapp'`).get()
  assert.ok(note, 'notification row must exist')
  const payload = JSON.parse(note.payload_json)
  assert.match(payload.text, SCAN_DONE)
  assert.match(payload.text, NEW_DOCS)
  assert.match(payload.text, /acct-1/)
  assert.equal(note.recipient, '20123456789@c.us')
  assert.equal(note.status, 'pending')

  const event = db.prepare(`SELECT payload FROM events WHERE kind='scan_account_completed'`).get()
  assert.ok(event, 'scan_account_completed event must exist')
  const details = JSON.parse(event.payload)
  assert.equal(details.scanSuccess, true)
  assert.equal(details.newDocsCount, 1)
  assert.equal(details.error, '')
})

test('a failed account scan notifies with the honest error reason', async (t) => {
  const db = fixture(t)
  addAccount(db, 'acct-fail')
  addControlNumber(db, '+20123456789')
  const scanner = async () => {
    const err = new Error('\u0628\u0648\u0627\u0628\u0629 \u0627\u0644\u0636\u0631\u0627\u0626\u0628 \u0631\u0641\u0636\u062A \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644')
    throw err
  }
  const outcome = await scanOne({ username: 'acct-fail' }, 1, 1, db, scanner)
  assert.equal(outcome.ok, false)
  notifyScanAccount(db, { username: 'acct-fail' }, 1, 1, outcome)

  const note = db.prepare(`SELECT payload_json FROM notification_outbox WHERE channel='whatsapp'`).get()
  const payload = JSON.parse(note.payload_json)
  assert.match(payload.text, SCAN_FAIL)
  assert.match(payload.text, REASON_LINE)
})

test('runCycle notifies once per account for both success and failure paths', async (t) => {
  const db = fixture(t)
  addAccount(db, 'acct-good')
  addAccount(db, 'acct-bad')
  addControlNumber(db, '+20199999999')
  db.prepare(`INSERT INTO companies(id,name,account_key,status,created_at,updated_at)
    VALUES('company-bad',?,'acct-bad','ready','2026-10-24','2026-10-24')`)
    .run('\u0634\u0631\u0643\u0629 \u0627\u0644\u0646\u0648\u0631')
  const outcome = await runCycle({
    db,
    gapMs: 0,
    scanner: async (username) => {
      if (username === 'acct-bad') { throw new Error('login rejected') }
      return {
        account: { key: username, label: username },
        login: { success: true },
        tasks: [{ docNumber: 'x-1', docTitle: 'T' }],
        obligations: [], payments: [], messages: []
      }
    }
  })
  assert.equal(outcome.processed, 1)
  assert.equal(outcome.failed, 1)
  const notes = db.prepare(`SELECT payload_json FROM notification_outbox WHERE channel='whatsapp'`).all()
  assert.equal(notes.length, 2)
  const texts = notes.map((row) => JSON.parse(row.payload_json).text)
  assert.equal(texts.filter((tx) => /\(1\/2\):/.test(tx)).length, 1)
  assert.equal(texts.filter((tx) => /\(2\/2\):/.test(tx)).length, 1)
  assert.equal(texts.filter((tx) => SCAN_DONE.test(tx)).length, 1)
  assert.equal(texts.filter((tx) => SCAN_FAIL.test(tx)).length, 1)
  assert.ok(texts.some((tx) => COMPANY_AL_NOOR.test(tx)), 'company name must ride the note')
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM events WHERE kind='scan_account_completed'`).get().n, 2)
})

test('notifications are skipped entirely without a configured control number', async (t) => {
  const db = fixture(t)
  addAccount(db, 'acct-quiet')
  const outcome = await runCycle({ db, gapMs: 0, scanner: okScanner('acct-quiet') })
  assert.equal(outcome.processed, 1)
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM notification_outbox`).get().n, 0)
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM events WHERE kind='scan_account_completed'`).get().n, 0)
})

test('notifyScanAccount tolerates a company row that does not exist yet', (t) => {
  const db = fixture(t)
  addControlNumber(db, '+20123456789')
  notifyScanAccount(db, { username: 'ghost-account' }, 1, 1, { ok: true, newDocs: 0, error: '' })
  const note = db.prepare(`SELECT payload_json FROM notification_outbox WHERE channel='whatsapp'`).get()
  assert.match(JSON.parse(note.payload_json).text, /ghost-account/)
})

test('wa-sender exits on a lost lease race and rebuilds immediately on page-closed', (t) => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'channels', 'wa-sender.js'), 'utf8')
  assert.match(source, /Another wa-sender instance owns the delivery lease; exiting with code 1 for PM2 restart retry/)
  assert.doesNotMatch(source, /this copy will not start/)
  assert.match(source, /WATCHDOG_INTERVAL_MS = 20000/)
  assert.match(source, /if \(probe\.reason === 'page-closed'\) transportStrikes = WATCHDOG_STRIKES_TO_REBUILD/)
  assert.match(source, /transportStrikes < WATCHDOG_STRIKES_TO_REBUILD/)
})

test('whatsapp transport guards watch the puppeteer page and browser lifecycle', (t) => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'channels', 'whatsapp.js'), 'utf8')
  assert.match(source, /pupBrowser[\s\S]{0,200}disconnected/)
  assert.match(source, /pupPage[\s\S]{0,400}on\('close'/)
  assert.match(source, /pupPage[\s\S]{0,400}on\('error'/)
  assert.match(source, /WhatsApp page crash\/error/)
  assert.match(source, /if \(!page \|\| \(typeof page\.isClosed === 'function' && page\.isClosed\(\)\)\)/)
  assert.match(source, /reason: 'page-closed'/)
})
