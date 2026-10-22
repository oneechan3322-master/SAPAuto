'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { openDatabase } = require('../db/connect')
const { runMigrations } = require('../db/migrate')
const { ingestAccount } = require('../harness/ingest')
const { markDone } = require('../db/queries/obligations')

function scan(accountKey, obligations, payments, overrides = {}) {
  return {
    account: { key: accountKey },
    login: { success: true },
    tasks: [], messages: [],
    obligations, payments,
    ...overrides
  }
}

test('C.3 review wiring: absence is queued, never auto-resolved; reappearance clears', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-review-'))
  const db = openDatabase(path.join(directory, 'review.db'))
  try {
    runMigrations(db)
    const accountKey = 'test-acct'
    const obligation = (code, status = 'open') => ({ obligationCode: code, period: '2026-01', title: 'إقرار', status, penaltyBand: 'B', evidence: '' })
    const payment = (claim, status = 'due') => ({ claimNumber: claim, amount: 1500, currency: 'EGP', status, payBefore: '2026-02-01' })

    // Scan 1: portal shows O1,O2 and pays P1 — everything fresh, no streaks.
    ingestAccount(scan(accountKey, [obligation('O1'), obligation('O2')], [payment('P1')]), db)
    let rows = db.prepare('SELECT * FROM obligations ORDER BY obligation_code').all()
    assert.deepEqual(rows.map((r) => [r.obligation_code, r.absent_scan_streak, r.review_state]),
      [['O1', 0, null], ['O2', 0, null]])

    // Scan 2: O1 vanished — one strike, NOT yet needs_review.
    ingestAccount(scan(accountKey, [obligation('O2')], [payment('P1')]), db)
    let o1 = db.prepare('SELECT * FROM obligations WHERE obligation_code=?').get('O1')
    assert.equal(o1.absent_scan_streak, 1)
    assert.equal(o1.review_state, null)

    // Scan 3 (two consecutive full successful scans): O1 still absent → queued.
    ingestAccount(scan(accountKey, [obligation('O2')], [payment('P1')]), db)
    o1 = db.prepare('SELECT * FROM obligations WHERE obligation_code=?').get('O1')
    assert.equal(o1.absent_scan_streak, 2)
    assert.equal(o1.review_state, 'needs_review') // queued, not confirmed
    assert.match(o1.review_note, /لم يعد يظهر على البوابة بعد 2/)
    assert.equal(o1.review_updated_by, 'harness.ingest')
    //_payments counterpart untouched:
    const p1 = db.prepare('SELECT * FROM payments WHERE claim_number=?').get('P1')
    assert.equal(p1.review_state, null)

    // A family of humans answering the queue: Office keeps its own truth.
    assert.equal(markDone(db.prepare('SELECT id FROM obligations WHERE obligation_code=?').get('O1').id, 'owner-1', 'سددت الشيك', db), true)
    o1 = db.prepare('SELECT * FROM obligations WHERE obligation_code=?').get('O1')
    assert.equal(o1.review_state, 'confirmed_resolved')
    assert.equal(o1.review_updated_by, 'owner-1')
    assert.equal(o1.local_review_status, 'completed_locally')

    // Scan 4: portal shows O1 again → evidence contradicts absence.
    // Streak resets; a human-confirmed row must keep its confirmed state.
    ingestAccount(scan(accountKey, [obligation('O1'), obligation('O2')], [payment('P1')]), db)
    o1 = db.prepare('SELECT * FROM obligations WHERE obligation_code=?').get('O1')
    assert.equal(o1.absent_scan_streak, 0)
    assert.equal(o1.review_state, 'confirmed_resolved', 'absence pass must never override a human confirmation')

    // And a still-unconfirmed queued row that reappears gets cleared, not stuck.
    ingestAccount(scan(accountKey, [obligation('O1')], [payment('P1')]), db) // O2 gone
    ingestAccount(scan(accountKey, [obligation('O1')], [payment('P1')]), db) // O2 gone twice
    let o2 = db.prepare('SELECT * FROM obligations WHERE obligation_code=?').get('O2')
    assert.equal(o2.review_state, 'needs_review')
    ingestAccount(scan(accountKey, [obligation('O1'), obligation('O2')], [payment('P1')]), db) // back
    o2 = db.prepare('SELECT * FROM obligations WHERE obligation_code=?').get('O2')
    assert.equal(o2.absent_scan_streak, 0)
    assert.equal(o2.review_state, null, 'needs_review must clear when the portal contradicts it')

    // Events carry the queue trail for the review UI.
    const kinds = db.prepare(`SELECT kind FROM events WHERE kind IN ('absent_batch','review_cleared') ORDER BY created_at`).all().map((r) => r.kind)
    assert.ok(kinds.includes('absent_batch') && kinds.includes('review_cleared'))
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('C.3 review wiring: payments share the same streak discipline', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sapauto-review-'))
  const db = openDatabase(path.join(directory, 'review.db'))
  try {
    runMigrations(db)
    const payment = (claim) => ({ claimNumber: claim, amount: 700, currency: 'EGP', status: 'due', payBefore: '2026-02-15' })
    ingestAccount(scan('pay-acct', [], [payment('C1'), payment('C2')]), db)
    ingestAccount(scan('pay-acct', [], [payment('C2')]), db)
    ingestAccount(scan('pay-acct', [], [payment('C2')]), db)
    const c1 = db.prepare('SELECT * FROM payments WHERE claim_number=?').get('C1')
    assert.equal(c1.absent_scan_streak, 2)
    assert.equal(c1.review_state, 'needs_review')
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
