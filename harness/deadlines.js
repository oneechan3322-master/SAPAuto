'use strict'

/**
 * Plan 4.5 — legal deadline service ("الالتزامات المدروسة").
 *
 * 1. After the AI studies an obligation, this service stamps WHICH document
 *    it demands, the law-determined days, the closing date (respond_by) and
 *    the legal basis — computed ONCE from the record's Cairo creation day +
 *    the matched rule, and never rewritten afterwards.
 * 2. The scheduler calls the reminder pass daily-ish; it inserts launcher
 *    reminders at 7/3/1/0 days left and once when overdue (deduped), so the
 *    accountant is told to send the document while it is still in time.
 *
 * Fail-safe defaults (RULE 7): no matched rule → no stamp, no reminder.
 */

const { getDatabase } = require('../db/connect')
const { id, now } = require('../db/queries/shared')
const {
  cairoDayOf,
  addCalendarDays,
  daysBetweenCairo,
  matchLegalRule,
  extractPortalDate,
  reminderMessage,
  REMINDER_THRESHOLD_DAYS
} = require('../domain/legal-deadlines.cjs')

const LOAD_RULES_SQL = 'SELECT match_key, doc_name, legal_days, basis, anchor_mode FROM legal_deadlines ORDER BY LENGTH(match_key) DESC'

function loadRules(db = getDatabase()) {
  return db.prepare(LOAD_RULES_SQL).all()
}

/**
 * Matches the free-text record (title + obligation code + beginning of the
 * AI study text) against the editable legal_deadlines rows.
 */
function matchLegalDeadline(db = getDatabase(), text) {
  return matchLegalRule(text, loadRules(db))
}

/**
 * Stamps ONE studied obligation — used right after the live AI study.
 * `now` is injectable for deterministic tests. Never overwrites a stamp.
 */
function stampObligation(db, obligation, { now = new Date() } = {}) {
  if (!db || !obligation || !obligation.id) return { stamped: false, reason: 'invalid-row' }
  const createdDay = cairoDayOf(obligation.created_at || now)
  if (!createdDay) return { stamped: false, reason: 'unparseable-created-at' }

  const text = [
    obligation.title || '',
    obligation.obligation_code || '',
    String(obligation.ai_study || '').slice(0, 600)
  ].join(' ')
  const rule = matchLegalRule(text, loadRules(db))
  if (!rule) return { stamped: false, reason: 'no-known-doc' }

  const anchorMode = rule.anchor_mode === 'portal_date' ? 'portal_date' : 'law_window'
  let respondBy
  if (anchorMode === 'portal_date') {
    // The portal itself carries the deadline (e.g. card validity). Use ONLY
    // the date embedded in the record; no law-window fallback, no invention.
    respondBy = extractPortalDate(text)
    if (!respondBy) return { stamped: false, reason: 'no-portal-date' }
  } else {
    respondBy = addCalendarDays(createdDay, rule.legal_days)
  }
  if (!respondBy) return { stamped: false, reason: 'uncomputable-deadline' }

  // Guard: only ever fills an empty stamp; a re-run can never move a date.
  const result = db.prepare(`
    UPDATE obligations
    SET required_doc = ?, legal_days = ?, respond_by = ?, deadline_basis = ?, anchor_mode = ?
    WHERE id = ? AND (required_doc = '' OR required_doc IS NULL)
  `).run(rule.doc_name, rule.legal_days, respondBy, rule.basis, anchorMode, obligation.id)
  return { stamped: Boolean(result.changes), doc: rule.doc_name, respondBy, anchorMode }
}

const STAMP_BATCH = `
  SELECT o.id, o.obligation_code, o.title, o.ai_study, o.created_at
  FROM obligations o
  WHERE (required_doc = '' OR required_doc IS NULL) AND IFNULL(ai_study,'') <> ''
  ORDER BY o.updated_at DESC
  LIMIT ?
`

/** Catch-up pass: stamp every studied obligation that still lacks a stamp. */
function applyObligationDeadlines(db = getDatabase(), { limit = 200, now = new Date() } = {}) {
  const rows = db.prepare(STAMP_BATCH).all(limit)
  let stamped = 0
  for (const row of rows) {
    const result = stampObligation(db, row, { now })
    if (result.stamped) stamped++
  }
  return { candidates: rows.length, stamped }
}

/**
 * Low-days reminder pass (Plan 4.5 §3): reminders at 7/3/1/0 days left and
 * one overdue notice, deduped per obligation/day-window, routed through the
 * existing launcher reminder flow and the events ledger.
 */
function createLegalDeadlineReminders(db = getDatabase(), day, { clockId = id, clockNow = now } = {}) {
  if (!day || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day)) return { inserted: 0 }
  const owner = db.prepare("SELECT id FROM users WHERE role='Owner' AND disabled=0 LIMIT 1").get()
  if (!owner) return { inserted: 0 }

  const rows = db.prepare(`
    SELECT o.id, o.title, o.required_doc, o.legal_days, o.respond_by, o.anchor_mode
    FROM obligations o
    WHERE IFNULL(o.respond_by,'') <> '' AND o.status NOT IN ('done','submitted','resolved')
  `).all()

  let inserted = 0
  for (const obligation of rows) {
    const days = daysBetweenCairo(`${day}T12:00:00Z`, obligation.respond_by)
    if (days === null) continue
    const isThreshold = REMINDER_THRESHOLD_DAYS.includes(days)
    const isOverdue = days < 0
    if (!isThreshold && !isOverdue) continue
    const kind = isOverdue ? 'overdue' : `${days}`
    const message = reminderMessage({
      docName: obligation.required_doc,
      legalDays: obligation.legal_days,
      respondBy: obligation.respond_by,
      days,
      anchorMode: obligation.anchor_mode === 'portal_date' ? 'portal_date' : 'law_window'
    })
    const key = `${obligation.id}:law:${obligation.respond_by}:${kind}`
    const result = db.prepare(`
      INSERT OR IGNORE INTO reminders(id,target_type,target_id,user_id,due_at,channel,dedupe_key,created_at,message)
      VALUES(?,?,?,?,?,'launcher',?,?,?)
    `).run(clockId('reminder'), 'obligation', obligation.id, owner.id, clockNow(), key, clockNow(), message)
    if (result.changes) {
      inserted++
      db.prepare('INSERT INTO events(id,kind,entity_id,payload,created_at) VALUES(?,?,?,?,?)')
        .run(clockId('event'), 'legal_deadline_reminder', obligation.id,
          JSON.stringify({ obligationId: obligation.id, days, doc: obligation.required_doc }), clockNow())
    }
  }
  return { inserted }
}

module.exports = {
  loadRules,
  matchLegalDeadline,
  stampObligation,
  applyObligationDeadlines,
  createLegalDeadlineReminders
}
