/**
 * Document Type to Task Rules and Deadline Mapping.
 * Defines statutory response deadlines and actionable requirements for ETA/SAP document types.
 *
 * Adheres to:
 * - RULE 1: Never ignore return values
 * - RULE 2: Validate all inputs
 * - RULE 3: No silent failures
 * - RULE 4: Explicit error types
 * - RULE 6: Bounded operations
 * - RULE 7: Fail-safe defaults
 * - RULE 8: Assertions for invariants
 * - RULE 10: Defensive redundancy
 */

const { assertNonEmptyString, assertInvariant } = require('../common/assertions');
const { ValidationError } = require('../common/errors');
const { defaultLogger } = require('../common/logger');
const { addCairoDays, cairoDateFromDayKey, cairoDayKey, cairoDaysBetween, formatCivilDay, isRealCivilDate, todayInCairo } = require('../common/clock');

/**
 * Standard rule definition for ETA document types
 * @typedef {Object} TaskRule
 * @property {string} docTypeKey
 * @property {string} titlePattern
 * @property {number} deadlineDays
 * @property {string} defaultAction
 * @property {string} defaultRole
 * @property {string} category
 */

const DOCUMENT_RULES = [
  {
    docTypeKey: 'DOC_PREPARATION',
    match: (title) => title.includes('إخطار تجهيز مستندات') || title.includes('اخطار تجهيز'),
    deadlineDays: 15,
    defaultAction: 'تجهيز المستندات المطلوبة وتسليمها للمأمورية قبل انتهاء المهلة.',
    defaultRole: 'مدير المكتب',
    category: 'preparation'
  },
  {
    docTypeKey: 'RECEIPT_CONFIRMATION',
    match: (title) => title.includes('تأكيد استلام') || title.includes('تاكيد إستلام') || title.includes('تاكيد استلام'),
    deadlineDays: 10,
    defaultAction: 'تأكيد الاستلام وإرسال الرد والمرفقات المطلوبة قبل الموعد.',
    defaultRole: 'مدير المكتب',
    category: 'confirmation'
  },
  {
    docTypeKey: 'FORM_19_STAMP',
    match: (title) => title.includes('نموذج ١٩') || title.includes('نموذج 19') || title.includes('دمغة'),
    deadlineDays: 30,
    defaultAction: 'مراجعة التقدير والنموذج الضريبي وإعداد مذكرة الدفاع أو الطعن القانوني.',
    defaultRole: 'المستشار الضريبي',
    category: 'form19'
  },
  {
    docTypeKey: 'REJECTION_REASONS',
    match: (title) => title.includes('اسباب الرفض') || title.includes('أسباب الرفض'),
    deadlineDays: 15,
    defaultAction: 'متابعة أسباب الرفض واستيفاء النواقص أو تصحيح المستندات المرفوضة.',
    defaultRole: 'مسؤول الحسابات',
    category: 'rejection'
  },
  {
    docTypeKey: 'ACCEPTANCE_NOTES',
    match: (title) => title.includes('ملاحظات قبول'),
    deadlineDays: 7,
    defaultAction: 'مراجعة شروط وملاحظات القبول وسداد الرسوم أو إتمام الإجراءات.',
    defaultRole: 'مسؤول الحسابات',
    category: 'acceptance'
  },
  {
    docTypeKey: 'HEARING_SESSION',
    match: (title) => title.includes('الحضور لجلسة') || title.includes('جلسة نظر الطعن'),
    deadlineDays: 5,
    defaultAction: 'إعداد ملف الطعن وحضور الجلسة المحددة بمقر اللجنة.',
    defaultRole: 'المحامي / المفوض',
    category: 'hearing'
  },
  {
    docTypeKey: 'OPNA_FORM',
    match: (title) => title.toUpperCase().includes('OPNA'),
    deadlineDays: 15,
    defaultAction: 'مراجعة نموذج OPNA واعتماده ومطابقة البيانات.',
    defaultRole: 'مدير الحسابات',
    category: 'opna'
  }
];

const DEFAULT_RULE = {
  docTypeKey: 'GENERAL_NOTICE',
  deadlineDays: 15,
  defaultAction: 'مراجعة المستند المرفق واتخاذ الإجراء اللازم والتأكد من مطابقة السجلات.',
  defaultRole: 'مدير المكتب',
  category: 'general'
};

/**
 * Normalizes portal text for pattern matching
 * @param {string} val
 * @returns {string}
 */
function normalizeText(val) {
  if (typeof val !== 'string') {
    return '';
  }
  return val.replace(/[\u200e\u200f\u061c]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Builds a `YYYY-MM-DD` key from loose parts, rejecting dates that do not exist
 * so that `31/02/2026` cannot roll over into March and become a real deadline.
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} day 1-31
 * @returns {string|null}
 */
function civilKeyFromParts(year, month, day) {
  if (!isRealCivilDate(year, month, day)) {
    return null;
  }
  return formatCivilDay({ year, month, day });
}

/**
 * Parses date string in multiple potential formats (YYYY-MM-DD, DD/MM/YYYY, YYYY/MM/DD)
 *
 * The components are read with plain regex, so they carry no timezone. The
 * resulting `Date` is anchored at midday *Cairo* time rather than midday
 * machine time, which makes the value mean the same civil day everywhere.
 * Read the civil fields back with `cairoDayKey`, not `getFullYear`/`getDate`.
 *
 * @param {string} dateStr
 * @returns {Date|null}
 */
function parseDateString(dateStr) {
  const norm = normalizeText(dateStr);
  if (!norm) return null;

  // Format YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = norm.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymdMatch) {
    const key = civilKeyFromParts(
      Number.parseInt(ymdMatch[1], 10),
      Number.parseInt(ymdMatch[2], 10),
      Number.parseInt(ymdMatch[3], 10)
    );
    if (key !== null) {
      return cairoDateFromDayKey(key);
    }
  }

  // Format DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = norm.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmyMatch) {
    const key = civilKeyFromParts(
      Number.parseInt(dmyMatch[3], 10),
      Number.parseInt(dmyMatch[2], 10),
      Number.parseInt(dmyMatch[1], 10)
    );
    if (key !== null) {
      return cairoDateFromDayKey(key);
    }
  }

  return null;
}

/**
 * Finds rule matching the title
 * @param {string} rawTitle
 * @returns {typeof DOCUMENT_RULES[0] | typeof DEFAULT_RULE}
 */
function findRuleForTitle(rawTitle) {
  const title = normalizeText(rawTitle);
  if (!title) {
    return DEFAULT_RULE;
  }

  for (let i = 0; i < DOCUMENT_RULES.length; i++) {
    const rule = DOCUMENT_RULES[i];
    try {
      if (rule.match(title)) {
        return rule;
      }
    } catch (err) {
      defaultLogger.warn(`Rule match failed for pattern: ${err.message}`, { title });
    }
  }

  return DEFAULT_RULE;
}

/**
 * Computes task deadline given issue date and title
 *
 * The deadline is pure calendar arithmetic on Cairo civil dates: adding
 * `days * 24h` of epoch milliseconds instead would land on the wrong day
 * whenever the span crosses an Egyptian DST transition or the host is not on
 * Cairo time.
 *
 * @param {string} dateStr
 * @param {string} title
 * @param {Date|string} [referenceInstant=todayInCairo()]
 * @returns {{ deadline: Date, deadlineStr: string, deadlineDays: number, rule: any }}
 */
function computeTaskDeadline(dateStr, title, referenceInstant = todayInCairo()) {
  assertNonEmptyString(title, 'title', 'computeTaskDeadline');
  const rule = findRuleForTitle(title);
  assertInvariant(typeof rule.deadlineDays === 'number', 'Rule deadlineDays must be number');

  const baseDayKey = cairoDayKey(parseDateString(dateStr))
    || cairoDayKey(referenceInstant);
  assertInvariant(baseDayKey !== null, 'Deadline base date must resolve to a Cairo civil date');

  const deadlineStr = addCairoDays(baseDayKey, rule.deadlineDays);

  return {
    deadline: cairoDateFromDayKey(deadlineStr),
    deadlineStr,
    deadlineDays: rule.deadlineDays,
    rule
  };
}

/**
 * Computes urgency status and badge info relative to a reference date
 *
 * Both sides are reduced to Cairo civil dates before subtracting, so the result
 * depends on neither the host timezone nor an Egyptian DST transition. This
 * `daysLeft` is what `evaluatePenaltyBand` classifies, so an off-by-one here
 * moves a task across the 60-day statutory boundary.
 *
 * @param {Date|string} deadlineInput
 * @param {Date|string} [referenceDate=todayInCairo()]
 * @returns {{ urgency: 'overdue'|'today'|'tomorrow'|'soon'|'normal', badgeText: string, badgeClass: string, daysLeft: number }}
 */
function evaluateUrgency(deadlineInput, referenceDate = todayInCairo()) {
  const deadlineKey = cairoDayKey(deadlineInput);
  const referenceKey = cairoDayKey(referenceDate);

  if (deadlineKey === null || referenceKey === null) {
    return {
      urgency: 'normal',
      badgeText: 'مستقر',
      badgeClass: 'badge-normal',
      daysLeft: 999
    };
  }

  const daysLeft = cairoDaysBetween(referenceKey, deadlineKey);

  if (daysLeft < 0) {
    const overdueDays = Math.abs(daysLeft);
    const overdueText = overdueDays === 1 ? 'متأخر يوماً' : (overdueDays === 2 ? 'متأخر يومين' : `متأخر ${overdueDays} أيام`);
    return {
      urgency: 'overdue',
      badgeText: overdueText,
      badgeClass: 'badge-overdue',
      daysLeft
    };
  }

  if (daysLeft === 0) {
    return {
      urgency: 'today',
      badgeText: 'اليوم',
      badgeClass: 'badge-today',
      daysLeft
    };
  }

  if (daysLeft === 1) {
    return {
      urgency: 'tomorrow',
      badgeText: 'غداً',
      badgeClass: 'badge-tomorrow',
      daysLeft
    };
  }

  if (daysLeft <= 3) {
    return {
      urgency: 'soon',
      badgeText: `خلال ${daysLeft} أيام`,
      badgeClass: 'badge-soon',
      daysLeft
    };
  }

  return {
    urgency: 'normal',
    badgeText: `متبقي ${daysLeft} يوماً`,
    badgeClass: 'badge-normal',
    daysLeft
  };
}

module.exports = {
  DOCUMENT_RULES,
  DEFAULT_RULE,
  normalizeText,
  parseDateString,
  findRuleForTitle,
  computeTaskDeadline,
  evaluateUrgency
};
