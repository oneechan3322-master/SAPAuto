/**
 * SAP MCF Documents Scraper and Processor.
 * Extracts full inbox document history for the summary table,
 * while downloading and attaching PDFs for the current month.
 *
 * Adheres to:
 * - RULE 1: Never ignore return values
 * - RULE 2: Validate all inputs
 * - RULE 3: No silent failures
 * - RULE 4: Explicit error types
 * - RULE 5: Resource cleanup
 * - RULE 6: Bounded operations
 * - RULE 7: Fail-safe defaults
 * - RULE 10: Defensive redundancy
 */

const { AutomationError, ValidationError } = require('../common/errors');
const { assertNonEmptyString, assertNumberInRange } = require('../common/assertions');
const { defaultLogger } = require('../common/logger');
const {
  WORKSPACE_COMPANY_LINK_SELECTOR,
  pickBestCompanyLink
} = require('../config/company-registry');

const SAP_DOCUMENTS_URL =
  'https://fpascs.eta.gov.eg:44300/sap/bc/ui5_ui5/sap/ZETA_MCFAPP/index.html?sap-client=300&sap-language=ar#/documents';
const SAP_FILING_OBLIGATIONS_URL =
  'https://fpascs.eta.gov.eg:44300/sap/bc/ui5_ui5/sap/ZETA_MCFAPP/index.html?sap-client=300&sap-language=ar#/filing_obligations';
const SAP_FORMS_URL =
  'https://fpascs.eta.gov.eg:44300/sap/bc/ui5_ui5/sap/ZETA_MCFAPP/index.html?sap-client=300&sap-language=ar#/forms';
const ETA_PROFILE_TITLE_SELECTOR = '#__header0-titleText-inner';
const ETA_WORKSPACE_DASHBOARD_URL = 'https://workspace.eta.gov.eg/workspace/dashboard';

// SAP renders Arabic dates with invisible direction marks. Remove those marks
// before comparing dates or building persistent document identities.
function normalizePortalText(value) {
  return String(value || '')
    .replace(/[\u200e\u200f\u061c]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * SAP UI5 header element IDs vary between sessions. When the dedicated
 * header selector is unavailable, the profile page still places the official
 * account title directly above the taxpayer identification fields.
 */
function normalizeEtaProfileTitle(value) {
  const title = normalizePortalText(value);
  return title.length > 2 && title.length <= 300 ? title : '';
}

/* Legacy heuristic retained temporarily below only to avoid a broad encoding
 * rewrite. It is not used by scrapeAccountTitle or exported. */
function extractAccountTitleFromProfileText(value) {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => normalizePortalText(line))
    .filter(Boolean);

  const identifierIndex = lines.findIndex((line) =>
    line.includes('الرقم التعريفي للممول') || line.includes('رقم السجل الضريبي')
  );

  if (identifierIndex <= 0) {
    return '';
  }

  const ignoredLabels = new Set(['ملف التعريف', 'الحسابات']);
  const titleLines = lines
    .slice(Math.max(0, identifierIndex - 3), identifierIndex)
    .filter((line) => !ignoredLabels.has(line) && !/^\d+$/.test(line));

  const title = titleLines.join(' ').trim();
  return title.length > 2 && title.length <= 300 ? title : '';
}

/**
 * Portal phrases for an empty document list. Matched against normalised text, so
 * the exact wording and spacing of the portal does not matter.
 */
const EMPTY_STATE_PHRASES = Object.freeze([
  'لا توجد بيانات',
  'لا يوجد بيانات',
  'لا توجد مستندات',
  'لا توجد نتائج',
  'لا يوجد مستندات',
  'لا توجد أي بيانات',
  'لا يوجد أي مستند',
  'لا توجد نتائج مطابقة',
  'لا توجد طلبات'
]);

/**
 * Portal phrases that mean "there is nothing here", not "here is a document".
 *
 * The SAP list renders its empty state as a normal `sapMListTblRow`. That row
 * carries the `sapMListTblRow` class, so it passed the data-row selector and
 * became a task titled "لا توجد بيانات" with a synthetic `DOC_1` number. 72 of
 * the 388 registered tasks were this row: one per account whose list was empty
 * on that run. They were harmless individually and corrosive in aggregate,
 * because they made an account with nothing to do look like an account with one
 * document, and they inflated every document count the office reads.
 *
 * Matching is on the whole cell text, normalised, and must leave no digits: a
 * real notice always carries a document number, and a phrase that still contains
 * a 10+ digit run is a notice rather than an empty-state banner.
 *
 * @param {unknown} value - Raw row text.
 * @returns {boolean}
 */
function isEmptyStateRow(value) {
  const text = normalizePortalText(value);
  if (text.length === 0) return true;

  if (/\d{10,14}/.test(text)) return false;

  return EMPTY_STATE_PHRASES.some((phrase) => text.includes(phrase));
}

/**
 * Builds a stable identity for a notification row. A document number is not
 * sufficient: SAP can issue several distinct notifications for the same
 * document (for example, preparation and receipt confirmation).
 */
function buildDocumentIdentity(accountKey, docNum, title, date) {
  return [
    normalizePortalText(accountKey),
    normalizePortalText(docNum),
    normalizePortalText(date),
    normalizePortalText(title)
  ].join('::');
}

function normalizeArabicText(value) {
  return String(value || '')
    .replace(/[\u200e\u200f\u061c]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

function isReceiptConfirmation(title) {
  const norm = normalizeArabicText(title);
  return norm.includes('تاكيد استلام') || (norm.includes('تاكيد') && norm.includes('استلام'));
}

function isPreparationNotice(title) {
  const norm = normalizeArabicText(title);
  return norm.includes('تجهيز مستندات') || norm.includes('اخطار تجهيز') || norm.includes('تجهيز');
}

function getSortableDate(value) {
  const norm = normalizePortalText(value);
  // YYYY-MM-DD or YYYY/MM/DD
  const ymd = norm.match(/(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
  if (ymd) {
    return Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  }
  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = norm.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
  if (dmy) {
    return Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  }
  return 0;
}

/**
 * A receipt-confirmation notice closes an older preparation notice with the
 * same SAP document number. If it has the same document number, it means the
 * preparation request was fulfilled and is resolved.
 */
function applyDocumentLifecycle(rows) {
  const confirmations = new Map();

  for (const row of rows) {
    if (!isReceiptConfirmation(row.title)) continue;
    const existing = confirmations.get(row.docNum);
    if (!existing || getSortableDate(row.date) >= getSortableDate(existing.date)) {
      confirmations.set(row.docNum, row);
    }
  }

  return rows.map((row) => {
    const confirmation = confirmations.get(row.docNum);
    const isSuperseded = Boolean(
      confirmation &&
      confirmation.index !== row.index &&
      (isPreparationNotice(row.title) || getSortableDate(confirmation.date) >= getSortableDate(row.date))
    );

    return { ...row, isSuperseded, closedBy: isSuperseded ? confirmation : null };
  });
}

/**
 * Checks if a string or date matches the given month/year.
 * @param {string} text - Row text or date string
 * @param {Date} [currentDate=new Date()]
 * @returns {boolean}
 */
function isDateInCurrentMonth(text, currentDate = new Date()) {
  if (!text || typeof text !== 'string') {
    return false;
  }

  const normalizedText = normalizePortalText(text);
  const currentYear = currentDate.getFullYear();
  const currentMonthNum = currentDate.getMonth() + 1; // 1-12
  const monthPadded = String(currentMonthNum).padStart(2, '0');

  // Check formats: "2026-09", "2026/09", "09/2026", "27/09/2026", etc.
  const regexPatterns = [
    new RegExp(`${currentYear}[-/.]0?${currentMonthNum}\\b`),
    new RegExp(`\\b0?${currentMonthNum}[-/.]${currentYear}\\b`),
    new RegExp(`\\b${currentYear}[-/.]${monthPadded}\\b`),
    new RegExp(`\\b${monthPadded}[-/.]${currentYear}\\b`)
  ];

  for (const re of regexPatterns) {
    if (re.test(normalizedText)) {
      return true;
    }
  }

  // Arabic month names
  const arabicMonths = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  const arMonth = arabicMonths[currentDate.getMonth()];
  if (normalizedText.includes(arMonth) && normalizedText.includes(String(currentYear))) {
    return true;
  }

  return false;
}

class DocumentsService {
  /**
   * @param {Object} options
   * @param {import('./pdf-downloader').PdfDownloader} options.pdfDownloader
   * @param {import('../storage/sent-tracker').SentTracker} options.sentTracker
   * @param {number} [options.maxDocs=50]
   */
  constructor(options) {
    if (!options || typeof options !== 'object') {
      throw new ValidationError('Options must be provided to DocumentsService constructor');
    }
    this.pdfDownloader = options.pdfDownloader;
    this.sentTracker = options.sentTracker;
    this.maxDocs = assertNumberInRange(options.maxDocs || 50, 'maxDocs', 1, 500, 'DocumentsService');
  }

  /**
   * Reads the authoritative company name from the ETA Workspace dashboard.
   *
   * The workspace renders every taxpayer entity as a semantic link:
   *   <a href="/workspace/company/89897">افجي التوكيلات ... - افجي مصر</a>
   * This replaces the fragile SAP UI5 header scraping for name resolution.
   *
   * Returns null when the link is unavailable: a missing source must never be
   * turned into an invented name.
   *
   * @param {import('playwright').Page} page
   * @param {string} portalAccountId
   * @param {Object} [options={}]
   * @param {number} [options.timeoutMs=15000]
   * @param {boolean} [options.navigateIfNeeded=false] - Navigate to the workspace dashboard first
   * @returns {Promise<{companyName: string, companyId: string, href: string}|null>}
   */
  async scrapeWorkspaceCompany(page, portalAccountId, options = {}) {
    const accountId = assertNonEmptyString(portalAccountId, 'portalAccountId', 'scrapeWorkspaceCompany');
    const timeoutMs = assertNumberInRange(
      typeof options.timeoutMs === 'number' ? options.timeoutMs : 15000,
      'timeoutMs', 1000, 120000, 'DocumentsService.scrapeWorkspaceCompany'
    );

    try {
      if (options.navigateIfNeeded === true) {
        await page.goto(ETA_WORKSPACE_DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        await page.waitForTimeout(1500);
      }

      await page.waitForSelector(WORKSPACE_COMPANY_LINK_SELECTOR, {
        state: 'attached',
        timeout: Math.min(timeoutMs, 8000)
      }).catch(() => null);

      const links = await page.$$eval(WORKSPACE_COMPANY_LINK_SELECTOR, (nodes) =>
        nodes.slice(0, 25).map((el) => ({
          text: (el.innerText || el.textContent || '').trim(),
          href: el.getAttribute('href') || ''
        }))
      );

      const best = pickBestCompanyLink(links, accountId);

      if (best) {
        defaultLogger.info(
          `Resolved ETA Workspace company for ${accountId}: "${best.companyName}" (id ${best.companyId}).`
        );
        return best;
      }

      defaultLogger.warn(`No ETA Workspace company link was available for ${accountId}.`);
      return null;
    } catch (err) {
      defaultLogger.warn(`Could not read the ETA Workspace company link for ${accountId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Reads the ETA account name from the exact UserProfile title element.
   * It returns no name when that exact source is unavailable.
   *
   * @param {import('playwright').Page} page
   * @param {string} portalAccountId - Portal account identifier for diagnostics
   * @param {number} [timeoutMs=20000]
   * @returns {Promise<string>} Exact ETA profile title, or an empty string
   */
  async scrapeAccountTitle(page, portalAccountId, timeoutMs = 20000) {
    const accountId = assertNonEmptyString(portalAccountId, 'portalAccountId', 'scrapeAccountTitle');
    const profileUrl = 'https://fpascs.eta.gov.eg:44300/sap/bc/ui5_ui5/sap/ZETA_MCFAPP/index.html?sap-client=300&sap-language=ar#/UserProfile';

    defaultLogger.info(`Reading ETA profile title for portal account: ${accountId}...`);

    try {
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await page.waitForTimeout(4000);

      if (!page.url().includes('UserProfile')) {
        await page.evaluate(() => { window.location.hash = '#/UserProfile'; });
        await page.waitForTimeout(3000);
      }

      // Priority 1: UserProfile main section (#__page1-cont / section[id$="-cont"])
      // In SAP UI5, the official taxpayer entity name is rendered as the first text node
      // or first line in the main section before the tax ID label (الرقم التعريفي للممول).
      const sectionSelector = 'section[id="__page1-cont"], section[id$="-cont"], section[data-scrollable]';
      await page.waitForSelector(sectionSelector, { timeout: 10000 }).catch(() => null);

      const sectionExtracted = await page.evaluate(() => {
        const section = document.querySelector('section[id="__page1-cont"]') ||
                        document.querySelector('section[id$="-cont"]') ||
                        document.querySelector('section[data-scrollable]');
        if (!section) return '';

        // Method A: Check child text nodes directly
        const textNodes = Array.from(section.childNodes).filter(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent && node.textContent.trim()
        );
        if (textNodes.length > 0) {
          const firstText = textNodes[0].textContent.trim();
          if (firstText.length > 2 && !firstText.includes('الرقم التعريفي للممول')) {
            return firstText;
          }
        }

        // Method B: Parse section innerText
        const fullText = section.innerText || section.textContent || '';
        const lines = fullText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const idIndex = lines.findIndex((line) =>
          line.includes('الرقم التعريفي للممول') || line.includes('رقم التسجيل') || line.includes('رقم السجل')
        );
        if (idIndex > 0) {
          const candidate = lines.slice(0, idIndex).find((line) =>
            line.length > 2 && !['ملف التعريف', 'الحسابات'].includes(line)
          );
          if (candidate) return candidate;
        }

        if (lines.length > 0 && lines[0].length > 2 && !lines[0].includes('الرقم التعريفي')) {
          return lines[0];
        }

        return '';
      }).catch(() => '');

      const sectionTitle = normalizeEtaProfileTitle(sectionExtracted);
      if (sectionTitle) {
        defaultLogger.info(`Read ETA profile title from section #__page1-cont for portal account ${accountId}: "${sectionTitle}".`);
        return sectionTitle;
      }

      // Priority 2: Header title text inner selector fallback
      const selector = ETA_PROFILE_TITLE_SELECTOR;
      await page.waitForSelector(selector, { timeout: 5000 }).catch(() => null);
      const element = await page.$(selector);
      const headerTitle = element ? normalizeEtaProfileTitle(await element.innerText()) : '';

      if (headerTitle) {
        defaultLogger.info(`Read ETA profile title from header selector for portal account ${accountId}: "${headerTitle}".`);
        return headerTitle;
      }

      defaultLogger.warn(`ETA profile title was unavailable for portal account ${accountId}; no name was inferred.`);
      return '';
    } catch (err) {
      defaultLogger.warn(`Could not read ETA profile title for portal account ${accountId}: ${err.message}. No name was inferred.`);
      return '';
    }
  }

  /**
   * Navigates to SAP documents view, clicking the "مستنداتي" tile if on home page.
   * @param {import('playwright').Page} page
   * @param {number} [timeoutMs=60000]
   */
  async navigateToDocuments(page, timeoutMs = 60000) {
    defaultLogger.info(`Navigating to SAP MCF documents at ${SAP_DOCUMENTS_URL}...`);

    try {
      await page.goto(SAP_DOCUMENTS_URL, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs
      });

      await page.waitForTimeout(4000);

      // Check if coming from UserProfile or other view
      if (page.url().includes('UserProfile')) {
        await page.evaluate(() => { window.location.hash = '#/documents'; });
        await page.waitForTimeout(4000);
      }

      // Check if redirected to home page
      const currentUrl = page.url();
      if (!currentUrl.includes('#/documents')) {
        defaultLogger.info('SAP loaded on home view. Locating and clicking "مستنداتي" tile...');
        const myDocsTile = await page.waitForSelector('text="مستنداتي"', { timeout: 20000 }).catch(() => null);
        if (myDocsTile) {
          await myDocsTile.click();
          await page.waitForTimeout(4000);
        } else {
          // Fallback direct hash navigation
          await page.evaluate(() => { window.location.hash = '#/documents'; });
          await page.waitForTimeout(4000);
        }
      }

      // Wait for documents table rows OR empty-table indicator
      const readySelector = 'tr.sapMListTblRow:not(.sapMListTblHeader), .sapMListNoData, .sapMTableNoData, tr.sapMListTblNoData, table.sapMListTbl, .sapMList';
      await page.waitForSelector(readySelector, { timeout: 25000 }).catch(() => null);
      defaultLogger.info('SAP documents table successfully loaded and ready.');
    } catch (err) {
      throw new AutomationError(`Failed navigating to SAP documents page: ${err.message}`, {
        url: SAP_DOCUMENTS_URL,
        currentUrl: page.url()
      }, err);
    }
  }

  /**
   * Scrapes documents from the list, downloads PDFs for the target month,
   * and compiles the full inbox summary for the email.
   *
   * @param {import('playwright').Page} page
   * @param {import('playwright').BrowserContext} context
   * @param {string} accountKey
   * @param {string} monthKey
   * @returns {Promise<Array<{id: string, date: string, title: string, status: string, headline: string, pdfPath?: string, isCurrentMonth?: boolean}>>}
   */
  async processAccountDocuments(page, context, accountKey, monthKey) {
    const acc = assertNonEmptyString(accountKey, 'accountKey', 'processAccountDocuments');
    const month = assertNonEmptyString(monthKey, 'monthKey', 'processAccountDocuments');

    defaultLogger.info(`Scanning documents for account: ${acc}, month: ${month}...`);

    const dataRowSelector = 'tr.sapMListTblRow:not(.sapMListTblHeader)';
    const rows = await page.$$(dataRowSelector);

    if (rows.length === 0) {
      defaultLogger.warn(`No document rows found for account ${acc} on SAP page.`);
      return [];
    }

    // Drop the portal's empty-state row before it can become a document. It
    // carries the same row class as a real notice, so the selector above cannot
    // exclude it; only the text can. Counted separately so a run that reads only
    // an empty banner is reported as "no documents", which is what it means,
    // rather than "1 document".
    const emptyStateRows = [];

    defaultLogger.info(`Found ${rows.length} total document rows in SAP table for account ${acc}`);

    // Extract metadata for all rows in the inbox table
    const allRowData = [];
    for (let i = 0; i < rows.length; i++) {
      const rawText = (await rows[i].innerText()).trim();

      if (isEmptyStateRow(rawText)) {
        emptyStateRows.push(rawText);
        continue;
      }

      const parts = rawText.split(/\t+/);
      const title = parts[0] ? parts[0].trim() : `مستند ${i + 1}`;
      const date = parts[parts.length - 1] ? parts[parts.length - 1].trim() : '';
      const docMatch = title.match(/\b\d{10,14}\b/);
      const docNum = docMatch ? docMatch[0] : `DOC_${i + 1}`;
      const docIdentifier = buildDocumentIdentity(acc, docNum, title, date);
      const isCurrent = isDateInCurrentMonth(rawText);

      allRowData.push({
        index: i,
        rawText,
        title,
        date,
        docNum,
        docIdentifier,
        isCurrent
      });
    }

    if (emptyStateRows.length > 0) {
      defaultLogger.info(
        `Account ${acc}: ignored ${emptyStateRows.length} empty-state row(s) from the document list.`
      );
    }

    if (allRowData.length === 0) {
      defaultLogger.info(`Account ${acc} has no documents (portal reported an empty list).`);
      return [];
    }

    const documentsWithLifecycle = applyDocumentLifecycle(allRowData);

    // Only the first `maxDocs` rows are summarised for the task register, so only
    // those rows can carry an attached PDF. The download candidate list used to
    // be drawn from every row, uncapped: a current-month document beyond the
    // cutoff was downloaded, saved to disk and marked as sent, yet never reached
    // a task — the file existed with nothing pointing at it, and markSent meant
    // the next run skipped re-downloading it. Restrict the candidates to the
    // window that will actually be summarised so the two can never disagree.
    const summarisedWindow = documentsWithLifecycle.slice(0, this.maxDocs);

    // Determine which documents should have their PDF downloaded & attached:
    // Only current month documents, or if none in current month, latest 1st row
    let docsToDownload = summarisedWindow.filter(r => r.isCurrent && !r.isSuperseded);
    if (docsToDownload.length === 0 && summarisedWindow.length > 0) {
      defaultLogger.info(`No documents strictly matched current month (${month}). Attaching the latest document PDF (1st row).`);
      const latestActionable = summarisedWindow.find(r => !r.isSuperseded);
      docsToDownload = latestActionable ? [latestActionable] : [];
    }

    const downloadMap = new Map(); // docIdentifier -> pdfPath

    for (const target of docsToDownload) {
      if (this.sentTracker.hasBeenSent(acc, month, target.docIdentifier)) {
        // Already sent in an earlier run, so the download is skipped. Recover the
        // path that run recorded: the file is still on disk, and without this the
        // document is summarised with no PDF and the task looks unfulfilled.
        const previous = this.sentTracker.getSentRecord(acc, month, target.docIdentifier);
        const previousPath = previous && previous.metadata && typeof previous.metadata.pdfPath === 'string'
          ? previous.metadata.pdfPath
          : '';
        if (previousPath) {
          downloadMap.set(target.docIdentifier, previousPath);
          defaultLogger.info(`Document ${target.docIdentifier} was already sent in month ${month}. Reusing its recorded PDF path.`);
        } else {
          defaultLogger.info(`Document ${target.docIdentifier} was already sent in month ${month}. Skipping download.`);
        }
        continue;
      }

      defaultLogger.info(`Downloading PDF for document ${target.docIdentifier}: "${target.title}" (${target.date})...`);
      const currentRows = await page.$$(dataRowSelector);
      if (target.index < currentRows.length) {
        const rowElement = currentRows[target.index];
        let pdfPath = '';
        try {
          pdfPath = await this.pdfDownloader.downloadRowPdf(page, rowElement, target.docIdentifier);
        } catch (pdfErr) {
          defaultLogger.error(`Failed to download PDF for ${target.docIdentifier}: ${pdfErr.message}`);
        }
        if (pdfPath) {
          downloadMap.set(target.docIdentifier, pdfPath);
        }
      }
    }

    // Compile complete summary for ALL documents in this account
    const processedDocs = [];
    const maxIteration = Math.min(documentsWithLifecycle.length, this.maxDocs);

    for (let i = 0; i < maxIteration; i++) {
      const item = documentsWithLifecycle[i];
      const pdfPath = downloadMap.get(item.docIdentifier) || '';
      const alreadySent = this.sentTracker.hasBeenSent(acc, month, item.docIdentifier);

      let status = 'أرشيف';
      let headline = 'مستند سابق في سجل الحساب';

      if (item.isSuperseded) {
        status = 'تم الإغلاق';
        headline = `تم إغلاق هذا الإخطار بواسطة: ${item.closedBy.title} (${item.closedBy.date})`;
      } else if (isReceiptConfirmation(item.title)) {
        status = 'تم الاستلام والتأكيد';
        headline = 'إخطار تأكيد استلام صادر من المصلحة - تم استيفاء المستندات بنجاح';
      } else if (pdfPath) {
        status = 'مرفق PDF (الشهر الحالي)';
        headline = 'تم استخراج المستند بنجاح وإرفاقه بالبريد';
        // Mark as sent in tracker
        this.sentTracker.markSent(acc, month, item.docIdentifier, {
          id: item.docNum,
          date: item.date,
          title: item.title,
          status,
          pdfPath
        });
      } else if (alreadySent) {
        status = 'تم إرساله مسبقاً';
        headline = 'تم إرسال هذا المستند مسبقاً خلال هذا الشهر';
      } else if (item.isCurrent) {
        status = 'الشهر الحالي';
        headline = 'مستند ضمن الشهر الحالي';
      }

      processedDocs.push({
        id: item.docNum,
        date: item.date || new Date().toLocaleDateString('ar-EG'),
        title: item.title,
        status,
        headline,
        pdfPath,
        isCurrentMonth: item.isCurrent
      });
    }

    defaultLogger.info(`Finished processing: ${processedDocs.length} total documents listed, ${downloadMap.size} new PDF(s) attached for ${acc}.`);
    return processedDocs;
  }

  /**
   * Scrapes live statutory filing obligations and forms from the ETA portal.
   * Scrapes from:
   * 1. #/filing_obligations
   * 2. #/forms
   *
   * Delegates to ObligationsScraper and FormsScraper, which read the bound UI5
   * model and fall back to the DOM. This method previously carried its own copy
   * of the extraction, addressing columns by their generated `__columnN`
   * attribute — which the portal renumbers per session and per view order, so it
   * worked in development and broke in production.
   *
   * Per user requirement:
   * - ZERO fake / synthetic data.
   * - If an obligation/form is already done/submitted, it will NOT show up as a
   *   pending reminder.
   *
   * @param {import('playwright').Page} page
   * @param {string} accountKey
   * @param {string} companyName
   * @param {Object} [options={}]
   * @returns {Promise<Array<Object>>}
   */
  async scrapeAccountObligations(page, accountKey, companyName, options = {}) {
    const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 20000;
    const { ObligationsScraper } = require('./portal/obligations-scraper');
    const { FormsScraper } = require('./portal/forms-scraper');

    const obligationsScraper = new ObligationsScraper();
    const formsScraper = new FormsScraper();
    const scrapedRows = [];

    // --- 1. #/filing_obligations ---
    // Each route is isolated: one failing must not prevent the other from being
    // read, and the failure is logged rather than silently reducing the result.
    try {
      defaultLogger.info(`Scanning live ETA filing obligations at #/filing_obligations for ${companyName} (${accountKey})...`);
      const rows = await obligationsScraper.scrape(page, accountKey, companyName, { timeoutMs });
      scrapedRows.push(...rows);
    } catch (err) {
      defaultLogger.warn(`Could not scrape filing obligations for ${accountKey}: ${err.message}`);
    }

    // --- 2. #/forms ---
    try {
      defaultLogger.info(`Scanning live ETA forms at #/forms for ${companyName} (${accountKey})...`);
      const rows = await formsScraper.scrape(page, accountKey, companyName, { timeoutMs });
      scrapedRows.push(...rows);
    } catch (err) {
      defaultLogger.warn(`Could not scrape forms for ${accountKey}: ${err.message}`);
    }

    defaultLogger.info(`Collected ${scrapedRows.length} obligation/form row(s) for ${accountKey} from the live portal.`);
    return scrapedRows;
  }

  /**
   * Reads the portal's complete obligations view ("الكل"), for reconciliation.
   *
   * Kept separate from `scrapeAccountObligations` because the two have different
   * contracts. That one returns rows and lets the caller decide what an empty
   * result means; this one reports whether the read was *complete*, which is the
   * only thing that makes it safe to mark absent obligations as unconfirmed.
   *
   * A partial or failed read returns `complete: false` and the caller skips
   * reconciliation entirely. Treating an incomplete read as authoritative would
   * mark every obligation in the register as missing.
   *
   * @param {import('playwright').Page} page
   * @param {string} accountKey
   * @param {string} companyName
   * @param {Object} [options={}]
   * @returns {Promise<{rows: Array<Object>, complete: boolean, strategy: string, total: number, reason?: string}>}
   */
  async scrapeAllObligations(page, accountKey, companyName, options = {}) {
    const { ObligationsScraper, FILTER_CONTROL } = require('./portal/obligations-scraper');
    const { FILING_OBLIGATION_FILTERS } = require('./portal/portal-urls');

    const scraper = new ObligationsScraper();
    const rows = await scraper.scrape(page, accountKey, companyName, Object.assign({}, options, {
      filter: FILING_OBLIGATION_FILTERS.ALL
    }));

    // A scraper that failed to find or read the table returns no rows. That is
    // indistinguishable from a genuinely empty register by row count alone, so
    // the filter state is verified before calling the read complete.
    const filterVerified = await this._verifyFilterApplied(page, FILTER_CONTROL)
      .catch(() => false);

    const complete = rows.length > 0 && filterVerified;

    return {
      rows,
      complete,
      strategy: filterVerified ? 'all-filter' : 'unknown',
      total: rows.length,
      reason: complete ? undefined : (filterVerified ? 'no_rows_in_all_view' : 'all_filter_not_confirmed')
    };
  }

  /**
   * Checks that the obligations filter is showing "الكل".
   *
   * Reads the control's own text rather than trusting the click. A failed
   * switch leaves the previous filter in place, and reconciling against that
   * would mark every submitted obligation as missing.
   *
   * @param {import('playwright').Page} page
   * @param {Object} filterControl
   * @param {Object} options
   * @returns {Promise<boolean>}
   */
  async _verifyFilterApplied(page, filterControl) {
    if (!page || typeof page.evaluate !== 'function') return false;

    const wanted = filterControl.options.find((option) => option.key === 'all');
    const wantedText = wanted ? wanted.text : 'الكل';

    // Fast path: verify with Playwright locator directly on the visible select label
    try {
      const selectLabel = page.locator('.sapMSltLabel, [id*="filingObligationFilter"]').filter({ hasText: wantedText }).first();
      if (await selectLabel.count() > 0 && await selectLabel.isVisible()) {
        return true;
      }
    } catch (locErr) {
      void (locErr);
    }

    let actual = await page.evaluate((filter) => {
      const registry = window.sap && window.sap.ui && window.sap.ui.core && window.sap.ui.core.Element.registry;
      const normalize = (value) => String(value || '')
        .replace(/[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g, '')
        .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
        .replace(/\u0629/g, '\u0647')
        .replace(/\s+/g, ' ')
        .trim();
      const expected = (filter.discoveryTexts || []).map(normalize).filter(Boolean);
      let candidates = registry && typeof registry.filter === 'function' ? registry.filter((element) => {
        try {
          const id = element.getId();
          return id === filter.idSuffix || id.endsWith(filter.idSuffix);
        } catch (_) {
          return false;
        }
      }) : [];
      if (candidates.length !== 1 && expected.length > 0 && registry && typeof registry.filter === 'function') {
        candidates = registry.filter((element) => {
          try {
            if (typeof element.getItems !== 'function') return false;
            const itemTexts = element.getItems().map((item) => normalize(
              typeof item.getText === 'function' ? item.getText() : (item.getTitle ? item.getTitle() : '')
            ));
            return expected.every((text) => itemTexts.some((itemText) => itemText === text));
          } catch (_) {
            return false;
          }
        });
      }
      if (candidates.length !== 1) {
        // The live SAP page may keep UI5's registry outside Playwright's page
        // context or use generated IDs. Check DOM select/combobox/button elements.
        const nodes = Array.from(document.querySelectorAll('[id]')).filter((node) => {
          const id = node.id || '';
          return (id === filter.idSuffix || id.endsWith(filter.idSuffix))
            && node.classList && node.classList.contains('sapMSlt');
        });
        if (nodes.length === 1) {
          const label = document.getElementById(nodes[0].id + '-labelText')
            || nodes[0].querySelector('.sapMSltLabel');
          if (label) return String(label.innerText || label.textContent || '').trim();
        }

        // Check any active select/combobox/button label
        const selectNodes = Array.from(document.querySelectorAll('.sapMSlt, .sapMSelect, [role="combobox"], select, [aria-haspopup], .sapMBtn, [role="button"]'));
        for (const sNode of selectNodes) {
          const lbl = sNode.querySelector('.sapMSltLabel, [id$="-labelText"], .sapMBtnContent') || sNode;
          const text = String(lbl.innerText || lbl.textContent || '').trim();
          if (text) {
            const clean = normalize(text);
            if (expected.some((exp) => clean.indexOf(exp) !== -1 || exp.indexOf(clean) !== -1)) {
              return text;
            }
          }
        }

        // Direct search of any element with .sapMSltLabel
        const directLabels = Array.from(document.querySelectorAll('.sapMSltLabel, [id$="-labelText"]'));
        for (const dl of directLabels) {
          const text = String(dl.innerText || dl.textContent || '').trim();
          if (text) return text;
        }

        return '';
      }
      const element = candidates[0];
      if (typeof element.getSelectedItem === 'function') {
        const item = element.getSelectedItem();
        if (item && typeof item.getText === 'function') return String(item.getText() || '');
      }
      if (typeof element.getValueOnInteraction === 'function') return String(element.getValueOnInteraction() || '');
      if (typeof element.getValue === 'function') return String(element.getValue() || '');
      return '';
    }, { idSuffix: filterControl.idSuffix, discoveryTexts: filterControl.discoveryTexts || [] }).catch((err) => {
      void (err); // Handled fallback
      return '';
    });

    // Normalised on both sides so an alef or hamza variant still matches.
    const normalize = (value) => String(value || '')
      .replace(/[\u200e\u200f\u061c]/g, '')
      .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
      .replace(/\u0629/g, '\u0647')
      .replace(/\s+/g, ' ')
      .trim();

    let normalizedActual = normalize(actual);
    const match = normalize(wantedText);

    // Playwright locator verification fallback
    if (normalizedActual.indexOf(match) === -1) {
      try {
        const visibleWanted = page.locator('.sapMSlt, .sapMSelect, [role="combobox"], .sapMSltLabel, [role="button"], button')
          .filter({ hasText: wantedText }).first();
        if (await visibleWanted.count() > 0 && await visibleWanted.isVisible()) {
          actual = wantedText;
          normalizedActual = normalize(actual);
        }
      } catch (locErr) {
        void (locErr); // Handled
      }
    }

    if (normalizedActual.length === 0) {
      // The control could not be read at all. Treated as unconfirmed rather than
      // assumed correct.
      defaultLogger.warn('Could not read the obligations filter control, so the filter state is unconfirmed.');
      return false;
    }

    if (normalizedActual.indexOf(match) === -1) {
      defaultLogger.warn(`Obligations filter reads "${actual}", not "${wantedText}"; the switch did not take effect.`);
      return false;
    }

    return true;
  }

  /**
   * Scrapes live messages and notifications from ETA portal route `#/messages`.
   *
   * @param {import('playwright').Page} page
   * @param {string} accountKey
   * @param {string} companyName
   * @param {Object} [options={}]
   * @returns {Promise<Array<Object>>}
   */
  async scrapeAccountMessages(page, accountKey, companyName, options = {}) {
    const { MessagesScraper } = require('./portal/messages-scraper');
    const scraper = new MessagesScraper();
    return await scraper.scrape(page, accountKey, companyName, options);
  }
}

const { PORTAL_ROUTES } = require('./portal/portal-urls');

module.exports = {
  DocumentsService,
  SAP_DOCUMENTS_URL,
  SAP_FILING_OBLIGATIONS_URL,
  SAP_FORMS_URL,
  PORTAL_ROUTES,
  ETA_WORKSPACE_DASHBOARD_URL,
  ETA_PROFILE_TITLE_SELECTOR,
  isDateInCurrentMonth,
  buildDocumentIdentity,
  applyDocumentLifecycle,
  isEmptyStateRow,
  normalizeEtaProfileTitle,
  // Deprecated legacy helper: retained only for backward compatibility.
  // It is intentionally not used by the collector.
  extractAccountTitleFromProfileText
};
