'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const legalDeadlines = require('../domain/legal-deadlines.cjs')
const {
  loadRules,
  matchLegalDeadline,
  stampObligation,
  applyObligationDeadlines,
  createLegalDeadlineReminders
} = require('../harness/deadlines')

const FIXED_NOW = new Date('2026-04-15T10:00:00.000Z')

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-v8-plan45-'))
  const db = openDatabase(path.join(directory, 'test.db'))
  runMigrations(db)
  const ts = '2026-03-30T08:00:00.000Z'
  db.prepare(`INSERT INTO companies(id, name, account_key, external_ref, status, created_at, updated_at)
    VALUES ('company-1', 'شركة نموذج', 'compat-1', 'ext-1', 'active', ?, ?)`).run(ts, ts)
  db.prepare(`INSERT INTO users(id, name, email, emailVerified, createdAt, updatedAt, role, disabled)
    VALUES ('user-owner', 'Owner', 'owner@example.test', 1, ?, ?, 'Owner', 0)`).run(ts, ts)

  let seq = 0
  const insertObligation = ({ obligationCode, title, period = '2026-Q1', aiStudy = '', createdAt = ts }) => {
    seq++
    const id = `obl-plan45-${seq}`
    db.prepare(`INSERT INTO obligations(id, company_id, account_key, obligation_code, period, title, deadline, status, evidence, raw_json, ai_study, created_at, updated_at)
      VALUES (?,?,?,?,?,?, '2026-04-10', 'open', '', '{}', ?, ?, ?)`)
      .run(id, 'company-1', 'compat-1', obligationCode, period, title, aiStudy, createdAt, createdAt)
    return id
  }
  const reload = (id) => db.prepare('SELECT * FROM obligations WHERE id = ?').get(id)

  t.after(() => {
    try { db.close() } catch { /* already closed */ }
    try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5 }) } catch { /* debris tolerated */ }
  })
  return { db, insertObligation, reload }
}

test('plan 4.5: the legal rule table seeds the portal document types', (t) => {
  const { db } = fixture(t)
  const rules = loadRules(db)
  assert.ok(rules.length >= 4, `expected at least 4 seeded rules, got ${rules.length}`)
  for (const rule of rules) {
    assert.ok(rule.match_key, 'every rule names its match key')
    assert.ok(rule.doc_name, `${rule.match_key} names the document`)
    assert.ok(rule.legal_days > 0, `${rule.match_key} carries positive law days`)
    assert.match(rule.basis, /قانون 206|المادة|قاعدة/, `${rule.match_key} carries a legal basis`)
  }
})

test('plan 4.5: the four live portal document types match their rules', (t) => {
  const { db } = fixture(t)
  const card = matchLegalDeadline(db, 'بطاقة ضريبية')
  assert.equal(card.doc_name, 'بطاقة تعريف ضريبية')
  assert.equal(card.legal_days, 15)

  const docs = matchLegalDeadline(db, 'إخطار تجهيز مستندات (180000157240)')
  assert.equal(docs.doc_name, 'المستندات والدفاتر المطلوبة')

  const form15 = matchLegalDeadline(db, 'نموذج رقم (15) فحص (180000135169)')
  assert.equal(form15.doc_name, 'دفاتر ومستندات الفحص الضريبي')

  const authority = matchLegalDeadline(db, 'مستند مصلحة رقم (180000185313)')
  assert.equal(authority.doc_name, 'مستند صادر عن المصلحة')

  // No invented grounding: an unknown record type must not claim days.
  assert.equal(matchLegalDeadline(db, 'فرد اختبار غير معروف'), null)

  const validity = matchLegalDeadline(db, 'البطاقة الضريبية سارية حتى تاريخ')
  assert.equal(validity.doc_name, 'بطاقة تعريف ضريبية')
  assert.equal(validity.anchor_mode, 'portal_date')
})

test('plan 4.5: stamping a studied obligation records the Cairo deadline once', (t) => {
  const { db, insertObligation, reload } = fixture(t)
  const id = insertObligation({
    obligationCode: 'tax-card-1',
    title: 'بطاقة ضريبية - تجديد',
    aiStudy: 'الالتزام مرتبط بإصدار بطاقة ضريبية محدثة وفق قانون 206/2020.',
    createdAt: '2026-04-01T09:00:00.000Z'
  })

  const first = stampObligation(db, reload(id), { now: FIXED_NOW })
  assert.equal(first.stamped, true)

  const row = reload(id)
  assert.equal(row.required_doc, 'بطاقة تعريف ضريبية')
  assert.equal(row.legal_days, 15)
  assert.equal(row.respond_by, '2026-04-16', 'creation Cairo day + 15 calendar days')
  assert.match(row.deadline_basis, /المادة 21|206/)

  // Idempotent: a re-run can never move the date or rewrite the basis.
  const second = stampObligation(db, reload(id), { now: FIXED_NOW })
  assert.equal(second.stamped, false)
  assert.equal(reload(id).respond_by, '2026-04-16')
})

test('plan 4.5: unknown record types stay unstamped and the batch pass skips them', (t) => {
  const { db, insertObligation } = fixture(t)
  const studied = insertObligation({
    obligationCode: 'unknown-type',
    title: 'فرد ركني بمخالفة عمليات',
    aiStudy: 'وصف عام للالتزام دون نوع مستند معروف.'
  })
  insertObligation({
    obligationCode: 'unstudied',
    title: 'بطاقة ضريبية أخرى',
    aiStudy: ''
  })

  const outcome = applyObligationDeadlines(db, { now: FIXED_NOW })
  assert.equal(outcome.stamped, 0, 'nothing matches, nothing stamps')

  const row = db.prepare('SELECT * FROM obligations WHERE id = ?').get(studied)
  assert.equal(row.respond_by, null, 'no invented deadline for an unmatched type')
})

test('plan 4.5: the batch catch-up stamps studied obligations that lack a stamp', (t) => {
  const { db, insertObligation } = fixture(t)
  const id = insertObligation({
    obligationCode: 'docs-1',
    title: 'إخطار تجهيز مستندات (180000157240)',
    aiStudy: 'يطلب الإخطار تجهيز المستندات المطلوبة.',
    createdAt: '2026-04-05T07:30:00.000Z'
  })

  const outcome = applyObligationDeadlines(db, { now: FIXED_NOW })
  assert.equal(outcome.candidates, 1)
  assert.equal(outcome.stamped, 1)

  const row = db.prepare('SELECT rowid AS r, * FROM obligations WHERE id = ?').get(id)
  assert.equal(row.required_doc, 'المستندات والدفاتر المطلوبة')
  assert.equal(row.respond_by, '2026-04-20')
})

test('plan 4.5: portal-date records anchor on the portal date, not the law window', (t) => {
  const { db, insertObligation, reload } = fixture(t)
  const id = insertObligation({
    obligationCode: '533158788::CIT::0000-12-30_إلى_9999-12-31::20280102::البطاقة_الضريبية_سار',
    title: 'البطاقة الضريبية سارية حتى تاريخ',
    aiStudy: 'البطاقة الضريبية سارية؛ يلزم التجديد قبل انتهاء صلاحيتها وفق قانون 206/2020.',
    createdAt: '2026-04-01T09:00:00.000Z'
  })

  const first = stampObligation(db, reload(id), { now: FIXED_NOW })
  assert.equal(first.stamped, true, 'the definite-article portal form must match')

  const row = reload(id)
  assert.equal(row.anchor_mode, 'portal_date')
  assert.equal(row.respond_by, '2028-01-02', 'the exact validity date embedded in the record')
  assert.ok(reload(id).respond_by !== '2026-04-16', 'no law-window invention for a portal-anchored record')

  // A malformed embedding must not become a wrong deadline.
  assert.equal(stampObligation(db, {
    ...reload(id),
    obligation_code: '533158788::CIT::20283299::البطاقة_الضريبية_سار',
    required_doc: ''
  }, { now: FIXED_NOW }).stamped, false)
})

test('plan 4.5: low-days reminders fire at 7/3/1/0 and once on overdue', (t) => {
  const { db, insertObligation, reload } = fixture(t)
  const id = insertObligation({
    obligationCode: 'tax-card-2',
    title: 'بطاقة ضريبية',
    aiStudy: 'مطلوب إصدار البطاقة الضريبية.'
  })
  stampObligation(db, reload(id), { now: FIXED_NOW })
  const stamped = reload(id)
  assert.equal(stamped.respond_by, '2026-04-14', 'created 2026-03-30 + 15 days')

  let counter = 0
  const clockId = () => `plan45-${String(++counter).padStart(4, '0')}`

  // 7 days before the law window
  const week = createLegalDeadlineReminders(db, '2026-04-07', { clockId, clockNow: () => '2026-04-07T08:00:00.000Z' })
  assert.equal(week.inserted, 1)
  const weekMessage = db.prepare("SELECT message FROM reminders WHERE dedupe_key LIKE 'plan45-law%' ORDER BY rowid DESC LIMIT 1").get()
    || db.prepare("SELECT message FROM reminders WHERE message LIKE '%7 أيام%' LIMIT 1").get()
  assert.match(weekMessage.message, /7 أيام/)

  // Same day again → dedupe keeps one reminder
  const again = createLegalDeadlineReminders(db, '2026-04-07', { clockId, clockNow: () => '2026-04-07T08:00:00.000Z' })
  assert.equal(again.inserted, 0)

  // Day 0 and overdue each get their own message
  const day = createLegalDeadlineReminders(db, '2026-04-14', { clockId, clockNow: () => '2026-04-14T08:00:00.000Z' })
  assert.equal(day.inserted, 1)

  const late = createLegalDeadlineReminders(db, '2026-04-20', { clockId, clockNow: () => '2026-04-20T08:00:00.000Z' })
  assert.equal(late.inserted, 1)
  const overdue = db.prepare("SELECT message FROM reminders WHERE message LIKE 'انتهت%' LIMIT 1").get()
  assert.match(overdue.message, /انتهت المهلة القانونية منذ 6 أيام/)

  // A non-threshold day (2 days left) inserts nothing
  const quiet = createLegalDeadlineReminders(db, '2026-04-12', { clockId, clockNow: () => '2026-04-12T08:00:00.000Z' })
  assert.equal(quiet.inserted, 0)
})

test('plan 4.5: Arabic day phrasing and countdown tones', () => {
  assert.equal(legalDeadlines.formatArabicDays(0), 'يوم')
  assert.equal(legalDeadlines.formatArabicDays(1), 'يوم واحد')
  assert.equal(legalDeadlines.formatArabicDays(2), 'يومين')
  assert.equal(legalDeadlines.formatArabicDays(7), '7 أيام')
  assert.equal(legalDeadlines.formatArabicDays(12), '12 يوماً')
  assert.equal(legalDeadlines.deadlineTone(-2), 'urgent')
  assert.equal(legalDeadlines.deadlineTone(2), 'urgent')
  assert.equal(legalDeadlines.deadlineTone(5), 'attention')
  assert.equal(legalDeadlines.deadlineTone(30), 'calm')

  // reminderMessage covers the decisive templates
  const week = legalDeadlines.reminderMessage({ docName: 'بطاقة تعريف ضريبية', legalDays: 15, respondBy: '2026-04-07', days: 7 })
  assert.match(week, /متبقٍ 7 أيام/)
  assert.match(week, /206\/2020/)
})
