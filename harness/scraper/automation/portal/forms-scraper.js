/**
 * Portal Forms Scraper.
 * Specialized scraper for ETA portal route `#/forms`.
 *
 * Scrapes tax forms across all filter states:
 * • مسودة (Draft)
 * • تم تقديمه (Submitted)
 * • تحت المراجعة (Under Review)
 * • مغلق نهائي (Permanently Closed / Finalized)
 * • قابل للتعديل (Editable)
 *
 * Adheres to:
 * - RULE 1: Never ignore return values
 * - RULE 2: Validate all inputs
 * - RULE 3: No silent failures
 * - RULE 6: Bounded operations
 * - RULE 7: Fail-safe defaults
 */

const { defaultLogger } = require('../../common/logger');
const { assertNonEmptyString } = require('../../common/assertions');
const { PORTAL_ROUTES, PORTAL_HASHES, FORMS_FILTERS } = require('./portal-urls');
const {
  FORMS_HEADER_MAP,
  FORMS_FIELD_ALIASES,
  readPortalRows,
  supportsUi5Helpers,
  navigateToHash,
  waitForTableStable,
  clickGrowingTrigger,
  normalizeArabic,
  resolveTableId
} = require('./ui5-helpers');

const MAX_FORM_ROWS = 100;

/**
 * Candidate UI5 control id suffixes for the forms table.
 *
 * As with obligations, these are inferred rather than captured. Discovery in
 * `_readRows` finds the real control when none of them matches.
 */
const TABLE_ID_SUFFIXES = ['--idFormsTable', '--idFormsList', '--idTable'];

/** Fields a genuine forms row must populate. */
const EXPECTED_FIELDS = ['formTitle'];

/** Cache key for the process-lifetime discovery cache. */
const TABLE_CACHE_KEY = 'formsTable';

/**
 * The filter control and its options.
 *
 * key is what `setSelectedKey` accepts; text is what the user sees. They are
 * stored separately because they are not interchangeable, and guessing one from
 * the other is how a filter silently lands on the wrong option.
 */
const FILTER_CONTROL = Object.freeze({
  idSuffix: 'formFilter',
  options: [
    { key: FORMS_FILTERS.DRAFT, text: 'مسودة' },
    { key: FORMS_FILTERS.SUBMITTED, text: 'تم تقديمه' },
    { key: FORMS_FILTERS.UNDER_REVIEW, text: 'تحت المراجعة' },
    { key: FORMS_FILTERS.FINALIZED, text: 'مغلق نهائي' },
    { key: FORMS_FILTERS.EDITABLE, text: 'قابل للتعديل' }
  ]
});

/**
 * Maps the portal's Arabic status wording to the pipeline's vocabulary.
 *
 * Checked in a fixed order, longest phrase first, so "تم تقديمه" is not
 * swallowed by a shorter pattern that happens to appear inside it.
 *
 * @param {string} text
 * @returns {'draft'|'submitted'|'under_review'|'finalized'|'editable'|'unknown'}
 */
function classifyFormStatus(text) {
  const normalized = normalizeArabic(text);
  if (normalized.length === 0) return 'unknown';

  // The portal ships English labels on some accounts, so the Latin forms are
  // matched case-insensitively rather than as written.
  const latin = normalized.toLowerCase();

  if (normalized.includes(normalizeArabic('تم تقديمه')) || normalized.includes(normalizeArabic('تم التقديم'))
    || latin.includes('submitted')) return 'submitted';
  if (normalized.includes(normalizeArabic('تحت المراجعة')) || normalized.includes(normalizeArabic('قيد المراجعة'))
    || latin.includes('under review') || latin.includes('review')) return 'under_review';
  if (normalized.includes(normalizeArabic('مغلق نهائي')) || latin.includes('finalized')) return 'finalized';
  if (normalized.includes(normalizeArabic('قابل للتعديل')) || latin.includes('editable')) return 'editable';
  if (normalized.includes(normalizeArabic('مسودة')) || latin.includes('draft')) return 'draft';

  return 'unknown';
}

class FormsScraper {
  /**
   * Scrapes tax forms from `#/forms`.
   *
   * @param {import('playwright').Page} page
   * @param {string} accountKey
   * @param {string} [companyName]
   * @param {Object} [options={}]
   * @param {string} [options.filter] - Optional filter key from FORMS_FILTERS
   * @param {number} [options.timeoutMs=15000]
   * @returns {Promise<Array<Object>>}
   */
  async scrape(page, accountKey, companyName = '', options = {}) {
    if (!page || typeof page.evaluate !== 'function') {
      defaultLogger.warn('FormsScraper.scrape called without valid Playwright page.');
      return [];
    }
    const safeKey = assertNonEmptyString(accountKey, 'accountKey', 'FormsScraper.scrape');
    const safeCompany = companyName || safeKey;
    const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : 15000;

    try {
      defaultLogger.info(`[FormsScraper] Scanning #/forms for ${safeCompany} (${safeKey})...`);

      await navigateToHash(page, PORTAL_HASHES.FORMS, 3000);

      if (supportsUi5Helpers(page) && options.filter) {
        await this._applyFilter(page, options.filter, timeoutMs);
      }

      if (supportsUi5Helpers(page) && options.expandGrowing !== false) {
        const growing = await clickGrowingTrigger(page, { maxClicks: 50, delayMs: 1200 });
        if (growing.truncated) {
          defaultLogger.warn(`[FormsScraper] ${safeKey}: growing list still had more rows after ${growing.clicks} click(s); reporting truncated.`);
        }
      }

      const stable = supportsUi5Helpers(page)
        ? await waitForTableStable(page, { timeoutMs })
        : { ok: true };

      const read = await this._readRows(page, options);

      if (!read.ok) {
        defaultLogger.warn(`[FormsScraper] Could not read forms for ${safeKey}: ${read.reason}`);
        return [];
      }

      if (read.truncated) {
        defaultLogger.warn(`[FormsScraper] ${safeKey}: read ${read.rows.length} of ${read.total} rows; the rest were not read.`);
      }

      defaultLogger.info(
        `[FormsScraper] Read ${read.rows.length} form row(s) for ${safeKey} via ${read.strategy}` +
        `${stable.ok ? '' : ' (table did not settle)'}.`
      );

      const forms = [];
      for (const record of read.rows) {
        if (record.__extraction_error) {
          defaultLogger.warn(`[FormsScraper] ${safeKey}: skipped a row (${record.__extraction_error}).`);
          continue;
        }

        const cells = record.cells || [];
        const rawText = cells.join(' ').trim();
        const formTitle = record.formTitle || '';
        if (formTitle === '' && rawText === '') continue;

        // The bound model's status is preferred; the row text is the fallback,
        // since some renders put the status in the row rather than a bound field.
        const statusSource = record.status || cells.join(' ');

        forms.push({
          source: 'forms',
          accountKey: safeKey,
          company: safeCompany,
          rawText,
          cells,
          status: classifyFormStatus(statusSource),
          formTitle,
          period: record.period || '',
          extraData: {
            status: record.status || '',
            dueDate: record.dueDate || '',
            periodFrom: record.periodFrom || '',
            periodTo: record.periodTo || ''
          },
          extraction: read.strategy
        });
      }

      return forms;
    } catch (err) {
      defaultLogger.warn(`[FormsScraper] Error scraping forms for ${safeKey}: ${err.message}`);
      return [];
    }
  }

  /**
   * Applies a forms filter and waits for the table to reload.
   *
   * @param {import('playwright').Page} page
   * @param {string} targetFilter
   * @param {number} timeoutMs
   * @returns {Promise<{ok: boolean, reason?: string}>}
   */
  async _applyFilter(page, targetFilter, timeoutMs) {
    const { switchSelectFilter } = require('./ui5-helpers');
    const wanted = FILTER_CONTROL.options.find((option) => option.key === targetFilter);

    const result = await switchSelectFilter(page, {
      controlId: FILTER_CONTROL.idSuffix,
      targetKey: wanted ? wanted.key : targetFilter,
      visibleText: wanted ? normalizeArabic(wanted.text) : '',
      delayMs: 800,
      timeoutMs
    }).catch((err) => ({ ok: false, reason: err.message }));

    if (!result.ok) {
      // Non-fatal: the read still happens and reports whatever is on screen.
      defaultLogger.warn(`[FormsScraper] Could not switch the filter to "${targetFilter}": ${result.reason}`);
    }
    return result;
  }

  /**
   * Reads the form rows, discovering the table control when the configured ids
   * miss.
   *
   * @param {import('playwright').Page} page
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async _readRows(page, options) {
    const readOptions = {
      headerMap: FORMS_HEADER_MAP,
      aliases: FORMS_FIELD_ALIASES,
      maxRows: MAX_FORM_ROWS
    };

    if (!supportsUi5Helpers(page)) {
      return readPortalRows(page, readOptions);
    }

    const resolved = await resolveTableId(page, {
      configuredSuffixes: TABLE_ID_SUFFIXES,
      cacheKey: TABLE_CACHE_KEY,
      aliases: FORMS_FIELD_ALIASES,
      expectedFields: EXPECTED_FIELDS
    });

    if (resolved.id) {
      if (resolved.discovered) FormsScraper._warnAboutDiscovery(resolved.id);
      return readPortalRows(page, Object.assign({ tableIdSuffix: resolved.id }, readOptions, options));
    }

    // No list control resolved. Fall back to the DOM, carrying the reason so the
    // log shows why the bound model was not used.
    const domRead = await readPortalRows(page, readOptions);
    return Object.assign({}, domRead, { reason: domRead.reason || resolved.reason || 'forms_table_not_found' });
  }
}

/**
 * Logs a discovered forms table id, once per distinct id for the process.
 *
 * @param {string} id
 * @returns {void}
 */
FormsScraper._warnAboutDiscovery = (function buildDiscoveryWarning() {
  const seen = new Set();
  return function warn(id) {
    if (seen.has(id)) return;
    seen.add(id);
    defaultLogger.warn(
      `[FormsScraper] None of the configured table ids matched; discovered "${id}" by its bound fields. ` +
      'Add it to TABLE_ID_SUFFIXES so discovery is not needed on the next run.'
    );
  };
})();

module.exports = {
  FormsScraper,
  MAX_FORM_ROWS,
  TABLE_ID_SUFFIXES,
  TABLE_CACHE_KEY,
  EXPECTED_FIELDS,
  FILTER_CONTROL,
  classifyFormStatus
};
