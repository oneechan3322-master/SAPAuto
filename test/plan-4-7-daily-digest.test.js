'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { openDatabase } = require('../db/connect')

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-digest-'))
process.env.V8_ROOT = path.resolve(__dirname, '..')
fs.mkdirSync(path.join(directory, 'data', 'pdfs'), { recursive: true })

const { runMigrations } = require('../db/migrate')
const database = openDatabase(path.join(directory, 'digest.db'))
runMigrations(database)

const digest = require('../channels/daily-digest')

// The fixture PDF must sit inside the REAL production orbit (v8/data/pdfs).
const pdfInside = path.join(process.env.V8_ROOT, 'data', 'pdfs', 'test-digest-fixture.pdf')
fs.mkdirSync(path.dirname(pdfInside), { recursive: true })
fs.writeFileSync(pdfInside, Buffer.from('%PDF-1.4 fixture payload for digest caption test'))

// Fixed fake dates so the Cairo clock is stable: 2026-10-17 13:06 Cairo time.
const nowShape = (utcHour, utcMinute) => new Date(Date.UTC(2026, 9, 17, utcHour, utcMinute || 0))
const cairoNoonish = nowShape(10, 6)

function seedWindowRows(nowIso, previousIso) {
  const company = 'companies_digest'
  database.prepare('INSERT OR IGNORE INTO companies (id,name,account_key,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run(company, 'مكتب اليومية', '533158788', previousIso, previousIso)
  database.prepare(`INSERT INTO tasks (id,company_id,account_key,doc_number,title,deadline,status,urgency,required_action,pdf_path,origin,raw_json,created_at,updated_at,ai_study)
    VALUES ('tasks_digest_pdf',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    company, '533158788', 'DOC_DIGEST_1', 'نموذج الإخطار التجريبي', '2026-10-27', 'open', 'normal',
    'تجهيز المستندات', pdfInside, 'scraper', '{}', previousIso, nowIso, ''
  )
  database.prepare(`INSERT INTO tasks (id,company_id,account_key,doc_number,title,deadline,status,urgency,required_action,pdf_path,origin,raw_json,created_at,updated_at,ai_study)
    VALUES ('tasks_digest_studied',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    company, '533158788', 'DOC_DIGEST_2', 'ملاحظات قبول تجريبية', '', 'open', 'overdue',
    'مراجعة', '', 'scraper', '{}', previousIso, nowIso, ''
  )
  database.prepare(`INSERT INTO tasks (id,company_id,account_key,doc_number,title,deadline,status,urgency,required_action,pdf_path,origin,raw_json,created_at,updated_at,ai_study,ai_studied_at)
    VALUES ('tasks_digest_studied2',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    company, '533158788', 'DOC_DIGEST_3', 'دراسة ذكية', '', 'open', 'normal', 'فحص', '',
    'scraper', '{}', previousIso, nowIso, 'تم الفحص', nowIso
  )
}



test('collectDigestItems counts and bounds the new window', () => {
  const nowIso = new Date().toISOString()
  const previousIso = new Date(Date.now() - 26 * 3600 * 1000).toISOString()
  seedWindowRows(nowIso, previousIso)
  const items = digest.collectDigestItems(database, previousIso)
  assert.equal(items.tasks.length, 3)
  assert.ok(items.tasksTotal >= 3)
  assert.ok(items.studiesTotal >= 1)
})

test('composeDigestText lists documents with deadlines and stays bounded', () => {
  const items = digest.collectDigestItems(database, new Date(Date.now() - 26 * 3600 * 1000).toISOString())
  const text = digest.composeDigestText(items, { clock: '11:44' })
  assert.match(text, /التقرير اليومي/)
  assert.match(text, /DOC_DIGEST_1|نموذج الإخطار التجريبي/)
  assert.match(text, /الموعد: 2026-10-27/)
  assert.match(text, /إيقاف اليومية/)
  assert.ok(text.length < 3600)
})

test('privacy orbit refuses PDFs outside the data root', () => {
  assert.equal(digest.insideDataRoot(pdfInside), true)
  assert.equal(digest.insideDataRoot(path.join(os.tmpdir(), 'elsewhere.pdf')), false)
  assert.equal(digest.insideDataRoot(path.join(directory, 'data', 'notpdf.txt')), false)
})

test('daily digest refuses without consent, chat, connection or live mode', async () => {
  const sends = []
  const provider = { sendMessage: async (chat, text) => sends.push({ chat, text }), sendDocument: async () => ({}) }
  const refused = await digest.runDailyDigest(database, { ...provider, now: cairoNoonish })
  assert.equal(refused.sent, false)
  assert.ok(['disabled', 'no-chat', 'whatsapp-disconnected'].includes(refused.reason))
  assert.equal(sends.length, 0)
})

test('daily digest sends once per day with attachments after full consent', async (t) => {
  const now = cairoNoonish
  const chats = []
  const docs = []
  const provider = {
    sendMessage: async (chat, text) => { chats.push({ chat, text }) },
    sendDocument: async (chat, filePath, caption) => { docs.push({ chat, filePath, caption }) }
  }
  digest.setSetting(database, 'daily_digest_enabled', '1')
  digest.setSetting(database, 'daily_digest_chat', '1203630offce@g.us')
  digest.setSetting(database, 'message_mode', 'live')
  digest.setSetting(database, 'whatsapp_connected', 'true')

  const firstRun = await digest.runDailyDigest(database, { ...provider, now })
  assert.equal(firstRun.sent, true)
  assert.ok(chats.length === 1 && chats[0].chat === '1203630offce@g.us')
  assert.ok(docs.length >= 1 && docs.some((doc) => doc.filePath === pdfInside), 'attaches the new PDF')
  assert.ok(docs.every((doc) => doc.caption.includes('الموعد: 2026-10-27') || doc.caption.length > 5))

  const bumpedNow = nowShape(16, 30)
  const secondRun = await digest.runDailyDigest(database, { ...provider, now: bumpedNow })
  assert.equal(secondRun.sent, false)
  assert.equal(secondRun.reason, 'already-sent-today')
  assert.equal(chats.length, 1)

  const eventRows = database.prepare("SELECT kind,payload FROM events WHERE kind='daily_digest_sent'").all()
  assert.equal(eventRows.length, 1)

  // Next day catch-up: clock now past the schedule, last day cleared.
  digest.setSetting(database, 'digest_last_day', '2026-10-16')
  digest.setSetting(database, 'digest_last_sent_at', new Date(Date.UTC(2026, 9, 16, 8)).toISOString())
  const thirdRun = await digest.runDailyDigest(database, { ...provider, now: nowShape(10, 10) })
  assert.equal(thirdRun.sent, true)
  fs.rmSync(pdfInside, { force: true, maxRetries: 6, retryDelay: 200 })
})

test('digest time gate waits for the configured clock', async () => {
  digest.setSetting(database, 'digest_last_day', '')
  digest.setSetting(database, 'whatsapp_connected', 'true')
  const earlyNow = nowShape(8, 0)
  const result = await digest.runDailyDigest(database, {
    sendMessage: async () => ({}), sendDocument: async () => ({}), now: earlyNow
  })
  assert.equal(result.sent, false)
  assert.equal(result.reason, 'before-scheduled-time')
})
