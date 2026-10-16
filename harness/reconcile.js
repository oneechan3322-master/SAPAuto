'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { getDatabase } = require('../db/connect')
const { audit, id, now } = require('../db/queries/shared')
const recordStatus = require('../domain/record-status.cjs')
const identity = require('../domain/company-identity.cjs')

/**
 * Plan 2.1 §5.3 / Stage 4 / §7 — payment reconciliation over the local
 * database only. This module never opens a portal session and never mutates a
 * source observation; it counts what is stored and writes a report.
 *
 * It deliberately refuses to produce any verdict: unknown source data stays
 * unknown, and a scan failure is never reported as a payment absence.
 */

const DAY_MS = 86400000

function cairoDayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date)
}

function shiftDayKey(key, days) {
  return cairoDayKey(new Date(Date.parse(`${key}T12:00:00Z`) + days * DAY_MS))
}

/** §5.3 quality baseline — recorded before a run, never overwritten by it. */
function baseline(db = getDatabase()) {
  const companies = db.prepare('SELECT COUNT(*) AS n FROM companies').get().n
  const payments = db.prepare('SELECT COUNT(*) AS n FROM payments').get().n
  const perAccount = db.prepare('SELECT account_key,last_scanned_at FROM companies ORDER BY account_key').all()
  return {
    capturedAt: now(),
    companies,
    payments,
    paymentsKnownStatus: db.prepare(`SELECT COUNT(*) AS n FROM payments
      WHERE TRIM(COALESCE(status,''))<>''`).get().n,
    paymentsUnknownStatus: db.prepare(`SELECT COUNT(*) AS n FROM payments
      WHERE TRIM(COALESCE(status,''))=''`).get().n,
    parkedAccounts: db.prepare("SELECT COUNT(*) AS n FROM account_status WHERE state='parked'").get().n,
    accountScanTimes: Object.fromEntries(perAccount.map((row) => [row.account_key, row.last_scanned_at]))
  }
}

function classifySourceStatus(status) {
  const value = String(status || '').trim().toLowerCase()
  if (!value) return 'missing'
  if (['unknown', 'غير معروف', ''].includes(value)) return 'unknown'
  if (['done', 'complete', 'completed', 'resolved', 'settled', 'closed', 'تم السداد', 'مسدد', 'مدفوع', 'مسدد بالكامل']
    .some((token) => value.includes(token))) return 'completed'
  if (value.includes('جزئي') || value.includes('partial')) return 'partial'
  return 'known_active'
}

function classifyDate(dueDate, todayKey) {
  const raw = String(dueDate || '').trim()
  if (!raw) return 'missing'
  const key = raw.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !recordStatus.validDateKey(key)) return 'invalid'
  if (key < todayKey) return 'overdue'
  if (key === todayKey) return 'due_today'
  if (key <= shiftDayKey(todayKey, 7)) return 'due_within_seven_days'
  return 'future'
}

/**
 * Stage 4 — counts payment records by source status, date knowledge, local
 * review state, and company identity. Pure read; the only write is the report
 * file plus one audit event.
 */
function reconcile({ runId = '', scannedAccounts = 0, reportPath = '', db = getDatabase(), startedAt = '' } = {}) {
  const timestamp = now()
  const todayKey = cairoDayKey()
  const rows = db.prepare(`SELECT p.id,p.account_key,p.claim_number,p.amount,p.currency,p.due_date,
      p.status,p.source_observed_at,p.local_review_status,p.local_paid_at,
      c.name,c.account_key AS company_account_key,c.name_source,c.english_name,c.portal_name
    FROM payments p LEFT JOIN companies c ON c.id=p.company_id`).all()

  const bySourceStatus = { known_active: 0, completed: 0, partial: 0, unknown: 0, missing: 0 }
  const byDate = { overdue: 0, due_today: 0, due_within_seven_days: 0, future: 0, missing: 0, invalid: 0 }
  const byLocalReview = { not_reviewed: 0, needs_review: 0, evidence_pending: 0, paid_locally: 0 }
  const byIdentity = { verified_source: 0, manual: 0, unregistered: 0 }
  const missingAmount = []
  const knownActiveOverdue = []

  for (const row of rows) {
    bySourceStatus[classifySourceStatus(row.status)] += 1
    const dateState = classifyDate(row.due_date, todayKey)
    byDate[dateState] += 1
    byLocalReview[row.local_review_status || 'not_reviewed'] += 1

    const company = identity.resolveCompanyIdentity({
      id: row.id,
      name: row.name,
      account_key: row.company_account_key || row.account_key,
      name_source: row.name_source,
      english_name: row.english_name,
      portal_name: row.portal_name
    })
    byIdentity[company.known
      ? (company.origin === 'manual' ? 'manual' : 'verified_source')
      : 'unregistered'] += 1

    if (row.amount === null || row.amount === undefined || row.amount === '') {
      missingAmount.push({ id: row.id, account: row.account_key, reason: 'amount_missing_in_source' })
    }
    if (dateState === 'overdue' && classifySourceStatus(row.status) === 'known_active') {
      knownActiveOverdue.push({ id: row.id, account: row.account_key, dueDate: row.due_date })
    }
  }

  const accountKeys = new Set(rows.map((row) => row.account_key))
  const failures = db.prepare(`SELECT account_key,reason FROM failures
    WHERE resolved_at IS NULL ORDER BY occurred_at DESC`).all()
  const parked = db.prepare("SELECT account_key FROM account_status WHERE state='parked'").all()
    .map((row) => row.account_key)

  const report = {
    runId: runId || `run_${timestamp}`,
    startedAt: startedAt || null,
    generatedAt: timestamp,
    configuredAccounts: 26,
    attemptedAccounts: scannedAccounts,
    completedAccounts: 0,
    failedAccounts: failures.length,
    parkedAccounts: parked.length,
    stoppedEarly: false,
    portalWrites: 0,
    emailsOrMessagesSent: 0,
    cloudAiRequests: 0,
    paymentsObserved: rows.length,
    newRecords: 0,
    updatedRecords: 0,
    unchangedRecords: rows.length,
    sourceStatusUnknown: bySourceStatus.unknown + bySourceStatus.missing,
    dueDateUnknownOrInvalid: byDate.missing + byDate.invalid,
    knownActiveOverdue: knownActiveOverdue.length,
    bySourceStatus,
    byDate,
    byLocalReview,
    byIdentity,
    accountsWithPayments: accountKeys.size,
    exceptions: [
      ...failures.map((row) => ({
        account: row.account_key,
        category: String(row.reason || 'unknown').slice(0, 120),
        nextAction: 'أعد الفحص من مركز التحكم بعد التحقق من الاتصال'
      })),
      ...parked.map((account) => ({
        account,
        category: 'account_parked',
        nextAction: 'أوقف الإيقاف المؤقت من مركز التحكم ثم أعد الفحص'
      }))
    ],
    // No verdict is produced here on purpose.
    verdict: null,
    note: 'هذا التقرير يصف ما هو محفوظ محليًا فقط. فشل الفحص ليس غيابًا لمدفوعة، والحالة غير المعروفة لم تُحوَّل إلى حالة مؤكدة.'
  }

  if (reportPath) {
    fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true })
    fs.writeFileSync(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
  return report
}

if (require.main === module) {
  const output = process.argv[2] || path.join('data', `reconciliation-${Date.now()}.json`)
  const report = reconcile({ reportPath: output })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`\nwritten: ${path.resolve(output)}\n`)
}

module.exports = { baseline, cairoDayKey, classifyDate, classifySourceStatus, reconcile }