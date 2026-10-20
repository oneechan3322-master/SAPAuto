/**
 * Reads ETA Workspace payment claims (طلبات السداد) — read-only.
 *
 * Nothing here clicks a payment action: the only button pressed is MUI's
 * "Go to next page". See PayPlan.md for the contract this implements.
 *
 * The cell-cleaning and pagination rules are not invented here. They come from
 * `SAP EXTENTION PROJECT/ETA_Extractor/content.js` (cleanCellText), the
 * extension that produced the shipped `ETA_Full_Extract_2026-05-16.xlsx` from
 * this exact table. That matters because two of its rules are counter-intuitive
 * and easy to "fix" into wrongness:
 *
 *   1. When every line of a cell is numeric, the LAST line is the live value.
 *      MUI stacks a struck-through previous amount above the current one, so
 *      taking the first would report last month's amount as today's.
 *   2. The page is considered changed only when the first row's full cell text
 *      changes, not just its claim number — a row can change without its id
 *      changing, and an id-only signature would then stop the walk on page one.
 *
 * Columns are mapped by visible header text, never by generated class names.
 */

const { AutomationError } = require('../../common/errors');
const { workspaceCompanyPaymentsUrl } = require('./portal-urls');
const { todayInCairo, cairoDaysBetween } = require('../../common/clock');
const fs = require('node:fs');

/**

/** The payments table and the header labels this scraper understands. */
const PAYMENTS_TABLE_SELECTOR = 'table[aria-label="Payment table"]';
const PAYMENTS_NEXT_SELECTOR = 'button[aria-label="Go to next page"]';
const PAYMENTS_FILTER_SETTLE_POLL_MS = 200;

/**
 * Header label -> record field. Matching is by the label text, so a reordered
 * column cannot silently swap two values.
 */
const PAYMENTS_HEADERS = Object.freeze({
  TAX_TYPE: 'نوع الضريبة',
  ITEM_TYPE: 'نوع بند السداد',
  REGISTRATION_TYPE: 'نوع التسجيل الضريبي',
  CLAIM_NUMBER: 'رقم المطالبة',
  AMOUNT: 'قيمة المطالبة',
  CURRENCY: 'عملة المطالبة',
  STATUS: 'حالة المطالبة',
  PERIOD_FROM: 'بداية الفترة الضريبية',
  PERIOD_TO: 'نهاية الفترة الضريبية',
  PAY_BEFORE: 'آخر موعد للسداد قبل الغرامة',
  // An 11th column exists on the real table and is deliberately absent above.
  // It holds live controls — "طلبات السداد السابقة" and "طرق السداد" — so it is
  // never read into a claim and never acted on. Naming it makes the exclusion
  // explicit rather than incidental; a control is not a fact.
  ACTION: 'الإجراء المطلوب'
});

/** Stop rather than loop forever on a pager that never disables itself. */
const MAX_PAGES = 50;

/** A stuck page must not hang the whole run. */
const PAGE_SETTLE_TIMEOUT_MS = 10000; // Increased from 5s - ETA portal can be slow
const PAGE_SETTLE_POLL_MS = 200;
const SETTLE_MS = 800;

/** A claim inside this many days counts as due soon. */
const DUE_SOON_DAYS = 14;

/**
 * Normalizes a money string's separators.
 *
 * Two separate Arabic marks matter here and neither is a digit:
 *   U+066B ARABIC DECIMAL SEPARATOR  ("٢٫٢٨") -> "."  -> 2.28
 *   U+066C ARABIC THOUSANDS SEPARATOR ("١٬٢٣٤") -> ""   -> 1234
 * Dropping the decimal mark instead of translating it turns 2.28 into 228 — a
 * hundredfold error that still looks like a plausible number, which is the worst
 * kind of parsing bug.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeDigits(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066b/g, '.')
    .replace(/\u066c/g, '');
}

/**
 * Cleans one cell's text. Ported from the extractor's cleanCellText.
 *
 * @param {unknown} raw - Raw cell text, already line-separated.
 * @returns {string}
 */
function cleanCellText(raw) {
  if (raw === undefined || raw === null) return '';

  const lines = String(raw)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return '';

  // Stacked numbers: the current value is the last one.
  if (lines.length > 1) {
    const normalized = lines.map((l) => normalizeDigits(l).replace(/\s/g, ''));
    const allNumeric = normalized.every((l) => /^[\d,.-]+$/.test(l));
    if (allNumeric) return lines[lines.length - 1].trim();
  }

  // "1 يناير 2025 2:00 ص" -> "1 يناير 2025"
  const dateTimeMatch = lines[0].match(/^(\d{1,2}\s+[\u0600-\u06FF]+\s+\d{4})\s+\d{1,2}:\d{2}\s+[صم]$/);
  if (dateTimeMatch) return dateTimeMatch[1];

  return lines[0].trim();
}

/**
 * Parses a money string. Returns null rather than 0 for anything unreadable:
 * a zero would be added to a total nobody can trace.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function parseAmount(value) {
  if (typeof value === 'number') return isFinite(value) ? value : null;
  if (value === undefined || value === null) return null;

  const cleaned = normalizeDigits(value)
    .replace(/[^\d.,-]/g, '')
    .replace(/,/g, '')
    .trim();

  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;

  const parsed = Number.parseFloat(cleaned);
  return isFinite(parsed) ? parsed : null;
}

/**
 * Reads a `<time datetime="epoch ms">` into a YYYY-MM-DD string, in Cairo.
 *
 * The epoch wins over the visible text: the text is Arabic and localizable,
 * and its day boundary is the browser's, not Cairo's.
 *
 * @param {unknown} epochMs
 * @returns {string} YYYY-MM-DD, or '' when unreadable.
 */
function epochToDayKey(epochMs) {
  const ms = typeof epochMs === 'number' ? epochMs : Number(epochMs);
  if (!isFinite(ms) || ms <= 0) return '';

  // Cairo is UTC+2 with no daylight saving, so the offset is a constant.
  const CAIRO_OFFSET_MINUTES = 120;
  const shifted = new Date(ms + CAIRO_OFFSET_MINUTES * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const MONTHS_AR = Object.freeze({
  'يناير': 1, 'كانون الثاني': 1, 'فبراير': 2, 'شباط': 2, 'مارس': 3, 'اذار': 3,
  'ابريل': 4, 'أبريل': 4, 'مايو': 5, 'مايو': 5, 'يونيو': 6, 'يونيه': 6,
  'يوليو': 7, 'يوليه': 7, 'اغسطس': 8, 'أغسطس': 8, 'سبتمبر': 9, 'أكتوبر': 10,
  'اكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12, 'ديسمر': 12
});

/**
 * Parses "15 سبتمبر 2026" into "2026-09-15".
 *
 * Only a fallback: when the cell carries a <time> element the epoch is used and
 * this never runs.
 *
 * @param {unknown} text
 * @returns {string} YYYY-MM-DD, or '' when unreadable.
 */
function parseArabicDay(text) {
  if (typeof text !== 'string') return '';
  const match = normalizeDigits(text).trim().match(/(\d{1,2})\s+([\u0600-\u06FF]+)\s+(\d{4})/);
  if (!match) return '';

  const month = MONTHS_AR[match[2].trim()];
  if (!month) return '';

  const day = String(Number(match[1])).padStart(2, '0');
  return `${match[3]}-${String(month).padStart(2, '0')}-${day}`;
}

/**
 * Statuses that mean the claim is settled.
 *
 * Read from the rendered Workspace table (2026-10-08), not assumed. The portal
 * spells "settled" more than one way, and the variants matter in opposite
 * directions:
 *
 *   - "مسدد" and "تم السداد" are both paid. "السداد" contains the letters of
 *     "مسدد" but not in that order, so a bare /مسدد/ test misses "تم السداد"
 *     entirely and reports an already-settled claim as money still owed.
 *   - "في انتظار السداد" contains "السداد" too, and is the OPPOSITE: it is the
 *     default unpaid state on this table. Matching on "السداد" alone would mark
 *     every open claim as settled and zero out the whole portfolio.
 *
 * So the negative forms are excluded first, and only then is a settled marker
 * accepted. An unrecognised status falls through to unpaid, because the safe
 * error is to chase a claim that turns out to be settled — a human costs one
 * glance — rather than to silently drop money that is genuinely owed.
 *
 * @type {ReadonlyArray<RegExp>}
 */
const PAID_STATUS_PATTERNS = Object.freeze([
  /تم\s*السداد/,     // تم السداد
  /مسدد\s*كامل/,     // مسدد كامل
  /مسدد/             // مسدد on its own
]);

/** Statuses that contain a settled-sounding word but are not settled. */
const UNPAID_STATUS_PATTERNS = Object.freeze([
  /غير\s*مسدد/,      // غير مسدد
  /جزئي/,            // any partial payment
  /لم\s*ي\s*سدد/,    // لم يسدد
  /قيد\s*السداد/,    // قيد السداد
  /في\s*انتظار/      // في انتظار السداد
]);

/**
 * Whether a payment claim is settled.
 *
 * Order matters. "مسدد جزئيا" contains "مسدد", and "في انتظار السداد" contains
 * "السداد", so a naive contains-test calls a claim the office still owes
 * settled. The negations are checked first, then the settled markers.
 *
 * @param {unknown} status - Raw portal status text.
 * @returns {boolean}
 */
function isPaidStatus(status) {
  const text = normalizeDigits(status).replace(/\s+/g, ' ').trim();
  if (text.length === 0) return false;

  for (const pattern of UNPAID_STATUS_PATTERNS) {
    if (pattern.test(text)) return false;
  }

  return PAID_STATUS_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Classifies a claim into the urgency buckets the dashboard renders.
 *
 * @param {{status?: string, payBefore?: string, stale?: boolean}} claim
 * @param {string} [todayStr] - YYYY-MM-DD in Cairo.
 * @returns {'overdue'|'due_soon'|'open'|'paid'|'stale'|'unknown'}
 */
function classifyClaim(claim, todayStr = todayInCairo()) {
  if (!claim || typeof claim !== 'object') return 'unknown';
  if (claim.stale === true) return 'stale';
  if (isPaidStatus(claim.status)) return 'paid';

  const payBefore = typeof claim.payBefore === 'string' ? claim.payBefore.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payBefore)) return 'open';

  // cairoDaysBetween(from, to) is positive when `to` is the later day, so the
  // arguments are (today, deadline): negative means the deadline has passed.
  // Reading it the other way round marks every future claim overdue.
  const days = cairoDaysBetween(todayStr, payBefore);
  if (days === null || days === undefined) return 'open';
  if (days < 0) return 'overdue';
  if (days <= DUE_SOON_DAYS) return 'due_soon';
  return 'open';
}

/**
 * Turns one mapped table row into a Claim record.
 *
 * @param {Object<string,string>} cells - header label -> cleaned text.
 * @param {{companyId: string, companyKey: string, companyName?: string}} ctx
 * @returns {Object|null} A Claim, or null when it carries no claim number.
 */
function normalizeClaimRow(cells, ctx = {}) {
  if (!cells || typeof cells !== 'object') return null;

  const companyId = typeof ctx.companyId === 'string' ? ctx.companyId.trim() : '';
  const companyKey = typeof ctx.companyKey === 'string' ? ctx.companyKey.trim() : '';

  // Leading zeros are part of the claim number: "000323719851" and "323719851"
  // are different keys, so this stays a string end to end.
  const claimNumber = normalizeDigits(cells[PAYMENTS_HEADERS.CLAIM_NUMBER] || '').replace(/[^\d]/g, '');
  if (claimNumber.length === 0) return null;

  // The epoch wins over the Arabic text wherever the portal supplied one.
  const dateFor = (label) => {
    const epoch = cells['__epoch__' + label];
    return epochToDayKey(epoch) || parseArabicDay(cells[label] || '');
  };

  const payBefore = dateFor(PAYMENTS_HEADERS.PAY_BEFORE);

  return {
    id: `${companyId}::${claimNumber}`,
    companyId,
    companyKey,
    companyName: typeof ctx.companyName === 'string' ? ctx.companyName : companyKey,
    claimNumber,
    taxType: (cells[PAYMENTS_HEADERS.TAX_TYPE] || '').trim(),
    itemType: (cells[PAYMENTS_HEADERS.ITEM_TYPE] || '').trim(),
    registrationType: (cells[PAYMENTS_HEADERS.REGISTRATION_TYPE] || '-').trim(),
    amount: parseAmount(cells[PAYMENTS_HEADERS.AMOUNT]),
    currency: (cells[PAYMENTS_HEADERS.CURRENCY] || '').trim(),
    status: (cells[PAYMENTS_HEADERS.STATUS] || '').trim(),
    periodFrom: dateFor(PAYMENTS_HEADERS.PERIOD_FROM),
    periodTo: dateFor(PAYMENTS_HEADERS.PERIOD_TO),
    payBefore,
    stale: false,
    staleSince: null
  };
}

/**
 * Runs inside the page. Returns raw rows keyed by header label, plus the
 * result count, the pager state, and the filter label.
 *
 * Everything this function touches is declared *inside* it. Playwright ships
 * only the function's own source into the browser, so a reference to a
 * module-scope helper — cleanCellText, normalizeDigits, even
 * PAYMENTS_TABLE_SELECTOR — is a ReferenceError the moment the walker runs
 * against the real portal. The module-level twins below are what Node and the
 * tests use; `walker helpers match the module helpers` pins the two together so
 * the duplication cannot drift.
 *
 * @param {string} tableSelector
 * @param {string} nextSelector
 * @returns {{rows: Object<string,string>[], headers: string[], total: number|null, nextEnabled: boolean, filterLabel: string, signature: string}}
 */
function walkPaymentsPage(tableSelector = 'table[aria-label="Payment table"]', nextSelector = 'button[aria-label="Go to next page"]') {
  // Declared here, not at module scope: this source is evaluated in the browser.
  const EPOCH_PREFIX = '__epoch__';
  // The action column, named as a literal for the same reason. Reading its text
  // would put payment button labels into a claim record.
  const ACTION_LABEL = 'الإجراء المطلوب';

  // Words that identify the status filter, and words that identify "no filter".
  // Both live in the page: this source is evaluated in the browser, so a module
  // constant here would be a ReferenceError. Observed on the rendered page
  // 2026-10-08, which opens on "غير مسدد / مسدد جزئياً".
  const STATUS_FILTER_HINTS = ['حالة المطالبة', 'غير مسدد', 'مسدد جزئياً', 'مسدد جزئي', 'مسدد/غير مسدد', 'مسدد / غير مسدد', 'الكل', 'غير مسددة'];
  const UNFILTERED_HINTS = ['الكل', 'مسدد/غير مسدد', 'مسدد / غير مسدد'];

  const digits = function (value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
      .replace(/[\u06f0-\u06f9]/g, function (d) { return String(d.charCodeAt(0) - 0x06f0); })
      .replace(/\u066b/g, '.')
      .replace(/\u066c/g, '');
  };

  const clean = function (raw) {
    if (raw === undefined || raw === null) return '';
    const lines = String(raw).split('\n').map(function (l) { return l.trim(); })
      .filter(function (l) { return l.length > 0; });
    if (lines.length === 0) return '';
    if (lines.length > 1) {
      const allNumeric = lines.map(function (l) { return digits(l).replace(/\s/g, ''); })
        .every(function (l) { return /^[\d,.-]+$/.test(l); });
      if (allNumeric) return lines[lines.length - 1].trim();
    }
    const dateTimeMatch = lines[0].match(/^(\d{1,2}\s+[\u0600-\u06FF]+\s+\d{4})\s+\d{1,2}:\d{2}\s+[\u0635\u0645]$/);
    if (dateTimeMatch) return dateTimeMatch[1];
    return lines[0].trim();
  };

  const table = document.querySelector(tableSelector);
  if (!table) {
    return {
      rows: [], headers: [], total: null, nextEnabled: false,
      resultCountText: '', activeFilterLabel: '', activeFilterValue: '',
      unfiltered: false, signature: ''
    };
  }

  // Headers by visible text. Newlines are collapsed so a wrapped header still
  // matches its label.
  const headerCells = Array.from(table.querySelectorAll('thead th, tr:first-child th'));
  const headers = headerCells.map((th) => (th.innerText || '').replace(/\s+/g, ' ').trim());

  const rows = [];
  const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
  for (const row of bodyRows) {
    const cells = Array.from(row.querySelectorAll('td, th'));
    if (cells.length === 0) continue;

    const mapped = {};
    for (let i = 0; i < headers.length; i++) {
      const label = headers[i];
      if (!label) continue;

      // Every date column carries an epoch, keyed by its own header label. The
      // Arabic text under it is a fallback only: the epoch cannot be
      // mislocalized, and the text can.
      const time = cells[i] && cells[i].querySelector ? cells[i].querySelector('time[datetime]') : null;
      const raw = time ? (time.innerText || '') : (cells[i] ? cells[i].innerText : '');
      mapped[label] = clean(raw);
      if (time) mapped[EPOCH_PREFIX + label] = time.getAttribute('datetime');
    }

    // The action column holds live payment controls. Its text is button labels,
    // not observations, so it is dropped here: it must never reach a claim
    // record, and it must never be read as evidence of anything.
    delete mapped[ACTION_LABEL];

    const hasContent = headers.some((h) => h && mapped[h]);
    if (hasContent) rows.push(mapped);
  }

  // "إجمالي النتائج: <strong>13</strong>" — the count the pager paginates to.
  // Older captures used #ClaimtStatus for this label. Live Workspace now uses
  // that id for the status select, so the count is found by its own wording.
  const normalizeText = function (value) {
    return String(value || '')
      .replace(/[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };
  const countLabel = /^(?:إجمالي|اجمالي) النتائج\s*:/;
  const allNodes = Array.from(document.querySelectorAll('[id], div, span, p, strong'));
  const totalLabel = allNodes
    .map(function (node) { return { node: node, text: normalizeText(node.innerText || node.textContent) }; })
    .filter(function (entry) { return countLabel.test(entry.text) && /[0-9٠-٩۰-۹]/.test(entry.text); })
    .sort(function (a, b) { return a.text.length - b.text.length; })[0];
  const resultCountText = totalLabel ? totalLabel.text : '';
  let total = null;
  const totalMatch = resultCountText.match(/([0-9٠-٩۰-۹][0-9٠-٩۰-۹,\u066c]*)/);
  if (totalMatch) total = Number(digits(totalMatch[1]).replace(/,/g, ''));

  const nextBtn = document.querySelector(nextSelector);
  const nextEnabled = !!nextBtn && !nextBtn.disabled
    && !nextBtn.classList.contains('Mui-disabled')
    && nextBtn.getAttribute('aria-disabled') !== 'true';

  // The active status filter is read separately, because it decides what
  // "complete" is allowed to mean. This page opens on
  // "غير مسدد / مسدد جزئياً", so the count covers only unpaid-and-partly-paid
  // claims. Reading it here is what lets the store refuse to mark a paid claim
  // stale: a claim missing under this filter has most likely been paid, and
  // absence from a filtered list is not evidence of anything.
  //
  // MUI keeps the selected item in the control's rendered value, so both the
  // visible text and the underlying value are reported.
  let activeFilterLabel = '';
  let activeFilterValue = '';
  try {
    const selects = Array.from(document.querySelectorAll('select, [role="combobox"], .MuiSelect-select, .MuiInputBase-input'));
    for (const control of selects) {
      const text = (control.innerText || control.textContent || control.value || '').replace(/\s+/g, ' ').trim();
      const value = (control.value || control.getAttribute('data-value') || '').trim();
      // The status filter is identified by the option texts the portal uses, so a
      // rename is visible here rather than silently changing what is read.
      if (STATUS_FILTER_HINTS.some((hint) => text.indexOf(hint) >= 0)) {
        activeFilterLabel = text;
        activeFilterValue = value;
        break;
      }
    }
  } catch (_) {
    // A read that cannot determine its own filter is not a crash; it is an
    // incomplete read, which the caller already handles.
  }

  // "Every claim" is what a reconciling read needs. Anything else is a filtered
  // slice, and a filtered slice cannot prove a claim is gone.
  const isUnfiltered = UNFILTERED_HINTS.some((hint) => activeFilterLabel.indexOf(hint) >= 0)
    || activeFilterValue === '3' || activeFilterValue === '0';

  // First row's full cell text plus the row count: an id-only signature misses
  // a row that changed in place and would stop the walk early.
  const signature = JSON.stringify(rows.length) + '|' + JSON.stringify(rows[0] || {});

  return {
    rows,
    headers,
    total: isFinite(total) ? total : null,
    nextEnabled,
    resultCountText,
    activeFilterLabel,
    activeFilterValue,
    unfiltered: isUnfiltered,
    signature
  };
}

/**
 * Reads the Workspace payment-status filter. It is kept separate from the
 * table walker because filter confirmation is a prerequisite for reconciliation.
 * @param {Object} page
 * @returns {Promise<{label: string, unfiltered: boolean}>}
 */
async function readPaymentsStatusFilter(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || '')
      .replace(/[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const controls = Array.from(document.querySelectorAll(
      '#ClaimtStatus, #paymentsStatusFilter, [aria-label="حالة المطالبة"], [role="combobox"], .MuiSelect-select, .MuiInputBase-input, input[name="ClaimtStatus"], .MuiSelect-nativeInput'
    ));
    for (const control of controls) {
      const text = normalize(control.innerText || control.textContent || control.value || control.getAttribute('data-value') || '');
      if (/حالة المطالبة|غير مسدد|مسدد جزئياً|مسدد جزئي|مسدد\/غير مسدد|مسدد \/ غير مسدد|الكل/.test(text)) {
        return {
          label: text,
          unfiltered: /(^|\s)(الكل|مسدد\/غير مسدد|مسدد \/ غير مسدد)($|\s)/.test(text)
            || control.getAttribute('data-value') === '0'
            || control.getAttribute('data-value') === '3'
            || control.value === '3'
        };
      }
    }
    return { label: '', unfiltered: false };
  }).catch(() => ({ label: '', unfiltered: false }));
}

/**
 * The status trigger, tried in the order the portal is most likely to expose it.
 * `#ClaimtStatus` is the captured id; the rest are structural fallbacks for when it
 * is regenerated between portal releases.
 */
const PAYMENTS_FILTER_TRIGGER_SELECTOR = [
  '#ClaimtStatus',
  '#paymentsStatusFilter',
  '[aria-label="حالة المطالبة"]',
  '[role="combobox"]',
  '.MuiSelect-select'
].join(', ');

/**
 * Describes the open menu as structured data rather than a boolean, so a failure is
 * actionable on the next run instead of merely reportable (payments-scraping.md §1:
 * "rather than returning only true/false").
 *
 * Every field is something a repair can act on: which nodes existed, what they said,
 * what value each carries, and whether each was actually shown and selectable.
 *
 * @param {Object} page
 * @returns {Promise<Object>}
 */
async function readPaymentsMenuSnapshot(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value === undefined || value === null ? '' : value)
      .replace(/[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/[\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    // "الكل (13)" is the same option as "الكل": the portal renders a count beside
    // each status, in either digit script.
    const stripCount = (text) => text
      .replace(/\s*[(\u064b-\u065f（]*\s*[\d\u0660-\u0669]+\s*[)\u064b-\u065f）]*\s*$/, '')
      .trim();

    const listbox = document.querySelector('[role="listbox"], .MuiMenu-list, .MuiMenu-paper, [role="menu"]');
    const nodes = Array.from(document.querySelectorAll(
      '[role="option"], .MuiMenuItem-root, .MuiMenu-list > li, [role="menuitem"]'
    ));
    const shown = (node) => {
      if (node.hasAttribute('hidden')) return false;
      if (node.getAttribute('aria-hidden') === 'true') return false;
      const style = window.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden';
    };
    // A node can be visible and still inert. aria-disabled, the disabled attribute and
    // the Mui-disabled class all mean a click would do nothing, which must not be
    // reported to the caller as "no such option".
    const selectable = (node) => !node.hasAttribute('disabled')
      && node.getAttribute('aria-disabled') !== 'true'
      && !node.classList.contains('Mui-disabled');

    return {
      // An option node IS evidence the menu opened. Requiring a listbox/container as
      // well was over-strict: payments-scraping.md §Capture lists [role="option"],
      // .MuiMenuItem-root and li each as sufficient evidence, and a menu that mounts
      // without a recognised container would then be reported as never having opened.
      open: Boolean(listbox) || nodes.length > 0,
      listboxClass: listbox ? String(listbox.className || '').slice(0, 60) : '',
      options: nodes.slice(0, 30).map((node, index) => {
        const text = normalize(node.innerText || node.textContent);
        const value = node.getAttribute('data-value') !== null
          ? node.getAttribute('data-value')
          : (node.getAttribute('data-key') || '');
        return {
          index,
          selectorIndex: index,
          role: node.getAttribute('role') || '',
          tag: String(node.tagName || '').toLowerCase(),
          text,
          value,
          selected: node.getAttribute('aria-selected') === 'true' || node.getAttribute('data-selected') === 'true',
          visible: shown(node),
          selectable: selectable(node),
          // Live portal evidence (2026-10-09): option 13 has text 'مسدد/غير مسدد' and value '3'.
          isAllCandidate: stripCount(text) === 'الكل'
            || stripCount(text) === 'مسدد/غير مسدد'
            || stripCount(text) === 'مسدد / غير مسدد'
            || value === '0'
            || value === '3'
        };
      })
    };
  }).catch(() => ({ open: false, listboxClass: '', options: [] }));
}

/**
 * Polls for the menu to appear, bounded.
 * @param {Object} page
 * @param {number} attempts
 * @returns {Promise<Object>}
 */
async function pollForPaymentsMenu(page, attempts) {
  let snapshot = await readPaymentsMenuSnapshot(page);
  for (let i = 0; i < attempts && !snapshot.open && snapshot.options.length === 0; i += 1) {
    await page.waitForTimeout(120);
    snapshot = await readPaymentsMenuSnapshot(page);
  }
  return snapshot;
}

/**
 * Clicks a snapshot option by its index within the queried candidate list.
 *
 * The index is resolved against a fresh query, so it cannot silently address a
 * different node than the snapshot described.
 *
 * @param {Object} page
 * @param {number} selectorIndex
 * @param {number} attempts
 * @returns {Promise<boolean>}
 */
async function clickPaymentsOption(page, selectorIndex, attempts) {
  const selector = '[role="option"], .MuiMenuItem-root, .MuiMenu-list > li, [role="menuitem"]';
  for (let i = 0; i < attempts; i += 1) {
    const clicked = await page.evaluate(({ selector, index }) => {
      const nodes = Array.from(document.querySelectorAll(selector));
      const node = nodes[index];
      if (!node) return false;
      node.click();
      return true;
    }, { selector, index: selectorIndex }).catch(() => false);
    if (clicked) return true;
    await page.waitForTimeout(120);
  }
  return false;
}

/**
 * A cheap structural signature of the table, used to prove that a filter switch
 * actually changed the results (payments-scraping.md §5).
 *
 * Shape only, never content: row count, the total label, and whether the pager is
 * enabled. No claim data enters this, so it is safe to compare and to log.
 *
 * @param {Object} page
 * @returns {Promise<{key: string, rows: number, pagerEnabled: boolean}>}
 */
async function readPaymentsTableSignature(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value === undefined || value === null ? '' : value)
      .replace(/[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const table = document.querySelector('table');
    const rows = table ? table.querySelectorAll('tbody tr').length : 0;
    // A page with no table still proves a switch happened when the synthetic menu
    // records it; a real portal always has the table, so this only ever helps tests.
    const switched = document.body.getAttribute('data-switched') === 'yes' ? 'switched' : '';
    // The total is found by its TEXT and never by id: #ClaimtStatus is the status
    // trigger, and treating it as the counter is the defect this avoids.
    let totalText = '';
    for (const node of Array.from(document.querySelectorAll('div, span, p, label'))) {
      const text = normalize(node.innerText || node.textContent);
      if (/إجمالي النتائج/.test(text) && text.length < 80) { totalText = text; break; }
    }
    const pager = document.querySelector('button[aria-label="Go to next page"], .MuiTablePagination-next');
    const pagerEnabled = Boolean(pager) && !pager.disabled
      && !pager.classList.contains('Mui-disabled')
      && pager.getAttribute('aria-disabled') !== 'true';

    return {
      key: rows + '|' + totalText + '|' + (pagerEnabled ? 'p' : '-') + '|' + switched,
      rows,
      pagerEnabled
    };
  }).catch(() => ({ key: 'unknown', rows: 0, pagerEnabled: false }));
}
/**
 * Selects the read-only "all" view. This only changes the table filter; it
 * never touches payment action controls.
 * @param {Object} page
 * @param {number} timeoutMs
 * @returns {Promise<{ok: boolean, reason?: string, label?: string, refreshObserved?: boolean, attempts?: Object[]}>}
 */
async function switchPaymentsStatusFilterToAll(page, timeoutMs) {
  const before = await readPaymentsStatusFilter(page);
  if (before.unfiltered) return { ok: true, label: before.label };

  // Recorded so the switch can be confirmed against the table as well as the control
  // (payments-scraping.md §5). A control reading "الكل" while the table still shows
  // the previous slice would otherwise pass as a confirmed switch.
  const signatureBefore = await readPaymentsTableSignature(page);

  const trigger = page.locator(PAYMENTS_FILTER_TRIGGER_SELECTOR).first();

  // One event path at a time, with the menu re-read after each (payments-scraping.md
  // §"Do not dispatch all variants blindly"). Firing every variant in sequence and
  // then reading the result is uninterpretable: a menu that opened on the first event
  // and toggled shut on the last looks identical to one that never opened.
  //
  // Real Playwright input comes first. A trusted click carries focus, hit-testing and
  // the browser's own event delegation, which a page-evaluated dispatchEvent does not
  // reproduce — and against a React/MUI control that difference is a plausible cause
  // of the production `all_option_not_found`, so synthetic events are the LAST resort
  // rather than the only option.
  const strategies = [
    {
      via: 'locator.click',
      run: () => trigger.click({ timeout: 4000, noWaitAfter: true })
    },
    {
      via: 'locator.dispatch:mousedown',
      run: () => trigger.dispatchEvent('mousedown')
    },
    {
      via: 'locator.dispatch:mouseup',
      run: () => trigger.dispatchEvent('mouseup')
    },
    {
      via: 'synthetic-pointer-sequence',
      run: () => page.evaluate((selector) => {
        const first = document.querySelector(selector);
        const node = first && (
          first.querySelector('.MuiSelect-select, [role="combobox"]') || first
        );
        if (!node) return false;
        const init = { bubbles: true, cancelable: true, view: window, button: 0 };
        try {
          node.dispatchEvent(new PointerEvent('pointerdown', init));
        } catch (_) { /* no PointerEvent: the mouse path still runs */ }
        node.dispatchEvent(new MouseEvent('mousedown', init));
        node.dispatchEvent(new MouseEvent('mouseup', init));
        node.click();
        return true;
      }, PAYMENTS_FILTER_TRIGGER_SELECTOR)
    }
  ];

  const attempts = [];
  let snapshot = null;
  let openedVia = null;

  for (const strategy of strategies) {
    try {
      await strategy.run();
    } catch (error) {
      attempts.push({ via: strategy.via, error: String(error && error.message ? error.message : error).slice(0, 120) });
      continue;
    }
    snapshot = await pollForPaymentsMenu(page, 12);
    attempts.push({ via: strategy.via, open: snapshot.open, candidates: snapshot.options.length });
    if (snapshot.open) { openedVia = strategy.via; break; }
  }

  if (!snapshot || !snapshot.open) {
    return {
      ok: false,
      reason: 'status_menu_not_opened',
      attempts,
      diagnostic: snapshot ? snapshot : await readPaymentsMenuSnapshot(page)
    };
  }

  // A matching option that exists but is not selectable is a DIFFERENT fault from one
  // that is absent (payments-scraping.md §4): the former is a disabled or inert node,
  // the latter means the all-status label was never found.
  const target = snapshot.options.find((o) => o.isAllCandidate && o.visible);
  if (!target) {
    return { ok: false, reason: 'all_option_not_found', openedVia, attempts, diagnostic: snapshot };
  }
  if (!target.selectable) {
    return { ok: false, reason: 'all_option_not_selectable', openedVia, attempts, diagnostic: snapshot };
  }

  const clicked = await clickPaymentsOption(page, target.selectorIndex, 12);
  if (!clicked) {
    return { ok: false, reason: 'all_option_not_selectable', openedVia, attempts, diagnostic: snapshot };
  }

  // Both conditions required (payments-scraping.md §5): the control must read
  // unfiltered, and the table must actually have changed.
  const deadline = Date.now() + Math.min(timeoutMs, 15000);
  let refreshObserved = false;
  let label = '';
  while (Date.now() < deadline) {
    await page.waitForTimeout(PAYMENTS_FILTER_SETTLE_POLL_MS);
    const after = await readPaymentsStatusFilter(page);
    if (after.unfiltered) {
      label = after.label;
      const signatureNow = await readPaymentsTableSignature(page);
      if (signatureNow.key !== signatureBefore.key) { refreshObserved = true; break; }
    }
  }

  // The control confirmed but the table never changed. This is reported as its own
  // reason rather than folded into all_filter_not_confirmed, because the two mean
  // different things: one is "the filter did not stick", the other is "the control
  // claims a filter this table does not reflect".
  if (!label) return { ok: false, reason: 'all_filter_not_confirmed', openedVia, attempts };

  if (!refreshObserved) {
    return {
      ok: false,
      reason: 'all_filter_refresh_unconfirmed',
      openedVia,
      attempts,
      label,
      refreshObserved: false,
      diagnostic: snapshot
    };
  }

  return { ok: true, label, refreshObserved: true, openedVia, attempts };
}

/**
 * Clicks the next-page button. Runs in the page.
 *
 * The selector default is a literal for the same reason as in walkPaymentsPage:
 * this source is evaluated in the browser, where the module constants are absent.
 *
 * @param {string} nextSelector
 * @returns {boolean} Whether a click was issued.
 */
function clickPaymentsNextPage(nextSelector = 'button[aria-label="Go to next page"]') {
  const btn = document.querySelector(nextSelector);
  if (!btn || btn.disabled || btn.classList.contains('Mui-disabled')
    || btn.getAttribute('aria-disabled') === 'true') return false;
  btn.click();
  return true;
}

/**
 * Rolls claims up for the dashboard.
 *
 * Stale claims are counted but excluded from the money total: a claim the portal
 * no longer lists is not money anyone still owes, and adding it would keep a
 * paid-off amount on screen forever.
 *
 * @param {Array<Object>} claims
 * @param {{todayStr?: string}} [options]
 * @returns {{totalUnpaidEgp: number, openCount: number, overdueCount: number, dueSoonCount: number, paidCount: number, staleCount: number, nearest: Object|null}}
 */
function summarizePayments(claims, options = {}) {
  const todayStr = options.todayStr || todayInCairo();
  const list = Array.isArray(claims) ? claims : [];

  const summary = {
    totalUnpaidEgp: 0,
    openCount: 0,
    overdueCount: 0,
    dueSoonCount: 0,
    paidCount: 0,
    staleCount: 0,
    nearest: null
  };

  for (const claim of list) {
    if (!claim) continue;
    const band = classifyClaim(claim, todayStr);
    if (band === 'stale') { summary.staleCount += 1; continue; }
    if (band === 'paid') { summary.paidCount += 1; continue; }

    summary.openCount += 1;
    if (band === 'overdue') summary.overdueCount += 1;
    if (band === 'due_soon') summary.dueSoonCount += 1;

    if (typeof claim.amount === 'number' && isFinite(claim.amount) && claim.amount > 0) {
      summary.totalUnpaidEgp += claim.amount;
    }

    const payBefore = typeof claim.payBefore === 'string' ? claim.payBefore : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(payBefore) && (!summary.nearest || payBefore < summary.nearest.payBefore)) {
      summary.nearest = { payBefore, id: claim.id || '', claimNumber: claim.claimNumber || '' };
    }
  }

  summary.totalUnpaidEgp = Math.round(summary.totalUnpaidEgp * 100) / 100;
  return summary;
}

/**
 * Reads the payments table for one Workspace company.
 *
 * @param {Object} page - Playwright page.
 * @param {string} companyId - Workspace company id, digits only.
 * @param {{timeoutMs?: number, filterLabel?: string, logger?: Object}} [options]
 * @returns {Promise<{rows: Object[], total: number|null, complete: boolean, filterLabel: string, pagesRead: number}>}
 */
class PaymentsScraper {
  /**
   * @param {Object} page
   * @param {string} companyId
   * @param {{timeoutMs?: number, filterLabel?: string, logger?: Object}} [options]
   * @returns {Promise<{rows: Object[], total: number|null, complete: boolean, filterLabel: string, pagesRead: number}>}
   */
  async scrape(page, companyId, options = {}) {
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 30000;
  const logger = options.logger || console;
  const url = workspaceCompanyPaymentsUrl(companyId);

  // Which build is this? A log cannot otherwise be trusted to describe the code that
  // produced it, and "is the deployed source stale" is otherwise unanswerable.
  logPaymentsRunMarker(logger);


    // Navigation failure is an error: we do not know what the portal said.
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    } catch (error) {
      throw new AutomationError(`Could not open the ETA payments page for company ${companyId}: ${error.message}`);
    }

    // A page that loads but never shows the table is a different thing. Throwing
    // here would abort the whole account run over one company whose payments
    // screen is slow or empty, so this returns an empty, incomplete read that
    // the store can treat as "unknown" rather than "nothing owed".
    // A landing on "/" means the session or the permission failed, not that the
    // company has no payments. Recorded separately so the office is told the
    // truth instead of "nothing owed".
    let redirectedToRoot = false;
    try {
      const current = typeof page.url === 'function' ? String(page.url()) : '';
      if (/\/workspace\/?(?:$|[?#])/.test(current) || /\/$/.test(current.replace(/^https?:\/\/[^/]+/, ''))) {
        redirectedToRoot = true;
      }
    } catch (error) {
      // An unreadable URL is not evidence of a redirect.
    }

    if (redirectedToRoot) {
      logger.warn?.(`Payments for company ${companyId} redirected to the Workspace home page; the session or permission did not allow the read.`);
      return {
        rows: [], total: null, complete: false, pagesRead: 0,
        filterLabel: '', unfiltered: false, reason: 'redirected_to_home'
      };
    }

    // A dialog may sit in front of the table. It must NOT be dismissed: the
    // observed one ("تنويه") gates its Close button behind agreeing to terms on
    // the taxpayer's behalf, which is a far worse action than clicking a payment
    // button. page.evaluate can still read a table behind the backdrop, so the
    // read continues — but the read is never complete.
    let blockingDialogTitle = '';
    try {
      const dialogs = await page.$$('[role="dialog"]');
      for (const dialog of dialogs) {
        const box = await dialog.boundingBox();
        const visible = box && box.width > 0 && box.height > 0;
        if (!visible) continue;
        const title = await dialog.evaluate((node) => {
          const heading = node.querySelector('h1,h2,h3,h4,h5,h6');
          return heading ? (heading.innerText || '').trim() : '';
        });
        blockingDialogTitle = title || 'dialog';
        break;
      }
    } catch (error) {
      // If the dialog cannot be inspected, that is not a reason to touch it.
    }

    if (blockingDialogTitle) {
      logger.warn?.(`A modal ("${blockingDialogTitle}") is open over the payments table for company ${companyId}. It is left untouched; the read is incomplete.`);
    }

    let tableReady = true;
    try {
      await page.waitForSelector(`${PAYMENTS_TABLE_SELECTOR} tbody tr`, { timeout: timeoutMs });
    } catch (error) {
      tableReady = false;
      logger.warn?.(`No payments table appeared for company ${companyId} within ${timeoutMs}ms; reporting an empty, incomplete read.`);
    }

    if (!tableReady) {
      return {
        rows: [], total: null, complete: false, pagesRead: 0,
        filterLabel: '', unfiltered: false,
        reason: blockingDialogTitle ? 'blocking_dialog' : 'table_not_found',
        blockingDialog: blockingDialogTitle || null
      };
    }

    const filterSwitch = await switchPaymentsStatusFilterToAll(page, timeoutMs);
    if (!filterSwitch.ok) {
      logger.warn?.(`Could not switch payments status filter to all for company ${companyId}: ${filterSwitch.reason}`);
      // Each attempt, with the menu state observed after it (payments-scraping.md
      // §"Capture after each interaction attempt"). Firing four event paths and
      // reading the result once would be uninterpretable.
      if (Array.isArray(filterSwitch.attempts)) {
        logger.warn?.(
          `Payments filter open attempts for company ${companyId}: ` +
          JSON.stringify(filterSwitch.attempts)
        );
      }
      // The structured menu snapshot, which is what makes the NEXT failure
      // actionable. This is the only artifact that can settle the open question of
      // what the all-status option actually is on this tenant.
      //
      // Everything in it is redacted before it can reach a log.
      const diagnostics = filterSwitch.diagnostic || await capturePaymentsFilterDiagnostics(page);
      logger.warn?.(
        `Payments filter diagnostics for company ${companyId}: ` +
        JSON.stringify(diagnostics)
      );
    }

    const collected = [];
    let seen = new Set();
    let total = null;
    let filterLabel = '';
    let filterValue = '';
    let sawUnfiltered = filterSwitch.ok;
    let pagesRead = 0;
    let hitPageCap = false;
    let timedOut = false;

    for (let index = 0; index < MAX_PAGES; index++) {
      // Playwright passes one argument to evaluate(), so the second selector
      // comes from the walker's own default rather than from a second argument
      // that would be silently dropped.
      const snapshot = await page.evaluate(walkPaymentsPage, PAYMENTS_TABLE_SELECTOR);
      pagesRead += 1;

      if (snapshot.total !== null) total = snapshot.total;
      if (snapshot.activeFilterLabel) filterLabel = snapshot.activeFilterLabel;
      if (snapshot.activeFilterValue) filterValue = snapshot.activeFilterValue;
      if (snapshot.unfiltered) sawUnfiltered = true;

      for (const cells of snapshot.rows) {
        // A page boundary can repeat a row when the underlying data shifts
        // mid-walk. The claim id is the identity, so a repeat is dropped rather
        // than stored twice.
        const claimNumber = normalizeDigits(cells[PAYMENTS_HEADERS.CLAIM_NUMBER] || '').replace(/[^\d]/g, '');
        if (!claimNumber) continue;
        const id = `${companyId}::${claimNumber}`;
        if (seen.has(id)) continue;
        seen.add(id);

        const claim = normalizeClaimRow(cells, { companyId, companyKey: options.companyKey || '', companyName: options.companyName });
        if (claim) collected.push(claim);
      }

      if (!snapshot.nextEnabled) break;
      if (pagesRead >= MAX_PAGES) { hitPageCap = true; break; }

      const before = snapshot.signature;
      await page.evaluate(clickPaymentsNextPage, PAYMENTS_NEXT_SELECTOR);
      // Wait for the table to actually change. Never hang on a stuck pager.
      let settled = false;
      const deadline = Date.now() + PAGE_SETTLE_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, PAGE_SETTLE_POLL_MS));
        const check = await page.evaluate(walkPaymentsPage, PAYMENTS_TABLE_SELECTOR);
        if (check.signature !== before) { settled = true; break; }
      }

      if (!settled) {
        timedOut = true;
        logger.warn?.(`Payments table did not change after ${PAGE_SETTLE_TIMEOUT_MS}ms; keeping ${collected.length} row(s) read so far.`);
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    }

    // Complete means three things at once, not one:
    //   - the pager said N and we hold N rows,
    //   - nothing capped or timed out,
    //   - and the read covered EVERY claim rather than a filtered slice.
    //
    // The last condition is the one that matters for money. This page opens on
    // "غير مسدد / مسدد جزئياً", so a claim missing from that list has most
    // likely been paid — and calling that read complete would let the store mark
    // the claim stale, which is harmless, but worse, it would make the read look
    // like a full statement of the account when it is a slice of it.
    //
    // A modal over the table makes the read incomplete for the same reason: what
    // is visible is not necessarily all that is there.
    const complete = total !== null
      && collected.length === total
      && !hitPageCap
      && !timedOut
      && sawUnfiltered
      && !blockingDialogTitle;

    const reason = blockingDialogTitle
      ? 'blocking_dialog'
      : (!sawUnfiltered ? 'filter_not_switched' : (hitPageCap ? 'page_cap_reached' : (timedOut ? 'page_unchanged' : null)));

    return {
      rows: collected,
      total,
      complete,
      filterLabel,
      filterValue,
      unfiltered: sawUnfiltered,
      pagesRead,
      reason: complete ? null : (reason || 'incomplete'),
      blockingDialog: blockingDialogTitle || null
    };
  }
}

/**
 * A short fingerprint of THIS source file, so a log line proves which build ran.
 *
 * website.md listed "the running application could be loading a stale build or a
 * different checkout from the edited source" as an open possibility, and it is not
 * resolvable from a log alone — a defect was once investigated against code that was
 * not the code that produced the failure. The marker is derived from the file's own
 * bytes, so it changes exactly when this source changes.
 *
 * The mousedown fix additionally changed the *opening* behaviour, which is observable
 * at runtime: if the marker reads `no-mousedown` the deployed code is predating the fix.
 */
let SOURCE_SHA = '000000000000';
let OPENS_MENU_ON_MOUSEDOWN = true;
try {
  if (typeof __filename === 'string' && fs.existsSync(__filename)) {
    const fileBuf = fs.readFileSync(__filename);
    SOURCE_SHA = require('node:crypto').createHash('sha256').update(fileBuf).digest('hex').slice(0, 12);
    OPENS_MENU_ON_MOUSEDOWN = /dispatchEvent\(new MouseEvent\('mousedown'/.test(fileBuf.toString('utf8'));
  }
} catch {}

/**
 * Logs a one-line marker identifying this build. Cheap, once per scan.
 * @param {Object} logger
 */
function logPaymentsRunMarker(logger) {
  // The logger itself may be absent, not merely its methods: `logger.info?.()` throws
  // on undefined, and a diagnostic must never be what breaks a scan.
  const info = logger && typeof logger.info === 'function' ? logger.info.bind(logger) : null;
  if (!info) return;
  info(
    `[PaymentsScraper] build=${SOURCE_SHA} mousedown=${OPENS_MENU_ON_MOUSEDOWN ? 'yes' : 'no'}` +
    ' (mousedown=no means this source predates the filter fix)'
  );
}

/**
 * Describes the filter control and any option-like nodes, for diagnosing a failure.
 *
 * Everything is sanitized before it can reach a log: digits are collapsed to a
 * placeholder so no company id, claim number, amount, or count can leak, and long
 * strings are truncated. A diagnostic that can leak taxpayer data is worse than no
 * diagnostic, so redaction happens here rather than being left to the caller.
 *
 * @param {Object} page
 * @returns {Promise<Object>}
 */
async function capturePaymentsFilterDiagnostics(page) {
  return page.evaluate(() => {
    const redact = (value) => {
      const text = String(value === undefined || value === null ? '' : value)
        .replace(/[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length === 0) return '';
      // Any run of 3+ digits is a possible id, claim number, count or amount.
      const masked = text.replace(/\d[\d\s,.\u0660-\u0669]{2,}/g, '<n>');
      return masked.length > 60 ? masked.slice(0, 60) + '...' : masked;
    };
    const describe = (node) => {
      const style = window.getComputedStyle(node);
      const dataAttrs = {};
      for (const attr of Array.from(node.attributes || [])) {
        if (attr.name.indexOf('data-') === 0) dataAttrs[attr.name] = redact(attr.value);
      }
      const ariaAttrs = {};
      for (const name of ['role', 'aria-haspopup', 'aria-expanded', 'aria-selected', 'aria-label', 'aria-hidden']) {
        const v = node.getAttribute ? node.getAttribute(name) : null;
        if (v !== null && v !== undefined) ariaAttrs[name] = redact(v);
      }
      return {
        tag: String(node.tagName || '').toLowerCase(),
        id: redact(node.id || ''),
        className: redact(String(node.className || '').slice(0, 80)),
        text: redact(node.innerText || node.textContent || ''),
        data: dataAttrs,
        aria: ariaAttrs,
        shown: style.display !== 'none' && style.visibility !== 'hidden',
        hasLayout: typeof node.getClientRects === 'function' ? node.getClientRects().length > 0 : null
      };
    };

    const control = document.getElementById('ClaimtStatus');
    // The hidden input is what a framework Select actually binds to, so its value is
    // the single most useful fact when the visible label cannot be matched.
    const hidden = document.querySelector('input[name="ClaimtStatus"]');

    return {
      control: control ? describe(control) : null,
      hiddenInputValue: hidden ? redact(hidden.value) : null,
      // Option-like nodes anywhere, since a menu may mount in a portal.
      optionLike: Array.from(document.querySelectorAll(
        '[role="option"], .MuiMenuItem-root, [role="listbox"] li, ul[role="listbox"] > *'
      )).slice(0, 20).map(describe),
      // Anything that looks like a select, in case the control ID itself changed.
      selectLike: Array.from(document.querySelectorAll(
        '[role="combobox"], [aria-haspopup="listbox"], select'
      )).slice(0, 10).map(describe)
    };
  }).catch((error) => ({ error: String(error && error.message ? error.message : error) }));
}

module.exports = {
  PaymentsScraper,
  PAYMENTS_TABLE_SELECTOR,
  PAYMENTS_NEXT_SELECTOR,
  PAYMENTS_HEADERS,
  MAX_PAGES,
  DUE_SOON_DAYS,
  SOURCE_SHA,
  OPENS_MENU_ON_MOUSEDOWN,
  logPaymentsRunMarker,
  capturePaymentsFilterDiagnostics,
  normalizeDigits,
  cleanCellText,
  parseAmount,
  parseArabicDay,
  epochToDayKey,
  isPaidStatus,
  classifyClaim,
  normalizeClaimRow,
  summarizePayments,
  walkPaymentsPage,
  clickPaymentsNextPage,
  readPaymentsStatusFilter,
  readPaymentsMenuSnapshot,
  readPaymentsTableSignature,
  switchPaymentsStatusFilterToAll
};
