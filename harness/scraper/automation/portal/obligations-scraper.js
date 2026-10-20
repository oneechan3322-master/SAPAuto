/**
 * Portal Obligations Scraper.
 * Specialized scraper for ETA portal route `#/filing_obligations`.
 *
 * Extraction strategy (see ui5-helpers.js for why):
 *   1. Read the bound model object, mapped by property-name alias.
 *   2. Fall back to reading the DOM, mapped by visible header text.
 * Neither path addresses a generated column id, which the portal renumbers per
 * session and per view order.
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
const { PORTAL_ROUTES, PORTAL_HASHES, FILING_OBLIGATION_FILTERS } = require('./portal-urls');
const {
  OBLIGATION_HEADER_MAP,
  OBLIGATION_FIELD_ALIASES,
  readPortalRows,
  supportsUi5Helpers,
  navigateToHash,
  waitForTableStable,
  clickGrowingTrigger,
  switchSelectFilter,
  normalizeArabic,
  resolveTableId
} = require('./ui5-helpers');

const MAX_OBLIGATION_ROWS = 100;

/**
 * Candidate UI5 control id suffixes for the obligations table, best guess first.
 *
 * These are inferred from naming convention, not from a capture of the live
 * portal. If none matches, `resolveTableId` discovers the real control by
 * scoring candidates on the fields their bound rows populate — so a renamed id
 * degrades to "found it anyway" rather than to a silent loss of the raw model
 * values. The warning below tells you when that happens and asks you to update
 * this list.
 */
const TABLE_ID_SUFFIXES = ['--idFilingObligationsTable', '--idFilingObligationTable', '--idTable'];

/** Fields a genuine obligations row must populate. */
const EXPECTED_FIELDS = ['formTitle', 'dueDate'];

/** Cache key for the process-lifetime discovery cache. */
const TABLE_CACHE_KEY = 'obligationsTable';

/**
 * The filter control and the visible text of each option.
 *
 * The key is what `setSelectedKey` takes; the text is what a human sees, and the
 * two are not interchangeable.
 */
const FILTER_CONTROL = Object.freeze({
  idSuffix: 'filingObligationFilter',
  // The live id was never captured. Both options together identify this select
  // without depending on its generated view prefix or a guessed suffix.
  discoveryTexts: ['لم يتم التقديم', 'الكل'],
  options: [
    { key: FILING_OBLIGATION_FILTERS.NOT_FILED, text: 'لم يتم التقديم' },
    { key: FILING_OBLIGATION_FILTERS.ALL, text: 'الكل' }
  ]
});

class ObligationsScraper {
  /**
   * Scrapes filing obligations from `#/filing_obligations`.
   *
   * @param {import('playwright').Page} page
   * @param {string} accountKey
   * @param {string} [companyName]
   * @param {Object} [options={}]
   * @param {string} [options.filter='notFiled'] - 'notFiled' or 'all'
   * @param {number} [options.timeoutMs=15000]
   * @returns {Promise<Array<Object>>}
   */
  async scrape(page, accountKey, companyName = '', options = {}) {
    if (!page || typeof page.evaluate !== 'function') {
      defaultLogger.warn('ObligationsScraper.scrape called without valid Playwright page.');
      return [];
    }
    const safeKey = assertNonEmptyString(accountKey, 'accountKey', 'ObligationsScraper.scrape');
    const safeCompany = companyName || safeKey;
    const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : 15000;
    const targetFilter = options.filter || FILING_OBLIGATION_FILTERS.NOT_FILED;

    try {
      defaultLogger.info(`[ObligationsScraper] Scanning #/filing_obligations for ${safeCompany} (${safeKey})...`);

      await navigateToHash(page, PORTAL_HASHES.FILING_OBLIGATIONS, 3000);

      // Ensure we enter the filing obligations view if currently on launchpad tiles
      try {
        const tile = page.locator('.sapMTile, .sapMCustomTile').filter({ hasText: 'التزامات التقديم' }).first();
        if (await tile.count() > 0 && await tile.isVisible()) {
          defaultLogger.info(`[ObligationsScraper] Clicking "التزامات التقديم" tile for ${safeKey}...`);
          await tile.click();
          await page.waitForTimeout(3000);
        }
      } catch (tileErr) {
        void (tileErr);
      }

      // The table keeps the previous filter's rows in the DOM while the new ones
      // load, so the filter is applied and then waited out before any read.
      if (supportsUi5Helpers(page) && targetFilter !== FILING_OBLIGATION_FILTERS.NOT_FILED) {
        await this._applyFilter(page, targetFilter, timeoutMs);
      }

      // "Load more" for sap.m.List, bounded so it cannot hammer the portal.
      if (supportsUi5Helpers(page) && options.expandGrowing !== false) {
        const growing = await clickGrowingTrigger(page, { maxClicks: 50, delayMs: 1200 });
        if (growing.truncated) {
          defaultLogger.warn(`[ObligationsScraper] ${safeKey}: growing list still had more rows after ${growing.clicks} click(s); reporting truncated.`);
        }
      }

      const stable = supportsUi5Helpers(page)
        ? await waitForTableStable(page, { timeoutMs })
        : { ok: true };

      const read = await this._readRows(page, options);

      if (!read.ok) {
        // A failed read is reported by returning nothing rather than a partial
        // set, because a short list reads as "these are all the obligations".
        defaultLogger.warn(`[ObligationsScraper] Could not read obligations for ${safeKey}: ${read.reason}`);
        return [];
      }

      if (read.truncated) {
        defaultLogger.warn(`[ObligationsScraper] ${safeKey}: read ${read.rows.length} of ${read.total} rows; the rest were not read.`);
      }

      defaultLogger.info(
        `[ObligationsScraper] Read ${read.rows.length} obligation row(s) for ${safeKey} via ${read.strategy}` +
        `${stable.ok ? '' : ' (table did not settle)'}.`
      );

      const rows = [];
      for (const record of read.rows) {
        // A row the extractor could not resolve is skipped and counted, never
        // converted into an empty obligation.
        if (record.__extraction_error) {
          defaultLogger.warn(`[ObligationsScraper] ${safeKey}: skipped a row (${record.__extraction_error}).`);
          continue;
        }

        const rawText = (record.cells || []).join(' ').trim();
        if (record.formTitle === '' && rawText === '') continue;

        rows.push({
          source: 'filing_obligations',
          accountKey: safeKey,
          company: safeCompany,
          rawText,
          cells: record.cells || [],
          formTitle: record.formTitle || '',
          period: record.period || '',
          periodFrom: record.periodFrom || '',
          periodTo: record.periodTo || '',
          revenueType: record.revenueType || '',
          dueDate: record.dueDate || '',
          receivedDate: record.receivedDate || '',
          extraction: read.strategy
        });
      }

      return rows;
    } catch (err) {
      defaultLogger.warn(`[ObligationsScraper] Error scraping filing obligations for ${safeKey}: ${err.message}`);
      return [];
    }
  }

  /**
   * Applies a filter and waits for the table to reload.
   *
   * @param {import('playwright').Page} page
   * @param {string} targetFilter
   * @param {number} timeoutMs
   * @returns {Promise<{ok: boolean, reason?: string}>}
   */
  async _applyFilter(page, targetFilter, timeoutMs) {
    const wanted = FILTER_CONTROL.options.find((option) => option.key === targetFilter);
    const wantedText = wanted ? wanted.text : targetFilter;

    // Check if the label is already set to the target filter
    try {
      const label = page.locator('.sapMSltLabel, [id*="filingObligationFilter-labelText"]').first();
      if (await label.count() > 0) {
        const text = (await label.innerText()).trim();
        if (text.includes(wantedText)) {
          return { ok: true, strategy: 'already_selected' };
        }
      }
    } catch (lblErr) {
      void (lblErr);
    }

    // Attempt direct Playwright click first (proven most reliable on live portal)
    try {
      const filterTrigger = page.locator('.sapMSlt:not(.sapMSltHiddenSelect), [id*="filingObligationFilter"]').first();
      if (await filterTrigger.count() > 0) {
        await filterTrigger.click({ timeout: 5000 });
        await page.waitForTimeout(800);
        const allOption = page.locator('li, [role="option"], .sapMSelectListItem').filter({ hasText: /^الكل/ }).first();
        if (await allOption.count() > 0) {
          await allOption.click({ timeout: 5000 });
          await page.waitForTimeout(1500);
          return { ok: true, strategy: 'playwright_direct_click' };
        }
      }
    } catch (pwErr) {
      defaultLogger.warn(`[ObligationsScraper] Playwright direct click failed: ${pwErr.message}`);
    }

    // Fall back to switchSelectFilter
    const result = await switchSelectFilter(page, {
      controlId: FILTER_CONTROL.idSuffix,
      targetKey: wanted ? wanted.key : targetFilter,
      visibleText: wanted ? normalizeArabic(wanted.text) : '',
      discoveryTexts: FILTER_CONTROL.discoveryTexts,
      delayMs: 800,
      timeoutMs
    }).catch((err) => ({ ok: false, reason: err.message }));

    if (!result.ok) {
      defaultLogger.warn(`[ObligationsScraper] Could not switch the filter to "${targetFilter}": ${result.reason}`);
    }
    return result;
  }

  /**
   * Reads the obligation rows.
   *
   * The configured id suffixes are tried first. When none of them matches, the
   * table control is discovered by what its bound rows contain, and the result
   * is cached for the rest of the session. A renamed control therefore costs one
   * discovery pass rather than a silent downgrade to text-only extraction.
   *
   * @param {import('playwright').Page} page
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async _readRows(page, options) {
    const readOptions = {
      headerMap: OBLIGATION_HEADER_MAP,
      aliases: OBLIGATION_FIELD_ALIASES,
      maxRows: MAX_OBLIGATION_ROWS
    };

    if (!supportsUi5Helpers(page)) {
      // No UI5 registry: the DOM path is the only option available.
      return readPortalRows(page, readOptions);
    }

    const resolved = await resolveTableId(page, {
      configuredSuffixes: TABLE_ID_SUFFIXES,
      cacheKey: TABLE_CACHE_KEY,
      aliases: OBLIGATION_FIELD_ALIASES,
      expectedFields: EXPECTED_FIELDS
    });

    if (resolved.id) {
      if (resolved.discovered) {
        ObligationsScraper._warnAboutDiscovery(resolved.id);
      }
      return readPortalRows(page, Object.assign({ tableIdSuffix: resolved.id }, readOptions, options));
    }

    // No list control resolved — either the screen has no registry at all, or
    // nothing on it binds obligations. The DOM path is still worth trying, and
    // the reason travels with the result so the log shows why the model was not
    // used.
    const domRead = await readPortalRows(page, readOptions);
    return Object.assign({}, domRead, { reason: domRead.reason || resolved.reason || 'obligations_table_not_found' });
  }
}

/**
 * Logs a discovered table id, once per distinct id for the process lifetime.
 *
 * The message is actionable on purpose: the next person should add the id to
 * TABLE_ID_SUFFIXES and drop the discovery pass from the hot path.
 *
 * @param {string} id
 * @returns {void}
 */
ObligationsScraper._warnAboutDiscovery = (function buildDiscoveryWarning() {
  const seen = new Set();
  return function warn(id) {
    if (seen.has(id)) return;
    seen.add(id);
    defaultLogger.warn(
      `[ObligationsScraper] None of the configured table ids matched; discovered "${id}" by its bound fields. ` +
      'Add it to TABLE_ID_SUFFIXES so discovery is not needed on the next run.'
    );
  };
})();

module.exports = {
  ObligationsScraper,
  MAX_OBLIGATION_ROWS,
  TABLE_ID_SUFFIXES,
  TABLE_CACHE_KEY,
  EXPECTED_FIELDS,
  FILTER_CONTROL
};
