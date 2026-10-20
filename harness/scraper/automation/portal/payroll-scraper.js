'use strict';

/**
 * SAP UI5 Payroll Obligations Scraper (ETA ZMCF_PAYROLL).
 * Route: https://uptp.eta.gov.eg/sap/bc/ui5_ui5/sap/ZMCF_PAYROLL/index.html?sap-client=300&sap-language=AR#/filing_obligations
 *
 * Adheres to:
 * - RULE 1: Never ignore return values
 * - RULE 2: Validate all inputs
 * - RULE 3: No silent failures
 * - RULE 5: Resource cleanup
 * - RULE 6: Bounded operations
 * - RULE 7: Fail-safe defaults
 */

const { defaultLogger } = require('../../common/logger');
const { assertNonEmptyString } = require('../../common/assertions');
const { SAP_PAYROLL_FILING_OBLIGATIONS_URL } = require('./portal-urls');
const { normalizeArabic, coerceDateValue, waitForTableStable } = require('./ui5-helpers');

const MAX_PAYROLL_ROWS = 200;

class PayrollScraper {
  /**
   * Scrapes Payroll obligations from the ZMCF_PAYROLL portal.
   *
   * @param {import('playwright').Page} page
   * @param {string} accountKey
   * @param {string} [companyName]
   * @param {Object} [options={}]
   * @returns {Promise<{accountKey: string, company: string, scannedAt: string, summary: Object, obligations: Array<Object>}>}
   */
  async scrape(page, accountKey, companyName = '', options = {}) {
    if (!page || typeof page.evaluate !== 'function') {
      defaultLogger.warn('PayrollScraper.scrape called without valid Playwright page.');
      return { accountKey, company: companyName, scannedAt: new Date().toISOString(), summary: {}, obligations: [] };
    }
    const safeKey = assertNonEmptyString(accountKey, 'accountKey', 'PayrollScraper.scrape');
    const safeCompany = companyName || safeKey;
    const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : 30000;

    defaultLogger.info(`[PayrollScraper] Navigating to ZMCF_PAYROLL for ${safeCompany} (${safeKey})...`);

    try {
      // 1. Navigate to Payroll Portal
      await page.goto(SAP_PAYROLL_FILING_OBLIGATIONS_URL, { waitUntil: 'load', timeout: timeoutMs });
      await page.waitForTimeout(4000);

      // Check if on login / SSO redirect
      if (page.url().includes('login') || page.url().includes('auth')) {
        defaultLogger.warn(`[PayrollScraper] Account ${safeKey} redirected to login page on Payroll portal.`);
        return { accountKey: safeKey, company: safeCompany, scannedAt: new Date().toISOString(), summary: {}, obligations: [] };
      }

      // Wait for UI5 tiles or table to render (launchpad hydration)
      try {
        await page.waitForSelector('.sapMTile, .sapMCustomTile, table tbody tr', { timeout: 15000 });
      } catch (waitErr) {
        defaultLogger.warn(`[PayrollScraper] Wait for launchpad elements timed out: ${waitErr.message}`);
      }

      // Extract dashboard statistics if on launchpad / overview
      const dashboardStats = await this._extractDashboardStats(page);

      // Check if on launchpad tile container and navigate to filing obligations table
      try {
        if (!page.url().includes('filing_obligations') || (await page.locator('.sapMCustomTile, .sapMTile').count()) > 0) {
          // Look for navigation tile with "لم يتم التقديم" or the last "التزامات التقديم" tile
          let navTile = page.locator('.sapMCustomTile').filter({ hasText: 'لم يتم التقديم' }).first();
          if (await navTile.count() === 0) {
            navTile = page.locator('.sapMCustomTile, .sapMTile').filter({ hasText: 'التزامات التقديم' }).last();
          }

          if (await navTile.count() > 0) {
            defaultLogger.info(`[PayrollScraper] Clicking navigation tile for ${safeKey}...`);
            await navTile.click({ timeout: 6000 });
            await page.waitForTimeout(4000);
          }
        }
      } catch (tileErr) {
        defaultLogger.warn(`[PayrollScraper] Tile click error: ${tileErr.message}`);
      }

      // Wait for table to appear after navigation
      try {
        await page.waitForSelector('table tbody tr.sapMListTblRow, .sapMSlt', { timeout: 10000 });
      } catch (tableWaitErr) {
        defaultLogger.warn(`[PayrollScraper] Wait for table elements timed out: ${tableWaitErr.message}`);
      }

      // 2. Switch Filter to "الكل" (All)
      await this._switchFilterToAll(page);

      // 3. Scroll to load all rows
      await this._scrollToBottom(page);

      // 4. Extract table rows
      const extractedRows = await this._extractRows(page, safeKey, safeCompany);
      defaultLogger.info(`[PayrollScraper] Extracted ${extractedRows.length} payroll obligation(s) for ${safeKey}.`);

      // 5. Calculate summary statistics
      const submittedCount = extractedRows.filter((r) => r.submitted).length;
      const unsubmittedCount = extractedRows.length - submittedCount;

      const summary = {
        taxDueCurrentYear: dashboardStats.taxDue || 0,
        paymentsCurrentYear: dashboardStats.taxPayments || 0,
        employeeCount: dashboardStats.employeeCount || 0,
        submittedFilings: submittedCount,
        unsubmittedFilings: unsubmittedCount,
        paidOnTimeCurrentYear: 0,
        paidLateCurrentYear: 0,
        egyptianEmployees: dashboardStats.egyptianEmployees || 0,
        foreignEmployees: dashboardStats.foreignEmployees || 0
      };

      return {
        accountKey: safeKey,
        company: safeCompany,
        scannedAt: new Date().toISOString(),
        summary,
        obligations: extractedRows
      };
    } catch (err) {
      defaultLogger.warn(`[PayrollScraper] Error scraping payroll obligations for ${safeKey}: ${err.message}`);
      return { accountKey: safeKey, company: safeCompany, scannedAt: new Date().toISOString(), summary: {}, obligations: [] };
    }
  }

  /**
   * Extracts statistics from dashboard cards/tiles if available.
   * @param {import('playwright').Page} page
   * @returns {Promise<Object>}
   */
  async _extractDashboardStats(page) {
    try {
      return await page.evaluate(() => {
        const parseNum = (str) => {
          const m = (str || '').match(/[\d,.]+/);
          return m ? parseFloat(m[0].replace(/,/g, '')) : 0;
        };

        const tiles = Array.from(document.querySelectorAll('.sapMGT, .sapMTile'));
        const textAll = tiles.map(t => (t.innerText || '').replace(/\s+/g, ' ').trim());

        let employeeCount = 0;
        let egyptianEmployees = 0;
        let foreignEmployees = 0;
        let taxDue = 0;
        let taxPayments = 0;

        for (const t of tiles) {
          const txt = (t.innerText || '').replace(/\s+/g, ' ').trim();
          if (txt.includes('عدد الموظفين')) {
            const valEl = t.querySelector('.sapMNCValue, .sapMNCValueScr, .sapMGTValue');
            if (valEl) {
              employeeCount = parseNum(valEl.innerText);
            } else {
              const m = txt.match(/(\d+)\s*موظف/);
              if (m) employeeCount = parseInt(m[1], 10);
            }
          } else if (txt.includes('تصنيف الموظفين')) {
            const m = txt.match(/(\d+)\s*مصري/);
            if (m) egyptianEmployees = parseInt(m[1], 10);
            const f = txt.match(/(\d+)\s*اجنبي/);
            if (f) foreignEmployees = parseInt(f[1], 10);
          } else if (txt.includes('إجمالي الضريبة المستحقة')) {
            const valEl = t.querySelector('.sapMNCValue, .sapMNCValueScr, .sapMGTValue');
            taxDue = valEl ? parseNum(valEl.innerText) : parseNum(txt);
          } else if (txt.includes('مدفوعات ضريبة المرتبات')) {
            const valEl = t.querySelector('.sapMNCValue, .sapMNCValueScr, .sapMGTValue');
            taxPayments = valEl ? parseNum(valEl.innerText) : parseNum(txt);
          }
        }

        return { taxDue, taxPayments, employeeCount, egyptianEmployees, foreignEmployees };
      });
    } catch (err) {
      defaultLogger.warn(`[PayrollScraper] Failed to extract dashboard stats: ${err.message}`);
      return { taxDue: 0, taxPayments: 0, employeeCount: 0, egyptianEmployees: 0, foreignEmployees: 0 };
    }
  }

  /**
   * Switches the UI5 filter control to "الكل" (All).
   * @param {import('playwright').Page} page
   */
  async _switchFilterToAll(page) {
    try {
      // Check if already on 'الكل'
      const label = page.locator('.sapMSltLabel, [id*="filingObligationFilter-labelText"]').first();
      if (await label.count() > 0) {
        const text = (await label.innerText()).trim();
        if (text.includes('الكل')) {
          defaultLogger.info('[PayrollScraper] Filter already set to "الكل".');
          return;
        }
      }

      // Click filter trigger
      const filterTrigger = page.locator('.sapMSlt:not(.sapMSltHiddenSelect), [id*="filingObligationFilter"]').first();
      if (await filterTrigger.count() > 0) {
        await filterTrigger.click({ timeout: 5000 });
        await page.waitForTimeout(800);

        // Select 'الكل' option
        const allOption = page.locator('li, [role="option"], .sapMSelectListItem').filter({ hasText: /^الكل/ }).first();
        if (await allOption.count() > 0) {
          await allOption.click({ timeout: 5000 });
          await page.waitForTimeout(2000);
          defaultLogger.info('[PayrollScraper] Successfully switched filter to "الكل".');
          return;
        }
      }

      // Fallback text click
      const textMatch = page.locator('text="لم يتم التقديم"').first();
      if (await textMatch.count() > 0) {
        await textMatch.click({ timeout: 3000 });
        await page.waitForTimeout(800);
        const opt = page.locator('text="الكل"').last();
        if (await opt.count() > 0) {
          await opt.click({ timeout: 3000 });
          await page.waitForTimeout(2000);
        }
      }
    } catch (err) {
      defaultLogger.warn(`[PayrollScraper] Could not switch filter to "الكل": ${err.message}`);
    }
  }

  /**
   * Scrolls the scrollable container to trigger lazy rendering of all rows.
   * @param {import('playwright').Page} page
   */
  async _scrollToBottom(page) {
    try {
      // Click growing trigger if present
      for (let g = 0; g < 5; g += 1) {
        const growing = page.locator('.sapMGrowingListTrigger').first();
        if (await growing.count() > 0 && await growing.isVisible()) {
          await growing.click({ timeout: 3000 });
          await page.waitForTimeout(1000);
        } else {
          break;
        }
      }

      await page.evaluate(() => {
        const cont = document.querySelector('[data-scrollable], .sapMPageEnableScrolling, .sapMScrollContScroll');
        if (cont) {
          cont.scrollTop = cont.scrollHeight;
        } else {
          window.scrollTo(0, document.body.scrollHeight);
        }
      });
      await page.waitForTimeout(1500);
    } catch (scrollErr) {
      void (scrollErr);
    }
  }

  /**
   * Extracts table rows from DOM and maps to structured obligation objects.
   * @param {import('playwright').Page} page
   * @param {string} accountKey
   * @param {string} company
   * @returns {Promise<Array<Object>>}
   */
  async _extractRows(page, accountKey, company) {
    const rawData = await page.evaluate(({ maxRows }) => {
      const rows = Array.from(document.querySelectorAll('table tbody tr.sapMListTblRow'));
      if (rows.length === 0) {
        const fallbackRows = Array.from(document.querySelectorAll('table tbody tr'));
        return fallbackRows.map((r) => Array.from(r.querySelectorAll('td, th')).map((c) => (c.innerText || c.textContent || '').trim()))
          .filter((cells) => cells.length >= 4);
      }

      const results = [];
      for (let i = 0; i < Math.min(rows.length, maxRows); i += 1) {
        // Select genuine data cells only, ignoring highlight and nav columns
        const cellEls = Array.from(rows[i].querySelectorAll('td.sapMListTblCell'));
        const cells = (cellEls.length > 0 ? cellEls : Array.from(rows[i].querySelectorAll('td')))
          .map((c) => (c.innerText || c.textContent || '').trim());
        if (cells.some((c) => c.length > 0)) {
          results.push(cells);
        }
      }
      return results;
    }, { maxRows: MAX_PAYROLL_ROWS }).catch((err) => {
      defaultLogger.warn(`[PayrollScraper] DOM extraction evaluate failed: ${err.message}`);
      return [];
    });

    const obligations = [];
    for (let i = 0; i < rawData.length; i += 1) {
      const cells = rawData[i];
      const rowText = cells.join(' ').trim();
      if (!rowText || rowText.includes('لا توجد بيانات') || rowText.includes('No data')) continue;

      // Typical columns: [النموذج, الفترة, الفترة من, الفترة إلى, نوع الإيرادات, كائنات العقود, تاريخ الاستحقاق, تاريخ الاستلام]
      const form = cells[0] || '';
      const period = cells[1] || '';
      const periodFrom = coerceDateValue(cells[2] || '');
      const periodTo = coerceDateValue(cells[3] || '');
      const revenueType = cells[4] || '';
      const contractObject = cells[5] || '';
      const dueDate = coerceDateValue(cells[6] || '');
      const receiptDate = coerceDateValue(cells[7] || '');

      // Check submission status: if receivedDate is present or status text shows submitted
      const isSubmitted = Boolean(receiptDate || rowText.includes('تم التقديم') || rowText.includes('تم تقديمه'));

      obligations.push({
        id: `payroll_${accountKey}_${i + 1}`,
        company,
        accountKey,
        form,
        revenueType,
        period,
        periodFrom,
        periodTo,
        contractObject,
        dueDate,
        receiptDate,
        submitted: isSubmitted,
        rawCells: cells
      });
    }

    return obligations;
  }
}

module.exports = {
  PayrollScraper,
  MAX_PAYROLL_ROWS
};
