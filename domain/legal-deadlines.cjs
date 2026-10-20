'use strict'

/**
 * Plan 4.5 — pure legal-deadline rules ("الالتزامات المدروسة").
 *
 * A studied obligation must answer three questions without any guessing:
 *   1. WHICH document does it demand?  (matched against the legal_deadlines
 *      table by keyword — longest, most specific key wins)
 *   2. HOW MANY DAYS does the law give to deliver it? (the matched row)
 *   3. WHEN does that window close, and how low are we right now?
 *
 * Everything here is pure (no process-wide state, no db). The Cairo calendar
 * day is the only timeline this system is allowed to count (RULE Q).
 */

const CAIRO_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

/** Cairo calendar day of any Date/parseable timestamp: 'YYYY-MM-DD'. */
function cairoDayOf(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return CAIRO_DAY_FORMATTER.format(date)
}

function fromDayKey(dayKey) {
  const [year, month, day] = String(dayKey).split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(Date.UTC(year, month - 1, day, 12))
}

/** Adds N calendar days to a 'YYYY-MM-DD' Cairo day key. */
function addCalendarDays(dayKey, days) {
  const base = fromDayKey(dayKey)
  if (!base || typeof days !== 'number' || Number.isNaN(days)) return ''
  const shifted = new Date(base.getTime() + days * 86400000)
  // Format through the Cairo calendar so a +2/+3 DST shift can never eat a day.
  return cairoDayOf(shifted)
}

/** Whole calendar days from the Cairo day of `now` to the day `targetKey`. */
function daysBetweenCairo(nowValue, targetKey) {
  const nowDay = cairoDayOf(nowValue)
  const targetDay = cairoDayOf(targetKey)
  if (!nowDay || !targetDay) return null
  const start = fromDayKey(nowDay)
  const end = fromDayKey(targetDay)
  if (!start || !end) return null
  return Math.round((end.getTime() - start.getTime()) / 86400000)
}

/**
 * Picks the most specific legal rule matching a free-text record
 * (title + obligation code + start of the AI study text).
 * Longest match_key wins; no match returns null and NEVER a default —
 * a rule the engine cannot ground must not claim days.
 */
function matchLegalRule(text, rules) {
  if (!Array.isArray(rules)) return null
  let best = null
  for (const rule of rules) {
    if (!rule || typeof rule.match_key !== 'string' || rule.match_key === '') continue
    if (typeof text === 'string' && text.includes(rule.match_key)) {
      if (!best || rule.match_key.length > best.match_key.length) best = rule
    }
  }
  return best
}

/**
 * Extracts a portal-provided calendar date from heavy record text. Only the
 * strict 8-digit YYYYMMDD shape starting 20.. is accepted; every accepted
 * candidate is validated as a real month/day. Returns 'YYYY-MM-DD' or null —
 * a malformed embedding must never become a wrong deadline.
 */
function extractPortalDate(text) {
  if (typeof text !== 'string') return null
  const pattern = /\b(20\d{6})\b/g
  let match
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1]
    const year = Number(raw.slice(0, 4))
    const month = Number(raw.slice(4, 6))
    const day = Number(raw.slice(6, 8))
    if (month < 1 || month > 12 || day < 1 || day > 31) continue
    const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (fromDayKey(candidate)) return candidate
  }
  return null
}

/**
 * Arabic day-count phrasing for reminders and UI badges.
 * 0 → "اليوم", 1 → "يوم واحد", 2 → "يومان", 3–10 → "N أيام", else "N يوماً".
 */
function formatArabicDays(days) {
  const n = Math.round(Number(days))
  if (Number.isNaN(n)) return ''
  if (n === 0) return 'يوم'
  if (n === 1) return 'يوم واحد'
  if (n === 2) return 'يومين'
  if (n >= 3 && n <= 10) return `${n} أيام`
  return `${n} يوماً`
}

/** Colour/label tone for the countdown badge at a given remaining count. */
function deadlineTone(days) {
  if (days === null || days === undefined || Number.isNaN(days)) return null
  if (days < 0) return 'urgent'
  if (days <= 3) return 'urgent'
  if (days <= 7) return 'attention'
  return 'calm'
}

/**
 * Builds the low-days reminder text (Plan 4.5 §3) for a stamped obligation.
 * Language is fixed Arabic per RULE T; amounts are grounded in the row.
 * anchorMode 'portal_date' speaks of validity ending at the portal date;
 * the default (law_window) speaks of statutory submittal deadlines.
 */
function reminderMessage({ docName, legalDays, respondBy, days, anchorMode }) {
  if (days === null || days === undefined) return ''
  const doc = docName && String(docName).trim() ? String(docName).trim() : 'مستندات المصلحة'
  const isPortal = anchorMode === 'portal_date'
  if (days === 0) {
    if (isPortal) return `اليوم تنتهي صلاحية ${doc} — الموعد النهائي ${respondBy} — اتخاذ إجراء فوري`
    return `تنبيه مهلة قانونية: اليوم موعد تقديم ${doc} — الموعد النهائي ${respondBy} — قانون الإجراءات الضريبية الموحد 206/2020`
  }
  if (days === 1) {
    if (isPortal) return `يتبقى يوم واحد قبل انتهاء صلاحية ${doc} في ${respondBy} — اتخاذ إجراء فوري`
    return `تنبيه مهلة قانونية: متبقٍ يوم واحد لتقديم ${doc} قبل ${respondBy} — قانون الإجراءات الضريبية الموحد 206/2020`
  }
  if (days < 0) {
    const late = formatArabicDays(Math.abs(days))
    if (isPortal) return `انتهت صلاحية ${doc} منذ ${late} — الموعد كان ${respondBy} — تدخل فوري الآن`
    return `انتهت المهلة القانونية منذ ${late} على ${doc} — الموعد كان ${respondBy} — تدخل فوري لتقديم المستند ومراجعة الغرامات (قانون الإجراءات الضريبية الموحد 206/2020)`
  }
  const spanText = legalDays ? `${legalDays} يوماً` : 'القاعدة القانونية'
  if (isPortal) {
    return `متبقٍ ${formatArabicDays(days)} قبل انتهاء صلاحية ${doc} في ${respondBy} — حدّد التجديد مبكراً`
  }
  return `تنبيه مهلة قانونية: متبقٍ ${formatArabicDays(days)} من أصل ${spanText} لتقديم ${doc} قبل ${respondBy} — قانون الإجراءات الضريبية الموحد 206/2020`
}

/** Reminder thresholds: reminder the owner when the window is getting low. */
const REMINDER_THRESHOLD_DAYS = [7, 3, 1, 0]

module.exports = {
  cairoDayOf,
  addCalendarDays,
  daysBetweenCairo,
  matchLegalRule,
  extractPortalDate,
  formatArabicDays,
  deadlineTone,
  reminderMessage,
  REMINDER_THRESHOLD_DAYS
}
