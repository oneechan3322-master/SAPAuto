/**
 * Unified Portal Scanner.
 * Orchestrates scraping across all 4 ETA portal routes for an account:
 * 1. #/documents (Documents & PDFs)
 * 2. #/filing_obligations (Statutory filing obligations)
 * 3. #/forms (Tax forms & declarations across draft/submitted/review/final/editable states)
 * 4. #/messages (Official letters, alerts & notifications)
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
const { ObligationsScraper, MAX_OBLIGATION_ROWS } = require('./obligations-scraper');
const { FormsScraper, MAX_FORM_ROWS } = require('./forms-scraper');
const { MessagesScraper, MAX_MESSAGES_COUNT } = require('./messages-scraper');
const { PORTAL_ROUTES } = require('./portal-urls');

/**
 * The three states a scrape can end in.
 *
 * The distinction is the whole point. A bare `[]` cannot distinguish "the portal
 * says there is nothing" from "the selector missed and we read nothing", and an
 * email that reports "0 portal alerts" after a failed scrape is a false all-clear
 * to a client.
 *
 * @typedef {{status: 'ok', rows: Array<Object>, total: number, truncated: boolean,
 *   scannedAt: string, reason?: string}
 *   | {status: 'failed', error: string, scannedAt: string, rows: Array<Object>, total: number, truncated: boolean}
 *   | {status: 'skipped', reason: string, scannedAt: string, rows: Array<Object>, total: number, truncated: boolean}}
 */

/** Row caps per route, used to report truncation honestly. */
const ROW_LIMITS = {
  obligations: MAX_OBLIGATION_ROWS,
  forms: MAX_FORM_ROWS,
  messages: MAX_MESSAGES_COUNT
};

/**
 * Builds one scrape result. `rows` is always an array so callers can iterate
 * without a null check, but the status is what they must branch on.
 *
 * @param {'ok'|'failed'|'skipped'} status
 * @param {Array<Object>} [rows]
 * @param {Object} [extra]
 * @returns {Object}
 */
function makeScrapeResult(status, rows, extra = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const limit = ROW_LIMITS[extra.route] || list.length;
  return Object.assign({
    status,
    rows: list,
    // "total" is how many were read, "shown" is how many survive the cap. When
    // they differ the UI and the email must say so rather than silently drop.
    total: list.length,
    shown: Math.min(list.length, limit),
    truncated: list.length > limit,
    scannedAt: new Date().toISOString()
  }, extra);
}

/**
 * Summarises a set of per-route results into a coverage line.
 *
 * Used by the digest so a partial run reads honestly. "checked 98 of 101"
 * is a very different statement from "checked 101".
 *
 * @param {Object<string, Object>} results - route name -> scrape result
 * @returns {{checked: number, failed: number, skipped: number, total: number, lines: Array<string>}}
 */
function summarizeCoverage(results) {
  const entries = Object.values(results || {}).filter((r) => r && typeof r === 'object');

  let checked = 0;
  let failed = 0;
  let skipped = 0;
  const truncatedRoutes = [];

  for (const result of entries) {
    if (result.status === 'ok') {
      checked += 1;
      if (result.truncated) truncatedRoutes.push(result.route || '');
    } else if (result.status === 'skipped') {
      skipped += 1;
    } else {
      failed += 1;
    }
  }

  const lines = [];
  if (failed > 0) lines.push(`فشل ${failed}`);
  if (skipped > 0) lines.push(`تم تجاوز ${skipped}`);
  for (const route of truncatedRoutes) {
    if (route) lines.push(`اقتُطع ${route} بعد الحد الأقصى للصفوف`);
  }

  return { checked, failed, skipped, total: entries.length, lines };
}

class PortalScanner {
  /**
   * @param {Object} [dependencies={}]
   * @param {ObligationsScraper} [dependencies.obligationsScraper]
   * @param {FormsScraper} [dependencies.formsScraper]
   * @param {MessagesScraper} [dependencies.messagesScraper]
   */
  constructor(dependencies = {}) {
    this.obligationsScraper = dependencies.obligationsScraper || new ObligationsScraper();
    this.formsScraper = dependencies.formsScraper || new FormsScraper();
    this.messagesScraper = dependencies.messagesScraper || new MessagesScraper();
  }

  /**
   * Scans all secondary portal sections for an account.
   *
   * Each route reports one of three states so a downstream report can say what
   * it actually knows. A failed route yields an empty `rows` array but a
   * `status` of 'failed' — never a bare empty array, which would read as "the
   * portal has nothing to report".
   *
   * @param {import('playwright').Page} page
   * @param {string} accountKey
   * @param {string} companyName
   * @param {Object} [options={}]
   * @returns {Promise<{
   *   obligations: Object, forms: Object, messages: Object, coverage: Object
   * }>}
   */
  async scanSecondaryRoutes(page, accountKey, companyName, options = {}) {
    const safeKey = assertNonEmptyString(accountKey, 'accountKey', 'PortalScanner.scanSecondaryRoutes');
    const safeCompany = companyName || safeKey;

    const results = {};

    const routes = [
      ['obligations', this.obligationsScraper],
      ['forms', this.formsScraper],
      ['messages', this.messagesScraper]
    ];

    for (const [route, scraper] of routes) {
      if (options.skipRoutes && Array.isArray(options.skipRoutes) && options.skipRoutes.includes(route)) {
        results[route] = makeScrapeResult('skipped', [], { route, reason: 'disabled_for_run' });
        continue;
      }

      try {
        const rows = await scraper.scrape(page, safeKey, safeCompany, options);
        results[route] = makeScrapeResult('ok', rows, { route });
      } catch (err) {
        // RULE 3: the failure is reported, not swallowed. It still propagates
        // outward as a status so the digest can count it.
        defaultLogger.warn(`[PortalScanner] ${route} scan error for ${safeKey}: ${err.message}`);
        results[route] = makeScrapeResult('failed', [], { route, error: err.message });
      }
    }

    results.coverage = summarizeCoverage(results);
    return results;
  }
}

module.exports = {
  PortalScanner,
  PORTAL_ROUTES,
  makeScrapeResult,
  summarizeCoverage,
  ROW_LIMITS
};
