/**
 * Cairo-timezone clock utilities — T5 fix.
 *
 * Egypt observes DST (forward last Friday of April, back last Thursday of
 * October; UTC+2 winter, UTC+3 summer). Any date derivation using new Date()
 * or UTC arithmetic can be off by one day in a 2-3 hour window around
 * midnight Cairo time during those transitions.
 *
 * For a tax office one day matters: the statutory penalty band changes at
 * 60 days past due and the two bands differ by an order of magnitude
 * (EGP 3,000-50,000 vs EGP 50,000-2,000,000).
 *
 * All functions here operate on YYYY-MM-DD civil-date strings or convert to
 * them via Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).
 * Node 24+ ships full ICU so this is correct across DST without any dep.
 *
 * Adheres to RULE 2 (VALIDATE ALL INPUTS), RULE 3 (NO SILENT FAILURES),
 * RULE 7 (FAIL-SAFE DEFAULTS).
 */

const CAIRO_TIME_ZONE = 'Africa/Cairo';
const CAIRO_TIMEZONE = CAIRO_TIME_ZONE;
const _CAIRO_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAIRO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

function daysInCivilMonth(year, month) {
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    return isLeap ? 29 : 28;
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

/**
 * Validates that year/month/day represent a real calendar date.
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} day 1-31
 * @returns {boolean}
 */
function isRealCivilDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && (d.getUTCMonth() + 1) === month && d.getUTCDate() === day;
}

/**
 * Formats civil parts as YYYY-MM-DD.
 * @param {{year: number, month: number, day: number}} parts
 * @returns {string}
 */
function formatCivilDay(parts) {
  const y = String(parts.year).padStart(4, '0');
  const m = String(parts.month).padStart(2, '0');
  const d = String(parts.day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Projects an instant onto its Cairo civil day.
 * Returns null for invalid or missing inputs.
 *
 * @param {Date|string|null|undefined} instant
 * @returns {{year: number, month: number, day: number}|null}
 */
function cairoCivilDay(instant) {
  if (instant === null || instant === undefined || instant === '') return null;
  let d;
  if (instant instanceof Date) {
    d = instant;
  } else if (typeof instant === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(instant)) {
      const parts = instant.split('-').map(Number);
      if (!isRealCivilDate(parts[0], parts[1], parts[2])) return null;
      return { year: parts[0], month: parts[1], day: parts[2] };
    }
    d = new Date(instant);
  } else {
    return null;
  }

  if (Number.isNaN(d.getTime())) return null;

  const parts = _CAIRO_FMT.formatToParts(d);
  let year = 0;
  let month = 0;
  let day = 0;
  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value);
    if (part.type === 'month') month = Number(part.value);
    if (part.type === 'day') day = Number(part.value);
  }

  if (!isRealCivilDate(year, month, day)) return null;
  return { year, month, day };
}

/**
 * Converts any Date (or YYYY-MM-DD string) to its YYYY-MM-DD Cairo civil date.
 * Returns null for anything unparseable or impossible.
 *
 * @param {Date|string|null|undefined} value
 * @returns {string|null}
 */
function cairoDayKey(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isNaN(value)) return null;
  const civil = cairoCivilDay(value);
  if (!civil) return null;
  return formatCivilDay(civil);
}

/**
 * Returns today in Cairo civil time as YYYY-MM-DD for an optional instant.
 * Throws if the instant is invalid.
 *
 * @param {Date|string} [instant=new Date()]
 * @returns {string}
 */
function cairoToday(instant = new Date()) {
  const civil = cairoCivilDay(instant);
  if (!civil) {
    throw new Error(`cairoToday requires a valid instant, got ${String(instant)}`);
  }
  return formatCivilDay(civil);
}

/**
 * Returns today in Cairo civil time as YYYY-MM-DD.
 * @returns {string}
 */
function todayInCairo() {
  return cairoToday(new Date());
}

/**
 * Returns a Date anchored to noon UTC on the given YYYY-MM-DD Cairo civil date.
 * Noon avoids DST-boundary off-by-one in subtraction arithmetic.
 *
 * @param {string} dayKey YYYY-MM-DD
 * @returns {Date}
 */
function cairoDateFromDayKey(dayKey) {
  if (typeof dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    throw new Error(`Invalid Cairo day key: ${JSON.stringify(dayKey)}`);
  }
  const parts = dayKey.split('-').map(Number);
  if (!isRealCivilDate(parts[0], parts[1], parts[2])) {
    throw new Error(`Invalid Cairo day key: ${dayKey}`);
  }
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
}

/**
 * Adds n calendar days to a YYYY-MM-DD key using pure calendar arithmetic.
 * Operates on civil date components, never on milliseconds, so DST transitions
 * cannot shift the result by one day.
 *
 * @param {string} dayKey YYYY-MM-DD
 * @param {number} n integer days to add (negative subtracts)
 * @returns {string} YYYY-MM-DD
 */
function addCairoDays(dayKey, n) {
  if (typeof dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    throw new Error(`Invalid Cairo day key: ${JSON.stringify(dayKey)}`);
  }
  const parts = dayKey.split('-').map(Number);
  if (!isRealCivilDate(parts[0], parts[1], parts[2])) {
    throw new Error(`Invalid Cairo day key: ${dayKey}`);
  }
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + n, 12, 0, 0));
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return formatCivilDay({ year: y, month: m, day });
}

/**
 * Whole days from civil date a to civil date b (b - a).
 * Both anchored to noon so DST does not influence the result.
 * Positive = b is after a; negative = b is before a.
 *
 * @param {string} a YYYY-MM-DD
 * @param {string} b YYYY-MM-DD
 * @returns {number}
 */
function cairoDaysBetween(a, b) {
  const dateA = cairoDateFromDayKey(a);
  const dateB = cairoDateFromDayKey(b);
  return Math.round((dateB.getTime() - dateA.getTime()) / 86400000);
}

/**
 * Returns current Cairo month in YYYY-MM format.
 * @returns {string}
 */
function currentMonthInCairo() {
  return todayInCairo().slice(0, 7);
}

/**
 * daysBetween for string inputs — validates format first.
 * @param {string} a YYYY-MM-DD
 * @param {string} b YYYY-MM-DD
 * @returns {number}
 */
function daysBetween(a, b) {
  if (typeof a !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(a)) {
    throw new Error(`daysBetween: invalid date string a=${JSON.stringify(a)}`);
  }
  if (typeof b !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b)) {
    throw new Error(`daysBetween: invalid date string b=${JSON.stringify(b)}`);
  }
  return cairoDaysBetween(a, b);
}

/**
 * Formats an instant in Arabic (ar-EG) Cairo time for display.
 * @param {Date|string} [instant=new Date()]
 * @returns {string}
 */
function cairoFormattedDateTime(instant = new Date()) {
  const d = instant instanceof Date ? instant : new Date(instant);
  return d.toLocaleString('ar-EG', { timeZone: CAIRO_TIME_ZONE });
}

module.exports = {
  CAIRO_TIME_ZONE,
  CAIRO_TIMEZONE,
  isRealCivilDate,
  formatCivilDay,
  cairoCivilDay,
  cairoDayKey,
  cairoToday,
  todayInCairo,
  currentMonthInCairo,
  cairoDateFromDayKey,
  addCairoDays,
  cairoDaysBetween,
  daysBetween,
  cairoFormattedDateTime,
  daysInCivilMonth
};
