/**
 * Egyptian Tax Statutory Obligation Rules.
 *
 * Encodes the statutory filing calendar for the obligation types the office
 * tracks, so the dashboard can show a trustworthy "الالتزامات" summary without
 * ever inventing a deadline it cannot justify.
 *
 * Adheres to:
 * - RULE 1: Never ignore return values
 * - RULE 2: Validate all inputs
 * - RULE 3: No silent failures
 * - RULE 4: Explicit error types
 * - RULE 6: Bounded operations
 * - RULE 7: Fail-safe defaults (an unknown cadence yields no deadline, not a guess)
 */

const { ValidationError } = require('../common/errors');
const { assertNonEmptyString } = require('../common/assertions');
const { cairoCivilDay, cairoDayKey, cairoDaysBetween, cairoDateFromDayKey, daysInCivilMonth, formatCivilDay, todayInCairo } = require('../common/clock');

/** Days before the deadline at which an obligation is flagged as "due soon". */
const DUE_SOON_DAYS = 7;
const MAX_GENERATED_OBLIGATIONS = 4000;

/**
 * The statutory obligation catalogue.
 * cadence: monthly | quarterly | annual | ad_hoc
 */
const TAX_TYPES = {
  VAT: {
    key: 'VAT',
    label: 'ضريبة القيمة المضافة',
    formLabel: 'إقرار ض.ق.م',
    cadence: 'monthly',
    action: 'تقديم إقرار ضريبة القيمة المضافة وسداد المستحق قبل نهاية الشهر التالي.'
  },
  PAYROLL_STAMP: {
    key: 'PAYROLL_STAMP',
    label: 'ضريبة كسب العمل والدمغة',
    formLabel: 'نموذج 4 مرتبات',
    cadence: 'quarterly',
    action: 'تقديم نموذج 4 (كسب العمل والدمغة) وسداد المستحق خلال شهر من انتهاء الربع.'
  },
  WITHHOLDING: {
    key: 'WITHHOLDING',
    label: 'الخصم والتحصيل',
    formLabel: 'نموذج 41',
    cadence: 'quarterly',
    action: 'تقديم إقرار الخصم والتحصيل (نموذج 41) وسداد المبالغ المحتجزة.'
  },
  CIT: {
    key: 'CIT',
    label: 'ضريبة الدخل السنوية',
    formLabel: 'إقرار 28 / 27',
    cadence: 'annual',
    action: 'تقديم الإقرار السنوي لضريبة الدخل وقوائم المركز المالي قبل 30 أبريل.'
  },
  PORTAL_FILING: {
    key: 'PORTAL_FILING',
    label: 'التزامات التقديم في البوابة',
    formLabel: 'التزامات ETA',
    cadence: 'ad_hoc',
    action: 'مراجعة الالتزام في بوابة ETA وتقديمه قبل الموعد المعلن.'
  }
};

/** The obligation types seeded for every tracked company, in display order. */
const DEFAULT_SEED_TAX_TYPES = ['VAT', 'PAYROLL_STAMP', 'WITHHOLDING', 'CIT'];

/**
 * Obligation statuses surfaced on the dashboard.
 *
 * `resolved_unconfirmed` means the obligation was pending on the last cycle and
 * is absent from the portal's complete ("الكل") view. It is deliberately not
 * `submitted`: the system does not know that it was filed, and saying so would
 * invent a fact. Equally it is not `overdue`, which would warn about a filing
 * the office may already have made.
 */
const OBLIGATION_STATUSES = [
  'submitted',
  'overdue',
  'due_soon',
  'unsubmitted',
  'unknown',
  'resolved_unconfirmed'
];

/**
 * Obligation kinds.
 *
 * A filing is something you submit and can be fined for not submitting. A
 * certificate is a document whose date is its *expiry*, not a submission
 * deadline — "البطاقة الضريبية سارية حتى 2028" is valid until then and owes
 * nothing. Both arrive on the same portal screen and both have a date, so
 * before this split they were indistinguishable and every tax card counted as
 * an overdue filing.
 */
const OBLIGATION_KINDS = ['filing', 'certificate'];

/** Days before expiry at which a certificate is flagged for renewal. */
const CERTIFICATE_EXPIRING_DAYS = 30;

/**
 * Substrings that identify a certificate or licence rather than a filing.
 *
 * Deliberately narrow: a false positive here would hide a real filing, which is
 * worse than showing a certificate as a filing. Every entry marks a document
 * that is *valid until* a date rather than *due on* a date.
 */
const CERTIFICATE_MARKERS = [
  'بطاقة ضريبية',
  'البطاقة الضريبية',
  'شهادة تسجيل',
  'شهادة تسجيل ض',
  'شهادة القيمة المضافة',
  'شهادة ض.ق.م',
  'شهادة ضريبة',
  'رخصة',
  'سجل تجاري',
  'توكيل',
  'شهادة سريان'
];

/**
 * Status values that belong to the filing vocabulary.
 * @type {Set<string>}
 */
const FILING_STATUS_VALUES = new Set(['submitted', 'overdue', 'due_soon', 'unsubmitted', 'unknown', 'resolved_unconfirmed']);

/**
 * Status values that belong to the certificate vocabulary.
 * @type {Set<string>}
 */
const CERTIFICATE_STATUS_VALUES = new Set(['valid', 'expiring_soon', 'expired']);

/**
 * Arabic display label + badge class for each status.
 *
 * `overdue` is the filing vocabulary. A certificate that has expired uses
 * `expired` so it can be reported without ever being called late.
 */
const STATUS_STYLES = {
  submitted: { label: 'تم التقديم', badgeClass: 'badge-completed' },
  overdue: { label: 'متأخر', badgeClass: 'badge-overdue' },
  due_soon: { label: 'قريب الاستحقاق', badgeClass: 'badge-today' },
  unsubmitted: { label: 'لم يُقدَّم', badgeClass: 'badge-normal' },
  unknown: { label: 'موعد غير محدد', badgeClass: 'badge-normal' },
  expired: { label: 'منتهي', badgeClass: 'badge-overdue' },
  expiring_soon: { label: 'قارب على الانتهاء', badgeClass: 'badge-today' },
  valid: { label: 'ساري', badgeClass: 'badge-completed' },
  resolved_unconfirmed: { label: 'غير ظاهر — يحتاج تأكيد', badgeClass: 'badge-waiting' }
};

/**
 * Builds a UTC date at midday to stay clear of daylight-saving edges.
 * @param {number} year
 * @param {number} monthIndex - 0-11
 * @param {number} day
 * @returns {Date}
 */
function utcDate(year, monthIndex, day) {
  return cairoDateFromDayKey(formatCivilDay({ year, month: monthIndex + 1, day }));
}

/**
 * Formats a Date as YYYY-MM-DD.
 * @param {Date} date
 * @returns {string}
 */
function toDateKey(date) {
  return date.toISOString().split('T')[0];
}

/**
 * The last calendar day of a month.
 * @param {number} year
 * @param {number} monthIndex - 0-11
 * @returns {Date}
 */
function lastDayOfMonth(year, monthIndex) {
  const month = monthIndex + 1; // 1-12
  return utcDate(year, monthIndex, daysInCivilMonth(year, month));
}

/**
 * Parses a period key into its cadence and components.
 * Accepts 'YYYY-MM' (monthly), 'YYYY-QN' (quarterly) and 'YYYY' (annual).
 *
 * @param {unknown} periodKey
 * @returns {{cadence: string, year: number, monthIndex: number|null, quarter: number|null}}
 */
function parsePeriodKey(periodKey) {
  const key = assertNonEmptyString(periodKey, 'periodKey', 'parsePeriodKey');

  const monthMatch = /^(\d{4})-(\d{2})$/.exec(key);
  if (monthMatch) {
    const month = Number(monthMatch[2]);
    if (month < 1 || month > 12) {
      throw new ValidationError(`Month out of range in period key "${key}"`, { periodKey: key });
    }
    return { cadence: 'monthly', year: Number(monthMatch[1]), monthIndex: month - 1, quarter: null };
  }

  const quarterMatch = /^(\d{4})-Q([1-4])$/i.exec(key);
  if (quarterMatch) {
    return { cadence: 'quarterly', year: Number(quarterMatch[1]), monthIndex: null, quarter: Number(quarterMatch[2]) };
  }

  const yearMatch = /^(\d{4})$/.exec(key);
  if (yearMatch) {
    return { cadence: 'annual', year: Number(yearMatch[1]), monthIndex: null, quarter: null };
  }

  throw new ValidationError(`Unrecognized period key "${key}" (expected YYYY-MM, YYYY-QN or YYYY)`, { periodKey: key });
}

/**
 * VAT rule: the deadline is the last day of the month following the period.
 * @param {string} periodKey - 'YYYY-MM'
 * @returns {{deadline: string, basis: string}}
 */
function computeVatDeadline(periodKey) {
  const { year, monthIndex } = parsePeriodKey(periodKey);
  const followingMonth = monthIndex + 1;
  const deadline = followingMonth > 11
    ? lastDayOfMonth(year + 1, followingMonth - 12)
    : lastDayOfMonth(year, followingMonth);

  return { deadline: toDateKey(deadline), basis: 'آخر يوم من الشهر التالي لفترة الإقرار' };
}

/**
 * Payroll / stamp / withholding rule: the deadline is the last day of the month
 * following the quarter. Q1 -> end of April, Q2 -> end of July, Q3 -> end of
 * October, Q4 -> end of January.
 *
 * @param {string} periodKey - 'YYYY-QN' or 'YYYY-MM'
 * @returns {{deadline: string, basis: string}}
 */
function computeQuarterlyDeadline(periodKey) {
  const parsed = parsePeriodKey(periodKey);
  const year = parsed.year;
  let quarter = parsed.quarter;

  if (quarter === null) {
    if (parsed.monthIndex === null) {
      throw new ValidationError(`Quarterly deadline requires a quarter or a month, got "${periodKey}"`, { periodKey });
    }
    quarter = Math.floor(parsed.monthIndex / 3) + 1;
  }

  const quarterEndMonthIndex = (quarter * 3) - 1;
  const followingMonthIndex = quarterEndMonthIndex + 1;

  const deadline = followingMonthIndex > 11
    ? lastDayOfMonth(year + 1, followingMonthIndex - 12)
    : lastDayOfMonth(year, followingMonthIndex);

  return {
    deadline: toDateKey(deadline),
    basis: `آخر يوم من الشهر التالي للربع ${quarter}`
  };
}

/**
 * Corporate income tax rule: 30 April of the year following the fiscal year.
 * @param {string|number} periodKey - 'YYYY'
 * @returns {{deadline: string, basis: string}}
 */
function computeAnnualCitDeadline(periodKey) {
  const parsed = parsePeriodKey(String(periodKey));
  return {
    deadline: toDateKey(utcDate(parsed.year + 1, 3, 30)),
    basis: '30 أبريل من السنة التالية للسنة المالية'
  };
}

/**
 * Resolves the statutory deadline for one tax type and period.
 * An ad-hoc type (portal filings) has no computed deadline: it must come from
 * the portal itself, otherwise the deadline stays unknown (RULE 7).
 *
 * @param {string} taxTypeKey
 * @param {string} periodKey
 * @returns {{deadline: string|null, basis: string}}
 */
function resolveDeadline(taxTypeKey, periodKey) {
  const taxType = TAX_TYPES[assertNonEmptyString(taxTypeKey, 'taxTypeKey', 'resolveDeadline')];
  if (!taxType) {
    throw new ValidationError(`Unknown tax type "${taxTypeKey}"`, { taxTypeKey });
  }

  if (taxType.cadence === 'monthly') return computeVatDeadline(periodKey);
  if (taxType.cadence === 'quarterly') return computeQuarterlyDeadline(periodKey);
  if (taxType.cadence === 'annual') return computeAnnualCitDeadline(periodKey);

  return { deadline: null, basis: 'يُحدد من بوابة ETA ولا يجوز اختراعه' };
}

/**
 * Builds the stable identity of an obligation.
 * @param {string} companyKey
 * @param {string} taxTypeKey
 * @param {string} periodKey
 * @returns {string}
 */
function buildObligationId(companyKey, taxTypeKey, periodKey) {
  const company = assertNonEmptyString(companyKey, 'companyKey', 'buildObligationId');
  const taxType = assertNonEmptyString(taxTypeKey, 'taxTypeKey', 'buildObligationId');
  const period = assertNonEmptyString(periodKey, 'periodKey', 'buildObligationId');
  return `${company}::${taxType}::${period}`;
}

/**
 * Decides whether a portal row is a filing or a certificate.
 *
 * @param {string} text - form title, revenue type and raw row text combined
 * @returns {'filing'|'certificate'}
 */
function classifyObligationKind(text) {
  const haystack = String(text || '');
  // Normalise the alef variants the portal mixes (أ / إ / ا) and strip
  // diacritics, so one marker does not need four spellings.
  const normalized = haystack
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/\u064a/g, 'ي')
    .replace(/\u0649/g, 'ي');

  for (const marker of CERTIFICATE_MARKERS) {
    const needle = marker
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/[ً-ٰٟ]/g, '')
      .replace(/\u064a/g, 'ي')
      .replace(/\u0649/g, 'ي');
    if (normalized.includes(needle)) return 'certificate';
  }
  return 'filing';
}

/**
 * Evaluates one obligation against a reference date.
 *
 * `deadlineKey` is a stored Cairo civil date and is used as-is; `asOf` is an
 * instant and is projected onto the Cairo civil day. The subtraction is
 * calendar arithmetic, so neither the host timezone nor an Egyptian DST
 * transition can shift the result by a day.
 *
 * A certificate is never `overdue`. Its date is an expiry, so the honest
 * vocabulary is `valid` / `expiring_soon` / `expired` — reporting a tax card
 * as a late filing would warn a client about a penalty that does not exist.
 *
 * @param {string|null} deadlineKey - 'YYYY-MM-DD' or null when unknown
 * @param {boolean} submitted
 * @param {Date|string} [asOf=todayInCairo()]
 * @param {'filing'|'certificate'} [kind='filing']
 * @returns {{status: string, daysLeft: number|null}}
 */
function evaluateObligationStatus(deadlineKey, submitted, asOf = todayInCairo(), kind = 'filing') {
  // A submitted filing is settled regardless of what date is on it, so the
  // check precedes date parsing and keeps the pre-existing contract that a
  // missing deadline on a submitted return still reads as submitted.
  if (submitted && kind !== 'certificate') {
    return { status: 'submitted', daysLeft: null };
  }

  const deadline = cairoDayKey(deadlineKey);
  const reference = cairoDayKey(asOf);
  if (deadline === null || reference === null) {
    return { status: 'unknown', daysLeft: null };
  }

  const daysLeft = cairoDaysBetween(reference, deadline);

  if (kind === 'certificate') {
    if (daysLeft < 0) return { status: 'expired', daysLeft };
    if (daysLeft <= CERTIFICATE_EXPIRING_DAYS) return { status: 'expiring_soon', daysLeft };
    return { status: 'valid', daysLeft };
  }

  if (daysLeft < 0) return { status: 'overdue', daysLeft };
  if (daysLeft <= DUE_SOON_DAYS) return { status: 'due_soon', daysLeft };
  return { status: 'unsubmitted', daysLeft };
}

/**
 * The period key currently open for a tax type.
 *
 * A tax period opens on a Cairo calendar date, so "which period are we in" is
 * asked of Cairo time rather than of the host's timezone.
 *
 * @param {string} taxTypeKey
 * @param {Date|string} [asOf=todayInCairo()]
 * @returns {string}
 */
function currentPeriodKey(taxTypeKey, asOf = todayInCairo()) {
  const taxType = TAX_TYPES[assertNonEmptyString(taxTypeKey, 'taxTypeKey', 'currentPeriodKey')];
  if (!taxType) {
    throw new ValidationError(`Unknown tax type "${taxTypeKey}"`, { taxTypeKey });
  }

  const cairoNow = cairoCivilDay(asOf);
  if (cairoNow === null) {
    throw new ValidationError('currentPeriodKey requires a valid reference instant', { taxTypeKey });
  }

  const year = cairoNow.year;
  const monthIndex = cairoNow.month - 1;

  if (taxType.cadence === 'quarterly') return `${year}-Q${Math.floor(monthIndex / 3) + 1}`;
  if (taxType.cadence === 'annual') return String(year - 1);
  return `${year}-${String(cairoNow.month).padStart(2, '0')}`;
}

/**
 * Builds the statutory obligation set for one company for its current periods.
 * Existing submissions are preserved through `submittedMap`.
 *
 * @param {Object} [params={}]
 * @param {string} params.companyKey
 * @param {string} params.companyName
 * @param {string[]} [params.taxTypeKeys=DEFAULT_SEED_TAX_TYPES]
 * @param {Record<string, boolean>} [params.submittedMap={}] - obligationId -> submitted
 * @param {Date|string} [params.asOf=todayInCairo()]
 * @returns {Array<Object>} Obligation records
 */
function buildStatutoryObligations(params = {}) {
  const companyKey = assertNonEmptyString(params.companyKey, 'companyKey', 'buildStatutoryObligations');
  const companyName = assertNonEmptyString(params.companyName, 'companyName', 'buildStatutoryObligations');
  const taxTypeKeys = (Array.isArray(params.taxTypeKeys) && params.taxTypeKeys.length > 0)
    ? params.taxTypeKeys
    : DEFAULT_SEED_TAX_TYPES;
  const submittedMap = (params.submittedMap && typeof params.submittedMap === 'object') ? params.submittedMap : {};
  const asOf = params.asOf !== undefined ? params.asOf : todayInCairo();

  const obligations = [];
  const limit = Math.min(taxTypeKeys.length, MAX_GENERATED_OBLIGATIONS);

  for (let i = 0; i < limit; i++) {
    const taxTypeKey = taxTypeKeys[i];
    const taxType = TAX_TYPES[taxTypeKey];
    if (!taxType) continue;

    const periodKey = currentPeriodKey(taxTypeKey, asOf);
    const resolved = resolveDeadline(taxTypeKey, periodKey);
    const id = buildObligationId(companyKey, taxTypeKey, periodKey);
    const submitted = submittedMap[id] === true;
    const evaluated = evaluateObligationStatus(resolved.deadline, submitted, asOf);

    obligations.push({
      id,
      companyKey,
      company: companyName,
      taxTypeKey,
      taxLabel: taxType.label,
      formLabel: taxType.formLabel,
      periodKey,
      // Everything seeded here is a statutory return, never a certificate.
      kind: 'filing',
      deadline: resolved.deadline,
      deadlineBasis: resolved.basis,
      requiredAction: taxType.action,
      submitted,
      submittedAt: submitted ? (submittedMap[`${id}::at`] || null) : null,
      status: evaluated.status,
      daysLeft: evaluated.daysLeft
    });
  }

  return obligations;
}

/**
 * Counts obligations by status, with filings and certificates kept apart.
 *
 * The filing counters are the ones that drive penalty warnings, so they must
 * never include a certificate. Certificate status values that are not filing
 * values (`expired`, `expiring_soon`, `valid`) are counted separately instead
 * of being folded into `unknown`, which would have made them look like filings
 * with no date.
 *
 * @param {Array<Object>} obligations
 * @returns {{total: number, overdue: number, due_soon: number, unsubmitted: number,
 *   submitted: number, unknown: number, open: number,
 *   certificates: number, certificatesValid: number, certificatesExpiringSoon: number,
 *   certificatesExpired: number, certificatesUnknown: number, filings: number}}
 */
function summarizeObligations(obligations) {
  const list = Array.isArray(obligations) ? obligations : [];
  const summary = {
    total: list.length,
    overdue: 0,
    due_soon: 0,
    unsubmitted: 0,
    submitted: 0,
    unknown: 0,
    // Awaiting confirmation: present but not actionable. Declared here so
    // `open` can subtract it without producing NaN when none are flagged.
    resolved_unconfirmed: 0,
    open: 0,
    filings: 0,
    certificates: 0,
    certificatesValid: 0,
    certificatesExpiringSoon: 0,
    certificatesExpired: 0,
    certificatesUnknown: 0
  };

  for (const item of list) {
    const status = (item && typeof item.status === 'string') ? item.status : 'unknown';
    const isCertificate = !!item && (item.kind === 'certificate' || CERTIFICATE_STATUS_VALUES.has(status));

    if (isCertificate) {
      summary.certificates += 1;
      if (status === 'valid') summary.certificatesValid += 1;
      else if (status === 'expiring_soon') summary.certificatesExpiringSoon += 1;
      else if (status === 'expired') summary.certificatesExpired += 1;
      else summary.certificatesUnknown += 1;
      continue;
    }

    summary.filings += 1;
    if (FILING_STATUS_VALUES.has(status)) {
      summary[status] += 1;
    } else {
      summary.unknown += 1;
    }
  }

  // `resolved_unconfirmed` is counted in its own bucket and deliberately not
  // summed here, so awaiting confirmation never inflates the open count. This
  // is the same reasoning that keeps certificates out of the filing tiles.
  summary.open = summary.overdue + summary.due_soon + summary.unsubmitted + summary.unknown;
  summary.needsConfirmation = summary.resolved_unconfirmed;

  return summary;
}

/**
 * Parses a raw obligation row from the live portal at `#/filing_obligations`.
 * Matches the live portal screen columns:
 * النموذج | الفترة | الفترة من | الفترة إلى | نوع الإيرادات | تاريخ الاستحقاق
 *
 * @param {Object} rowData
 * @param {Array<string>} [rowData.cells]
 * @param {string} [rowData.rawText]
 * @param {string} companyKey
 * @param {string} companyName
 * @param {Date|string} [asOf=todayInCairo()]
 * @returns {Object|null}
 */
function parsePortalObligationRow(rowData, companyKey, companyName, asOf = todayInCairo()) {
  if (!rowData || typeof rowData !== 'object') return null;

  let formTitle = (typeof rowData.formTitle === 'string' ? rowData.formTitle : '').trim();
  let period = (typeof rowData.period === 'string' ? rowData.period : '').trim();
  let periodFrom = (typeof rowData.periodFrom === 'string' ? rowData.periodFrom : '').trim();
  let periodTo = (typeof rowData.periodTo === 'string' ? rowData.periodTo : '').trim();
  let revenueType = (typeof rowData.revenueType === 'string' ? rowData.revenueType : '').trim();
  let dueDate = (typeof rowData.dueDate === 'string' ? rowData.dueDate : '').trim();
  let receivedDate = (typeof rowData.receivedDate === 'string' ? rowData.receivedDate : '').trim();
  const rawText = String(rowData.rawText || '').trim();

  // If structured fields were not provided directly, parse from rowData.cells
  if (!formTitle && Array.isArray(rowData.cells) && rowData.cells.length > 0) {
    const cleanCells = rowData.cells.map(c => String(c || '').trim());
    // Strip leading empty highlight cell if present
    const dataCells = (cleanCells[0] === '' && cleanCells.length >= 7) ? cleanCells.slice(1) : cleanCells;

    if (dataCells.length >= 1) formTitle = dataCells[0] || '';
    if (dataCells.length >= 2) period = dataCells[1] || '';
    if (dataCells.length >= 3) periodFrom = dataCells[2] || '';
    if (dataCells.length >= 4) periodTo = dataCells[3] || '';
    if (dataCells.length >= 5) revenueType = dataCells[4] || '';
    if (dataCells.length >= 6) dueDate = dataCells[5] || '';
    if (dataCells.length >= 7) receivedDate = dataCells[6] || '';
  }

  // Fallback: extract date from raw text if dueDate not isolated
  const cleanDate = (d) => {
    if (!d) return null;
    const m = String(d).match(/\b\d{4}[/-]\d{2}[/-]\d{2}\b/);
    return m ? m[0].replace(/\//g, '-') : null;
  };

  const allRawDates = (String(rawText).match(/\b\d{4}[/-]\d{2}[/-]\d{2}\b/g) || []).map(d => d.replace(/\//g, '-'));
  let cleanFrom = cleanDate(periodFrom) || (allRawDates.length >= 2 ? allRawDates[0] : null);
  let cleanTo = cleanDate(periodTo) || (allRawDates.length >= 2 ? allRawDates[1] : null);
  let deadline = cleanDate(dueDate);
  if (!deadline) {
    if (allRawDates.length >= 3) {
      deadline = allRawDates[2];
    } else if (allRawDates.length > 0) {
      deadline = allRawDates[allRawDates.length - 1];
    }
  }

  // If formTitle is still missing, attempt regex from rawText
  if (!formTitle && rawText.length > 0) {
    const firstMatch = rawText.match(/^[^\d]+/);
    if (firstMatch) formTitle = firstMatch[0].trim();
  }

  if (!formTitle && !deadline && rawText.length === 0) return null;

  // Determine tax type and labels
  const checkText = `${formTitle} ${revenueType} ${rawText}`;
  let taxKey = 'PORTAL_FILING';
  let taxLabel = revenueType || 'التزامات التقديم في البوابة';

  if (checkText.includes('مضافة') || checkText.includes('مضافه') || checkText.includes('ق.م')) {
    taxKey = 'VAT';
    taxLabel = revenueType || 'ضريبة القيمة المضافة';
  } else if (checkText.includes('مرتبات') || checkText.includes('كسب العمل') || checkText.includes('كسب عمل')) {
    taxKey = 'PAYROLL_STAMP';
    taxLabel = revenueType || 'ضريبة المرتبات';
  } else if (checkText.includes('الخصم') || checkText.includes('خصم') || checkText.includes('من المنبع')) {
    taxKey = 'WITHHOLDING';
    taxLabel = revenueType || 'الخصم والتحصيل';
  } else if (checkText.includes('دخل')) {
    taxKey = 'CIT';
    taxLabel = revenueType || 'ضريبة الدخل';
  }

  // Period key resolution
  let periodKey = period;
  if (!periodKey && cleanFrom && cleanTo) {
    periodKey = `${cleanFrom} إلى ${cleanTo}`;
  } else if (!periodKey && deadline) {
    periodKey = deadline.slice(0, 7);
  } else if (!periodKey) {
    periodKey = 'عام';
  }

  const formLabel = formTitle || taxLabel || 'التزام في البوابة';

  // Completion / submission detection
  const isReceived = Boolean(receivedDate && receivedDate.length > 0 && !receivedDate.includes('لم'));
  const isUnsubmittedExplicit = checkText.includes('غير مقدم') ||
                                checkText.includes('لم يقدم') ||
                                checkText.includes('لم يتم التقديم') ||
                                checkText.includes('لم يُقدّم') ||
                                checkText.includes('غير مسدد');

  const isDone = isReceived || (!isUnsubmittedExplicit && (
    checkText.includes('تم التقديم') ||
    checkText.includes('تم الإرسال') ||
    checkText.includes('تم الارسال') ||
    checkText.includes('تم الاستلام') ||
    checkText.includes('مقدم') ||
    checkText.includes('مسدد') ||
    checkText.includes('مكتمل') ||
    checkText.includes('معتمد')
  ));

  // Whether this row is a return you must file or a document that is simply
  // valid until a date. Checked before the status is computed, because the two
  // use different vocabularies.
  const kind = classifyObligationKind(checkText);
  const isCertificate = kind === 'certificate';

  const evaluated = evaluateObligationStatus(deadline, isDone, asOf, kind);

  // Build stable, unique obligation ID preventing collisions between distinct rows
  const sanitizedPeriod = periodKey.replace(/[\s\/\\]+/g, '_');
  const sanitizedDate = (deadline || 'nodate').replace(/[-]/g, '');
  const sanitizedForm = formLabel.slice(0, 20).replace(/[\s\/\\]+/g, '_');
  const id = `${companyKey}::${taxKey}::${sanitizedPeriod}::${sanitizedDate}::${sanitizedForm}`;

  // A certificate is renewed, not filed: the action text and the required
  // submission flag must not imply a penalty exposure.
  const requiredAction = isCertificate
    ? `مراجعة سريان ${formLabel} وتجديده قبل ${deadline || 'الموعد المحدد'}.`
    : `تقديم ${formLabel} وسداد المستحق قبل ${deadline || 'الموعد المحدد'}.`;

  return {
    id,
    companyKey,
    company: companyName,
    taxType: taxKey,
    taxLabel,
    formLabel,
    periodKey,
    periodFrom: cleanFrom,
    periodTo: cleanTo,
    kind,
    deadline,
    deadlineBasis: 'portal_live_screen',
    deadlineMeaning: isCertificate ? 'validity_end' : 'filing_deadline',
    requiredAction,
    submitted: isCertificate ? false : isDone,
    submittedAt: (!isCertificate && isDone) ? new Date().toISOString() : null,
    status: evaluated.status,
    daysLeft: evaluated.daysLeft
  };
}

module.exports = {
  TAX_TYPES,
  DEFAULT_SEED_TAX_TYPES,
  OBLIGATION_STATUSES,
  OBLIGATION_KINDS,
  STATUS_STYLES,
  FILING_STATUS_VALUES,
  CERTIFICATE_STATUS_VALUES,
  DUE_SOON_DAYS,
  CERTIFICATE_EXPIRING_DAYS,
  CERTIFICATE_MARKERS,
  MAX_GENERATED_OBLIGATIONS,
  utcDate,
  toDateKey,
  lastDayOfMonth,
  parsePeriodKey,
  computeVatDeadline,
  computeQuarterlyDeadline,
  computeAnnualCitDeadline,
  resolveDeadline,
  buildObligationId,
  evaluateObligationStatus,
  currentPeriodKey,
  buildStatutoryObligations,
  summarizeObligations,
  classifyObligationKind,
  parsePortalObligationRow
};