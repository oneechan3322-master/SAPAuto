'use strict'

const DAY_MS = 24 * 60 * 60 * 1000
const COMPLETED = {
  tasks: new Set(['done', 'complete', 'completed', 'resolved', 'submitted', 'closed', 'مكتمل', 'تم']),
  obligations: new Set(['done', 'complete', 'completed', 'resolved', 'submitted', 'closed', 'مكتمل', 'تم التقديم']),
  payments: new Set(['paid', 'done', 'complete', 'completed', 'resolved', 'settled', 'closed', 'تم السداد', 'مدفوع', 'مسدد بالكامل'])
}
const ACTIVE = {
  tasks: new Set(['open', 'pending', 'in_progress', 'in progress', 'قيد المتابعة', 'مفتوح']),
  obligations: new Set(['open', 'pending', 'in_progress', 'in progress', 'قيد المتابعة', 'مفتوح', 'غير مكتمل']),
  payments: new Set([
    'open', 'pending', 'payment_due', 'overdue', 'not_late', 'unpaid',
    'في انتظار السداد', 'مستحق للسداد', 'مستحق السداد', 'مسدد جزئياً', 'مسدد جزئيا',
    'partial', 'partially_paid', 'partially paid'
  ])
}

function normalizeStatus(value) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('en-US') : ''
}

function validDateKey(value) {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function cairoDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new TypeError('A valid date is required')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function shiftDateKey(value, days) {
  if (!validDateKey(value) || !Number.isInteger(days)) return null
  const [year, month, day] = value.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return shifted.toISOString().slice(0, 10)
}

function statusDisposition(kind, value) {
  const status = normalizeStatus(value)
  if (COMPLETED[kind]?.has(status)) return 'complete'
  if (ACTIVE[kind]?.has(status)) return 'active'
  return 'unknown'
}

function isOpenRecord(kind, status) {
  return statusDisposition(kind, status) === 'active'
}

function dueRelation(value, today) {
  if (!value) return 'missing_date'
  if (!validDateKey(String(value).slice(0, 10))) return 'invalid_date'
  const date = String(value).slice(0, 10)
  if (date < today) return 'overdue'
  if (date === today) return 'due_today'
  const week = shiftDateKey(today, 7)
  return date <= week ? 'due_soon' : 'upcoming'
}

function classifyRecord(kind, date, status, today = cairoDateKey()) {
  const disposition = statusDisposition(kind, status)
  if (disposition === 'complete') return 'complete'
  const relation = dueRelation(date, today)
  if (relation === 'missing_date' || relation === 'invalid_date') return relation
  if (disposition !== 'active') return 'unknown'
  return relation
}

function countDue(records, kind, today = cairoDateKey()) {
  return records.reduce((counts, record) => {
    const state = classifyRecord(kind, record.date, record.status, today)
    if (state === 'overdue') counts.overdue += 1
    if (state === 'due_today' || state === 'due_soon') counts.dueSoon += 1
    return counts
  }, { overdue: 0, dueSoon: 0 })
}

function formatAmount(value, currency) {
  if (value === null || value === undefined || value === '') return 'المبلغ غير متاح'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 'المبلغ غير متاح'
  const sourcePrecision = String(value).split('.')[1]?.length || 0
  const maximumFractionDigits = Math.min(20, Math.max(2, sourcePrecision))
  const minimumFractionDigits = Math.min(2, maximumFractionDigits)
  const formatter = new Intl.NumberFormat('en-US', { minimumFractionDigits, maximumFractionDigits })
  const code = typeof currency === 'string' ? currency.match(/\b([A-Z]{3})\b/)?.[1] : null
  if (!code) return `${formatter.format(amount)} · العملة غير محددة`
  const formatted = formatter.format(amount)
  return `${formatted} ${code}`
}

/**
 * Plan 2.4 §3.3 / §5.3 — the source lane and the local lane are reported as two
 * separate facts and are never merged into a single "status".
 *
 * A payment can be settled at the portal, settled locally, or contradictory
 * (both say different things). Contradiction is surfaced as contradiction; it
 * is never resolved silently, because which lane wins is a human decision.
 */
const LOCAL_REVIEW_LABELS = {
  not_reviewed: { label: 'لم تراجعها بعد', tone: 'muted' },
  needs_review: { label: 'تحتاج مراجعتك', tone: 'attention' },
  evidence_pending: { label: 'بانتظار مستند', tone: 'attention' },
  paid_locally: { label: 'مسدّدة محليًا', tone: 'calm' }
}

const SOURCE_DISPOSITION_LABELS = {
  complete: { label: 'مسدّدة في المصدر', tone: 'calm' },
  active: { label: 'مستحقة في المصدر', tone: 'attention' },
  unknown: { label: 'حالة المصدر غير معروفة', tone: 'muted' }
}

function describeSourceLane(kind, sourceStatus) {
  const disposition = statusDisposition(kind, sourceStatus)
  return {
    disposition,
    ...SOURCE_DISPOSITION_LABELS[disposition],
    raw: typeof sourceStatus === 'string' ? sourceStatus.trim() : ''
  }
}

function describeLocalLane(localReviewStatus) {
  const known = LOCAL_REVIEW_LABELS[localReviewStatus]
  return known
    ? { state: localReviewStatus, ...known }
    : { state: 'not_reviewed', ...LOCAL_REVIEW_LABELS.not_reviewed, raw: typeof localReviewStatus === 'string' ? localReviewStatus : '' }
}

/**
 * Full, honest payment state. `conflict` is the important one: the source and
 * the local lane disagree and the app says so instead of picking a winner.
 */
function describePayment(payment, kind = 'payments') {
  const source = describeSourceLane(kind, payment.source_status)
  const local = describeLocalLane(payment.local_review_status)
  const stale = Boolean(payment.source_stale)
  const conflict = (source.disposition === 'complete' && local.state === 'paid_locally' && stale)
    || (source.disposition === 'active' && local.state === 'paid_locally')
    || (source.disposition === 'complete' && local.state === 'needs_review')
  const flags = []
  if (stale) flags.push({ label: 'بيانات المصدر قديمة', tone: 'attention' })
  if (conflict) flags.push({ label: 'تعارض بين المصدر والمراجعة المحلية', tone: 'urgent' })
  if (source.disposition === 'unknown') flags.push({ label: 'لم نحدّد حالة السداد عند المصدر', tone: 'muted' })
  return { source, local, stale, conflict, flags }
}

module.exports = {
  cairoDateKey,
  classifyRecord,
  countDue,
  describeLocalLane,
  describePayment,
  describeSourceLane,
  dueRelation,
  formatAmount,
  isOpenRecord,
  shiftDateKey,
  statusDisposition,
  validDateKey
}
